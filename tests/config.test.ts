import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentScriptMatchesForDomain,
  getContentScriptMatches,
  getContentScriptRegistration,
  getEffectiveLanguage,
  getEffectiveProfile,
  getExcludedDomainsFor,
  isUrlMatchedByEnabledRule,
  migrateLegacyConfig,
  validateConfig
} from '../src/shared/config-resolver';
import {
  DEFAULT_CONFIG,
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_RULE_DOMAINS,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC,
  formatTimezoneOffsetMinutes,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  normalizeGeolocation,
  normalizeWebRtc,
  parseHostname,
  validateTimezone
} from '../src/shared/config-model';
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
  } as any);

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
  const fresh = normalizeConfig({ canvas: { enabled: true } } as any);
  assert.equal(fresh.canvas.platform, 'auto');
  assert.equal(fresh.canvas.hideCjkFonts, true);
  assert.deepEqual(fresh.canvas.targetFonts, []);
  assert.equal(fresh.canvas.spoofFonts, true);

  // 非法平台值回落到默认，不会被存进配置
  const bogus = normalizeConfig({ canvas: { enabled: true, platform: 'beos' as any } } as any);
  assert.equal(bogus.canvas.platform, 'auto');

  // 中文层显式关闭 + 手动层给一条：最终只有那一条
  const manual = normalizeConfig({ canvas: { enabled: true, platform: 'none', hideCjkFonts: false, targetFonts: ['SimSun'] } } as any);
  assert.equal(manual.canvas.hideCjkFonts, false);
  assert.deepEqual(manual.canvas.targetFonts, ['SimSun']);
});

test('normalizeWebRtc 兼容旧 policy / enabled 字段和三种模式', () => {
  assert.equal(normalizeWebRtc({ globalMode: 'default' }).globalMode, 'default');
  assert.equal(normalizeWebRtc({ globalMode: 'off' } as any).globalMode, 'default');
  assert.equal(normalizeWebRtc({ enabled: false }).globalMode, 'default');
  assert.equal(normalizeWebRtc({ policy: 'compatible' }).globalMode, 'compatible');
  assert.equal(normalizeWebRtc({ policy: 'default_public_interface_only' }).globalMode, 'compatible');
  assert.equal(normalizeWebRtc({ policy: 'strict' }).globalMode, 'strict');
  assert.equal(normalizeWebRtc(undefined).globalMode, 'strict');
});

test('parseHostname 处理协议、端口、尾点和非法输入', () => {
  assert.equal(parseHostname('https://Example.COM.:443/path'), 'example.com');
  assert.equal(parseHostname('example.com:8080/path'), 'example.com');
  assert.equal(parseHostname('.example.com.'), 'example.com');
  assert.equal(parseHostname(''), '');
  assert.equal(parseHostname('http://[bad'), 'http');
});

test('时区校验 / 偏移 / 格式化覆盖失败分支', () => {
  assert.equal(validateTimezone(''), false);
  assert.equal(validateTimezone('Not/AZone'), false);
  assert.equal(validateTimezone('Asia/Tokyo'), true);
  assert.equal(getTimezoneOffsetMinutes('', new Date()), null);
  assert.equal(getTimezoneOffsetMinutes('Asia/Tokyo', new Date('invalid')), null);
  assert.equal(getTimezoneOffsetMinutes('Not/AZone', new Date()), null);
  assert.equal(formatTimezoneOffsetMinutes(Number.NaN), null);
  assert.equal(formatTimezoneOffsetMinutes(0), 'GMT+00:00');
});

test('normalizeGeolocation 过滤非法历史点并补默认值', () => {
  const geo = normalizeGeolocation({
    mode: 'manual',
    latitude: '1.5',
    longitude: '2.5',
    accuracy: 'bad',
    history: [
      { latitude: 1, longitude: 2, accuracy: 3, label: 'ok', createdAt: 'bad' },
      { latitude: 'bad', longitude: 2, accuracy: 3 },
      null as any
    ]
  } as any);
  assert.equal(geo.accuracy, DEFAULT_GEOLOCATION.accuracy);
  assert.equal(geo.history.length, 1);
  assert.equal(geo.history[0].label, 'ok');
  assert.equal(typeof geo.history[0].createdAt, 'number');
});

