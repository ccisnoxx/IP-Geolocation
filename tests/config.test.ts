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
  DEFAULT_FONT_EXPOSURE,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC,
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY,
  VENDOR_SOFTWARE_FONT_FAMILIES,
  normalizeFontExposure,
  normalizeLanguage,
  normalizeConfig
} from '../src/shared/config-model';
import { getConfig } from '../src/shared/storage';

const LEGACY_DEFAULT_CANVAS_FAMILIES = [
  'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei',
  'KaiTi', 'FangSong', 'DengXian', 'PingFang SC', 'Hiragino Sans GB',
  'STHeiti', 'STSong', 'Songti SC', 'Source Han Sans CN', 'Source Han Sans SC',
  'Noto Sans CJK SC', 'Noto Serif CJK SC', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei',
  'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB', 'PingFang TC', 'PingFang HK',
  'Source Han Sans TW', 'Noto Sans CJK TC'
];

test('主语言移到列表首位且不重复，显式备用语言顺序和多语言偏好保留', () => {
  const result = normalizeLanguage({ language: 'ja-JP', languages: ['zh-CN', 'ja-JP', 'en', 'ja-JP', 'ko'] });
  assert.deepEqual(result.languages, ['ja-JP', 'zh-CN', 'en', 'ko']);
  assert.deepEqual(normalizeLanguage(result), result);
});

test('空语言列表按当前主语言生成，不混入其他地区语言', () => {
  for (const [language, expected] of [
    ['ja-JP', ['ja-JP', 'ja', 'en']],
    ['es-MX', ['es-MX', 'es', 'en']],
    ['en', ['en']]
  ] as const) {
    assert.deepEqual(normalizeLanguage({ language, languages: [] }).languages, expected);
  }
});

function v2Config(canvas: Record<string, unknown>) {
  const { fontExposure: _fontExposure, ...config } = normalizeConfig({ rules: [] });
  return { ...config, schemaVersion: 2, canvas };
}

test('default config uses IP-following mode without regional presets', () => {
  const config = normalizeConfig({});

  assert.equal(config.globalProfile.geolocation.mode, 'auto');
  assert.equal(config.globalProfile.timezone.mode, 'auto');
  assert.equal(config.globalProfile.language.enabled, false);
  assert.equal(config.profile.activeProfileId, null);
  assert.deepEqual(config.profile.profiles, []);
  assert.equal(config.schemaVersion, 3);
  assert.deepEqual(config.fontExposure, DEFAULT_FONT_EXPOSURE);
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

test('历史空规则修补仅用于v1，不覆盖已有v2/v3，即使缺少初始化标记', () => {
  const brokenAutoConfig = normalizeConfig({ rules: [] });

  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: brokenAutoConfig }), brokenAutoConfig);
  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: { ...brokenAutoConfig, schemaVersion: 2 } }), brokenAutoConfig);
  assert.ok(migrateLegacyConfig({ siteSpoofConfig: { ...brokenAutoConfig, schemaVersion: 1 } }).rules.length > 0);
  assert.equal(migrateLegacyConfig({
    siteSpoofConfig: brokenAutoConfig,
    [RULES_INITIALIZED_KEY]: true
  }).rules.length, 0);
});

