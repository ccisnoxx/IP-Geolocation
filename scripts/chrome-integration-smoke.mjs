#!/usr/bin/env node
// VG-014：真实 Chrome 临时 profile；provider 请求在发出前拦截并返回合成响应。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLeakTestServer } from './serve-leak-test.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('参数：--output <脱敏JSON>');
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(80); }
  throw new Error('VG-014 等待浏览器状态超时');
}

async function withChrome(work) {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '未找到 Chrome；可设置 CHROME_BIN');
  assert.equal(typeof WebSocket, 'function', '需要 Node 22+ 原生 WebSocket');
  const temp = await mkdtemp(join(tmpdir(), 'vanishgeo-integration-'));
  const child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--host-resolver-rules=MAP *.vg014.test 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  let socket;
  const pending = new Map();
  try {
    const port = await until(async () => { try { return (await readFile(join(temp, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } });
    const protocol = await (await fetch(`http://localhost:${port}/json/protocol`)).json();
    assert.ok(protocol.domains.find((d) => d.domain === 'Extensions')?.commands.some((c) => c.name === 'loadUnpacked'), 'Chrome 缺少 Extensions.loadUnpacked');
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
    let sequence = 0;
    const targets = new Map();
    const errors = [];
    const dialogs = [];
    const providerRequests = [];
    let syntheticProvider = false;
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence;
      const sentFrom = new Error().stack;
      const timer = setTimeout(() => { pending.delete(id); const error = new Error(`VG-014 Chrome协议超时：${method}`); error.stack += '\n' + sentFrom; fail(error); }, 20000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id); if (!request) return;
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.fail(new Error(`VG-014 Chrome协议失败：${message.error.message}`));
        else request.done(message.result);
        return;
      }
      void (async () => {
        const { params, sessionId } = message;
        if (message.method === 'Target.attachedToTarget') {
          const session = params.sessionId;
          await send('Runtime.enable', {}, session);
          if (params.targetInfo.type === 'page') await send('Page.enable', {}, session);
          if (params.targetInfo.type === 'service_worker') {
            await send('Network.enable', {}, session);
            await send('Fetch.enable', { patterns: ['https://ipwho.is/*', 'https://ipapi.co/*', 'https://ipinfo.io/*'].map((urlPattern) => ({ urlPattern })) }, session);
          }
          targets.set(params.targetInfo.targetId, { sessionId: session, info: params.targetInfo });
          await send('Runtime.runIfWaitingForDebugger', {}, session);
        } else if (message.method === 'Target.detachedFromTarget') {
          for (const [id, target] of targets) if (target.sessionId === params.sessionId) targets.delete(id);
        } else if (message.method === 'Fetch.requestPaused') {
          providerRequests.push({ synthetic: syntheticProvider });
          if (!syntheticProvider) await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId);
          else await send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify({ success: true, ip: '203.0.113.10', latitude: 0, longitude: 0, country: 'Synthetic', timezone: { id: 'Asia/Kathmandu' } })).toString('base64') }, sessionId);
        } else if (message.method === 'Page.javascriptDialogOpening') {
          dialogs.push(params.type);
          await send('Page.handleJavaScriptDialog', { accept: true, promptText: '合成出口' }, sessionId);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push('Runtime exception');
      })().catch((error) => errors.push(error.message));
    };
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const evaluate = async (page, expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
      assert.ok(!result.exceptionDetails, 'VG-014 扩展页面执行失败');
      return result.result.value;
    };
    const page = async (url) => {
      const { targetId } = await send('Target.createTarget', { url });
      const target = await until(() => targets.get(targetId));
      await until(() => evaluate(target, 'document.readyState'), (value) => value === 'complete');
      return { ...target, targetId };
    };
    const message = (target, request) => evaluate(target, `chrome.runtime.sendMessage(${JSON.stringify(request)})`);
    const result = await work({ temp, send, targets, evaluate, page, message, errors, dialogs, providerRequests,
      allowSyntheticProvider() { syntheticProvider = true; }, browser: version.Browser });
    assert.deepEqual(errors, [], 'VG-014 浏览器异常');
    return result;
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-014 smoke结束')); }
    pending.clear(); socket?.close();
    if (child.exitCode === null) { const ended = new Promise((done) => child.once('exit', done)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); }
    await rm(temp, { recursive: true, force: true });
  }
}

