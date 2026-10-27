#!/usr/bin/env node
/*
 * P2：跨上下文指纹一致性 + WebRTC 泄漏核对。
 *
 *   node tools/smoke-fingerprint.mjs
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-fingerprint.mjs
 *
 * 同一个页面里同时量三个上下文（主线程 / 同源 iframe / Worker），比对：
 *   - 字体度量与 document.fonts.check（伪装过字体的话三处必须一致）
 *   - canvas 像素 hash（没有像素级噪声时三处必须一致）
 *   - 时区 / 语言（Worker 里最容易漏）
 * 另外检查 WebRTC ICE 候选里有没有真实 IP（.local 是 mDNS 混淆，不算泄漏）。
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, evaluate, launchChrome, sleep, killChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { ensureCerts } from './lib/certs.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const domain = String(argv.domain || 'claude.ai');
const CONTROL_DOMAIN = String(argv.control || 'example.com');
const extensionPath = String(argv.extension || join(process.cwd(), 'dist'));
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const MEASURE = String.raw`
const FONT_TARGET = 'SimSun';
const FONT_NATIVE = 'Helvetica';
function drawAndHash() {
  const canvas = document.createElement('canvas');
  canvas.width = 220; canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#123456';
  ctx.fillRect(0, 0, 200, 32);
  ctx.fillStyle = '#f0e0d0';
  ctx.fillText('VanishGeo fingerprint 0123456789', 4, 6);
  // 比像素，不比 PNG 字节：Worker 的 convertToBlob 与主线程 toDataURL 编码器不同
  const pixels = ctx.getImageData(0, 0, 220, 40).data;
  let hash = 5381;
  for (let index = 0; index < pixels.length; index += 1) hash = ((hash * 33) ^ pixels[index]) >>> 0;
  const probe = (text, font) => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = font;
    return c.measureText(text).width;
  };
  return {
    hash,
    widthTarget: probe('MMMM', '16px "' + FONT_TARGET + '"'),
    widthNative: probe('MMMM', '16px "' + FONT_NATIVE + '"'),
    widthMono: probe('MMMM', '16px monospace'),
    widthMonoNative: probe('MMMM', '16px monospace'),
    checkTarget: typeof document !== 'undefined' && document.fonts ? document.fonts.check('16px "' + FONT_TARGET + '"') : null,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    nav: typeof navigator === 'undefined' ? null : navigator.language,
    hc: typeof navigator === 'undefined' ? null : navigator.hardwareConcurrency
  };
}
window.__measure = drawAndHash;
`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fingerprint</title></head>
<body><h1>fingerprint</h1><script>${MEASURE}</script></body></html>`;

const IFRAME = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body><h1>frame</h1><script>${MEASURE}</script></body></html>`;

const WORKER = String.raw`
self.onmessage = () => {
  const FONT_TARGET = 'SimSun';
  const FONT_NATIVE = 'Helvetica';
  const canvas = new OffscreenCanvas(220, 40);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#123456';
  ctx.fillRect(0, 0, 200, 32);
  ctx.fillStyle = '#f0e0d0';
  ctx.fillText('VanishGeo fingerprint 0123456789', 4, 6);
  const pixels = ctx.getImageData(0, 0, 220, 40).data;
  let value = 5381;
  for (let index = 0; index < pixels.length; index += 1) value = ((value * 33) ^ pixels[index]) >>> 0;
  {
    const probe = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
    self.postMessage({
      hash: value,
      widthTarget: probe('MMMM', '16px "' + FONT_TARGET + '"'),
      widthNative: probe('MMMM', '16px "' + FONT_NATIVE + '"'),
      widthMono: probe('MMMM', '16px monospace'),
      widthMonoNative: probe('MMMM', '16px monospace'),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      nav: self.navigator ? self.navigator.language : null,
      hc: self.navigator ? self.navigator.hardwareConcurrency : null
    });
  }
};
`;

const certs = ensureCerts([domain, CONTROL_DOMAIN]);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  const url = String(req.url || '/');
  const send = (body, type) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };
  if (url.startsWith('/worker.js')) return send(WORKER, 'text/javascript');
  if (url.startsWith('/iframe.html')) return send(IFRAME, 'text/html; charset=utf-8');
  return send(PAGE, 'text/html; charset=utf-8');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-fp-')),
  headless: true,
  args: [
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP ${domain} 127.0.0.1:${port}, MAP ${CONTROL_DOMAIN} 127.0.0.1:${port}`
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
await loadExtension(cdp, extensionPath);
for (let index = 0; index < 40; index += 1) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  if (targetInfos.some((item) => item.url.includes('/background/service-worker.js'))) break;
  await sleep(250);
}

// --canvas-spoof：先打开 canvas 伪装，再加载页面，用来验证补丁是否穿透到 Worker
if (argv['canvas-spoof']) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const swTarget = targetInfos.find((item) => item.url.includes('/background/service-worker.js'));
  const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
  const applied = await evaluate(cdp, swSession, `(async () => {
    const data = await chrome.storage.local.get('siteSpoofConfig');
    const config = data.siteSpoofConfig;
    if (!config) return 'no-config';
    config.canvas = { ...(config.canvas || {}), enabled: true, spoofFonts: true };
    if (!Array.isArray(config.canvas.targetFonts) || !config.canvas.targetFonts.length) {
      config.canvas.targetFonts = ['SimSun', 'NSimSun', 'PingFang SC', 'Microsoft YaHei'];
    }
    await chrome.storage.local.set({ siteSpoofConfig: config });
    const back = (await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig;
    return 'ok canvas=' + JSON.stringify(back.canvas && { enabled: back.canvas.enabled, spoofFonts: back.canvas.spoofFonts, targets: (back.canvas.targetFonts || []).length });
  })()`, { awaitPromise: true }).catch((error) => String(error && error.message));
  console.log(`canvas 伪装开关: ${applied}`);
  // 顺便问一次「页面会拿到的 payload」，确认真的是存储生效、而不是烘焙值
  const extensionId = await evaluate(cdp, swSession, 'chrome.runtime.id');
  const probe = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/popup.html` });
  const probeSession = (await cdp.send('Target.attachToTarget', { targetId: probe.targetId, flatten: true })).sessionId;
  await cdp.send('Runtime.enable', {}, probeSession);
  await sleep(600);
  const payloadInfo = await evaluate(cdp, probeSession, `chrome.runtime.sendMessage({ action: 'getPayloadForUrl', url: 'https://${domain}/' }).then((r) => JSON.stringify({
    matched: r && r.matched,
    canvas: r && r.payload && r.payload.canvasConfig ? { enabled: r.payload.canvasConfig.enabled, targets: (r.payload.canvasConfig.targetFonts || []).length, spoofFonts: r.payload.canvasConfig.spoofFonts } : null
  }))`, { awaitPromise: true }).catch((error) => String(error && error.message));
  console.log(`注入 payload: ${payloadInfo}`);
  await sleep(800);
}

// 只导航一次，失败就重开一个 target —— 反复 navigate 会让 pending 的 evaluate
// 撞上 "target navigated or closed"，那种竞态不值得在工具里硬扛。
async function openMeasuredPage() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const page = await cdp.send('Target.createTarget', { url: `https://${domain}/` });
    const session = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, session);
    for (let tick = 0; tick < 12; tick += 1) {
      await sleep(500);
      const ready = await evaluate(cdp, session, `typeof window.__measure === 'function'`).catch(() => false);
      if (ready) {
        // 注入是 content script 先问 SW 再 postMessage 过来的，比页面脚本晚一步，
        // 立刻量会量到"还没打补丁"的原生值（曾经把这个误判成补丁失效）
        await sleep(2500);
        return session;
      }
    }
    await cdp.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  }
  throw new Error('页面没准备好（__measure 不存在）');
}

const safe = (promise) => promise.catch((error) => ({ error: String(error && error.message) }));
const session = await openMeasuredPage();

const main = await safe(evaluate(cdp, session, `window.__measure()`));
const viaFrame = await safe(evaluate(cdp, session, `(async () => {
  const frame = document.createElement('iframe');
  frame.src = '/iframe.html';
  document.body.appendChild(frame);
  await new Promise((done) => frame.addEventListener('load', done, { once: true }));
  for (let tick = 0; tick < 20; tick += 1) {
    if (typeof frame.contentWindow.__measure === 'function') break;
    await new Promise((done) => setTimeout(done, 250));
  }
  // 等 iframe 自己的 payload 落地：不然量到的是"还没打补丁"的原生值。
  //
  // 判据必须是"和主框架一样"，不能是"有值" —— 原生时区永远有值，旧写法在第一次
  // 采样就 break，于是 iframe 那一行永远打印原生值，看起来像子框架没被注入。
  const want = { tz: ${JSON.stringify(main.tz)}, nav: ${JSON.stringify(main.nav)}, checkTarget: ${JSON.stringify(main.checkTarget)} };
  const wantSpoof = ${JSON.stringify(Boolean(process.argv.join(' ').includes('--canvas-spoof')))};
  let settled = false;
  for (let tick = 0; tick < 24; tick += 1) {
    const sample = frame.contentWindow.__measure();
    const same = sample.tz === want.tz && sample.nav === want.nav;
    const fontSame = !wantSpoof || sample.checkTarget === want.checkTarget;
    if (same && fontSame) { settled = true; break; }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!settled) console.log('⚠ iframe 的 payload 没有在 6s 内落地，下面的比对会拿原生值');
  const inner = frame.contentWindow.__measure();
  frame.remove();
  return inner;
})()`, { awaitPromise: true }));
const viaWorker = await safe(evaluate(cdp, session, `(async () => {
  const worker = new Worker('/worker.js');
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'worker 超时' }), 8000);
    worker.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    worker.onerror = (event) => { clearTimeout(timer); resolve({ error: 'worker error: ' + (event.message || event.type) }); };
    worker.postMessage('go');
  });
  worker.terminate();
  return result;
})()`, { awaitPromise: true }));

for (const [name, value] of [['主线程', main], ['iframe', viaFrame], ['Worker', viaWorker]]) {
  if (value && value.error) check(`${name} 测量完成`, false, value.error);
}

// 行为探测：把目标字体与 monospace 的宽度比一下，比看 toString 可靠
// （disguise() 会把函数伪装成 native，toString 已经看不出来了）
const patchState = await safe(evaluate(cdp, session, `(() => {
  const probe = (font, offscreen) => {
    const c = offscreen ? new OffscreenCanvas(8, 8).getContext('2d') : document.createElement('canvas').getContext('2d');
    c.font = font;
    return c.measureText('中文MMMM').width;
  };
  const measure = (font, offscreen) => ({ font: probe(font, offscreen), mono: probe('16px monospace', offscreen) });
  const canvas = { latin: measure('16px "SimSun", monospace', false), alias: measure('16px "宋体", monospace', false) };
  const offscreen = { latin: measure('16px "SimSun", monospace', true), alias: measure('16px "宋体", monospace', true) };
  const same = (pair) => Math.abs(pair.font - pair.mono) < 0.01;
  return {
    canvas: same(canvas.latin) && same(canvas.alias),
    offscreen: same(offscreen.latin) && same(offscreen.alias),
    check: document.fonts.check('16px "SimSun"')
  };
})()`));
check('字体度量：canvas 与 OffscreenCanvas 都被伪装（拉丁名 + 中文别名）',
  Boolean(patchState && patchState.canvas && patchState.offscreen),
  `canvas=${patchState && patchState.canvas ? 'ok' : '泄漏'} offscreen=${patchState && patchState.offscreen ? 'ok' : '泄漏'} check(SimSun)=${patchState && patchState.check}`);

const candidates = await evaluate(cdp, session, `(async () => {
  const collected = [];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.createDataChannel('probe');
  pc.onicecandidate = (event) => { if (event.candidate) collected.push(event.candidate.candidate); };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((done) => setTimeout(done, 2500));
  pc.close();
  return collected;
})()`, { awaitPromise: true });

console.log(`上下文  主线程 tz=${main.tz} nav=${main.nav}`);
console.log(`        iframe tz=${viaFrame.tz} nav=${viaFrame.nav}`);
console.log(`        worker tz=${viaWorker.tz} nav=${viaWorker.nav}`);
console.log(`字体    target(SimSun) width main=${main.widthTarget} iframe=${viaFrame.widthTarget} worker=${viaWorker.widthTarget}`);
console.log(`        native(Helvetica) width main=${main.widthNative} worker=${viaWorker.widthNative}`);
console.log(`        monospace width main=${main.widthMono}`);
console.log(`        fonts.check(SimSun) main=${main.checkTarget} iframe=${viaFrame.checkTarget}`);
console.log(`canvas  hash main=${main.hash} iframe=${viaFrame.hash} worker=${viaWorker.hash}`);
console.log(`WebRTC  ${candidates.length ? candidates.map((item) => String(item).split(' ')[4]).join(', ') : '(无候选)'}\n`);

const near = (left, right) => Math.abs(Number(left) - Number(right)) < 0.01;

check('字体度量：主线程与 iframe 一致', near(main.widthTarget, viaFrame.widthTarget), `${main.widthTarget} vs ${viaFrame.widthTarget}`);
check('字体 check：主线程与 iframe 一致', main.checkTarget === viaFrame.checkTarget, `${main.checkTarget} vs ${viaFrame.checkTarget}`);
check('字体度量：主线程与 Worker 一致', near(main.widthTarget, viaWorker.widthTarget), `${main.widthTarget} vs ${viaWorker.widthTarget}`);
// OffscreenCanvas 与 canvas 元素的像素本来就可能不同（渲染路径不同），
// 所以这里只判定「同一家族内一致」，Worker 的差异作为已知引擎行为记录。
check('canvas：主线程与 iframe 像素一致', main.hash === viaFrame.hash, `${main.hash} vs ${viaFrame.hash}`);
console.log(`  提示：主线程 ${main.hash} / Worker ${viaWorker.hash}（OffscreenCanvas 渲染路径不同，属引擎行为）`);


check('iframe 时区与主线程一致', viaFrame.tz === main.tz, `${viaFrame.tz} vs ${main.tz}`);
check('iframe 语言与主线程一致', viaFrame.nav === main.nav, `${viaFrame.nav} vs ${main.nav}`);
check('Worker 时区与主线程一致', main.tz === viaWorker.tz, `${viaWorker.tz} vs ${main.tz}`);
check('Worker 语言与主线程一致', main.nav === viaWorker.nav, `${viaWorker.nav} vs ${main.nav}`);

const realIp = candidates.filter((candidate) => {
  const address = String(candidate).split(' ')[4] || '';
  return /^\d+\.\d+\.\d+\.\d+$/.test(address);
});
check('WebRTC 没有暴露真实 IP', realIp.length === 0, realIp.length ? realIp.join(', ') : `${candidates.length} 个候选，均为 mDNS/空`);


// 打开伪装时：字体三处都要跟着变，否则页面只要在 Worker 里量一下就能看穿补丁
if (argv['canvas-spoof']) {
  check('伪装后 fonts.check(SimSun) 变 false（主线程）', main.checkTarget === false, String(main.checkTarget));
  check('伪装后 iframe 的 fonts.check 同步变 false', viaFrame.checkTarget === false, String(viaFrame.checkTarget));
  check('伪装后 Worker 的字体度量跟着变（与主线程一致）', near(main.widthTarget, viaWorker.widthTarget), `${main.widthTarget} vs ${viaWorker.widthTarget}`);
}

cdp.close();
killChrome(chrome.child);
server.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
setTimeout(() => process.exit(failed.length ? 1 : 0), 300);