test('validateConfig rejects duplicate domains', () => {
  const result = validateConfig(normalizeConfig({
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
  }));

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
        languages: ['en-US', 'en']
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
          language: { mode: 'override', value: { language: 'ja-JP', languages: ['ja-JP', 'ja'] } },
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
  assert.deepEqual(migrated.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['SimSun'] });
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
    '*://*.localhost/*',
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

test('字体默认值包含16项厂商软件及27项简繁中文名单，vendor模式忽略自定义集合', () => {
  assert.deepEqual(VENDOR_SOFTWARE_FONT_FAMILIES, [
    'MiSans', 'MIUI', 'HarmonyOS Sans SC', 'HarmonyOS Sans', 'HONOR Sans', 'OPPO Sans',
    'vivo Sans', 'Alibaba PuHuiTi', 'Alibaba Sans', 'DingTalk JinBuTi', 'Douyin Sans',
    'HYQiHei', 'FZShuSong-Z01S', 'FZKai-Z03S', 'FZHei-B01S', 'FZFangSong-Z02S',
    ...LEGACY_DEFAULT_CANVAS_FAMILIES
  ]);
  assert.deepEqual(DEFAULT_FONT_EXPOSURE, {
    enabled: false, mode: 'vendor-software', blockedFamilies: VENDOR_SOFTWARE_FONT_FAMILIES
  });
  assert.deepEqual(normalizeFontExposure({ enabled: true, mode: 'vendor-software', blockedFamilies: ['Arial'] }), {
    ...DEFAULT_FONT_EXPOSURE, enabled: true
  });
});

test('v3旧内置名单读取时升级到当前43项，保留开关和custom名单', () => {
  for (const enabled of [false, true]) {
    const old = normalizeConfig({ rules: [] });
    old.fontExposure = { enabled, mode: 'vendor-software', blockedFamilies: ['MiSans', 'MIUI'] };
    const upgraded = migrateLegacyConfig({ [SITE_CONFIG_KEY]: old });
    assert.deepEqual(upgraded.fontExposure, { enabled, mode: 'vendor-software', blockedFamilies: VENDOR_SOFTWARE_FONT_FAMILIES });
    assert.deepEqual(normalizeConfig(upgraded), upgraded);
    old.fontExposure = { enabled, mode: 'custom', blockedFamilies: ['Microsoft YaHei', 'Arial'] };
    assert.deepEqual(migrateLegacyConfig({ [SITE_CONFIG_KEY]: old }).fontExposure, old.fontExposure);
  }
});

test('v2关闭字体迁为安全默认，启用旧宽名单按规范键集合等价迁为vendor模式', () => {
  assert.deepEqual(migrateLegacyConfig({ [SITE_CONFIG_KEY]: v2Config({ enabled: false, targetFonts: ['Custom'] }) }).fontExposure,
    DEFAULT_FONT_EXPOSURE);
  for (const targetFonts of [undefined, LEGACY_DEFAULT_CANVAS_FAMILIES,
    [...LEGACY_DEFAULT_CANVAS_FAMILIES].reverse().map((font) => ` "${font.split(' ').join('').toUpperCase()}" `)
      .concat(' Microsoft YaHei ')]) {
    const migrated = migrateLegacyConfig({ [SITE_CONFIG_KEY]: v2Config({ enabled: true, targetFonts }) });
    assert.equal(migrated.schemaVersion, 3);
    assert.deepEqual(migrated.fontExposure, { ...DEFAULT_FONT_EXPOSURE, enabled: true });
    assert.deepEqual(migrateLegacyConfig({ [SITE_CONFIG_KEY]: migrated }), migrated);
  }
});

test('v2自定义名单trim去空并按runtime规范键去重，保留首次显示值和空集合', () => {
  for (const [targetFonts, expected] of [
    [['  MI Sans  ', 'MiSans', ' "MISANS" ', '', ' ', '""', 'Vendor Font', 'vendorfont'], ['MI Sans', 'Vendor Font']],
    [[], []],
    [['Microsoft YaHei'], ['Microsoft YaHei']]
  ]) {
    const migrated = migrateLegacyConfig({ [SITE_CONFIG_KEY]: v2Config({ enabled: true, targetFonts }) });
    assert.deepEqual(migrated.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: expected });
    assert.deepEqual(normalizeConfig(migrated), migrated);
  }
});

