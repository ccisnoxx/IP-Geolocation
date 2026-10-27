#!/usr/bin/env node
/*
 * 平台声称一致性验证：一句话——「浏览器说的平台」与「字体层判定的平台」必须同步。
 *
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-platform.mjs
 *   node tools/smoke-platform.mjs --claim=windows
 *
 * 检查四处，任何一处掉队都算失败：
 *   1. 主线程 navigator.userAgent / platform / appVersion
 *   2. navigator.userAgentData.platform 与高熵值（platformVersion / architecture）
 *   3. Worker 里的 navigator（只改主线程时，开个 Worker 一问就穿帮）
 *   4. 请求头 User-Agent / Sec-CH-UA-Platform（服务端看到的必须和 JS 说的一致）
 * 另外顺带确认字体层跟着声称走：声称 windows 时 mac 字体（PingFang）应被判为不可见。
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, evaluate, launchChrome, sleep, killChrome } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const DOMAIN = String(argv.domain || 'claim.test');
const CLAIM = String(argv.claim || 'windows');
const extensionPath = String(argv.extension || join(ROOT, 'dist'));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>platform probe</title></head>
<body><h1>platform probe</h1>
<script>
window.__probe = (async () => {
  const uaData = navigator.userAgentData;
  const snapshot = async () => ({
    ua: navigator.userAgent,
    platform: navigator.platform,
    uaDataPlatform: uaData ? uaData.platform : null,
    high: uaData && uaData.getHighEntropyValues
      ? await uaData.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'uaFullVersion'])
      : null
  });

  // 首屏时刻先量一次：开发构建的 payload 是异步送的，这一刻通常还是原生值。
  // 这组数字不参与断言，只用来把"窗口"摆出来（烘焙构建里两次应该一致）。
  const early = await snapshot();
  await new Promise((done) => setTimeout(done, 500));
  const stable = await snapshot();

  const headers = await fetch('/headers').then((r) => r.json()).catch((error) => ({ error: String(error) }));
  const widths = (() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const measure = (font) => { ctx.font = '16px ' + font; return ctx.measureText('MMMM').width; };
    return { pingfang: measure('"PingFang SC"'), segoe: measure('"Segoe UI"'), mono: measure('monospace') };
  })();
  const worker = await new Promise((done) => {
    const blob = new Blob(['self.onmessage = () => self.postMessage({ ua: navigator.userAgent, platform: navigator.platform });'], { type: 'text/javascript' });
    const w = new Worker(URL.createObjectURL(blob));
    const timer = setTimeout(() => done({ error: 'worker 超时' }), 6000);
    w.onmessage = (event) => { clearTimeout(timer); done(event.data); };
    w.onerror = (event) => { clearTimeout(timer); done({ error: String(event.message || event.type) }); };
    w.postMessage('go');
  });
  return { early, stable, worker, widths, headers };
})();
</script></body></html>`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const certs = ensureCerts([DOMAIN]);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  const url = String(req.url || '/');
  if (url.startsWith('/headers')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(req.headers));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-platform-')),
  headless: true,
  args: ['--ignore-certificate-errors', `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1:${port}`]
});
const cdp = await CDP.connect(chrome.websocketUrl);
await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
for (let index = 0; index < 40; index += 1) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  if (targetInfos.some((item) => item.url.includes('/background/service-worker.js'))) break;
  await sleep(250);
}

// 用扩展自己的消息接口写配置：平台层打开 + 字体层打开（平台来自声称）
const { targetInfos } = await cdp.send('Target.getTargets');
const swTarget = targetInfos.find((item) => item.url.includes('/background/service-worker.js'));
const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
const extensionId = await evaluate(cdp, swSession, 'chrome.runtime.id');
const optionsTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/options/options.html` });
const optionsSession = (await cdp.send('Target.attachToTarget', { targetId: optionsTarget.targetId, flatten: true })).sessionId;
await sleep(900);
const seeded = await evaluate(cdp, optionsSession, `(async () => {
  const current = (await chrome.runtime.sendMessage({ action: 'getSiteConfig' })).config;
  current.masterEnabled = true;
  current.platform = { enabled: true, claimed: ${JSON.stringify(CLAIM)}, version: '', architecture: '' };
  current.canvas = Object.assign({}, current.canvas, { enabled: true, spoofFonts: true, hideCjkFonts: false, targetFonts: [] });
  if (!current.rules.some((rule) => rule.domain === ${JSON.stringify(DOMAIN)})) {
    current.rules.push({ id: 'rule-claim', domain: ${JSON.stringify(DOMAIN)}, enabled: true, overrides: current.rules[0] ? current.rules[0].overrides : {} });
  }
  await chrome.runtime.sendMessage({ action: 'setSiteConfig', config: current });
  return 'ok';
})()`, { awaitPromise: true });
if (seeded !== 'ok') {
  console.error('写入配置失败:', seeded);
  process.exit(1);
}
console.log(`配置：平台声称 ${CLAIM} · 已启用 ${DOMAIN}`);

// 动态 DNR 规则一落地，正在进行的那次导航会被 ERR_ABORTED（Chromium 的老毛病，
// 见 src/background/dnr.ts 的注释）。等规则稳定再开页，并允许重试一次。
await sleep(1500);
const page = await cdp.send('Target.createTarget', { url: 'about:blank' });
const pageSession = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
await cdp.send('Page.enable', {}, pageSession);
for (let attempt = 1; attempt <= 2; attempt += 1) {
  await cdp.send('Page.navigate', { url: `https://${DOMAIN}/` }, pageSession);
  await sleep(2500);
  const href = await evaluate(cdp, pageSession, 'location.href').catch(() => '');
  if (String(href).startsWith('https://')) break;
  await sleep(1200);
}
await sleep(1500);

const raw = await evaluate(cdp, pageSession, 'window.__probe ? window.__probe.then((value) => JSON.stringify(value)) : null', { awaitPromise: true });
if (!raw) {
  const state = await evaluate(cdp, pageSession, `JSON.stringify({ href: location.href, ready: document.readyState, title: document.title, hasProbe: typeof window.__probe, body: document.body ? document.body.textContent.slice(0, 80) : null })`).catch((error) => String(error && error.message));
  console.error('页面探针没有拿到结果：', state);
  process.exit(1);
}
const probe = JSON.parse(raw);

const EXPECT = {
  windows: { uaToken: 'Windows NT 10.0; Win64; x64', platform: 'Win32', uaData: 'Windows', header: '"Windows"', macFontHidden: true },
  mac: { uaToken: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'MacIntel', uaData: 'macOS', header: '"macOS"', macFontHidden: false },
  linux: { uaToken: 'X11; Linux x86_64', platform: 'Linux x86_64', uaData: 'Linux', header: '"Linux"', macFontHidden: true }
}[CLAIM];
if (!EXPECT) {
  console.error(`未知的声称平台：${CLAIM}`);
  process.exit(1);
}

console.log('');
const stable = probe.stable;
console.log('页面读到（首屏时刻 → 稳定后）：');
console.log(`  UA            ${probe.early.ua.slice(0, 52)}… → ${stable.ua.slice(0, 52)}…`);
console.log(`  platform      ${probe.early.platform} → ${stable.platform}`);
console.log(`  UA-CH         ${probe.early.uaDataPlatform} → ${stable.uaDataPlatform} ${JSON.stringify(stable.high)}`);
console.log(`  Worker        ${probe.worker.error ? probe.worker.error : probe.worker.ua + ' / ' + probe.worker.platform}`);
console.log(`  请求头        User-Agent=${probe.headers['user-agent']}  Sec-CH-UA-Platform=${probe.headers['sec-ch-ua-platform']}`);
console.log(`  字体宽度      PingFang=${probe.widths.pingfang}  Segoe=${probe.widths.segoe}  mono=${probe.widths.mono}`);
console.log('');

check('主线程 UA 声称了目标平台', stable.ua.includes(EXPECT.uaToken), stable.ua.slice(0, 60));
check('navigator.platform 与 UA 同步', stable.platform === EXPECT.platform, `${stable.platform} vs ${EXPECT.platform}`);
check('userAgentData.platform 与 UA 同步', stable.uaDataPlatform === EXPECT.uaData, `${stable.uaDataPlatform} vs ${EXPECT.uaData}`);
check('高熵 platformVersion 存在', Boolean(stable.high && stable.high.platformVersion), String(stable.high && stable.high.platformVersion));
check('Worker 里的 UA 与主线程一致', !probe.worker.error && probe.worker.ua === stable.ua, probe.worker.error || 'ok');
check('请求头 User-Agent 与 JS 一致', String(probe.headers['user-agent'] || '').includes(EXPECT.uaToken));
check('请求头 Sec-CH-UA-Platform 与 UA-CH 一致', String(probe.headers['sec-ch-ua-platform'] || '') === EXPECT.header, String(probe.headers['sec-ch-ua-platform']));
const macHidden = Math.abs(probe.widths.pingfang - probe.widths.mono) < 0.01;
check(
  EXPECT.macFontHidden ? '字体层跟着声称：mac 字体被判为不可见' : '字体层跟着声称：mac 字体保留',
  macHidden === EXPECT.macFontHidden,
  `PingFang=${probe.widths.pingfang} mono=${probe.widths.mono}`
);

const failed = results.filter((item) => !item.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} 通过`);
await killChrome(chrome);
server.close();
process.exit(failed.length ? 1 : 0);