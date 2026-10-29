import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * `npm run preflight` 守的是"发版前那九件事一件都不漏"，所以它自己也得有人守。
 *
 * 两个方向都会腐化：
 *   1. CI 加了冒烟脚本，preflight 没跟着加 → 本地过了、CI 红；
 *   2. preflight 的清单写死了一份副本，某天有人只改了 CI 的循环 → 两边悄悄分叉。
 * 这条测试把两边对起来：CI 循环里的每个脚本名都必须在 preflight 的 SMOKES 里出现，
 * 反过来 preflight 也不许出现脚本文件不存在的名字（写完删文件这种）。
 */
const preflight = readFileSync('tools/preflight.mjs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function ciSmokeNames() {
  // 抓 `for script in presets frames … popup; do` 这一段（含反斜杠续行）
  const block = ci.match(/for script in ([\s\S]*?);\s*do/);
  assert.ok(block, 'ci.yml 里找不到离线冒烟的循环，测试要跟着改');
  return block[1]
    .replace(/\\\n/g, '\n')
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function preflightSmokeNames() {
  const block = preflight.match(/const SMOKES = \[([\s\S]*?)\];/);
  assert.ok(block, 'preflight.mjs 里找不到 SMOKES 清单');
  return [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

test('preflight 的冒烟清单与 CI 循环一一对应', () => {
  const fromCi = ciSmokeNames();
  const fromPreflight = preflightSmokeNames();
  assert.ok(fromCi.length >= 10, `CI 里至少应该有 10 条在线冒烟，实际 ${fromCi.length}`);
  assert.deepEqual(
    [...fromCi].sort(),
    [...fromPreflight].sort(),
    '两边清单不一致 —— 本地全绿但 CI 红的经典来源'
  );
});

test('preflight 覆盖发布清单里的每一关', () => {
  // 这些 id 对应 RELEASE.md「发布前检查清单」的条目，缺一条就等于清单可以被人跳过
  for (const id of ['verify', 'coverage', 'build', 'audit', 'package', 'release-smoke', 'stray', 'version']) {
    assert.ok(preflight.includes(`'${id}'`), `preflight 少了 ${id} 这一关`);
  }
});

test('需要构建产物的阶段自己声明依赖，不靠调用顺序', () => {
  // options / popup 跑的是构建产物。之前 --only=smoke 会跳过 persona，
  // 于是这两条报"找不到构建产物"——看着像扩展坏了，其实是 preflight 的排序问题。
  assert.match(preflight, /deps: \/\^\(options\|popup\)\$\//, 'options / popup 没声明 persona 依赖');
  assert.ok(preflight.includes('function buildPlan()'), '缺依赖闭包，被依赖的阶段不会被补进来');
  // 重复 flag 要累积，否则 --skip=a --skip=b 里 b 会盖掉 a
  assert.ok(preflight.includes('flags.set(name, [...(flags.get(name) || []),'), 'flag 解析会互相覆盖');
});

test('preflight 能用 npm run 起来，且不把审查逻辑再写一遍', () => {
  assert.equal(pkg.scripts.preflight, 'node tools/preflight.mjs');
  // 每关都该是一次真实子进程调用：出现自造的断言循环就是第二套真相
  for (const banned of ['assert.equal(', 'results.push({ name']) {
    assert.equal(preflight.includes(banned), false, `preflight 里不该出现 ${banned}`);
  }
});
