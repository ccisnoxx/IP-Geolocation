import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { buildAcceptLanguageRules, buildStaticAcceptLanguageRules, updateAcceptLanguageRules } from '../src/background/dnr';
import { normalizeConfig } from '../src/shared/config-model';

const LOCATION = {
  latitude: 37.77,
  longitude: -122.42,
  country: 'United States',
  timezone: 'America/Los_Angeles',
  timezoneOffset: -7,
  updateTime: '2026-01-01 00:00:00'
};


test('buildAcceptLanguageRules creates per-domain header rules from effective language', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: 'en-US',
        languages: ['en-US', 'en'],
        acceptLanguage: 'en-US,en;q=0.9'
      }
    } as any,
    rules: [
      {
        id: 'global-language',
        domain: 'example.com',
        enabled: true,
        overrides: {
          language: { mode: 'inherit', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'override-language',
        domain: 'example.org',
        enabled: true,
        overrides: {
          language: { mode: 'override', value: { language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'ja-JP,ja;q=0.9' } },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'disabled-language',
        domain: 'example.net',
        enabled: true,
        overrides: {
          language: { mode: 'disable', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      }
    ]
  });

  const rules = buildAcceptLanguageRules(config, LOCATION);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, 1100);
  assert.equal(rules[0].action.requestHeaders?.[0].value, 'en-US,en;q=0.9');
  assert.equal(rules[1].action.requestHeaders?.[0].value, 'ja-JP,ja;q=0.9');
  assert.deepEqual(rules[0].condition.requestDomains, ['example.com']);
  assert.equal(rules[0].condition.regexFilter, undefined);
});

// ── 静态 ruleset（烘焙构建）────────────────────────────────────────────────

function staticRulesetConfig(acceptLanguage = 'en-US,en;q=0.9') {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: 'en-US',
        languages: ['en-US', 'en'],
        acceptLanguage
      }
    } as any,
    rules: [
      {
        id: 'static-language',
        domain: 'example.com',
        enabled: true,
        overrides: {
          language: { mode: 'inherit', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      }
    ]
  });
}

function fakeChrome(calls: string[], dynamicRules: any[] = []) {
  return {
    declarativeNetRequest: {
      getEnabledRulesets: async () => ['baked-language'],
      getDynamicRules: async () => dynamicRules,
      updateDynamicRules: async () => { calls.push('updateDynamicRules'); },
      updateEnabledRulesets: async () => { calls.push('updateEnabledRulesets'); }
    }
  } as any;
}

test('buildStaticAcceptLanguageRules 从 1 开始编号，内容与动态规则一致', () => {
  const config = staticRulesetConfig();
  const dynamic = buildAcceptLanguageRules(config, LOCATION);
  const statics = buildStaticAcceptLanguageRules(config, LOCATION);

  assert.deepEqual(statics.map((rule) => rule.id), [1]);
  assert.deepEqual(statics[0].condition.requestDomains, dynamic[0].condition.requestDomains);
  assert.deepEqual(statics[0].action, dynamic[0].action);
});

test('静态规则集覆盖配置时不写动态规则', async () => {
  const config = staticRulesetConfig();
  (globalThis as any).__VANISHGEO_STATIC_RULES__ = buildStaticAcceptLanguageRules(config, LOCATION);
  const calls: string[] = [];
  (globalThis as any).chrome = fakeChrome(calls);

  await updateAcceptLanguageRules(config, LOCATION);

  assert.deepEqual(calls, []);
  delete (globalThis as any).__VANISHGEO_STATIC_RULES__;
});

test('配置改过之后禁用静态规则集，改用动态规则', async () => {
  const baked = staticRulesetConfig();
  (globalThis as any).__VANISHGEO_STATIC_RULES__ = buildStaticAcceptLanguageRules(baked, LOCATION);
  const calls: string[] = [];
  (globalThis as any).chrome = fakeChrome(calls);

  await updateAcceptLanguageRules(staticRulesetConfig('ja-JP,ja;q=0.9'), LOCATION);

  assert.deepEqual(calls, ['updateEnabledRulesets', 'updateDynamicRules']);
  delete (globalThis as any).__VANISHGEO_STATIC_RULES__;
});

test('静态规则集已被禁用后直接走动态规则', async () => {
  const config = staticRulesetConfig();
  (globalThis as any).__VANISHGEO_STATIC_RULES__ = buildStaticAcceptLanguageRules(config, LOCATION);
  const calls: string[] = [];
  (globalThis as any).chrome = fakeChrome(calls);
  (globalThis as any).chrome.declarativeNetRequest.getEnabledRulesets = async () => [];

  await updateAcceptLanguageRules(config, LOCATION);

  assert.deepEqual(calls, ['updateDynamicRules']);
  delete (globalThis as any).__VANISHGEO_STATIC_RULES__;
});

