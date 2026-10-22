#!/usr/bin/env node
// 正常UI安装后的独立profile冷启动；重启后先采HTTP首inline，再只读核验扩展状态。
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import { createWorkerReader } from '../experiments/userscripts-document-start/worker-reader.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const masterOffRestore = args[4] === '--master-off-restore';
const userScriptsOffRestore = args[4] === '--user-scripts-off-restore' || masterOffRestore;
const httpSessionRestore = args[4] === '--http-session-restore' || userScriptsOffRestore;
assert.ok((args.length === 4 || args.length === 5 && httpSessionRestore) && args[0] === '--output' && args[2] === '--ui-signal-dir',
  '参数：--output <脱敏JSON> --ui-signal-dir <本次UI完成信号目录> [--http-session-restore|--user-scripts-off-restore|--master-off-restore]');
const output = resolve(args[1]), uiSignals = resolve(args[3]);
assert.ok(existsSync(uiSignals), 'UI信号目录必须已存在');
const evidence = { task: 'VG-032', scope: masterOffRestore ? 'master-off-then-user-scripts-off-automatic-restore' : userScriptsOffRestore ? 'user-scripts-off-automatic-http-session-restore' : httpSessionRestore ? 'normal-ui-automatic-http-session-restore' : 'normal-ui-language-header-cold-start', result: 'BLOCKED', chrome: null,
  environment: { headed: true, temporaryProfile: true, personalProfileAccessed: false, fixtureTraffic: 'HTTP loopback only' },
  checks: {}, coldStarts: [], cleanup: 'UNKNOWN',
  limitations: ['仅当前Chrome、当前OS和HTTP loopback，不代表Chrome138、其他OS或真实TLS站点',
    httpSessionRestore ? '仅正常退出、一个活动HTTP顶层标签自动恢复；不代表多窗口、后台延迟标签、崩溃恢复或全部启动交错'
      : '重启启动页为about:blank；首HTTP探针在CDP连接后创建，不代表自动恢复旧HTTP标签的最早启动时序',
    userScriptsOffRestore ? '关闭开关后的首请求为严格验收项；未调用管理同步，不插桩生产API'
      : httpSessionRestore ? '两轮正常恢复均不插桩；中断和开关变化负例沿用独立冷启动证据，不在本模式重复'
      : '正常冷启动两轮不插桩；中断负例仅临时阻塞worker的规则提交API，包内文件不改写',
    '开关关闭后的首请求不一致会判FAIL，后台后续恢复不替代首请求验收',
    '不检查个人profile；Chrome自身后台网络未全量监控；Worker/SharedWorker的JavaScript语言仍原生'] };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(75); }
  throw new Error('OBSERVATION_TIMEOUT');
}
async function fingerprint(directory) {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && entry.name === '_metadata') continue; // Chrome生成的DNR索引，不是dist维护资产。
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else { hash.update(path); hash.update(await readFile(join(directory, path))); }
    }
  }
  await visit(); return hash.digest('hex');
}
let phase = 'prepare', temporary, browser, socket, server, port, extensionId, sequence = 0, probe = 0;
const pending = new Map();
const deliveries = [], firstReports = new Map();
const origin = host => `http://${host}:${port}`;
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT:' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
async function evaluate(target, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target.sessionId);
  if (result.exceptionDetails) throw new Error('EXPRESSION_FAILED:' + (result.exceptionDetails.exception?.description || '').split('\n')[0]);
  return result.result.value;
}
async function page(url) {
  const targetId = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const target = { targetId, ...await send('Target.attachToTarget', { targetId, flatten: true }) };
  await send('Page.enable', {}, target.sessionId);
  await send('Page.navigate', { url }, target.sessionId);
  await until(() => evaluate(target, `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`));
  return target;
}
async function sample(host, frames = false) {
  const target = await page(origin(host) + '/probe-' + ++probe + (frames ? '?frames=1' : ''));
  const value = await until(() => evaluate(target, 'globalThis.snapshot || null'), value => value?.same && value?.cross);
  if (frames) value.frames = await until(() => evaluate(target, 'globalThis.framesSeen || {}'), value => Object.keys(value).length === 2);
  await send('Target.closeTarget', { targetId: target.targetId });
  return value;
}
function assertSample(value, language, languages, header) {
  assert.equal(value.firstInline, true); assert.equal(value.language, language); assert.deepEqual(value.languages, languages);
  assert.equal(value.navigation, header); assert.equal(value.same, header); assert.equal(value.cross, header);
}
function matchesSample(value, language, languages, header) {
  return value.firstInline === true && value.language === language && isDeepStrictEqual(value.languages, languages)
    && value.navigation === header && value.same === header && value.cross === header;
}
const managed = rules => rules.filter(rule => rule.id >= 40000 && rule.id <= 49999);
async function readExistingWorkerState(version) {
  const target = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker'
    && target.url.startsWith(`chrome-extension://${extensionId}/`));
  if (!target) return null;
  const attached = { ...await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }) };
  try {
    await send('Runtime.enable', {}, attached.sessionId);
    return await evaluate(attached, `(async()=>{ const c=globalThis.chrome;
      if(typeof c?.runtime?.getManifest!=='function'||c.runtime.getManifest().version!==${JSON.stringify(version)})return null;
      const [session,dynamic,guards,metadata,local]=await Promise.all([c.declarativeNetRequest.getSessionRules(),c.declarativeNetRequest.getDynamicRules(),c.declarativeNetRequest.getEnabledRulesets(),c.storage.session.get('runtimeSyncMetadata'),c.storage.local.get('siteSpoofConfig')]);
      let scripts=null,userScriptsReadError=null;const userScriptsAvailable=typeof c.userScripts?.getScripts==='function';
      if(userScriptsAvailable)try{scripts=await c.userScripts.getScripts();}catch(error){userScriptsReadError=error.message;}
      return {sessionRuleIds:session.map(r=>r.id),dynamicRuleIds:dynamic.map(r=>r.id),guards,headers:metadata.runtimeSyncMetadata?.report.components.headers||null,
        pageRuntime:metadata.runtimeSyncMetadata?.report.pageRuntime||null,config:local.siteSpoofConfig,userScriptsAvailable,userScriptsReadError,languageScriptCount:scripts?.length??null};})()`);
  } finally { await send('Target.detachFromTarget', { sessionId: attached.sessionId }); }
}
async function waitForUi(name) {
  console.log('VG032_NATIVE_UI_REQUIRED ' + name);
  await until(() => existsSync(join(uiSignals, name)), Boolean, 240000);
}
async function launch(profile, beforeConnect) {
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  assert.ok(chrome, 'CHROME_NOT_FOUND');
  const spawnedAt = Date.now();
  browser = spawn(chrome, ['--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP *.vg.test 127.0.0.1', '--no-proxy-server', '--disable-background-networking',
    '--disable-component-update', '--no-first-run', '--no-default-browser-check', ...(beforeConnect ? [] : ['about:blank'])], { stdio: 'ignore' });
  // 自动恢复的首请求与首inline报告必须在任何CDP连接、目标枚举或调试附着之前取得。
  if (beforeConnect) await beforeConnect(spawnedAt);
  const debugPort = await until(async () => {
    if (browser.exitCode !== null) throw new Error('CHROME_EXITED');
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  });
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json();
  if (evidence.chrome) assert.equal(version.Browser, evidence.chrome); else evidence.chrome = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), { cdpCode: message.error.code }));
    else request.resolve(message.result);
  });
}
async function closeCompletely(profile) {
  // 只追踪本次独立Chrome进程树，不退出或读取个人Chrome配置。
  const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=']);
  const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([browser.pid]);
  let count;
  do { count = owned.size; for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid); } while (owned.size !== count);
  const exited = once(browser, 'exit'); await send('Browser.close'); socket.close();
  const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
  await until(() => [...owned].every(pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') throw error; return true; } }));
  await rm(join(profile, 'DevToolsActivePort'), { force: true });
  return { gracefulExit: true, mainProcessExited: true, observedProcessTreeExited: true, observedProcessCount: owned.size };
}
try {
  temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-header-cold-'));
  const profile = join(temporary, 'profile'), dist = join(root, 'dist');
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  const original = await fingerprint(dist);
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture'), header = request.headers['accept-language'] || '';
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'POST' && url.pathname === '/__vg032_first_inline') {
      let body = '';
      request.on('data', chunk => { body += chunk; if (body.length > 8192) request.destroy(); });
      request.on('end', () => {
        try {
          const report = JSON.parse(body), delivery = deliveries.find(row => row.nonce === report.nonce);
          assert.ok(delivery && report.host === delivery.host && report.path === delivery.path);
          assert.equal(report.navigation, delivery.navigation);
          assert.ok(!firstReports.has(report.nonce), '每份新HTTP响应只接收一次首inline报告');
          firstReports.set(report.nonce, { ...report, receivedAt: Date.now() });
          response.writeHead(204); response.end();
        } catch { response.writeHead(400); response.end(); }
      }); return;
    }
    if (url.pathname === '/echo') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ header })); return; }
    const nonce = randomUUID();
    deliveries.push({ nonce, host: request.headers.host.split(':')[0], path: url.pathname, navigation: header, receivedAt: Date.now() });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script>'
      + 'globalThis.framesSeen={};addEventListener("message",e=>{if(e.data?.fixture)framesSeen[e.data.host]=e.data.value});'
      + 'const first={firstInline:true,language:navigator.language,languages:Array.from(navigator.languages),navigation:' + JSON.stringify(header) + '};'
      + 'globalThis.deliveryNonce=' + JSON.stringify(nonce) + ';'
      + (httpSessionRestore ? 'fetch("/__vg032_first_inline",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({...first,nonce:deliveryNonce,host:location.hostname,path:location.pathname})});' : '')
      + 'Promise.all([fetch("/echo",{credentials:"omit"}).then(r=>r.json()),fetch(' + JSON.stringify(origin('cdn.vg.test') + '/echo')
      + ',{credentials:"omit"}).then(r=>r.json())]).then(([a,b])=>{globalThis.snapshot={...first,same:a.header,cross:b.header};'
      + 'if(parent!==window)parent.postMessage({fixture:true,host:location.hostname,value:snapshot},"*")});</script>'
      + (url.searchParams.has('frames') ? '<iframe src="' + origin('fr.site.vg.test') + '/child"></iframe><iframe src="' + origin('native.site.vg.test') + '/child"></iframe>' : ''));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
  await launch(profile);
  const native = await sample('outside.vg.test'); evidence.native = native;
  const identity = await page('about:blank');
  const marker = 'VG032-COLD-' + randomUUID().slice(0, 8);
  await evaluate(identity, 'document.title=' + JSON.stringify(marker));
  const installer = await page('chrome://extensions/');
  const card = `(() => { const visit=root=>{ for(const element of root.querySelectorAll('*')) {
    if(element.tagName==='EXTENSIONS-ITEM' && element.data?.name==='VanishGeo') return element.data;
    if(element.shadowRoot){const found=visit(element.shadowRoot);if(found)return found;}
  }};const item=visit(document);return item?{id:item.id,path:item.path,state:item.state,location:item.location}:null;})()`;
  assert.equal(await evaluate(installer, card), null);
  console.log('VG032_INSTALL_WINDOW ' + marker);
  phase = 'normal-ui-install'; await waitForUi('install-complete');
  const installed = await until(() => evaluate(installer, card));
  assert.equal(installed.path, dist); assert.equal(installed.location, 'UNPACKED'); assert.equal(installed.state, 'ENABLED');
  extensionId = installed.id;
  evidence.install = { method: 'normal-extension-manager-native-folder-picker', currentDistPathConfirmed: true,
    noPriorCard: true, cdpLoadUnpackedUsed: false, preferenceFilesWritten: false, extensionLoadFlagsUsed: false };
  evidence.checks.normalUiInstallCurrentDist = true;
  const details = await page('chrome://extensions/?id=' + extensionId);
  phase = 'normal-allow-user-scripts'; await waitForUi('user-scripts-complete');
  const userScriptsSwitch = `(() => { const visit=root=>{for(const element of root.querySelectorAll('*')) {
    if(element.id==='allow-user-scripts')return element.shadowRoot?.querySelector('cr-toggle')?.checked===true;
    if(element.shadowRoot){const result=visit(element.shadowRoot);if(result!==undefined)return result;}
  }};return visit(document)===true;})()`;
  assert.equal(await evaluate(details, userScriptsSwitch), true); evidence.checks.normalAllowUserScriptsEnabled = true;
  const options = await page(`chrome-extension://${extensionId}/options/options.html`);
  const message = async request => {
    const response = await evaluate(options, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')');
    assert.ok(response && response.status !== 'error', '管理消息必须成功'); return response;
  };
  const config = (await message({ action: 'getSiteConfig' })).config;
  config.masterEnabled = true; config.globalProfile.language = { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja', 'en'] };
  config.globalProfile.timezone.enabled = false; config.globalProfile.geolocation.enabled = false; config.fontExposure.enabled = false;
  config.rules = [{ id: 'parent', domain: 'site.vg.test', enabled: true },
    { id: 'fr', domain: 'fr.site.vg.test', enabled: true, overrides: { language: { mode: 'override', value: { enabled: true, language: 'fr-FR', languages: ['fr-FR', 'fr'] } } } },
    { id: 'native', domain: 'native.site.vg.test', enabled: true, overrides: { language: { mode: 'disable', value: null } } }];
  phase = 'baseline-save';
  const saved = await message({ action: 'setSiteConfig', config });
  assert.equal(saved.syncReport.components.headers.status, 'ok'); assert.equal(saved.syncReport.pageRuntime.state, 'ready');
  let expectedConfig = saved.config;
  const baseline = await sample('site.vg.test', true);
  assertSample(baseline, 'ja-JP', ['ja-JP', 'ja', 'en'], 'ja-JP,ja;q=0.9,en;q=0.8');
  evidence.baseline = baseline; evidence.checks.preRestartLanguageAndHeader = true;
  for (const target of [options, details, installer, identity]) await send('Target.closeTarget', { targetId: target.targetId });
  for (const target of (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page'
    && target.url.startsWith(`chrome-extension://${extensionId}/`))) await send('Target.closeTarget', { targetId: target.targetId });
  const manage = async request => {
    const control = await page(`chrome-extension://${extensionId}/options/options.html`);
    try {
      const response = await evaluate(control, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')');
      assert.ok(response && response.status !== 'error', '管理消息必须成功'); return response;
    } finally { await send('Target.closeTarget', { targetId: control.targetId }); }
  };
  const summarize = ({config,...state})=>({...state,storedConfigUnchanged:isDeepStrictEqual(config,expectedConfig)});
  if (httpSessionRestore) {
    phase = 'normal-ui-session-restore-setting';
    const startup = await page('chrome://settings/onStartup');
    await waitForUi('session-restore-setting-complete');
    // UI操作后只读实际偏好值；不写Preferences、不用强制恢复启动参数。
    const setting = await evaluate(startup, `(() => {const visit=root=>{for(const element of root.querySelectorAll('*')) {
      if(element.tagName==='SETTINGS-ON-STARTUP-PAGE')return element.prefs?.session?.restore_on_startup?.value;
      if(element.shadowRoot){const value=visit(element.shadowRoot);if(value!==undefined)return value;}
    }};return visit(document);})()`);
    assert.equal(setting, 1, '正常设置必须为继续浏览上次打开的网页');
    evidence.sessionRestoreSetting = { method: 'native-settings-on-startup', continueWhereLeftOffVisiblyConfirmed: true,
      actualPreferenceValue: setting, preferenceFileWrittenByRunner: false, forcedRestoreFlag: false };
    evidence.checks.normalContinueWhereLeftOffEnabled = true;
    await send('Target.closeTarget', { targetId: startup.targetId });
  }
  for (const kind of userScriptsOffRestore ? [] : ['normal-clean-exit', 'changed-language-clean-exit']) {
    const row = { kind, observationOrder: [] }; evidence.coldStarts.push(row);
    const german = kind === 'changed-language-clean-exit';
    const language = german ? 'de-DE' : 'ja-JP', languages = german ? ['de-DE','de','en'] : ['ja-JP','ja','en'];
    const header = german ? 'de-DE,de;q=0.9,en;q=0.8' : 'ja-JP,ja;q=0.9,en;q=0.8';
    if (german) {
      phase = 'change-language-before-second-exit';
      config.globalProfile.language = { enabled: true, mode: 'custom', language, languages };
      const changed = await manage({ action: 'setSiteConfig', config });
      assert.equal(changed.syncReport.components.headers.status, 'ok'); expectedConfig = changed.config;
    }
    let restoreUrl, oldNonce, restorePath;
    if (httpSessionRestore) {
      restorePath = '/restore-' + kind; restoreUrl = origin('site.vg.test') + restorePath + '?frames=1';
      const retained = await page(restoreUrl); oldNonce = await evaluate(retained, 'deliveryNonce');
      await until(() => firstReports.get(oldNonce));
      await send('Target.activateTarget', { targetId: retained.targetId });
      for (const target of (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.targetId !== retained.targetId)) {
        await send('Target.closeTarget', { targetId: target.targetId });
      }
      const remaining = (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page');
      assert.equal(remaining.length, 1); assert.equal(remaining[0].url, restoreUrl);
      row.onlyActiveHttpTabRetainedBeforeExit = true; row.managementPagesClosedBeforeExit = true;
    }
    phase = 'complete-browser-exit-' + kind; row.exit = await closeCompletely(profile);
    row.observationOrder.push('previous-process-tree-exited');
    let earlyDelivery;
    phase = 'cold-launch-' + kind;
    await launch(profile, httpSessionRestore ? async spawnedAt => {
      row.observationOrder.push('new-process-spawned-without-startup-url');
      // 取重启后该路径的第一份响应，不能跳过失败文档而选择后续重试。
      earlyDelivery = await until(() => deliveries.find(value => value.host === 'site.vg.test'
        && value.path === restorePath && value.receivedAt >= spawnedAt && value.nonce !== oldNonce), Boolean, 30000);
      const first = await until(() => firstReports.get(earlyDelivery.nonce), Boolean, 30000);
      const { nonce, host, path, receivedAt, ...values } = first;
      row.earlyFirstInlineReport = { ...values, freshHttpResponseConfirmed: true, actualServerNavigationHeader: earlyDelivery.navigation,
        navigationReceivedAfterSpawnMs: earlyDelivery.receivedAt - spawnedAt, reportReceivedAfterSpawnMs: receivedAt - spawnedAt,
        receivedBeforeCdpConnection: true, receivedAfterNewProcessSpawn: true };
      row.observationOrder.push('first-restored-navigation-and-inline-report-received-before-cdp');
      row.noStartupUrlOrForcedRestoreFlag = true; row.noTargetCreatedOrNavigatedBeforeFirstReport = true;
      row.noDebuggerAttachOrPauseBeforeFirstReport = true;
    } : undefined);
    row.observationOrder.push('new-process-connected');
    phase = 'cold-first-http-' + kind;
    if (httpSessionRestore) {
      const targets = (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page');
      assert.equal(targets.length, 1); assert.equal(targets[0].url, restoreUrl);
      const restored = { targetId: targets[0].targetId, ...await send('Target.attachToTarget', { targetId: targets[0].targetId, flatten: true }) };
      row.first = await until(() => evaluate(restored, 'globalThis.snapshot || null'), value => value?.same && value?.cross);
      row.first.frames = await until(() => evaluate(restored, 'globalThis.framesSeen || {}'), value => Object.keys(value).length === 2);
      assert.equal(await evaluate(restored, 'deliveryNonce'), earlyDelivery.nonce);
      assert.deepEqual(row.earlyFirstInlineReport.languages, row.first.languages);
      assert.equal(row.earlyFirstInlineReport.language, row.first.language);
      assert.equal(row.earlyFirstInlineReport.navigation, row.first.navigation);
      assert.equal(deliveries.filter(value => value.host === 'site.vg.test' && value.path === restorePath && value.nonce !== oldNonce).length, 1);
      row.automaticallyRestoredExistingDocumentConfirmed = true;
      row.singleFreshTopLevelResponseConfirmed = true;
      row.observationOrder.push('restored-existing-target-confirmed-with-same-response-nonce');
      await send('Target.detachFromTarget', { sessionId: restored.sessionId });
    } else row.first = await sample('site.vg.test', true);
    row.outside = await sample('outside.vg.test'); assertSample(row.outside, native.language, native.languages, native.navigation);
    row.firstConsistent = matchesSample(row.first, language, languages, header)
      && matchesSample(row.first.frames['fr.site.vg.test'], 'fr-FR', ['fr-FR', 'fr'], 'fr-FR,fr;q=0.9')
      && matchesSample(row.first.frames['native.site.vg.test'], native.language, native.languages, native.navigation);
    evidence.checks[german ? 'changedLanguageColdFirstRequestsConsistent' : 'normalColdFirstRequestsConsistent'] = row.firstConsistent;
    row.observationOrder.push('read-only-worker-inspection-after-http-probes');
    phase = 'cold-read-only-rules-' + kind;
    row.initialWorkerState = summarize(await until(() => readExistingWorkerState(manifest.version)));
    const settled = await until(() => readExistingWorkerState(manifest.version), state => state?.dynamicRuleIds.filter(id=>id>=40000&&id<=49999).length===4
      && !state.guards.length && state.headers?.status==='ok');
    row.recovered = summarize(settled);
    assert.deepEqual(settled.sessionRuleIds, []); assert.equal(settled.dynamicRuleIds.length, 4);
    assert.deepEqual(settled.config, expectedConfig); assert.equal(settled.languageScriptCount, 2);
    assert.equal(settled.userScriptsAvailable, true);
    row.afterRecovery = await sample('site.vg.test', true); assertSample(row.afterRecovery, language, languages, header);
    row.managementMessagesAfterRestart = 0; row.explicitExtensionReloadAfterRestart = false; row.explicitWorkerStartAfterRestart = false;
    evidence.checks[german ? 'changedLanguageColdProjectionPreserved' : 'normalColdProjectionPreserved'] = true;
  }
  if (httpSessionRestore && !userScriptsOffRestore) {
    evidence.checks.bothAutomaticRestorationsObservedBeforeCdp = evidence.coldStarts.every(row => row.earlyFirstInlineReport.receivedBeforeCdpConnection
      && row.automaticallyRestoredExistingDocumentConfirmed && row.singleFreshTopLevelResponseConfirmed);
  } else {
  if (!userScriptsOffRestore) {
  // 仅本负例临时阻塞worker的规则提交；包内文件仍不改写，正常冷启动两轮均已先完成。
  phase = 'interrupt-config-after-durable-write';
  const reader = createWorkerReader({ send }, `chrome-extension://${extensionId}/`);
  const current = await reader.read('true', manifest.version);
  await evaluate(current.worker, `globalThis.vgHeaderWriteHeld=false;
    chrome.declarativeNetRequest.updateDynamicRules=async()=>{globalThis.vgHeaderWriteHeld=true;await new Promise(()=>{});};true`);
  const interruptedControl = await page(`chrome-extension://${extensionId}/options/options.html`);
  await evaluate(interruptedControl, `globalThis.interruptedSave=chrome.runtime.sendMessage({action:'setExtensionEnabled',enabled:false});globalThis.interruptedSave.catch(()=>{});true`);
  await until(() => evaluate(current.worker, 'globalThis.vgHeaderWriteHeld===true'));
  const beforeExit = await evaluate(interruptedControl, `Promise.all([chrome.storage.local.get('siteSpoofConfig'),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getEnabledRulesets()])`);
  assert.equal(beforeExit[0].siteSpoofConfig.masterEnabled, false); assert.equal(managed(beforeExit[1]).length, 4);
  assert.ok(beforeExit[2].includes('header_migration_guard'));
  expectedConfig = beforeExit[0].siteSpoofConfig;
  const interrupted = { injection: 'temporary-worker-rule-update-promise-held', configDisabledBeforeExit: true,
    oldProjectionPresentBeforeExit: true, persistentGuardConfirmedBeforeExit: true };
  evidence.interruptedTransaction = interrupted;
  await reader.close(); await send('Target.closeTarget', { targetId: interruptedControl.targetId });
  interrupted.exit = await closeCompletely(profile); await launch(profile);
  phase = 'interrupted-cold-first-http'; interrupted.first = await sample('site.vg.test', true);
  for (const value of [interrupted.first,...Object.values(interrupted.first.frames)]) {
    assert.equal(value.navigation, native.navigation); assert.equal(value.same, native.same); assert.equal(value.cross, native.cross);
  }
  phase = 'interrupted-cold-read-only-recovery';
  const disabled = await until(() => readExistingWorkerState(manifest.version), state => state?.dynamicRuleIds.length===0
    && !state.guards.length && state.headers?.status==='ok' && state.pageRuntime?.state==='disabled');
  assert.deepEqual(disabled.config, expectedConfig); interrupted.recovered = summarize(disabled);
  interrupted.afterRecovery = await sample('site.vg.test');
  assertSample(interrupted.afterRecovery, native.language, native.languages, native.navigation);
  interrupted.managementMessagesAfterRestart = 0;
  evidence.checks.interruptedConfigCannotReviveOldHeader = true;
  evidence.checks.interruptedConfigAutomaticallyRecovered = true;
  }

  phase = 'user-scripts-negative-prepare';
  const enabled = await manage({ action: 'setExtensionEnabled', enabled: true });
  assert.equal(enabled.syncReport.components.headers.status, 'ok'); expectedConfig = enabled.config;
  if (masterOffRestore) {
    phase = 'normal-ui-master-disable';
    const popup = await page(`chrome-extension://${extensionId}/popup/popup.html`);
    await until(() => evaluate(popup, 'document.getElementById("globalEnabled").checked'));
    await waitForUi('master-disabled');
    await until(() => evaluate(popup, 'document.getElementById("runtimeSyncStatus").dataset.status === "ok" && document.getElementById("runtimeSyncStatus").dataset.pageRuntime === "disabled" && !document.getElementById("globalEnabled").checked'));
    const disabled = await until(() => readExistingWorkerState(manifest.version), state => state?.config.masterEnabled === false
      && state.headers?.status === 'ok' && state.pageRuntime?.state === 'disabled' && state.dynamicRuleIds.length === 0);
    expectedConfig = disabled.config;
    evidence.masterOff = { method: 'normal-popup-master-switch', state: summarize(disabled), first: await sample('site.vg.test', true) };
    for (const value of [evidence.masterOff.first, ...Object.values(evidence.masterOff.first.frames)]) {
      assertSample(value, native.language, native.languages, native.navigation);
    }
    evidence.checks.masterSwitchRestoresPageAndHeadersBeforeChromeSwitch = true;
    await send('Target.closeTarget', { targetId: popup.targetId });
  }
  const switchPage = await page('chrome://extensions/?id=' + extensionId);
  await waitForUi('user-scripts-disabled'); assert.equal(await evaluate(switchPage, userScriptsSwitch), false);
  await send('Target.closeTarget', { targetId: switchPage.targetId });
  const off = { boundary: '关闭开关后的首请求必须与原生页面语言一致' };
  evidence.userScriptsOff = off;
  let oldNonce, earlyDelivery;
  const restorePath = '/restore-user-scripts-off', restoreUrl = origin('site.vg.test') + restorePath;
  if (userScriptsOffRestore) {
    const retained = await page(restoreUrl); oldNonce = await evaluate(retained, 'deliveryNonce');
    await until(() => firstReports.get(oldNonce));
    await send('Target.activateTarget', { targetId: retained.targetId });
    for (const target of (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.targetId !== retained.targetId)) {
      await send('Target.closeTarget', { targetId: target.targetId });
    }
    off.onlyActiveHttpTabRetainedBeforeExit = true;
  }
  off.exit = await closeCompletely(profile);
  await launch(profile, userScriptsOffRestore ? async spawnedAt => {
    earlyDelivery = await until(() => deliveries.find(value => value.host === 'site.vg.test'
      && value.path === restorePath && value.receivedAt >= spawnedAt && value.nonce !== oldNonce), Boolean, 30000);
    const first = await until(() => firstReports.get(earlyDelivery.nonce), Boolean, 30000);
    const { nonce, host, path, receivedAt, ...values } = first;
    off.earlyFirstInlineReport = { ...values, actualServerNavigationHeader: earlyDelivery.navigation,
      navigationReceivedAfterSpawnMs: earlyDelivery.receivedAt - spawnedAt, reportReceivedAfterSpawnMs: receivedAt - spawnedAt,
      receivedBeforeCdpConnection: true };
    off.noStartupUrlOrForcedRestoreFlag = true;
  } : undefined);
  phase = 'user-scripts-off-first-http';
  if (userScriptsOffRestore) {
    const targets = (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page');
    assert.equal(targets.length, 1); assert.equal(targets[0].url, restoreUrl);
    const restored = { ...await send('Target.attachToTarget', { targetId: targets[0].targetId, flatten: true }) };
    off.first = await until(() => evaluate(restored, 'globalThis.snapshot || null'), value => value?.same && value?.cross);
    assert.equal(await evaluate(restored, 'deliveryNonce'), earlyDelivery.nonce);
    assert.equal(off.first.navigation, off.earlyFirstInlineReport.navigation);
    assert.equal(off.first.language, off.earlyFirstInlineReport.language);
    assert.deepEqual(off.first.languages, off.earlyFirstInlineReport.languages);
    assert.equal(deliveries.filter(value => value.host === 'site.vg.test' && value.path === restorePath && value.nonce !== oldNonce).length, 1);
    await send('Target.detachFromTarget', { sessionId: restored.sessionId });
    evidence.checks.offRestoredFirstResponseObservedBeforeCdp = true;
  } else off.first = await sample('site.vg.test');
  off.firstRequestConsistency = matchesSample(off.first, native.language, native.languages, native.navigation) ? 'PASS' : 'FAIL';
  evidence.checks.userScriptsOffFirstRequestsNative = off.firstRequestConsistency === 'PASS';
  phase = 'user-scripts-off-read-only-recovery';
  const rejected = await until(() => readExistingWorkerState(manifest.version), state => state && !state.userScriptsAvailable
    && !state.dynamicRuleIds.length && (masterOffRestore ? state.headers?.status === 'ok' && !state.guards.length
      : state.guards.includes('header_migration_guard') && state.headers?.status==='failed'));
  off.recovered = summarize(rejected); assert.deepEqual(rejected.config, expectedConfig);
  off.afterRecovery = await sample('site.vg.test'); assertSample(off.afterRecovery, native.language, native.languages, native.navigation);
  off.managementMessagesAfterRestart = 0;
  evidence.checks[masterOffRestore ? 'disabledConfigAndEmptyHeadersPreservedAfterRestart' : 'userScriptsOffRemovesPersistentHeaderAfterValidation'] = true;
  }
  if (!userScriptsOffRestore) evidence.checks.allowUserScriptsPersistsAcrossBothColdStarts = true;
  assert.equal(await fingerprint(dist), original); evidence.checks.unmodifiedDist = true; evidence.distSha256 = original;
  evidence.result = Object.values(evidence.checks).every(Boolean) ? 'PASS' : 'FAIL';
} catch (error) {
  evidence.failure = { phase, type: error.code === 'ERR_ASSERTION' ? 'assertion' : 'automation',
    message: String(error.message).replaceAll(root, '<workspace>').replaceAll(temporary || '\0', '<temporary>').replace(/[a-p]{32}/g, '<extension>').slice(0, 350) };
} finally {
  try {
    if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close'); socket.close(); }
    if (browser && browser.exitCode === null && !browser.signalCode) await Promise.race([once(browser, 'exit'), pause(5000)]);
    if (browser && browser.exitCode === null && !browser.signalCode) { browser.kill('SIGKILL'); await once(browser, 'exit'); }
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    evidence.cleanup = 'PASS';
  } catch { evidence.cleanup = 'FAIL'; evidence.result = 'BLOCKED'; }
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('TEST_CLOSED')); }
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ result: evidence.result, chrome: evidence.chrome, checks: evidence.checks, failure: evidence.failure, cleanup: evidence.cleanup }, null, 2));
  process.exitCode = evidence.result === 'PASS' ? 0 : evidence.result === 'FAIL' ? 1 : 2;
}
