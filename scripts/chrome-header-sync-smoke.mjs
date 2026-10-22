#!/usr/bin/env node
// 实际dist升级/语言头验证，仅临时profile、合成数据和映射到loopback的测试域。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkerReader } from '../experiments/userscripts-document-start/worker-reader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const coldRestart = args.at(-1) === '--cold-restart';
if (coldRestart) args.pop();
assert.ok(args.length === 2 && args[0] === '--output', '参数：--output <脱敏JSON> [--cold-restart]');
const output = resolve(args[1]);
const evidence = { task: 'VG-032', result: 'BLOCKED', chrome: null, checks: {}, observations: {},
  environment: { realChrome: true, temporaryProfile: true, personalProfileAccessed: false, network: 'loopback fixtures only' },
  limitations: ['仅当前Chrome的HTTP loopback实测，不代表Chrome138、其他OS或真实TLS站点', '合成旧包预置已确认历史规则，未声称覆盖所有历史发布包',
    coldRestart ? '进程重启后显式重载测试包并唤醒，不作为普通用户profile自动加载或Allow User Scripts开关持久性验收' : '未执行整个Chrome进程重启，不作为普通用户profile自动加载或Allow User Scripts开关持久性验收；额外尝试的阻塞证据单独保留',
    '页面和DNR不是原子事务，只验同步确认后新文档/完整重载', 'Worker语言仍原生，其他扩展的请求头改写未覆盖'], cleanup: 'UNKNOWN' };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(70); }
  throw new Error('OBSERVATION_TIMEOUT');
}
let phase = 'prepare', temporary, browser, ws, server;
let sequence = 0, port, extensionId, options, paused = [], workerReader;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT:' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
async function evaluate(target, expression) {
  const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target.sessionId);
  if (value.exceptionDetails) throw new Error('EXPRESSION_FAILED:' + (value.exceptionDetails.exception?.description || '').split('\n')[0]);
  return value.result.value;
}
async function attach(targetId) { return { targetId, ...await send('Target.attachToTarget', { targetId, flatten: true }) }; }
async function page(url) {
  const target = await attach((await send('Target.createTarget', { url: 'about:blank' })).targetId);
  await send('Page.enable', {}, target.sessionId);
  await send('Page.navigate', { url }, target.sessionId);
  await until(() => evaluate(target, `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`));
  return target;
}
const origin = host => `http://${host}:${port}`;
async function sample(host, frames = false) {
  const target = await page(origin(host) + '/probe' + (frames ? '?frames=1' : ''));
  const value = await until(() => evaluate(target, 'globalThis.snapshot || null'), value => value?.same && value?.cross);
  if (frames) value.frames = await until(() => evaluate(target, 'globalThis.framesSeen || {}'), value => Object.keys(value).length === 2);
  await send('Target.closeTarget', { targetId: target.targetId });
  return value;
}
async function worker(version) {
  workerReader ||= createWorkerReader({ send }, `chrome-extension://${extensionId}/`);
  return (await workerReader.read('true', version)).worker;
}
async function message(request) { return evaluate(options, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')'); }
const managed = rules => rules.filter(rule => rule.id >= 40000 && rule.id <= 49999);
function assertSample(value, language, languages, header) {
  assert.equal(value.language, language); assert.deepEqual(value.languages, languages);
  assert.equal(value.navigation, header); assert.equal(value.same, header); assert.equal(value.cross, header);
}
async function connect(profile) {
  workerReader = null;
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  assert.ok(chrome, 'CHROME_NOT_FOUND');
  browser = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--host-resolver-rules=MAP *.vg.test 127.0.0.1', '--no-proxy-server',
    '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const debugPort = await until(async () => {
    if (browser.exitCode !== null) throw new Error('CHROME_EXITED');
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  });
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json();
  evidence.chrome = version.Browser;
  ws = new WebSocket(version.webSocketDebuggerUrl); await once(ws, 'open');
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Target.attachedToTarget' && message.params.waitingForDebugger) paused.push(message.params);
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), { cdpCode: message.error.code, protocolMethod: request.method })); else request.resolve(message.result);
  });
}

