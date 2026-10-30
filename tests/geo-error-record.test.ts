import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * `lastGeoError` 与 `lastGeoErrorAt` 是**成对**的存储键：配置页靠它们渲染
 * 「上次自动定位没成功」卡片，缺了时间就只能显示一条不知道多久以前发生的错误。
 *
 * 这条测试守的是源码不变式 —— 失败统一记录，三个定位更新流程共用成功写入入口。
 * 以后再加一个写入点却忘了时间戳，这里会先红，而不是等用户在配置页上看到
 * "刚刚"这个词出现在三天前的错误旁边。
 */
const source = readFileSync('src/background/services.ts', 'utf8');

test('每次写 lastGeoError 都同时写 lastGeoErrorAt', () => {
  const lines = source.split('\n');
  const errorLines = lines
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /lastGeoError\s*:/.test(line));

  assert.equal(errorLines.length, 2, '只在 recordGeoError 记录失败、writeLastLocation 清空错误');
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

  // 成功路径：三个调用方统一委托唯一写入入口，错误与时间仍必须一起清空。
  const clears = source.split('\n').filter((line) => /lastGeoError: ''/.test(line));
  assert.equal(clears.length, 1, '成功清空只由 writeLastLocation 维护');
  for (const line of clears) {
    assert.match(line, /lastGeoErrorAt: ''/, '清空时两个 key 要一起清，否则卡片会剩一个空时间');
  }
  assert.match(source, /await writeLastLocation\(nextLocation\)/, '普通定位委托共同入口');
  assert.match(source, /await writeLastLocation\(plan.location\)/, '手动按出口配置委托共同入口');
  assert.match(source, /saveLocation: writeLastLocation/, '自动跟随出口委托共同入口');
});
