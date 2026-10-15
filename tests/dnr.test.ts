import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptLanguageRules } from '../src/background/dnr';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { normalizeConfig } from '../src/shared/config-model';

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
      },
      timezone: { enabled: false, mode: 'auto', timezone: '' },
      geolocation: { enabled: false, mode: 'auto' }
    } as any,
    rules: [
      {
        id: 'global-language',
        domain: 'example.com',
        enabled: true,
        exitLocationProfileId: null,
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
        exitLocationProfileId: null,
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
        exitLocationProfileId: null,
        overrides: {
          language: { mode: 'disable', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'invalid-domain',
        domain: 'bad_domain',
        enabled: true,
        exitLocationProfileId: null,
        overrides: {
          language: { mode: 'inherit', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'localhost',
        domain: 'localhost',
        enabled: true,
        exitLocationProfileId: null,
        overrides: {
          language: { mode: 'inherit', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'local-ip',
        domain: '127.0.0.1',
        enabled: true,
        exitLocationProfileId: null,
        overrides: {
          language: { mode: 'inherit', value: null },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      }
    ]
  });

  const rules = buildAcceptLanguageRules(config);

  assert.equal(rules.length, 4);
  assert.equal(rules[0].id, 1100);
  assert.equal(rules[0].action.requestHeaders?.[0].value, 'en-US,en;q=0.9');
  assert.equal(rules[1].action.requestHeaders?.[0].value, 'ja-JP,ja;q=0.9');
  assert.match(String(rules[0].condition.regexFilter), /example\\\.com/);
  assert.equal(rules.some((rule) => String(rule.condition.regexFilter).includes('bad_domain')), false);
  assert.equal(String(rules[2].condition.regexFilter), '^https?://localhost(?::[0-9]+)?/');
  assert.equal(String(rules[3].condition.regexFilter), '^https?://127\\.0\\.0\\.1(?::[0-9]+)?/');

  const inheritedPayload = getEffectiveProfile(config, 'sub.example.com').payload;
  const overridePayload = getEffectiveProfile(config, 'example.org').payload;
  assert.equal(rules[0].action.requestHeaders?.[0].value, inheritedPayload?.languageConfig?.acceptLanguage);
  assert.equal(rules[1].action.requestHeaders?.[0].value, overridePayload?.languageConfig?.acceptLanguage);
});

test('DNR 观测相同规则不重复写入，替换只管理自身 ID 区间', async () => {
  const { updateAcceptLanguageRules } = await import('../src/background/dnr');
  const original = (globalThis as any).chrome;
  const config = normalizeConfig({ globalProfile: { language: { enabled: true } } as any, rules: [{ id: 'r', domain: 'example.test' }] as any });
  const foreign = { id: 7, action: { type: 'block' }, condition: { urlFilter: 'foreign' } } as chrome.declarativeNetRequest.Rule;
  let rules = [foreign]; let writes = 0;
  (globalThis as any).chrome = { declarativeNetRequest: {
    MAX_NUMBER_OF_REGEX_RULES: 1000, MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000,
    getDynamicRules: async () => rules, getSessionRules: async () => [],
    updateDynamicRules: async ({ removeRuleIds, addRules }: chrome.declarativeNetRequest.UpdateRuleOptions) => {
      writes += 1; assert.ok(removeRuleIds?.every((id) => id >= 1100 && id <= 2099));
      rules = rules.filter((rule) => !removeRuleIds?.includes(rule.id)).concat(addRules || []);
    }
  } };
  try {
    await updateAcceptLanguageRules(config);
    rules = rules.reverse().map((rule) => rule.id === 7 ? rule : ({ condition: rule.condition, action: rule.action, id: rule.id, priority: rule.priority }));
    await updateAcceptLanguageRules(config);
    assert.equal(writes, 1); assert.ok(rules.some((rule) => rule.id === 7));
    await updateAcceptLanguageRules({ ...config, masterEnabled: false });
    assert.deepEqual(rules, [foreign]);
  } finally { (globalThis as any).chrome = original; }
});

test('DNR 预检涵盖外部 regex、unsafe 额度和 Chrome119 combined session 额度', async () => {
  const { validateAcceptLanguageCapacity } = await import('../src/background/dnr');
  const original = (globalThis as any).chrome;
  const config = normalizeConfig({ globalProfile: { language: { enabled: true } } as any, rules: [{ id: 'r', domain: 'example.test' }] as any });
  const foreign = { id: 7, action: { type: 'modifyHeaders' }, condition: { regexFilter: 'foreign' } };
  const api: any = {
    MAX_NUMBER_OF_REGEX_RULES: 1, MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 1,
    getDynamicRules: async () => [foreign], getSessionRules: async () => [], updateDynamicRules: async () => {}
  };
  (globalThis as any).chrome = { declarativeNetRequest: api };
  try {
    await assert.rejects(validateAcceptLanguageCapacity(config), /正则规则/);
    api.MAX_NUMBER_OF_REGEX_RULES = 1000;
    await assert.rejects(validateAcceptLanguageCapacity(config), /动态及会话/);
    api.MAX_NUMBER_OF_DYNAMIC_RULES = 30000; api.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES = 1;
    await assert.rejects(validateAcceptLanguageCapacity(config), /请求头规则/);
    delete api.MAX_NUMBER_OF_DYNAMIC_RULES; delete api.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES;
    api.getDynamicRules = async () => []; api.getSessionRules = async () => [foreign];
    await assert.rejects(validateAcceptLanguageCapacity(config), /动态及会话/);
  } finally { (globalThis as any).chrome = original; }
});
