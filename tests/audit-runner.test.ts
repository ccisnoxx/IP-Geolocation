import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const audit = readFileSync('tools/audit.mjs', 'utf8');

function runAudit(t: TestContext, args: string[], smoke = "console.log('7/7 通过');") {
  const root = mkdtempSync(join(tmpdir(), 'vanishgeo-audit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(relative: string, source: string) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  write('package.json', JSON.stringify({ type: 'module' }));
  write('tools/audit.mjs', audit);
  write('tools/lib/cdp.mjs', 'export const reapStrayBrowsers = () => [];');
  write('tools/lib/exit.mjs', "export const lookupExit = () => { throw new Error('静态和 options 不应查出口'); };");
  write('tools/smoke-options.mjs', smoke);
  write('tests/fixture.test.ts', '');
  const record = `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
    const record = (id) => appendFileSync('events.jsonl', JSON.stringify(id) + '\\n');`;
  write('node_modules/typescript/package.json', JSON.stringify({ type: 'module' }));
  write('node_modules/vite/package.json', JSON.stringify({ type: 'module' }));
  write('node_modules/typescript/bin/tsc', `${record} record('typecheck');`);
  write('node_modules/vite/bin/vite.js', `${record}
    record('build');
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/manifest.json', '{}');`);
  write('node_modules/tsx/dist/cli.mjs', `${record}
    record('unittest');
    if (!existsSync('dist/manifest.json')) throw new Error('单测读取 dist 前必须先构建');
    console.log('# pass 1\\n# fail 0');`);
  // 纯静态入口不该调用此脚本；发生调用时显式失败，避免测试碰到真实 persona。
  write('scripts/build-persona.mjs', `${record} record('persona'); throw new Error('不应构建 persona');`);
  if (args.includes('--no-build')) write('home/.vanishgeo/profiles/us-la-1/ext/manifest.json', '{}');
  write('chrome119', '');
  const result = spawnSync(process.execPath, ['tools/audit.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, HOME: join(root, 'home'), CHROME119_PATH: join(root, 'chrome119') }
  });
  const events = (() => {
    try {
      return readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  })();
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}`, events };
}

test('audit 纯静态入口在单测前构建，且不准备 persona', (t) => {
  const result = runAudit(t, ['--only=typecheck,unittest,build']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['typecheck', 'build', 'unittest']);
});

test('audit 选中的静态构建在单测读取 dist 之前执行', (t) => {
  const result = runAudit(t, ['--only=typecheck,unittest,build', '--no-build']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['typecheck', 'build', 'unittest']);
});

test('audit 单独选择 unittest 自动先构建 dist，no-build 只控制 persona', (t) => {
  for (const extra of [[], ['--no-build']]) {
    const result = runAudit(t, ['--only=unittest', ...extra]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.events, ['build', 'unittest']);
  }
});

test('audit 显式跳过 unittest 所需的 build 时报参数冲突', (t) => {
  const result = runAudit(t, ['--only=unittest', '--skip=build']);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /unittest 需要 build/);
  assert.deepEqual(result.events, []);
});

test('audit 纯静态入口允许 engines 参数，且不要求 persona 构建', (t) => {
  const result = runAudit(t, ['--only=typecheck', '--engines=missing']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['typecheck']);
});

test('audit 成功输出且正常退出才将浏览器组记为全绿', (t) => {
  const result = runAudit(t, ['--only=options', '--engines=chrome119', '--no-build', '--retries=0']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /7\/7 项通过 · 1\/1 组全绿/);
});

for (const [name, ending] of [['非零退出', 'process.exit(1);'], ['信号退出', "process.kill(process.pid, 'SIGTERM');"]]) {
  test(`audit 已输出 7/7 通过但${name}时仍失败`, (t) => {
    const result = runAudit(t, ['--only=options', '--engines=chrome119', '--no-build', '--retries=0'], `console.log('7/7 通过'); ${ending}`);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /0\/1 组全绿/);
    assert.match(result.output, /✗ Chrome 119/);
  });
}
