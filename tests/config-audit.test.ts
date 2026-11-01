import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditConfig,
  languageRegion,
  longitudeOffsetHours,
  sortFindings,
  timezoneOffsetHours,
  timezoneRegion
} from '../src/shared/config-audit';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import type { SiteSpoofConfig } from '../src/shared/types';

/**
 * 配置体检：查的是"配置自己跟自己打架"，不是"伪装得够不够真"。
 *
 * 每条断言都对着真实会发生的误配写：改了字段忘了开开关、手填了语言没同步
 * languages、请求头与 JS 各说一套。
 */

const base = (patch: Partial<SiteSpoofConfig> = {}): SiteSpoofConfig => normalizeConfig({
  ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  masterEnabled: true,
  ...patch
} as any);

const ids = (config: SiteSpoofConfig) => auditConfig(config).map((finding) => finding.id);

const usProfile = {
  language: { enabled: true, mode: 'custom' as const, language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
  timezone: { enabled: true, mode: 'manual' as const, timezone: 'America/Los_Angeles' },
  geolocation: {
    enabled: true, mode: 'manual' as const, latitude: 34.0522, longitude: -118.2437,
    accuracy: 50, country: 'US', randomize: false, randomRadiusMeters: 500,
    spoofPermission: true, history: []
  }
};

test('默认配置与自带 preset 都是干净的', () => {
  assert.deepEqual(auditConfig(normalizeConfig({} as any)), []);
  const clean = base({ globalProfile: usProfile as any });
  assert.deepEqual(auditConfig(clean), [], `自带风格的美西 persona 不该报问题：${ids(clean).join(', ')}`);
});

test('首选语言一定在列表里：这条由模型保证，体检不必重复查', () => {
  // 曾经想在体检里查"首选语言不在 languages 里"，但 normalizeLanguage 会把它
  // unshift 到最前，这个状态根本存不下来。这里改成守住模型的那条保证：
  // 哪一天有人放松了 normalizeLanguage，这条会先红。
  const normalized = normalizeConfig({
    masterEnabled: true,
    globalProfile: { language: { enabled: true, mode: 'custom', language: 'en-US', languages: ['en'], acceptLanguage: '' } }
  } as any);
  assert.deepEqual(normalized.globalProfile.language.languages, ['en-US', 'en']);
  assert.equal(normalized.globalProfile.language.acceptLanguage, 'en-US,en;q=0.9', '缺省请求头由列表拼出来');
  assert.equal(ids(normalized).includes('language-primary-missing'), false);
});

test('Accept-Language 与主语言不一致 → warn，修完与 JS 对齐', () => {
  const config = base({
    globalProfile: {
      ...usProfile,
      language: { enabled: true, mode: 'custom', language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'zh-CN,zh;q=0.9' }
    } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'accept-language-mismatch');
  assert.ok(finding);
  const fixed = finding!.fix!.apply(config);
  assert.equal(fixed.globalProfile.language.acceptLanguage, 'en-US,en;q=0.9');
  assert.equal(ids(fixed).includes('accept-language-mismatch'), false);
});

test('时区填了但没开 → warn（改了字段忘了开关）', () => {
  const config = base({
    globalProfile: { ...usProfile, timezone: { enabled: false, mode: 'manual', timezone: 'America/Los_Angeles' } } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'timezone-declared-but-off');
  assert.ok(finding);
  assert.equal(ids(finding!.fix!.apply(config)).includes('timezone-declared-but-off'), false);
});

test('定位开了没坐标、关着却有坐标，两个方向都报', () => {
  const auto = base({
    globalProfile: {
      ...usProfile,
      geolocation: { ...usProfile.geolocation, latitude: null, longitude: null }
    } as any
  });
  assert.ok(ids(auto).includes('geolocation-no-coordinates'));

  const off = base({
    globalProfile: { ...usProfile, geolocation: { ...usProfile.geolocation, enabled: false } } as any
  });
  const finding = auditConfig(off).find((item) => item.id === 'geolocation-coordinates-but-off');
  assert.ok(finding);
  assert.equal(ids(finding!.fix!.apply(off)).includes('geolocation-coordinates-but-off'), false);
});

test('canvas 关了但字体项还配着 → warn，打开后消失', () => {
  const config = base({
    canvas: { enabled: false, spoofFonts: true, platform: 'auto', hideCjkFonts: true, targetFonts: ['MyFont'] } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'canvas-off-with-fonts');
  assert.ok(finding);
  const fixed = finding!.fix!.apply(config);
  assert.equal(fixed.canvas.enabled, true);
  assert.equal(ids(fixed).includes('canvas-off-with-fonts'), false);
});

test('总开关关着但配了一堆 → warn', () => {
  const config = base({ masterEnabled: false, globalProfile: usProfile as any });
  assert.ok(ids(config).includes('master-off'));
  // 什么都没配的时候不唠叨
  assert.equal(ids(normalizeConfig({} as any)).includes('master-off'), false);
});

test('时区与语言指向两个地方 → info（不是错误），两面都写清楚', () => {
  const config = base({
    globalProfile: {
      ...usProfile,
      language: { enabled: true, mode: 'custom', language: 'zh-CN', languages: ['zh-CN', 'zh'], acceptLanguage: 'zh-CN,zh;q=0.9' }
    } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'timezone-language-region');
  assert.ok(finding, '美西时区 + 中文语言必须报出来');
  assert.equal(finding!.severity, 'info', '这不一定错：可能只是不想暴露时区');
  assert.match(finding!.detail, /语言这一项会先把故事说破/);
  assert.match(finding!.detail, /那这个组合是对的/);
  assert.equal(finding!.fix, undefined, '这种取舍不该由我们替用户决定');
});

test('坐标与声明时区差太远 → warn', () => {
  const config = base({
    globalProfile: {
      ...usProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Shanghai' }
    } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'coordinates-timezone');
  assert.ok(finding, '洛杉矶坐标 + 上海时区必须报');
  assert.equal(finding!.severity, 'warn');
});

test('同城坐标 + 时区不误报（含中国这种跨五个时区的国家）', () => {
  const shanghai = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      ...usProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Shanghai' },
      geolocation: { ...usProfile.geolocation, latitude: 31.2304, longitude: 121.4737 }
    }
  } as any);
  assert.equal(ids(shanghai).includes('coordinates-timezone'), false);

  // 乌鲁木齐坐标配 Asia/Shanghai：太阳时差 3 小时，属于政治时区，不能报
  const urumqi = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      ...usProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Shanghai' },
      geolocation: { ...usProfile.geolocation, latitude: 43.8256, longitude: 87.6168 }
    }
  } as any);
  assert.equal(ids(urumqi).includes('coordinates-timezone'), false);
});

