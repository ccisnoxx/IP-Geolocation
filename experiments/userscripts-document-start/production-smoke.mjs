// 独立 Linux namespace 内加载实际 dist；页面只记录实际值，配置只经扩展管理页发送。
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { probeNetwork, probeInheritedNetwork } from './network-probe.mjs';
import { chromeSandboxStatus } from './chrome-sandbox-status.mjs';
import { createWorkerReader } from './worker-reader.mjs';

const recoveryOnly = process.argv[2] === '--recovery-only';
const required = recoveryOnly ? ['network', 'chrome-sandbox', 'fresh-disabled', 'normal-user-switch', 'register',
  'worker-restart', 'extension-update'] : ['network', 'chrome-sandbox', 'fresh-disabled', 'normal-user-switch', 'register', 'earliest-top-iframe',
  'native-origin', 'paused-surfaces', 'specific-domain', 'snapshot-A-to-B', 'reload-B', 'compatible',
  'dnr-webrtc', 'worker-restart', 'extension-update', 'disabled-snapshot', 'disabled-reload'];
const evidence = { schemaVersion: 2, scope: recoveryOnly ? 'automatic-language-timezone-recovery' : 'full-language-timezone-smoke',
  conclusion: 'BLOCKED', exitCode: 2, environment: { platform: process.platform, architecture: process.arch, realChrome: false },
  checks: Object.fromEntries(required.map(id => [id, 'UNKNOWN'])), observations: {}, cleanup: { status: 'UNKNOWN', failures: [] }, stopReason: null };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept = Boolean) {
  for (let count = 0; count < 200; count++) {
    try { const value = await read(); if (accept(value)) return value; }
    catch (error) { if (!/context|Cannot find|Inspected target/i.test(error.message)) throw error; }
    await delay(50);
  }
  throw new Error('AUTOMATION_TIMEOUT');
}
function fixture(serial, child) {
  function bootstrap(instance, includeWorkers) {
    const read = () => {
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = '13px "VanishGeo Synthetic Font"';
      return { language: navigator.language, languages: Array.from(navigator.languages),
        locale: Intl.DateTimeFormat().resolvedOptions().locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        numberLocale: Intl.NumberFormat().resolvedOptions().locale,
        explicit: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions(),
        hour: new Date(Date.UTC(2024, 0, 1)).getHours(), offset: new Date(Date.UTC(2024, 0, 1)).getTimezoneOffset(),
        font: canvas.font };
    };
    globalThis.vgActual = { instance, earliest: read(), load: null, readyState: document.readyState,
      scriptIndex: document.scripts.length, inline: Boolean(document.currentScript && !document.currentScript.src),
      worker: null, shared: null, permission: null };
    globalThis.vgRead = read;
    addEventListener('load', () => { vgActual.load = read(); }, { once: true });
    if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(result => { vgActual.permission = result.state; });
    if (!includeWorkers) return;
    const worker = new Worker('/worker.js');
    worker.onmessage = event => { vgActual.worker = event.data; worker.terminate(); };
    const shared = new SharedWorker('/shared.js', 'vg-production-smoke');
    shared.port.onmessage = event => { vgActual.shared = event.data; shared.port.close(); };
  }
  return '<!doctype html><html><head><script>(' + bootstrap.toString() + ')(' + serial + ',' + !recoveryOnly + ');</script><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>'
    + (child ? '' : '<iframe src="/child"></iframe>') + '</body></html>';
}
let chrome, server, cdp, options, temp;
try {
  assert.equal(typeof process.send, 'function');
  const topology = JSON.parse(execFileSync('ip', ['-j', 'link'], { encoding: 'utf8' }));
  const route4 = JSON.parse(execFileSync('ip', ['-j', 'route', 'show', 'table', 'all'], { encoding: 'utf8' }));
  const route6 = JSON.parse(execFileSync('ip', ['-j', '-6', 'route', 'show', 'table', 'all'], { encoding: 'utf8' }));
  const network = await probeNetwork(); network.inherited = await probeInheritedNetwork();
  assert.ok(Object.values(network).every(value => value === 'PASS'));
  assert.ok(topology.length === 1 && topology[0].ifname === 'lo' && process.getuid() > 0);
  assert.ok([route4, route6].every(routes => routes.some(route => route.type === 'prohibit' && route.dst === 'default')));
  assert.ok([...route4, ...route6].every(route => route.type === 'prohibit' || route.dev === 'lo'));
  evidence.network = { backend: 'linux-network-namespace', checks: network, onlyLoopback: true, ipv4Prohibit: true, ipv6Prohibit: true, nonRoot: true };
  evidence.checks.network = 'PASS';
  let serial = 0, latestHeader;
  const workerCode = "({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})";
  server = createServer((request, response) => {
    latestHeader = request.headers['accept-language'];
    if (request.url === '/worker.js' || request.url === '/shared.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(request.url === '/worker.js' ? 'postMessage(' + workerCode + ');'
        : 'onconnect=e=>e.ports[0].postMessage(' + workerCode + ');');
    } else if (request.url === '/' || request.url === '/child') {
      response.setHeader('Content-Type', 'text/html'); response.end(fixture(++serial, request.url === '/child'));
    } else { response.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const local = 'http://localhost:' + port + '/';
  const nativeUrl = 'http://127.0.0.1:' + port + '/';
  temp = process.env.VG_US_EXPERIMENT_TEMP;
  chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
    '--user-data-dir=' + temp, '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--host-resolver-rules=MAP example.test 127.0.0.1, MAP sub.example.test 127.0.0.1', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
  const debugPort = await until(async () => { try { return (await readFile(join(temp, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json();
  evidence.environment.chromeVersion = /\/([\d.]+)/.exec(version.Browser)[1]; evidence.environment.realChrome = true;
  const ws = new WebSocket('ws://127.0.0.1:' + debugPort + new URL(version.webSocketDebuggerUrl).pathname);
  await once(ws, 'open');
  let sequence = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), { cdpCode: message.error.code })); else request.resolve(message.result);
  });
  cdp = { close: () => ws.close(), send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT')); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  } };
  async function evaluate(page, expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
    if (result.exceptionDetails) {
      evidence.observations.evaluationFailure = {
        type: result.exceptionDetails.exception?.className || 'Unknown',
        detail: result.exceptionDetails.exception?.description?.split('\n')[0]
          .replace(/(?:chrome-extension|https?):\/\/\S+/g, '<local-context>') || 'EXCEPTION'
      };
      throw new Error('EXTENSION_OR_FIXTURE_EXCEPTION');
    }
    return result.result.value;
  }
  async function page(url) {
    const result = await cdp.send('Target.createTarget', { url });
    return { ...result, ...await cdp.send('Target.attachToTarget', { targetId: result.targetId, flatten: true }) };
  }
  const sandbox = await page('chrome://sandbox');
  evidence.environment.sandbox = chromeSandboxStatus(await until(() => evaluate(sandbox, 'document.body?.innerText'), text => text?.includes('Seccomp')));
  assert.equal(evidence.environment.sandbox.status, 'PASS'); evidence.checks['chrome-sandbox'] = 'PASS';
  const dist = fileURLToPath(new URL('./dist/', import.meta.url));
  const initialVersion = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8')).version;
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: dist });
  const optionsUrl = 'chrome-extension://' + id + '/options/options.html';
  options = await page(optionsUrl);
  await until(() => evaluate(options, "Boolean(globalThis.chrome?.runtime && document.getElementById('runtimeSyncStatus'))"));
  let recoveryPhase = false;
  const message = request => {
    assert.equal(recoveryPhase, false, '自动恢复检查期间禁止管理消息触发对账');
    return evaluate(options, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')');
  };
  const readRows = target => evaluate(target, '(() => {const frames=[window,...Array.from(document.querySelectorAll("iframe"),f=>f.contentWindow)]; return frames.every(w=>w.vgActual?.load && (' + recoveryOnly + ' || (w.vgActual.worker && w.vgActual.shared))) ? frames.map(w=>({...w.vgActual,current:w.vgRead()})) : null})()');
  async function document(url) {
    const target = await page(url);
    try { return { target, rows: await until(() => readRows(target)) }; }
    catch (error) {
      evidence.observations.incompleteDocument = await evaluate(target,
        '([window,...Array.from(document.querySelectorAll("iframe"),f=>f.contentWindow)]).map(w=>({readyState:w.document.readyState,hasSample:Boolean(w.vgActual),load:w.vgActual?.load,worker:w.vgActual?.worker,shared:w.vgActual?.shared}))');
      throw error;
    }
  }
  async function reload(document) {
    await cdp.send('Page.enable', {}, document.target.sessionId);
    await cdp.send('Page.reload', {}, document.target.sessionId);
    const rows = await until(() => readRows(document.target), rows => rows && rows[0].instance !== document.rows[0].instance);
    document.rows = rows; return rows;
  }
  const native = (await document(nativeUrl)).rows[0].current;
  const nativeHeader = latestHeader;
  assert.ok(typeof nativeHeader === 'string' && nativeHeader.length);
  const fresh = await message({ action: 'getSiteConfig' });
  assert.equal(fresh.config.masterEnabled, false); assert.deepEqual(fresh.config.rules, []);
  assert.equal(fresh.syncReport.pageRuntime.state, 'switch-required');
  assert.equal(fresh.syncReport.components.contentScripts.status, 'failed');
  evidence.observations.fresh = { masterEnabled: false, ruleCount: 0, pageRuntime: fresh.syncReport.pageRuntime, native };
  assert.equal((await document(local)).rows[0].current.language, native.language);
  evidence.checks['fresh-disabled'] = 'PASS';
  const details = await page('chrome://extensions/?id=' + id);
  const readToggle = '(() => {const find=root=>{for(const n of root.querySelectorAll("*")){if(n.id==="allow-user-scripts")return n;if(n.shadowRoot){const v=find(n.shadowRoot);if(v)return v}}};const t=find(document)?.shadowRoot?.querySelector("cr-toggle");if(!t)return null;t.scrollIntoView({block:"center"});const r=t.getBoundingClientRect();return {checked:t.checked,disabled:t.disabled,x:r.x+r.width/2,y:r.y+r.height/2}})()';
  const before = await until(() => evaluate(details, readToggle));
  assert.equal(before.checked, false); assert.equal(before.disabled, false);
  await cdp.send('Target.activateTarget', { targetId: details.targetId });
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: before.x, y: before.y, button: 'left', clickCount: 1 }, details.sessionId);
  await until(() => evaluate(details, readToggle), row => row?.checked === true);
  assert.deepEqual(await evaluate(options, 'chrome.userScripts.getScripts()'), []);
  evidence.environment.allowUserScripts = { before: false, after: true, method: 'normal-details-UI-trusted-pointer' };
  evidence.checks['normal-user-switch'] = 'PASS';
  const config = fresh.config;
  config.masterEnabled = true; config.webRtc.globalMode = 'strict'; config.intlMode = 'strict';
  config.globalProfile.language = { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja'] };
  config.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' };
  config.fontExposure = { enabled: true, mode: 'custom', blockedFamilies: ['VanishGeo Synthetic Font'] };
  const rule = domain => ({ id: 'synthetic-' + domain, domain, enabled: true, exitLocationProfileId: null,
    overrides: { language: { mode: 'inherit', value: null }, timezone: { mode: 'inherit', value: null }, geolocation: { mode: 'inherit', value: null } } });
  config.rules = ['localhost', 'example.test', 'sub.example.test'].map(rule);
  config.rules[2].overrides.language = { mode: 'override', value: { enabled: true, language: 'ko-KR', languages: ['ko-KR'] } };
  config.rules[2].overrides.timezone = { mode: 'override', value: { enabled: true, mode: 'manual', timezone: 'Asia/Seoul' } };
  if (recoveryOnly) {
    config.intlMode = 'compatible';
    config.globalProfile.language = { enabled: true, mode: 'custom', language: 'fr-FR', languages: ['fr-FR', 'fr'] };
    config.globalProfile.timezone.timezone = 'Europe/Paris';
  }
  const saved = await message({ action: 'setSiteConfig', config });
  assert.equal(saved.syncReport.pageRuntime.state, 'ready'); assert.equal(saved.syncReport.components.contentScripts.status, 'ok');
  evidence.checks.register = 'PASS';
  function configured(rows, language, timezone, offset) {
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.readyState, 'loading'); assert.equal(row.scriptIndex, 1); assert.equal(row.inline, true);
      for (const stage of ['earliest', 'load', 'current']) {
        assert.equal(row[stage].language, language); assert.equal(row[stage].locale, language);
        assert.equal(row[stage].timezone, timezone); assert.equal(row[stage].offset, offset);
      }
    }
  }
  let heldB;
  if (!recoveryOnly) {
  const heldA = await document(local); configured(heldA.rows, 'ja-JP', 'Asia/Tokyo', -540);
  assert.equal(heldA.rows[0].current.numberLocale, 'ja-JP'); assert.deepEqual(heldA.rows[0].current.languages, ['ja-JP', 'ja']);
  evidence.observations.earliestA = heldA.rows.map(row => ({ language: row.earliest.language, timezone: row.earliest.timezone, offset: row.earliest.offset, readyState: row.readyState, scriptIndex: row.scriptIndex }));
  evidence.checks['earliest-top-iframe'] = 'PASS';
  assert.deepEqual((await document(nativeUrl)).rows[0].current, native); evidence.checks['native-origin'] = 'PASS';
  for (const row of heldA.rows) {
    assert.equal(row.worker.language, native.language); assert.equal(row.worker.timezone, native.timezone);
    assert.equal(row.shared.language, native.language); assert.equal(row.shared.timezone, native.timezone);
    assert.equal(row.current.font, native.font); assert.equal(row.permission, 'prompt');
  }
  evidence.observations.paused = heldA.rows.map(row => ({ worker: row.worker, shared: row.shared, font: row.current.font, geolocationPermission: row.permission }));
  evidence.checks['paused-surfaces'] = 'PASS';
  const child = await document('http://sub.example.test:' + port + '/'); configured(child.rows, 'ko-KR', 'Asia/Seoul', -540);
  const registrations = await evaluate(options, 'chrome.userScripts.getScripts()');
  assert.ok(registrations.find(script => script.id.endsWith('-example.test')).excludeMatches.includes('*://sub.example.test/*'));
  evidence.observations.specific = { actual: child.rows.map(row => row.earliest),
    excludes: registrations.find(script => script.id.endsWith('-example.test')).excludeMatches };
  evidence.checks['specific-domain'] = 'PASS';
  config.intlMode = 'compatible'; config.globalProfile.language.language = 'fr-FR'; config.globalProfile.language.languages = ['fr-FR', 'fr'];
  config.globalProfile.timezone.timezone = 'Europe/Paris';
  const changed = await message({ action: 'setSiteConfig', config }); assert.equal(changed.syncReport.pageRuntime.reloadRequired, true);
  const old = await readRows(heldA.target); assert.equal(old[0].instance, heldA.rows[0].instance); assert.equal(old[0].current.language, 'ja-JP'); assert.equal(old[0].current.timezone, 'Asia/Tokyo');
  evidence.observations.afterSaveB = { sameDocument: old[0].instance === heldA.rows[0].instance, old: old.map(row => row.current), sync: changed.syncReport.pageRuntime };
  evidence.checks['snapshot-A-to-B'] = 'PASS';
  configured(await reload(heldA), 'fr-FR', 'Europe/Paris', -60); evidence.observations.afterReloadB = heldA.rows.map(row => row.earliest); evidence.checks['reload-B'] = 'PASS';
  heldB = await document(local); configured(heldB.rows, 'fr-FR', 'Europe/Paris', -60);
  assert.equal(heldB.rows[0].current.explicit.locale, 'en-US'); assert.equal(heldB.rows[0].current.explicit.timeZone, 'UTC'); evidence.checks.compatible = 'PASS';
  assert.equal(latestHeader, nativeHeader);
  const permissions = await evaluate(options, 'chrome.permissions.getAll()');
  assert.equal(permissions.permissions.some(permission => permission.startsWith('declarativeNetRequest')), false);
  assert.deepEqual(Object.keys(changed.syncReport.components).sort(), ['contentScripts', 'tabReload', 'webrtc']);
  const policy = await message({ action: 'getWebRtcConfig' }); assert.equal(policy.state.policyState.actualPolicy, 'disable_non_proxied_udp');
  evidence.observations.networkPolicy = { headerNative: latestHeader === nativeHeader, dnrPermissionAbsent: true, webRtcPolicy: policy.state.policyState.actualPolicy };
  evidence.checks['dnr-webrtc'] = 'PASS';
  }
  // 从此处到两个恢复场景结束，管理页全部关闭；只直接读取浏览器注册，不调用业务消息。
  const expectedScripts = await evaluate(options, 'chrome.userScripts.getScripts()');
  const canonical = scripts => JSON.stringify(scripts.slice().sort((a, b) => a.id.localeCompare(b.id)));
  const expected = canonical(expectedScripts);
  assert.ok(expectedScripts.length > 0);
  const extensionOrigin = 'chrome-extension://' + id + '/';
  const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
  const workerTarget = async () => (await targets()).find(target => target.type === 'service_worker' && target.url.startsWith(extensionOrigin));
  const assertNoExtensionPages = async () => {
    assert.ok(!(await targets()).some(target => target.type === 'page' && target.url.startsWith(extensionOrigin)), '恢复期间不得打开扩展管理页');
  };
  for (const target of await targets()) {
    if (target.type === 'page' && (target.url.startsWith(extensionOrigin) || target.url.startsWith('chrome://extensions'))) {
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
    }
  }
  options = null; recoveryPhase = true;
  await assertNoExtensionPages();
  const lifecycle = await page('about:blank');
  await cdp.send('ServiceWorker.enable', {}, lifecycle.sessionId);
  // 先核对本次浏览器实际提供的 CDP 方法，再用它启动已停止的扩展 worker。
  const protocol = await (await fetch('http://127.0.0.1:' + debugPort + '/json/protocol')).json();
  assert.ok(protocol.domains.find(domain => domain.domain === 'ServiceWorker')?.commands
    .find(command => command.name === 'startWorker')?.parameters.some(parameter => parameter.name === 'scopeURL'));
  const workerReader = createWorkerReader(cdp, extensionOrigin);
  async function readWorker(expression, version, accept) {
    try { return await workerReader.read(expression, version, accept); }
    finally { evidence.observations.workerReadiness = workerReader.diagnostics(); }
  }
  async function clearAndStopWorker() {
    evidence.observations.recoveryStep = 'clear-registrations';
    const { worker } = await readWorker('null', initialVersion);
    // 写操作只执行一次；异常不得通过重新附加后重写来掩盖。
    await evaluate(worker, 'chrome.userScripts.unregister()');
    assert.deepEqual(await evaluate(worker, 'chrome.userScripts.getScripts()'), []);
    evidence.observations.recoveryStep = 'stop-worker';
    await cdp.send('ServiceWorker.stopAllWorkers', {}, lifecycle.sessionId);
    await until(async () => !await workerTarget());
    await workerReader.close();
    await assertNoExtensionPages();
  }
  async function observeRecovery(trigger, version) {
    evidence.observations.recoveryStep = trigger + ':observe-registration';
    const { value: scripts, readiness } = await readWorker('chrome.userScripts.getScripts()', version, rows => canonical(rows) === expected);
    await assertNoExtensionPages();
    evidence.observations.recoveryStep = trigger + ':new-document';
    const recoveredDocument = await document(local);
    configured(recoveredDocument.rows, 'fr-FR', 'Europe/Paris', -60);
    return { trigger, managementPagesClosed: true, managementMessages: 0, registrationsBeforeTrigger: [],
      workerStoppedBeforeTrigger: true, readback: 'CDP worker context: chrome.userScripts.getScripts()',
      registeredIds: scripts.map(script => script.id).sort(), exactRegistrationMatch: true,
      workerReadiness: readiness,
      newDocument: recoveredDocument.rows.map(row => ({ earliest: row.earliest, load: row.load, current: row.current,
        readyState: row.readyState, scriptIndex: row.scriptIndex, inline: row.inline })) };
  }
  await clearAndStopWorker();
  await cdp.send('ServiceWorker.startWorker', { scopeURL: extensionOrigin }, lifecycle.sessionId);
  evidence.observations.workerRestart = await observeRecovery('CDP ServiceWorker.startWorker', initialVersion);
  evidence.checks['worker-restart'] = 'PASS';
  await clearAndStopWorker();
  const manifestPath = join(dist, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const previousVersion = manifest.version; manifest.version = '2.1.2'; await writeFile(manifestPath, JSON.stringify(manifest));
  const updated = await cdp.send('Extensions.loadUnpacked', { path: dist }); assert.equal(updated.id, id);
  const updateRecovery = await observeRecovery('Extensions.loadUnpacked version update', '2.1.2');
  await workerReader.close();
  evidence.observations.update = { ...updateRecovery, previousVersion, candidateVersion: '2.1.2', sameExtension: true,
    mechanism: 'Extensions.loadUnpacked same staged directory', explicitWorkerStart: false };
  evidence.checks['extension-update'] = 'PASS';
  recoveryPhase = false;
  if (!recoveryOnly) {
  options = await page(optionsUrl);
  await until(() => evaluate(options, "Boolean(globalThis.chrome?.runtime && document.getElementById('runtimeSyncStatus'))"));
  config.rules[0].enabled = false;
  const disabled = await message({ action: 'setSiteConfig', config });
  assert.equal(disabled.syncReport.components.contentScripts.status, 'ok');
  assert.equal(disabled.syncReport.pageRuntime.reloadRequired, true);
  assert.ok(!(await evaluate(options, 'chrome.userScripts.getScripts()')).some(script => script.id.endsWith('-localhost')));
  evidence.observations.afterDisable = { old: (await readRows(heldB.target))[0].current, sync: disabled.syncReport.pageRuntime };
  assert.equal((await readRows(heldB.target))[0].current.language, 'fr-FR'); evidence.checks['disabled-snapshot'] = 'PASS';
  assert.deepEqual((await reload(heldB))[0].current, native); evidence.observations.disabledReload = heldB.rows.map(row => row.earliest); evidence.checks['disabled-reload'] = 'PASS';
  }
  evidence.stopReason = null;
} catch (error) {
  evidence.failure = { nextCheck: required.find(id => evidence.checks[id] !== 'PASS') || 'finalization',
    type: error.code === 'ERR_ASSERTION' ? 'assertion' : 'automation',
    detail: error.code === 'ERR_ASSERTION' ? String(error.actual) + ' != ' + String(error.expected) :
      (/^[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_OPERATION_FAILED') };
  evidence.stopReason = 'PRODUCTION_SMOKE_INCOMPLETE';
} finally {
  if (cdp) { try { await cdp.send('Browser.close'); } catch {} cdp.close(); }
  if (chrome?.exitCode === null && chrome.signalCode === null) {
    const exit = once(chrome, 'exit'); chrome.kill('SIGTERM'); await Promise.race([exit, delay(2000)]);
    if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await exit; }
  }
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (temp) { try { await rm(temp, { recursive: true, force: true }); } catch { evidence.cleanup.failures.push('PROFILE_CLEANUP_FAILED'); } }
  evidence.cleanup.status = evidence.cleanup.failures.length ? 'FAIL' : 'PASS';
  await new Promise((resolve, reject) => process.send({ type: 'experiment-evidence', evidence }, error => error ? reject(error) : resolve()));
  process.disconnect();
}
