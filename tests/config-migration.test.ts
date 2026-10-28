import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_DOMAINS_V5,
  BUILTIN_PROFILE_IDS_V5,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  DEFAULT_PROFILES,
  DEFAULT_RULE_DOMAINS,
  createRule,
  migrateStoredConfig,
  normalizeConfig
} from '../src/shared/config-model';
import type { SiteSpoofConfig } from '../src/shared/types';
import {
  domainMatches,
  findMatchingRule,
  migrateLegacyConfig,
  SITE_CONFIG_KEY,
  validateConfig
} from '../src/shared/config-resolver';

/**
 * schemaVersion 5：存量配置也要拿到新内置项。
 *
 * 这一组测试的来历：v5 给白名单加了 7 个隐私检测站、给内置预设加了 `us-west`。
 * 原来的 `normalizeConfig` 是「存量非空就整段以存量为准」，于是只有新装用户
 * 有检测站，升级用户永远自测不了 —— 功能写在更新日志里却没人能用到。
 *
 * 修法是把升级放进 `migrateStoredConfig`（存储层唯一入口），并靠版本号保证
 * 幂等：一旦存成 v5，用户删掉的内置规则不会被下一次读取复活。
 */

/** 13 条老白名单（v5 之前的内置项）。 */
const LEGACY_DOMAINS = DEFAULT_RULE_DOMAINS.filter((domain) => !BUILTIN_DOMAINS_V5.includes(domain));

function v4Config(overrides: Partial<SiteSpoofConfig> = {}): Record<string, unknown> {
  const legacy = normalizeConfig(DEFAULT_CONFIG);
  return {
    ...structuredClone(JSON.parse(JSON.stringify(legacy))),
    schemaVersion: 4,
    rules: LEGACY_DOMAINS.map((domain) => createRule(domain)),
    profile: { activeProfileId: 'united-states', profiles: DEFAULT_PROFILES.filter((p) => p.id !== 'us-west') },
    ...overrides
  };
}

