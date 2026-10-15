import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentScriptMatches,
  getEffectiveProfile,
  migrateLegacyConfig,
  repairInvalidRuleDomains,
  validateConfig
} from '../src/shared/config-resolver';
import {
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC,
  RULES_INITIALIZED_KEY,
  normalizeConfig
} from '../src/shared/config-model';

test('default config uses IP-following mode without regional presets', () => {
  const config = normalizeConfig({});

  assert.equal(config.globalProfile.geolocation.mode, 'auto');
  assert.equal(config.globalProfile.timezone.mode, 'auto');
  assert.equal(config.globalProfile.language.enabled, false);
  assert.equal(config.profile.activeProfileId, null);
  assert.deepEqual(config.profile.profiles, []);
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.exitLocationProfiles, []);
  assert.ok(config.rules.every((rule) => rule.exitLocationProfileId === null));
});

test('空存储首次建档安全关闭、空规则和 browser default，重复迁移保持', () => {
  const config = migrateLegacyConfig({});
  const profile = getEffectiveProfile(config, 'chatgpt.com');

  assert.equal(config.masterEnabled, false);
  assert.equal(config.webRtc.globalMode, 'default');
  assert.deepEqual(config.rules, []);
  assert.deepEqual(getContentScriptMatches(config), []);
  assert.equal(profile.matched, false);
  assert.equal(profile.payload, null);
  assert.deepEqual(profile.errors, []);
  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: config }), config);
});

test('legacy lastLocation becomes one visible unverified profile without rule bindings', () => {
  const storageData = {
    siteSpoofConfig: { ...normalizeConfig({}), schemaVersion: 1 },
    lastLocation: {
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: 'Asia/Tokyo'
    }
  };
  const migrated = migrateLegacyConfig(storageData);
  const repeated = migrateLegacyConfig({ siteSpoofConfig: migrated, lastLocation: storageData.lastLocation });

  assert.deepEqual(migrated.exitLocationProfiles, [{
    id: 'legacy-last-location',
    name: '待确认旧位置',
    verification: 'unverified',
    publicIp: null,
    latitude: 35.68,
    longitude: 139.76,
    country: 'Japan',
    timezone: 'Asia/Tokyo',
    provider: null,
    verifiedAt: null
  }]);
  assert.ok(migrated.rules.every((rule) => rule.exitLocationProfileId === null));
  assert.equal(repeated.exitLocationProfiles.length, 1);
});

test('历史空规则修补仅用于旧schema，不覆盖已有v2，即使缺少初始化标记', () => {
  const brokenAutoConfig = normalizeConfig({ rules: [] });

  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: brokenAutoConfig }), brokenAutoConfig);
  assert.ok(migrateLegacyConfig({ siteSpoofConfig: { ...brokenAutoConfig, schemaVersion: 1 } }).rules.length > 0);
  assert.equal(migrateLegacyConfig({
    siteSpoofConfig: brokenAutoConfig,
    [RULES_INITIALIZED_KEY]: true
  }).rules.length, 0);
});

test('validateConfig rejects duplicate domains', () => {
  const result = validateConfig({
    masterEnabled: true,
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: DEFAULT_TIMEZONE,
      geolocation: DEFAULT_GEOLOCATION
    },
    webRtc: DEFAULT_WEBRTC,
    rules: [
      { domain: 'example.com' },
      { domain: 'example.com' }
    ] as any
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' | '), /duplicate domain/);
});

