import { RuntimeSyncOperationError } from '../shared/runtime-sync';

export const LEGACY_ACCEPT_LANGUAGE_RULE_ID_START = 1100;
export const LEGACY_ACCEPT_LANGUAGE_RULE_ID_END = 2099;
const CLEANUP_COMPLETE_KEY = 'legacyDnrCleanupV3Complete';

function isLegacyRule(rule: chrome.declarativeNetRequest.Rule): boolean {
  return rule.id >= LEGACY_ACCEPT_LANGUAGE_RULE_ID_START && rule.id <= LEGACY_ACCEPT_LANGUAGE_RULE_ID_END;
}

// 仅由 services 的串行队列调用；迁移标记记录曾成功清理，不替代每次实际复核。
export async function cleanupLegacyAcceptLanguageRules(): Promise<void> {
  const api = chrome.declarativeNetRequest;
  if (!api?.getDynamicRules || !api.updateDynamicRules) {
    throw new RuntimeSyncOperationError('unsupported', '浏览器不支持读取和清理旧请求头规则。');
  }
  const removeRuleIds = (await api.getDynamicRules()).filter(isLegacyRule).map((rule) => rule.id);
  if (removeRuleIds.length) await api.updateDynamicRules({ removeRuleIds, addRules: [] });
  if ((await api.getDynamicRules()).some(isLegacyRule)) {
    throw new RuntimeSyncOperationError('verification-failed', '旧请求头规则仍存在，请重试清理。');
  }
  const stored = await chrome.storage.local.get(CLEANUP_COMPLETE_KEY);
  if (stored[CLEANUP_COMPLETE_KEY] !== true) {
    await chrome.storage.local.set({ [CLEANUP_COMPLETE_KEY]: true });
  }
}
