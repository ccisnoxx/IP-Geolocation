import { buildContentScriptMatchesForDomain, domainMatches, getEnabledRuleDomains, getLanguageTimezonePayload, getGeolocationPayload, validateConfig } from '../shared/config-resolver';
import type { PageRuntimeStatus, RuntimeSyncComponentReport, RuntimeSyncError, SiteSpoofConfig } from '../shared/types';

export const PAGE_SCRIPT_PREFIX = 'vanishgeo-language-timezone-';
export const GEOLOCATION_SCRIPT_PREFIX = 'vanishgeo-geolocation-';
type Surface = 'page' | 'geolocation';
type Script = chrome.userScripts.RegisteredUserScript;
export type PageScriptSync = { component: RuntimeSyncComponentReport; pageRuntime: PageRuntimeStatus };

// source 只由构建期的仓库模板提供，配置中没有 JavaScript 字段。
function compileScripts(config: SiteSpoofConfig, source: string, surface: Surface): Script[] {
  const validated = validateConfig(config);
  if (!validated.ok) throw new Error('页面脚本配置校验失败');
  const domains = getEnabledRuleDomains(validated.config).sort();
  return domains.flatMap(domain => {
    const payload = surface === 'page' ? getLanguageTimezonePayload(validated.config, domain) : getGeolocationPayload(validated.config, domain);
    if (!payload) return [];
    if (!source) throw new Error('缺少构建期页面运行时模板');
    const json = JSON.stringify(payload).replace(/[<\u2028\u2029]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return [{
      id: (surface === 'page' ? PAGE_SCRIPT_PREFIX : GEOLOCATION_SCRIPT_PREFIX) + domain,
      matches: buildContentScriptMatchesForDomain(domain),
      // 即使更具体规则无有效信号，也必须阻止父规则重新覆盖该域。
      excludeMatches: validated.config.rules.map(rule => rule.domain).filter(child => child !== domain && domainMatches(child, domain))
        .flatMap(buildContentScriptMatchesForDomain).sort(),
      world: 'MAIN' as const, runAt: 'document_start' as const, allFrames: true,
      js: [{ code: `(${source})(${json});` }]
    }];
  });
}

export function compilePageScripts(config: SiteSpoofConfig, source: string): Script[] {
  return compileScripts(config, source, 'page');
}

export function compileGeolocationScripts(config: SiteSpoofConfig, source: string): Script[] {
  return compileScripts(config, source, 'geolocation');
}

export function hasGeolocationScriptsChanged(previous: SiteSpoofConfig, next: SiteSpoofConfig): boolean {
  return JSON.stringify(compileGeolocationScripts(previous, 'template')) !== JSON.stringify(compileGeolocationScripts(next, 'template'));
}

function scope(script: Script): string {
  return JSON.stringify({ matches: (script.matches || []).slice().sort(), excludeMatches: (script.excludeMatches || []).slice().sort(),
    includeGlobs: script.includeGlobs || [], excludeGlobs: script.excludeGlobs || [], world: script.world, runAt: script.runAt, allFrames: script.allFrames });
}
function signature(script: Script): string { return JSON.stringify([scope(script), script.js]); }

// services 配置队列是唯一调用方；不创建第二条注册队列或配置事实来源。
async function reconcileScripts(config: SiteSpoofConfig, source: string, surface: Surface, beforeChange?: () => Promise<void>): Promise<PageScriptSync> {
  const label = surface === 'page' ? '页面语言/时区' : '地理位置';
  const prefix = surface === 'page' ? PAGE_SCRIPT_PREFIX : GEOLOCATION_SCRIPT_PREFIX;
  const errors: RuntimeSyncError[] = [];
  const failed = (state: PageRuntimeStatus['state'], code: string, message: string): PageScriptSync => ({
    component: { status: 'failed', errors: [...errors, { code, message }] },
    pageRuntime: { state, registeredRuleCount: null, reloadRequired: false }
  });
  const major = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(globalThis.navigator?.userAgent || '')?.[1]);
  if (major && major < 138) return failed('api-unsupported', 'userscripts-unsupported', `${label}需要 Chrome 138 或更高版本。`);
  try {
    if (!await chrome.permissions.contains({ permissions: ['userScripts'] })) {
      return failed('permission-required', 'userscripts-permission-required', '缺少 userScripts 权限，请更新或重新加载扩展。');
    }
  } catch { return failed('sync-failed', 'permission-check-failed', '无法确认 userScripts 权限，页面注册未同步。'); }
  const api = chrome.userScripts;
  if (!api) return major >= 138
    ? failed('switch-required', 'userscripts-switch-required', '请在扩展详情页开启 Allow User Scripts，然后重试同步。')
    : failed('api-unsupported', 'userscripts-unsupported', '浏览器不支持 userScripts API。');
  if (['getScripts', 'register', 'update', 'unregister'].some(name => typeof api[name as keyof typeof api] !== 'function')) {
    return failed('api-unsupported', 'userscripts-unsupported', '浏览器缺少必要的 userScripts API。');
  }
  let desired: Script[];
  try { desired = compileScripts(config, source, surface); }
  catch { return failed('sync-failed', 'page-config-invalid', `${label}配置或构建模板无效，未注册新脚本。`); }
  const read = async () => (await api.getScripts()).filter(script => script.id.startsWith(prefix));
  let actual: Script[];
  try { actual = await read(); }
  catch { return failed('sync-failed', 'userscripts-read-failed', '无法读取 userScripts 注册，实际注册状态未知；请确认 Allow User Scripts 已开启后重试。'); }
  const wanted = new Map(desired.map(script => [script.id, script]));
  // 范围变化也先撤销，避免新增子规则时旧父规则仍覆盖它。
  const remove = actual.filter(script => !wanted.has(script.id) || scope(script) !== scope(wanted.get(script.id)!)).map(script => script.id);
  if (beforeChange && (remove.length || desired.some(script => !actual.some(current => current.id === script.id && signature(current) === signature(script))))) {
    try { await beforeChange(); }
    catch { return failed('sync-failed', surface === 'page' ? 'page-metadata-write-failed' : 'geolocation-metadata-write-failed',
      `${label}注册变化前的重载恢复记录写入失败，未改变注册。`); }
  }
  if (remove.length) {
    try {
      await api.unregister({ ids: remove });
      actual = await read();
      if (actual.some(script => remove.includes(script.id))) return failed('sync-failed', 'userscripts-revoke-unconfirmed', '旧页面注册未能确认撤销，已停止后续更新。');
    } catch { return failed('sync-failed', 'userscripts-revoke-failed', '撤销旧页面注册失败，已停止后续更新。'); }
  }
  const current = new Map(actual.map(script => [script.id, script]));
  const update = desired.filter(script => current.has(script.id) && signature(script) !== signature(current.get(script.id)!));
  if (update.length) {
    try { await api.update(update); }
    catch {
      errors.push({ code: 'userscripts-update-failed', message: `更新${label}注册失败。` });
      try { await api.unregister({ ids: update.map(script => script.id) }); }
      catch { errors.push({ code: 'userscripts-cleanup-failed', message: '更新失败后的旧注册清理也失败，请关闭扩展并检查权限。' }); }
      return failed('sync-failed', 'userscripts-sync-incomplete', '页面注册未完成同步，不会提示刷新。');
    }
  }
  const add = desired.filter(script => !current.has(script.id));
  if (add.length) {
    try { await api.register(add); }
    catch { return failed('sync-failed', 'userscripts-register-failed', `新增${label}注册失败，请重试同步。`); }
  }
  try {
    const final = await read();
    if (final.length !== desired.length || final.some(script => !wanted.has(script.id) || signature(script) !== signature(wanted.get(script.id)!))) {
      return failed('sync-failed', 'userscripts-verification-failed', '页面注册读回与配置不一致，请重试同步。');
    }
  } catch { return failed('sync-failed', 'userscripts-verification-failed', '无法确认页面注册结果，请重试同步。'); }
  return { component: { status: 'ok', errors: [] }, pageRuntime: {
    state: desired.length ? 'ready' : 'disabled', registeredRuleCount: desired.length, reloadRequired: false
  } };
}

export function reconcilePageScripts(config: SiteSpoofConfig, source: string, beforeChange?: () => Promise<void>): Promise<PageScriptSync> {
  return reconcileScripts(config, source, 'page', beforeChange);
}

export async function reconcileGeolocationScripts(config: SiteSpoofConfig, source: string, beforeChange?: () => Promise<void>) {
  const result = await reconcileScripts(config, source, 'geolocation', beforeChange);
  return { component: result.component, geolocationRuntime: result.pageRuntime };
}
