import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const gates = ['npm ci', 'npm run typecheck', 'npm run typecheck:tests', 'npm test', 'npm run build'];

test('push/PR 与 tag 发布按同一顺序运行门禁，失败不能绕过到产物步骤', () => {
  for (const file of ['ci.yml', 'release.yml']) {
    const workflow = read(`.github/workflows/${file}`);
    const commands = [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(commands.slice(0, gates.length), gates, file);
    const build = workflow.indexOf('run: npm run build\n');
    const dryRun = workflow.indexOf('run: npm run test:e2e:chrome -- --dry-run');
    const upload = workflow.indexOf('uses: actions/upload-artifact@');
    assert.ok(build < dryRun && dryRun < upload, file);
    // 只验证此处使用的默认成功顺序，拒绝改变失败语义的旁路。
    assert.doesNotMatch(workflow, /continue-on-error|^\s*if:|always\(|workflow_run|pull_request_target|\|\|/m);
    assert.match(workflow, /^permissions:\n  contents: read$/m);
    assert.match(workflow, /persist-credentials: false/);
    if (file === 'ci.yml') {
      assert.match(workflow, /^on:\n  push:\n  pull_request:$/m);
      assert.doesNotMatch(workflow, /contents: write|action-gh-release/);
    } else {
      assert.match(workflow, /tags:\n      - 'v\*\.\*\.\*'/);
      assert.match(workflow, /^  release:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write$/m);
      assert.match(workflow, /fetch-depth: 0/);
      const changelog = workflow.indexOf('run: bash scripts/release-changelog.sh');
      const zip = workflow.indexOf('zip -r ');
      const release = workflow.indexOf('uses: softprops/action-gh-release@');
      assert.ok(dryRun < changelog && changelog < zip && zip < release && release < upload);
      assert.match(workflow, /body_path: \$\{\{ runner.temp \}\}\/vanishgeo-changelog.md/);
      assert.match(workflow, /fail_on_unmatched_files: true/);
      assert.doesNotMatch(workflow, /Initial release of|Bug fixes and improvements/);
    }
  }
});

test('本地 check 中任一检查失败均传播非零，测试失败不会执行构建', () => {
  const components = ['typecheck', 'typecheck:tests', 'test', 'build'];
  assert.equal(pkg.scripts.check, components.map((name) => name === 'test' ? 'npm test' : `npm run ${name}`).join(' && '));
  const dir = mkdtempSync(join(tmpdir(), 'vanishgeo-gates-'));
  try {
    writeFileSync(join(dir, 'failure.test.cjs'), "require('node:test')('合成失败测试', () => { require('node:assert/strict').equal(1, 2); });\n");
    for (const failing of components) {
      // 在临时项目执行真实 npm 聚合命令；每个子命令记录是否到达。
      const scripts: Record<string, string> = { check: pkg.scripts.check };
      for (const name of components) scripts[name] = `node -e "require('fs').appendFileSync('steps.log', '${name}\\n'); process.exit(${name === failing ? 23 : 0})"`;
      if (failing === 'test') scripts.test = "node -e \"require('fs').appendFileSync('steps.log', 'test\\n')\" && node --test failure.test.cjs";
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
      writeFileSync(join(dir, 'steps.log'), '');
      // 内层 runner 是独立项目，不能继承外层 runner 的递归测试上下文。
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync('npm', ['run', 'check'], { cwd: dir, encoding: 'utf8', env });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, failing);
      if (failing === 'test') assert.match(result.stdout + result.stderr, /合成失败测试/);
      assert.deepEqual(readFileSync(join(dir, 'steps.log'), 'utf8').trim().split('\n'), components.slice(0, components.indexOf(failing) + 1));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('测试 TypeScript 入口继承 strict 并涵盖 tests 目录', () => {
  const sourceConfig = JSON.parse(read('tsconfig.json'));
  const config = JSON.parse(read('tsconfig.test.json'));
  assert.equal(sourceConfig.compilerOptions.strict, true);
  assert.equal(config.extends, './tsconfig.json');
  assert.deepEqual(config.include, ['tests/**/*.ts']);
  assert.equal(config.compilerOptions, undefined);
  assert.equal(pkg.scripts['typecheck:tests'], 'tsc --project tsconfig.test.json --noEmit');
});

test('changelog 首发列出历史，跨 tag 只含新提交，排除无关分支并拒绝浅克隆', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vanishgeo-changelog-'));
  const repo = join(dir, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const changelog = () => execFileSync('bash', [join(root, 'scripts/release-changelog.sh')], { cwd: repo, encoding: 'utf8' });
  try {
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('commit', '--quiet', '--allow-empty', '-m', '初始化合成仓库');
    assert.match(changelog(), /初始化合成仓库/);
    git('commit', '--quiet', '--allow-empty', '-m', '首次发布前的改动');
    git('tag', 'v1.0.0');
    assert.match(changelog(), /首次发布前的改动/);
    assert.match(changelog(), /初始化合成仓库/);
    git('checkout', '--quiet', '-b', 'unrelated');
    git('commit', '--quiet', '--allow-empty', '-m', '无关分支的改动');
    git('tag', 'v9.0.0');
    git('checkout', '--quiet', 'main');
    git('commit', '--quiet', '--allow-empty', '-m', '门禁修复');
    git('tag', 'v1.1.0');
    const notes = changelog();
    assert.match(notes, /自 v1\.0\.0/);
    assert.match(notes, /门禁修复/);
    assert.doesNotMatch(notes, /初始化合成仓库|首次发布前的改动|无关分支|v9\.0\.0/);

    // 已发布的 tag 可以在合并提交的第二父分支上；HEAD 上的全部 tag 都要排除。
    git('checkout', '--quiet', '-b', 'release-branch');
    git('commit', '--quiet', '--allow-empty', '-m', '发布分支已发行的改动');
    git('tag', '-a', 'v1.2.0', '-m', '合成附注版本');
    git('checkout', '--quiet', 'main');
    git('commit', '--quiet', '--allow-empty', '-m', '主线新改动');
    git('merge', '--quiet', '--no-ff', 'release-branch', '-m', '合并发行分支');
    git('tag', 'v1.3.0');
    git('tag', '-a', 'v1.3.1', '-m', '同提交的合成附注版本');
    const mergedNotes = changelog();
    assert.match(mergedNotes, /自 v1\.2\.0/);
    assert.match(mergedNotes, /主线新改动/);
    assert.match(mergedNotes, /合并发行分支/);
    assert.doesNotMatch(mergedNotes, /发布分支已发行的改动|门禁修复|v1\.3\.[01]/);

    const shallow = join(dir, 'shallow');
    execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${repo}`, shallow]);
    const result = spawnSync('bash', [join(root, 'scripts/release-changelog.sh')], { cwd: shallow, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /需要完整 Git 历史/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
