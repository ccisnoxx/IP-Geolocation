// 回归工具：三上下文一致性烟测既要能证明一致，也要能证明它抓得住不一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { sampleFingerprintRealm, fingerprintFailures } from '../scripts/fingerprint-realms';
import { generateBlobWorkerRuntime, generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';

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
    assert.equal(context.offset, -540);
    assert.equal(context.locale, 'ja-JP');
    assert.equal(context.language, 'ja-JP');
    assert.deepEqual(context.languages, ['ja-JP', 'ja', 'en-US', 'en']);
  }
});

test('不同预期的独立 realm 不污染宿主；相等的未打补丁样本和遗漏 Worker 补丁都必须失败', async () => {
  const nativeIntl = Intl.DateTimeFormat;
  const nativeOffset = Date.prototype.getTimezoneOffset;
  const page = assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime');
  const worker = assertSelfContainedFunction((await generateBlobWorkerRuntime()).code, 'applyBlobWorkerRuntime');
  const tokyo = { intlMode: 'strict' as const, timezone: 'Asia/Tokyo', language: { language: 'ja-JP', languages: ['ja-JP', 'ja'] } };
  const la = { intlMode: 'strict' as const, timezone: 'America/Los_Angeles', language: { language: 'en-US', languages: ['en-US', 'en'] } };
  assert.equal(sampleFingerprintRealm(page, tokyo, 'top').actual.offset, -540);
  const laSample = sampleFingerprintRealm(worker, la, 'worker');
  assert.equal(laSample.actual.timezone, la.timezone);
  assert.equal(laSample.actual.offset, 480);
  assert.equal(Intl.DateTimeFormat, nativeIntl);
  assert.equal(Date.prototype.getTimezoneOffset, nativeOffset);
  const noOp = 'function noOp() {}';
  const noOpSamples = { top: sampleFingerprintRealm(noOp, tokyo, 'top'), iframe: sampleFingerprintRealm(noOp, tokyo, 'iframe'), worker: sampleFingerprintRealm(noOp, tokyo, 'worker') };
  assert.ok(fingerprintFailures(tokyo, noOpSamples).some(failure => failure.includes('worker.language')));
  const samples = { top: sampleFingerprintRealm(page, tokyo, 'top'), iframe: sampleFingerprintRealm(page, tokyo, 'iframe'), worker: noOpSamples.worker };
  assert.ok(fingerprintFailures(tokyo, samples).some(failure => failure.includes('worker.timezone')));
  samples.worker = sampleFingerprintRealm(worker, tokyo, 'worker');
  assert.deepEqual(fingerprintFailures(tokyo, samples), []);
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

test('时区别名及locale均沿用原生构造器规范化，空备用语言列表回退主语言', async () => {
  const result = await smoke(['--timezone', 'Asia/Kolkata', '--language', 'en-US', '--languages', 'en-US,en']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const page = assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime');
  const worker = assertSelfContainedFunction((await generateBlobWorkerRuntime()).code, 'applyBlobWorkerRuntime');
  for (const intlMode of ['strict', 'compatible'] as const) {
    const payload = { intlMode, timezone: 'Asia/Kolkata', language: { language: 'ja-jp', languages: [] } };
    const samples = { top: sampleFingerprintRealm(page, payload, 'top'), iframe: sampleFingerprintRealm(page, payload, 'iframe'),
      worker: sampleFingerprintRealm(worker, payload, 'worker') };
    assert.deepEqual(fingerprintFailures(payload, samples), []);
    assert.deepEqual(samples.worker.actual.languages, ['ja-jp']);
    assert.equal(samples.worker.actual.locale, 'ja-JP');
    assert.equal(samples.worker.actual.offset, -330);
  }
});