test('auto 时区拿不到定位时，Accept-Language 照样发（语言不依赖定位）', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: true, mode: 'preset', language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { enabled: false }
    },
    rules: [{ domain: 'claude.ai', enabled: true }]
  } as any);

  // 定位还没回来：时区解析不出来，但语言是确定的 —— 头必须发，否则就会出现
  // 「请求头 zh-CN、页面 en-US」这种一眼可查的矛盾（真机实测踩过）
  const rules = buildAcceptLanguageRules(config, null);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action.requestHeaders?.[0].value, 'en-US,en;q=0.9');
  assert.deepEqual(rules[0].condition.requestDomains, ['claude.ai']);
  assert.equal(buildStaticAcceptLanguageRules(config, null).length, 1);

  // 注入侧：语言注入，时区留空（页面不会拿到假的时区）
  const profile = getEffectiveProfile(config, 'claude.ai', null);
  assert.equal(profile.matched, true);
  assert.equal(profile.payload?.languageConfig?.language, 'en-US');
  assert.equal(profile.payload?.timezone, null);
  assert.ok(profile.errors.some((error) => error.includes('timezone')));

  // 语言都关掉时才是真的什么都不发
  const languageOff = normalizeConfig({
    ...config,
    globalProfile: { ...config.globalProfile, language: { enabled: false, mode: 'preset', language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' } }
  });
  assert.deepEqual(buildAcceptLanguageRules(languageOff, null), []);

  // 拿到定位之后按解析出来的时区正常发头
  const located = buildAcceptLanguageRules(config, {
    latitude: 37.77,
    longitude: -122.42,
    country: 'United States',
    timezone: 'America/Los_Angeles',
    timezoneOffset: -7,
    updateTime: '2026-01-01 00:00:00'
  });
  assert.equal(located.length, 1);
  assert.equal(located[0].action.requestHeaders?.[0].value, 'en-US,en;q=0.9');

  // 手动时区不受定位影响
  const manual = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: true, mode: 'preset', language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone: 'America/New_York' },
      geolocation: { enabled: false }
    },
    rules: [{ domain: 'claude.ai', enabled: true }]
  } as any);
  assert.equal(buildAcceptLanguageRules(manual, null).length, 1);
});

test('语言规则覆盖显式排除域，超过 ID 上限时抛错', () => {
  const excluded = normalizeConfig({
    masterEnabled: true,
    globalProfile: { language: { enabled: true, language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' } },
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'mail.example.com', enabled: false }
    ]
  } as any);
  const rules = buildAcceptLanguageRules(excluded, null);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.excludedRequestDomains, ['mail.example.com']);

  const tooMany = normalizeConfig({
    masterEnabled: true,
    globalProfile: { language: { enabled: true, language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' } },
    rules: Array.from({ length: 1001 }, (_, index) => ({ domain: `d${index}.example`, enabled: true }))
  } as any);
  assert.throws(() => buildAcceptLanguageRules(tooMany, null), /Too many Accept-Language rules/);
});

test('updateAcceptLanguageRules：静态规则一致但还有遗留动态规则时清掉', async () => {
  const config = staticRulesetConfig();
  (globalThis as any).__VANISHGEO_STATIC_RULES__ = buildStaticAcceptLanguageRules(config, LOCATION);
  const calls: string[] = [];
  const chrome = fakeChrome(calls);
  chrome.declarativeNetRequest.getDynamicRules = async () => [{ id: 1100 }];
  chrome.declarativeNetRequest.updateDynamicRules = async (details: any) => { calls.push(`remove:${details.removeRuleIds.length}`); };
  (globalThis as any).chrome = chrome;

  await updateAcceptLanguageRules(config, LOCATION);
  assert.deepEqual(calls, ['remove:1000']);
  delete (globalThis as any).__VANISHGEO_STATIC_RULES__;
});

test('updateAcceptLanguageRules：动态规则已经一致时不重复写', async () => {
  const config = staticRulesetConfig();
  const dynamic = buildAcceptLanguageRules(config, LOCATION);
  const calls: string[] = [];
  const chrome = fakeChrome(calls, dynamic);
  chrome.declarativeNetRequest.getEnabledRulesets = async () => [];
  (globalThis as any).chrome = chrome;

  await updateAcceptLanguageRules(config, LOCATION);
  assert.deepEqual(calls, []);
});

test('updateAcceptLanguageRules：没有 API 或 ruleset 查询失败时安全退化', async () => {
  const config = staticRulesetConfig();
  (globalThis as any).chrome = {};
  await updateAcceptLanguageRules(config, LOCATION);

  const calls: string[] = [];
  const chrome = fakeChrome(calls);
  chrome.declarativeNetRequest.getEnabledRulesets = async () => { throw new Error('not ready'); };
  (globalThis as any).chrome = chrome;
  (globalThis as any).__VANISHGEO_STATIC_RULES__ = buildStaticAcceptLanguageRules(config, LOCATION);
  await updateAcceptLanguageRules(config, LOCATION);
  assert.deepEqual(calls, ['updateDynamicRules']);
  delete (globalThis as any).__VANISHGEO_STATIC_RULES__;
});
