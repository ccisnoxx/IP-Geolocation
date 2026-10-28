// 回归工具：三上下文一致性烟测既要能证明一致，也要能证明它抓得住不一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts/smoke-fingerprint.mjs');
const runner = join(root, 'node_modules/tsx/dist/cli.mjs');

function smoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(runner, [script, ...args], { cwd: root }, (error, stdout, stderr) => {
      done({ code: error ? (error.code as number ?? 1) : 0, stdout, stderr });
    });
  });
}

test('内置预设下顶层/iframe/Worker 三处时区与语言完全一致', async () => {
  const result = await smoke(['--persona', 'japan-tokyo']);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1));
  assert.equal(report.consistent, true, JSON.stringify(report.failures));
  assert.deepEqual(Object.keys(report.contexts), ['top', 'iframe', 'worker']);
  for (const context of Object.values(report.contexts) as any[]) {
    assert.equal(context.timezone, 'Asia/Tokyo');
    assert.equal(context.language, 'ja-JP');
    assert.deepEqual(context.languages, ['ja-JP', 'ja', 'en-US', 'en']);
  }
});

test('自检模式注入偏离后，工具非零退出并点名不一致字段', async () => {
  const result = await smoke(['--persona', 'us-los-angeles', '--selftest-mismatch']);
  assert.equal(result.code, 1, '比对逻辑必须把 Worker 的偏离算作失败');
  assert.match(result.stderr, /timezone/);
});

test('未知预设直接拒绝，不产生假绿报告', async () => {
  const result = await smoke(['--persona', 'mars-base']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /未知预设/);
});
