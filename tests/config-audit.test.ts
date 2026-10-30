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
