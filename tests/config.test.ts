import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentScriptMatches,
  getEffectiveProfile,
  migrateLegacyConfig,
  validateConfig
} from '../src/shared/config-resolver';
import { DEFAULT_CONFIG, DEFAULT_GEOLOCATION, DEFAULT_LANGUAGE, DEFAULT_RULE_DOMAINS, DEFAULT_TIMEZONE, DEFAULT_WEBRTC, normalizeConfig } from '../src/shared/config-model';
import { applyProfileToConfig } from '../src/shared/profile';

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

test('getContentScriptMatches 跳过已烘焙进 manifest 的域名', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'claude.ai', enabled: true },
      { domain: 'example.com', enabled: true }
    ]
  });

  const matches = getContentScriptMatches(config, ['claude.ai']);
  assert.ok(matches.every((pattern) => !pattern.includes('claude.ai')));
  assert.ok(matches.some((pattern) => pattern.includes('example.com')));

  // 全部被烘焙覆盖时不给浏览器重复注册
  assert.deepEqual(getContentScriptMatches(config, ['claude.ai', 'example.com']), []);
});

test('默认就是英文 en-US，时区跟着出口 IP（auto），默认 persona 是美国', () => {
  assert.equal(DEFAULT_LANGUAGE.language, 'en-US');
  assert.deepEqual(DEFAULT_LANGUAGE.languages, ['en-US', 'en']);
  assert.equal(DEFAULT_LANGUAGE.acceptLanguage, 'en-US,en;q=0.9');

  // 时区不在默认值里写死：auto + 空字符串 = 由后台按出口 IP 推导
  assert.equal(DEFAULT_CONFIG.globalProfile.timezone.mode, 'auto');
  assert.equal(DEFAULT_CONFIG.globalProfile.timezone.timezone, '');
  assert.equal(DEFAULT_CONFIG.profile.activeProfileId, 'united-states');

  // 手动点了美国 persona，才把时区钉成纽约（语言仍是 en-US）
  const applied = applyProfileToConfig(DEFAULT_CONFIG, 'united-states');
  assert.equal(applied.globalProfile.language.language, 'en-US');
  assert.equal(applied.globalProfile.timezone.timezone, 'America/New_York');
});

test('首次安装就带默认白名单（装上即生效）', () => {
  const fresh = migrateLegacyConfig({});

  assert.deepEqual(fresh.rules.map((rule) => rule.domain), DEFAULT_RULE_DOMAINS);
  assert.ok(fresh.rules.every((rule) => rule.enabled));
  assert.ok(fresh.rules.every((rule) => rule.overrides.language.mode === 'inherit'));

  // 老版本只有标量配置、没有白名单概念：迁移时同样种上，避免"装了但什么都不生效"
  const legacy = migrateLegacyConfig({ extensionEnabled: true, language: { language: 'ja-JP' } });
  assert.equal(legacy.rules.length, DEFAULT_RULE_DOMAINS.length);
});

test("canvas 三层默认值：平台自动、中文表开、手动层为空", () => {
  const fresh = normalizeConfig({ canvas: { enabled: true } });
  assert.equal(fresh.canvas.platform, 'auto');
  assert.equal(fresh.canvas.hideCjkFonts, true);
  assert.deepEqual(fresh.canvas.targetFonts, []);
  assert.equal(fresh.canvas.spoofFonts, true);

  // 非法平台值回落到默认，不会被存进配置
  const bogus = normalizeConfig({ canvas: { enabled: true, platform: 'beos' as any } });
  assert.equal(bogus.canvas.platform, 'auto');

  // 中文层显式关闭 + 手动层给一条：最终只有那一条
  const manual = normalizeConfig({ canvas: { enabled: true, platform: 'none', hideCjkFonts: false, targetFonts: ['SimSun'] } });
  assert.equal(manual.canvas.hideCjkFonts, false);
  assert.deepEqual(manual.canvas.targetFonts, ['SimSun']);
});
