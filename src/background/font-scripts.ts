import { buildContentScriptMatchesForDomain, domainMatches, findMatchingRule, getEnabledRuleDomains, validateConfig } from '../shared/config-resolver';
import type { FontRuntimeStatus, RuntimeSyncComponentReport, SiteSpoofConfig } from '../shared/types';

export const FONT_SCRIPT_PREFIX = 'vanishgeo-font-exposure-';
// 仅用于撤销实验构建遗留的文件型 Worker 钩子；HTTP(S) Worker/SharedWorker 仍暂停。
export const FONT_WORKER_SCRIPT_PREFIX = 'vanishgeo-font-worker-';
// Canvas 字体伪装：独立 userScript，按声称平台选产物。
export const FONT_CANVAS_SCRIPT_PREFIX = 'vanishgeo-font-canvas-';
// VG-025：2026-10-20 用户明确授权固定内置名单；custom与 HTTP(S) Worker/SharedWorker 继续暂停；
// Blob 链内 Worker 的 OffscreenCanvas/FontFaceSet 已补齐（名单随 page payload 下发），见 offscreen-fonts.ts。
export const FONT_FILTER_PRODUCTION_APPROVED = true;

export function hasFontScriptScopeChanged(previous: SiteSpoofConfig, next: SiteSpoofConfig): boolean {
  return FONT_FILTER_PRODUCTION_APPROVED
    && JSON.stringify(compileFontRelatedScripts(previous)) !== JSON.stringify(compileFontRelatedScripts(next));
}

/** Canvas 字体伪装脚本：字体过滤开启 + canvas 开关 + full 规则，才按平台注册。 */
export function compileCanvasFontScripts(config: SiteSpoofConfig): chrome.scripting.RegisteredContentScript[] {
  if (!FONT_FILTER_PRODUCTION_APPROVED) return [];
  const value = validateConfig(config);
  if (!value.ok) throw new Error('字体脚本配置校验失败');
  if (!value.config.fontExposure.enabled || !value.config.fontExposure.canvasSpoof.enabled) return [];
  const platform = value.config.fontExposure.canvasSpoof.platform === 'windows' ? 'windows' : 'macos';
  return compileFontScripts(config).map(script => ({
    ...script,
    id: FONT_CANVAS_SCRIPT_PREFIX + script.id.slice(FONT_SCRIPT_PREFIX.length),
    js: [`canvas-fonts/${platform}.js`]
  }));
}

/** 生产字体注册；文件型 Worker 钩子保留为维护实验，不派发。 */
export function compileFontRelatedScripts(config: SiteSpoofConfig): chrome.scripting.RegisteredContentScript[] {
  return [...compileFontScripts(config), ...compileCanvasFontScripts(config)];
}

export function compileFontScripts(config: SiteSpoofConfig): chrome.scripting.RegisteredContentScript[] {
  const validated = validateConfig(config);
  if (!validated.ok) throw new Error('字体脚本配置校验失败');
  const value = validated.config;
  if (!value.fontExposure.enabled || value.fontExposure.mode !== 'vendor-software') return [];
  const domains = getEnabledRuleDomains(value)
    .filter(domain => findMatchingRule(value, domain)?.compatibilityPreset === 'full').sort();
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
      .filter(script => script.id.startsWith(FONT_SCRIPT_PREFIX) || script.id.startsWith(FONT_WORKER_SCRIPT_PREFIX)
        || script.id.startsWith(FONT_CANVAS_SCRIPT_PREFIX));
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
  let coveredDomains = 0;
  try {
    const filter = FONT_FILTER_PRODUCTION_APPROVED ? compileFontScripts(config) : [];
    desired = FONT_FILTER_PRODUCTION_APPROVED ? compileFontRelatedScripts(config) : [];
    coveredDomains = filter.length;
  } catch { return { ...fontSyncFailure(), fontRuntime: { state: 'sync-failed', registeredRuleCount: null, reloadRequired: false } }; }
  const component = await syncFontScriptRegistration(desired, beforeChange);
  const state: FontRuntimeStatus['state'] = component.status !== 'ok' ? 'sync-failed'
    : !config.masterEnabled || !config.fontExposure.enabled ? 'disabled'
      : config.fontExposure.mode === 'custom' ? 'custom-paused'
        : !FONT_FILTER_PRODUCTION_APPROVED ? 'paused' : coveredDomains ? 'ready' : 'disabled';
  return { ...component, fontRuntime: { state,
    registeredRuleCount: component.status === 'ok' ? coveredDomains : null, reloadRequired: false } };
}