test('藏了中文字体但语言是中文 → info，并给"承认中文环境"的出口', () => {
  const config = base({
    globalProfile: {
      ...usProfile,
      language: { enabled: true, mode: 'custom', language: 'zh-CN', languages: ['zh-CN', 'zh'], acceptLanguage: 'zh-CN,zh;q=0.9' }
    } as any,
    canvas: { enabled: true, spoofFonts: true, platform: 'auto', hideCjkFonts: true, targetFonts: [] } as any
  });
  const finding = auditConfig(config).find((item) => item.id === 'cjk-hidden-but-zh');
  assert.ok(finding);
  const fixed = finding!.fix!.apply(config);
  assert.equal(fixed.canvas.hideCjkFonts, false);
  assert.equal(ids(fixed).includes('cjk-hidden-but-zh'), false);
});

test('区域推导：常见组合', () => {
  assert.equal(timezoneRegion('America/Los_Angeles'), 'US');
  assert.equal(timezoneRegion('Asia/Shanghai'), 'CN');
  assert.equal(timezoneRegion('Asia/Tokyo'), 'JP');
  assert.equal(timezoneRegion('Europe/Berlin'), 'EU');
  assert.equal(timezoneRegion('UTC'), 'NEUTRAL');
  assert.equal(timezoneRegion('Mars/Olympus'), null);

  assert.equal(languageRegion('en-US'), 'US');
  assert.equal(languageRegion('zh-CN'), 'CN');
  assert.equal(languageRegion('zh-TW'), 'TW');
  assert.equal(languageRegion('ja-JP'), 'JP');
  assert.equal(languageRegion('de-DE'), 'EU');
});

test('时区偏移与太阳时：数字对得上', () => {
  assert.equal(timezoneOffsetHours('Asia/Shanghai'), 8);
  assert.equal(timezoneOffsetHours('UTC'), 0);
  assert.equal(timezoneOffsetHours('America/Los_Angeles', new Date('2026-01-15T12:00:00Z')), -8);
  assert.equal(timezoneOffsetHours('America/Los_Angeles', new Date('2026-07-15T12:00:00Z')), -7);
  assert.equal(Number(longitudeOffsetHours(-120).toFixed(1)), -8);
  assert.equal(Number(longitudeOffsetHours(120).toFixed(1)), 8);
});

test('排序：error 在前，info 在后', () => {
  const sorted = sortFindings([
    { id: 'a', severity: 'info', title: '', detail: '' },
    { id: 'b', severity: 'error', title: '', detail: '' },
    { id: 'c', severity: 'warn', title: '', detail: '' }
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'c', 'a']);
});

// ---------- 与运行环境对比 ----------

const LA_EXIT = { latitude: 34.05, longitude: -118.24, country: 'US', timezone: 'America/Los_Angeles' };
const TOKYO_EXIT = { latitude: 35.68, longitude: 139.69, country: 'JP', timezone: 'Asia/Tokyo' };
const envIds = (config: SiteSpoofConfig, environment: Parameters<typeof auditConfig>[1]) =>
  auditConfig(config, environment).map((finding) => finding.id);

