#!/usr/bin/env node
// VG-010：真实 Chrome 临时 profile；provider 请求在发出前拦截并返回合成响应。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLeakTestServer } from './serve-leak-test.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(80); }
  throw new Error('VG-010 等待浏览器状态超时');
}

async function withChrome(work) {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '未找到 Chrome；可设置 CHROME_BIN');
  assert.equal(typeof WebSocket, 'function', '需要 Node 22+ 原生 WebSocket');
  const temp = await mkdtemp(join(tmpdir(), 'vanishgeo-onboarding-'));
  const child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-010 Chrome协议超时：${method}`)); }, 20000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id); if (!request) return;
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.fail(new Error(`VG-010 Chrome协议失败：${message.error.message}`));
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
      assert.ok(!result.exceptionDetails, 'VG-010 扩展页面执行失败');
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
    assert.deepEqual(errors, [], 'VG-010 浏览器异常');
    return result;
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-010 smoke结束')); }
    pending.clear(); socket?.close();
    if (child.exitCode === null) { const ended = new Promise((done) => child.once('exit', done)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); }
    await rm(temp, { recursive: true, force: true });
  }
}

// VG-042：复用独立 Chrome/CDP 生命周期，仅检查配置与 WebRTC，不请求定位服务。
async function configRoundTrip() {
  return withChrome(async (c) => {
    const extension = join(c.temp, 'extension');
    await cp(dist, extension, { recursive: true });
    const { id } = await c.send('Extensions.loadUnpacked', { path: extension });
    // 使用原生扩展详情页正常开启开关；不修改偏好或伪造 API。
    const details = await c.page(`chrome://extensions/?id=${id}`);
    const toggle = `(() => { const find = root => { for (const el of root.querySelectorAll('*')) {
      if (el.id === 'allow-user-scripts') return el.shadowRoot?.querySelector('cr-toggle');
      if (el.shadowRoot) { const result = find(el.shadowRoot); if (result) return result; }
    } }; const t = find(document); if (!t) return null; t.scrollIntoView({block:'center'});
      const rect = t.getBoundingClientRect(); return { checked:t.checked, disabled:t.disabled, x:rect.x+rect.width/2, y:rect.y+rect.height/2 }; })()`;
    const control = await until(() => c.evaluate(details, toggle));
    assert.equal(control.disabled, false);
    if (!control.checked) {
      await c.send('Input.dispatchMouseEvent', { type:'mousePressed', x:control.x, y:control.y, button:'left', clickCount:1 }, details.sessionId);
      await c.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:control.x, y:control.y, button:'left', clickCount:1 }, details.sessionId);
    }
    await until(() => c.evaluate(details, toggle), value => value?.checked === true);
    await c.send('Target.closeTarget', { targetId: details.targetId });
    const controller = await c.page(`chrome-extension://${id}/diagnostic/report.html`);
    const initial = (await c.message(controller, { action: 'getSiteConfig' })).config;
    assert.equal(initial.masterEnabled, false);
    assert.equal(initial.webRtc.globalMode, 'default');
    assert.deepEqual(initial.rules, []);
    const seed = { ...initial, masterEnabled: true };
    assert.equal((await c.message(controller, { action: 'setSiteConfig', config: seed })).saved, true);
    const policy = () => c.evaluate(controller, 'chrome.privacy.network.webRTCIPHandlingPolicy.get({})');
    for (const surface of ['options', 'popup']) {
      for (const [mode, actual] of [['default', 'default'], ['compatible', 'default_public_interface_only'], ['strict', 'disable_non_proxied_udp']]) {
        const ui = await c.page(`chrome-extension://${id}/${surface}/${surface}.html`);
        await until(() => c.evaluate(ui, `document.getElementById('runtimeSyncStatus').dataset.status`), value => value === 'ok');
        const values = await c.evaluate(ui, `Array.from(document.getElementById('webrtcPolicy').options, o => o.value)`);
        assert.deepEqual(values, ['default', 'compatible', 'strict']);
        await c.evaluate(ui, `document.getElementById('webrtcPolicy').value=${JSON.stringify(mode)};
          document.getElementById('webrtcPolicy').dispatchEvent(new Event('change'));
          ${surface === 'options' ? "document.getElementById('save').click()" : "void 0"}`);
        await until(async () => (await c.message(controller, { action: 'getSiteConfig' })).config.webRtc.globalMode, value => value === mode);
        assert.equal((await policy()).value, actual);
        await c.send('Target.closeTarget', { targetId: ui.targetId });
        const reopened = await c.page(`chrome-extension://${id}/${surface}/${surface}.html`);
        await until(() => c.evaluate(reopened, `document.getElementById('runtimeSyncStatus').dataset.status`), value => value === 'ok');
        await until(() => c.evaluate(reopened, `document.getElementById('webrtcPolicy').value`), value => value === mode);
        assert.equal(await c.evaluate(reopened, `document.getElementById('webrtcEnabled').checked`), mode !== 'default');
        await c.send('Target.closeTarget', { targetId: reopened.targetId });
      }
    }
    const saved = (await c.message(controller, { action: 'getSiteConfig' })).config;
    for (const bad of [{}, { ...saved, masterEnabled: 'false' }, { ...saved, webRtc: { globalMode: 'bogus' } }]) {
      const response = await c.message(controller, { action: 'importSiteConfig', config: bad });
      assert.equal(response.status, 'error');
      assert.deepEqual((await c.message(controller, { action: 'getSiteConfig' })).config, saved);
    }
    assert.equal((await c.message(controller, { action: 'importSiteConfig', config: saved })).saved, true);
    assert.deepEqual((await c.message(controller, { action: 'getSiteConfig' })).config, saved);
    await c.message(controller, { action: 'setExtensionEnabled', enabled: false });
    assert.equal((await policy()).value, 'default');
    const corrupt = { ...saved, masterEnabled: 'false' };
    await c.evaluate(controller, `chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(corrupt)}})`);
    const response = await c.message(controller, { action: 'getSiteConfig' });
    assert.equal(response.status, 'error'); assert.match(response.message, /本地配置无效/);
    assert.deepEqual(await c.evaluate(controller, 'chrome.storage.local.get("siteSpoofConfig").then(d => d.siteSpoofConfig)'), corrupt);
    assert.equal((await policy()).value, 'default');
    const options = await c.page(`chrome-extension://${id}/options/options.html`);
    await until(() => c.evaluate(options, `document.getElementById('runtimeSyncStatus').textContent`), value => value.includes('本地配置无效'));
    assert.equal(await c.evaluate(options, `document.getElementById('runtimeSyncStatus').dataset.status`), 'failed');
    assert.equal((await c.message(controller, { action: 'importSiteConfig', config: initial })).saved, true);
    assert.deepEqual((await c.message(controller, { action: 'getSiteConfig' })).config, initial);
    await c.evaluate(controller, `chrome.storage.local.set({siteSpoofConfig:{}})`);
    assert.equal((await c.message(controller, { action: 'resetSiteConfig' })).saved, true);
    assert.deepEqual((await c.message(controller, { action: 'getSiteConfig' })).config, initial);
    assert.equal(c.providerRequests.length, 0);
    return { task: 'VG-042', result: 'PASS', browser: c.browser, mode: 'real Chrome headless / isolated temporary profile',
      webRtcUiRoundTrips: 6, actualPolicyReadback: true, masterOffReleasesPolicy: true, invalidImportPreservesConfig: true,
      exportImportRoundTrip: true, corruptStoragePreserved: true, managementErrorVisible: true, importAndResetRecovery: true,
      providerRequests: 0, limitations: ['Popup作为扩展文档检查，未做action气泡人工验收', '未检测ICE或网络泄漏，未覆盖其他Chrome版本及完整升级矩阵'] };
  });
}

