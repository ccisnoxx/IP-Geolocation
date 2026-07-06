import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptLanguageRules } from '../src/background/dnr';
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

  const rules = buildAcceptLanguageRules(config);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, 1100);
  assert.equal(rules[0].action.requestHeaders?.[0].value, 'en-US,en;q=0.9');
  assert.equal(rules[1].action.requestHeaders?.[0].value, 'ja-JP,ja;q=0.9');
  assert.match(String(rules[0].condition.regexFilter), /example\\\.com/);
});
