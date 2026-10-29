import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PRESET_ACCURACY, parsePresets, readPresets } from '../scripts/lib/presets.mjs';
import { validateProfile, applyProfileToConfig } from '../src/shared/profile';
import {
  DEFAULT_GEOLOCATION,
  DEFAULT_PROFILES,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  validateTimezone
} from '../src/shared/config-model';

/**
 * 内置 preset 的约束。
 *
 * preset 有两个读者：浏览器扩展（TS 里的 `DEFAULT_PROFILES`）和发布流水线 / E2E
 * （从源码文本里解析的同一份清单）。两边只要错位，现象都是"某个 preset 的包没出"
 * 或者"出货的语言和预期不一致"，但报错位置离原因很远，所以这里把两边的等价性、
 * 以及 preset 自身的自洽性（坐标↔时区、acceptLanguage↔languages）钉住。
 */

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = readFileSync(join(ROOT, 'src', 'shared', 'config-model.ts'), 'utf8');
const WINTER = '2026-01-15T12:00:00Z';

function parseAcceptLanguage(value: string): Array<{ tag: string; q: number }> {
  return value.split(',').map((item) => {
    const [tag, ...params] = item.trim().split(';');
    const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 };
  });
}

test('源码解析出的 preset 与 TS 里的 DEFAULT_PROFILES 完全一致', () => {
  const parsed = readPresets(ROOT);
  assert.equal(parsed.length, DEFAULT_PROFILES.length);
  assert.deepEqual(parsed.map((preset) => preset.id), DEFAULT_PROFILES.map((profile) => profile.id));

  for (const profile of DEFAULT_PROFILES) {
    const preset = parsed.find((item) => item.id === profile.id);
    assert.ok(preset, `解析缺少 ${profile.id}`);
    assert.equal(preset.name, profile.name);
    assert.equal(preset.geolocation.latitude, profile.geolocation.latitude);
    assert.equal(preset.geolocation.longitude, profile.geolocation.longitude);
    assert.equal(preset.geolocation.accuracy, profile.geolocation.accuracy);
    assert.equal(preset.geolocation.country, profile.geolocation.country);
    assert.equal(preset.language.language, profile.language.language);
    assert.deepEqual(preset.language.languages, profile.language.languages);
    assert.equal(preset.language.acceptLanguage, profile.language.acceptLanguage);
    assert.equal(preset.timezone.timezone, profile.timezone.timezone);
  }
});

test('解析器不吃声明里的类型标注（`: Profile[] = [` 的方括号）', () => {
  const presets = parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'x',
    name: 'X',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'X' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  }
];`);
  assert.deepEqual(presets.map((preset) => preset.id), ['x']);
});

test('行注释里的方括号和撇号不会截断列表（注释是文字，不是结构）', () => {
  const presets = parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  // 参考 [1] 与 [2]，这里的两个方括号不该让扫描提前收尾
  {
    id: 'a',
    name: 'A',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'A' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  },
  // don't remove this preset
  /* 块注释里也能放 ] } ' " 这些字符 */
  {
    id: 'b',
    name: 'B',
    geolocation: { latitude: 3, longitude: 4, accuracy: 50, country: 'B' },
    language: { language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'ja-JP' },
    timezone: { timezone: 'Asia/Tokyo' }
  }
];`);
  assert.deepEqual(presets.map((preset) => preset.id), ['a', 'b']);
});

test('注释里提到 DEFAULT_PROFILES 不会把起点带偏', () => {
  const presets = parsePresets(`// 下面这个列表就是 export const DEFAULT_PROFILES 的本体
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'only',
    name: 'Only',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'Only' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  }
];`);
  assert.deepEqual(presets.map((preset) => preset.id), ['only']);
});

test('字符串里的 // 不算注释', () => {
  const presets = parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'url',
    name: 'Url',
    description: 'see https://example.com/docs',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'Url' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  }
];`);
  assert.equal(presets[0].description, 'see https://example.com/docs');
});

test('块注释未闭合直接报错（源码被截断时不能静默少几个 preset）', () => {
  assert.throws(
    () => parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  /* 没闭合的注释
  { id: 'x' }
];`),
    /块注释没有闭合/
  );
});

