import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_FONT_FAMILY, rewriteFontString, splitFontFamilies } from '../src/injected/font-mask';
import { workerPatch } from '../src/injected/worker-patch';

/**
 * "隐藏一个字体"必须和"这台机器真没有这个字体"长得一模一样。
 *
 * 这一组断言直接对着"检测脚本会怎么量"来写：一个假的 2D 上下文，按真实规则解析
 * font 串 —— 命中已知族名就用它的宽度，一个都没有就回落到默认字体。数字取自真机
 * 实测（真 Mac，16px，`MMMM`）：monospace 38.53、sans-serif 56.45、串里塞一个不存在
 * 的族名也是 56.45。
 */

const MONO = 38.53;
const SANS = 56.45;
const SERIF = 54.21;
const PINGFANG = 61.2;

const KNOWN: Record<string, number> = {
  monospace: MONO,
  'sans-serif': SANS,
  serif: SERIF,
  'pingfang sc': PINGFANG
};

/** 与浏览器一致：从左到右找第一个**存在**的族名，都没有就回落默认字体 */
function measure(font: string): number {
  const sizeMatch = font.match(/(?:\d*\.)?\d+px/i);
  const rest = sizeMatch ? font.slice((sizeMatch.index || 0) + sizeMatch[0].length) : font;
  const families = splitFontFamilies(rest).map((family) => family.replace(/^['"]|['"]$/g, '').toLowerCase());
  for (const family of families) {
    if (KNOWN[family] !== undefined) return KNOWN[family];
  }
  return SANS;
}

const isPingFang = (family: string) => family.replace(/^['"]|['"]$/g, '').toLowerCase() === 'pingfang sc';

test('没有回退族名时：隐藏结果与"真缺失"完全等宽', () => {
  const masked = rewriteFontString('16px "PingFang SC"', isPingFang);
  assert.ok(masked, '命中目标字体必须改写');
  assert.equal(measure(masked!), measure('16px "NoSuchFontZzz123"'), '必须和随便编一个不存在族名量出来的一样');
  assert.equal(measure(masked!), measure('16px "__another_missing__"'), '对照组换成别的名字也必须一致');
});

test('没有回退族名时：不能退化成等宽字体（这是上一版的破绽）', () => {
  const masked = rewriteFontString('16px "PingFang SC"', isPingFang)!;
  assert.notEqual(measure(masked), MONO, '填 monospace 会量出 38.53，而真缺失是 56.45，差 18px');
  assert.equal(measure(masked), SANS);
});

test('页面自带回退族名时：变成回退族名本身，与检测方的基线逐字节相同', () => {
  for (const fallback of ['sans-serif', 'serif', 'monospace']) {
    const masked = rewriteFontString(`72px "PingFang SC", ${fallback}`, isPingFang)!;
    assert.equal(masked, `72px ${fallback}`, '回退族名要留下，别整个替换');
    assert.equal(measure(masked), measure(`72px ${fallback}`), '与基线测量的差值必须为 0');
  }
});

test('多个族名只摘命中的那些，其余保持原样', () => {
  const masked = rewriteFontString('16px "PingFang SC", Helvetica, monospace', isPingFang)!;
  assert.equal(masked, '16px Helvetica, monospace');
});

test('没命中就返回 null，调用方走原生度量（不做无谓改写）', () => {
  assert.equal(rewriteFontString('16px Helvetica', isPingFang), null);
  assert.equal(rewriteFontString('16px "Helvetica Neue"', isPingFang), null);
  assert.equal(rewriteFontString('', isPingFang), null);
});

test('引号里的逗号不是族名分隔符', () => {
  assert.deepEqual(splitFontFamilies('"Foo, Bar", monospace'), ['"Foo, Bar"', 'monospace']);
  assert.deepEqual(splitFontFamilies("'Foo, Bar', serif"), ["'Foo, Bar'", 'serif']);
});

test('Worker 里的兜底族名与主线程同源（那份代码被 toString 塞进 blob，无法 import）', () => {
  const source = workerPatch.toString();
  assert.ok(
    source.includes(MISSING_FONT_FAMILY),
    `worker 里的兜底族名与 font-mask.ts 不一致：${MISSING_FONT_FAMILY}`
  );
  // 只允许出现这一处兜底；出现 monospace 兜底说明有一边没改到
  assert.doesNotMatch(
    source,
    /kept\.length \? kept\.join\(', '\) : 'monospace'/,
    'worker 还在用 monospace 兜底'
  );
});