test('内容脚本 matches：localhost 不展开通配子域，空域返回空', () => {
  assert.deepEqual(buildContentScriptMatchesForDomain('localhost'), ['*://localhost/*']);
  assert.deepEqual(buildContentScriptMatchesForDomain('example.com'), ['*://example.com/*', '*://*.example.com/*']);
  assert.deepEqual(buildContentScriptMatchesForDomain('http://bad host'), ['*://http/*', '*://*.http/*']);
  assert.deepEqual(buildContentScriptMatchesForDomain(''), []);
});

test('内容脚本注册：把 disabled 子域放进 excludeMatches，已烘焙域不重复排除', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'mail.example.com', enabled: false }
    ]
  } as any);
  const plain = getContentScriptRegistration(config);
  assert.deepEqual(plain.matches, ['*://example.com/*', '*://*.example.com/*']);
  assert.deepEqual(plain.excludeMatches, ['*://mail.example.com/*', '*://*.mail.example.com/*']);

  const baked = getContentScriptRegistration(config, ['example.com']);
  assert.deepEqual(baked.excludeMatches, ['*://mail.example.com/*', '*://*.mail.example.com/*']);
  const allBaked = getContentScriptRegistration(config, ['example.com', 'mail.example.com']);
  assert.deepEqual(allBaked.excludeMatches, []);
});

test('isUrlMatchedByEnabledRule 覆盖总开关、空 host、排除和命中', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'mail.example.com', enabled: false }
    ]
  } as any);
  assert.equal(isUrlMatchedByEnabledRule(config, 'https://example.com/a'), true);
  assert.equal(isUrlMatchedByEnabledRule(config, 'https://sub.example.com/a'), true);
  assert.equal(isUrlMatchedByEnabledRule(config, 'https://mail.example.com/a'), false);
  assert.equal(isUrlMatchedByEnabledRule({ ...config, masterEnabled: false }, 'https://example.com'), false);
  assert.equal(isUrlMatchedByEnabledRule(config, 'not a url'), false);
});

test('getEffectiveLanguage 与 getExcludedDomainsFor 的边界', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    globalProfile: { language: { enabled: true, language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' } },
    rules: [
      { domain: 'example.com', enabled: true },
      { domain: 'mail.example.com', enabled: false }
    ]
  } as any);
  assert.equal(getEffectiveLanguage(config, 'example.com')?.language, 'en-US');
  assert.equal(getEffectiveLanguage({ ...config, masterEnabled: false }, 'example.com'), null);
  assert.equal(getEffectiveLanguage(config, 'unknown.example'), null);
  assert.deepEqual(getExcludedDomainsFor('example.com', ['mail.example.com', 'example.com', 'other.com']), ['mail.example.com']);
});

test('旧的 VanishMe domainList / matchMode / siteRules 都能迁移', () => {
  const whitelist = migrateLegacyConfig({
    bpg_config: {
    matchMode: 'whitelist',
    domainList: ['https://Example.com/path', '*.foo.example', 'bad host'],
    siteRules: { 'bar.example': { enabled: true }, 'off.example': { enabled: false } }
    }
  });
  assert.ok(whitelist.rules.some((rule) => rule.domain === 'example.com'));
  assert.ok(whitelist.rules.some((rule) => rule.domain === 'foo.example'));
  assert.ok(whitelist.rules.some((rule) => rule.domain === 'bar.example'));
  assert.equal(whitelist.rules.some((rule) => rule.domain === 'off.example'), false);

  const blacklist = migrateLegacyConfig({ bpg_config: { matchMode: 'blacklist', domainList: ['ignored.example'] } });
  assert.equal(blacklist.rules.some((rule) => rule.domain === 'ignored.example'), false);
});

test('activeProfileId 的 null 是合法状态，不会被归一化复活成默认预设', () => {
  // options 删除当前预设时写的就是 null（见 deleteProfile）；
  // 曾经的 `|| DEFAULTS` 兜底会把它悄悄变回 'united-states'，
  // 于是"取消选择"刷新一下就失效了。
  assert.equal(normalizeConfig({ profile: { activeProfileId: null } as any }).profile.activeProfileId, null);
  // 字段整个缺失（老配置 / 首次运行）仍然要给出默认预设，界面才有选中项
  assert.equal(normalizeConfig({}).profile.activeProfileId, 'united-states');
  assert.equal(normalizeConfig({ profile: { activeProfileId: 'japan' } as any }).profile.activeProfileId, 'japan');
});
