import { buildContentScriptMatchesForDomain, domainMatches, getGeolocationPermissionSetting, validateConfig } from '../shared/config-resolver';
import { isIpv4Address } from '../shared/config-model';
import type { RuntimeSyncComponentReport, SiteSpoofConfig } from '../shared/types';

export const GEOLOCATION_PERMISSION_OWNER_KEY = 'geolocationPermissionProjectionV1';
export type GeolocationPermissionRule = { domain: string; setting: 'allow' | 'block' | 'ask' };

export async function revokeGeolocationPermissions(): Promise<RuntimeSyncComponentReport> {
  try {
    if (!chrome.contentSettings?.location) throw new Error('缺少 contentSettings.location');
    await chrome.contentSettings.location.clear({ scope: 'regular' });
    await chrome.storage.local.remove(GEOLOCATION_PERMISSION_OWNER_KEY);
    return { status: 'ok', errors: [] };
  } catch {
    return { status: 'failed', errors: [{ code: 'geolocation-permissions-clear-failed',
      message: '真实定位授权撤销失败；请关闭扩展并在 Chrome 站点设置中核实定位权限。' }] };
  }
}

export function compileGeolocationPermissions(config: SiteSpoofConfig): GeolocationPermissionRule[] {
  const result = validateConfig(config);
  if (!result.ok) throw new Error('定位权限配置校验失败');
  const value = result.config;
  if (!value.masterEnabled) return [];
  const active = value.rules.flatMap(rule => {
    const setting = getGeolocationPermissionSetting(value, rule.domain);
    return setting ? [{ domain: rule.domain, setting }] : [];
  });
  // ask 有意遮盖父规则真实授权；这与不接管原生权限的历史合同不同。
  return [...active, ...value.rules.filter(rule => !active.some(item => item.domain === rule.domain)
    && active.some(parent => parent.domain !== rule.domain && domainMatches(rule.domain, parent.domain)))
    .map(rule => ({ domain: rule.domain, setting: 'ask' as const }))].sort((a, b) => a.domain.localeCompare(b.domain));
}

// services 的同一配置队列是唯一调用方。此功能独占本扩展 location 类别，clear 不能按域名删除。
export async function reconcileGeolocationPermissions(config: SiteSpoofConfig): Promise<RuntimeSyncComponentReport> {
  // 当前 @types/chrome 的 get 仍只有 callback 重载；Chrome 138 的公开API返回Promise。
  const settings = chrome.contentSettings?.location as (chrome.contentSettings.ContentSetting & {
    get(details: { primaryUrl: string; secondaryUrl: string }): Promise<{ setting: string }>
  }) | undefined;
  try {
    if (!settings) throw new Error('缺少 contentSettings.location');
    const rules = compileGeolocationPermissions(config);
    const previous = (await chrome.storage.local.get(GEOLOCATION_PERMISSION_OWNER_KEY))[GEOLOCATION_PERMISSION_OWNER_KEY];
    const verify = async () => {
      for (const rule of rules) {
        const hosts = [rule.domain];
        if (rule.domain !== 'localhost' && !isIpv4Address(rule.domain)) {
          // 不发网络请求；选择未被更具体规则覆盖的子域，核验通配设置。
          let suffix = 0;
          let hostname: string;
          do { hostname = `vg-permission-check-${suffix++}.${rule.domain}`; }
          while (rules.some(item => item.domain !== rule.domain && domainMatches(item.domain, rule.domain) && domainMatches(hostname, item.domain)));
          hosts.push(hostname);
        }
        for (const host of hosts) for (const protocol of ['http', 'https']) {
          const url = `${protocol}://${host}/`;
          const actual = await settings.get({ primaryUrl: url, secondaryUrl: url });
          if (actual.setting !== rule.setting) return false;
        }
      }
      return true;
    };
    if (previous?.version === 1 && previous.state === 'confirmed' && JSON.stringify(previous.rules) === JSON.stringify(rules)) {
      if (await verify()) return { status: 'ok', errors: [] };
    }
    await chrome.storage.local.set({ [GEOLOCATION_PERMISSION_OWNER_KEY]: { version: 1, state: 'pending', rules } });
    await settings.clear({ scope: 'regular' });
    for (const rule of rules) for (const primaryPattern of buildContentScriptMatchesForDomain(rule.domain)) {
      await settings.set({ primaryPattern, setting: rule.setting, scope: 'regular' });
    }
    if (!await verify()) throw new Error('定位权限读回不一致或被其他策略接管');
    await chrome.storage.local.set({ [GEOLOCATION_PERMISSION_OWNER_KEY]: { version: 1, state: 'confirmed', rules } });
    return { status: 'ok', errors: [] };
  } catch {
    const errors = [{ code: 'geolocation-permissions-sync-failed', message: '真实站点定位授权同步或读回失败；未确认的定位脚本不派发，请检查扩展权限或其他浏览器策略。' }];
    // 已授权的范围必须尽力撤销；清理失败单独可见，不能用错误后的旧allow继续报成功。
    errors.push(...(await revokeGeolocationPermissions()).errors);
    return { status: 'failed', errors };
  }
}
