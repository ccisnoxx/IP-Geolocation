import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

const execute = promisify(execFile);
// 本任务独占实例，无 host 文件系统挂载；不接受任意外接 Chrome/CDP。
const instance = 'vg-userscripts-fixture';
const directory = fileURLToPath(new URL('./', import.meta.url));
const shell = args => execute('limactl', ['shell', '--workdir', '/tmp', instance, '--', ...args], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
export async function collectInsideLinuxVmGuard(options = {}) {
  let stage, child, result, coordinatorCopied = false, interrupted = false;
  const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    stage = (await shell(['mktemp', '-d', '/tmp/vg-userscripts-stage-XXXXXXXX'])).stdout.trim();
    if (!/^\/tmp\/vg-userscripts-stage-[A-Za-z0-9]+$/.test(stage)) throw new Error('LINUX_VM_STAGE_INVALID');
    const files = (await readdir(directory)).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
    await execute('limactl', ['copy', ...files.map(name => directory + name), `${instance}:${stage}/`], { timeout: 30000 });
    coordinatorCopied = true;
    await execute('limactl', ['copy', '-r', directory + 'extension', `${instance}:${stage}/`], { timeout: 30000 });
    if (options.production) await execute('limactl', ['copy', '-r', fileURLToPath(new URL('../../dist', import.meta.url)), `${instance}:${stage}/dist`], { timeout: 30000 });
    if (interrupted) throw new Error('GUARDED_COLLECTOR_INTERRUPTED');
    child = spawn('limactl', ['shell', '--workdir', '/tmp', instance, '--', 'sudo', '/usr/local/bin/node', `${stage}/linux-netns.mjs`,
      ...(options.production ? ['--production', ...(options.recoveryOnly ? ['--recovery-only'] : [])] : [])],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 195000);
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.length > 2 * 1024 * 1024) child.kill('SIGTERM');
    });
    let code;
    try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
    finally { clearTimeout(timer); }
    if (interrupted) throw new Error('GUARDED_COLLECTOR_INTERRUPTED');
    if (code !== 0) throw new Error('LINUX_VM_COLLECTOR_FAILED');
    result = JSON.parse(output);
    return result;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (stage) {
      try {
        if (coordinatorCopied) await shell(['sudo', '/usr/local/bin/node', `${stage}/linux-netns.mjs`, '--cleanup']);
        await shell(['rm', '-r', stage]);
        if (result) result.cleanup.staging = 'PASS';
      } catch {
        if (!result) throw new Error('LINUX_VM_STAGE_CLEANUP_FAILED');
        result.cleanup.status = 'FAIL';
        result.cleanup.staging = 'FAIL';
        result.cleanup.failures.push('LINUX_VM_STAGE_CLEANUP_FAILED');
        result.stopReason ??= 'CLEANUP_FAILED';
      }
    }
  }
}