async function main() {
  if (args.includes('--config-only')) {
    const record = await configRoundTrip();
    if (option('--output')) await writeFile(option('--output'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`VG-042 ${record.browser} 配置/WebRTC真实浏览器往返：PASS（6项），损坏配置与恢复：PASS，provider请求=0。`);
    return;
  }
  const server = createLeakTestServer({ projectRoot: root });
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
    const origin = `http://localhost:${server.address().port}`;
    const fresh = args.includes('--upgrade-only') ? null : await withChrome(async (c) => {
      const { id } = await c.send('Extensions.loadUnpacked', { path: dist });
      const optionsUrl = `chrome-extension://${id}/options/options.html`;
      const installed = await until(async () => (await c.send('Target.getTargets')).targetInfos.find((target) => target.url === optionsUrl));
      const options = await until(() => c.targets.get(installed.targetId));
      await until(() => c.evaluate(options, `document.getElementById('setupStatus')?.dataset.setup`), (value) => value === 'unconfigured');
      const snapshot = await c.evaluate(options, `(async () => ({config: (await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig,
        scripts: await chrome.scripting.getRegisteredContentScripts(), rules: await chrome.declarativeNetRequest.getDynamicRules(),
        privacy: await chrome.privacy.network.webRTCIPHandlingPolicy.get({})}))()`);
      assert.equal(snapshot.config.masterEnabled, false); assert.equal(snapshot.config.webRtc.globalMode, 'default');
      assert.deepEqual(snapshot.config.rules, []); assert.deepEqual(snapshot.scripts, []); assert.deepEqual(snapshot.rules, []);
      assert.equal(snapshot.privacy.value, 'default'); assert.notEqual(snapshot.privacy.levelOfControl, 'controlled_by_this_extension');
      assert.equal(c.providerRequests.length, 0);
      assert.equal(await c.evaluate(options, 'document.title'), 'VanishGeo 配置');
      assert.equal(await c.evaluate(options, `document.getElementById('onboardingDetails').open`), true);
      await c.evaluate(options, `document.getElementById('onboardingEnable').click()`);
      assert.match(await c.evaluate(options, `document.getElementById('onboardingStatus').textContent`), /勾选明确启用/);
      await c.evaluate(options, `document.getElementById('onboardingSkip').click()`);
      await until(() => c.evaluate(options, `document.getElementById('onboardingStatus').textContent.includes('已跳过')`));
      assert.equal(c.providerRequests.length, 0);
      assert.equal((await c.message(options, { action: 'getSiteConfig' })).config.masterEnabled, false);
      const popup = await c.page(`chrome-extension://${id}/popup/popup.html`);
      await c.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 600, deviceScaleFactor: 1, mobile: false }, popup.sessionId);
      await until(() => c.evaluate(popup, `document.getElementById('setupStatus').dataset.setup`), (value) => value === 'unconfigured');
      const popupWidth = await c.evaluate(popup, `({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})`);
      assert.equal(popupWidth.viewport, 380, 'Popup文档验收视口');
      assert.ok(popupWidth.content <= 380, 'Popup文档不得水平溢出');
      await c.send('Target.closeTarget', { targetId: popup.targetId });
      await c.evaluate(options, `document.getElementById('onboardingDetails').open=true`);
      c.allowSyntheticProvider();
      await c.evaluate(options, `document.getElementById('onboardingDetect').click()`);
      await until(() => c.evaluate(options, `document.getElementById('onboardingProfile').options.length`), (value) => value === 2);
      assert.equal(c.providerRequests.length, 1); assert.deepEqual(c.dialogs, ['confirm', 'prompt']);
      assert.equal((await c.message(options, { action: 'getSiteConfig' })).config.masterEnabled, false);
      await c.evaluate(options, `document.getElementById('onboardingProfile').selectedIndex=1;
        document.getElementById('onboardingDomains').value='localhost'; document.getElementById('onboardingWebRtc').value='default';
        document.getElementById('onboardingConfirm').checked=true; document.getElementById('onboardingEnable').click()`);
      await until(() => c.evaluate(options, `document.getElementById('setupStatus').dataset.setup`), (value) => value === 'enabled');
      await until(() => c.evaluate(options, `document.getElementById('runtimeSyncStatus').dataset.status`), (value) => value === 'ok');
      const enabled = await c.message(options, { action: 'getSiteConfig' });
      assert.equal(enabled.config.masterEnabled, true); assert.equal(enabled.config.rules.length, 1);
      assert.equal(enabled.config.exitLocationProfiles[0].verification, 'verified');
      assert.equal(enabled.config.rules[0].exitLocationProfileId, enabled.config.exitLocationProfiles[0].id);
      assert.equal(enabled.config.webRtc.globalMode, 'default');
      const target = await c.page(`${origin}/fixtures/injection/earliest-inline.html`);
      await until(() => c.evaluate(target, 'Intl.DateTimeFormat().resolvedOptions().timeZone'), (value) => value === 'Asia/Katmandu' || value === 'Asia/Kathmandu');
      const matches = await c.evaluate(options, 'chrome.scripting.getRegisteredContentScripts().then(s=>s[0].matches)');
      assert.deepEqual(matches, ['*://localhost/*']);
      await c.evaluate(options, `document.getElementById('resetAll').click()`);
      await until(() => c.evaluate(options, `document.getElementById('setupStatus').dataset.setup`), (value) => value === 'unconfigured');
      const reset = await c.message(options, { action: 'getSiteConfig' });
      assert.equal(reset.config.masterEnabled, false); assert.equal(reset.config.rules.length, 0); assert.equal(reset.config.exitLocationProfiles.length, 0);
      assert.equal(c.providerRequests.length, 1);
      return { result: 'PASS', browser: c.browser, automaticProviderRequests: 0, activeSyntheticProviderRequests: 1,
        installOpensOptions: true, popupUnconfigured: true, explicitConfirmationRequired: true, skippedSafe: true, confirmedProfileBound: true,
        enabledOnlyLocalhost: true, browserDefaultWebRtc: true, postLoadTimezoneApplied: true, resetSafe: true, runtimeExceptions: 0 };
    });
    const upgrade = await withChrome(async (c) => {
      const extension = join(c.temp, 'extension');
      await cp(option('--upgrade-from') || dist, extension, { recursive: true });
      const oldManifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
      oldManifest.version = '2.0.9'; await writeFile(join(extension, 'manifest.json'), JSON.stringify(oldManifest));
      const { id } = await c.send('Extensions.loadUnpacked', { path: extension });
      const controller = await c.page(`chrome-extension://${id}/diagnostic/report.html`);
      await c.message(controller, { action: 'getSiteConfig' });
      const seed = await c.evaluate(controller, `(async () => {
        const config=(await chrome.runtime.sendMessage({action:'getSiteConfig'})).config;
        config.masterEnabled=true;config.webRtc.globalMode='strict';
        config.exitLocationProfiles=[{id:'synthetic-exit',name:'合成出口',verification:'verified',publicIp:'203.0.113.20',latitude:0,longitude:0,country:'Synthetic',timezone:'UTC',provider:'synthetic',verifiedAt:1}];
        config.rules=[{id:'kept-rule',domain:'localhost',enabled:true,exitLocationProfileId:'synthetic-exit',overrides:{language:{mode:'inherit',value:null},timezone:{mode:'inherit',value:null},geolocation:{mode:'inherit',value:null}}}];
        config.profile={activeProfileId:'kept-profile',profiles:[{id:'kept-profile',name:'保留方案',geolocation:{latitude:0,longitude:0,accuracy:50},timezone:{timezone:'UTC'},language:{language:'en-US',languages:['en-US'],acceptLanguage:'en-US'}}]};
        await chrome.storage.local.set({siteSpoofConfig:config});await chrome.storage.local.remove('vanishgeoRulesInitialized');
        return config;
      })()`);
      for (const target of (await c.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'page' && target.url.startsWith(`chrome-extension://${id}/`))) await c.send('Target.closeTarget', { targetId: target.targetId });
      await cp(dist, extension, { recursive: true });
      const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
      manifest.version = '2.1.1'; await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
      // 通过同一加载接口更新相同目录，并确认扩展身份保持。
      const reloaded = await c.send('Extensions.loadUnpacked', { path: extension });
      assert.equal(reloaded.id, id, '更新必须保持同一扩展身份');
      const updatedController = await c.page(`chrome-extension://${id}/diagnostic/report.html`);
      const identity = await c.evaluate(updatedController, `({href:location.href,title:document.title,runtime:typeof chrome.runtime})`);
      if (identity.runtime !== 'object') {
        const state = (await c.send('Target.getTargets')).targetInfos.map((target) => ({ type: target.type, url: target.url.replaceAll(c.temp, '<temp>') }));
        throw new Error(`VG-010 升级页面身份：${JSON.stringify({identity,state})}`);
      }
      assert.equal(await c.evaluate(updatedController, 'chrome.runtime.getManifest().version'), '2.1.1', '必须实际载入更新后的manifest');
      await c.message(updatedController, { action: 'getSiteConfig' });
      const autoOptions = (await c.send('Target.getTargets')).targetInfos.filter((target) => target.url === `chrome-extension://${id}/options/options.html`);
      assert.equal(autoOptions.length, 0, '升级不得自动打开引导');
      const options = await c.page(`chrome-extension://${id}/options/options.html`);
      await until(() => c.evaluate(options, `document.getElementById('setupStatus')?.dataset.setup`), (value) => value === 'enabled');
      const after = await c.evaluate(options, `chrome.storage.local.get('siteSpoofConfig').then(d=>d.siteSpoofConfig)`);
      assert.deepEqual(after, seed, '升级必须原样保留v2配置（对象键顺序不属于配置语义）');
      const state = await c.message(options, { action: 'getSiteConfig' });
      assert.equal(state.status, 'ok');
      assert.equal(state.config.webRtc.globalMode, 'strict');
      const actualPolicy = await c.evaluate(options, 'chrome.privacy.network.webRTCIPHandlingPolicy.get({})');
      assert.equal(actualPolicy.value, 'disable_non_proxied_udp');
      assert.equal(actualPolicy.levelOfControl, 'controlled_by_this_extension');
      assert.equal(c.providerRequests.length, 0);
      return { result: 'PASS', browser: c.browser, baseline: option('--upgrade-from') ? 'pre-task build with existing v2' : 'candidate build with existing v2',
        testVersions: ['2.0.9', '2.1.1'], updateMechanism: 'Extensions.loadUnpacked same directory and extension ID',
        v2StoragePreservedExactly: true, missingMarkerPreserved: true, strictPolicyActuallyApplied: true,
        masterWebRtcRulesProfilesPreserved: true, updateDoesNotOpenGuide: true, automaticProviderRequests: 0, runtimeExceptions: 0 };
    });
    const record = { task: 'VG-010', result: 'PASS', scenario: fresh ? 'fresh-and-upgrade' : 'upgrade-only', mode: 'real Chrome headless / isolated temporary profiles', fresh, upgrade,
      limitations: ['provider为CDP发出前拦截的合成响应，未联系真实服务', 'Popup作为扩展文档检查，不代替真实action视口人工验收', 'postLoad通过不表示首inline时序已修复', '未验证Chrome119、其他浏览器或完整冷启动/中断矩阵'] };
    if (option('--output')) await writeFile(option('--output'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`VG-010 ${upgrade.browser} fresh install / 引导 / reset：${fresh ? 'PASS' : '未运行'}；upgrade：PASS；自动provider请求=0。`);
  } finally { await new Promise((done) => server.close(done)); }
}
main().catch((error) => { console.error(String(error.stack || error.message).replaceAll(`${root}/`, '')); process.exitCode = 1; });
