#!/usr/bin/env node
// 真实浏览器、临时 Profile 和正式 dist；无个人配置、STUN、远程 provider 或扩展列表伪造。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createObservabilityServer } from './serve-observability.mjs';
import { ENVIRONMENT_PRESETS } from '../src/shared/environment-presets.ts';
import { createInitialConfig, createRule } from '../src/shared/config-model.ts';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
assert.ok(outputIndex >= 0 && args[outputIndex + 1], '需要 --output <新证据JSON>');
const output = resolve(args[outputIndex + 1]);
assert.ok(output.endsWith('.json'), '证据输出须使用 .json 后缀，以分别保存JSON和截图');
assert.ok(!existsSync(output), '不得覆盖已有原始证据');
const browser = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.ok(existsSync(browser), '未找到浏览器');
const temporary = await mkdtemp(join(tmpdir(), 'vg-observability-'));
const server = createObservabilityServer();
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://localhost:${server.address().port}`;
const evidence = { schemaVersion: 1, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: { browser: null, temporaryProfile: true, userProfileAccessed: false, fixtureTraffic: 'loopback only; no STUN/TURN', otherExtensions: [] },
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  build: {}, contracts: {}, scenarios: {}, status: 'UNKNOWN', errors: [],
  limitations: ['NATIVE仅表示本探针对照字段相同，不证明不可检测', '同源HTTP(S)/SharedWorker按Blob入口同步；跨页Shared身份及入口CSP不等价',
    '未覆盖嵌套Blob、BFCache、重启、任意CSP/沙箱、HTTPS、跨站进程、其他OS或Chrome138',
    'ICE只含无STUN/TURN的host候选类别数量；空候选保持UNKNOWN，不证明网络无泄漏',
    '定位仅spoofPermission=true合成读取；native内部slot由未接管about:blank原生getter对照；不读取真实位置',
    '全局键及DOM扫描不能穷举非枚举闭包、执行时间、错误栈或所有事件监听器'] };
