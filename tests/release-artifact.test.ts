import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// 独立合成产物，不依赖 npm test 之后才生成的 dist。
function fixture(run: (dir: string, write: (name: string, data: string) => void) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'vanishgeo-artifact-'));
  const write = (name: string, data: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), data);
  };
  try {
    for (const file of ['scripts/audit-release.mjs', 'manifest.json', 'package.json', 'package-lock.json', 'rules/header-migration-guard.json']) {
      write(file, readFileSync(join(root, file), 'utf8'));
    }
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    write('dist/manifest.json', JSON.stringify(manifest));
    write('dist/rules/header-migration-guard.json', readFileSync(join(root, 'rules/header-migration-guard.json'), 'utf8'));
    for (const name of ['background/service-worker.js', 'content/content.js', 'popup/popup.js', 'options/options.js', 'leak-test/leak-test.js', 'diagnostic/report.js', 'font-exposure/filter.js']) write(`dist/${name}`, 'void 0;');
    for (const name of ['LICENSE', 'NOTICE', manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) write(`dist/${name}`, 'fixture');
    run(dir, write);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function zip(dir: string) {
  execFileSync('zip', ['-qr', join(dir, 'candidate.zip'), '.'], { cwd: join(dir, 'dist') });
}
function audit(dir: string) {
  return spawnSync(process.execPath, [join(dir, 'scripts/audit-release.mjs'), '--zip', join(dir, 'candidate.zip'), '--output', join(dir, 'result.json')], { encoding: 'utf8' });
}

test('产物审查接受现行权限、默认隔离与独立字体文件，报告逐文件摘要', () => fixture((dir) => {
  zip(dir);
  const result = audit(dir);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  assert.equal(report.scope, 'current-release-artifact');
  assert.equal(report.checks.defaultHeaderIsolation, true);
  assert.equal(report.checks.zipByteIdentical, true);
  assert.equal(report.files.find((f: { path: string }) => f.path === 'font-exposure/filter.js').sha256.length, 64);
}));

test('产物审查拒绝维护源和 dist 同时退回旧权限', () => fixture((dir, write) => {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.permissions = manifest.permissions.filter((p: string) => p !== 'userScripts');
  manifest.permissions.push('declarativeNetRequest');
  write('manifest.json', JSON.stringify(manifest)); write('dist/manifest.json', JSON.stringify(manifest));
  const result = audit(dir);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /userScripts/);
}));

test('产物审查拒绝隔离被关闭或规则被改变，即使维护源同时变化', () => {
  fixture((dir, write) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.declarative_net_request.rule_resources[0].enabled = false;
    write('manifest.json', JSON.stringify(manifest)); write('dist/manifest.json', JSON.stringify(manifest));
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /enabled/);
  });
  fixture((dir, write) => {
    write('rules/header-migration-guard.json', '[]'); write('dist/rules/header-migration-guard.json', '[]');
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /默认隔离规则必须/);
  });
});

test('产物审查拒绝缺失固定字体入口及其外部模块依赖', () => {
  fixture((dir) => {
    rmSync(join(dir, 'dist/font-exposure/filter.js'));
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /缺少固定字体过滤入口/);
  });
  fixture((dir, write) => {
    write('dist/font-exposure/filter.js', 'import "../assets/shared.js";');
    write('dist/assets/shared.js', 'void 0;');
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /字体过滤必须保持单文件自包含/);
  });
});

test('产物审查拒绝 ZIP 同路径旧字节与额外残留文件', () => {
  fixture((dir, write) => {
    zip(dir); write('dist/options/options.js', 'void 1;');
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /ZIP 字节不一致/);
  });
  fixture((dir, write) => {
    write('dist/obsolete.txt', 'old'); zip(dir); rmSync(join(dir, 'dist/obsolete.txt'));
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /ZIP 必须完整且仅包含当前 dist/);
  });
});


test('产物审查允许sourceURL标识符但拒绝真实源码指令及map文件', () => {
  fixture((dir, write) => {
    write('dist/background/service-worker.js', 'const sourceURL = "blob:synthetic"; void sourceURL;');
    zip(dir);
    const result = audit(dir); assert.equal(result.status, 0, result.stderr);
  });
  for (const directive of ['//# sourceURL=synthetic.js', '//@ sourceMappingURL=synthetic.map', '/*# sourceMappingURL=synthetic.map */']) {
    fixture((dir, write) => {
      write('dist/background/service-worker.js', 'void 0;\n' + directive);
      const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /不应包含源码指令/);
    });
  }
  fixture((dir, write) => {
    write('dist/background/extra.map', '{}');
    const result = audit(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /不应分发/);
  });
});
