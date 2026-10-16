import assert from 'node:assert/strict';
import test from 'node:test';
import { chromeSandboxStatus } from './chrome-sandbox-status.mjs';
test('Linux SUID 与 namespace 第一层均可用；任一必要自检缺失都不通过', () => {
  const base = 'PID namespaces Yes\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes\nYou are adequately sandboxed.';
  for (const layer of ['SUID sandbox Yes', 'Namespace sandbox Yes', 'Layer 1 Sandbox\tNamespace']) {
    assert.equal(chromeSandboxStatus(`${layer}\n${base}`).status, 'PASS');
  }
  assert.equal(chromeSandboxStatus(base).status, 'UNKNOWN');
  assert.equal(chromeSandboxStatus(`SUID sandbox Yes\n${base.replace('Seccomp-BPF sandbox Yes', 'Seccomp-BPF sandbox No')}`).status, 'UNKNOWN');
});