let socket, child; let sequence = 0;
const pending = new Map();
async function until(read, accept = Boolean, label = '状态', timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await new Promise(done => setTimeout(done, 80)); }
  throw new Error(`等待${label}超时`);
}
function send(method, params = {}, sessionId) {
  return new Promise((done, fail) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP ${method}超时`)); }, 20000);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
async function evaluate(page, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
  if (r.exceptionDetails) throw new Error(`浏览器夹具异常：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function open(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = { targetId, sessionId };
  await send('Page.enable', {}, sessionId);
  await until(() => evaluate(page, 'document.readyState'), value => value === 'complete', '文档加载'); return page;
}
const close = page => send('Target.closeTarget', { targetId: page.targetId });
const message = (page, request) => evaluate(page, `chrome.runtime.sendMessage(${JSON.stringify(request)})`);
function compare(base, observed) {
  if (observed === undefined || observed?.status === 'UNKNOWN') return 'UNKNOWN';
  if (observed?.status === 'UNSUPPORTED') return 'UNSUPPORTED';
  if (base === undefined || base?.status === 'UNKNOWN' || base?.status === 'UNSUPPORTED') return 'UNKNOWN';
  return JSON.stringify(base) === JSON.stringify(observed) ? 'NATIVE' : 'OBSERVABLE';
}
function comparison(base, observed) {
  if (!observed.page) return { status: observed.status || 'UNKNOWN' };
  const result = {};
  for (const key of ['language', 'timezone', 'descriptors', 'behavior', 'api', 'globals', 'permission', 'position', 'header', 'fonts', 'dom']) {
    result[key] = compare(base?.page?.[key], observed.page[key]);
  }
  result.ice = observed.page.ice.status; // 只报告本次候选，避免把候选计数相同解释为原生证明。
  result.positionBrand = observed.page.position.nativeCoordsGetter || observed.page.position.status || 'UNKNOWN';
  result.frames = {};
  for (const [name, frame] of Object.entries(observed.frames || {})) result.frames[name] = comparison(base?.frames?.[name], frame);
  result.workers = {};
  for (const [name, worker] of Object.entries(observed.workers || {})) {
    result.workers[name] = worker.status || Object.fromEntries(['language', 'timezone', 'descriptors', 'behavior', 'api', 'globals'].map(key => [key, compare(base?.workers?.[name]?.[key], worker[key])]));
  }
  return result;
}
async function fingerprint(directory, prefix = '') {
  const entries = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (item.isDirectory()) entries.push(...await fingerprint(join(directory, item.name), prefix + item.name + '/'));
    else entries.push([prefix + item.name, createHash('sha256').update(await readFile(join(directory, item.name))).digest('hex')]);
  }
  return entries;
}
try {
  const files = await fingerprint(resolve('dist'));
  evidence.build = { fileCount: files.length, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  child = spawn(browser, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
    `--user-data-dir=${join(temporary, 'profile')}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--host-resolver-rules=MAP *.vg-audit.test 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(join(temporary, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }, Boolean, '浏览器启动');
  const version = await fetch(`http://localhost:${port}/json/version`).then(r => r.json()); evidence.environment.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = event => { const value = JSON.parse(event.data);
    if (value.method === 'Page.javascriptDialogOpening' && value.params.type === 'alert') {
      void send('Page.handleJavaScriptDialog', { accept: true }, value.sessionId).catch(error => evidence.errors.push(error.message));
    }
    if (!value.id) return; const request = pending.get(value.id); if (!request) return;
    pending.delete(value.id); clearTimeout(request.timer); if (value.error) request.fail(new Error(value.error.message)); else request.done(value.result); };
  // Helium自带uBlock组件：通过正常管理页开关关闭，记录实际UI清单，不更改个人Profile。
  const manager = await open('chrome://extensions/');
  const inventory = `(() => {const items=[]; const visit=root=>{for(const el of root.querySelectorAll('*')){if(el.tagName==='EXTENSIONS-ITEM')items.push(el); if(el.shadowRoot)visit(el.shadowRoot);}}; visit(document); return items.map(el=>({name:el.shadowRoot.querySelector('#name')?.textContent.trim(), enabled:el.shadowRoot.querySelector('#enableToggle')?.checked}));})()`;
  evidence.environment.otherExtensions = await evaluate(manager, inventory);
  if (/helium/i.test(browser)) await until(() => evaluate(manager, inventory), items => items.some(item => /ublock/i.test(item.name)), 'Helium组件清单加载');
  await evaluate(manager, `(() => {const visit=root=>{for(const el of root.querySelectorAll('*')){if(el.tagName==='EXTENSIONS-ITEM' && /ublock/i.test(el.shadowRoot.querySelector('#name')?.textContent||'')){const toggle=el.shadowRoot.querySelector('#enableToggle');if(toggle?.checked)toggle.click();}if(el.shadowRoot)visit(el.shadowRoot);}};visit(document);})()`);
  evidence.environment.otherExtensions = await evaluate(manager, inventory);
  assert.ok(evidence.environment.otherExtensions.every(item => !item.enabled), '原生基线仍有其他启用扩展');
  await close(manager);
  const take = async () => {
    const page = await open(`${origin}/?position=1`);
    try { await until(() => evaluate(page, `document.querySelector('#result')?.dataset.complete`), value => value === 'true', '审计采样', 30000);
      return await evaluate(page, `JSON.parse(document.querySelector('#result').textContent)`); }
    finally { await close(page); }
  };
  const native = await take();
  evidence.scenarios.native = { observed: native, comparison: comparison(native, native), policy: { status: 'UNKNOWN', reason: '无扩展上下文，网页无法读取全局policy' } };
  const cspWorker = page => evaluate(page, `new Promise((done,fail)=>{const worker=new Worker('/entry-csp.js');const timer=setTimeout(()=>fail(new Error('CSP worker timeout')),4000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();done(event.data)};worker.onerror=()=>{clearTimeout(timer);fail(new Error('CSP worker failed'))}})`);
  const cspBaselinePage = await open(`${origin}/live.html`);
  evidence.workerEntryCsp = { native: await cspWorker(cspBaselinePage) }; await close(cspBaselinePage);
  assert.equal(evidence.workerEntryCsp.native.connectionAllowed, false);
  const extension = join(temporary, 'extension'); await cp(resolve('dist'), extension, { recursive: true });
  const { id } = await send('Extensions.loadUnpacked', { path: extension });
  const details = await open(`chrome://extensions/?id=${id}`);
  const toggleScript = `(() => {const visit=root=>{for(const el of root.querySelectorAll('*')){if(el.id==='allow-user-scripts')return el.shadowRoot?.querySelector('cr-toggle');if(el.shadowRoot){const found=visit(el.shadowRoot);if(found)return found;}}};const toggle=visit(document);if(!toggle)return null;toggle.scrollIntoView({block:'center'});const rect=toggle.getBoundingClientRect();return {checked:toggle.checked,x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`;
  const toggle = await until(() => evaluate(details, toggleScript), Boolean, '用户脚本正常开关');
  if (!toggle.checked) for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: toggle.x, y: toggle.y, button: 'left', clickCount: 1 }, details.sessionId);
  await until(() => evaluate(details, toggleScript), value => value?.checked === true); await close(details);
  const controller = await open(`chrome-extension://${id}/diagnostic/report.html`);
  const manifest = await evaluate(controller, 'chrome.runtime.getManifest()');
  evidence.contracts = { webAccessibleResources: manifest.web_accessible_resources?.length === 0 ? 'NATIVE' : 'OBSERVABLE',
    externallyConnectable: manifest.externally_connectable === undefined ? 'NATIVE' : 'OBSERVABLE',
    managementPermission: manifest.permissions.includes('management') ? 'OBSERVABLE' : 'NATIVE' };
  assert.deepEqual(manifest.web_accessible_resources, []); assert.equal(manifest.externally_connectable, undefined); assert.ok(!manifest.permissions.includes('management'));
  const stages = ['installed-off', 'language', 'timezone', 'geolocation', 'fonts', 'webrtc', 'preset-consistency', 'preset-native', 'preset-full', 'disabled-new-document'];
  const seed = createInitialConfig(); seed.rules = [createRule('localhost'), createRule('127.0.0.1')];
  seed.globalProfile.language = { enabled: false, mode: 'custom', language: 'fr-FR', languages: ['fr-FR', 'fr', 'en'] };
  seed.globalProfile.timezone = { enabled: false, mode: 'manual', timezone: 'Pacific/Honolulu' };
  seed.globalProfile.geolocation = { ...seed.globalProfile.geolocation, enabled: false, mode: 'manual', latitude: 0, longitude: 0, randomize: false, spoofPermission: true };
  for (const stage of stages) {
    if (stage === 'language') { seed.masterEnabled = true; seed.globalProfile.language.enabled = true; }
    if (stage === 'timezone') seed.globalProfile.timezone.enabled = true;
    if (stage === 'geolocation') seed.globalProfile.geolocation.enabled = true;
    if (stage === 'fonts') seed.fontExposure.enabled = true;
    if (stage === 'webrtc') seed.webRtc.globalMode = 'strict';
    if (stage.startsWith('preset-')) seed.rules.forEach(rule => { rule.compatibilityPreset = stage.slice(7); });
    if (stage === 'disabled-new-document') seed.masterEnabled = false;
    const saved = await message(controller, { action: 'setSiteConfig', config: seed });
    evidence.lastSyncReport = saved.syncReport;
    assert.equal(saved.saved, true, `配置未保存：${stage}`); assert.equal(saved.syncReport?.status, 'ok', `同步未完成：${stage}`);
    const registry = await evaluate(controller, `Promise.all([chrome.userScripts.getScripts(),chrome.scripting.getRegisteredContentScripts(),chrome.declarativeNetRequest.getDynamicRules()]).then(([page,font,headers])=>({page:page.map(item=>({id:item.id,matches:item.matches,excludeMatches:item.excludeMatches})),font:font.map(item=>({id:item.id,matches:item.matches,excludeMatches:item.excludeMatches})),headers:headers.length}))`);
    const policy = await evaluate(controller, 'chrome.privacy.network.webRTCIPHandlingPolicy.get({})');
    const observed = await take();
    evidence.scenarios[stage] = { comparison: comparison(native, observed), policy, registry, observed };
    const policyReference = evidence.scenarios['installed-off']?.policy;
    evidence.scenarios[stage].comparison.webRtcPolicy = compare(policyReference?.value, policy.value);
    const passive = ['language', 'timezone', 'descriptors', 'behavior', 'globals', 'fonts', 'dom'];
    const pageActive = !['installed-off', 'disabled-new-document', 'preset-native'].includes(stage);
    const geoActive = ['geolocation', 'fonts', 'webrtc', 'preset-full'].includes(stage);
    const fontsActive = ['fonts', 'webrtc', 'preset-full'].includes(stage);
    // 每个realm都必须取得实际样本，不能用顶层成功代替iframe/Worker。
    const realms = { top: observed, ...observed.frames };
    for (const [name, realm] of Object.entries(realms)) {
      assert.ok(realm.page, `${stage}/${name}缺少页面样本`);
      const baseline = name === 'top' ? native : native.frames[name];
      assert.deepEqual(realm.page.language.languages, pageActive ? seed.globalProfile.language.languages : baseline.page.language.languages);
      assert.equal(realm.page.timezone.timezone, pageActive && stage !== 'language' ? seed.globalProfile.timezone.timezone : baseline.page.timezone.timezone);
      assert.equal(realm.page.header.acceptLanguage, pageActive ? 'fr-FR,fr;q=0.9,en;q=0.8' : baseline.page.header.acceptLanguage);
      assert.equal(realm.page.permission.state, geoActive ? 'granted' : baseline.page.permission.state);
      if (geoActive) { assert.equal(realm.page.position.latitude, 0); assert.equal(realm.page.position.longitude, 0); assert.equal(realm.page.position.nativeCoordsGetter, 'OBSERVABLE'); }
      if (fontsActive) assert.deepEqual(realm.page.fonts.map(font => [font.family, font.check]), baseline.page.fonts.map(font => [font.family, font.check]));
      else assert.deepEqual(realm.page.fonts, baseline.page.fonts);
      assert.deepEqual(realm.page.dom.extensionUrls, []); assert.deepEqual(realm.page.dom.markers, []); assert.deepEqual(realm.page.globals, []);
      if (!pageActive) for (const key of passive) assert.deepEqual(realm.page[key], baseline.page[key], `${stage}/${name}/${key}`);
    }
    for (const [name, worker] of Object.entries(observed.workers)) {
      assert.ok(worker.language, `${stage}/${name}缺少Worker样本`);
      const patched = pageActive;
      assert.deepEqual(worker.language.languages, patched ? seed.globalProfile.language.languages : native.workers[name].language.languages);
      assert.equal(worker.timezone.timezone, patched && stage !== 'language' ? seed.globalProfile.timezone.timezone : native.workers[name].timezone.timezone);
    }
    if (['installed-off', 'disabled-new-document', 'preset-native'].includes(stage)) {
      for (const key of passive) assert.deepEqual(observed.page[key], native.page[key], `${stage} 新文档${key}不原生`);
      assert.equal(registry.page.length, 0); assert.equal(registry.font.length, 0); assert.equal(registry.headers, 0);
    }
    if (!['installed-off', 'disabled-new-document', 'preset-native'].includes(stage)) {
      assert.equal(observed.page.language.language, 'fr-FR');
      assert.equal(observed.page.header.acceptLanguage, 'fr-FR,fr;q=0.9,en;q=0.8');
    }
    if (stage === 'preset-consistency') {
      assert.deepEqual(observed.page.fonts, native.page.fonts); assert.ok(registry.font.every(item => item.id.startsWith('vanishgeo-live-bridge-')));
      assert.equal(observed.page.permission.state, native.page.permission.state);
      assert.ok(registry.page.every(item => !item.id.includes('geolocation')));
    }
    assert.deepEqual(observed.page.dom.extensionUrls, []); assert.deepEqual(observed.page.dom.markers, []); assert.deepEqual(observed.page.globals, []);
    console.log('采样完成', stage);
  }
  // 正式派发热更新与Shared身份：保持同一批文档，不reload，不从页面ack推定成功。
  seed.masterEnabled = true; seed.rules.forEach(rule => { rule.compatibilityPreset = 'full'; });
  await message(controller, { action: 'setSiteConfig', config: seed });
  const live = await open(`${origin}/live.html`), second = await open(`${origin}/live.html`);
  evidence.workerEntryCsp.wrapped = await cspWorker(live);
  assert.equal(evidence.workerEntryCsp.wrapped.connectionAllowed, true);
  const state = page => evaluate(page, `({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,first:JSON.parse(document.documentElement.dataset.first)})`);
  assert.deepEqual((await state(live)).first, { language: 'fr-FR', timezone: 'Pacific/Honolulu' });
  const shared = (page, key, type = 'classic') => evaluate(page, `new Promise((done,fail)=>{
    const worker=new SharedWorker('/shared-counter.js',{name:'vg045-${type}',type:${JSON.stringify(type)}});globalThis[${JSON.stringify(key)}]=worker;
    const timer=setTimeout(()=>fail(new Error('SharedWorker timeout')),4000);worker.onerror=()=>{clearTimeout(timer);fail(new Error('SharedWorker failed'))};
    worker.port.onmessage=event=>{clearTimeout(timer);done(event.data)};worker.port.start();})`);
  for (const type of ['classic', 'module']) {
    assert.equal((await shared(live, `shared1${type}`, type)).count, 1);
    assert.equal((await shared(live, `shared2${type}`, type)).count, 2);
    assert.equal((await shared(second, `sharedOther${type}`, type)).count, 1);
  }
  await evaluate(live, `globalThis.oldFormatter=new Intl.DateTimeFormat();globalThis.oldDate=Date;globalThis.oldLanguage=Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get;
    globalThis.blobURL=URL.createObjectURL(new Blob(['onmessage=()=>postMessage({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});'],{type:'text/javascript'}));
    globalThis.snapshotWorker=new Worker(blobURL);`);
  seed.globalProfile.language.language = 'de-DE'; seed.globalProfile.language.languages = ['de-DE', 'de']; seed.globalProfile.timezone.timezone = 'Europe/Berlin';
  assert.equal((await message(controller, { action: 'setSiteConfig', config: seed })).saved, true);
  await until(() => state(live), value => value.language === 'de-DE' && value.timezone === 'Europe/Berlin', '真实文档热更新');
  assert.equal((await state(live)).first.language, 'fr-FR');
  assert.equal(await evaluate(live, 'oldFormatter.resolvedOptions().timeZone'), 'Pacific/Honolulu');
  const workerSnapshot = await evaluate(live, `new Promise(done=>{snapshotWorker.onmessage=event=>done(event.data);snapshotWorker.postMessage(null)})`);
  assert.deepEqual(workerSnapshot, { language: 'fr-FR', timezone: 'Pacific/Honolulu' });
  const moduleContract = await evaluate(live, `new Promise((done,fail)=>{const worker=new Worker('/worker-contract-module.js',{type:'module'});const timer=setTimeout(()=>fail(new Error('module timeout')),4000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();done(event.data)};worker.onerror=()=>{clearTimeout(timer);fail(new Error('module failed'))}})`);
  assert.deepEqual(moduleContract, { relativeImport: true, relativeURL: 'TypeError', entryIsBlob: true, businessIsHttp: true, language: 'de-DE', timezone: 'Europe/Berlin' });
  assert.equal((await shared(live, 'sharedNew')).count, 1);
  await message(controller, { action: 'setExtensionEnabled', enabled: false });
  await until(() => state(live), value => value.language === native.page.language.language && value.timezone === native.page.timezone.timezone, '真实文档关闭恢复');
  assert.equal(await evaluate(live, 'oldLanguage.call(navigator)'), native.page.language.language);
  await evaluate(live, `snapshotWorker.terminate();URL.revokeObjectURL(blobURL);for(const key of ['shared1classic','shared2classic','shared1module','shared2module','sharedNew'])globalThis[key].port.close()`);
  await evaluate(second, `sharedOtherclassic.port.close();sharedOthermodule.port.close()`);
  evidence.scenarios.liveContracts = { firstInline: true, actualSameDocumentUpdate: true, clearRestoresNative: true, existingFormatterRetained: true,
    existingWorkerSnapshot: true, moduleRelativeImportAndTla: true, globalRelativeUrlChanged: true, samePageSharedReused: true,
    crossPageSharedSeparated: true, changedGenerationSharedSeparated: true };
  await close(live); await close(second);
  // 正式Options及action Popup事件链：父域继承转为当前域名子规则，保存后读回。
  seed.masterEnabled = true;
  const parent = createRule('vg-audit.test');
  parent.overrides.language = { mode: 'override', value: { enabled: true, mode: 'custom', language: 'de-DE', languages: ['de-DE', 'de'] } };
  seed.rules = [parent];
  assert.equal((await message(controller, { action: 'setSiteConfig', config: seed })).saved, true);
  const options = await open(`chrome-extension://${id}/options/options.html`);
  evidence.uiPhase = 'options';
  const selectPreset = `document.querySelector('select[aria-label="vg-audit.test 的兼容性预设"]')`;
  await until(() => evaluate(options, `${selectPreset}?.value`), value => value === 'full');
  await evaluate(options, `${selectPreset}.value='consistency';${selectPreset}.dispatchEvent(new Event('change'));document.querySelector('#save').click()`);
  await until(async () => (await message(controller, { action: 'getSiteConfig' })).config.rules[0].compatibilityPreset, value => value === 'consistency');
  await evaluate(options, `${selectPreset}.scrollIntoView({block:'center'})`);
  const optionsImage = await send('Page.captureScreenshot', { format: 'png' }, options.sessionId);
  await writeFile(output.replace(/\.json$/, '-options.png'), Buffer.from(optionsImage.data, 'base64'));
  await close(options);
  const site = await open(`http://site.vg-audit.test:${server.address().port}/empty`);
  await send('Target.activateTarget', { targetId: site.targetId });
  evidence.uiPhase = 'action-popup';
  await evaluate(controller, 'chrome.action.openPopup()');
  const popupTarget = await until(async () => (await send('Target.getTargets')).targetInfos.find(target => target.url === `chrome-extension://${id}/popup/popup.html`), Boolean, 'action Popup');
  const { sessionId } = await send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true });
  const popup = { targetId: popupTarget.targetId, sessionId };
  await until(() => evaluate(popup, `document.querySelector('#currentSite').textContent`), value => value === 'site.vg-audit.test');
  await evaluate(popup, `document.querySelector('#currentSitePreset').value='native';document.querySelector('#currentSitePreset').dispatchEvent(new Event('change'))`);
  const uiConfig = await until(async () => (await message(controller, { action: 'getSiteConfig' })).config,
    value => value.rules.some(rule => rule.domain === 'site.vg-audit.test' && rule.compatibilityPreset === 'native'));
  assert.equal(uiConfig.rules.find(rule => rule.domain === parent.domain).compatibilityPreset, 'consistency');
  const childRule = uiConfig.rules.find(rule => rule.domain === 'site.vg-audit.test');
  assert.deepEqual(childRule.overrides, parent.overrides); assert.equal(childRule.exitLocationProfileId, parent.exitLocationProfileId);
  evidence.ui = { optionsPresetSaved: true, actualActionPopup: true, inheritedPresetCreatesChild: true, advancedOverridesPreserved: true,
    parentPreset: 'consistency', childPreset: 'native' };
  await until(() => evaluate(popup, `document.querySelector('#siteStatusBadge').textContent`), value => value.includes('native'));
  await evaluate(popup, `document.querySelector('#currentSitePreset').scrollIntoView({block:'center'})`);
  const popupImage = await send('Page.captureScreenshot', { format: 'png' }, popup.sessionId);
  await writeFile(output.replace(/\.json$/, '-popup.png'), Buffer.from(popupImage.data, 'base64'));
  await close(popup); await close(site);
  await message(controller, { action: 'setExtensionEnabled', enabled: false });
  const personaDirectory = join(temporary, 'persona');
  execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/build-persona.mjs'), '--dist', resolve('dist'),
    '--out', personaDirectory, '--preset', 'singapore', '--domains', 'localhost,127.0.0.1'], { stdio: 'pipe' });
  const personaManifest = JSON.parse(await readFile(join(personaDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual(personaManifest.permissions, []); assert.equal(personaManifest.background, undefined);
  assert.equal(personaManifest.options_page, undefined); assert.equal(personaManifest.action.default_popup, undefined);
  await send('Extensions.loadUnpacked', { path: personaDirectory });
  const personaPage = await open(`${origin}/live.html`);
  const preset = ENVIRONMENT_PRESETS.find(item => item.id === 'singapore');
  assert.deepEqual((await state(personaPage)).first, { language: preset.language, timezone: preset.timezone });
  const personaWorker = await evaluate(personaPage, `new Promise((done,fail)=>{const worker=new Worker('/worker-contract-module.js',{type:'module'});const timer=setTimeout(()=>fail(new Error('persona worker timeout')),4000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();done(event.data)};worker.onerror=()=>{clearTimeout(timer);fail(new Error('persona worker failed'))}})`);
  assert.equal(personaWorker.language, preset.language); assert.equal(personaWorker.timezone, preset.timezone);
  evidence.persona = { artifactKind: 'persona-language-timezone', firstInline: true, httpModuleWorkerSnapshot: true,
    noBackgroundOrManagementEntry: true, apiPermissions: [], fullGeolocationFontPersona: 'NOT_INCLUDED' };
  await close(personaPage);
  delete evidence.uiPhase;
  evidence.status = 'OBSERVABLE';
} catch (error) {
  evidence.errors.push(String(error.message).replaceAll(temporary, '<temporary>').replaceAll(resolve('.'), '<project>'));
  process.exitCode = 1;
} finally {
  for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('审计结束')); } pending.clear(); socket?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise(done => child.once('exit', done)); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
  }
  await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, scenarios: Object.keys(evidence.scenarios), errors: evidence.errors }));
}