test('v2升级保留禁用规则、overrides、verified档案及其他信号，所有持久化语言丢弃旧header字段', () => {
  const old = v2Config({ enabled: true, targetFonts: ['My Font'] });
  old.intlMode = 'compatible';
  old.webRtc = { globalMode: 'compatible' };
  old.globalProfile.language = { ...old.globalProfile.language, enabled: true, acceptLanguage: 'obsolete' } as any;
  old.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'UTC' };
  old.globalProfile.geolocation = { ...old.globalProfile.geolocation,
    mode: 'manual', latitude: 0, longitude: 0, randomize: true,
    history: [{ latitude: 0, longitude: 0, accuracy: 50, label: 'Synthetic', createdAt: 1 }] };
  old.profile = { activeProfileId: 'custom', profiles: [{
    id: 'custom', name: '合成方案', geolocation: { latitude: 0, longitude: 0, accuracy: 50 },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'obsolete' },
    timezone: { timezone: 'UTC' }
  } as any] };
  old.exitLocationProfiles = [{
    id: 'verified', name: '合成出口', verification: 'verified', publicIp: '203.0.113.5',
    latitude: 0, longitude: 0, country: 'Synthetic', timezone: 'UTC',
    provider: 'synthetic', verifiedAt: 1_700_000_000_000
  }];
  old.rules = ['override', 'disable', 'inherit'].map((mode, index) => ({
    id: `rule-${index}`, domain: `site${index}.example`, enabled: index === 0, exitLocationProfileId: 'verified',
    overrides: {
      language: { mode, value: { enabled: true, language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'obsolete' } },
      timezone: { mode: 'override', value: { mode: 'manual', timezone: 'Asia/Tokyo' } },
      geolocation: { mode: 'inherit', value: null }
    }
  })) as any;
  const before = structuredClone(old);
  const result = validateConfig(old);
  assert.equal(result.ok, true, result.errors.join('; '));
  const migrated = result.config;
  assert.deepEqual(old, before);
  assert.equal(migrated.intlMode, old.intlMode);
  assert.deepEqual(migrated.webRtc, old.webRtc);
  assert.deepEqual(migrated.globalProfile.timezone, old.globalProfile.timezone);
  assert.deepEqual(migrated.globalProfile.geolocation, old.globalProfile.geolocation);
  assert.deepEqual(migrated.exitLocationProfiles, old.exitLocationProfiles);
  assert.equal(migrated.profile.activeProfileId, 'custom');
  assert.equal(migrated.profile.profiles.length, 1);
  assert.deepEqual(migrated.rules.map(({ id, enabled, exitLocationProfileId }) => ({ id, enabled, exitLocationProfileId })),
    old.rules.map(({ id, enabled, exitLocationProfileId }) => ({ id, enabled, exitLocationProfileId })));
  for (const rule of migrated.rules) {
    assert.deepEqual(rule.overrides.timezone, old.rules[0].overrides.timezone);
    assert.equal(rule.overrides.language.value?.language, 'ja-JP');
    assert.equal(Object.prototype.hasOwnProperty.call(rule.overrides.language.value!, 'acceptLanguage'), false);
  }
  assert.doesNotMatch(JSON.stringify(migrated), /"(?:canvas|acceptLanguage)"/);
  assert.deepEqual(normalizeConfig(migrated), migrated);
  const resolved = getEffectiveProfile(migrated, 'site0.example').payload;
  assert.equal(resolved?.languageConfig?.language, 'ja-JP');
  assert.deepEqual(resolved?.fontExposureConfig, migrated.fontExposure);
});

test('原始非法schema、字体模式或名单类型在归一化前拒绝，合法v2及v3仍可导入', () => {
  for (const input of [null, [], 'bad', { schemaVersion: 4 },
    { fontExposure: null }, { fontExposure: { enabled: 'true' } },
    { fontExposure: { mode: 'unknown' } }, { fontExposure: { blockedFamilies: 'MiSans' } },
    { fontExposure: { mode: 'custom', blockedFamilies: [42] } },
    { schemaVersion: 2, canvas: { enabled: true, targetFonts: [null] } },
    { schemaVersion: 2, canvas: { targetFonts: 'My Font' } }]) {
    assert.equal(validateConfig(input).ok, false, JSON.stringify(input));
  }
  for (const config of [v2Config({ enabled: true, targetFonts: ['My Font'] }),
    normalizeConfig({ fontExposure: { enabled: true, mode: 'custom', blockedFamilies: ['My Font'] } })]) {
    const result = validateConfig(config);
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.equal(result.config.schemaVersion, 3);
    assert.doesNotMatch(JSON.stringify(result.config), /"(?:canvas|acceptLanguage)"/);
  }
});

