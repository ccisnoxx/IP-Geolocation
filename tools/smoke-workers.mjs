#!/usr/bin/env node
/*
 * Worker / SharedWorker 覆盖面回归。
 *
 *   node tools/smoke-workers.mjs                 # 跑 dist
 *   node tools/smoke-workers.mjs --extension=... # 跑烘焙包
 *
 * 这个工具盯的是"包装 Worker 入口"这件事的代价，不是时区值本身：
 *
 *   1. classic Worker 仍然被包装（blob 前缀）→ 里面的 Date 跟着规则走；
 *   2. SharedWorker **不包装** —— 包装会把入口换成每次新建的 blob URL，而
 *      SharedWorker 的身份就是 (resolved URL, name)，换掉 URL 等于让每个文档
 *      各建一个实例，跨文档共享语义当场消失。这个工具用 connections 计数把
 *      两种状态区分开：
 *        包装时：两个标签页各自 connections=1、workerUrl=blob:
 *        不包装：第二个标签页 connections=2、workerUrl=http(s):
 *   3. 页内顶层值必须已经被伪装，否则"Worker 里是原生值"说明不了任何事。
 *
 * 结论只用于回归：SharedWorker 不在覆盖范围，它读到原生值是**预期行为**，
 * 检测方问它得到的是真值，不是矛盾值。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join, resolve, sep } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const extensionPath = String(argv.extension || process.env.VANISHGEO_EXTENSION || 'dist');
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  })[extname(file)] || 'application/octet-stream';
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(`${ROOT}${sep}`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const body = await readFile(file);
    // ?csp=1 只加 worker-src 'self'：同源脚本照常，blob 入口被拒 ——
    // 这正是"包装失败要可见"要覆盖的场景。
    const headers = { 'content-type': contentType(file) };
    if (url.searchParams.has('csp') && file.endsWith('.html')) {
      headers['content-security-policy'] = "worker-src 'self'";
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-workers-')),
  headless: true,
  args: ['--lang=en-US', '--host-resolver-rules=MAP localhost 127.0.0.1, MAP csp.localhost 127.0.0.1']
});
const cdp = await CDP.connect(chrome.websocketUrl);
const extensionId = await loadExtension(cdp, extensionPath);
if (!extensionId) throw new Error('扩展没有返回 extension id');

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { cdp.close(); } catch { /* already closed */ }
  try { killChrome(chrome.child); } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
}
process.on('exit', cleanup);

const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
await sleep(800);

async function send(message) {
  const response = await sendRuntimeMessage(cdp, options.sessionId, message);
  if (!response || response.status !== 'ok') {
    throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
  }
  return response;
}

const base = (await send({ action: 'getSiteConfig' })).config;
const globalProfile = {
  ...base.globalProfile,
  language: {
    enabled: true,
    mode: 'preset',
    language: 'ja-JP',
    languages: ['ja-JP', 'ja'],
    acceptLanguage: 'ja-JP,ja;q=0.9'
  },
  timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
  geolocation: { ...base.globalProfile.geolocation, enabled: false, mode: 'auto', latitude: null, longitude: null }
};
await send({
  action: 'setSiteConfig',
  // csp.localhost 单独一条规则：`*://localhost/*` 不覆盖子域（Chrome 匹配模式里
  // 裸域名不生成 `*.` 通配），而 CSP 用例需要完全独立的 hostname 来隔离回报记录。
  config: {
    ...base,
    masterEnabled: true,
    globalProfile,
    rules: [
      { domain: 'localhost', enabled: true },
      { domain: 'csp.localhost', enabled: true }
    ]
  }
});
await sleep(600);

const pageUrl = `http://localhost:${port}/fixtures/workers/top.html`;
const pageA = await openPageStable(cdp, pageUrl);
const pageB = await openPageStable(cdp, pageUrl);
await sleep(800);

// 嵌套：父 Worker 里用**相对路径**再建子 Worker —— 既验子 Worker 被接管，也验相对路径
// 按原脚本地址解析（父 Worker 的入口是 blob，按 location 解析会落到 blob: 上）
const NESTED_PROBE = `new Promise((resolve) => {
  const worker = new Worker('nested-parent.js');
  const timer = setTimeout(() => { worker.terminate(); resolve({ status: 'timeout' }); }, 5000);
  worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
  worker.onerror = (event) => {
    clearTimeout(timer);
    worker.terminate();
    resolve({ status: 'error', error: event && event.message ? event.message : 'nested parent failed' });
  };
  worker.postMessage({ childUrl: 'nested-child.js' });
})`;

