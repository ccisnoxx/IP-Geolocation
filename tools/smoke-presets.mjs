#!/usr/bin/env node
/*
 * 全部内置 preset 的浏览器 E2E。
 *
 * 结构校验只能证明 ZIP 里有 20 条静态规则；这里真的把每个 preset 装进浏览器，
 * 用本地 HTTP 服务承接 claude.ai（host resolver 映射到 127.0.0.1），核对：
 *   - navigator.language / navigator.languages
 *   - Intl 时区
 *   - 首帧 Accept-Language
 *
 * 用法：
 *   node tools/smoke-presets.mjs
 *   CHROME_PATH="..." node tools/smoke-presets.mjs
 *   VANISHGEO_LEGACY_EXTENSION=1 ... node tools/smoke-presets.mjs  # Chrome 119
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable } from './lib/e2e.mjs';
import { readPresets } from '../scripts/lib/presets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const presets = readPresets(ROOT);

/*
 * 第二信源校验：解析器和源文本是同一份代码，它看错了这里也会跟着看错。
 * 弹窗卡片是别人手写的静态 HTML，两边 id 集合必须一致 —— 少了就说明解析器
 * 静默漏了 preset（曾经因为一行注释就吞掉五个），这时候跑下去只会打印"1/1 通过"。
 */
const cardIds = [...readFileSync(join(ROOT, 'src', 'popup', 'popup.html'), 'utf8')
  .matchAll(/data-profile="([^"]+)"/g)].map((match) => match[1]);
const missing = cardIds.filter((id) => !presets.some((preset) => preset.id === id));
const extra = presets.map((preset) => preset.id).filter((id) => !cardIds.includes(id));
if (missing.length || extra.length || !presets.length) {
  throw new Error(
    `内置 preset 与弹窗卡片对不上：解析到 ${presets.length} 个 [${presets.map((p) => p.id).join(', ')}]，`
    + `弹窗有 ${cardIds.length} 张 [${cardIds.join(', ')}]；`
    + `缺 [${missing.join(', ')}]，多 [${extra.join(', ')}]`
  );
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const tempRoot = mkdtempSync(join(tmpdir(), 'vanishgeo-presets-'));
const releaseDir = join(tempRoot, 'release');
let current = null;

function cleanup() {
  if (current) {
    try { current.cdp.close(); } catch { /* noop */ }
    try { killChrome(current.chrome.child); } catch { /* noop */ }
    current = null;
  }
  try { server.close(); } catch { /* noop */ }
  if (!argv.keep) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
process.on('exit', cleanup);

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://claude.ai');
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ acceptLanguage: req.headers['accept-language'] || '' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>preset probe</title></head><body>
    <p>preset probe</p>
  </body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const pageUrl = `http://claude.ai:${port}/`;

console.log(`构建 ${presets.length} 个 preset 到临时目录 …`);
execFileSync(process.execPath, [
  join(ROOT, 'scripts', 'release.mjs'),
  '--all-presets',
  `--out=${releaseDir}`
], { cwd: ROOT, stdio: 'pipe' });

for (const preset of presets) {
  const zip = join(releaseDir, `vanishgeo-${version}-${preset.id}.zip`);
  const extensionPath = join(tempRoot, `ext-${preset.id}`);
  if (!existsSync(zip)) {
    check(`${preset.id} 产物存在`, false, zip);
    continue;
  }
  execFileSync('unzip', ['-q', zip, '-d', extensionPath], { stdio: 'pipe' });
  if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') {
    process.env.VANISHGEO_EXTENSION = extensionPath;
  }
  const chrome = await launchChrome({
    userDataDir: mkdtempSync(join(tmpdir(), `vanishgeo-preset-${preset.id}-`)),
    headless: true,
    args: [
      '--lang=zh-CN',
      '--host-resolver-rules=MAP claude.ai 127.0.0.1'
    ]
  });
  const cdp = await CDP.connect(chrome.websocketUrl);
  current = { cdp, chrome };
  try {
    await loadExtension(cdp, extensionPath);
    const page = await openPageStable(cdp, pageUrl);
    const value = await evaluate(cdp, page.sessionId, `(async () => {
      const loaded = await fetch('/echo').then((response) => response.json());
      return {
        language: navigator.language,
        languages: [...navigator.languages],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        acceptLanguage: loaded.acceptLanguage || ''
      };
    })()`, { awaitPromise: true });
    const actual = `${value.language}/${value.timezone}/${value.acceptLanguage}`;
    check(
      `${preset.id} 页面语言/时区/请求头一致`,
      value.language === preset.language.language
        && value.languages[0] === preset.language.languages[0]
        && value.timezone === preset.timezone.timezone
        && value.acceptLanguage === preset.language.acceptLanguage,
      `${actual} want ${preset.language.language}/${preset.timezone.timezone}/${preset.language.acceptLanguage}`
    );
  } catch (error) {
    check(`${preset.id} 浏览器加载`, false, error instanceof Error ? error.message : String(error));
  } finally {
    try { cdp.close(); } catch { /* noop */ }
    try { killChrome(chrome.child); } catch { /* noop */ }
    current = null;
  }
}

await new Promise((done) => server.close(done));
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed ? 1 : 0;
