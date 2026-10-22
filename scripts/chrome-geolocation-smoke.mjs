#!/usr/bin/env node
// 实际 dist 的隔离真实 Chrome 验收；只使用临时 profile、loopback 与合成数据。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkerReader } from '../experiments/userscripts-document-start/worker-reader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let output, headed = false, dist = join(root, 'dist');
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
  else if (args[i] === '--dist' && args[i + 1]) dist = resolve(args[++i]);
  else if (args[i] === '--headed') headed = true;
  else throw new Error('参数：[--dist <实际构建目录>] [--headed] [--output <脱敏JSON>]');
}
const required = ['actual-dist', 'fresh-disabled', 'normal-user-switch', 'register-ready',
  'first-inline', 'get-watch-clear', 'watch-reentrant-options', 'cancel-before-first', 'success-exception', 'receiver-options',
  'timeout-cache-accuracy', 'permissions', 'permission-events', 'policy-denied', 'same-origin-iframe', 'cross-origin-negative',
  'cross-origin-allowed', 'special-documents', 'language-timezone-font', 'https-origin-fixture', 'snapshot-A-to-B', 'reload-B',
  'permission-false-denied', 'permission-false-prompt', 'permission-false-granted',
  'bfcache', 'worker-stop-wake', 'extension-update', 'disable-native', 'delete-native'];
const evidence = { schemaVersion: 1, task: 'VG-029', scope: 'actual-dist-geolocation-loopback',
  conclusion: 'BLOCKED', exitCode: 2, environment: { realChrome: false, platform: process.platform,
    architecture: process.arch, browserMode: headed ? 'headed' : 'headless', userProfileAccessed: false },
  checks: Object.fromEntries(required.map(id => [id, 'UNKNOWN'])), observations: {}, failures: [],
  cleanup: { status: 'UNKNOWN', failures: [] }, limitations: [
    '仅当前完整版本 Chrome；不代表 Chrome 138、其他 OS、TLS 传输或普通用户 profile 的人工验收',
    '通过正常扩展详情 UI 开启 Allow User Scripts；CDP 权限与合成哨兵位置只控制临时测试 profile',
    'fixtureInvokedNativePosition 仅说明 fixture 未主动调用原生定位，不是原生调用计数；本 JSON 未测量原生定位调用次数，哨兵仅验证未返回该合成原生值',
    '只访问 loopback 测试站点，不调用真实定位、出口 provider 或扩展检测服务；Chrome 自身后台网络未全量监控',
    '扩展更新仅修改临时 dist 副本版本并重新加载；原始构建与权限未改写',
    '特殊文档仅读权限与语言等可观察状态，不调用其原生定位方法；未覆盖 Worker 中不存在的 Geolocation API'
  ] };
const delay = ms => new Promise(done => setTimeout(done, ms));
const digest = value => createHash('sha256').update(value).digest('hex');
async function fingerprint(directory) {
  const entries = [];
  async function visit(relative = '') {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await visit(path);
      else { assert.ok(entry.isFile(), '构建目录必须只含普通文件'); entries.push([path, digest(await readFile(join(directory, path)))]); }
    }
  }
  await visit(); entries.sort(([a], [b]) => a.localeCompare(b));
  return { fileCount: entries.length, sha256: digest(JSON.stringify(entries)) };
}
async function until(read, accept = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(60);
  }
  throw new Error('OBSERVATION_TIMEOUT');
}
function safeFailure(error) {
  if (error.code === 'ERR_ASSERTION') return { type: 'assertion', detail: error.message.split('\n')[0].slice(0, 180) };
  return { type: error.cdpCode ? 'protocol' : 'automation', detail: /^[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_OPERATION_FAILED',
    ...(error.protocolMethod ? { method: error.protocolMethod, code: error.cdpCode } : {}) };
}
async function check(id, run) {
  try { const value = await run(); evidence.checks[id] = 'PASS'; if (value !== undefined) evidence.observations[id] = value; return value; }
  catch (error) { evidence.checks[id] = error.code === 'ERR_ASSERTION' ? 'FAIL' : 'BLOCKED';
    evidence.failures.push({ check: id, ...safeFailure(error) }); return null; }
}
function positionSample(position) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy,
    timestamp: position.timestamp, frozen: Object.isFrozen(position) && Object.isFrozen(position.coords),
    nullExtras: ['altitude', 'altitudeAccuracy', 'heading', 'speed'].every(key => position.coords[key] === null),
    json: typeof position.toJSON === 'function' && typeof position.coords.toJSON === 'function' };
}
// 此函数只写 fixture 的观测对象；不向扩展传配置，也不在原生负对照上调用定位。
function bootstrap(id, role, active, serial) {
  const geo = navigator.geolocation;
  const refs = geo && { get: geo.getCurrentPosition, watch: geo.watchPosition, clear: geo.clearWatch };
  const read = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '32px "Courier New"'; const target = ctx.measureText('WWiiii字A').width;
    ctx.font = '32px sans-serif'; const fallback = ctx.measureText('WWiiii字A').width;
    return { language: navigator.language, languages: Array.from(navigator.languages),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      fontFiltered: document.fonts.check('32px MiSans') === false, measurementFiltered: target === fallback,
      secureContext: isSecureContext, hasGeolocation: !!geo, nativeShape: !!geo && Object.getPrototypeOf(geo) === Geolocation.prototype
        && ['getCurrentPosition', 'watchPosition', 'clearWatch'].every(name => typeof geo[name] === 'function') };
  };
  globalThis.vgProbe = { id, role, serial, first: { readyState: document.readyState, scriptIndex: document.scripts.length,
    inline: Boolean(document.currentScript && !document.currentScript.src), value: read() }, firstResult: null,
    firstAsync: null, permission: null, otherPermission: null, loaded: false, pageshows: [], pagehides: [], children: {} };
  globalThis.vgRefs = refs; globalThis.vgGeo = geo; globalThis.vgRead = read;
  const publish = () => { if (window !== top) parent.postMessage({ type: 'VG029_FIXTURE', id, role, sample: vgProbe }, '*'); };
  addEventListener('message', event => {
    if (event.data?.type !== 'VG029_FIXTURE') return;
    const frame = Array.from(document.querySelectorAll('iframe')).find(item => item.contentWindow === event.source);
    if (frame) vgProbe.children[frame.dataset.role] = event.data.sample;
  });
  addEventListener('load', () => { vgProbe.loaded = true; publish(); }, { once: true });
  addEventListener('pageshow', event => { vgProbe.pageshows.push(event.persisted); publish(); });
  addEventListener('pagehide', event => { vgProbe.pagehides.push(event.persisted); });
  navigator.permissions.query({ name: 'geolocation' }).then(status => {
    vgProbe.permission = status.state; publish();
  }, error => { vgProbe.permission = 'ERROR:' + error.name; publish(); });
  navigator.permissions.query({ name: 'notifications' }).then(status => { vgProbe.otherPermission = status.state; publish(); });
  if (active && refs) {
    let sync = true;
    const returned = refs.get.call(geo, value => {
      vgProbe.firstResult = { kind: 'success', value: {
        latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy,
        timestamp: value.timestamp, frozen: Object.isFrozen(value) && Object.isFrozen(value.coords),
        nullExtras: ['altitude', 'altitudeAccuracy', 'heading', 'speed'].every(key => value.coords[key] === null),
        json: typeof value.toJSON === 'function' && typeof value.coords.toJSON === 'function' } };
      vgProbe.firstAsync = !sync; publish();
    }, error => { vgProbe.firstResult = { kind: 'error', code: error.code }; vgProbe.firstAsync = !sync; publish(); }, { timeout: 2000 });
    sync = false;
    vgProbe.firstReturnUndefined = returned === undefined;
  }
}

