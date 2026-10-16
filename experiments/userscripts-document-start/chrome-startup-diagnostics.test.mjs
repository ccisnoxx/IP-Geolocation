import assert from 'node:assert/strict';
import test from 'node:test';
import { createChromeStartupDiagnostics } from './chrome-startup-diagnostics.mjs';
import { probeSandboxReapplication } from './sandbox-compatibility.mjs';

test('跨 stderr chunk 的 source 策略权限错误被精确识别，原始文本不导出', () => {
  const diagnostics = createChromeStartupDiagnostics();
  diagnostics.feed(Buffer.from('synthetic-prefix /synthetic/profile\nSandboxSerializer: Failed to initial'));
  diagnostics.feed(Buffer.from('ize sandbox with source mode policy: Operation not perm'));
  diagnostics.feed(Buffer.from('itted (1)'));
  diagnostics.finish();
  assert.deepEqual(diagnostics.result, { status: 'DENIED', policyMode: 'SOURCE', permissionDenied: true });
  assert.doesNotMatch(JSON.stringify(diagnostics.result), /synthetic|profile|prefix/);
});

test('compiled 策略权限错误同样拒绝；泛化 sandbox 日志和网络错误不冒充根因', () => {
  const compiled = createChromeStartupDiagnostics();
  compiled.feed(Buffer.from('SandboxSerializer: Failed to apply compiled policy: sandbox_apply: Permission denied\n'));
  assert.deepEqual(compiled.result, { status: 'DENIED', policyMode: 'COMPILED', permissionDenied: true });
  const unrelated = createChromeStartupDiagnostics();
  unrelated.feed(Buffer.from('sandbox initialization failed\nnetwork error: Operation not permitted\nSandboxSerializer: Failed to deserialize policy\n'));
  unrelated.finish();
  assert.equal(unrelated.result.status, 'NOT_OBSERVED');
});

test('实际无策略模式的权限错误跨 chunk 识别，不能猜测策略模式', () => {
  const diagnostics = createChromeStartupDiagnostics();
  diagnostics.feed(Buffer.from('Failed to initialize sandbox.sandbox initializ'));
  diagnostics.feed(Buffer.from('ation failed: Operation not perm'));
  diagnostics.feed(Buffer.from('itted\n'));
  diagnostics.finish();
  assert.deepEqual(diagnostics.result, { status: 'DENIED', policyMode: 'NOT_OBSERVED', permissionDenied: true });
});

test('本机同策略/不同且更严格策略的对照仅运行 true，不作为 Chrome 验收', {
  skip: process.platform !== 'darwin' ? '仅支持本机 macOS 后端' : false
}, () => {
  const result = probeSandboxReapplication();
  assert.equal(result.firstApplication, 'PASS');
  assert.ok(['PASS', 'UNKNOWN'].includes(result.samePolicyReapplication));
  assert.ok(['PASS', 'DENIED', 'UNKNOWN'].includes(result.distinctPolicyApplication));
  assert.equal(result.realChrome, false);
  if (result.distinctPolicyApplication === 'DENIED') {
    assert.equal(result.permissionDenied, true);
    assert.notEqual(result.distinctPolicyExitCode, 0);
  }
});
