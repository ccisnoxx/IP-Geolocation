import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const shell = args => execute('limactl', ['shell', '--workdir', '/tmp', 'vg-userscripts-fixture', '--', ...args], { timeout: 10000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('宿主 runner 在真实 Chrome 运行时被 SIGTERM 中断，跨 VM 回收进程和资源', {
  skip: process.env.VG_US_TEST_LINUX_VM !== '1', timeout: 30000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vg-transport-test-'));
  const output = join(directory, 'interrupted.json');
  let child;
  const resourceScript = [
    'import json,pathlib,subprocess',
    "ns=subprocess.check_output(['ip','netns','list'],text=True).splitlines()",
    "chrome=subprocess.run(['ps','-C','chrome','-C','chrome_crashpad','-o','pid='],capture_output=True,text=True).stdout.splitlines()",
    "print(json.dumps({'namespaces':len(ns),'profiles':len(list(pathlib.Path('/tmp').glob('vg-userscripts-profile-*'))),'stages':len(list(pathlib.Path('/tmp').glob('vg-userscripts-stage-*'))),'chrome':len(chrome)}))"
  ].join('\n');
  const resources = async () => JSON.parse((await shell(['python3', '-c', resourceScript])).stdout);
  try {
    assert.deepEqual(await resources(), { namespaces: 0, profiles: 0, stages: 0, chrome: 0 });
    child = spawn(process.execPath, [fileURLToPath(new URL('./runner.mjs', import.meta.url)), '--linux-vm', '--output', output],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    let started = false;
    for (let count = 0; count < 100; count++) {
      if ((await resources()).chrome > 0) { started = true; break; }
      await delay(50);
    }
    assert.ok(started, '实际 Chrome 已启动后才中断宿主传输');
    child.kill('SIGTERM');
    assert.equal(await completed, 2);
    const evidence = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(evidence.conclusion, 'BLOCKED');
    assert.equal(evidence.stopReason, 'GUARDED_COLLECTOR_INTERRUPTED');
    let remaining;
    for (let count = 0; count < 50; count++) {
      remaining = await resources();
      if (Object.values(remaining).every(value => value === 0)) break;
      await delay(50);
    }
    assert.deepEqual(remaining, { namespaces: 0, profiles: 0, stages: 0, chrome: 0 });
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
  }
});
