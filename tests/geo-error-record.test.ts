import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * `lastGeoError` 与 `lastGeoErrorAt` 是**成对**的存储键：配置页靠它们渲染
 * 「上次自动定位没成功」卡片，缺了时间就只能显示一条不知道多久以前发生的错误。
 *
 * 这条测试守的是源码不变式 —— 后台有四处失败写入（IP 定位接口全挂 / 更新异常 /
 * 手点「从 IP 自动配置」失败 / 该流程抛错）和两处成功清空，全靠人肉记得成对写。
 * 以后再加一个写入点却忘了时间戳，这里会先红，而不是等用户在配置页上看到
 * "刚刚"这个词出现在三天前的错误旁边。
 */
const source = readFileSync('src/background/services.ts', 'utf8');

test('每次写 lastGeoError 都同时写 lastGeoErrorAt', () => {
  const lines = source.split('\n');
  const errorLines = lines
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /lastGeoError\s*:/.test(line));

  assert.ok(errorLines.length >= 3, `至少要有失败写入与成功清空两类，实际 ${errorLines.length} 处`);
  const missing = errorLines.filter(({ line }) => !/lastGeoErrorAt\s*:/.test(line));
  assert.deepEqual(
    missing.map(({ index, line }) => `${index}: ${line.trim()}`),
    [],
    '这些写入点只写了原文没写时间戳'
  );

  // 反过来也要成立：不能只有时间没有原文（那会渲染出一张没有内容的卡片）
  const timeLines = lines.filter((line) => /lastGeoErrorAt\s*:/.test(line));
  assert.equal(timeLines.length, errorLines.length, 'lastGeoError 与 lastGeoErrorAt 的写入点数量必须一致');
});

test('失败统一走 recordGeoError，成功统一成对清空', () => {
  // 助手函数本身：一处定义，成对写两个 key
  assert.match(source, /async function recordGeoError\(message: string\): Promise<void> \{[\s\S]*?lastGeoError: message, lastGeoErrorAt: new Date\(\)\.toISOString\(\)/);

  // 散落的 `lastGeoError: message` 只允许出现在助手函数与成功清空两处
  const inlineWrites = source
    .split('\n')
    .filter((line) => /lastGeoError\s*:/.test(line))
    .filter((line) => !/lastGeoErrorAt/.test(line));
  assert.deepEqual(inlineWrites, [], '失败写入必须走 recordGeoError（否则时间戳会漏）');

  // 成功路径：两处写 lastLocation 时把错误一起清空
  const clears = source.split('\n').filter((line) => /lastGeoError: ''/.test(line));
  assert.equal(clears.length, 2, `成功清空应该有 2 处（updateGeolocation / writeLastLocation），实际 ${clears.length}`);
  for (const line of clears) {
    assert.match(line, /lastGeoErrorAt: ''/, '清空时两个 key 要一起清，否则卡片会剩一个空时间');
  }
});