try {
  temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-header-sync-'));
  const staged = join(temporary, 'extension'), profile = join(temporary, 'profile');
  await mkdir(join(staged, 'background'), { recursive: true });
  const manifest = { manifest_version: 3, name: 'Synthetic historical header fixture', version: '1.0.0',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'], host_permissions: ['<all_urls>'],
    background: { service_worker: 'background/service-worker.js', type: 'module' } };
  await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(staged, 'background/service-worker.js'), 'chrome.runtime.onMessage.addListener(() => false);');
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    const header = request.headers['accept-language'] || '';
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/echo') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ header })); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script>'
      + 'globalThis.framesSeen={};addEventListener("message",e=>{if(e.data?.fixture)framesSeen[e.data.host]=e.data.value});'
      + 'const first={language:navigator.language,languages:Array.from(navigator.languages),navigation:' + JSON.stringify(header) + '};'
      + 'Promise.all([fetch("/echo",{credentials:"omit"}).then(r=>r.json()),fetch(' + JSON.stringify(origin('cdn.vg.test') + '/echo')
      + ',{credentials:"omit"}).then(r=>r.json())]).then(([a,b])=>{globalThis.snapshot={...first,same:a.header,cross:b.header};'
      + 'if(parent!==window)parent.postMessage({fixture:true,host:location.hostname,value:snapshot},"*")});</script>'
      + (url.searchParams.has('frames') ? '<iframe src="' + origin('jp.site.vg.test') + '/probe"></iframe><iframe src="' + origin('native.site.vg.test') + '/probe"></iframe>' : ''));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
  await connect(profile);
  const native = await sample('outside.vg.test');
  evidence.observations.native = native;
  const legacyHeader = 'zh-CN,zh;q=0.7';
  assert.notEqual(legacyHeader, native.navigation, '旧头必须与原生对照不同，才能证明迁移隔离');
  extensionId = (await send('Extensions.loadUnpacked', { path: staged })).id;
  // 合成旧包没有userScripts权限，不能使用要求该API的生产worker-reader。
  const oldTarget = await until(async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)));
  let background = await attach(oldTarget.targetId);
  await send('Runtime.enable', {}, background.sessionId);
  await until(() => evaluate(background, 'typeof globalThis.chrome?.runtime?.getManifest === "function" && chrome.runtime.getManifest().version === "1.0.0" && typeof chrome.storage?.local?.set === "function" && typeof chrome.declarativeNetRequest?.getDynamicRules === "function"'));
  const config = { schemaVersion: 2, masterEnabled: true, rules: [{ id: 'parent', domain: 'site.vg.test', enabled: true }],
    globalProfile: { language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja', 'en'], acceptLanguage: 'obsolete' },
      timezone: { enabled: false }, geolocation: { enabled: false } }, webRtc: { globalMode: 'default' } };
  const legacyRules = [1001, 1100, 2099].map(id => ({ id, priority: 1, condition: { urlFilter: '|http', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'accept-language', operation: 'set', value: legacyHeader }] } }));
  const foreign = { id: 2100, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'never-hit.synthetic.invalid' } };
  phase = 'seed-historical-rules';
  await evaluate(background, `chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(config)},legacyDnrCleanupV3Complete:true})`);
  await evaluate(background, `chrome.declarativeNetRequest.updateDynamicRules({addRules:${JSON.stringify([...legacyRules, foreign])}})`);
  await evaluate(background, `chrome.declarativeNetRequest.updateSessionRules({addRules:[${JSON.stringify({ ...legacyRules[0], id: 1002 })}]})`);
  const historical = await sample('outside.vg.test');
  assertSample(historical, native.language, native.languages, legacyHeader);
  evidence.observations.historical = historical;
  evidence.checks.historicalRulesWereActive = true;
  phase = 'permission-removal';
  manifest.permissions = ['storage']; manifest.version = '1.1.0';
  await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest));
  assert.equal((await send('Extensions.loadUnpacked', { path: staged })).id, extensionId);
  assertSample(await sample('outside.vg.test'), native.language, native.languages, native.navigation);
  evidence.checks.noDnrIntermediateNative = true;
  phase = 'restore-permission-with-worker-paused';
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'service_worker', exclude: false }, { exclude: true }] });
  await rm(staged, { recursive: true }); await cp(join(root, 'dist'), staged, { recursive: true });
  const currentManifestBytes = await readFile(join(root, 'dist/manifest.json'));
  assert.equal((await send('Extensions.loadUnpacked', { path: staged })).id, extensionId);
  const held = await until(() => paused.find(item => item.targetInfo.url.startsWith(`chrome-extension://${extensionId}/`)));
  options = await page(`chrome-extension://${extensionId}/options/options.html`);
  const initial = await evaluate(options, 'Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getEnabledRulesets()])');
  assert.deepEqual(initial[0].filter(rule => [1001, 1100, 2099].includes(rule.id)).map(rule => rule.id).sort(), [1001, 1100, 2099]);
  assert.ok(initial[1].includes('header_migration_guard'));
  const quarantined = await sample('site.vg.test', true);
  assertSample(quarantined, native.language, native.languages, native.navigation);
  for (const frame of Object.values(quarantined.frames)) assertSample(frame, native.language, native.languages, native.navigation);
  assertSample(await sample('outside.vg.test'), native.language, native.languages, native.navigation);
  evidence.checks.preCleanupStaticQuarantine = true;
  evidence.observations.preCleanup = { workerPausedBeforeExecution: true, legacyDynamicCount: 3, guardEnabled: true, observed: quarantined };
  await send('Runtime.runIfWaitingForDebugger', {}, held.sessionId);
  await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
  phase = 'migration-complete';
  const state = await until(() => message({ action: 'getSiteConfig' }), value => value?.config?.schemaVersion === 3);
  const migrated = await evaluate(options, 'chrome.declarativeNetRequest.getDynamicRules()');
  assert.deepEqual(migrated.map(rule => rule.id), [2100]);
  assert.equal('acceptLanguage' in state.config.globalProfile.language, false);
  evidence.checks.migrationReadsActualRulesDespiteOldMarker = true;
  phase = 'normal-allow-user-scripts';
  const details = await page('chrome://extensions/?id=' + extensionId);
  const toggle = '(()=>{const find=r=>{for(const n of r.querySelectorAll("*")){if(n.id==="allow-user-scripts")return n;if(n.shadowRoot){const t=find(n.shadowRoot);if(t)return t}}};const t=find(document)?.shadowRoot?.querySelector("cr-toggle");if(!t)return null;t.scrollIntoView({block:"center"});const r=t.getBoundingClientRect();return {checked:t.checked,disabled:t.disabled,x:r.x+r.width/2,y:r.y+r.height/2}})()';
  const before = await until(() => evaluate(details, toggle)); assert.equal(before.disabled, false);
  evidence.observations.allowToggleBefore = before;
  phase = 'normal-user-scripts-click';
  if (!before.checked) {
    await send('Target.activateTarget', { targetId: details.targetId });
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: before.x, y: before.y, button: 'left', clickCount: 1 }, details.sessionId);
  }
  await until(() => evaluate(details, toggle), value => value?.checked === true);
  await send('Target.closeTarget', { targetId: details.targetId });
  evidence.checks.normalAllowUserScripts = true;
  const selected = state.config;
  const rule = (domain, language) => ({ id: domain, domain, enabled: true, exitLocationProfileId: null,
    overrides: { language: language === null ? { mode: 'disable', value: null } : language ? { mode: 'override', value: { enabled: true, language, languages: [language, language.split('-')[0]] } } : { mode: 'inherit', value: null },
      timezone: { mode: 'inherit', value: null }, geolocation: { mode: 'inherit', value: null } } });
  selected.rules = [rule('site.vg.test'), rule('jp.site.vg.test', 'fr-FR'), rule('native.site.vg.test', null)];
  phase = 'sync-and-request-scope';
  const saved = await message({ action: 'setSiteConfig', config: selected });
  assert.equal(saved.syncReport.components.headers.status, 'ok'); assert.equal(saved.syncReport.pageRuntime.state, 'ready');
  const value = await sample('site.vg.test', true);
  assertSample(value, 'ja-JP', ['ja-JP', 'ja', 'en'], 'ja-JP,ja;q=0.9,en;q=0.8');
  assertSample(value.frames['jp.site.vg.test'], 'fr-FR', ['fr-FR', 'fr'], 'fr-FR,fr;q=0.9');
  assertSample(value.frames['native.site.vg.test'], native.language, native.languages, native.navigation);
  assertSample(await sample('outside.vg.test'), native.language, native.languages, native.navigation);
  evidence.checks.navigationIframeCrossOriginResourcesAndExclusions = true;
  evidence.observations.synced = value;
  phase = 'change-and-disable';
  const oldDocument = await page(origin('site.vg.test') + '/probe');
  await until(() => evaluate(oldDocument, 'globalThis.snapshot || null'), value => value?.same);
  selected.globalProfile.language = { enabled: true, mode: 'custom', language: 'de-DE', languages: ['de-DE', 'de', 'en'] };
  const changed = await message({ action: 'setSiteConfig', config: selected });
  assert.equal(changed.syncReport.components.headers.status, 'ok');
  assert.equal(changed.syncReport.pageRuntime.reloadRequired, true);
  const snapshotBoundary = await evaluate(oldDocument, '(async()=>({language:navigator.language,header:(await fetch("/echo").then(r=>r.json())).header}))()');
  assert.deepEqual(snapshotBoundary, { language: 'ja-JP', header: 'de-DE,de;q=0.9,en;q=0.8' });
  await send('Page.reload', { ignoreCache: true }, oldDocument.sessionId);
  await until(() => evaluate(oldDocument, 'globalThis.snapshot || null'), value => value?.language === 'de-DE');
  await send('Target.closeTarget', { targetId: oldDocument.targetId });
  evidence.checks.oldDocumentSnapshotAndReload = true;
  assertSample(await sample('site.vg.test'), 'de-DE', ['de-DE', 'de', 'en'], 'de-DE,de;q=0.9,en;q=0.8');
  await message({ action: 'setExtensionEnabled', enabled: false });
  assertSample(await sample('site.vg.test'), native.language, native.languages, native.navigation);
  await message({ action: 'setExtensionEnabled', enabled: true });
  evidence.checks.languageChangeAndDisableNative = true;
  phase = 'localhost-scope';
  selected.rules.push(rule('localhost'), rule('native.localhost', null));
  await message({ action: 'setSiteConfig', config: selected });
  for (const host of ['localhost', 'sub.localhost']) assertSample(await sample(host), 'de-DE', ['de-DE', 'de', 'en'], 'de-DE,de;q=0.9,en;q=0.8');
  assertSample(await sample('native.localhost'), native.language, native.languages, native.navigation);
  evidence.checks.localhostAndSubdomainsShareResolverScope = true;
  phase = 'legacy-session-cleanup';
  await evaluate(options, 'chrome.declarativeNetRequest.updateEnabledRulesets({enableRulesetIds:["header_migration_guard"]})');
  await evaluate(options, `chrome.declarativeNetRequest.updateSessionRules({addRules:${JSON.stringify([1002, 30000, 39999].map(id => ({ ...legacyRules[0], id })))}})`);
  assert.equal((await message({ action: 'reconcileRuntime' })).syncReport.components.headers.status, 'ok');
  assert.equal((await evaluate(options, 'chrome.declarativeNetRequest.getSessionRules()')).some(rule => [1002, 30000, 39999].includes(rule.id)), false);
  evidence.checks.legacySession1002AndPreviousProjectionCleanedBeforeRelease = true;
  phase = 'worker-stop-recovery';
  const lifecycle = await page('about:blank');
  await send('ServiceWorker.enable', {}, lifecycle.sessionId);
  background = await worker(JSON.parse(currentManifestBytes).version);
  const expected = managed(await evaluate(background, 'chrome.declarativeNetRequest.getDynamicRules()'));
  await evaluate(background, `chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:${JSON.stringify(expected.map(rule => rule.id))}})`);
  await send('Target.closeTarget', { targetId: options.targetId });
  await send('Target.detachFromTarget', { sessionId: background.sessionId });
  await send('ServiceWorker.stopAllWorkers', {}, lifecycle.sessionId);
  await until(async () => !(await send('Target.getTargets')).targetInfos.some(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)));
  await send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${extensionId}/` }, lifecycle.sessionId);
  background = await worker(JSON.parse(currentManifestBytes).version);
  await until(() => evaluate(background, 'chrome.declarativeNetRequest.getDynamicRules()'), rules => managed(rules).length === expected.length);
  assertSample(await sample('site.vg.test'), 'de-DE', ['de-DE', 'de', 'en'], 'de-DE,de;q=0.9,en;q=0.8');
  evidence.checks.workerRecoveryWithoutManagementMessages = true;
  phase = 'extension-update';
  // 先清空会话规则并确认旧worker消失，避免旧调试会话成为更新后的假就绪证据。
  await evaluate(background, `chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:${JSON.stringify(expected.map(rule => rule.id))}})`);
  await send('ServiceWorker.stopAllWorkers', {}, lifecycle.sessionId);
  await until(async () => !(await send('Target.getTargets')).targetInfos.some(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)));
  await workerReader.close(); workerReader = null;
  const updateManifest = JSON.parse(currentManifestBytes); updateManifest.version = '2.1.2';
  await writeFile(join(staged, 'manifest.json'), JSON.stringify(updateManifest));
  assert.equal((await send('Extensions.loadUnpacked', { path: staged })).id, extensionId);
  phase = 'extension-update-worker-version';
  background = await worker(updateManifest.version);
  phase = 'extension-update-rules';
  await until(() => evaluate(background, 'Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getEnabledRulesets()])'),
    ([rules, guards]) => managed(rules).length === expected.length && !guards.includes('header_migration_guard'));
  phase = 'extension-update-new-document';
  assertSample(await sample('site.vg.test'), 'de-DE', ['de-DE', 'de', 'en'], 'de-DE,de;q=0.9,en;q=0.8');
  assert.deepEqual(await readFile(join(root, 'dist/manifest.json')), currentManifestBytes);
  evidence.checks.versionUpdateRecoversWithoutManagementMessages = true;
  if (coldRestart) {
    phase = 'browser-restart';
    const exited = once(browser, 'exit');
    await send('Browser.close'); ws.close(); await exited;
    await rm(join(profile, 'DevToolsActivePort'), { force: true });
    await connect(profile);
    // CDP加载是测试进程级入口；重启后显式重载同一路径，不发送管理消息或重种配置。
    assert.equal((await send('Extensions.loadUnpacked', { path: staged })).id, extensionId);
    const restartDriver = await page('about:blank');
    await send('ServiceWorker.enable', {}, restartDriver.sessionId);
    await send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${extensionId}/` }, restartDriver.sessionId);
    const restartTarget = await until(async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)));
    const restartProbe = await attach(restartTarget.targetId);
    evidence.observations.restart = await evaluate(restartProbe, '({version:chrome.runtime.getManifest().version,userScriptsAvailable:typeof chrome.userScripts?.getScripts === "function",explicitPackageReload:true,explicitWorkerStart:true})');
    if (evidence.observations.restart.userScriptsAvailable) {
      await until(() => evaluate(restartProbe, 'Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getEnabledRulesets()])'),
        ([rules, guards]) => managed(rules).length === expected.length && !guards.includes('header_migration_guard'));
      assertSample(await sample('site.vg.test'), 'de-DE', ['de-DE', 'de', 'en'], 'de-DE,de;q=0.9,en;q=0.8');
      evidence.checks.browserRestartPackageReloadRecoversWithoutManagementMessages = true;
    } else {
      const failedClosed = await until(() => evaluate(restartProbe,
        'Promise.all([chrome.storage.session.get("runtimeSyncMetadata"),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getEnabledRulesets()])'),
        ([storage, rules, guards]) => storage.runtimeSyncMetadata?.report.components.headers?.status === 'failed'
          && managed(rules).length === 0 && guards.includes('header_migration_guard'));
      assert.equal(failedClosed[0].runtimeSyncMetadata.report.pageRuntime.state, 'switch-required');
      assertSample(await sample('site.vg.test'), native.language, native.languages, native.navigation);
      evidence.checks.browserRestartUserScriptsUnavailableFailsClosed = true;
    }
    assert.deepEqual((await evaluate(restartProbe, 'chrome.declarativeNetRequest.getDynamicRules()')).filter(rule => !managed([rule]).length).map(rule => rule.id), [2100]);
    await send('Target.detachFromTarget', { sessionId: restartProbe.sessionId });
  }
  evidence.observations.buildManifestSha256 = createHash('sha256').update(currentManifestBytes).digest('hex');
  evidence.result = 'PASS';
} catch (error) {
  evidence.failure = { phase, type: error.code === 'ERR_ASSERTION' ? 'assertion' : 'automation',
    message: String(error.message).replace(/\/Users\/[^\s:]+/g, '<user-path>').replace(/\/var\/folders\/[^\s]+/g, '<temporary>').replace(/[a-p]{32}/g, '<extension>').slice(0, 350) };
} finally {
  try {
    if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close'); ws.close(); }
    if (browser && browser.exitCode === null && !browser.signalCode) await Promise.race([once(browser, 'exit'), pause(5000)]);
    if (browser && browser.exitCode === null && !browser.signalCode) { browser.kill('SIGKILL'); await once(browser, 'exit'); }
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    evidence.cleanup = 'PASS';
  } catch { evidence.cleanup = 'FAIL'; evidence.result = 'BLOCKED'; }
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('TEST_CLOSED')); }
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ result: evidence.result, chrome: evidence.chrome, checks: evidence.checks, failure: evidence.failure, cleanup: evidence.cleanup }, null, 2));
  process.exitCode = evidence.result === 'PASS' ? 0 : 2;
}
