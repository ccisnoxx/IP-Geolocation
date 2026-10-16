import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureProduction, compareProduction, validateOutputPath } from './production-guard.mjs';
import { collectInsideLoopbackGuard } from './network-guard.mjs';

test('生产门禁捕获已有修改、未跟踪文件及暂停闸门的变化，实验报告允许变化', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vg-production-guard-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    await mkdir(join(root, 'src/background'), { recursive: true });
    await mkdir(join(root, 'experiments/userscripts-document-start'), { recursive: true });
    const services = join(root, 'src/background/services.ts');
    await writeFile(services, 'async function initializeRuntimeForSender() {\nthrow new RuntimeSyncOperationError(RUNTIME_INJECTION_PAUSED.code, RUNTIME_INJECTION_PAUSED.message);\n}\n  async function next() {}\n');
    await writeFile(join(root, 'manifest.json'), '{"manifest_version":3}');
    execFileSync('git', ['add', 'src/background/services.ts', 'manifest.json'], { cwd: root });
    await writeFile(join(root, 'existing-user-file.txt'), '合成既有修改');
    const before = await captureProduction(root);
    await writeFile(join(root, 'experiments/userscripts-document-start/report.json'), '{}');
    assert.equal(compareProduction(before, await captureProduction(root)).status, 'PASS');
    await writeFile(join(root, 'existing-user-file.txt'), '变化');
    assert.equal(compareProduction(before, await captureProduction(root)).unchanged, 'FAIL');
    await writeFile(services, 'async function initializeRuntimeForSender() {}\n  async function next() {}\n');
    assert.equal(compareProduction(before, await captureProduction(root)).pauseGate, 'FAIL');
    await assert.rejects(validateOutputPath(join(root, 'manifest.json'), root), /OUTPUT_OUTSIDE/);
    const link = join(root, 'experiments/userscripts-document-start/link.json');
    await symlink(join(root, 'manifest.json'), link);
    await assert.rejects(validateOutputPath(link, root), /OUTPUT_NOT_INDEPENDENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('内核 loopback 策略允许本地 TCP/UDP，拒绝合成非 loopback IPv4/IPv6，子进程继承', {
  skip: process.platform !== 'darwin' ? '此后端仅支持 macOS；其他平台 runner 必须 BLOCKED' : false
}, async () => {
  // 固定探针通过 IPC 返回观测；不加载 Chrome、网页或任何第三方资源。
  const temp = await mkdtemp(join(tmpdir(), 'vg-network-guard-'));
  try {
    const entry = join(temp, 'probe.mjs');
    const module = new URL('./network-probe.mjs', import.meta.url).href;
    await writeFile(entry, `import { probeNetwork, probeInheritedNetwork } from ${JSON.stringify(module)};\nconst checks=await probeNetwork();checks.inherited=await probeInheritedNetwork();process.send({type:'experiment-evidence',evidence:{checks}},()=>process.disconnect());\n`);
    const { checks } = await collectInsideLoopbackGuard(entry);
    assert.deepEqual(Object.values(checks), Array(7).fill('PASS'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('父进程 SIGTERM 回收 detached collector 和 profile，保持非成功结果', {
  skip: process.platform !== 'darwin' ? '此后端仅支持 macOS' : false
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vg-interrupt-guard-'));
  let parent, collector;
  try {
    const entry = join(temp, 'waiting.mjs'), ready = join(temp, 'ready.json');
    await writeFile(entry, `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,profile:process.env.VG_US_EXPERIMENT_TEMP}));setInterval(()=>{},1000);\n`);
    const wrapper = join(temp, 'wrapper.mjs');
    await writeFile(wrapper, `import { collectInsideLoopbackGuard } from ${JSON.stringify(new URL('./network-guard.mjs', import.meta.url).href)};\ntry { await collectInsideLoopbackGuard(${JSON.stringify(entry)}); console.log('UNEXPECTED_SUCCESS'); } catch(error) { console.log(error.message); }\n`);
    parent = spawn(process.execPath, [wrapper], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    parent.stdout.on('data', chunk => { output += chunk; });
    const exited = new Promise(resolve => parent.once('exit', resolve));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { collector = JSON.parse(await readFile(ready, 'utf8')); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(collector, '等待受约束 collector 就绪');
    parent.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.equal(output.trim(), 'GUARDED_COLLECTOR_INTERRUPTED');
    assert.throws(() => process.kill(collector.pid, 0), { code: 'ESRCH' });
    await assert.rejects(access(collector.profile), { code: 'ENOENT' });
  } finally {
    if (parent && parent.exitCode === null) parent.kill('SIGKILL');
    if (collector) { try { process.kill(-collector.pid, 'SIGKILL'); } catch { /* 本次进程组已退出。 */ } }
    await rm(temp, { recursive: true, force: true });
  }
});
