import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, copyFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { personaTarget, auditPersona } from '../scripts/lib/persona-artifact';

const root = resolve(import.meta.dirname, '..');
const run = promisify(execFile);
const cli = (script: string, args: string[], env = process.env) => run(process.execPath,
  [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, script), ...args], { cwd: root, env });

test('批量出包plan保留普通/Persona区别，未知预设、域名和缺少审查预期直接拒绝', async () => {
  const planned = JSON.parse((await cli('scripts/prepare-release.mjs', ['--kind', 'persona', '--all-presets', '--domains', 'example.test', '--plan'])).stdout);
  assert.equal(planned.targets.length, 6);
  assert.equal(planned.publishes, false);
  assert.throws(() => personaTarget('unknown', 'example.test'));
  assert.throws(() => personaTarget('singapore', 'bad..test'));
  await assert.rejects(cli('scripts/audit-persona.mjs', ['--zip', 'synthetic.zip']), /预期配置不可省略/);
  await assert.rejects(cli('scripts/prepare-release.mjs', ['--kind', 'regular', '--preset', 'singapore', '--plan']), /普通包不使用persona/);
});

test('Persona审查接受维护源生成的静态包，拒绝被修改的运行时和额外文件', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vg-artifact-test-'));
  try {
    const dist = join(workspace, 'dist'); const out = join(workspace, 'persona'); const zip = join(workspace, 'persona.zip');
    await mkdir(dist);
    await writeFile(join(dist, 'manifest.json'), await readFile(join(root, 'manifest.json')));
    await writeFile(join(dist, 'synthetic.txt'), 'synthetic');
    await cli('scripts/build-persona.mjs', ['--dist', dist, '--out', out, '--preset', 'singapore', '--domains', 'example.test']);
    await run('zip', ['-qr', zip, '.'], { cwd: out });
    const report = await auditPersona(root, zip, 'singapore', 'example.test', dist);
    assert.equal(report.artifactKind, 'persona-language-timezone');
    assert.equal(report.browserAcceptance, 'NOT_RUN');
    const unsafe = join(workspace, 'unsafe.zip');
    await copyFile(zip, unsafe);
    await mkdir(join(workspace, 'escape'));
    await run('zip', ['-qr', unsafe, '../escape/'], { cwd: out });
    await assert.rejects(auditPersona(root, unsafe, 'singapore', 'example.test', dist), /非法路径/);
    await writeFile(join(out, 'persona/page-runtime.js'), 'function noOp() {}');
    await run('zip', ['-qr', zip, '.'], { cwd: out });
    await assert.rejects(auditPersona(root, zip, 'singapore', 'example.test', dist), /维护源及预期配置不一致/);
    await writeFile(join(out, 'unexpected.js'), 'globalThis.synthetic=true;');
    await run('zip', ['-qr', zip, '.'], { cwd: out });
    await assert.rejects(auditPersona(root, zip, 'singapore', 'example.test', dist), /文件集合/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('环境启动器在组长退出后仍回收忽略TERM的本次子进程，再删除临时Profile', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vg-process-group-test-'));
  try {
    const browser = join(workspace, 'synthetic-browser'); const child = join(workspace, 'child.cjs'); const output = join(workspace, 'group.json');
    await writeFile(child, "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);\n");
    await writeFile(browser, `#!/usr/bin/env node\nif(process.argv.includes('--version'))console.log('Google Chrome 155.0.0.0');else{const child=require('node:child_process').spawn(process.execPath,[process.env.SYNTHETIC_CHILD],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{require('node:fs').writeFileSync(process.env.SYNTHETIC_OUTPUT,JSON.stringify({pid:child.pid,profile:process.argv.find(v=>v.startsWith('--user-data-dir=')).slice(16)}));process.exit(0);});}\n`);
    await chmod(browser, 0o755);
    await cli('scripts/browser-environment.mjs', ['--preset', 'singapore', '--browser', browser],
      { ...process.env, SYNTHETIC_CHILD: child, SYNTHETIC_OUTPUT: output });
    const group = JSON.parse(await readFile(output, 'utf8'));
    assert.throws(() => process.kill(group.pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
    await assert.rejects(access(group.profile), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('矩阵不把无浏览器的检查视为通过，也不覆盖现有报告', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vg-matrix-test-'));
  try {
    const output = join(workspace, 'matrix.json');
    await assert.rejects(cli('scripts/validation-matrix.mjs', ['--only', 'native-parity', '--browser', join(workspace, 'missing'), '--output', output]));
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.status, 'INCOMPLETE');
    assert.equal(report.rows[0].status, 'UNSUPPORTED');
    await assert.rejects(cli('scripts/validation-matrix.mjs', ['--only', 'unit', '--output', output]), /不得覆盖/);
    await assert.rejects(cli('scripts/validation-matrix.mjs', ['--only', 'unknown', '--plan']), /未知/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('独立环境只向本次子进程传入预设，拒绝个人Profile且不删除持久Profile', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vg-environment-test-'));
  try {
    const browser = join(workspace, 'synthetic-browser'); const output = join(workspace, 'launch.json'); const profile = join(workspace, 'profile');
    await writeFile(browser, `#!/usr/bin/env node\nif(process.argv.includes('--version'))console.log('Google Chrome 155.0.0.0');else require('node:fs').writeFileSync(process.env.SYNTHETIC_OUTPUT,JSON.stringify({args:process.argv.slice(2),tz:process.env.TZ}));\n`);
    await chmod(browser, 0o755);
    await cli('scripts/browser-environment.mjs', ['--preset', 'germany-berlin', '--browser', browser, '--profile', profile], { ...process.env, SYNTHETIC_OUTPUT: output });
    const launched = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(launched.tz, 'Europe/Berlin');
    assert.ok(launched.args.includes('--lang=de-DE'));
    assert.ok(launched.args.includes(`--user-data-dir=${profile}`));
    assert.equal(launched.args.some((arg: string) => arg.includes('remote-debugging')), false);
    assert.equal(JSON.parse(await readFile(join(profile, '.vanishgeo-environment.json'), 'utf8')).preset, 'germany-berlin');
    const personal = join(workspace, 'personal'); await mkdir(personal); await writeFile(join(personal, 'Preferences'), 'protected');
    await assert.rejects(cli('scripts/browser-environment.mjs', ['--preset', 'singapore', '--browser', browser, '--profile', personal]), /不是本工具拥有/);
    assert.equal(await readFile(join(personal, 'Preferences'), 'utf8'), 'protected');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