const CLASSIC_PROBE = `new Promise((resolve) => {
  const worker = new Worker('worker-classic.js');
  const timer = setTimeout(() => { worker.terminate(); resolve({ status: 'timeout' }); }, 5000);
  worker.onmessage = (event) => {
    clearTimeout(timer);
    worker.terminate();
    resolve(event.data);
  };
  worker.onerror = (event) => {
    clearTimeout(timer);
    worker.terminate();
    resolve({ status: 'error', error: event && event.message ? event.message : 'worker failed' });
  };
})`;

const SHARED_PROBE = (name) => `new Promise((resolve) => {
  const worker = new SharedWorker('/fixtures/workers/shared-counter.js', ${JSON.stringify(name)});
  const port = worker.port;
  if (typeof port.start === 'function') port.start();
  const timer = setTimeout(() => resolve({ status: 'timeout' }), 5000);
  port.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
  port.onerror = (event) => {
    clearTimeout(timer);
    resolve({ status: 'error', error: event && event.message ? event.message : 'shared worker failed' });
  };
})`;

const pageValues = async (page) => JSON.parse(await evaluate(cdp, page.sessionId, `JSON.stringify({
  language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
})`));

const topA = await pageValues(pageA);
check(
  '页面顶层已被规则伪装（说明扩展在这一页生效）',
  topA.language === 'ja-JP' && topA.timezone === 'Asia/Tokyo',
  JSON.stringify(topA)
);

// 原生基线必须现场取。这台机器原生是 zh-CN / Asia/Shanghai，CI runner 上是
// en-US / UTC —— 钉死任何一个值，另一台机器上就会变成假红（这条 CI 第一次
// 跑就撞上了）。127.0.0.1 不在规则里（规则只有 localhost / csp.localhost），
// Chrome 的匹配模式里裸域名不生成 `*.` 通配，所以它读到的是原生值。
const nativePage = await openPageStable(cdp, `http://127.0.0.1:${port}/fixtures/workers/top.html`);
const nativeTop = await pageValues(nativePage);
check(
  '原生基线取自未命中规则的地址（127.0.0.1 不在白名单里）',
  nativeTop.language !== 'ja-JP' && nativeTop.timezone !== 'Asia/Tokyo',
  JSON.stringify(nativeTop)
);

const classic = await evaluate(cdp, pageA.sessionId, CLASSIC_PROBE, { awaitPromise: true });
check(
  'classic Worker 仍被包装：时区/语言跟着规则走',
  classic && classic.timezone === 'Asia/Tokyo' && classic.language === 'ja-JP',
  JSON.stringify(classic)
);
check(
  'classic Worker 初始化没有被打断（blob 前缀没有让构造失败）',
  Boolean(classic) && typeof classic.status === 'undefined',
  String(classic && classic.status)
);

const nested = await evaluate(cdp, pageA.sessionId, NESTED_PROBE, { awaitPromise: true });
check(
  '嵌套 Worker 被接管：孙 Worker 的时区/语言跟着规则走',
  Boolean(nested) && nested.status === 'ok' && nested.result
    && nested.result.timezone === 'Asia/Tokyo' && nested.result.language === 'ja-JP'
    && nested.result.numberFormatLocale === 'ja-JP',
  JSON.stringify(nested)
);

const sharedA = await evaluate(cdp, pageA.sessionId, SHARED_PROBE('vg-share'), { awaitPromise: true });
// 第二个标签页连同一个 (URL, name)：真共享会累加到 2
const sharedB = await evaluate(cdp, pageB.sessionId, SHARED_PROBE('vg-share'), { awaitPromise: true });
await sleep(300);
// 再问一次 A：如果 A/B 连的是同一个实例，A 这次也应看到累加后的计数
const sharedA2 = await evaluate(cdp, pageA.sessionId, SHARED_PROBE('vg-share'), { awaitPromise: true });

