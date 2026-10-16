import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 只运行 true，无网络 I/O：比较同策略与保留 loopback、另加文件写入拒绝的不同策略。
export function probeSandboxReapplication() {
  const result = { backend: 'macOS-sandbox-exec', target: 'loopback-policy-plus-file-write-denial',
    firstApplication: 'UNKNOWN', samePolicyReapplication: 'UNKNOWN', distinctPolicyApplication: 'UNKNOWN', permissionDenied: false,
    firstExitCode: null, samePolicyExitCode: null, distinctPolicyExitCode: null, realChrome: false };
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return result;
  const profile = fileURLToPath(new URL('./loopback.sb', import.meta.url));
  const run = args => spawnSync('/usr/bin/sandbox-exec', args, { encoding: 'utf8', timeout: 5000 });
  const first = run(['-f', profile, '/usr/bin/true']);
  result.firstExitCode = first.status;
  if (first.status !== 0) return result;
  result.firstApplication = 'PASS';
  const nested = run(['-f', profile, '/usr/bin/sandbox-exec', '-f', profile, '/usr/bin/true']);
  result.samePolicyExitCode = nested.status;
  result.samePolicyReapplication = nested.status === 0 ? 'PASS' : 'UNKNOWN';
  const tighter = readFileSync(profile, 'utf8') + '\n(deny file-write*)\n';
  const distinct = run(['-f', profile, '/usr/bin/sandbox-exec', '-p', tighter, '/usr/bin/true']);
  result.distinctPolicyExitCode = distinct.status;
  if (distinct.status === 0) result.distinctPolicyApplication = 'PASS';
  else if (/sandbox_apply|sandbox_init/.test(distinct.stderr ?? '') &&
    /Operation not permitted|Permission denied/.test(distinct.stderr ?? '')) {
    result.distinctPolicyApplication = 'DENIED';
    result.permissionDenied = true;
  }
  return result;
}
