import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBakedPayload } from '../src/injected/baked-resolver';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import {
  DEFAULT_CANVAS,
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_WEBRTC,
  normalizeConfig
} from '../src/shared/config-model';
import type { LastLocation, SiteSpoofConfig } from '../src/shared/types';

const lastLocation: LastLocation = {
  latitude: 35.6762,
  longitude: 139.6503,
  country: 'Japan',
  timezone: 'Asia/Tokyo',
  updateTime: '2026-01-01 00:00:00'
};

function config(overrides: Partial<SiteSpoofConfig> = {}): SiteSpoofConfig {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { ...DEFAULT_LANGUAGE, language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: false, mode: 'auto' }
    },
    webRtc: DEFAULT_WEBRTC,
    canvas: { ...DEFAULT_CANVAS, enabled: false },
    rules: [
      { id: 'a', domain: 'claude.ai', enabled: true },
      { id: 'b', domain: 'api.anthropic.com', enabled: true }
    ],
    ...overrides
  } as any);
}

function pickPayload(payload: any) {
  if (!payload) return null;
  return {
    hostname: payload.hostname,
    timezone: payload.timezone,
    language: payload.languageConfig ? payload.languageConfig.language : null,
    languages: payload.languageConfig ? payload.languageConfig.languages : null,
    acceptLanguage: payload.languageConfig ? payload.languageConfig.acceptLanguage : null,
    latitude: payload.geolocation ? payload.geolocation.latitude : null,
    longitude: payload.geolocation ? payload.geolocation.longitude : null,
    geolocationDenied: Boolean(payload.geolocationDenied),
    canvasEnabled: payload.canvasConfig ? payload.canvasConfig.enabled : null
  };
}

test('baked resolver matches getEffectiveProfile for inherited rules', () => {
  const source = config();
  for (const host of ['claude.ai', 'console.claude.ai', 'api.anthropic.com', 'example.com']) {
    const expected = pickPayload(getEffectiveProfile(source, host, lastLocation).payload);
    const actual = pickPayload(resolveBakedPayload(source, host, lastLocation));
    assert.deepEqual(actual, expected, `host ${host}`);
  }
});

test('baked resolver matches getEffectiveProfile for explicit overrides', () => {
  const source = config({
    rules: [
      {
        id: 'a',
        domain: 'claude.ai',
        enabled: true,
        overrides: {
          language: {
            mode: 'override',
            value: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' }
          },
          timezone: { mode: 'override', value: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' } },
          geolocation: { mode: 'disable', value: null }
        }
      }
    ]
  } as any);

  for (const host of ['claude.ai', 'claude.ai.evil.com']) {
    const expected = pickPayload(getEffectiveProfile(source, host, lastLocation).payload);
    const actual = pickPayload(resolveBakedPayload(source, host, lastLocation));
    assert.deepEqual(actual, expected, `host ${host}`);
  }
});

test('baked resolver falls back to lastLocation timezone when mode is auto', () => {
  const source = config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: true, mode: 'auto' }
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }]
  } as any);

  const expected = pickPayload(getEffectiveProfile(source, 'claude.ai', lastLocation).payload);
  const actual = pickPayload(resolveBakedPayload(source, 'claude.ai', lastLocation));
  assert.deepEqual(actual, expected);
  assert.equal(actual?.timezone, 'Asia/Tokyo');
  assert.equal(actual?.latitude, lastLocation.latitude);
});

test('baked resolver returns null when the extension is disabled or the host does not match', () => {
  assert.equal(resolveBakedPayload(config({ masterEnabled: false }), 'claude.ai', lastLocation), null);
  assert.equal(resolveBakedPayload(config(), 'not-claude.ai', lastLocation), null);
  assert.equal(resolveBakedPayload(null, 'claude.ai', lastLocation), null);
});
test('baked resolver marks geolocation deny when auto has no location', () => {
  const source = config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: true, mode: 'auto' }
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }]
  } as any);

  const expected = pickPayload(getEffectiveProfile(source, 'claude.ai', null).payload);
  const actual = resolveBakedPayload(source, 'claude.ai', null);
  assert.deepEqual(pickPayload(actual), expected);
  assert.equal(actual?.geolocationDenied, true);
  assert.equal(actual?.geolocation, null);
});

test('baked resolver 分支：host 归一化、空 host 和无效规则', () => {
  const source = config({ rules: [
    { id: 'a', domain: 'claude.ai', enabled: true } as any,
    { id: 'bad', domain: '' as any, enabled: true } as any,
    null as any
  ] });
  assert.equal(resolveBakedPayload(source, '', lastLocation), null);
  assert.equal(resolveBakedPayload(source, '   ', lastLocation), null);
  const trailing = resolveBakedPayload(source, 'CLAUDE.AI...', lastLocation);
  assert.equal(trailing?.hostname, 'claude.ai');
  assert.equal(trailing?.ruleId, 'a');
  assert.equal(resolveBakedPayload({ ...source, rules: undefined } as any, 'claude.ai', lastLocation), null);
});

test('baked resolver 分支：最长规则优先，disabled 规则显式排除', () => {
  const source = config({ rules: [
    { id: 'parent', domain: 'claude.ai', enabled: true } as any,
    { id: 'child', domain: 'console.claude.ai', enabled: false } as any
  ] });
  assert.equal(resolveBakedPayload(source, 'claude.ai', lastLocation)?.ruleId, 'parent');
  assert.equal(resolveBakedPayload(source, 'console.claude.ai', lastLocation), null);
  assert.equal(resolveBakedPayload(source, 'api.console.claude.ai', lastLocation), null);
});

