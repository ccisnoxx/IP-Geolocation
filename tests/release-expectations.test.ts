import test from 'node:test';
import assert from 'node:assert/strict';
import { inferBakedFields, headerLocaleFromRules, resolveExpectations } from '../tools/lib/release-expectations.mjs';

/**
 * 这一层是「发布验证的恒真断言」的补丁。
 *
 * 旧版 verify-release.mjs 在没有期望值时走 `first.tz !== 本机时区 || true` ——
 * 断言恒真，"验证通过"什么都没证明。修法是从包里推断期望值；推断不出来就判失败。
 * 下面的用例钉住"能推断出来"和"推断不出来"这两条路径。
 */

// 与 dist/injected/runtime.js 里的烘焙字面量同形：键名不带引号，值是字符串
const BAKED_SOURCE = `
var define_VANISHGEO_BAKED_default = { config: { masterEnabled: true, debugMode: false,
  globalProfile: { language: { enabled: true, mode: "preset", language: "ja-JP",
    languages: ["ja-JP", "ja", "en-US", "en"], acceptLanguage: "ja-JP,ja;q=0.9" },
    timezone: { enabled: true, mode: "manual", timezone: "Asia/Tokyo" },
    geolocation: { enabled: true, mode: "manual", latitude: 35.6895 } },
  rules: [ { id: "rule-0", domain: "chatgpt.com", enabled: true,
    overrides: { language: { mode: "inherit", value: null }, timezone: { mode: "inherit", value: null } } } ] },
  lastLocation: null };
`;

const RULES = [
  {
    id: 1,
    action: { requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: 'ja-JP,ja;q=0.9,en-US;q=0.8' }] },
    condition: { requestDomains: ['chatgpt.com'] }
  }
];

test('从烘焙字面量里取到 timezone / locale', () => {
  assert.deepEqual(inferBakedFields(BAKED_SOURCE), { timezone: 'Asia/Tokyo', locale: 'ja-JP' });
});

test('override 里的 inherit 规则不会被误当成烘焙值', () => {
  // rules[].overrides 里同样有 timezone: / language: 键，但没有内层同名字符串
  const onlyOverrides = `
    { config: { rules: [ { overrides: { language: { mode: "inherit", value: null },
      timezone: { mode: "inherit", value: null } } } ] } }`;
  assert.deepEqual(inferBakedFields(onlyOverrides), { timezone: null, locale: null });
});

test('Accept-Language 的首段就是 locale', () => {
  assert.equal(headerLocaleFromRules(RULES), 'ja-JP');
  assert.equal(headerLocaleFromRules([]), null);
  assert.equal(headerLocaleFromRules(null), null);
  assert.equal(headerLocaleFromRules([{ action: { requestHeaders: [{ header: 'Accept', value: 'x' }] } }]), null);
});

test('没清单时从包里推断期望值（发布附件通常只有 zip）', () => {
  const resolved = resolveExpectations({ source: BAKED_SOURCE, rules: RULES });
  assert.equal(resolved.expectTz, 'Asia/Tokyo');
  assert.equal(resolved.expectLocale, 'ja-JP');
});

test('发布清单优先于包内推断', () => {
  const resolved = resolveExpectations({
    summary: { timezone: 'America/New_York', locale: 'en-US' },
    source: BAKED_SOURCE,
    rules: RULES
  });
  assert.equal(resolved.expectTz, 'America/New_York');
  assert.equal(resolved.expectLocale, 'en-US');
});

test('烘焙值缺失时退回静态请求头；全都缺失就留 null（调用方必须判失败）', () => {
  const fromHeader = resolveExpectations({ source: 'var x = 1;', rules: RULES });
  assert.equal(fromHeader.expectTz, null);
  assert.equal(fromHeader.expectLocale, 'ja-JP');

  const nothing = resolveExpectations({});
  assert.equal(nothing.expectTz, null);
  assert.equal(nothing.expectLocale, null);
});

test('跨层一致性靠 bakedLocale 与 headerLocale 两个字段暴露', () => {
  const same = resolveExpectations({ source: BAKED_SOURCE, rules: RULES });
  assert.equal(same.bakedLocale, same.headerLocale);

  const conflicting = RULES.map((rule) => ({
    ...rule,
    action: { requestHeaders: [{ header: 'Accept-Language', value: 'en-US,en;q=0.9' }] }
  }));
  const mismatch = resolveExpectations({ source: BAKED_SOURCE, rules: conflicting });
  assert.equal(mismatch.expectLocale, 'ja-JP', '烘焙值优先');
  assert.notEqual(mismatch.headerLocale, mismatch.bakedLocale);
});
