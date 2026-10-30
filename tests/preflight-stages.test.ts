import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * `npm run preflight` 守的是"发版前那九件事一件都不漏"，所以它自己也得有人守。
 *
 * 两个方向都会腐化：
 *   1. CI 加了冒烟脚本，preflight 没跟着加 → 本地过了、CI 红；
 *   2. preflight 的清单写死了一份副本，某天有人只改了 CI 的循环 → 两边悄悄分叉。
 * 这条测试把两边对起来：CI 循环里的每个脚本名都必须在 preflight 的 SMOKES 里出现，
 * 反过来 preflight 也不许出现脚本文件不存在的名字（写完删文件这种）。
 */
const preflight = readFileSync('tools/preflight.mjs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const distSmokes = ['frames', 'opaque-frames', 'opaque-recovery', 'workers', 'bfcache', 'cold-save', 'baked-failclosed', 'ip-apply', 'theme'];

function runPreflight(t: TestContext, args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'vanishgeo-preflight-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(relative: string, source: string, executable = false) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, executable ? `#!${process.execPath}\n${source}` : source, { mode: executable ? 0o755 : 0o644 });
  }
  write('tools/preflight.mjs', preflight);
  write('package.json', JSON.stringify({ type: 'module', version: '1.0.0' }));
  write('manifest.json', JSON.stringify({ version: '1.0.0' }));
  mkdirSync(join(root, 'tmp'));
  const record = `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
    const record = (id) => appendFileSync('events.jsonl', JSON.stringify(id) + '\\n');`;
  write('bin/npm', `${record}
    const id = { build: 'build', verify: 'verify', 'test:coverage:core': 'coverage' }[process.argv[3]];
    if (!id) throw new Error('未知 npm 调用：' + process.argv.slice(2).join(' '));
    record(id);
    if (id === 'build') {
      mkdirSync('dist', { recursive: true });
      writeFileSync('dist/manifest.json', '{}');
    } else if (!existsSync('dist/manifest.json')) {
      throw new Error('单测读取 dist 前必须先构建');
    }`, true);
  write('scripts/build-persona.mjs', `${record}
    import { join } from 'node:path';
    record('persona');
    const out = process.argv.find((arg) => arg.startsWith('--out=')).slice('--out='.length);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'manifest.json'), '{}');`);
  for (const name of preflightSmokeNames()) {
    write(`tools/smoke-${name}.mjs`, `${record}
      import { join } from 'node:path';
      record(${JSON.stringify(`smoke:${name}`)});
      if (${distSmokes.includes(name)} && !existsSync('dist/manifest.json')) throw new Error('冒烟需要 dist');
      if (${['options', 'popup'].includes(name)}) {
        const extension = process.argv.find((arg) => arg.startsWith('--extension='));
        if (!extension || !existsSync(join(extension.slice('--extension='.length), 'manifest.json'))) throw new Error('UI 冒烟需要 persona');
      }
      console.log('1/1 通过');`);
  }
  const result = spawnSync(process.execPath, ['tools/preflight.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH || ''}`, TMPDIR: join(root, 'tmp') }
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

function ciSmokeNames() {
  // 抓 `for script in presets frames … popup; do` 这一段（含反斜杠续行）
  const block = ci.match(/for script in ([\s\S]*?);\s*do/);
  assert.ok(block, 'ci.yml 里找不到离线冒烟的循环，测试要跟着改');
  return block[1]
    .replace(/\\\n/g, '\n')
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function preflightSmokeNames() {
  const block = preflight.match(/const SMOKES = \[([\s\S]*?)\];/);
  assert.ok(block, 'preflight.mjs 里找不到 SMOKES 清单');
  return [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

test('preflight 的冒烟清单与 CI 循环一一对应', () => {
  const fromCi = ciSmokeNames();
  const fromPreflight = preflightSmokeNames();
  assert.ok(fromCi.length >= 10, `CI 里至少应该有 10 条在线冒烟，实际 ${fromCi.length}`);
  assert.deepEqual(
    [...fromCi].sort(),
    [...fromPreflight].sort(),
    '两边清单不一致 —— 本地全绿但 CI 红的经典来源'
  );
});

test('preflight 覆盖发布清单里的每一关', () => {
  // 这些 id 对应 RELEASE.md「发布前检查清单」的条目，缺一条就等于清单可以被人跳过
  for (const id of ['verify', 'coverage', 'build', 'audit', 'package', 'release-smoke', 'stray', 'version']) {
    assert.ok(preflight.includes(`'${id}'`), `preflight 少了 ${id} 这一关`);
  }
});

test('需要构建产物的阶段自己声明依赖，不靠调用顺序', () => {
  // options / popup 跑的是构建产物。之前 --only=smoke 会跳过 persona，
  // 于是这两条报"找不到构建产物"——看着像扩展坏了，其实是 preflight 的排序问题。
  assert.match(preflight, /deps: \/\^\(options\|popup\)\$\//, 'options / popup 没声明 persona 依赖');
  assert.ok(preflight.includes('function buildPlan()'), '缺依赖闭包，被依赖的阶段不会被补进来');
  // 重复 flag 要累积，否则 --skip=a --skip=b 里 b 会盖掉 a
  assert.ok(preflight.includes('flags.set(name, [...(flags.get(name) || []),'), 'flag 解析会互相覆盖');
});

test('preflight 默认顺序在单测和覆盖率之前构建 dist', (t) => {
  const result = runPreflight(t, [`--skip=${preflightSmokeNames().map((name) => `smoke:${name}`).join(',')}`, '--skip=audit,package,release-smoke,stray']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['build', 'verify', 'coverage', 'persona']);
});

for (const id of ['verify', 'coverage', ...distSmokes.map((name) => `smoke:${name}`)]) {
  test(`preflight --only=${id} 自动先构建 dist`, (t) => {
    const result = runPreflight(t, [`--only=${id}`]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.events, ['build', id]);
  });
}

test('preflight --only=smoke 补齐 dist 和 persona，且每个只构建一次', (t) => {
  const result = runPreflight(t, ['--only=smoke']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['build', 'persona', ...preflightSmokeNames().map((name) => `smoke:${name}`)]);
});

test('preflight 重复 only 累积，skip 保留筛选语义', (t) => {
  const result = runPreflight(t, ['--only=smoke:frames', '--only=smoke:popup', '--skip=frames']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ['persona', 'smoke:popup']);
});

for (const [id, dependency] of [['verify', 'build'], ['smoke:frames', 'build'], ['smoke:popup', 'persona']]) {
  test(`preflight 显式跳过 ${id} 的依赖 ${dependency} 时报参数冲突`, (t) => {
    const result = runPreflight(t, [`--only=${id}`, '--skip=coverage', `--skip=${dependency}`]);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, new RegExp(`${id} 需要 ${dependency}`));
    assert.deepEqual(result.events, []);
  });
}

test('preflight 能用 npm run 起来，且不把审查逻辑再写一遍', () => {
  assert.equal(pkg.scripts.preflight, 'node tools/preflight.mjs');
  // 每关都该是一次真实子进程调用：出现自造的断言循环就是第二套真相
  for (const banned of ['assert.equal(', 'results.push({ name']) {
    assert.equal(preflight.includes(banned), false, `preflight 里不该出现 ${banned}`);
  }
});
