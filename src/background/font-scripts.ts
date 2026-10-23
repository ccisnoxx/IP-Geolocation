import { buildContentScriptMatchesForDomain, domainMatches, getEnabledRuleDomains, validateConfig } from '../shared/config-resolver';
import type { FontRuntimeStatus, RuntimeSyncComponentReport, SiteSpoofConfig } from '../shared/types';

export const FONT_SCRIPT_PREFIX = 'vanishgeo-font-exposure-';
// VG-025：2026-10-20 用户明确授权固定内置名单；custom及Worker继续暂停；定位恢复由VG-029独立入口负责。
export const FONT_FILTER_PRODUCTION_APPROVED = true;

export function hasFontScriptScopeChanged(previous: SiteSpoofConfig, next: SiteSpoofConfig): boolean {
  return FONT_FILTER_PRODUCTION_APPROVED && JSON.stringify(compileFontScripts(previous)) !== JSON.stringify(compileFontScripts(next));
}

export function compileFontScripts(config: SiteSpoofConfig): chrome.scripting.RegisteredContentScript[] {
  const validated = validateConfig(config);
  if (!validated.ok) throw new Error('字体脚本配置校验失败');
  const value = validated.config;
  if (!value.fontExposure.enabled || value.fontExposure.mode !== 'vendor-software') return [];
  const domains = getEnabledRuleDomains(value).sort();
  return domains.map(domain => ({
    id: FONT_SCRIPT_PREFIX + domain,
    matches: buildContentScriptMatchesForDomain(domain),
    excludeMatches: value.rules.map(rule => rule.domain).filter(child => child !== domain && domainMatches(child, domain))
      .flatMap(buildContentScriptMatchesForDomain).sort(),
    world: 'MAIN', runAt: 'document_start', allFrames: true,
    matchOriginAsFallback: false, persistAcrossSessions: true,
    js: ['font-exposure/filter.js']
  }));
}

function signature(script: chrome.scripting.RegisteredContentScript): string {
  return JSON.stringify({ id: script.id, matches: [...(script.matches || [])].sort(),
    excludeMatches: [...(script.excludeMatches || [])].sort(), js: script.js || [], css: script.css || [],
    world: script.world, runAt: script.runAt, allFrames: script.allFrames ?? false,
    matchOriginAsFallback: script.matchOriginAsFallback ?? false, persistAcrossSessions: script.persistAcrossSessions ?? true });
}

function fontSyncFailure(): RuntimeSyncComponentReport {
  return { status: 'failed', errors: [{ code: 'font-scripts-sync-failed',
    message: '字体注册撤销或同步未能确认；请关闭扩展并检查权限。旧文档须关闭重建。' }] };
}

// 只处理compiler已派生的注册；不拥有配置、队列或生产恢复授权。供同源资格控制面复用。
export async function syncFontScriptRegistration(
  desired: chrome.scripting.RegisteredContentScript[],
  beforeChange?: () => Promise<void>
): Promise<RuntimeSyncComponentReport> {
  try {
    const read = async () => (await chrome.scripting.getRegisteredContentScripts())
      .filter(script => script.id.startsWith(FONT_SCRIPT_PREFIX));
    let actual = await read();
    const wanted = new Map(desired.map(script => [script.id, script]));
    const remove = actual.filter(script => !wanted.has(script.id)
      || signature(script) !== signature(wanted.get(script.id)!)).map(script => script.id);
    // 配置未变也可能因启动清理或注册漂移重新派发；实际写入前交给队列所有者持久化重载窗口。
    if (beforeChange && (remove.length || desired.some(script => !actual.some(current => current.id === script.id)))) {
      await beforeChange();
    }
    if (remove.length) {
      await chrome.scripting.unregisterContentScripts({ ids: remove });
      actual = await read();
      if (actual.some(script => remove.includes(script.id))) throw new Error('撤销未确认');
    }
    const add = desired.filter(script => !actual.some(current => current.id === script.id));
    if (add.length) await chrome.scripting.registerContentScripts(add);
    const final = await read();
    if (final.length !== desired.length || final.some(script => !wanted.has(script.id)
      || signature(script) !== signature(wanted.get(script.id)!))) throw new Error('回读不一致');
    return { status: 'ok', errors: [] };
  } catch { return fontSyncFailure(); }
}

// 由 services 现有配置队列串行调用；人工门禁关闭时只撤销本功能旧注册。
export async function reconcileFontScripts(
  config: SiteSpoofConfig,
  beforeChange?: () => Promise<void>
): Promise<RuntimeSyncComponentReport & { fontRuntime: FontRuntimeStatus }> {
  let desired: chrome.scripting.RegisteredContentScript[];
  try { desired = FONT_FILTER_PRODUCTION_APPROVED ? compileFontScripts(config) : []; }
  catch { return { ...fontSyncFailure(), fontRuntime: { state: 'sync-failed', registeredRuleCount: null, reloadRequired: false } }; }
  const component = await syncFontScriptRegistration(desired, beforeChange);
  const state: FontRuntimeStatus['state'] = component.status !== 'ok' ? 'sync-failed'
    : !config.masterEnabled || !config.fontExposure.enabled ? 'disabled'
      : config.fontExposure.mode === 'custom' ? 'custom-paused'
        : !FONT_FILTER_PRODUCTION_APPROVED ? 'paused' : desired.length ? 'ready' : 'disabled';
  return { ...component, fontRuntime: { state,
    registeredRuleCount: component.status === 'ok' ? desired.length : null, reloadRequired: false } };
}