// 只保留相对文件摘要；不把运行目录、配置、run/document 身份或地址写进证据。
async function distDigest(directory = dist, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) entries.push(...await distDigest(join(directory, item.name), `${relative}/`));
    else entries.push([relative, createHash('sha256').update(await readFile(join(directory, item.name))).digest('hex')]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

async function main() {
  const cases = {};
  let phase = 'startup';
  const server = createLeakTestServer({ projectRoot: root });
  const requests = [];
  server.on('request', req => requests.push({ url: req.url, referer: req.headers.referer || '', cookie: Boolean(req.headers.cookie) }));
  const candidate = createHash('sha256').update(JSON.stringify(await distDigest())).digest('hex');
  let browser = null;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    const port = server.address().port, origin = `http://localhost:${port}`;
    await withChrome(async c => {
      browser = c.browser;
      // 不读取主机真实位置；测试原生权限拒绝和报告 UNKNOWN。
      await c.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin });
      const { id } = await c.send('Extensions.loadUnpacked', { path: dist });
      const extensionUrl = `chrome-extension://${id}/`;
      const options = await c.page(`${extensionUrl}options/options.html`);
      const report = await c.page(`${extensionUrl}diagnostic/report.html`);
      const msg = request => c.message(report, request);
      const config = async () => (await msg({ action: 'getSiteConfig' })).config;
      const readLocal = () => c.evaluate(report, 'chrome.storage.local.get(null)');
      const readyOptions = async target => until(() => c.evaluate(target, "document.getElementById('webrtcPolicyStatus')?.textContent.includes('控制级别：')"));
      const save = async value => {
        const response = await msg({ action: 'setSiteConfig', config: value });
        assert.equal(response.saved, true, '配置应已保存');
        assert.ok(['ok', 'partial'].includes(response.status));
        return response;
      };
      const policy = () => c.evaluate(report, 'chrome.privacy.network.webRTCIPHandlingPolicy.get({})');
      const scripts = () => c.evaluate(report, 'chrome.scripting.getRegisteredContentScripts()');
      const tabId = url => c.evaluate(report, `chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(url)})?.id)`);
      const reload = async target => {
        await c.send('Page.reload', {}, target.sessionId);
        await until(() => c.evaluate(target, 'document.readyState'), v => v === 'complete');
      };
      const record = (name, detail) => { cases[name] = { result: 'PASS', ...detail }; console.log(`VG-014 ${name}: PASS`); };
      await readyOptions(options);
      phase = 'onboarding';
      let current = await config();
      assert.equal(current.masterEnabled, false); assert.deepEqual(current.rules, []); assert.equal(current.webRtc.globalMode, 'default');
      assert.deepEqual(await scripts(), []); assert.deepEqual(await c.evaluate(report, 'chrome.declarativeNetRequest.getDynamicRules()'), []);
      assert.equal((await policy()).value, 'default'); assert.equal(c.providerRequests.length, 0);
      await c.evaluate(options, "document.getElementById('onboardingEnable').click()");
      assert.match(await c.evaluate(options, "document.getElementById('onboardingStatus').textContent"), /勾选明确启用/);
      await c.evaluate(options, "document.getElementById('onboardingSkip').click()");
      await until(() => c.evaluate(options, "document.getElementById('onboardingStatus').textContent.includes('已跳过')"));
      assert.equal((await config()).masterEnabled, false);
      c.allowSyntheticProvider();
      await c.evaluate(options, "document.getElementById('onboardingDetect').click()");
      await until(() => c.evaluate(options, "document.getElementById('onboardingProfile').options.length"), n => n === 2);
      assert.equal(c.providerRequests.length, 1);
      await c.evaluate(options, "document.getElementById('onboardingProfile').selectedIndex=1;document.getElementById('onboardingDomains').value='localhost';document.getElementById('onboardingWebRtc').value='strict';document.getElementById('onboardingConfirm').checked=true;document.getElementById('onboardingEnable').click()");
      await until(() => c.evaluate(options, "document.getElementById('runtimeSyncStatus').dataset.status"), v => v === 'partial');
      current = await config();
      assert.equal(current.masterEnabled, true); assert.equal(current.exitLocationProfiles.length, 1);
      const profileId = current.exitLocationProfiles[0].id;
      assert.equal(current.exitLocationProfiles[0].verification, 'verified'); assert.equal(current.rules[0].exitLocationProfileId, profileId);
      assert.equal((await policy()).value, 'disable_non_proxied_udp'); assert.deepEqual(await scripts(), []);
      record(phase, { freshSafe: true, explicitConsent: true, skipSafe: true, providerInterceptedBeforeNetwork: true, confirmedProfileBound: true, pauseVisible: true });

      phase = 'disabled-rules-ui';
      current.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'Pacific/Honolulu' };
      current.globalProfile.geolocation.enabled = false;
      current.globalProfile.language = { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' };
      current.rules.push({ ...current.rules[0], id: 'disabled-fixture', domain: 'disabled.vg014.test', enabled: false });
      current = (await save(current)).config;
      const disabled = structuredClone(current.rules.find(r => r.id === 'disabled-fixture'));
      await reload(options); await readyOptions(options);
      await c.evaluate(options, "window.alert=()=>{};document.getElementById('intlMode').value='compatible';document.getElementById('save').click()");
      await until(config, value => value.intlMode === 'compatible');
      assert.deepEqual((await config()).rules.find(r => r.id === disabled.id), disabled);
      const popup = await c.page(`${extensionUrl}popup/popup.html`);
      await until(() => c.evaluate(popup, "document.getElementById('runtimeSyncStatus')?.dataset.status"), value => value === 'partial');
      await c.evaluate(popup, "document.getElementById('intlMode').value='strict';document.getElementById('intlMode').dispatchEvent(new Event('change'))");
      await until(config, value => value.intlMode === 'strict');
      assert.deepEqual((await config()).rules.find(r => r.id === disabled.id), disabled);
      await reload(options); await readyOptions(options);
      await c.evaluate(options, String.raw`document.getElementById('ruleList').value+='\ndisabled.vg014.test';document.getElementById('save').click()`);
      await until(config, value => value.rules.find(r => r.id === disabled.id)?.enabled === true);
      assert.deepEqual((await config()).rules.find(r => r.id === disabled.id), { ...disabled, enabled: true });
      await msg({ action: 'setDomainRuleEnabled', domain: disabled.domain, enabled: false });
      record(phase, { optionsUnrelatedSave: true, popupUnrelatedSave: true, reenableKeepsIdentityOverridesBinding: true, popupIsExtensionTab: true });

      phase = 'dnr';
      current = await config();
      const rule = (domain, extra = {}) => ({ ...current.rules[0], id: domain, domain, exitLocationProfileId: null, ...extra });
      const override = { ...current.rules[0].overrides, language: { mode: 'override', value: { language: 'fr-FR', languages: ['fr-FR'], acceptLanguage: 'fr-FR' } } };
      current.rules = [rule('localhost'), rule('allowed.vg014.test'), rule('sub.allowed.vg014.test', { overrides: override }), rule('disabled.vg014.test', { enabled: false })];
      await save(current);
      // 使用真实主文档请求头，.test 域名只经当前临时 Chrome 的 host resolver 指向本机。
      const header = async host => {
        const page = await c.page(`http://${host}:${port}/headers.json`);
        const value = await c.evaluate(page, 'JSON.parse(document.body.textContent).acceptLanguage');
        await c.send('Target.closeTarget', { targetId: page.targetId });
        return value;
      };
      assert.equal(await header('allowed.vg014.test'), 'ja-JP,ja;q=0.9');
      assert.equal(await header('deep.allowed.vg014.test'), 'ja-JP,ja;q=0.9');
      assert.equal(await header('sub.allowed.vg014.test'), 'fr-FR');
      assert.notEqual(await header('nonmatch.vg014.test'), 'ja-JP,ja;q=0.9');
      assert.notEqual(await header('disabled.vg014.test'), 'ja-JP,ja;q=0.9');
      assert.notEqual(await header('evillocalhost.vg014.test'), 'ja-JP,ja;q=0.9');
      await msg({ action: 'setDomainRuleEnabled', domain: 'allowed.vg014.test', enabled: false });
      assert.notEqual(await header('deep.allowed.vg014.test'), 'ja-JP,ja;q=0.9');
      await msg({ action: 'deleteDomainRule', domain: 'sub.allowed.vg014.test' });
      assert.notEqual(await header('sub.allowed.vg014.test'), 'fr-FR');
      record(phase, { actualHeaders: true, domainSubdomainPriority: true, nonmatchAndDisabled: true, disableAndDelete: true });

      phase = 'webrtc';
      for (const [mode, expected] of [['strict', 'disable_non_proxied_udp'], ['compatible', 'default_public_interface_only'], ['default', 'default']]) {
        const response = await msg({ action: 'setWebRtcGlobalMode', mode });
        assert.equal(response.syncReport.components.webrtc.status, 'ok');
        const actual = await policy(); assert.equal(actual.value, expected);
        if (mode !== 'default') assert.equal(actual.levelOfControl, 'controlled_by_this_extension');
        else assert.notEqual(actual.levelOfControl, 'controlled_by_this_extension');
      }
      await msg({ action: 'setWebRtcGlobalMode', mode: 'strict' });
      await msg({ action: 'setExtensionEnabled', enabled: false }); assert.equal((await policy()).value, 'default');
      await msg({ action: 'setExtensionEnabled', enabled: true }); assert.equal((await policy()).value, 'disable_non_proxied_udp');
      record(phase, { actualPolicyAndControl: true, strictCompatibleDefault: true, masterDisableClears: true, iceSeparate: true });

      phase = 'runtime-sync';
      const sw = await until(async () => [...c.targets.values()].find(t => t.info.type === 'service_worker' && t.info.url.startsWith(extensionUrl)));
      await c.evaluate(sw, "globalThis.__vg014Original=chrome.declarativeNetRequest.updateDynamicRules;globalThis.__vg014Writes=0;chrome.declarativeNetRequest.updateDynamicRules=async()=>{throw new Error('synthetic dnr failure')};true");
      current = await config(); current.globalProfile.language.acceptLanguage = 'de-DE';
      const failed = await save(current);
      assert.equal(failed.syncReport.components.dnr.status, 'failed'); assert.equal((await config()).globalProfile.language.acceptLanguage, 'de-DE');
      await c.evaluate(sw, "chrome.declarativeNetRequest.updateDynamicRules=(...args)=>{__vg014Writes++;return __vg014Original.apply(chrome.declarativeNetRequest,args)};true");
      const recovered = await msg({ action: 'reconcileRuntime' }); assert.equal(recovered.syncReport.components.dnr.status, 'ok');
      assert.equal(await header('localhost'), 'de-DE');
      const writes = await c.evaluate(sw, '__vg014Writes');
      await save(await config()); await msg({ action: 'reconcileRuntime' });
      assert.equal(await c.evaluate(sw, '__vg014Writes'), writes);
      await c.evaluate(sw, 'chrome.declarativeNetRequest.updateDynamicRules=__vg014Original;delete globalThis.__vg014Original;delete globalThis.__vg014Writes;true');
      record(phase, { savedOnDnrFailure: true, retryRecoversActualHeader: true, sameSignatureNoDuplicateDnrWrite: true });
      // 真实 stop/wake 由 chrome-safety-gate.mjs 独立验收；本 runner 的自动附加路径曾在唤醒后超时。

      phase = 'diagnostic-privacy';
      current = await config(); current.globalProfile.language.acceptLanguage = 'ja-JP,ja;q=0.9'; await save(current);
      const launched = await msg({ action: 'openDiagnosticTarget', target: 'localhost', port });
      const targetUrl = `${origin}/leak-test/leak-test.html?ui=zh`;
      assert.equal(await c.evaluate(report, `chrome.tabs.get(${launched.tabId}).then(t=>t.url||t.pendingUrl)`), targetUrl);
      const targetInfo = await until(async () => (await c.send('Target.getTargets')).targetInfos.find(t => t.url === targetUrl));
      const target = await until(() => c.targets.get(targetInfo.targetId));
      await until(() => c.evaluate(target, 'document.readyState'), v => v === 'complete');
      assert.equal(await c.evaluate(target, 'location.search'), '?ui=zh');
      assert.ok(await c.evaluate(target, 'document.body.textContent.includes("UNKNOWN")'));
      assert.equal(await c.evaluate(target, 'document.body.textContent.includes("Pacific/Honolulu")'), false);
      const denied = await c.evaluate(report, `chrome.scripting.executeScript({target:{tabId:${launched.tabId}},world:'ISOLATED',func:()=>chrome.runtime.sendMessage({action:'getSiteConfig'})}).then(r=>r[0].result)`);
      assert.equal(denied.status, 'error'); assert.equal(denied.config, undefined);
      const wrongReport = await c.message(options, { action: 'prepareDiagnosticRun', tabId: launched.tabId }); assert.equal(wrongReport.status, 'error');
      const selectTarget = async () => {
        await c.evaluate(report, "document.getElementById('refresh').click()");
        await until(() => c.evaluate(report, `Array.from(document.getElementById('target').options).some(o=>o.value==='${launched.tabId}')`));
        await c.evaluate(report, `document.getElementById('target').value='${launched.tabId}'`);
      };
      await selectTarget();
      const storageBeforeRun = await readLocal();
      const requestStart = requests.length;
      await c.evaluate(target, "document.cookie='vg014Synthetic=present; SameSite=Lax'");
      const rows = await c.evaluate(report, "import('./report.js').then(m=>m.run()).then(r=>r.rows.map(v=>({label:v.label,verdict:v.verdict})))");
      assert.equal(rows.find(r => r.label === 'Accept-Language')?.verdict, 'PASS');
      assert.equal(rows.find(r => r.label === 'WebRTC policy')?.verdict, 'PASS');
      assert.equal(rows.find(r => r.label === 'Top language')?.verdict, 'FAIL');
      assert.equal(rows.find(r => r.label === 'Top timezone')?.verdict, 'FAIL');
      const ice = rows.find(r => r.label === 'WebRTC ICE')?.verdict; assert.ok(['UNKNOWN', 'FAIL'].includes(ice));
      assert.ok(rows.some(r => r.label.startsWith('Pass-through ') && r.verdict === 'PASS'));
      const headerRequest = requests.slice(requestStart).find(r => r.url === '/headers.json'); assert.ok(headerRequest);
      assert.equal(headerRequest.referer, ''); assert.equal(headerRequest.cookie, false);
      assert.equal(requests.some(r => /expected|Pacific%2FHonolulu|latitude|longitude/.test(r.url + r.referer)), false);
      assert.equal(await c.evaluate(target, 'document.querySelectorAll("iframe[id^=vanishgeo-diagnostic]").length'), 0);
      assert.deepEqual(await readLocal(), storageBeforeRun);
      record(phase, { reportRows: rows, headerNoReferrerNoCredentials: true, noExpectedUrlOrDom: true, ordinarySenderRejected: true, exactReportSourceRequired: true, localStorageUnchanged: true, ice, nativeGeolocationDenied: true });

      phase = 'diagnostic-lifecycle';
      let run = (await msg({ action: 'prepareDiagnosticRun', tabId: launched.tabId })).run;
      const otherReport = await c.page(`${extensionUrl}diagnostic/report.html`);
      assert.equal((await c.message(otherReport, { action: 'executeDiagnosticRun', runId: run.runId })).code, 'wrong_owner');
      await msg({ action: 'cancelDiagnosticRun', runId: run.runId });
      assert.equal((await msg({ action: 'executeDiagnosticRun', runId: run.runId })).code, 'cancelled');
      run = (await msg({ action: 'prepareDiagnosticRun', tabId: launched.tabId })).run;
      await reload(target);
      assert.equal((await msg({ action: 'executeDiagnosticRun', runId: run.runId })).code, 'navigated');
      await selectTarget();
      await c.evaluate(report, "document.getElementById('run').click()");
      await until(() => c.evaluate(report, "!document.getElementById('cancel').disabled"));
      await c.evaluate(report, "document.getElementById('cancel').click()"); await pause(6000);
      assert.equal(await c.evaluate(report, 'document.querySelectorAll(".row").length'), 0);
      // 等待生产实际报告 TTL；其他场景在这两分钟内继续执行。
      await selectTarget();
      await c.evaluate(report, "import('./report.js').then(m=>m.run()).then(()=>true)");
      const ttlStarted = Date.now();
      record(phase, { wrongOwner: true, cancelConsumedRunRejected: true, sameUrlNavigationRejected: true, lateResultsSuppressed: true, actualReportTtl: 'pending' });

      phase = 'earliest-iframe';
      const timingPage = await c.page(`${origin}/fixtures/injection/earliest-inline.html`);
      const timingTab = await tabId(`${origin}/fixtures/injection/earliest-inline.html`);
      const timingReport = await c.page(`${extensionUrl}diagnostic/report.html`);
      const timingRun = await c.message(timingReport, { action: 'prepareDiagnosticRun', tabId: timingTab });
      const timing = await c.message(timingReport, { action: 'executeInjectionTimingRun', runId: timingRun.run.runId });
      assert.equal(timing.status, 'ok'); assert.equal(timing.evidence.timing.length, 4);
      const observations = timing.evidence.timing.map(item => {
        assert.ok(item.actual.value, '应有实际三阶段采样');
        return { kind: item.kind, actual: item.actual.value };
      });
      // actual 的结构由当前维护的 probe 决定；完整原始结构只在内存中比较。
      assert.ok(observations.every(item => !JSON.stringify(item.actual).includes('Pacific/Honolulu')));
      assert.ok(observations.every(item => !JSON.stringify(item.actual).includes('ja-JP')));
      record(phase, { documents: observations.map(v => v.kind), productionValuesNative: true, spoofExpectation: 'FAIL', stages: ['earliest', 'load', 'postLoad'], productionDispatchRestored: false });
      await c.send('Target.closeTarget', { targetId: timingPage.targetId });

      phase = 'migration-import';
      const savedConfig = await config();
      const invalid = await msg({ action: 'importSiteConfig', config: { ...savedConfig, intlMode: 'invalid-fixture' } });
      assert.equal(invalid.status, 'error'); assert.deepEqual(await config(), savedConfig);
      const imported = await msg({ action: 'importSiteConfig', config: savedConfig });
      assert.equal(imported.saved, true);
      assert.ok(imported.config.exitLocationProfiles.every(p => p.verification === 'unverified' && p.publicIp === null && p.provider === null && p.verifiedAt === null));
      assert.ok(imported.config.rules.every(r => r.exitLocationProfileId === null));
      for (const [latitude, longitude] of [[0, 0], [0, 120], [-30, 0]]) {
        await c.evaluate(report, `chrome.storage.local.clear().then(()=>chrome.storage.local.set({bpg_config:{domainList:['localhost'],geolocation:{latitude:${latitude},longitude:${longitude},accuracy:50}}}))`);
        const migrated = await config(), geo = migrated.globalProfile.geolocation;
        assert.equal(geo.mode, 'manual'); assert.equal(geo.latitude, latitude); assert.equal(geo.longitude, longitude);
        assert.deepEqual(await config(), migrated); assert.equal((await readLocal()).bpg_config, undefined);
      }
      await c.evaluate(report, `chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(savedConfig)}})`);
      // v2 缺新增字段只在读取结果归一化，不覆盖原始配置。
      const raw = structuredClone(savedConfig); delete raw.intlMode;
      await c.evaluate(report, `chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(raw)}}).then(()=>chrome.storage.local.remove('vanishgeoRulesInitialized'))`);
      assert.equal((await config()).intlMode, 'strict'); assert.deepEqual((await readLocal()).siteSpoofConfig, raw);
      record(phase, { invalidImportNoWrite: true, importCannotCreateVerified: true, zeroCoordinates: 3, repeatedMigration: true, oldV2StrictWithoutRawRewrite: true });

      phase = 'reset';
      const reset = await msg({ action: 'resetSiteConfig' });
      assert.equal(reset.config.masterEnabled, false); assert.deepEqual(reset.config.rules, []); assert.deepEqual(reset.config.exitLocationProfiles, []);
      assert.equal((await policy()).value, 'default'); assert.deepEqual(await scripts(), []);
      assert.equal(await c.evaluate(report, "chrome.storage.session.get('pendingExitLocationDetection').then(v=>Boolean(v.pendingExitLocationDetection))"), false);
      record(phase, { safeDefaults: true, noPendingCandidate: true });
      phase = 'report-real-ttl';
      console.log('VG-014 等待报告实际两分钟 TTL；自动化继续运行。');
      await c.send('Target.activateTarget', { targetId: report.targetId });
      await pause(Math.max(0, 120100 - (Date.now() - ttlStarted)));
      await until(() => c.evaluate(report, "document.getElementById('status').textContent.includes('诊断已过期')"));
      assert.equal(await c.evaluate(report, 'document.querySelectorAll(".row").length'), 0);
      cases['diagnostic-lifecycle'].actualReportTtl = 'PASS';
      assert.equal(c.providerRequests.length, 1);
      assert.deepEqual(c.errors, []);
      record(phase, { productionTimer: true, reportCleared: true, noUnexpectedProviderRequest: true, runtimeExceptions: 0 });
    });
  } catch (error) {
    cases[phase] = { result: 'FAIL', failureKind: error.code || error.name || 'Error', protocolTimeout: /^VG-014 Chrome协议超时：/.test(error.message) ? error.message : null, failureSites: String(error.stack).match(/chrome-integration-smoke\.mjs:\d+:\d+/g) || [] };
    // 控制台只输出固定场景和错误类型，避免 Node assertion 打印原始报告。
    console.error(`VG-014 ${phase} 失败：${error.code || error.name}; ${cases[phase].failureSites.join(', ')}; ${cases[phase].protocolTimeout || ''}`);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done));
    const record = { task: 'VG-014', browser, environment: { platform: process.platform, arch: process.arch, node: process.version, mode: 'real Chrome headless / temporary profile / production dist' },
      candidateDistSha256: candidate, result: process.exitCode ? 'FAIL' : 'PASS', releaseReady: false, cases,
      limitations: ['PASS 只表示当前安全暂停合同，完整页面伪装仍未就绪', '原生位置权限被拒绝，不采真实位置；完整诊断使用既有 Google STUN，未保存候选地址', 'provider在发出前合成拦截，未验证服务可用性', 'Popup是扩展文档，非真实action UI；未运行Chrome119、其他浏览器、真实断电或全部并发中断矩阵'] };
    if (option('--output')) await writeFile(option('--output'), JSON.stringify(record, null, 2) + '\n');
    console.log(`VG-014 integration ${record.result}; ${Object.keys(cases).length} scenarios; browser=${browser}`);
  }
}
await main();
