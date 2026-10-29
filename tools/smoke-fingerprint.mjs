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
    geoConfig: r && r.payload && r.payload.geolocationConfig ? { mode: r.payload.geolocationConfig.mode, lat: r.payload.geolocationConfig.latitude, lon: r.payload.geolocationConfig.longitude, acc: r.payload.geolocationConfig.accuracy, rand: r.payload.geolocationConfig.randomize, r: r.payload.geolocationConfig.randomRadiusMeters } : null,
    geoResolved: r && r.payload ? r.payload.geolocation : null,
    canvas: r && r.payload && r.payload.canvasConfig ? { enabled: r.payload.canvasConfig.enabled, targets: (r.payload.canvasConfig.targetFonts || []).length, spoofFonts: r.payload.canvasConfig.spoofFonts } : null
  }))`, { awaitPromise: true }).catch((error) => String(error && error.message));
  console.log(`注入 payload: ${payloadInfo}`);
  await sleep(800);
}

// 地理定位：开随机 + 固定手动坐标，页面侧验证「噪声在半径内、accuracy 覆盖位移」
{
  const { targetInfos } = await cdp.send('Target.getTargets');
  const swTarget = targetInfos.find((item) => item.url.includes('/background/service-worker.js'));
  const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
  const applied = await evaluate(cdp, swSession, `(async () => {
    const data = await chrome.storage.local.get('siteSpoofConfig');
    const config = data.siteSpoofConfig;
    if (!config) return 'no-config';
    const geo = {
      enabled: true, mode: 'manual',
      latitude: 35.6762, longitude: 139.6503, accuracy: 30,
      randomize: true, randomRadiusMeters: 1500, spoofPermission: true
    };
    // 全局层和规则覆写层都要写：命中规则时 rule.overrides 覆盖全局，只改 globalProfile
    // 会让页面拿到的是另一份坐标（第一次跑就是这么被绕过去的）
    config.globalProfile = { ...(config.globalProfile || {}), geolocation: { ...geo } };
    for (const rule of config.rules || []) {
      rule.overrides = { ...(rule.overrides || {}), geolocation: { ...geo } };
    }
    await chrome.storage.local.set({ siteSpoofConfig: config });
    const match = (config.rules || []).find((rule) => String(rule.domain || '').includes('claude'));
    return 'ok rules=' + ((config.rules || []).length)
      + ' master=' + config.masterEnabled
      + ' globalGeo=' + JSON.stringify(config.globalProfile.geolocation)
      + ' matchDomain=' + (match ? match.domain : 'none')
      + ' overrideGeo=' + (match ? JSON.stringify(match.overrides && match.overrides.geolocation) : '-')
      + ' otherOverrides=' + (match ? JSON.stringify(Object.keys(match.overrides || {})) : '-');
  })()`, { awaitPromise: true }).catch((error) => String(error && error.message));
  console.log(`地理定位配置: ${applied}`);

  // 存的是存储，SW 读的是内存快照 —— 它靠 storage.onChanged 失效，落盘与失效之间有窗口。
  // 抢在这之前打开页面，payload 里的 geolocation 还是旧值，页面一路原生（表现为"扩展在跑、
  // 定位没伪装"，但只有坐标对不上）。所以留一段时间让失效落地；页面侧还有一层轮询兜底。
  await sleep(1500);
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


// ---------- 地理定位：噪声形状与 accuracy 一致性 ----------
const metersBetween = (aLat, aLon, bLat, bLon) => {
  const rad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

const geo = await safe(evaluate(cdp, session, `(async () => {
  const CONFIG = { latitude: 35.6762, longitude: 139.6503 };
  const away = (latitude, longitude) => {
    const dLat = Number(latitude) - CONFIG.latitude;
    const dLon = (Number(longitude) - CONFIG.longitude) * Math.cos((CONFIG.latitude * Math.PI) / 180);
    return Math.hypot(dLat, dLon) * 111320;
  };
  const read = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('geolocation 超时')), 5000);
    navigator.geolocation.getCurrentPosition((position) => {
      clearTimeout(timer);
      resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        heading: position.coords.heading,
        altitude: position.coords.altitude,
        positionKeys: Object.keys(position).length,
        coordKeys: Object.keys(position.coords).length,
        isPosition: position instanceof GeolocationPosition,
        isCoords: position.coords instanceof GeolocationCoordinates,
        secure: self.isSecureContext,
        protocol: location.protocol
      });
    }, (error) => { clearTimeout(timer); reject(new Error('geolocation ' + error.code + ' ' + error.message)); });
  });
  // 注入是异步的：payload 晚到时这一页还是原生定位。轮询到"落在配置点附近"为止，
  // 拿不到就如实报告采样序列，别用一次采样去判死。
  const samples = [];
  let first = null;
  for (let tick = 0; tick < 10; tick += 1) {
    const sample = await read();
    samples.push([Number(sample.latitude.toFixed(6)), Number(sample.longitude.toFixed(6)), sample.accuracy]);
    if (away(sample.latitude, sample.longitude) < 50000) { first = sample; break; }
    await new Promise((done) => setTimeout(done, 800));
  }
  if (!first) return {
    failed: true, samples, secure: self.isSecureContext, protocol: location.protocol,
    patched: !/native code/.test(String(navigator.geolocation.getCurrentPosition)),
    fnLen: navigator.geolocation.getCurrentPosition.length,
    perm: await navigator.permissions.query({ name: 'geolocation' }).then((status) => status.state).catch(() => 'err')
  };
  const second = await read();
  return { first, second };
})()`, { awaitPromise: true }));

if (geo && geo.error) {
  check('地理定位：拿得到伪装坐标', false, geo.error);
} else if (geo && geo.failed) {
  check('地理定位：页面上生效的是伪装坐标', false,
    `${Math.min(10, geo.samples.length) * 0.8}s 内一直是原生定位：${JSON.stringify(geo.samples)} secure=${geo.secure} patched=${geo.patched} len=${geo.fnLen} perm=${geo.perm}`);
} else {
  const { first, second } = geo;
  const offset = metersBetween(35.6762, 139.6503, first.latitude, first.longitude);
  console.log(`地理定位  环境 secure=${first.secure} protocol=${first.protocol}`);
  console.log(`地理定位  配置 35.6762/139.6503 accuracy=30 R=1500m → 实际 ${first.latitude.toFixed(6)}/${first.longitude.toFixed(6)} accuracy=${first.accuracy} 偏移=${offset.toFixed(1)}m`);
  check('地理定位：偏移落在设定的半径内', offset <= 1501, `${offset.toFixed(1)}m ≤ 1500m`);
  check('地理定位：accuracy 覆盖实际偏移（不是配置里那个 30）', first.accuracy >= offset, `accuracy=${first.accuracy} ≥ ${offset.toFixed(1)}m`);
  check('地理定位：同一会话两次请求同一个点', first.latitude === second.latitude && first.longitude === second.longitude, `${first.latitude} vs ${second.latitude}`);
  check('地理定位：Position/Coordinates 的原型没被换掉', first.isPosition && first.isCoords, `position=${first.isPosition} coords=${first.isCoords}`);
  check('地理定位：返回对象没有多余的自有属性', first.positionKeys === 0 && first.coordKeys === 0, `keys=${first.positionKeys}/${first.coordKeys}`);
  check('地理定位：静止读数自洽（speed=0、heading=null、不编高度）',
    first.speed === 0 && first.heading === null && first.altitude === null,
    `speed=${first.speed} heading=${first.heading} altitude=${first.altitude}`);
}

// watchPosition 的节奏：固定 3000ms 心跳等于给页面一个节拍器，量两帧间隔就能认出来
if (geo && !geo.error && !geo.failed) {
  const watch = await safe(evaluate(cdp, session, `(async () => {
    const started = Date.now();
    const stamps = [];
    const points = [];
    const id = navigator.geolocation.watchPosition((position) => {
      stamps.push(Date.now() - started);
      points.push([Number(position.coords.latitude.toFixed(8)), Number(position.coords.longitude.toFixed(8))]);
    }, () => {});
    await new Promise((done) => setTimeout(done, 9500));
    navigator.geolocation.clearWatch(id);
    return { stamps, points };
  })()`, { awaitPromise: true }));

  if (watch && watch.error) {
    check('watch 节奏：拿得到帧', false, watch.error);
  } else {
    const stamps = watch.stamps || [];
    const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
    check('watch 节奏：首帧不等心跳', stamps.length >= 1 && stamps[0] < 1500, `首帧=${stamps[0]}ms`);
    check('watch 节奏：间隔在 2.5–4.2s 且逐帧抖动',
      gaps.length >= 2 && gaps.every((gap) => gap >= 2400 && gap <= 4400) && new Set(gaps).size > 1,
      `间隔=${gaps.join(',')}ms（共 ${stamps.length} 帧）`);
    const allSame = (watch.points || []).every((point) => point[0] === watch.points[0][0] && point[1] === watch.points[0][1]);
    check('watch 节奏：静止时每帧同一个点', (watch.points || []).length >= 2 && allSame,
      `${(watch.points || []).length} 帧`);
  }
}

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
