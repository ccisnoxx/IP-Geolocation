#!/usr/bin/env node
// 只读采集官方 Chromium 固定提交摘要和本机安装类型；不保存上游源码或个人路径。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--output', '参数：--output <脱敏JSON>');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = 'https://chromium.googlesource.com/chromium/src';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
const paths = ['extensions/browser/scripting_utils.cc', 'extensions/browser/script_executor.cc',
  'extensions/browser/extension_api_frame_id_map.cc', 'extensions/browser/api/scripting/scripting_api.cc'];
const tokens = ['CollectFramesForInjection', 'GetRenderFrameHostByDocumentId', 'GetRenderFrameHostById',
  'frame_ids.insert', 'ExecuteScript', 'document_ids', 'GetLifecycleState', 'IsInPrimaryMainFrame', 'CanAccessTarget'];
const sources = [];
for (const ref of ['refs/tags/155.0.8059.40', 'refs/heads/main']) {
  try {
    const metadata = JSON.parse((await get(`${base}/+/${ref}?format=JSON`)).replace(/^\)\]\}'\n/, ''));
    assert.match(metadata.commit, /^[a-f0-9]{40}$/);
    for (const path of paths) {
      const url = `${base}/+/${metadata.commit}/${path}?format=TEXT`;
      try {
        const bytes = Buffer.from(await get(url), 'base64'), lines = bytes.toString().split('\n');
        sources.push({ ref, commit: metadata.commit, path, url, sha256: hash(bytes), lineCount: lines.length,
          symbols: tokens.map(symbol => ({ symbol, lines: lines.flatMap((line, i) => line.includes(symbol) ? [i + 1] : []) })).filter(v => v.lines.length) });
      } catch (error) { sources.push({ ref, commit: metadata.commit, path, collection: 'UNAVAILABLE', reason: error.message }); }
    }
  } catch (error) { sources.push({ ref, collection: 'UNAVAILABLE', reason: error.message }); }
}
const typePath = 'node_modules/@types/chrome/index.d.ts';
const text = await readFile(join(root, typePath), 'utf8');
const ast = ts.createSourceFile('chrome.d.ts', text, ts.ScriptTarget.Latest, true);
const interfaces = {};
function visit(node) {
  if (ts.isInterfaceDeclaration(node) && ['RegisteredContentScript', 'ScriptInjection', 'InjectionTarget'].includes(node.name.text)) {
    interfaces[node.name.text] = node.members.map(m => m.name?.getText(ast)).filter(Boolean);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(interfaces.RegisteredContentScript.includes('js'));
assert.equal(interfaces.RegisteredContentScript.includes('args'), false);
const packageVersion = JSON.parse(await readFile(join(root, 'node_modules/@types/chrome/package.json'), 'utf8')).version;
await writeFile(args[1], JSON.stringify({ tasks: ['VG-015', 'VG-017'], collectedOn: new Date().toISOString(),
  sources, installedTypes: { path: typePath, version: packageVersion, sha256: hash(text), interfaces },
  limitations: ['main固定到本次解析的commit，不代表已发布Chrome或本机binary', '符号和摘要用于定位；安全结论必须阅读控制流并结合行为证据', '未扫描全部Chromium历史或验证所有已发布版本；不宣称上游不存在修复', '仅访问官方Gitiles公开源码，不发送配置、浏览历史或用户数据'] }, null, 2) + '\n');
console.log(`Upstream collection: ${sources.filter(s => s.sha256).length} files; unavailable=${sources.filter(s => s.collection === 'UNAVAILABLE').length}; types=${packageVersion}`);
