const test = require('node:test');
const assert = require('node:assert/strict');

const IPGeoConfig = require('../config');

test('validateConfig rejects duplicate domains', () => {
  const result = IPGeoConfig.validateConfig({
    masterEnabled: true,
    globalProfile: {
      language: IPGeoConfig.DEFAULT_LANGUAGE,
      timezone: IPGeoConfig.DEFAULT_TIMEZONE,
      geolocation: IPGeoConfig.DEFAULT_GEOLOCATION
    },
    webRtc: IPGeoConfig.DEFAULT_WEBRTC,
    rules: [
      { domain: 'example.com' },
      { domain: 'example.com' }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' | '), /duplicate domain/);
});

test('getEffectiveProfile resolves matching rule against lastLocation', () => {
  const config = IPGeoConfig.normalizeConfig({
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
    },
    webRtc: {
      globalMode: 'strict'
    },
    rules: [
      {
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

  const profile = IPGeoConfig.getEffectiveProfile(config, 'sub.example.com', {
    latitude: 35.68,
    longitude: 139.76,
    country: 'Japan',
    timezone: 'Asia/Tokyo'
  });

  assert.equal(profile.matched, true);
  assert.equal(profile.rule.domain, 'example.com');
  assert.equal(profile.payload.languageConfig.language, 'ja-JP');
  assert.equal(profile.payload.timezone, 'Asia/Tokyo');
  assert.equal(profile.payload.timezoneSource, 'lastLocation');
  assert.equal(profile.payload.geolocation.country, 'Japan');
});

test('migrateLegacyConfig preserves legacy enabled flags', () => {
  const migrated = IPGeoConfig.migrateLegacyConfig({
    extensionEnabled: false,
    languageConfig: {
      enabled: false,
      language: 'en-US',
      languages: ['en-US'],
      acceptLanguage: 'en-US'
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual',
      timezone: 'UTC'
    },
    webRtcConfig: {
      globalMode: 'off'
    }
  });

  assert.equal(migrated.masterEnabled, false);
  assert.equal(migrated.globalProfile.language.enabled, false);
  assert.equal(migrated.globalProfile.timezone.timezone, 'UTC');
  assert.equal(migrated.webRtc.globalMode, 'default');
});

test('normalizeWebRtc accepts default and legacy off alias', () => {
  assert.equal(IPGeoConfig.normalizeWebRtc({ globalMode: 'default' }).globalMode, 'default');
  assert.equal(IPGeoConfig.normalizeWebRtc({ globalMode: 'off' }).globalMode, 'default');
  assert.equal(IPGeoConfig.normalizeWebRtc({ globalMode: 'compatible' }).globalMode, 'compatible');
  assert.equal(IPGeoConfig.normalizeWebRtc({ globalMode: 'strict' }).globalMode, 'strict');
});

test('getContentScriptMatches only returns enabled allowlist patterns when master switch is on', () => {
  const config = IPGeoConfig.normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'example.com', enabled: true },
      { domain: 'disabled.example', enabled: false },
      { domain: 'localhost', enabled: true }
    ]
  });

  assert.deepEqual(IPGeoConfig.getContentScriptMatches(config), [
    '*://example.com/*',
    '*://*.example.com/*',
    '*://localhost/*'
  ]);
  assert.equal(IPGeoConfig.isUrlMatchedByEnabledRule(config, 'https://sub.example.com/path'), true);
  assert.equal(IPGeoConfig.isUrlMatchedByEnabledRule(config, 'https://disabled.example/path'), false);
});

test('getContentScriptMatches returns empty list when master switch is off', () => {
  const config = IPGeoConfig.normalizeConfig({
    masterEnabled: false,
    rules: [
      { domain: 'example.com', enabled: true }
    ]
  });

  assert.deepEqual(IPGeoConfig.getContentScriptMatches(config), []);
  assert.equal(IPGeoConfig.isUrlMatchedByEnabledRule(config, 'https://example.com/'), false);
});
