#!/usr/bin/env node
// Linux VM 内的特权协调器只管理本次 namespace/profile；collector 与 Chrome 均降权运行。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, chown, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createEvidence } from './acceptance.mjs';

const entry = fileURLToPath(new URL(process.argv[2] === '--production' ? './production-smoke.mjs' : './browser-experiment.mjs', import.meta.url));
const stage = dirname(entry);
const marker = join(stage, 'active.json');
const command = (program, args) => execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('LINUX_ROOT_COORDINATOR_REQUIRED');

if (process.argv[2] === '--cleanup') {
  try {
    const { pid } = JSON.parse(await readFile(marker, 'utf8'));
    const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    if (!cmdline.split('\0').includes(fileURLToPath(import.meta.url))) throw new Error('COORDINATOR_IDENTITY_MISMATCH');
    process.kill(pid, 'SIGTERM');
    for (let count = 0; count < 100; count++) {
      try { await readFile(marker); } catch (error) { if (error.code === 'ENOENT') process.exit(0); throw error; }
      await delay(100);
    }
    throw new Error('COORDINATOR_CLEANUP_TIMEOUT');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  process.exit(0);
}

const uid = Number(process.env.SUDO_UID), gid = Number(process.env.SUDO_GID);
if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0) throw new Error('NON_ROOT_COLLECTOR_REQUIRED');
const namespace = `vg-us-${randomBytes(8).toString('hex')}`;
let profile, child, namespaceCreated = false, markerOwned = false, interrupted = false, timedOut = false, timer, result, failure;
const terminate = () => {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
};
const interrupt = () => { interrupted = true; terminate(); };
const checkInterrupted = () => { if (interrupted) throw new Error('GUARDED_COLLECTOR_INTERRUPTED'); };
process.once('SIGTERM', interrupt);
process.once('SIGINT', interrupt);
process.once('SIGHUP', interrupt);
try {
  await writeFile(marker, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  markerOwned = true;
  checkInterrupted();
  profile = await mkdtemp('/tmp/vg-userscripts-profile-');
  checkInterrupted();
  await chown(profile, uid, gid);
  checkInterrupted();
  command('ip', ['netns', 'add', namespace]);
  namespaceCreated = true;
  command('ip', ['-n', namespace, 'link', 'set', 'lo', 'up']);
  // 没有 veth/物理接口、网关或转发；prohibit 路由使非 loopback 尝试得到明确 EACCES。
  command('ip', ['-n', namespace, 'route', 'add', 'prohibit', 'default']);
  command('ip', ['-n', namespace, '-6', 'route', 'add', 'prohibit', 'default']);
  const home = command('getent', ['passwd', String(uid)]).trim().split(':')[5];
  checkInterrupted();
  child = spawn('ip', ['netns', 'exec', namespace, 'setpriv', '--reuid', String(uid), '--regid', String(gid), '--init-groups',
    process.execPath, entry, ...(process.argv[2] === '--production' && process.argv[3] === '--recovery-only' ? ['--recovery-only'] : [])], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8',
      VG_US_EXPERIMENT_TEMP: profile, VG_US_NETWORK_BACKEND: 'linux-netns' }
  });
  timer = setTimeout(() => { timedOut = true; terminate(); }, 180000);
  let duplicates = false;
  child.on('message', message => {
    if (message?.type !== 'experiment-evidence') return;
    if (result) duplicates = true;
    result = message.evidence;
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (interrupted || timedOut || code !== 0 || duplicates || !result) throw new Error(interrupted ? 'GUARDED_COLLECTOR_INTERRUPTED' : timedOut ? 'GUARDED_COLLECTOR_TIMEOUT' : 'GUARDED_COLLECTOR_INCOMPLETE');
} catch (error) {
  const known = new Set(['GUARDED_COLLECTOR_INTERRUPTED', 'GUARDED_COLLECTOR_TIMEOUT', 'GUARDED_COLLECTOR_INCOMPLETE']);
  failure = known.has(error.message) ? error.message : 'LINUX_NAMESPACE_COORDINATOR_FAILED';
} finally {
  clearTimeout(timer);
  result ??= createEvidence();
  if (failure) result.stopReason = failure;
  const cleanupFailures = [];
  try { terminate(); } catch { cleanupFailures.push('LINUX_PROCESS_GROUP_CLEANUP_FAILED'); }
  if (namespaceCreated) {
    try { command('ip', ['netns', 'delete', namespace]); }
    catch { cleanupFailures.push('LINUX_NAMESPACE_CLEANUP_FAILED'); }
  }
  if (profile) {
    try { await rm(profile, { recursive: true, force: true }); }
    catch { cleanupFailures.push('TEMP_PROFILE_CLEANUP_FAILED'); }
  }
  if (markerOwned) {
    try { await rm(marker); } catch { cleanupFailures.push('COORDINATOR_MARKER_CLEANUP_FAILED'); }
  }
  result.cleanup ??= { status: 'UNKNOWN', failures: [] };
  result.cleanup.failures.push(...cleanupFailures);
  result.cleanup.coordinator = cleanupFailures.length ? 'FAIL' : 'PASS';
  if (cleanupFailures.length) { result.cleanup.status = 'FAIL'; result.stopReason ??= 'CLEANUP_FAILED'; }
}
// stdout 只交付脱敏 JSON，SSH/vsock 不向 Chrome 的 IP 命名空间开放接口。
console.log(JSON.stringify(result));