test('getEffectiveProfile resolves a rule against its verified exit profile', () => {
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
      timezone: {
        enabled: true,
        mode: 'auto',
        timezone: ''
      },
      geolocation: {
        enabled: true,
        mode: 'auto'
      }
    } as any,
    webRtc: {
      globalMode: 'strict'
    },
    exitLocationProfiles: [
      {
        id: 'tokyo-exit',
        name: '东京出口',
        verification: 'verified',
        publicIp: '203.0.113.10',
        latitude: 35.68,
        longitude: 139.76,
        country: 'Japan',
        timezone: 'Asia/Tokyo',
        provider: 'ipwho.is',
        verifiedAt: 1_700_000_000_000
      }
    ],
    rules: [
      {
        id: 'r1',
        domain: 'example.com',
        enabled: true,
        exitLocationProfileId: 'tokyo-exit',
        overrides: {
          language: { mode: 'override', value: { language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' } },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      }
    ]
  });

  const profile = getEffectiveProfile(config, 'sub.example.com');

  assert.equal(profile.matched, true);
  assert.equal(profile.rule?.domain, 'example.com');
  assert.equal(profile.payload?.languageConfig?.language, 'ja-JP');
  assert.equal(profile.payload?.timezone, 'Asia/Tokyo');
  assert.equal(profile.payload?.timezoneSource, 'exitProfile');
  assert.equal(profile.payload?.geolocation?.country, 'Japan');
});

test('different rules resolve different explicit exit profiles without a global fallback', () => {
  const config = normalizeConfig({
    globalProfile: {
      language: { enabled: false },
      timezone: { enabled: true, mode: 'auto' },
      geolocation: { enabled: true, mode: 'auto' }
    } as any,
    exitLocationProfiles: [
      {
        id: 'tokyo-exit',
        name: '东京出口',
        verification: 'verified',
        publicIp: '203.0.113.10',
        latitude: 35.68,
        longitude: 139.76,
        country: 'Japan',
        timezone: 'Asia/Tokyo',
        provider: 'ipwho.is',
        verifiedAt: 1_700_000_000_000
      },
      {
        id: 'singapore-exit',
        name: '新加坡出口',
        verification: 'verified',
        publicIp: '203.0.113.20',
        latitude: 1.3521,
        longitude: 103.8198,
        country: 'Singapore',
        timezone: 'Asia/Singapore',
        provider: 'ipapi.co',
        verifiedAt: 1_700_000_100_000
      }
    ],
    rules: [
      { id: 'r-tokyo', domain: 'tokyo.example', enabled: true, exitLocationProfileId: 'tokyo-exit' },
      { id: 'r-singapore', domain: 'singapore.example', enabled: true, exitLocationProfileId: 'singapore-exit' },
      { id: 'r-unbound', domain: 'unbound.example', enabled: true, exitLocationProfileId: null }
    ] as any
  });

  const tokyo = getEffectiveProfile(config, 'tokyo.example');
  const singapore = getEffectiveProfile(config, 'singapore.example');
  const unbound = getEffectiveProfile(config, 'unbound.example');

  assert.equal(tokyo.payload?.timezone, 'Asia/Tokyo');
  assert.equal(tokyo.payload?.latitude, 35.68);
  assert.equal(singapore.payload?.timezone, 'Asia/Singapore');
  assert.equal(singapore.payload?.latitude, 1.3521);
  assert.equal(unbound.payload, null);
  assert.match(unbound.errors.join(' | '), /未选择出口位置档案/);
});

test('unverified profiles cannot satisfy auto signals', () => {
  const config = normalizeConfig({
    exitLocationProfiles: [{
      id: 'legacy',
      name: '待确认旧位置',
      verification: 'unverified',
      publicIp: null,
      latitude: 1,
      longitude: 2,
      country: 'Unknown',
      timezone: 'UTC',
      provider: null,
      verifiedAt: null
    }],
    rules: [{
      id: 'r1',
      domain: 'example.com',
      enabled: true,
      exitLocationProfileId: 'legacy'
    }] as any
  });

  const profile = getEffectiveProfile(config, 'example.com');

  assert.equal(profile.payload, null);
  assert.match(profile.errors.join(' | '), /尚未验证/);
});

test('migrateLegacyConfig converts VanishMe bpg_config into siteSpoofConfig rules', () => {
  const migrated = migrateLegacyConfig({
    bpg_config: {
      globalEnabled: true,
      matchMode: 'whitelist',
      domainList: ['*.openai.com', 'chatgpt.com', '*keyword*'],
      language: { enabled: true, language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
      timezone: { enabled: true, timezone: 'UTC' },
      geolocation: { enabled: true, latitude: 1, longitude: 2, accuracy: 50 },
      webrtc: { enabled: true, policy: 'disable_non_proxied_udp' },
      canvas: { enabled: true, spoofFonts: true, targetFonts: ['SimSun'] }
    }
  });

  assert.equal(migrated.masterEnabled, true);
  assert.equal(migrated.globalProfile.timezone.timezone, 'UTC');
  assert.equal(migrated.webRtc.globalMode, 'strict');
  assert.equal(migrated.canvas.enabled, true);
  assert.deepEqual(migrated.rules.map((rule) => rule.domain), ['openai.com', 'chatgpt.com']);
});

test('旧配置合法零坐标迁为 manual，重复迁移保持坐标；缺失或非有限数不冒充零', () => {
  for (const [latitude, longitude] of [[0, 0], [0, 120], [-30, 0]]) {
    const migrated = migrateLegacyConfig({ bpg_config: {
      domainList: ['example.com'], geolocation: { latitude, longitude, accuracy: 50 }
    } });
    const geo = migrated.globalProfile.geolocation;
    assert.equal(geo.mode, 'manual');
    assert.equal(geo.latitude, latitude);
    assert.equal(geo.longitude, longitude);
    assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: migrated, [RULES_INITIALIZED_KEY]: true }), migrated);
  }
  for (const latitude of [null, undefined, '', Number.NaN, Infinity]) {
    const migrated = migrateLegacyConfig({ bpg_config: {
      domainList: ['example.com'], geolocation: { latitude, longitude: 0 }
    } });
    assert.equal(migrated.globalProfile.geolocation.mode, 'auto');
  }
});

test('getContentScriptMatches returns only enabled allowlist patterns', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'example.com', enabled: true },
      { domain: 'disabled.example', enabled: false },
      { domain: 'localhost', enabled: true },
      { domain: '127.0.0.1', enabled: true },
      { domain: 'bad_domain', enabled: true }
    ] as any
  });

  assert.deepEqual(getContentScriptMatches(config), [
    '*://example.com/*',
    '*://*.example.com/*',
    '*://localhost/*',
    '*://127.0.0.1/*'
  ]);
});

test('repairInvalidRuleDomains removes stored rules that Chrome cannot register', () => {
  const repaired = repairInvalidRuleDomains({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'bad_domain', enabled: true },
      { domain: '127.0.0.1', enabled: true }
    ] as any
  });

  assert.equal(repaired.repaired, true);
  assert.deepEqual(repaired.config.rules.map((rule) => rule.domain), ['example.com', '127.0.0.1']);
});