test('baked resolver 分支：语言 override / disable / 空值 / fallback', () => {
  const make = (language: any) => config({
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true, overrides: { language } } as any]
  });
  assert.equal(resolveBakedPayload(make({ mode: 'disable' }), 'claude.ai', lastLocation)?.languageConfig, null);
  assert.equal(resolveBakedPayload(make({ mode: 'override', value: { language: '' } }), 'claude.ai', lastLocation)?.languageConfig, null);
  const fallback = resolveBakedPayload(make({
    mode: 'override',
    value: { language: 'fr-FR', languages: [] }
  }), 'claude.ai', lastLocation);
  assert.deepEqual(fallback?.languageConfig?.languages, ['fr-FR']);
  assert.equal(fallback?.languageConfig?.acceptLanguage, 'fr-FR,fr;q=0.9');

  const globalDisabled = config({ globalProfile: {
    language: { ...DEFAULT_LANGUAGE, enabled: false },
    timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
    geolocation: { ...DEFAULT_GEOLOCATION, enabled: false }
  } as any });
  assert.equal(resolveBakedPayload(globalDisabled, 'claude.ai', lastLocation)?.languageConfig, null);
});

test('baked resolver 分支：时区 override / disable / auto / 全局缺失', () => {
  const make = (timezone: any, global: any = {}) => config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: false },
      ...global
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true, overrides: { timezone } } as any]
  });
  assert.equal(resolveBakedPayload(make({ mode: 'disable' }), 'claude.ai', lastLocation)?.timezoneConfig.enabled, false);
  assert.equal(resolveBakedPayload(make({ mode: 'override', value: { mode: 'manual', timezone: 'Europe/Paris' } }), 'claude.ai', lastLocation)?.timezone, 'Europe/Paris');
  assert.equal(resolveBakedPayload(make({ mode: 'override', value: { mode: 'auto', timezone: '' } }), 'claude.ai', lastLocation)?.timezone, 'Asia/Tokyo');
  const rawNoTimezone = {
    masterEnabled: true,
    globalProfile: { language: DEFAULT_LANGUAGE, geolocation: { ...DEFAULT_GEOLOCATION, enabled: false } },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }] as any
  } as any;
  assert.equal(resolveBakedPayload(rawNoTimezone, 'claude.ai', lastLocation)?.timezoneConfig.enabled, false);
  assert.equal(resolveBakedPayload(make({ mode: 'inherit' }, { timezone: { enabled: false, mode: 'manual', timezone: 'Asia/Tokyo' } }), 'claude.ai', lastLocation)?.timezoneConfig.enabled, false);
});

test('baked resolver 分支：定位 disable / enabled=false / 坐标缺失 / 默认精度', () => {
  const make = (geolocation: any, global: any = {}) => config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: true, mode: 'auto' },
      ...global
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true, overrides: { geolocation } } as any]
  });
  assert.equal(resolveBakedPayload(make({ mode: 'disable' }), 'claude.ai', lastLocation)?.geolocation, null);
  assert.equal(resolveBakedPayload(make({ mode: 'override', value: { enabled: false } }), 'claude.ai', lastLocation)?.geolocation, null);
  const denied = resolveBakedPayload(make({ mode: 'override', value: { enabled: true, mode: 'manual', latitude: '', longitude: null } }), 'claude.ai', lastLocation);
  assert.equal(denied?.geolocationDenied, true);
  assert.equal(denied?.geolocation, null);
  const fallback = resolveBakedPayload(make({ mode: 'override', value: {
    enabled: true, mode: 'manual', latitude: '1.5', longitude: '2.5', accuracy: 'bad',
    randomize: true, randomRadiusMeters: 'bad', spoofPermission: false, country: 'Test'
  } }), 'claude.ai', lastLocation);
  assert.equal(fallback?.geolocation?.accuracy, 50);
  assert.equal(fallback?.geolocation?.randomRadiusMeters, 1000);
  assert.equal(fallback?.geolocation?.spoofPermission, false);
  assert.equal(fallback?.geolocation?.noNativeCall, false, '烘焙包里也要带这道刹车（跟随 spoofPermission）');
  assert.equal(fallback?.geolocation?.country, 'Test');
});

test('baked resolver 分支：canvas 平台 / hideCjk / targetFonts / debug', () => {
  const source = config({
    debugMode: true,
    canvas: { enabled: true, spoofFonts: false, platform: 'windows' as any, hideCjkFonts: false, targetFonts: ['Arial', '', null] as any }
  });
  const payload = resolveBakedPayload(source, 'claude.ai', lastLocation);
  assert.equal(payload?.debugMode, true);
  assert.equal(payload?.canvasConfig.platform, 'auto');
  assert.equal(payload?.canvasConfig.hideCjkFonts, false);
  assert.equal(payload?.canvasConfig.spoofFonts, false);
  assert.deepEqual(payload?.canvasConfig.targetFonts, ['Arial']);

  const none = resolveBakedPayload(config({ canvas: { ...DEFAULT_CANVAS, platform: 'none' } }), 'claude.ai', lastLocation);
  assert.equal(none?.canvasConfig.platform, 'none');
});

test('baked resolver 分支：auto 定位带时区时优先用定位时区', () => {
  const source = config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: true, mode: 'auto' }
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }] as any
  });
  const payload = resolveBakedPayload(source, 'claude.ai', lastLocation);
  assert.equal(payload?.timezone, 'Asia/Tokyo');
  assert.equal(payload?.geolocation?.country, 'Japan');
});