const sharedUrl = String((sharedA && sharedA.workerUrl) || '');
const sharedNative = sharedA
  && sharedA.timezone === nativeTop.timezone
  && sharedA.language === nativeTop.language;
const sharedBare = sharedUrl.startsWith(`http://localhost:${port}/fixtures/workers/shared-counter.js`);

check(
  'SharedWorker 不被包装：入口仍是页面的脚本地址',
  sharedBare,
  sharedUrl || 'missing'
);
check(
  'SharedWorker 跨标签页共享同一实例（connections 累加）',
  Boolean(sharedA && sharedB && sharedA2)
    && sharedB.connections > sharedA.connections
    && sharedA2.connections > sharedB.connections,
  `A=${sharedA && sharedA.connections} B=${sharedB && sharedB.connections} A2=${sharedA2 && sharedA2.connections}`
);
check(
  'SharedWorker 读到原生值（不伪装，符合 UNSUPPORTED 声明）',
  Boolean(sharedNative),
  JSON.stringify(sharedA)
);

// ---------- CSP 拒绝 blob：包装失败必须可见 ----------

const cspUrl = `http://csp.localhost:${port}/fixtures/workers/top.html?csp=1`;
const cspPage = await openPageStable(cdp, cspUrl);
await sleep(800);

const cspTop = await pageValues(cspPage);
check(
  'CSP 页面本身仍被伪装（顶层 payload 不受 worker-src 影响）',
  cspTop.language === 'ja-JP' && cspTop.timezone === 'Asia/Tokyo',
  JSON.stringify(cspTop)
);

const cspWorker = await evaluate(cdp, cspPage.sessionId, CLASSIC_PROBE, { awaitPromise: true });
check(
  'CSP 拒绝 blob 后 Worker 仍能跑（回退原生入口，不是直接坏掉）',
  Boolean(cspWorker) && typeof cspWorker.status === 'undefined' && cspWorker.workerType === 'classic',
  JSON.stringify(cspWorker)
);
check(
  '回退后的 Worker 读到原生值（明确知道它没被接管）',
  Boolean(cspWorker)
    && cspWorker.timezone === nativeTop.timezone
    && cspWorker.language === nativeTop.language,
  `${cspWorker && cspWorker.language}/${cspWorker && cspWorker.timezone}`
);

let fallback = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  const response = await send({ action: 'getWorkerFallbacks', url: cspUrl });
  if (response.fallback && response.fallback.count > 0) {
    fallback = response.fallback;
    break;
  }
  await sleep(150);
}
check(
  '包装失败被上报到后台（弹窗/诊断因此能显示）',
  Boolean(fallback),
  fallback ? JSON.stringify({ count: fallback.count, reasons: fallback.reasons, script: fallback.lastScript }) : 'no report'
);
check(
  '上报原因归为 csp-blocked，且指向被包装过的夹具脚本',
  Boolean(fallback)
    && Array.isArray(fallback.reasons)
    && fallback.reasons.includes('csp-blocked')
    && /\/fixtures\/workers\/(worker-classic|worker-module|nested-parent)\.js$/.test(String(fallback.lastScript)),
  fallback ? `${fallback.reasons} ${fallback.lastScript}` : 'missing'
);
check(
  '夹具里每个被包装的 Worker 都记了一笔（classic / module / nested-parent）',
  Boolean(fallback) && Number(fallback.count) >= 3,
  fallback ? `count=${fallback.count}` : 'missing'
);

// ---------- 诊断页真的把覆盖面和观察值渲染出来了 ----------

const leakPage = await openPageStable(cdp, `chrome-extension://${extensionId}/leak-test/leak-test.html`);
let coverageText = '';
for (let attempt = 0; attempt < 40; attempt += 1) {
  coverageText = (await evaluate(cdp, leakPage.sessionId,
    "document.getElementById('workerCoverage')?.textContent || ''", {})) || '';
  if (coverageText && coverageText.includes('classic/module')) break;
  await sleep(150);
}
check(
  '诊断页渲染出 Worker 覆盖面（声明 + 回退观察）',
  coverageText.includes('classic/module') && coverageText.includes('不支持'),
  coverageText || 'empty'
);

cleanup();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);