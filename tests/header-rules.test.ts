import test from 'node:test';
import assert from 'node:assert/strict';
import { createRule, getAcceptLanguageValue, normalizeConfig } from '../src/shared/config-model';
import { compileHeaderRules, clearHeaderRules, finishHeaderRules, HEADER_GUARD_RULESET, migrateLegacyHeaderRules, prepareHeaderRules } from '../src/background/header-rules';
import { createDnrMock } from './helpers/dnr-mock';
import { HEADER_RULE_OWNERSHIP_KEY } from '../src/shared/storage';

function config() {
  return normalizeConfig({ masterEnabled: true, globalProfile: {
    language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja', 'en'] },
    timezone: { enabled: false }, geolocation: { enabled: false }
  }, rules: [createRule('example.test')] } as any);
}
function install(dynamic: chrome.declarativeNetRequest.Rule[] = [], session: chrome.declarativeNetRequest.Rule[] = []) {
  const previous = globalThis.chrome, mock = createDnrMock(dynamic, session);
  const storage: Record<string, unknown> = {};
  Object.assign(globalThis, { chrome: { permissions: { contains: async () => true }, declarativeNetRequest: mock.api,
    storage: { local: { get: async () => structuredClone(storage), set: async (value: object) => { Object.assign(storage, value); } } } } });
  return { ...mock, storage, restore: () => { Object.assign(globalThis, { chrome: previous }); } };
}
const legacy = (id: number): chrome.declarativeNetRequest.Rule => ({ id, priority: 1,
  condition: { urlFilter: '|http' }, action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
    requestHeaders: [{ header: 'accept-language', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: 'zh-CN' }] } });

test('导航按目标站点、子资源按发起站点编译，子域关闭仍排除父域，未匹配和禁用不改头', () => {
  const value = config();
  const child = createRule('private.example.test'); child.overrides.language.mode = 'disable';
  value.rules.push(child);
  const rules = compileHeaderRules(value);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].condition.requestDomains, ['example.test']);
  assert.deepEqual(rules[0].condition.excludedRequestDomains, ['private.example.test']);
  assert.deepEqual(rules[0].condition.resourceTypes, ['main_frame', 'sub_frame']);
  assert.deepEqual(rules[1].condition.initiatorDomains, ['example.test']);
  assert.deepEqual(rules[1].condition.excludedInitiatorDomains, ['private.example.test']);
  assert.equal(rules[1].condition.requestDomains, undefined);
  assert.equal(rules[1].action.requestHeaders![0].value, 'ja-JP,ja;q=0.9,en;q=0.8');
  value.masterEnabled = false; assert.deepEqual(compileHeaderRules(value), []);
});

test('请求头只看语言：时区没解析出来时 Accept-Language 照样发，与时区一起失败才是 bug', () => {
  // P0：以前这里断言"时区拿不到 → 请求头也不发"，结果页面语言和请求头会说的不是一回事。
  // 现在语言只取决于语言配置；时区/定位缺档案只影响它们自己。
  const value = config(); value.globalProfile.timezone = { enabled: true, mode: 'auto', timezone: '' };
  assert.equal(compileHeaderRules(value)[0].action.requestHeaders![0].value, 'ja-JP,ja;q=0.9,en;q=0.8');
  // 语言本身关掉时，请求头也必须消失（这时页面也不会有语言补丁，两边仍然一致）
  value.globalProfile.language.enabled = false;
  assert.deepEqual(compileHeaderRules(value), []);
  value.globalProfile.language.enabled = true;
  value.globalProfile.timezone.enabled = false;
  value.rules[0].overrides.language = { mode: 'override', value: { language: 'fr-FR', languages: ['fr-FR', 'fr'] } };
  assert.equal(compileHeaderRules(value)[0].action.requestHeaders![0].value, 'fr-FR,fr;q=0.9');
});

test('localhost与其子域复用权威解析器的相同范围', () => {
  const value = config(); value.rules = [createRule('localhost')];
  const rules = compileHeaderRules(value);
  assert.deepEqual(rules[0].condition.requestDomains, ['localhost']);
  assert.deepEqual(rules[1].condition.initiatorDomains, ['localhost']);
});

test('HTTP语言入口拒绝换行注入和无效标签，长列表权重严格下降且非零', () => {
  const value = config(); value.globalProfile.language.languages.push('en-US\r\nX-Test: injected');
  assert.throws(() => compileHeaderRules(value), /配置校验失败/);
  const languages = Array.from({ length: 1000 }, (_, index) => `en-x-p${index}`);
  const weights = getAcceptLanguageValue(languages).split(',').map((item, index) => index ? Number(item.split(';q=')[1]) : 1);
  assert.ok(weights.every((weight, index) => weight > 0 && (index === 0 || weight < weights[index - 1])));
  value.globalProfile.language.languages = [...languages, 'fr'];
  assert.throws(() => compileHeaderRules(value), /配置校验失败/);
});

