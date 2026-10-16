import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// sandbox-exec 在 Node/Chrome 启动前应用内核策略；不接受外接、未受此策略约束的 Chrome。
export async function collectInsideLoopbackGuard(entry) {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw new Error('LOOPBACK_ENFORCEMENT_UNAVAILABLE');
  const temp = await mkdtemp(join(tmpdir(), 'vg-userscripts-'));
  const child = spawn('/usr/bin/sandbox-exec', [
    '-f', fileURLToPath(new URL('./loopback.sb', import.meta.url)), process.execPath, entry
  ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true,
    env: { ...process.env, VG_US_EXPERIMENT_TEMP: temp } });
  let interrupted = false;
  const terminateOwned = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  };
  const interrupt = () => { interrupted = true; terminateOwned(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try { return await new Promise((resolve, reject) => {
    let result;
    let duplicates = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // 连同本次派生的 Chrome 进程组一起终止，不能只杀 collector 留下浏览器。
      terminateOwned();
    }, 180000);
    child.on('message', message => {
      if (message?.type !== 'experiment-evidence') return;
      if (result) duplicates = true;
      result = message.evidence;
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('LOOPBACK_ENFORCEMENT_LAUNCH_FAILED')); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (interrupted) reject(new Error('GUARDED_COLLECTOR_INTERRUPTED'));
      else if (timedOut) reject(new Error('GUARDED_COLLECTOR_TIMEOUT'));
      else if (code !== 0 || !result || duplicates) reject(new Error('GUARDED_COLLECTOR_INCOMPLETE'));
      else resolve(result);
    });
  }); } finally {
    try { await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  }
}