test('多行嵌套写法的 preset 也能解析（按大括号配对，不按行切）', () => {
  const presets = parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'multi',
    name: 'Multi',
    description: '多行',
    geolocation: {
      latitude: 10,
      longitude: 20,
      accuracy: 50,
      country: 'Multi'
    },
    language: { language: 'de-DE', languages: ['de-DE'], acceptLanguage: 'de-DE' },
    timezone: { timezone: 'Europe/Berlin' }
  },
  {
    id: 'second',
    name: 'Second',
    geolocation: { latitude: -1, longitude: -2, accuracy: 50, country: 'Second' },
    language: { language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'ja-JP' },
    timezone: { timezone: 'Asia/Tokyo' }
  }
];`);
  assert.deepEqual(presets.map((preset) => preset.id), ['multi', 'second']);
  assert.equal(presets[0].geolocation.latitude, 10);
});

test('缺少必填字段时抛错并指出是哪个 preset', () => {
  assert.throws(
    () => parsePresets(`export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'broken',
    name: 'Broken',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'X' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' }
  }
];`),
    /preset "broken" 缺少字段 timezone/
  );
});

test('id 重复时抛错', () => {
  const duplicated = `export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'same',
    geolocation: { latitude: 1, longitude: 2, accuracy: 50, country: 'X' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  },
  {
    id: 'same',
    geolocation: { latitude: 3, longitude: 4, accuracy: 50, country: 'Y' },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' }
  }
];`;
  assert.throws(() => parsePresets(duplicated), /preset id 重复：same/);
});

test('id 唯一，且解析器读到的源码就是磁盘上的源码', () => {
  const ids = DEFAULT_PROFILES.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(parsePresets(SOURCE).map((preset) => preset.id), ids);
});

test('us-west 预设：洛杉矶坐标 + 太平洋时区 + en-US', () => {
  const preset = DEFAULT_PROFILES.find((profile) => profile.id === 'us-west');
  assert.ok(preset, 'DEFAULT_PROFILES 里没有 us-west');
  assert.equal(preset.geolocation.latitude, 34.0522);
  assert.equal(preset.geolocation.longitude, -118.2437);
  assert.equal(preset.geolocation.country, 'United States');
  assert.equal(preset.language.language, 'en-US');
  assert.equal(preset.timezone.timezone, 'America/Los_Angeles');
});

test('内置预设只留美西 / 新加坡 / 日本', () => {
  // 只保留真的会买 VPS 的三个地区：其余地区放进快速配置区只会变成一排用不上的按钮
  assert.deepEqual(DEFAULT_PROFILES.map((profile) => profile.id), ['us-west', 'singapore', 'japan']);
  assert.equal(DEFAULT_PROFILES[0].timezone.timezone, 'America/Los_Angeles');
  assert.equal(DEFAULT_PROFILES[1].timezone.timezone, 'Asia/Singapore');
  assert.equal(DEFAULT_PROFILES[2].timezone.timezone, 'Asia/Tokyo');
});

test('每个 preset 都能通过 validateProfile 与时区校验', () => {
  for (const preset of DEFAULT_PROFILES) {
    assert.equal(validateProfile(preset), true, `${preset.id} 不是合法 profile`);
    assert.equal(validateTimezone(preset.timezone.timezone), true, `${preset.id} 时区非法`);
    assert.ok(preset.geolocation.accuracy > 0);
    assert.ok(preset.name && preset.description);
  }
});

test('每个 preset 的 acceptLanguage 与 languages 自洽', () => {
  for (const preset of DEFAULT_PROFILES) {
    const entries = parseAcceptLanguage(preset.language.acceptLanguage);
    assert.equal(entries[0].tag, preset.language.language, `${preset.id} 首选语言与 language 不一致`);
    assert.equal(entries[0].q, 1, `${preset.id} 首选语言权重不是 1`);
    for (const language of preset.language.languages) {
      assert.ok(
        entries.some((entry) => entry.tag === language),
        `${preset.id} 的 languages 里有 ${language}，acceptLanguage 里没有`
      );
    }
    const weights = entries.map((entry) => entry.q);
    assert.deepEqual(weights, [...weights].sort((a, b) => b - a), `${preset.id} 的 q 值不是降序`);
    assert.equal(preset.language.languages[0], preset.language.language, `${preset.id} languages 首位不是 language`);
  }
});

test('坐标与时区匹配（跨时区不一致的 preset 会暴露成显眼的地理矛盾）', () => {
  for (const preset of DEFAULT_PROFILES) {
    const offset = getTimezoneOffsetMinutes(preset.timezone.timezone, WINTER);
    assert.ok(offset !== null, `${preset.id} 时区算不出偏移`);
    // getTimezoneOffset 的符号是"西为正"，经度 15°≈1 小时
    const expected = -preset.geolocation.longitude / 15 * 60;
    const deviation = Math.abs(offset - expected);
    assert.ok(
      deviation <= 180,
      `${preset.id} 的经度 ${preset.geolocation.longitude} 与 ${preset.timezone.timezone} 差 ${Math.round(deviation / 60)} 小时`
    );
  }
});

test('applyProfileToConfig 每个 preset 都落到手动坐标 + preset 语言', () => {
  const base = normalizeConfig({});
  for (const preset of DEFAULT_PROFILES) {
    const applied = applyProfileToConfig(base, preset.id);
    assert.equal(applied.profile.activeProfileId, preset.id);
    assert.equal(applied.globalProfile.geolocation.mode, 'manual');
    assert.equal(applied.globalProfile.geolocation.latitude, preset.geolocation.latitude);
    assert.equal(applied.globalProfile.geolocation.longitude, preset.geolocation.longitude);
    assert.equal(applied.globalProfile.geolocation.country, preset.geolocation.country);
    assert.equal(applied.globalProfile.timezone.mode, 'manual');
    assert.equal(applied.globalProfile.timezone.timezone, preset.timezone.timezone);
    assert.equal(applied.globalProfile.language.mode, 'preset');
    assert.equal(applied.globalProfile.language.language, preset.language.language);
    assert.equal(applied.globalProfile.language.acceptLanguage, preset.language.acceptLanguage);
    // 再规范化一次不应触发任何变化（preset 的值必须已经是规范形态）
    assert.deepEqual(normalizeConfig(applied), applied);
  }
});

test('老配置里没有新 preset 时，按 id 应用仍然生效', () => {
  // 用户的存储里只有 5 个旧 preset（升级前写的），点"美西"不应该没反应
  const legacy = normalizeConfig({});
  legacy.profile.profiles = legacy.profile.profiles.filter((profile) => profile.id !== 'us-west');
  const applied = applyProfileToConfig(legacy, 'us-west');
  assert.equal(applied.profile.activeProfileId, 'us-west');
  assert.equal(applied.globalProfile.timezone.timezone, 'America/Los_Angeles');
});
test('popup 的 preset 卡片与 DEFAULT_PROFILES 一一对应', () => {
  // 卡片是静态 HTML，加 preset 时最容易忘的就是这两处对不上：
  // 少了卡片 → 用户看不到新 preset；多了卡片 → 点了没反应（applyProfile 找不到 id）。
  const html = readFileSync(join(ROOT, 'src', 'popup', 'popup.html'), 'utf8');
  const ids = [...html.matchAll(/data-profile="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, DEFAULT_PROFILES.map((profile) => profile.id));
});

test('字符串里的转义撇号不会把字段截断', () => {
  const source = `export const DEFAULT_PROFILES: ProfilePreset[] = [
  {
    id: 'ci',
    name: 'Cote d\\'Ivoire',
    description: '',
    geolocation: { latitude: 5.36, longitude: -4.0083, country: 'CI' },
    language: { language: 'fr-FR', languages: ['fr-FR'], acceptLanguage: 'fr-FR' },
    timezone: { timezone: 'Africa/Abidjan' }
  }
];`;
  assert.ok(source.includes("\\'"), '这条用例必须真的把反斜杠写进源码文本');
  const [preset] = parsePresets(source);
  assert.equal(preset.name, "Cote d'Ivoire");
});

test('精度默认值与扩展内的 DEFAULT_GEOLOCATION.accuracy 同源', () => {
  // 两处各写一个默认值，烘焙产物（走 presets.mjs）和扩展内预设页（走 config-model）
  // 就会给出不同精度，而现象只是"数字不一样"，很难联想到是两个常量
  assert.equal(DEFAULT_PRESET_ACCURACY, DEFAULT_GEOLOCATION.accuracy);
  for (const preset of readPresets(ROOT)) {
    assert.equal(preset.geolocation.accuracy, DEFAULT_PRESET_ACCURACY, `${preset.id} 的精度`);
  }
});

test('DEFAULT_PROFILES 前缀相同的标识符不会把起点带偏', () => {
  const source = `export const DEFAULT_PROFILES_OLD = [];\nexport const DEFAULT_PROFILES: ProfilePreset[] = [\n  {\n    id: 'x',\n    name: 'X',\n    description: '',\n    geolocation: { latitude: 1, longitude: 2, country: '' },\n    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },\n    timezone: { timezone: 'UTC' }\n  }\n];`;
  const presets = parsePresets(source);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, 'x');
});