test('迁移清理两个存储的1001/1002及1100..2099，范围外保留；读回后才释放隔离', async () => {
  const unrelated = (id: number) => ({ ...legacy(id), action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType } });
  const mock = install([...[1001, 1100, 2099].map(legacy), unrelated(2100)], [legacy(1002), legacy(1101), legacy(30000), legacy(39999), unrelated(2200)]);
  try {
    const desired = await prepareHeaderRules(config());
    assert.deepEqual((await mock.api.getDynamicRules()).map(rule => rule.id), [2100]);
    assert.deepEqual((await mock.api.getSessionRules()).map(rule => rule.id), [2200]);
    assert.deepEqual(await mock.api.getEnabledRulesets(), [HEADER_GUARD_RULESET]);
    await finishHeaderRules(desired, true);
    assert.equal((await mock.api.getDynamicRules()).length, 3);
    assert.deepEqual((await mock.api.getSessionRules()).map(rule => rule.id), [2200]);
    assert.deepEqual(await mock.api.getEnabledRulesets(), []);
    const events = mock.events.slice();
    await finishHeaderRules(await prepareHeaderRules(config()), true);
    assert.deepEqual(mock.events, events);
  } finally { mock.restore(); }
});

test('范围外未知语言头规则保留并报告冲突，不能解除隔离', async () => {
  const mock = install([legacy(2100)]);
  try {
    await assert.rejects(prepareHeaderRules(config()), /迁移冲突/);
    assert.equal((await mock.api.getDynamicRules())[0].id, 2100);
    assert.deepEqual(await mock.api.getEnabledRulesets(), [HEADER_GUARD_RULESET]);
  } finally { mock.restore(); }
});

test('旧规则删除未确认不放行；新规则安装或读回失败不解除隔离', async () => {
  const mock = install([legacy(1001)]);
  try {
    mock.api.updateDynamicRules = async () => {};
    await assert.rejects(migrateLegacyHeaderRules(), /残留/);
    assert.ok((await mock.api.getEnabledRulesets()).includes(HEADER_GUARD_RULESET));
    assert.equal(mock.events.includes('release'), false);
  } finally { mock.restore(); }
  const failed = install();
  try {
    const desired = await prepareHeaderRules(config());
    failed.api.updateDynamicRules = async () => {};
    await assert.rejects(finishHeaderRules(desired, true), /读回/);
    assert.equal(failed.events.includes('release'), false);
  } finally { failed.restore(); }
});

test('dynamic与受管session同ID也不能当作已拥有，关闭配置仍须隔离未知语言头', async () => {
  const mock = install([legacy(30000)]);
  try {
    const value = config(); value.masterEnabled = false;
    await assert.rejects(prepareHeaderRules(value), /迁移冲突/);
    assert.equal((await mock.api.getDynamicRules())[0].id, 30000);
    assert.deepEqual(await mock.api.getEnabledRulesets(), [HEADER_GUARD_RULESET]);
  } finally { mock.restore(); }
});

test('页面未就绪撤销受管请求头并保留隔离，权限失败不冒充同步成功', async () => {
  const mock = install();
  try {
    await finishHeaderRules(await prepareHeaderRules(config()), true);
    await assert.rejects(finishHeaderRules(await prepareHeaderRules(config()), false), /页面语言/);
    assert.deepEqual(await mock.api.getSessionRules(), []);
    assert.deepEqual(await mock.api.getDynamicRules(), []);
    assert.deepEqual(await mock.api.getEnabledRulesets(), [HEADER_GUARD_RULESET]);
    chrome.permissions.contains = async () => false;
    await assert.rejects(clearHeaderRules(), /权限/);
  } finally { mock.restore(); }
});

test('新dynamic命名空间首次接管冲突保留，即使规则不是语言头也不能凭ID删除', async () => {
  for (const action of [legacy(40000).action, { type: 'block' as chrome.declarativeNetRequest.RuleActionType }]) {
    const rule = { ...legacy(40000), action }, mock = install([rule]);
    try {
      await assert.rejects(prepareHeaderRules(config()), /不能接管/);
      await clearHeaderRules();
      assert.deepEqual(await mock.api.getDynamicRules(), [rule]);
      assert.equal(mock.storage[HEADER_RULE_OWNERSHIP_KEY], undefined);
      assert.deepEqual(await mock.api.getEnabledRulesets(), [HEADER_GUARD_RULESET]);
    } finally { mock.restore(); }
  }
});

test('已确认dynamic投影冷启动不重新隔离，所有权不代替旧规则实际清理', async () => {
  const mock = install();
  try {
    await finishHeaderRules(await prepareHeaderRules(config()), true);
    assert.equal(mock.storage[HEADER_RULE_OWNERSHIP_KEY], 1);
    const before = mock.events.slice();
    await finishHeaderRules(await prepareHeaderRules(config()), true);
    assert.deepEqual(mock.events, before);
    await mock.api.updateDynamicRules({ addRules: [legacy(1001)] });
    await finishHeaderRules(await prepareHeaderRules(config()), true);
    assert.equal((await mock.api.getDynamicRules()).some(rule => rule.id === 1001), false);
  } finally { mock.restore(); }
});