let browser, cdp, server, temporary, workerReader;
let extensionId, options, sourceCodes = new Set(), scriptEvents = new Map();
const httpsFixtures = new Map();
let phase = 'prepare';
try {
  assert.equal(typeof WebSocket, 'function', '需要 Node 22+ 原生 WebSocket');
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  assert.ok(chrome && existsSync(chrome), '找不到指定 Chrome');
  temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-geolocation-smoke-'));
  const staged = join(temporary, 'extension'); const profile = join(temporary, 'profile');
  const initialManifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  await cp(dist, staged, { recursive: true });
  await check('actual-dist', async () => {
    const original = await fingerprint(dist); assert.deepEqual(await fingerprint(staged), original);
    assert.equal(initialManifest.manifest_version, 3); assert.equal(initialManifest.minimum_chrome_version, '138');
    assert.ok(initialManifest.permissions.includes('userScripts'));
    assert.ok(!initialManifest.permissions.some(value => value.startsWith('declarativeNetRequest')));
    return { fingerprint: original, manifestVersion: initialManifest.version, originalBytesCopied: true,
      addedDriverPage: false, productionFilesModified: false };
  });
  let serial = 0;
  const specialHtml = (id, role) => '<!doctype html><script>(' + bootstrap.toString() + ')('
    + [id, role, false, ++serial].map(JSON.stringify).join(',') + ');</script><body>synthetic</body>';
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/away') { response.end('<!doctype html><title>synthetic navigation</title>'); return; }
    if (!url.pathname.startsWith('/probe/')) { response.writeHead(404).end(); return; }
    if (url.searchParams.has('policy')) response.setHeader('Permissions-Policy', 'geolocation=()');
    const id = url.pathname.slice('/probe/'.length), role = url.searchParams.get('role') || 'top';
    const active = url.searchParams.get('active') === '1';
    let body = '<!doctype html><html><head><script>(' + bootstrap.toString() + ')('
      + [id, role, active, ++serial].map(JSON.stringify).join(',') + ');</script><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>';
    if (url.searchParams.has('frames')) {
      const port = server.address().port;
      body += '<iframe data-role="same" allow="geolocation" src="/probe/' + id + '-same?role=same&active=1"></iframe>';
      body += '<iframe data-role="cross" allow="geolocation" src="http://127.0.0.1:' + port + '/probe/' + id
        + '-cross?role=cross&active=' + (url.searchParams.get('crossActive') === '1' ? '1' : '0') + '"></iframe>';
    }
    if (url.searchParams.has('special')) {
      body += '<iframe data-role="srcdoc" srcdoc="' + specialHtml(id, 'srcdoc').replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe>';
      body += '<iframe data-role="opaque" sandbox="allow-scripts" srcdoc="' + specialHtml(id, 'opaque').replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe>';
      body += '<iframe data-role="data" src="data:text/html,' + encodeURIComponent(specialHtml(id, 'data')).replaceAll('"', '%22') + '"></iframe>';
      body += '<iframe data-role="blank"></iframe><iframe data-role="blob"></iframe><script>'
        + 'document.querySelector("[data-role=blank]").contentDocument.write(' + JSON.stringify(specialHtml(id, 'blank')).replaceAll('<', '\\u003c') + ');'
        + 'document.querySelector("[data-role=blank]").contentDocument.close();'
        + 'document.querySelector("[data-role=blob]").src=URL.createObjectURL(new Blob([' + JSON.stringify(specialHtml(id, 'blob')).replaceAll('<', '\\u003c') + '],{type:"text/html"}));</script>';
    }
    response.end(body + '</body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port, origin = 'http://localhost:' + port, crossOrigin = 'http://127.0.0.1:' + port;
  const launch = [...(headed ? [] : ['--headless=new']), '--site-per-process', '--enable-unsafe-extension-debugging',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', 'about:blank'];
  phase = 'chrome-startup';
  browser = spawn(chrome, launch, { stdio: 'ignore' });
  let launchFailed = false;
  browser.once('error', () => { launchFailed = true; });
  const debugPort = await until(async () => {
    if (launchFailed) throw new Error('CHROME_START_FAILED');
    if (browser.exitCode !== null || browser.signalCode) throw new Error('CHROME_EXITED_BEFORE_CDP');
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  });
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json();
  evidence.environment.realChrome = true; evidence.environment.chromeVersion = version.Browser;
  evidence.environment.protocolVersion = version['Protocol-Version'];
  if (process.env.CHROME_EXPECTED_VERSION) assert.equal(version.Browser, 'Chrome/' + process.env.CHROME_EXPECTED_VERSION);
  const protocol = await (await fetch('http://127.0.0.1:' + debugPort + '/json/protocol')).json();
  for (const [domain, command] of [['Extensions', 'loadUnpacked'], ['Browser', 'setPermission'], ['Emulation', 'setGeolocationOverride'], ['ServiceWorker', 'startWorker']]) {
    assert.ok(protocol.domains.find(item => item.domain === domain)?.commands.some(item => item.name === command), domain + '.' + command);
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl); await once(ws, 'open');
  let sequence = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') {
      const fixture = httpsFixtures.get(message.sessionId);
      if (fixture) {
        const expected = message.params.request.url === fixture.url && message.params.resourceType === 'Document';
        if (expected) fixture.fulfilled++;
        else fixture.blocked++;
        const method = expected ? 'Fetch.fulfillRequest' : 'Fetch.failRequest';
        const params = expected ? { requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(fixture.html).toString('base64') }
          : { requestId: message.params.requestId, errorReason: 'BlockedByClient' };
        void cdp.send(method, params, message.sessionId).catch(() => { fixture.protocolFailure = true; });
      }
    }
    if (message.method === 'Debugger.scriptParsed') {
      const rows = scriptEvents.get(message.sessionId) || []; rows.push(message.params); scriptEvents.set(message.sessionId, rows);
    }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error('CDP_OPERATION_FAILED'), {
      cdpCode: message.error.code, protocolMethod: request.method,
      // worker-reader 的瞬时错误识别需要原始协议文本；该值不进入 JSON。
      message: message.error.message }));
    else request.resolve(message.result);
  });
  cdp = { close: () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP_CLOSED')); } pending.clear(); ws.close(); },
    send(method, params = {}, sessionId) { return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT')); }, 15000);
      pending.set(id, { resolve, reject, timer, method }); ws.send(JSON.stringify({ id, method, params, sessionId }));
    }); } };
  async function evaluate(target, expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, target.sessionId);
    if (result.exceptionDetails) throw Object.assign(new Error('FIXTURE_EXPRESSION_FAILED'), { exceptionType: result.exceptionDetails.exception?.className });
    return result.result.value;
  }
  async function page(url, debug = false, fixtureHtml) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const target = { targetId, ...await cdp.send('Target.attachToTarget', { targetId, flatten: true }) };
    await cdp.send('Target.activateTarget', { targetId });
    await cdp.send('Page.enable', {}, target.sessionId);
    if (debug) { await cdp.send('Runtime.enable', {}, target.sessionId); await cdp.send('Debugger.enable', {}, target.sessionId); }
    if (fixtureHtml !== undefined) {
      httpsFixtures.set(target.sessionId, { url, html: fixtureHtml, fulfilled: 0, blocked: 0, protocolFailure: false });
      // 在请求进入网络前供给固定页面；其他请求显式阻止，不放宽证书或 sandbox。
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, target.sessionId);
    }
    // 与配置 A/B 不同的合成哨兵，任何误用原生位置也不能伪装成成功。
    await cdp.send('Emulation.setGeolocationOverride', { latitude: 80, longitude: 170, accuracy: 900 }, target.sessionId);
    await cdp.send('Page.navigate', { url }, target.sessionId);
    await until(() => evaluate(target, 'document.readyState==="complete" && location.href===' + JSON.stringify(new URL(url).href)));
    return target;
  }
  const close = target => cdp.send('Target.closeTarget', { targetId: target.targetId });
  async function setPermission(setting, targetOrigin = origin) {
    await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting, origin: targetOrigin });
    await cdp.send('Browser.setPermission', { permission: { name: 'notifications' }, setting: 'denied', origin: targetOrigin });
  }
  await setPermission('denied'); await setPermission('denied', crossOrigin);
  evidence.environment.fixturePermissionControl = { initialGeolocation: 'denied', notifications: 'denied',
    nativePositionSentinel: { latitude: 80, longitude: 170, accuracy: 900 }, userProfileChanged: false };
  phase = 'extension-load';
  extensionId = (await cdp.send('Extensions.loadUnpacked', { path: staged })).id;
  const extensionOrigin = 'chrome-extension://' + extensionId + '/';
  const optionsUrl = extensionOrigin + 'options/options.html';
  options = await page(optionsUrl);
  await until(() => evaluate(options, 'Boolean(globalThis.chrome?.runtime && document.getElementById("runtimeSyncStatus"))'));
  let recovery = false;
  const message = request => { assert.equal(recovery, false, '恢复观察期间禁止管理消息');
    return evaluate(options, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')'); };
  async function registrations(target = options) {
    return evaluate(target, 'chrome.userScripts.getScripts()');
  }
  async function rememberSources() {
    for (const item of await registrations()) if (item.id.startsWith('vanishgeo-geolocation-')) for (const js of item.js) if (js.code) sourceCodes.add(js.code);
  }
  async function sourceCount(target) {
    let count = 0;
    for (const script of scriptEvents.get(target.sessionId) || []) {
      const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId }, target.sessionId);
      if ([...sourceCodes].some(code => scriptSource.includes(code.trim()))) count++;
    }
    return count;
  }
  async function document({ active = true, frames = false, crossActive = false, special = false, policy = false, base = origin, debug = true } = {}) {
    const id = randomUUID();
    const path = '/probe/' + id + '?active=' + (active ? '1' : '0') + (frames ? '&frames=1' : '')
      + (crossActive ? '&crossActive=1' : '') + (special ? '&special=1' : '') + (policy ? '&policy=1' : '');
    const target = await page(base + path, debug);
    const row = await until(() => evaluate(target, 'globalThis.vgProbe && JSON.parse(JSON.stringify(vgProbe))'),
      row => row?.loaded && row.permission && row.otherPermission && (!active || row.firstResult));
    return { target, row, url: base + path };
  }
  async function row(doc) { return evaluate(doc.target, 'JSON.parse(JSON.stringify(vgProbe))'); }
  function assertSuccess(sample, latitude, longitude) {
    assert.equal(sample.first.readyState, 'loading', '首脚本必须处于loading');
    assert.equal(sample.first.scriptIndex, 1, '必须是第一个inline'); assert.equal(sample.first.inline, true);
    assert.equal(sample.firstAsync, true, '定位回调必须异步'); assert.equal(sample.firstResult.kind, 'success', '必须交付合成位置');
    assert.equal(sample.firstReturnUndefined, true, 'getCurrentPosition返回undefined');
    assert.equal(sample.firstResult.value.latitude, latitude, '合成纬度'); assert.equal(sample.firstResult.value.longitude, longitude, '合成经度');
    assert.equal(sample.firstResult.value.accuracy, 50, '合成精度');
    assert.equal(sample.firstResult.value.frozen, true); assert.equal(sample.firstResult.value.nullExtras, true); assert.equal(sample.firstResult.value.json, true);
  }
  const fresh = await message({ action: 'getSiteConfig' });
  const nativeDoc = await document({ active: false });
  const native = nativeDoc.row.first.value;
  await check('fresh-disabled', async () => {
    assert.equal(fresh.config.masterEnabled, false); assert.deepEqual(fresh.config.rules, []);
    assert.equal(nativeDoc.row.permission, 'denied'); assert.equal(nativeDoc.row.firstResult, null);
    return { masterEnabled: false, ruleCount: 0, nativePermission: 'denied', fixtureInvokedNativePosition: false,
      geolocationRuntime: fresh.syncReport.geolocationRuntime.state };
  });
  await close(nativeDoc.target);
  const uiReady = await check('normal-user-switch', async () => {
    const details = await page('chrome://extensions/?id=' + extensionId);
    const toggle = '(() => {const find=root=>{for(const n of root.querySelectorAll("*")){if(n.id==="allow-user-scripts")return n;if(n.shadowRoot){const v=find(n.shadowRoot);if(v)return v}}};const t=find(document)?.shadowRoot?.querySelector("cr-toggle");if(!t)return null;t.scrollIntoView({block:"center"});const r=t.getBoundingClientRect();return {checked:t.checked,disabled:t.disabled,x:r.x+r.width/2,y:r.y+r.height/2}})()';
    const before = await until(() => evaluate(details, toggle)); assert.equal(before.checked, false); assert.equal(before.disabled, false);
    await cdp.send('Target.activateTarget', { targetId: details.targetId });
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: before.x, y: before.y, button: 'left', clickCount: 1 }, details.sessionId);
    await until(() => evaluate(details, toggle), value => value?.checked === true);
    assert.deepEqual(await registrations(), []); await close(details);
    return { before: false, after: true, mechanism: 'normal-details-UI-trusted-pointer', preferencesFileWritten: false };
  });
  if (!uiReady) throw new Error('ALLOW_USER_SCRIPTS_UI_BLOCKED');
  const config = structuredClone(fresh.config);
  config.masterEnabled = true; config.intlMode = 'compatible';
  config.globalProfile.language = { enabled: true, mode: 'custom', language: 'fr-FR', languages: ['fr-FR', 'fr'] };
  config.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'UTC' };
  config.globalProfile.geolocation = { ...config.globalProfile.geolocation, enabled: true, mode: 'manual',
    latitude: 0, longitude: 0, accuracy: 50, randomize: false, spoofPermission: true, history: [], country: '' };
  config.fontExposure = { ...config.fontExposure, enabled: true, mode: 'vendor-software' };
  const rule = domain => ({ id: 'synthetic-' + domain.replaceAll('.', '-'), domain, enabled: true, exitLocationProfileId: null,
    overrides: { language: { mode: 'inherit', value: null }, timezone: { mode: 'inherit', value: null }, geolocation: { mode: 'inherit', value: null } } });
  config.rules = [rule('localhost')];
  phase = 'configuration-A';
  const ready = await check('register-ready', async () => {
    const saved = await message({ action: 'setSiteConfig', config });
    assert.equal(saved.saved, true, '配置保存成功'); assert.equal(saved.syncReport.geolocationRuntime.state, 'ready', '位置注册就绪');
    assert.equal(saved.syncReport.pageRuntime.state, 'ready'); assert.equal(saved.syncReport.fontRuntime.state, 'ready');
    const scripts = await registrations(); const geo = scripts.filter(item => item.id.startsWith('vanishgeo-geolocation-'));
    assert.equal(geo.length, 1); assert.equal(geo[0].runAt, 'document_start'); assert.equal(geo[0].world, 'MAIN'); assert.equal(geo[0].allFrames, true);
    assert.ok(geo[0].matches.every(value => /^\*:|^https?:/.test(value))); await rememberSources();
    return { geolocationRuntime: saved.syncReport.geolocationRuntime, pageRuntime: saved.syncReport.pageRuntime,
      fontRuntime: saved.syncReport.fontRuntime, geoRegistrationCount: geo.length, documentStart: true, mainWorld: true, allFrames: true };
  });
  if (!ready) throw new Error('GEOLOCATION_REGISTRATION_NOT_READY');
  const heldA = await document({ frames: true });
  await check('first-inline', async () => { assertSuccess(heldA.row, 0, 0); const count = await sourceCount(heldA.target);
    assert.ok(count >= 1, '实际位置userScript必须已解析'); return { readyState: heldA.row.first.readyState, scriptIndex: 1,
      inline: true, asynchronous: true, capturedMethodReferenceUsed: true, syntheticPosition: heldA.row.firstResult.value, parsedGeolocationScripts: count }; });
  const contractExpression = '(' + (async function (sample) {
    const pause = ms => new Promise(done => setTimeout(done, ms));
    const get = options => new Promise(resolve => vgRefs.get.call(vgGeo, p => resolve({ kind: 'success', value: sample(p) }), e => resolve({ kind: 'error', code: e.code }), options));
    const result = {};
    let synchronous = true; let count = 0; let asyncWatch = null;
    const watch = await new Promise(resolve => {
      const id = vgRefs.watch.call(vgGeo, p => { count++; asyncWatch = !synchronous; resolve({ id, value: sample(p) }); }, e => resolve({ error: e.code }), { timeout: 2000 });
      synchronous = false;
    });
    vgRefs.clear.call(vgGeo, watch.id); await pause(80);
    result.methods = { ...watch, countAfterClear: count, asyncWatch, clearReturn: vgRefs.clear.call(vgGeo, watch.id), get: await get({ timeout: 1000 }) };
    let canceled = 0;
    const canceledId = vgRefs.watch.call(vgGeo, () => canceled++, () => canceled++);
    vgRefs.clear.call(vgGeo, canceledId); await pause(80); result.canceled = canceled;
    let successes = 0, errors = 0, uncaught = 0;
    const listener = event => { if (event.message.includes('VG029_SYNTHETIC_CALLBACK')) { uncaught++; event.preventDefault(); } };
    addEventListener('error', listener);
    vgRefs.get.call(vgGeo, () => { successes++; throw new Error('VG029_SYNTHETIC_CALLBACK'); }, () => errors++);
    await pause(80); removeEventListener('error', listener); result.exception = { successes, errors, uncaught };
    const outcome = fn => { try { fn(); return 'NO_ERROR'; } catch (error) { return error.name; } };
    const reads = [];
    const options = Object.fromEntries(['enableHighAccuracy', 'maximumAge', 'timeout'].map(name => [name, undefined]));
    for (const name of Object.keys(options)) Object.defineProperty(options, name, { get() { reads.push(name); return name === 'enableHighAccuracy' ? false : 1000; } });
    result.arguments = { receiver: outcome(() => vgRefs.get.call({}, () => {})), success: outcome(() => vgRefs.get.call(vgGeo, null)),
      error: outcome(() => vgRefs.get.call(vgGeo, () => {}, 1)), options: outcome(() => vgRefs.get.call(vgGeo, () => {}, null, 1)),
      clearMissing: outcome(() => vgRefs.clear.call(vgGeo)), symbol: outcome(() => vgRefs.get.call(vgGeo, () => {}, null, { timeout: Symbol() })),
      getter: outcome(() => vgRefs.get.call(vgGeo, () => {}, null, { get maximumAge() { throw new RangeError('synthetic'); } })),
      dictionary: await get(options), reads };
    const base = await get({ maximumAge: 0, timeout: 1000 });
    result.cache = { base, zero: await get({ maximumAge: 0, timeout: 0 }),
      reused: await get({ maximumAge: Infinity, timeout: 0 }),
      highAccuracyMiss: await get({ maximumAge: Infinity, timeout: 0, enableHighAccuracy: true }) };
    result.cache.high = await get({ maximumAge: 0, timeout: 1000, enableHighAccuracy: true });
    result.cache.highReused = await get({ maximumAge: Infinity, timeout: 0, enableHighAccuracy: true });
    const status = await navigator.permissions.query({ name: 'geolocation' });
    const other = await navigator.permissions.query({ name: 'notifications' });
    result.permission = { geolocation: status.state, notification: other.state, eventTarget: status instanceof EventTarget,
      invalidDescriptor: await navigator.permissions.query({ name: 'vg029-invalid' }).then(() => 'RESOLVED', e => e.name),
      invalidReceiver: await navigator.permissions.query.call({}, { name: 'geolocation' }).then(() => 'RESOLVED', e => e.name) };
    return result;
  }).toString() + ')(' + positionSample.toString() + ')';
  const contract = await evaluate(heldA.target, contractExpression);
  await check('get-watch-clear', async () => { assert.ok(Number.isInteger(contract.methods.id) && contract.methods.id > 0); assert.equal(contract.methods.countAfterClear, 1);
    assert.equal(contract.methods.asyncWatch, true); assert.equal(contract.methods.get.kind, 'success');
    assert.equal(contract.methods.value.latitude, 0); assert.equal(contract.methods.value.longitude, 0); return contract.methods; });
  await check('watch-reentrant-options', async () => {
    const result = await evaluate(heldA.target, '(' + (async function () {
      let innerId, innerCallbacks = 0, outerCallbacks = 0, errors = 0, timeoutReads = 0;
      const outerId = vgRefs.watch.call(vgGeo, () => outerCallbacks++, () => errors++, {
        get timeout() { timeoutReads++; innerId = vgRefs.watch.call(vgGeo, () => innerCallbacks++, () => errors++, { timeout: 1000 }); return 1000; }
      });
      vgRefs.clear.call(vgGeo, innerId);
      await new Promise(done => setTimeout(done, 80));
      vgRefs.clear.call(vgGeo, outerId);
      return { innerId, outerId, innerCallbacks, outerCallbacks, errors, timeoutReads };
    }).toString() + ')()');
    assert.notEqual(result.innerId, result.outerId, 'getter重入创建的watch ID必须不同');
    assert.deepEqual({ innerCallbacks: result.innerCallbacks, outerCallbacks: result.outerCallbacks, errors: result.errors, timeoutReads: result.timeoutReads },
      { innerCallbacks: 0, outerCallbacks: 1, errors: 0, timeoutReads: 1 });
    return result;
  });
  await check('cancel-before-first', () => { assert.equal(contract.canceled, 0); return { callbacksAfterImmediateClear: 0 }; });
  await check('success-exception', () => { assert.deepEqual(contract.exception, { successes: 1, errors: 0, uncaught: 1 }); return contract.exception; });
  await check('receiver-options', () => { for (const key of ['receiver', 'success', 'error', 'options', 'clearMissing', 'symbol']) assert.equal(contract.arguments[key], 'TypeError', key);
    assert.equal(contract.arguments.getter, 'RangeError'); assert.deepEqual(contract.arguments.reads, ['enableHighAccuracy', 'maximumAge', 'timeout']);
    assert.equal(contract.arguments.dictionary.kind, 'success'); return contract.arguments; });
  await check('timeout-cache-accuracy', () => { assert.deepEqual(contract.cache.zero, { kind: 'error', code: 3 });
    assert.equal(contract.cache.reused.kind, 'success'); assert.equal(contract.cache.reused.value.timestamp, contract.cache.base.value.timestamp);
    assert.deepEqual(contract.cache.highAccuracyMiss, { kind: 'error', code: 3 }); assert.equal(contract.cache.high.kind, 'success');
    assert.equal(contract.cache.highReused.value.timestamp, contract.cache.high.value.timestamp); return contract.cache; });
  await check('permissions', () => { assert.deepEqual(contract.permission, { geolocation: 'granted', notification: 'denied', eventTarget: true, invalidDescriptor: 'TypeError', invalidReceiver: 'TypeError' }); return contract.permission; });
  await check('permission-events', async () => {
    const eventResult = await evaluate(heldA.target, '(' + (async function () {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      const phases = []; let calls = [];
      const handler = label => function (event) { calls.push({ label, self: this === status, target: event.target === status,
        currentTarget: event.currentTarget === status, state: this.state, name: this.name }); };
      status.addEventListener('change', handler('first'));
      status.onchange = handler('replaced'); status.addEventListener('change', handler('second'));
      status.onchange = handler('replacement'); status.dispatchEvent(new Event('change')); phases.push(calls); calls = [];
      status.onchange = null; status.onchange = handler('readded'); status.dispatchEvent(new Event('change')); phases.push(calls);
      globalThis.vgPermissionEvents = { status, nativeChanges: 0 };
      status.addEventListener('change', () => vgPermissionEvents.nativeChanges++);
      return { eventTarget: status instanceof EventTarget, permissionPrototype: Object.getPrototypeOf(status) === PermissionStatus.prototype, phases,
        nativeQueryRejection: await navigator.permissions.query.call({}, { name: 'geolocation' }).then(() => 'RESOLVED', e => e.name),
        descriptorGetterRejection: await navigator.permissions.query({ get name() { throw new RangeError('synthetic'); } }).then(() => 'RESOLVED', e => e.name) };
    }).toString() + ')()');
    assert.equal(eventResult.eventTarget, true); assert.equal(eventResult.permissionPrototype, true);
    assert.deepEqual(eventResult.phases.map(rows => rows.map(item => item.label)), [['first', 'replacement', 'second'], ['first', 'second', 'readded']]);
    for (const entry of eventResult.phases.flat()) { assert.equal(entry.self, true); assert.equal(entry.target, true);
      assert.equal(entry.currentTarget, true); assert.equal(entry.state, 'granted'); assert.equal(entry.name, 'geolocation'); }
    assert.equal(eventResult.nativeQueryRejection, 'TypeError'); assert.equal(eventResult.descriptorGetterRejection, 'RangeError');
    try {
      await setPermission('granted'); await delay(100);
      const nativeChanges = await evaluate(heldA.target, 'vgPermissionEvents.nativeChanges'); assert.equal(nativeChanges, 0);
      return { ...eventResult, forwardedNativePermissionChanges: nativeChanges, fixtureDispatchedChanges: 2 };
    } finally { await setPermission('denied'); }
  });
  await check('policy-denied', async () => { const doc = await document({ policy: true });
    assert.deepEqual(doc.row.firstResult, { kind: 'error', code: 1 }); assert.equal(doc.row.permission, 'denied'); await close(doc.target);
    return { responsePolicy: 'geolocation=()', errorCode: 1, permission: 'denied', fixtureInvokedNativePosition: false }; });
  await check('same-origin-iframe', async () => { const child = await until(async () => (await row(heldA)).children.same, value => value?.firstResult);
    assertSuccess(child, 0, 0); return { loading: true, scriptIndex: 1, asynchronous: true, permission: child.permission, syntheticPosition: child.firstResult.value }; });
  await check('cross-origin-negative', async () => { const child = await until(async () => (await row(heldA)).children.cross, value => value?.permission && value.loaded);
    assert.equal(child.firstResult, null); assert.equal(child.permission, 'denied'); assert.equal(child.first.value.language, native.language);
    return { separateOrigin: true, allowlistRulePresent: false, permission: 'denied', languageNative: true, fixtureInvokedNativePosition: false }; });
  await check('language-timezone-font', () => { const value = heldA.row.first.value; assert.equal(value.language, 'fr-FR'); assert.deepEqual(value.languages, ['fr-FR', 'fr']);
    assert.equal(value.timezone, 'UTC'); assert.equal(value.fontFiltered, true); assert.equal(value.measurementFiltered, true);
    return { language: value.language, timezone: value.timezone, fontCheckTargetFalse: true, namedMeasureEqualsSansSerif: true }; });
  await check('special-documents', async () => { const doc = await document({ special: true });
    let children;
    try { children = await until(async () => (await row(doc)).children, values => ['srcdoc', 'opaque', 'data', 'blank', 'blob'].every(key => values[key]?.permission && values[key].loaded)); }
    catch (error) {
      const observed = (await row(doc)).children;
      evidence.observations['special-documents'] = Object.fromEntries(['srcdoc', 'opaque', 'data', 'blank', 'blob'].map(key => [key,
        { observed: !!observed[key], loaded: !!observed[key]?.loaded, permission: observed[key]?.permission || null }]));
      throw error;
    }
    const outcomes = {};
    for (const key of ['srcdoc', 'opaque', 'data', 'blank', 'blob']) {
      assert.equal(children[key].firstResult, null); assert.equal(children[key].first.value.language, native.language, key);
      assert.notEqual(children[key].permission, 'granted', key); outcomes[key] = { fixtureInvokedNativePosition: false, languageNative: true, permission: children[key].permission };
    }
    await close(doc.target); return outcomes; });
  config.rules.push(rule('127.0.0.1'));
  await message({ action: 'setSiteConfig', config }); await rememberSources();
  await check('cross-origin-allowed', async () => { const doc = await document({ frames: true, crossActive: true });
    const child = await until(async () => (await row(doc)).children.cross, value => value?.firstResult);
    assertSuccess(child, 0, 0); assert.equal(child.permission, 'granted'); await close(doc.target);
    return { separateOrigin: true, ownAllowlistRule: true, loading: true, scriptIndex: 1, asynchronous: true, syntheticPosition: child.firstResult.value }; });
  await check('https-origin-fixture', async () => {
    const httpsOrigin = 'https://geo.example.test';
    config.rules.push(rule('geo.example.test')); await message({ action: 'setSiteConfig', config }); await rememberSources();
    await setPermission('denied', httpsOrigin);
    const path = '/probe/' + randomUUID() + '?active=1';
    const html = await (await fetch(origin + path)).text();
    const target = await page(httpsOrigin + path, true, html);
    const sample = await until(() => evaluate(target, 'globalThis.vgProbe && JSON.parse(JSON.stringify(vgProbe))'), value => value?.loaded && value.firstResult && value.permission);
    assertSuccess(sample, 0, 0); assert.equal(sample.first.value.secureContext, true); assert.equal(sample.permission, 'granted');
    assert.equal(sample.first.value.language, 'fr-FR'); assert.equal(sample.first.value.timezone, 'UTC');
    assert.equal(sample.first.value.fontFiltered, true); assert.equal(sample.first.value.measurementFiltered, true);
    assert.ok(await sourceCount(target) >= 1);
    const fixture = httpsFixtures.get(target.sessionId); assert.equal(fixture.fulfilled, 1); assert.equal(fixture.protocolFailure, false);
    await close(target); httpsFixtures.delete(target.sessionId);
    return { mechanism: 'HTTPS origin fixture via CDP Fetch.fulfillRequest', tlsTransportVerified: false,
      networkRequestsToFixtureHost: 0, fulfilledDocumentRequests: fixture.fulfilled, unexpectedRequestsBlocked: fixture.blocked,
      secureContext: true, actualUserScriptObserved: true, syntheticPosition: sample.firstResult.value,
      language: 'fr-FR', timezone: 'UTC', fontFilter: true, certificateBypass: false };
  });
  // 创建无 Debugger 的独立候选；只有实际 pageshow.persisted=true 才认定 BFCache。
  const cachedA = await document({ debug: false });
  await evaluate(cachedA.target, 'new Promise(resolve=>{globalThis.vgBfcacheWatch={callbacks:[],errors:[]};'
    + 'vgBfcacheWatch.id=vgRefs.watch.call(vgGeo,p=>{vgBfcacheWatch.callbacks.push({latitude:p.coords.latitude,longitude:p.coords.longitude});resolve(true)},'
    + 'e=>{vgBfcacheWatch.errors.push(e.code);resolve(false)})})');
  await cdp.send('Page.navigate', { url: origin + '/away' }, cachedA.target.sessionId);
  await until(() => evaluate(cachedA.target, 'location.pathname==="/away" && document.readyState==="complete"'));
  phase = 'configuration-B';
  config.globalProfile.geolocation.latitude = 1; config.globalProfile.geolocation.longitude = 2;
  const savedB = await message({ action: 'setSiteConfig', config }); await rememberSources();
  await cdp.send('Target.activateTarget', { targetId: heldA.target.targetId });
  await check('snapshot-A-to-B', async () => { const result = await evaluate(heldA.target, 'new Promise(resolve=>vgRefs.get.call(vgGeo,p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude}),e=>resolve({error:e.code})))');
    assert.deepEqual(result, { latitude: 0, longitude: 0 }); assert.equal(savedB.syncReport.geolocationRuntime.reloadRequired, true);
    return { heldDocumentA: result, newConfigurationB: { latitude: 1, longitude: 2 }, reloadRequired: true }; });
  await check('reload-B', async () => { const previous = heldA.row.serial; await cdp.send('Page.reload', {}, heldA.target.sessionId);
    heldA.row = await until(() => row(heldA), value => value?.serial !== previous && value.loaded && value.firstResult);
    assertSuccess(heldA.row, 1, 2); return { newDocument: true, syntheticPosition: heldA.row.firstResult.value }; });
  await check('bfcache', async () => {
    await cdp.send('Target.activateTarget', { targetId: cachedA.target.targetId });
    await evaluate(cachedA.target, 'history.back();true');
    const restored = await until(() => evaluate(cachedA.target, 'globalThis.vgProbe && JSON.parse(JSON.stringify(vgProbe))'), value => value?.loaded && value.pageshows.length);
    if (!restored.pageshows.includes(true)) {
      evidence.observations.bfcache = { actualPersisted: false, restoredSameDocument: restored.serial === cachedA.row.serial };
      throw new Error('ACTUAL_BFCACHE_NOT_OBSERVED');
    }
    assert.equal(restored.serial, cachedA.row.serial);
    await until(() => evaluate(cachedA.target, 'vgBfcacheWatch.callbacks.length'), value => value >= 2);
    await delay(100);
    const watch = await evaluate(cachedA.target, '({callbacks:vgBfcacheWatch.callbacks,errors:vgBfcacheWatch.errors})');
    assert.deepEqual(watch, { callbacks: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }], errors: [] });
    await evaluate(cachedA.target, 'vgRefs.clear.call(vgGeo,vgBfcacheWatch.id);true');
    const result = await evaluate(cachedA.target, 'new Promise(resolve=>vgRefs.get.call(vgGeo,p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude}),e=>resolve({error:e.code})))');
    assert.deepEqual(result, { latitude: 0, longitude: 0 }); await close(cachedA.target);
    return { actualPersisted: true, restoredSameDocument: true, snapshotA: result, configurationBNotApplied: true,
      watchCallbacks: watch.callbacks.length, oneCallbackAfterResume: true, watchErrors: watch.errors };
  });
  for (const setting of ['denied', 'prompt', 'granted']) {
    const id = 'permission-false-' + setting;
    await check(id, async () => {
      config.globalProfile.geolocation.spoofPermission = false; await message({ action: 'setSiteConfig', config }); await rememberSources();
      await setPermission(setting);
      const doc = await document(); assert.equal(doc.row.permission, setting);
      if (setting === 'granted') assertSuccess(doc.row, 1, 2);
      else assert.deepEqual(doc.row.firstResult, { kind: 'error', code: 1 });
      const result = { nativePermission: setting, actualPermissionQuery: doc.row.permission, result: doc.row.firstResult,
        fixtureOnly: true, emulatedNativeSentinelNotReturned: true }; await close(doc.target); return result;
    });
  }
  config.globalProfile.geolocation.spoofPermission = true; await setPermission('denied');
  await message({ action: 'setSiteConfig', config }); await rememberSources();
  // 恢复期间所有扩展页面关闭，先清注册再停止worker，不能以getSiteConfig触发恢复。
  const expected = await registrations();
  const canonical = scripts => JSON.stringify(scripts.slice().sort((a, b) => a.id.localeCompare(b.id)));
  const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
  for (const target of await targets()) if (target.type === 'page' && (target.url.startsWith(extensionOrigin) || target.url.startsWith('chrome://extensions'))) await cdp.send('Target.closeTarget', { targetId: target.targetId });
  options = null; recovery = true;
  const lifecycle = await page('about:blank'); await cdp.send('ServiceWorker.enable', {}, lifecycle.sessionId);
  workerReader = createWorkerReader(cdp, extensionOrigin);
  async function clearAndStop(version) {
    const { worker } = await workerReader.read('null', version);
    await evaluate(worker, 'chrome.userScripts.unregister()'); assert.deepEqual(await evaluate(worker, 'chrome.userScripts.getScripts()'), []);
    await cdp.send('ServiceWorker.stopAllWorkers', {}, lifecycle.sessionId);
    await until(async () => !(await targets()).some(target => target.type === 'service_worker' && target.url.startsWith(extensionOrigin)));
    await workerReader.close();
    assert.ok(!(await targets()).some(target => target.type === 'page' && target.url.startsWith(extensionOrigin)));
  }
  async function observeRecovery(version) {
    const result = await workerReader.read('chrome.userScripts.getScripts()', version, scripts => canonical(scripts) === canonical(expected));
    assert.ok(!(await targets()).some(target => target.type === 'page' && target.url.startsWith(extensionOrigin)));
    const doc = await document(); assertSuccess(doc.row, 1, 2); await close(doc.target);
    return { managementPagesClosed: true, managementMessages: 0, registrationsBeforeTrigger: 0,
      exactRegistrationReadback: true, geolocationRegistrationCount: result.value.filter(item => item.id.startsWith('vanishgeo-geolocation-')).length,
      workerReadiness: result.readiness, newDocumentSyntheticB: true };
  }
  phase = 'worker-recovery';
  await check('worker-stop-wake', async () => { await clearAndStop(initialManifest.version);
    await cdp.send('ServiceWorker.startWorker', { scopeURL: extensionOrigin }, lifecycle.sessionId);
    return { trigger: 'CDP ServiceWorker.startWorker', ...await observeRecovery(initialManifest.version) }; });
  await check('extension-update', async () => {
    await clearAndStop(initialManifest.version);
    const parts = initialManifest.version.split('.').map(Number); parts[parts.length - 1]++;
    const updatedVersion = parts.join('.');
    await writeFile(join(staged, 'manifest.json'), JSON.stringify({ ...initialManifest, version: updatedVersion }));
    assert.equal((await cdp.send('Extensions.loadUnpacked', { path: staged })).id, extensionId);
    return { trigger: 'Extensions.loadUnpacked version update', previousVersion: initialManifest.version,
      updatedVersion, explicitWorkerStart: false, ...await observeRecovery(updatedVersion) };
  });
  await workerReader.close(); recovery = false;
  options = await page(optionsUrl); await until(() => evaluate(options, 'Boolean(globalThis.chrome?.runtime && document.getElementById("runtimeSyncStatus"))'));
  phase = 'revocation';
  async function assertNativeDocument(reason) {
    const doc = await document({ active: false });
    const geo = (await registrations()).filter(script => script.id.startsWith('vanishgeo-geolocation-'));
    assert.equal(geo.length, 0); assert.equal(await sourceCount(doc.target), 0);
    assert.equal(doc.row.permission, 'denied'); assert.equal(doc.row.first.value.nativeShape, native.nativeShape);
    assert.equal(doc.row.firstResult, null); await close(doc.target);
    return { reason, geoRegistrationCount: 0, parsedGeolocationScripts: 0, permission: 'denied', nativeDescriptorShape: true, fixtureInvokedNativePosition: false };
  }
  await check('disable-native', async () => { config.masterEnabled = false; const response = await message({ action: 'setSiteConfig', config });
    assert.equal(response.syncReport.geolocationRuntime.state, 'disabled'); return assertNativeDocument('master-disabled'); });
  await check('delete-native', async () => { config.masterEnabled = true; config.rules = []; const response = await message({ action: 'setSiteConfig', config });
    assert.equal(response.syncReport.geolocationRuntime.state, 'disabled'); return assertNativeDocument('allowlist-deleted'); });
  assert.deepEqual(await fingerprint(dist), evidence.observations['actual-dist'].fingerprint, '生产dist未修改');
} catch (error) {
  evidence.failures.push({ phase, ...safeFailure(error) });
} finally {
  if (workerReader) { try { await workerReader.close(); } catch { evidence.cleanup.failures.push('WORKER_READER_CLOSE_FAILED'); } }
  if (cdp) { try { await cdp.send('Browser.close'); } catch {} cdp.close(); }
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    const exit = once(browser, 'exit'); browser.kill('SIGTERM'); await Promise.race([exit, delay(2000)]);
    if (browser.exitCode === null && browser.signalCode === null) { browser.kill('SIGKILL'); await exit; }
  }
  if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (temporary) { try { await rm(temporary, { recursive: true, force: true }); } catch { evidence.cleanup.failures.push('TEMPORARY_CLEANUP_FAILED'); } }
  evidence.cleanup.status = evidence.cleanup.failures.length ? 'FAIL' : 'PASS';
  evidence.conclusion = required.every(id => evidence.checks[id] === 'PASS') && evidence.cleanup.status === 'PASS' && evidence.failures.length === 0 ? 'PASS'
    : Object.values(evidence.checks).includes('FAIL') || evidence.failures.some(item => item.type === 'assertion') || evidence.cleanup.status === 'FAIL' ? 'FAIL' : 'BLOCKED';
  evidence.exitCode = evidence.conclusion === 'PASS' ? 0 : evidence.conclusion === 'FAIL' ? 1 : 2;
  const json = JSON.stringify(evidence, null, 2) + '\n';
  if (output) await writeFile(output, json);
  process.stdout.write(json); process.exitCode = evidence.exitCode;
}
