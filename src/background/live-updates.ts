import { buildContentScriptMatchesForDomain, domainMatches, getEnabledRuleDomains, getFontExposurePayload, getGeolocationPayload, getLanguageTimezonePayload, validateConfig } from '../shared/config-resolver';
import type { RuntimeSyncComponentReport, SiteSpoofConfig } from '../shared/types';

export const LIVE_BRIDGE_SCRIPT_PREFIX = 'vanishgeo-live-bridge-';
export function compileLiveBridgeScripts(config: SiteSpoofConfig): chrome.scripting.RegisteredContentScript[] {
  const validated = validateConfig(config);
  if (!validated.ok) throw new Error('页面更新规则无效');
  const value = validated.config;
  return getEnabledRuleDomains(value).filter(domain => getLanguageTimezonePayload(value, domain)
    || getGeolocationPayload(value, domain) || getFontExposurePayload(value, domain)).sort().map(domain => ({
    id: LIVE_BRIDGE_SCRIPT_PREFIX + domain, matches: buildContentScriptMatchesForDomain(domain),
    excludeMatches: value.rules.map(rule => rule.domain).filter(child => child !== domain && domainMatches(child, domain))
      .flatMap(buildContentScriptMatchesForDomain).sort(),
    js: ['content/content.js'], world: 'ISOLATED', runAt: 'document_start', allFrames: true,
    matchOriginAsFallback: false, persistAcrossSessions: true
  }));
}

export async function reconcileLiveBridge(config: SiteSpoofConfig): Promise<RuntimeSyncComponentReport> {
  try {
    const desired = compileLiveBridgeScripts(config);
    const read = async () => (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith(LIVE_BRIDGE_SCRIPT_PREFIX));
    const signature = (script: chrome.scripting.RegisteredContentScript) => JSON.stringify({ id: script.id, matches: [...(script.matches || [])].sort(),
      excludeMatches: [...(script.excludeMatches || [])].sort(), js: script.js || [], world: script.world, runAt: script.runAt,
      allFrames: script.allFrames, matchOriginAsFallback: script.matchOriginAsFallback ?? false, persistAcrossSessions: script.persistAcrossSessions ?? true });
    const actual = await read();
    const wanted = new Map(desired.map(script => [script.id, script]));
    const remove = actual.filter(script => !wanted.has(script.id) || signature(script) !== signature(wanted.get(script.id)!)).map(script => script.id);
    if (remove.length) {
      await chrome.scripting.unregisterContentScripts({ ids: remove });
      if ((await read()).some(script => remove.includes(script.id))) throw new Error('页面桥撤销未确认');
    }
    const kept = await read();
    const add = desired.filter(script => !kept.some(current => current.id === script.id));
    if (add.length) await chrome.scripting.registerContentScripts(add);
    const final = await read();
    if (final.length !== desired.length || final.some(script => !wanted.has(script.id) || signature(script) !== signature(wanted.get(script.id)!))) throw new Error('页面桥注册未确认');
    return { status: 'ok', errors: [] };
  } catch {
    return { status: 'failed', errors: [{ code: 'live-bridge-sync-failed', message: '页面更新通道注册或撤销未确认；已有文档请完整重载。' }] };
  }
}

// 只通知，不把页面或content回复当成配置保存/实际生效证明；失败保留原有重载欠账。
export async function notifyLiveDocuments(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => typeof tab.id === 'number' && /^https?:/.test(tab.url || ''))
    .map(tab => chrome.tabs.sendMessage(tab.id!, { action: 'refreshLiveRuntime' })));
}
