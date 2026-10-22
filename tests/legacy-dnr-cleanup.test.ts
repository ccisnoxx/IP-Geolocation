import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupLegacyAcceptLanguageRules } from '../src/background/legacy-dnr-cleanup';

function installMock(ids: number[], options: { stale?: boolean; marker?: boolean } = {}) {
  const previous = (globalThis as any).chrome;
  let rules = ids.map(id => ({ id, action: { type: 'block' }, condition: { urlFilter: 'synthetic' } })) as chrome.declarativeNetRequest.Rule[];
  const stored: Record<string, unknown> = options.marker ? { legacyDnrCleanupV3Complete: true } : {};
  const updates: chrome.declarativeNetRequest.UpdateRuleOptions[] = [];
  let reads = 0;
  (globalThis as any).chrome = {
    declarativeNetRequest: {
      getDynamicRules: async () => { reads++; return structuredClone(rules); },
      updateDynamicRules: async (update: chrome.declarativeNetRequest.UpdateRuleOptions) => {
        updates.push(update);
        assert.deepEqual(update.addRules, [], '清理不得添加规则');
        if (!options.stale) rules = rules.filter(rule => !update.removeRuleIds?.includes(rule.id));
      }
    },
    storage: { local: {
      get: async () => structuredClone(stored),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, value); }
    } }
  };
  return { stored, updates, ids: () => rules.map(rule => rule.id), reads: () => reads,
    restore: () => { (globalThis as any).chrome = previous; } };
}

test('遗留 DNR 清理删除含边界1100..2099，只保留范围外规则，核验后标记', async () => {
  const mock = installMock([7, 1099, 1100, 1500, 2099, 2100]);
  try {
    await cleanupLegacyAcceptLanguageRules();
    assert.deepEqual(mock.ids(), [7, 1099, 2100]);
    assert.deepEqual(mock.updates, [{ removeRuleIds: [1100, 1500, 2099], addRules: [] }]);
    assert.equal(mock.reads(), 2);
    assert.equal(mock.stored.legacyDnrCleanupV3Complete, true);
    await cleanupLegacyAcceptLanguageRules();
    assert.equal(mock.updates.length, 1);
    assert.equal(mock.reads(), 4, '重复清理仍实际复核，不信任 marker');
  } finally { mock.restore(); }
});

test('空规则集幂等，不执行任何动态规则写入', async () => {
  const mock = installMock([]);
  try {
    await cleanupLegacyAcceptLanguageRules();
    await cleanupLegacyAcceptLanguageRules();
    assert.deepEqual(mock.updates, []);
    assert.equal(mock.reads(), 4);
    assert.equal(mock.stored.legacyDnrCleanupV3Complete, true);
  } finally { mock.restore(); }
});

test('回读不一致失败，不能产生成功迁移标记', async () => {
  const mock = installMock([1100, 2100], { stale: true });
  try {
    await assert.rejects(cleanupLegacyAcceptLanguageRules(), { code: 'verification-failed' });
    assert.equal(mock.stored.legacyDnrCleanupV3Complete, undefined);
    assert.deepEqual(mock.ids(), [1100, 2100]);
  } finally { mock.restore(); }
});

test('已有 marker 不能遮蔽重新出现的旧规则或读取失败', async () => {
  const mock = installMock([1200], { marker: true });
  try {
    await cleanupLegacyAcceptLanguageRules();
    assert.deepEqual(mock.ids(), []);
    assert.equal(mock.updates.length, 1);
    chrome.declarativeNetRequest.getDynamicRules = async () => { throw new Error('合成读取失败'); };
    await assert.rejects(cleanupLegacyAcceptLanguageRules(), /合成读取失败/);
  } finally { mock.restore(); }
});

test('清理 API 不可用、删除失败或 marker 写失败均显式失败，可重试', async () => {
  const mock = installMock([1100]);
  try {
    const update = chrome.declarativeNetRequest.updateDynamicRules;
    chrome.declarativeNetRequest.updateDynamicRules = async () => { throw new Error('合成删除失败'); };
    await assert.rejects(cleanupLegacyAcceptLanguageRules(), /合成删除失败/);
    assert.equal(mock.stored.legacyDnrCleanupV3Complete, undefined);
    chrome.declarativeNetRequest.updateDynamicRules = update;
    const set = chrome.storage.local.set;
    chrome.storage.local.set = async () => { throw new Error('合成标记写失败'); };
    await assert.rejects(cleanupLegacyAcceptLanguageRules(), /合成标记写失败/);
    assert.deepEqual(mock.ids(), []);
    chrome.storage.local.set = set;
    await cleanupLegacyAcceptLanguageRules();
    assert.equal(mock.stored.legacyDnrCleanupV3Complete, true);
    (globalThis as any).chrome.declarativeNetRequest = undefined;
    await assert.rejects(cleanupLegacyAcceptLanguageRules(), { code: 'unsupported' });
  } finally { mock.restore(); }
});
