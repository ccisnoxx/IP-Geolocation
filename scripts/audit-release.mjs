#!/usr/bin/env node
// 只读核验当前 dist 与本地 ZIP；不生成 tag、不发布、不修改版本。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.length === 4 && args[0] === '--zip' && args[2] === '--output', '参数：--zip <本地ZIP> --output <脱敏JSON>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
async function visit(directory, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    assert.equal(item.isSymbolicLink(), false, `构建含符号链接：${name}`);
    if (item.isDirectory()) await visit(join(directory, item.name), `${name}/`);
    else files.set(name, await readFile(join(directory, item.name)));
  }
}
await visit(join(root, 'dist'));
const manifest = JSON.parse(files.get('manifest.json'));
const sourceManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
assert.deepEqual(manifest, sourceManifest);
assert.equal(manifest.version, pkg.version); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
assert.equal(manifest.manifest_version, 3); assert.equal(manifest.content_scripts, undefined);
assert.deepEqual(manifest.web_accessible_resources, []);
assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'tabs', 'contextMenus', 'privacy', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess']);

const entries = ['background/service-worker.js', 'content/content.js', 'popup/popup.js', 'options/options.js', 'leak-test/leak-test.js', 'diagnostic/report.js'];
for (const name of [...entries, 'manifest.json', 'LICENSE', 'NOTICE', manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) assert.ok(files.has(name), `缺少入口：${name}`);
const graph = new Map(), resourceReferences = [];
const sensitiveFindings = [];
for (const [name, bytes] of files) {
  assert.ok(!/\.map$|\.ts$|(^|\/)\.(git|env)|node_modules|__MACOSX|\.DS_Store/.test(name), `不应分发：${name}`);
  if (!/\.(js|html|css|json|md)$/.test(name) && !['LICENSE', 'NOTICE'].includes(name)) continue;
  const text = bytes.toString('utf8');
  assert.doesNotMatch(text, /sourceMappingURL|sourceURL/);
  // 只保留命中路径，不输出可疑内容。
  if (/(?:\/Users\/|\/home\/)[^\s'"<>]+|[A-Z]:\\Users\\|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/.test(text)) sensitiveFindings.push(name);
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const octets = match[0].split('.').map(Number);
    if (octets.some(n => n > 255)) continue;
    const [a, b, c] = octets;
    // 仅允许 loopback/未指定地址和明确的文档合成地址，不把 RFC1918 当可公开数据。
    if (!(a === 127 || match[0] === '0.0.0.0' || a === 192 && b === 0 && c === 2 || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113)) sensitiveFindings.push(name);
  }
  if (name.endsWith('.js')) {
    assert.doesNotMatch(text, /\beval\s*\(|\bnew\s+Function\s*\(/, `运行期编译：${name}`);
    const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)].map(m => m[1]);
    const dependencies = imports.map(specifier => {
      assert.ok(specifier.startsWith('.'), `非本地模块：${name}`);
      const target = posix.normalize(posix.join(posix.dirname(name), specifier));
      assert.ok(files.has(target), `缺失模块：${name} -> ${target}`);
      return target;
    });
    graph.set(name, dependencies);
  }
  if (name.endsWith('.html')) {
    for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) {
      const reference = match[1];
      assert.doesNotMatch(reference, /^(?:https?:)?\/\//, `远程可执行/样式资源：${name}`);
      if (reference.startsWith('data:')) continue;
      const target = reference.startsWith('/') ? reference.slice(1) : posix.normalize(posix.join(posix.dirname(name), reference));
      assert.ok(files.has(target), `缺失HTML资源：${name} -> ${target}`);
      resourceReferences.push([name, target]);
    }
  }
  if (name.endsWith('.css')) assert.doesNotMatch(text, /(?:@import|url\()[^;\n]*https?:/);
}
assert.deepEqual([...new Set(sensitiveFindings)], [], '构建存在待人工核实的敏感数据命中');
const reached = new Set();
function walk(name) { if (reached.has(name)) return; reached.add(name); for (const next of graph.get(name) || []) walk(next); }
entries.forEach(walk);
const chunks = [...files.keys()].filter(name => name.startsWith('assets/') && name.endsWith('.js')).sort();
for (const name of chunks) assert.ok(reached.has(name), `非入口可达共享chunk：${name}`);
assert.equal(files.has('injected/runtime.js'), false);
assert.doesNotMatch(files.get('background/service-worker.js').toString(), /applyVanishGeoRuntime|virtual:vanishgeo-runtime/);

// unzip -p 逐文件验证，ZIP 根直接是 manifest；目录条目忽略但拒绝路径逃逸与重复。
const archive = resolve(args[1]);
const listed = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
assert.equal(new Set(listed).size, listed.length, 'ZIP 重复条目');
for (const name of listed) assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'ZIP 非法路径');
const zippedFiles = listed.filter(name => !name.endsWith('/')).sort();
assert.deepEqual(zippedFiles, [...files.keys()].sort(), 'ZIP 必须完整且仅包含当前 dist');
for (const name of zippedFiles) assert.equal(hash(execFileSync('unzip', ['-p', archive, name], { maxBuffer: 8 * 1024 * 1024 })), hash(files.get(name)), `ZIP 字节不一致：${name}`);
const inventory = [...files].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b));
const result = {
  task: 'VG-014', result: 'PASS', version: pkg.version,
  candidateDistSha256: hash(JSON.stringify(inventory)), zipSha256: hash(await readFile(archive)),
  files: inventory.map(([path, sha256]) => ({ path, sha256, bytes: files.get(path).length })),
  checks: { manifestMatchesSource: true, packageLockManifestVersion: true, mv3: true, permissionsUnchanged: true, noStaticContentScripts: true, noWebAccessibleResources: true,
    entries: entries.length, sharedChunks: chunks, localModuleReferences: [...graph.values()].reduce((sum, list) => sum + list.length, 0), htmlResourceReferences: resourceReferences.length,
    noOrphanChunks: true, noRemoteExecutableImports: true, noRuntimeCompilation: true, noSourceMaps: true, sensitivePatternHits: 0, productionRuntimeNotBundled: true, zipRootManifest: true, zipByteIdentical: true },
  limitations: ['静态模式及依赖图审查，不证明所有可计算URL或任意秘密均不存在；还需维护源审查', '合法外部调用为provider、hosted诊断和既有STUN，不是远程代码；NOTICE保留许可来源URL', '本地ZIP未发布；版本不改，tag一致性仍需未来人工核对']
};
await writeFile(args[3], JSON.stringify(result, null, 2) + '\n');
console.log(`VG-014 artifact PASS: ${files.size} files, ${chunks.length} shared chunks; version=${pkg.version}; dist=${result.candidateDistSha256}; zip=${result.zipSha256}`);
