import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentScriptMatches,
  getEffectiveProfile,
  migrateLegacyConfig,
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
});

test('fresh migration seeds default rules so IP-following signals can inject', () => {
  const config = migrateLegacyConfig({});
  const profile = getEffectiveProfile(config, 'chatgpt.com', {
    latitude: 35.68,
    longitude: 139.76,
    country: 'Japan',
    timezone: 'Asia/Tokyo'
  });

  assert.ok(config.rules.length > 0);
  assert.equal(profile.matched, true);
  assert.equal(profile.payload?.geolocation?.latitude, 35.68);
  assert.equal(profile.payload?.geolocation?.longitude, 139.76);
  assert.equal(profile.payload?.timezone, 'Asia/Tokyo');
  assert.equal(profile.payload?.timezoneSource, 'lastLocation');
});

test('migration repairs previous empty-rule auto config once', () => {
  const brokenAutoConfig = normalizeConfig({ rules: [] });

  assert.ok(migrateLegacyConfig({ siteSpoofConfig: brokenAutoConfig }).rules.length > 0);
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

test('getEffectiveProfile resolves matching rule against lastLocation', () => {
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
    rules: [
      {
        id: 'r1',
        domain: 'example.com',
        enabled: true,
        overrides: {
          language: { mode: 'override', value: { language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' } },
          timezone: { mode: 'inherit', value: null },
          geolocation: { mode: 'inherit', value: null }
        }
      }
    ]
  });

  const profile = getEffectiveProfile(config, 'sub.example.com', {
    latitude: 35.68,
    longitude: 139.76,
    country: 'Japan',
    timezone: 'Asia/Tokyo'
  });

  assert.equal(profile.matched, true);
  assert.equal(profile.rule?.domain, 'example.com');
  assert.equal(profile.payload?.languageConfig?.language, 'ja-JP');
  assert.equal(profile.payload?.timezone, 'Asia/Tokyo');
  assert.equal(profile.payload?.timezoneSource, 'lastLocation');
  assert.equal(profile.payload?.geolocation?.country, 'Japan');
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

test('getContentScriptMatches returns only enabled allowlist patterns', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'example.com', enabled: true },
      { domain: 'disabled.example', enabled: false },
      { domain: 'localhost', enabled: true }
    ] as any
  });

  assert.deepEqual(getContentScriptMatches(config), [
    '*://example.com/*',
    '*://*.example.com/*',
    '*://localhost/*'
  ]);
});
