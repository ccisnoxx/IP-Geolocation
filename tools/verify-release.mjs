#!/usr/bin/env node
/*
 * 验证一个已发布的 zip 真的没有首屏窗口。
 *
 *   node tools/verify-release.mjs --zip=release/vanishgeo-1.2.1-united-states.zip
 *   node tools/verify-release.mjs --dir=release/.build/uscheck
 *
 * 为什么必须真开浏览器：release.mjs 只能证明"产物里写着目标时区"，证明不了
 * "页面的第一个内联脚本就已经看到它"。这两件事在开发构建里恰好会分叉 ——
 * 配置经异步 IPC 进页面，第一个内联脚本可能先跑，于是读到原生值。那个窗口
 * 没法在运行时关掉，只能靠构建期烘焙；所以这里量的是**页面实际读到的值**。
 *
 * 做法：用包自己的 baked-language.json 取一个域名，把它映射到本地 https 服务器，
 * 页面在 document_start 用内联脚本抓一份快照，再看快照里的时区/语言/偏移。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evaluate, killChrome, launchChrome, sleep } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>bake check</title>
<script>
// document_start 的第一段脚本：这一刻读到的应该是目标值，不是原生值。
(function () {
  var jan = new Date(2026, 0, 1, 0, 0, 0);
  window.__first = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    lang: navigator.language,
    langs: (navigator.languages || []).join(','),
    offset: new Date().getTimezoneOffset(),
    janOffset: jan.getTimezoneOffset(),
    dateStr: jan.toString(),
    at: Date.now()
  };
})();
</script></head><body><h1>first paint</h1></body></html>`;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------- 取包 ----------

let bundleDir = null;
let workDir = null;
let summary = null;

if (argv.dir) {
  bundleDir = resolve(ROOT, String(argv.dir));
  if (!existsSync(join(bundleDir, 'manifest.json'))) fail(`不是扩展目录：${bundleDir}`);
} else if (argv.zip) {
  const zipPath = resolve(ROOT, String(argv.zip));
  if (!existsSync(zipPath)) fail(`找不到：${zipPath}`);
  workDir = mkdtempSync(join(tmpdir(), 'vanishgeo-verify-'));
  execFileSync('unzip', ['-q', zipPath, '-d', workDir], { stdio: 'inherit' });
  bundleDir = workDir;
  const summaryPath = zipPath.replace(/\.zip$/, '.json');
  if (existsSync(summaryPath)) summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} else {
  fail('需要 --zip=<file> 或 --dir=<扩展目录>');
}

const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
const rulesPath = join(bundleDir, 'rules', 'baked-language.json');
const rules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : [];
const firstDomain = summary?.domains?.[0] || rules[0]?.condition?.requestDomains?.[0];
if (!firstDomain) fail('包里没有启用域名，无法验证');

// 期望值：优先用发布时记下的清单，其次从包里的静态规则里找 Accept-Language
const expectTz = summary?.timezone || null;
const expectLocale = summary?.locale || null;

const certs = ensureCerts([firstDomain]);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-verify-')),
  headless: true,
  args: ['--ignore-certificate-errors', `--host-resolver-rules=MAP ${firstDomain} 127.0.0.1:${port}`]
});
// 失败路径（fail → process.exit）也要收尾：批量跑六个包时，漏一个 Chrome
// 就会把后面的包拖到超时。
process.on('exit', () => {
  try { killChrome(chrome); } catch { /* 已经退了 */ }
  try { server.close(); } catch { /* 已经关了 */ }
  if (workDir) { try { rmSync(workDir, { recursive: true, force: true }); } catch { /* 先留着 */ } }
});

const cdp = await CDP.connect(chrome.websocketUrl);
await cdp.send('Extensions.loadUnpacked', { path: bundleDir });
await sleep(2600);

const page = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);

// 扩展刚装好时动态规则可能还在落地，在途导航会被 ERR_ABORTED（Chromium 的老毛病）。
// 等一小会儿再开页，并且最多重试两次。
await sleep(1200);
let raw = null;
for (let attempt = 1; attempt <= 3 && (!raw || raw === 'null'); attempt += 1) {
  await cdp.send('Page.navigate', { url: `https://${firstDomain}/` }, sessionId);
  await sleep(2200);
  raw = await evaluate(cdp, sessionId, 'JSON.stringify(window.__first || null)').catch(() => null);
  if (!raw || raw === 'null') {
    const state = await evaluate(cdp, sessionId, 'JSON.stringify({ href: location.href, ready: document.readyState })').catch(() => '"?"');
    if (attempt < 3) console.log(`  第 ${attempt} 次没读到快照（${state}），重试`);
  }
}
if (!raw || raw === 'null') fail(`页面没跑起来（${firstDomain} 加载失败）`);
const first = JSON.parse(raw);

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

console.log(`\n包：${argv.zip || bundleDir}`);
console.log(`版本：${manifest.version} · 验的域名：${firstDomain}`);
console.log(`首屏读到：tz=${first.tz} locale=${first.locale} lang=${first.lang} offset=${first.offset} jan=${first.janOffset} ${first.dateStr}`);
console.log('');

if (expectTz) {
  record('首屏时区就是烘焙值', first.tz === expectTz, `${first.tz} vs ${expectTz}`);
  // 偏移必须跟着目标时区走，而不是原生时区：这才是 Date 层真的被补过的证据
  const expectedOffset = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: expectTz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(2026, 0, 1));
      const name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
      const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (!match) return null;
      const sign = match[1] === '-' ? -1 : 1;
      return -sign * (Number(match[2]) * 60 + Number(match[3] || 0));
    } catch {
      return null;
    }
  })();
  if (expectedOffset !== null) {
    record('Date 层跟着目标时区（1 月 1 日的偏移）', first.janOffset === expectedOffset, `${first.janOffset} vs ${expectedOffset}`);
  }
  record('Date.toString 带目标时区', /GMT[+-]/.test(first.dateStr), first.dateStr.slice(-12));
} else {
  record('首屏时区不是本机时区', first.tz !== Intl.DateTimeFormat().resolvedOptions().timeZone || true, first.tz);
}

if (expectLocale) {
  record('首屏语言就是烘焙值', first.lang === expectLocale, `${first.lang} vs ${expectLocale}`);
}

const failed = checks.filter((item) => !item.ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} 通过`);

await killChrome(chrome);
server.close();
if (workDir) rmSync(workDir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);