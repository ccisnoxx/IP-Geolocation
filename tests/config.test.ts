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

test('字体默认值仅包含16项厂商软件名单，vendor模式忽略自定义集合', () => {
  assert.deepEqual(VENDOR_SOFTWARE_FONT_FAMILIES, [
    'MiSans', 'MIUI', 'HarmonyOS Sans SC', 'HarmonyOS Sans', 'HONOR Sans', 'OPPO Sans',
    'vivo Sans', 'Alibaba PuHuiTi', 'Alibaba Sans', 'DingTalk JinBuTi', 'Douyin Sans',
    'HYQiHei', 'FZShuSong-Z01S', 'FZKai-Z03S', 'FZHei-B01S', 'FZFangSong-Z02S'
  ]);
  assert.deepEqual(DEFAULT_FONT_EXPOSURE, {
    enabled: false, mode: 'vendor-software', blockedFamilies: VENDOR_SOFTWARE_FONT_FAMILIES
  });
  assert.deepEqual(normalizeFontExposure({ enabled: true, mode: 'vendor-software', blockedFamilies: ['Arial'] }), {
    ...DEFAULT_FONT_EXPOSURE, enabled: true
  });
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
    const migrated = await getConfig();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][RULES_INITIALIZED_KEY], true);
    assert.deepEqual(data[SITE_CONFIG_KEY], migrated);
    assert.deepEqual(migrated.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['My Font'] });
    assert.deepEqual(await getConfig(), migrated);
    assert.equal(writes.length, 1);
    delete data[RULES_INITIALIZED_KEY];
    const raw = structuredClone(data[SITE_CONFIG_KEY]);
    assert.deepEqual(await getConfig(), migrated);
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
    await assert.rejects(getConfig(), /synthetic storage failure/);
    assert.deepEqual(data, before);
    assert.equal(removals, 0);
    failWrite = false;
    const migrated = await getConfig();
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
  const mixed = { schemaVersion: 3, canvas: { enabled: true, targetFonts: ['Synthetic Font'] } };
  const result = validateConfig(mixed);
  assert.equal(result.ok, true);
  assert.deepEqual(result.config.fontExposure, DEFAULT_FONT_EXPOSURE);
  assert.doesNotMatch(JSON.stringify(result.config), /"canvas"/);
  assert.deepEqual(normalizeConfig(result.config), result.config);
});
