#!/usr/bin/env node
// 只读核验当前 dist 与本地 ZIP；不生成 tag、不发布、不修改版本。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'tabs', 'contextMenus', 'privacy', 'userScripts', 'declarativeNetRequestWithHostAccess', 'contentSettings', 'alarms']);

assert.equal(manifest.minimum_chrome_version, '138');
assert.deepEqual(manifest.background, { service_worker: 'background/service-worker.js', type: 'module' });
assert.deepEqual(manifest.declarative_net_request, { rule_resources: [
  { id: 'header_migration_guard', enabled: true, path: 'rules/header-migration-guard.json' }
] });
const guardPath = 'rules/header-migration-guard.json';
assert.ok(files.has(guardPath), '缺少默认隔离规则');
assert.deepEqual(JSON.parse(files.get(guardPath)), [{
  id: 1, priority: 2147483647, action: { type: 'allow' },
  condition: { regexFilter: '^https?://', resourceTypes: [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
    'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
  ] }
}], '默认隔离规则必须覆盖当前 HTTP(S) 资源类型');
assert.equal(files.get(guardPath).equals(await readFile(join(root, guardPath))), true, '隔离规则与维护源字节不一致');
const fontEntry = 'font-exposure/filter.js';
assert.ok(files.has(fontEntry), '缺少固定字体过滤入口');

const entries = ['background/service-worker.js', 'content/content.js', 'popup/popup.js', 'options/options.js', 'leak-test/leak-test.js', 'diagnostic/report.js'];
for (const name of [...entries, 'manifest.json', 'LICENSE', 'NOTICE', manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) assert.ok(files.has(name), `缺少入口：${name}`);
const graph = new Map(), resourceReferences = [];
const sensitiveFindings = [];
for (const [name, bytes] of files) {
  assert.ok(!/\.map$|\.ts$|(^|\/)\.(git|env)|node_modules|__MACOSX|\.DS_Store/.test(name), `不应分发：${name}`);
  if (!/\.(js|html|css|json|md)$/.test(name) && !['LICENSE', 'NOTICE'].includes(name)) continue;
  const text = bytes.toString('utf8');
  // 普通sourceURL标识符不是调试指令；同时检查嵌入运行时字符串中的真实指令。
  assert.equal(/\/[/*][#@]\s*(?:sourceMappingURL|sourceURL)\s*=/.test(text), false, `不应包含源码指令：${name}`);
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
    // 解析实际模块语句；模板内的 Worker 源代码不是本文件的依赖。
    const imports = [];
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.ok(node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]), `无法静态核实的动态模块：${name}`);
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
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
[...entries, fontEntry].forEach(walk);
assert.deepEqual(graph.get(fontEntry), [], '字体过滤必须保持单文件自包含');
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
  scope: 'current-release-artifact', result: 'PASS', version: pkg.version,
  inventoryHashAlgorithm: 'SHA-256(JSON.stringify(path-localeCompare-sorted [path, file-SHA-256] pairs))',
  candidateDistSha256: hash(JSON.stringify(inventory)), zipSha256: hash(await readFile(archive)),
  files: inventory.map(([path, sha256]) => ({ path, sha256, bytes: files.get(path).length })),
  checks: { manifestMatchesSource: true, packageLockManifestVersion: true, mv3: true, currentPermissionContract: true, minimumChrome138: true, defaultHeaderIsolation: true, standaloneFontEntry: true, noStaticContentScripts: true, noWebAccessibleResources: true,
    entries: entries.length, sharedChunks: chunks, localModuleReferences: [...graph.values()].reduce((sum, list) => sum + list.length, 0), htmlResourceReferences: resourceReferences.length,
    noOrphanChunks: true, noRemoteExecutableImports: true, noRuntimeCompilation: true, noSourceMaps: true, sensitivePatternHits: 0, productionRuntimeNotBundled: true, zipRootManifest: true, zipByteIdentical: true },
  limitations: ['静态模式及依赖图审查，不证明所有可计算URL或任意秘密均不存在；还需维护源审查', '合法外部调用为provider、hosted诊断和既有STUN，不是远程代码；NOTICE保留许可来源URL', '本地ZIP未发布；版本不改，tag一致性仍需未来人工核对']
};
await writeFile(args[3], JSON.stringify(result, null, 2) + '\n');
console.log(`Release artifact PASS: ${files.size} files, ${chunks.length} shared chunks; version=${pkg.version}; dist=${result.candidateDistSha256}; zip=${result.zipSha256}`);