test('v4 存量配置升级后拿到 7 个检测站，且原有顺序不变', () => {
  const upgraded = migrateStoredConfig(v4Config());

  assert.equal(upgraded.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(upgraded.rules.length, LEGACY_DOMAINS.length + BUILTIN_DOMAINS_V5.length);
  // 老条目一条不动、顺序不动：用户的列表是他自己排的
  assert.deepEqual(upgraded.rules.slice(0, LEGACY_DOMAINS.length).map((rule) => rule.domain), LEGACY_DOMAINS);
  // 新增的都在尾巴上，且全部启用
  const added = upgraded.rules.slice(LEGACY_DOMAINS.length);
  assert.deepEqual(added.map((rule) => rule.domain), BUILTIN_DOMAINS_V5);
  assert.ok(added.every((rule) => rule.enabled), '补进来的内置站必须默认启用，否则装上还是自测不了');
});

test('检测站能被后缀匹配命中，也能被排除式挖掉', () => {
  const upgraded = migrateStoredConfig(v4Config());
  // 裸域条目 + 后缀匹配 = 子域、www 全覆盖（不走 `*.` 通配）
  for (const host of ['browserleaks.com', 'www.browserleaks.com', 'a.b.c.browserscan.net']) {
    const rule = findMatchingRule(upgraded, host);
    assert.ok(rule, `${host} 应该命中一条规则`);
  }
  assert.equal(domainMatches('evil-browserleaks.com', 'browserleaks.com'), false, '不能只做 endsWith(string)');

  const excluded = migrateStoredConfig(v4Config({
    rules: [...LEGACY_DOMAINS.map((domain) => createRule(domain)), { ...createRule('ipleak.net'), enabled: false }]
  }));
  assert.equal(excluded.rules.filter((rule) => rule.domain === 'ipleak.net').length, 1, '用户写了排除就不再补一条启用的');
  assert.equal(excluded.rules.find((rule) => rule.domain === 'ipleak.net')?.enabled, false);
});

test('用户删掉的检测站不会在下次读取时复活（幂等）', () => {
  const upgraded = migrateStoredConfig(v4Config());
  // 用户在 options 里删掉两个检测站，存盘（此时版本已是 v5）
  const withoutTwo = normalizeConfig({
    ...upgraded,
    rules: upgraded.rules.filter((rule) => rule.domain !== 'whoer.net' && rule.domain !== 'iprisk.top')
  });
  assert.equal(withoutTwo.schemaVersion, CONFIG_SCHEMA_VERSION);

  const reread = migrateStoredConfig(withoutTwo);
  assert.equal(reread.rules.some((rule) => rule.domain === 'whoer.net'), false);
  assert.equal(reread.rules.some((rule) => rule.domain === 'iprisk.top'), false);
  assert.deepEqual(reread.rules, withoutTwo.rules, 'v5 配置读出来必须原样返回');

  // 同一份 v4 配置连读两次，结果一致（不会一边读一边膨胀）
  const once = migrateStoredConfig(v4Config());
  assert.deepEqual(migrateStoredConfig(once).rules, once.rules);
});

test('没有版本号的最老配置也按存量处理', () => {
  const oldest = { ...v4Config(), schemaVersion: undefined };
  const upgraded = migrateStoredConfig(oldest as any);
  assert.equal(upgraded.rules.length, LEGACY_DOMAINS.length + BUILTIN_DOMAINS_V5.length);
  assert.equal(upgraded.schemaVersion, CONFIG_SCHEMA_VERSION);
});

test('内置预设同样回填：v4 存盘拿到了 us-west', () => {
  const upgraded = migrateStoredConfig(v4Config());
  const ids = upgraded.profile.profiles.map((profile) => profile.id);
  for (const id of BUILTIN_PROFILE_IDS_V5) assert.ok(ids.includes(id), `缺内置预设 ${id}`);
  assert.equal(ids.filter((id) => id === 'us-west').length, 1, '只能补一条');

  const west = upgraded.profile.profiles.find((profile) => profile.id === 'us-west');
  assert.equal(west?.timezone.timezone, 'America/Los_Angeles');
  assert.equal(west?.geolocation.latitude, 34.0522);
  assert.equal(west?.geolocation.longitude, -118.2437);
});

test('用户自定义的预设不会被冲掉，也不会被删', () => {
  const custom = {
    id: 'my-cafe',
    name: '常去的咖啡馆',
    geolocation: { latitude: 31.2, longitude: 121.5, accuracy: 50, country: 'China' },
    language: { language: 'zh-CN', languages: ['zh-CN', 'zh'], acceptLanguage: 'zh-CN,zh;q=0.9' },
    timezone: { timezone: 'Asia/Shanghai' }
  };
  const upgraded = migrateStoredConfig(v4Config({
    profile: { activeProfileId: null, profiles: [...DEFAULT_PROFILES.filter((p) => p.id !== 'us-west'), custom] }
  }));

  const ids = upgraded.profile.profiles.map((profile) => profile.id);
  assert.ok(ids.includes('my-cafe'));
  assert.ok(ids.includes('us-west'));
  assert.equal(upgraded.profile.activeProfileId, null, 'null 是合法状态，迁移不能把它复活成默认预设');
});

test('新配置（v5）一条都不加：迁移只对旧版本生效', () => {
  const current = normalizeConfig(DEFAULT_CONFIG);
  const removedBuiltins = current.rules.filter((rule) => rule.domain !== 'ipinfo.io');
  const mahrem = normalizeConfig({ ...current, rules: removedBuiltins });
  assert.deepEqual(migrateStoredConfig(mahrem).rules, mahrem.rules);
});

test('迁移后的配置能过 validateConfig，且白名单不与内置项重复', () => {
  const upgraded = migrateStoredConfig(v4Config());
  const result = validateConfig(upgraded);
  assert.equal(result.ok, true, result.errors.join(' | '));
  const domains = upgraded.rules.map((rule) => rule.domain);
  assert.equal(new Set(domains).size, domains.length, '迁移不得引入重复域名');
});

test('两个静态清单不许各写一份：JSON 里的站必须都在默认规则里', () => {
  // default-domains.json 是 release 烘焙和文档的唯一来源，BUILTIN_DOMAINS_V5 是
  // 迁移清单。两者对不上就会出现「文档说有、装上没有」或反之。
  for (const domain of BUILTIN_DOMAINS_V5) {
    assert.ok(DEFAULT_RULE_DOMAINS.includes(domain), `默认规则缺 ${domain}`);
  }
  assert.equal(DEFAULT_RULE_DOMAINS.length, LEGACY_DOMAINS.length + BUILTIN_DOMAINS_V5.length);
});

test('存储层入口 migrateLegacyConfig 走同一条升级路', () => {
  const stored = v4Config();
  const upgraded = migrateLegacyConfig({ [SITE_CONFIG_KEY]: stored });
  assert.equal(upgraded.rules.length, LEGACY_DOMAINS.length + BUILTIN_DOMAINS_V5.length);
  assert.ok(upgraded.profile.profiles.some((profile) => profile.id === 'us-west'));
});
test('同一份存量配置读两次，规则 id 与整体签名都必须一样', () => {
  // 迁移发生在每次读取上、结果不写回存储，所以 id 必须是确定的：
  // 随机 id 会让 applyConfig 的 JSON 签名去重永不命中（一次保存应用两遍）。
  // 同一份输入（`v4Config()` 自己建规则时也带随机 id，所以要复用同一个对象）
  const stored = v4Config();
  const first = migrateStoredConfig(stored);
  const second = migrateStoredConfig(stored);
  assert.deepEqual(first.rules, second.rules);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const backfilled = first.rules.slice(LEGACY_DOMAINS.length);
  assert.deepEqual(backfilled.map((rule) => rule.id), BUILTIN_DOMAINS_V5.map((domain) => `v5-${domain}`));
  assert.equal(new Set(first.rules.map((rule) => rule.id)).size, first.rules.length);
});