test('storage单次写回v2到v3，v3稳态仅补缺失标记且不覆盖有效自定义配置', async () => {
  const originalChrome = globalThis.chrome;
  const data: Record<string, any> = { [SITE_CONFIG_KEY]: v2Config({ enabled: true, targetFonts: ['My Font'] }) };
  const writes: Array<Record<string, unknown>> = [];
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(data),
    set: async (value: Record<string, unknown>) => { writes.push(structuredClone(value)); Object.assign(data, value); },
    remove: async (keys: string[]) => { keys.forEach((key) => { delete data[key]; }); }
  } } } as any;
  try {
    const migrated = await getConfig(async () => {});
    assert.equal(writes.length, 1);
    assert.equal(writes[0][RULES_INITIALIZED_KEY], true);
    assert.deepEqual(data[SITE_CONFIG_KEY], migrated);
    assert.deepEqual(migrated.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['My Font'] });
    assert.deepEqual(await getConfig(async () => {}), migrated);
    assert.equal(writes.length, 1);
    delete data[RULES_INITIALIZED_KEY];
    const raw = structuredClone(data[SITE_CONFIG_KEY]);
    assert.deepEqual(await getConfig(async () => {}), migrated);
    assert.deepEqual(writes[1], { [RULES_INITIALIZED_KEY]: true });
    assert.deepEqual(data[SITE_CONFIG_KEY], raw);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('v2迁移写入失败保留原配置与旧键并传播错误，重试后才清理旧键', async () => {
  const originalChrome = globalThis.chrome;
  const data: Record<string, any> = {
    [SITE_CONFIG_KEY]: v2Config({ enabled: true, targetFonts: ['My Font'] }),
    lastLocation: { latitude: 0, longitude: 0, country: 'Synthetic', timezone: 'UTC' }
  };
  const before = structuredClone(data);
  let failWrite = true;
  let removals = 0;
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(data),
    set: async (value: Record<string, unknown>) => {
      if (failWrite) throw new Error('synthetic storage failure');
      Object.assign(data, value);
    },
    remove: async (keys: string[]) => { removals += 1; keys.forEach((key) => { delete data[key]; }); }
  } } } as any;
  try {
    await assert.rejects(getConfig(async () => {}), /synthetic storage failure/);
    assert.deepEqual(data, before);
    assert.equal(removals, 0);
    failWrite = false;
    const migrated = await getConfig(async () => {});
    assert.equal(data[SITE_CONFIG_KEY].schemaVersion, 3);
    assert.equal(data[RULES_INITIALIZED_KEY], true);
    assert.equal(removals, 1);
    assert.equal('lastLocation' in data, false);
    assert.deepEqual(migrated.exitLocationProfiles, []);
    assert.deepEqual(migrated.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['My Font'] });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('声明v3时不再消费遗留canvas，缺少fontExposure使用新默认', () => {
  const { fontExposure: _font, ...config } = normalizeConfig({ rules: [] });
  const mixed = { ...config, canvas: { enabled: true, targetFonts: ['Synthetic Font'] } };
  const result = validateConfig(mixed);
  assert.equal(result.ok, true);
  assert.deepEqual(result.config.fontExposure, DEFAULT_FONT_EXPOSURE);
  assert.doesNotMatch(JSON.stringify(result.config), /"canvas"/);
  assert.deepEqual(normalizeConfig(result.config), result.config);
});