test('出口 IP 与人设同处：不报；不传运行环境时也不猜', () => {
  const clean = base({ globalProfile: usProfile as any });
  assert.deepEqual(envIds(clean, { exit: LA_EXIT }), []);
  assert.deepEqual(envIds(clean, {}), []);
  assert.deepEqual(envIds(clean, { exit: null, webRtc: null }), []);
});

test('手动时区与出口 IP 所在时区偏移不同 → warn，修法改成出口时区后消失', () => {
  const config = base({ globalProfile: usProfile as any });
  const findings = auditConfig(config, { exit: TOKYO_EXIT });
  const finding = findings.find((item) => item.id === 'exit-ip-timezone');
  assert.ok(finding, '东京出口配洛杉矶时区必须报');
  assert.equal(finding!.severity, 'warn');
  assert.match(finding!.detail, /Asia\/Tokyo/);
  const fixed = normalizeConfig(finding!.fix!.apply(config));
  assert.equal(fixed.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.ok(!envIds(fixed, { exit: TOKYO_EXIT }).includes('exit-ip-timezone'));
});

test('偏移相同的不同时区名不报；auto 时区本来就跟随出口，不报', () => {
  // 蒂华纳与洛杉矶全年同步夏令时（温哥华自 2026-11 起常年 UTC-7，不能再当"同偏移"样本）
  const tijuana = base({ globalProfile: { ...usProfile, timezone: { enabled: true, mode: 'manual', timezone: 'America/Tijuana' } } as any });
  assert.ok(!envIds(tijuana, { exit: LA_EXIT }).includes('exit-ip-timezone'), '蒂华纳与洛杉矶同一偏移');
  const auto = base({ globalProfile: { ...usProfile, timezone: { enabled: true, mode: 'auto', timezone: '' } } as any });
  assert.ok(!envIds(auto, { exit: TOKYO_EXIT }).includes('exit-ip-timezone'));
});

test('手动坐标离出口 IP 超过 500 公里 → warn，修法改为跟随出口坐标；几百公里内不报', () => {
  const config = base({ globalProfile: usProfile as any });
  // 圣地亚哥距洛杉矶约 180 公里：城市级 IP 归属地的正常误差
  assert.ok(!envIds(config, { exit: { ...LA_EXIT, latitude: 32.72, longitude: -117.16 } }).includes('exit-ip-coordinates'));

  const finding = auditConfig(config, { exit: { ...TOKYO_EXIT, timezone: 'America/Los_Angeles' } })
    .find((item) => item.id === 'exit-ip-coordinates');
  assert.ok(finding, '洛杉矶坐标配东京出口必须报');
  assert.match(finding!.detail, /公里/);
  const fixed = normalizeConfig(finding!.fix!.apply(config));
  assert.equal(fixed.globalProfile.geolocation.mode, 'auto');
  assert.ok(!envIds(fixed, { exit: TOKYO_EXIT }).includes('exit-ip-coordinates'));
});

test('WebRTC 策略被别的扩展接管、被策略锁定或实际值不符 → warn；本扩展控制且一致不报', () => {
  const config = base({ globalProfile: usProfile as any });
  const expected = 'disable_non_proxied_udp';
  assert.ok(!envIds(config, { webRtc: { expected, value: expected, levelOfControl: 'controlled_by_this_extension' } }).includes('webrtc-not-applied'));

  const other = auditConfig(config, { webRtc: { expected, value: 'default', levelOfControl: 'controlled_by_other_extensions' } })
    .find((item) => item.id === 'webrtc-not-applied');
  assert.ok(other);
  assert.match(other!.detail, /另一个扩展/);
  assert.equal(other!.fix, undefined, '控制权不在本扩展手里，没有能机械修的办法');

  const locked = auditConfig(config, { webRtc: { expected, value: 'default', levelOfControl: 'not_controllable' } })
    .find((item) => item.id === 'webrtc-not-applied');
  assert.match(locked!.detail, /策略锁定/);

  assert.ok(envIds(config, { webRtc: { expected, value: 'default', levelOfControl: 'controlled_by_this_extension' } }).includes('webrtc-not-applied'));
  // 不接管 WebRTC（default 档）时没有"期望值"，不报
  assert.ok(!envIds(config, { webRtc: { expected: null, value: 'default', levelOfControl: 'controllable_by_this_extension' } }).includes('webrtc-not-applied'));
});

test('总开关关着时不做运行环境对比', () => {
  const off = base({ masterEnabled: false, globalProfile: usProfile as any });
  const found = envIds(off, {
    exit: TOKYO_EXIT,
    webRtc: { expected: 'disable_non_proxied_udp', value: 'default', levelOfControl: 'controlled_by_other_extensions' }
  });
  assert.ok(!found.some((id) => id.startsWith('exit-ip') || id === 'webrtc-not-applied'));
});
