import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, chown, copyFile, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';

const enabled = process.platform === 'linux' && process.getuid() === 0 && Number(process.env.SUDO_UID) > 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const namespaces = () => execFileSync('ip', ['netns', 'list'], { encoding: 'utf8' });
async function fixture(source, initializationBarrier = false) {
  const directory = await mkdtemp('/tmp/vg-netns-test-');
  await chown(directory, Number(process.env.SUDO_UID), Number(process.env.SUDO_GID));
  for (const name of ['linux-netns.mjs', 'acceptance.mjs', 'network-probe.mjs']) {
    await copyFile(new URL(name, import.meta.url), join(directory, name));
  }
  await writeFile(join(directory, 'browser-experiment.mjs'), source);
  const args = [];
  if (initializationBarrier) {
    // 故障注入只在测试进程延迟真实 chown 的完成，稳定复现资源初始化 await 中收到取消。
    const hook = join(directory, 'initialization-barrier.mjs');
    await writeFile(hook, `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const chown=fs.chown; fs.chown=async (...args)=>{await chown(...args);await fs.writeFile(new URL('initializing.json',import.meta.url),'{}');await new Promise(r=>setTimeout(r,300));};
      syncBuiltinESMExports();`);
    args.push('--import', hook);
  }
  const child = spawn(process.execPath, [...args, join(directory, 'linux-netns.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve({ code, evidence: JSON.parse(output) })); });
  return { directory, child, completed };
}

test('真实 Linux namespace 降权、loopback 正向/外部拒绝/继承及正常清理', { skip: !enabled }, async () => {
  const before = namespaces();
  const owned = await fixture(`import {probeNetwork,probeInheritedNetwork} from './network-probe.mjs';
    const checks=await probeNetwork(); checks.inherited=await probeInheritedNetwork();
    process.send({type:'experiment-evidence',evidence:{checks,uid:process.getuid(),profile:process.env.VG_US_EXPERIMENT_TEMP,cleanup:{status:'PASS',failures:[]}}},()=>process.disconnect());`);
  try {
    const { code, evidence } = await owned.completed;
    assert.equal(code, 0);
    assert.deepEqual(Object.values(evidence.checks), Array(7).fill('PASS'));
    assert.ok(evidence.uid > 0);
    assert.equal(evidence.cleanup.coordinator, 'PASS');
    await assert.rejects(access(evidence.profile), { code: 'ENOENT' });
    await assert.rejects(access(join(owned.directory, 'active.json')), { code: 'ENOENT' });
    assert.equal(namespaces(), before);
  } finally { owned.child.kill('SIGTERM'); await rm(owned.directory, { recursive: true, force: true }); }
});

test('初始化 await 中取消后不创建 collector，立即回收已有 profile 和 marker', { skip: !enabled }, async () => {
  const before = namespaces();
  const owned = await fixture(`import {writeFile} from 'node:fs/promises';
    await writeFile(new URL('collector-started.json',import.meta.url),'{}');
    process.send({type:'experiment-evidence',evidence:{cleanup:{status:'PASS',failures:[]}}},()=>process.disconnect());`, true);
  try {
    let initializing = false;
    for (let count = 0; count < 100; count++) {
      try { await access(join(owned.directory, 'initializing.json')); initializing = true; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(10);
    }
    assert.ok(initializing);
    owned.child.kill('SIGTERM');
    const { evidence } = await owned.completed;
    assert.equal(evidence.stopReason, 'GUARDED_COLLECTOR_INTERRUPTED');
    assert.equal(evidence.cleanup.coordinator, 'PASS');
    await assert.rejects(access(join(owned.directory, 'collector-started.json')), { code: 'ENOENT' });
    await assert.rejects(access(join(owned.directory, 'active.json')), { code: 'ENOENT' });
    assert.equal(namespaces(), before);
  } finally { owned.child.kill('SIGTERM'); await rm(owned.directory, { recursive: true, force: true }); }
});

test('SIGTERM 回收 collector、派生进程、profile 和 namespace，不能形成成功证据', { skip: !enabled }, async () => {
  const before = namespaces();
  const owned = await fixture(`import {spawn} from 'node:child_process'; import {writeFile} from 'node:fs/promises';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    await writeFile(new URL('ready.json',import.meta.url),JSON.stringify({pid:process.pid,child:child.pid,profile:process.env.VG_US_EXPERIMENT_TEMP}));
    setInterval(()=>{},1000);`);
  try {
    let ready;
    for (let count = 0; count < 100; count++) {
      try { ready = JSON.parse(await readFile(join(owned.directory, 'ready.json'), 'utf8')); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(50);
    }
    assert.ok(ready);
    owned.child.kill('SIGTERM');
    const { code, evidence } = await owned.completed;
    assert.equal(code, 0);
    assert.equal(evidence.stopReason, 'GUARDED_COLLECTOR_INTERRUPTED');
    assert.equal(evidence.cleanup.coordinator, 'PASS');
    assert.equal(evidence.conclusion, 'BLOCKED');
    for (const pid of [ready.pid, ready.child]) {
      for (let count = 0; count < 100; count++) {
        try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
        await delay(20);
      }
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
    await assert.rejects(access(ready.profile), { code: 'ENOENT' });
    assert.equal(namespaces(), before);
  } finally { owned.child.kill('SIGTERM'); await rm(owned.directory, { recursive: true, force: true }); }
});