// 外部输入必须在补齐任何默认值之前拒绝。
test('外部配置拒绝缺失结构、错误布尔值和未知枚举，不生成可用配置', () => {
  const valid = normalizeConfig({ rules: [] });
  const invalid: Array<[unknown, RegExp]> = [
    [{}, /schemaVersion/],
    ...['false', 0, 1, null].map((masterEnabled): [unknown, RegExp] => [{ ...valid, masterEnabled }, /masterEnabled/]),
    [{ ...valid, webRtc: { globalMode: 'bogus' } }, /webRtc.globalMode/],
    [{ ...valid, intlMode: 'bogus' }, /intlMode/],
    [{ ...valid, schemaVersion: 4 }, /schemaVersion/],
    [{ ...valid, globalProfile: null }, /globalProfile/],
    [{ ...valid, rules: [{}] }, /rules/],
    [{ ...valid, exitLocationProfiles: [null] }, /exitLocationProfiles/]
  ];
  for (const [input, field] of invalid) {
    const result = validateConfig(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.match(result.errors.join('; '), field);
    assert.equal(result.config, undefined, '失败结果不得携带补齐后可启用的配置');
  }
});

test('损坏持久配置拒绝读取且保留原数据及旧键', async () => {
  const original = globalThis.chrome;
  for (const raw of [{}, null, { ...normalizeConfig({ rules: [] }), masterEnabled: 'false' }]) {
    const data = { [SITE_CONFIG_KEY]: raw, lastLocation: { latitude: 0, longitude: 0 } };
    const before = structuredClone(data);
    let writes = 0;
    globalThis.chrome = { storage: { local: {
      get: async () => structuredClone(data),
      set: async () => { writes++; }, remove: async () => { writes++; }
    } } } as unknown as typeof chrome;
    try {
      await assert.rejects(getConfig(async () => { writes++; }), /配置.*无效/);
      assert.equal(writes, 0);
      assert.deepEqual(data, before);
    } finally { globalThis.chrome = original; }
  }
});

test('外部配置逐层拒绝错误字段类型和未知枚举，缺失核心字段不能补齐', () => {
  const base = normalizeConfig({ rules: [] });
  const cases: Array<[string, unknown]> = [
    ['debugMode', 1], ['webRtc', null], ['globalProfile.language.enabled', 'false'],
    ['globalProfile.language.mode', 'bogus'], ['globalProfile.language.languages', 'en-US'],
    ['globalProfile.timezone.mode', 'bogus'], ['globalProfile.timezone.timezone', 0],
    ['globalProfile.geolocation.randomRadiusMeters', -1], ['globalProfile.geolocation.mode', 'bogus'], ['globalProfile.geolocation.spoofPermission', 'false'],
    ['globalProfile.geolocation.latitude', '0'], ['globalProfile.geolocation.history', [null]],
    ['profile.activeProfileId', 1], ['profile.profiles', {}], ['exitLocationProfiles', {}], ['rules', {}]
  ];
  for (const [path, value] of cases) {
    const candidate: Record<string, unknown> = { ...structuredClone(base) };
    const keys = path.split('.');
    let object = candidate;
    for (const key of keys.slice(0, -1)) object = object[key] as Record<string, unknown>;
    object[keys.at(-1)!] = value;
    const result = validateConfig(candidate);
    assert.equal(result.ok, false, path);
    assert.ok(result.errors.some(error => error.includes(path)), result.errors.join('; '));
  }
  for (const key of ['schemaVersion', 'intlMode', 'masterEnabled', 'debugMode', 'globalProfile', 'webRtc', 'profile', 'exitLocationProfiles', 'rules']) {
    const candidate: Record<string, unknown> = { ...structuredClone(base) };
    delete candidate[key];
    assert.equal(validateConfig(candidate).ok, false, key);
  }
  const result = validateConfig(JSON.parse(JSON.stringify(base)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.config, base);
});

test('合法旧键 WebRTC 迁移保持关闭与各领域策略，错误旧布尔值和enum拒绝', () => {
  for (const [policy, expected] of [['default', 'default'], ['default_public_interface_only', 'compatible'], ['disable_non_proxied_udp', 'strict']] as const) {
    assert.equal(migrateLegacyConfig({ extensionEnabled: true, webRtcConfig: { enabled: true, policy } }).webRtc.globalMode, expected);
    assert.equal(migrateLegacyConfig({ extensionEnabled: false, webRtcConfig: { enabled: false, policy } }).masterEnabled, false);
    assert.equal(migrateLegacyConfig({ extensionEnabled: true, webRtcConfig: { enabled: false, policy } }).webRtc.globalMode, 'default');
  }
  for (const input of [{ extensionEnabled: 'false' }, { bpg_config: {} }, { bpg_config: { globalEnabled: 'false' } }, { webRtcConfig: { policy: 'bogus' } },
    { extensionEnabled: true, languageConfig: { enabled: true, language: 'bad_locale', languages: ['bad_locale'] } },
    { extensionEnabled: true, timezoneConfig: { enabled: true, mode: 'manual', timezone: 'Mars/Base' } }]) {
    assert.throws(() => migrateLegacyConfig(input), /本地配置无效/);
  }
});

test('实际历史 v1/v2 shape 缺少后来引入字段仍合法迁移，未知枚举仍拒绝', () => {
  const { fontExposure: _fonts, intlMode: _intl, ...v2 } = normalizeConfig({ rules: [] });
  const oldV2 = { ...v2, schemaVersion: 2, canvas: { enabled: false, spoofFonts: false, targetFonts: [] } };
  const result = validateConfig(oldV2);
  assert.equal(result.ok, true);
  assert.equal(result.config?.intlMode, 'strict');
  const { exitLocationProfiles: _exit, ...v1 } = oldV2;
  const oldRule = { id: 'historical', domain: 'example.com', enabled: true,
    overrides: { language: { mode: 'inherit', value: null }, timezone: { mode: 'inherit', value: null }, geolocation: { mode: 'inherit', value: null } } };
  const migrated = migrateLegacyConfig({ [SITE_CONFIG_KEY]: { ...v1, schemaVersion: 1, rules: [oldRule] } });
  assert.equal(migrated.intlMode, 'strict');
  assert.deepEqual(migrated.rules[0], { ...oldRule, exitLocationProfileId: null });
  assert.equal(validateConfig({ ...oldV2, intlMode: 'bogus' }).ok, false);
});

test('旧迁移在归一化过滤前拒绝损坏方案，不能丢方案后当成功', () => {
  const profile = { id: 'keep-me', name: '合成方案',
    geolocation: { latitude: 0, longitude: 0, accuracy: 50 },
    language: { language: 'en-US', languages: ['en-US'] }, timezone: { timezone: 'Mars/Base' } };
  assert.throws(() => migrateLegacyConfig({ bpg_config: { globalEnabled: true, domainList: ['example.test'],
    profile: { activeProfileId: profile.id, profiles: [profile] } } }), /本地配置无效.*timezone/);
  assert.throws(() => migrateLegacyConfig({ [SITE_CONFIG_KEY]: { ...normalizeConfig({ rules: [] }), schemaVersion: 1,
    profile: { activeProfileId: profile.id, profiles: [profile] } } }), /本地配置无效.*timezone/);
});


test('合法旧位置允许未知时区null，关闭状态和零坐标保持', () => {
  const migrated = migrateLegacyConfig({ extensionEnabled: false,
    lastLocation: { latitude: 0, longitude: 0, country: 'Synthetic', timezone: null } });
  assert.equal(migrated.masterEnabled, false);
  assert.equal(migrated.exitLocationProfiles[0].latitude, 0);
  assert.equal(migrated.exitLocationProfiles[0].longitude, 0);
  assert.equal(migrated.exitLocationProfiles[0].timezone, null);
  assert.equal(migrated.exitLocationProfiles[0].verification, 'unverified');
});

test('保存方案中的错误语言标签在导入时拒绝，不等待应用方案才报错', () => {
  const config = normalizeConfig({ rules: [] });
  const candidate = { ...config, profile: { activeProfileId: 'invalid-locale', profiles: [{
    id: 'invalid-locale', name: '合成方案', geolocation: { latitude: 0, longitude: 0, accuracy: 50 },
    timezone: { timezone: 'UTC' }, language: { language: 'bad_locale', languages: ['bad_locale'] }
  }] } };
  const result = validateConfig(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /profile.profiles\[0\].language.*BCP 47/);
  assert.equal(result.config, undefined);
});
