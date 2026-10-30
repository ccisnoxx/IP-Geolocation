#!/usr/bin/env node
/*
 * 安全模块的逐文件分支覆盖率门禁。
 *
 *   node scripts/coverage-security.mjs
 *   node scripts/coverage-security.mjs --verbose
 *
 * 为什么另起一条门禁，而不是把文件塞进 `test:coverage:core`：
 *
 *  - core 那条盯的是"配置解析 + DNR 构建 + 内容桥"这些**纯逻辑**，都在 85% 以上；
 *  - 这里的文件是**安全决策点**（消息来源策略、opaque frame 证据、函数伪装、
 *    补丁开关、Worker 更新），它们的失败方式不是"功能不对"而是"页面能看出被改过"，
 *    所以门禁按文件设阈值，并且**阈值取当前实际值向下取整后的保守值**：
 *    任何一次让分支悄悄失去覆盖的改动都会当场失败。
 *
 * worker-patch.ts 不在阈值表里：它的实现是以字符串塞进 blob 在 Worker 里跑起来的，
 * c8 只能看到模块顶层那几行。"Worker 补丁是 strict、函数形状是原生"由
 * tests/disguise-shape.test.ts 的 blob 用例盯着（真在 vm 里跑一遍源码）。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

/** 阈值是"不许退步"的地板，不是理想值 —— 调高需要先把测试补上。 */
const TARGETS = [
  { file: 'src/background/message-policy.ts', branches: 95, why: '后台消息来源策略：谁能调哪个 action' },
  { file: 'src/background/blob-frames.ts', branches: 90, why: 'opaque frame 证据：文档身份与父链' },
  { file: 'src/background/frame-receipts.ts', branches: 90, why: 'frame 收据：过期与替换' },
  { file: 'src/injected/patch-needs.ts', branches: 85, why: '要不要打补丁（漏判 = 请求头对、页面值原生）' },
  { file: 'src/injected/disguise.ts', branches: 85, why: '函数伪装与 toString 安装/还原' },
  { file: 'src/injected/signal-spoof.ts', branches: 60, why: 'Date / Intl / navigator 补丁（大量浏览器 API 失败分支）' }
];

/** 只做展示、不设门禁的文件（原因见文件头） */
const REPORT_ONLY = ['src/injected/worker-patch.ts'];

const reportDir = mkdtempSync(join(tmpdir(), 'vanishgeo-coverage-'));
const includes = [...TARGETS.map((item) => item.file), ...REPORT_ONLY].map((file) => `--include=${file}`);

const c8 = join(ROOT, 'node_modules', '.bin', 'c8');
const tx = join(ROOT, 'node_modules', '.bin', 'tsx');
const result = spawnSync(c8, [
  ...includes,
  '--reporter=text',
  '--reporter=json-summary',
  `--report-dir=${reportDir}`,
  tx,
  '--test',
  'tests/*.test.ts'
], { cwd: ROOT, stdio: verbose ? 'inherit' : ['ignore', 'inherit', 'inherit'], env: process.env });

if (result.status !== 0) {
  rmSync(reportDir, { recursive: true, force: true });
  console.error('\n✗ 测试本身没有通过，覆盖率门禁不评估');
  process.exit(result.status || 1);
}

const summary = JSON.parse(readFileSync(join(reportDir, 'coverage-summary.json'), 'utf8'));
rmSync(reportDir, { recursive: true, force: true });

const byFile = new Map();
for (const [key, value] of Object.entries(summary)) {
  if (key === 'total') continue;
  const rel = key.slice(ROOT.length + 1).split('\\').join('/');
  byFile.set(rel, value);
}

const failures = [];
const rows = [];
for (const target of TARGETS) {
  const entry = byFile.get(target.file);
  if (!entry) {
    // 文件改名/删除后门禁不能变成"静默通过"
    failures.push(`${target.file}：覆盖率报告里没有这个文件（改名了？）`);
    rows.push([target.file, '缺失', `${target.branches}%`]);
    continue;
  }
  const actual = entry.branches.pct;
  rows.push([target.file, `${actual}%`, `${target.branches}%`]);
  if (actual < target.branches) {
    failures.push(`${target.file}：分支覆盖率 ${actual}% 低于门槛 ${target.branches}%（${target.why}）`);
  }
}

for (const file of REPORT_ONLY) {
  const entry = byFile.get(file);
  rows.push([file, entry ? `${entry.branches.pct}%（不计入）` : '缺失', '—']);
}

const width = Math.max(...rows.map((row) => row[0].length));
console.log('\n安全模块分支覆盖率门禁');
for (const [file, actual, required] of rows) {
  const mark = required !== '—' && actual !== '缺失' && Number.parseFloat(actual) < Number.parseFloat(required) ? '✗' : '✓';
  console.log(`  ${mark} ${file.padEnd(width)}  ${String(actual).padStart(7)}  需要 ${required}`);
}
console.log('  · src/injected/worker-patch.ts 的执行体在 vm 里，c8 看不到；');
console.log('    它的守卫是 tests/disguise-shape.test.ts 里的 blob 形状用例。');

if (failures.length) {
  console.error('\n失败：');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\n全部 ${TARGETS.length} 个安全模块都达到各自门槛。`);