#!/usr/bin/env node
// VG-026：真实 Chrome 临时 profile；provider 请求在发出前拦截并返回合成响应。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const pageEffects = args.includes('--page-effects');
const uiSignals = option('--ui-signal-dir');
if (pageEffects) assert.ok(uiSignals && existsSync(uiSignals), '页面效果模式需要 --ui-signal-dir');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(80); }
  throw new Error('VG-026 等待浏览器状态超时');
}

async function withChrome(work) {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '未找到 Chrome；可设置 CHROME_BIN');
  assert.equal(typeof WebSocket, 'function', '需要 Node 22+ 原生 WebSocket');
  const temp = await mkdtemp(join(tmpdir(), 'vanishgeo-onboarding-'));
  const child = spawn(chrome, [...(pageEffects ? [] : ['--headless=new']), '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`, '--disable-background-networking', '--no-proxy-server', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-026 Chrome协议超时：${method}`)); }, 20000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id); if (!request) return;
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.fail(new Error(`VG-026 Chrome协议失败：${message.error.message}`));
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
            body: Buffer.from(JSON.stringify({ success: true, ip: '203.0.113.10', latitude: 0, longitude: 0, country: 'Synthetic', country_code: 'JP', timezone: { id: 'Asia/Tokyo' } })).toString('base64') }, sessionId);
        } else if (message.method === 'Page.javascriptDialogOpening') {
          dialogs.push(params.type);
          await send('Page.handleJavaScriptDialog', { accept: true, promptText: '合成出口' }, sessionId);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push('Runtime exception');
      })().catch((error) => errors.push(error.message));
    };
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const evaluate = async (page, expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
      assert.ok(!result.exceptionDetails, 'VG-026 扩展页面执行失败');
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
    assert.deepEqual(errors, [], 'VG-026 浏览器异常');
    return result;
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-026 smoke结束')); }
    pending.clear(); socket?.close();
    if (child.exitCode === null) { const ended = new Promise((done) => child.once('exit', done)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); }
    await rm(temp, { recursive: true, force: true });
    evidence.cleanup = 'PASS';
  }
}

// 页面fixture仅绑定loopback；首inline直接观测，不携带扩展预期配置。
let fixture;
async function fingerprint() {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    for (const entry of (await readdir(join(dist, relative), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (!relative && entry.name === '_metadata') continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else { hash.update(path); hash.update(await readFile(join(dist,path))); }
    }
  }
  await visit(); return hash.digest('hex');
}
async function startFixture() {
  const server = createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const header = req.headers['accept-language'] || '';
    if (req.url === '/echo') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({header})); return; }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><script>
      const ctx=document.createElement('canvas').getContext('2d');
      function width(font){ctx.font='32px '+font;return ctx.measureText('Wim中文012').width;}
      globalThis.snapshot={firstInline:true,language:navigator.language,languages:[...navigator.languages],
        timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,header:${JSON.stringify(header)},
        fonts:{pingfang:document.fonts.check('16px "PingFang SC"'),times:width('"Times New Roman"'),sans:width('sans-serif'),serif:width('serif')},
        geolocationAvailable:typeof navigator.geolocation.getCurrentPosition==='function'};
      fetch('/echo').then(r=>r.json()).then(r=>snapshot.subresourceHeader=r.header);
    </script></head><body>VG-026 loopback observation</body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,port:server.address().port};
}
async function readSavedState(c, options) {
  return c.evaluate(options, `(async()=>({config:(await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig,syncReport:(await chrome.storage.session.get('runtimeSyncMetadata')).runtimeSyncMetadata.report}))()`);
}
async function readWebRtc(c, options) {
  return c.evaluate(options, `chrome.privacy.network.webRTCIPHandlingPolicy.get({}).then(s=>({value:s.value,levelOfControl:s.levelOfControl}))`);
}
async function probe(c, host) {
  const target = await c.page(`http://${host}:${fixture.port}/probe`);
  const value = await until(()=>c.evaluate(target,'globalThis.snapshot || null'),v=>v && typeof v.subresourceHeader==='string');
  await c.send('Target.closeTarget',{targetId:target.targetId});
  return value;
}

// 复用仓库CDP验收脚本；用户脚本开关由原生UI操作，不改浏览器偏好文件。
const evidence={task:'VG-026',result:'BLOCKED',chrome:null,checks:{},cleanup:'UNKNOWN',failure:null,
  environment:{temporaryProfile:true,headed:pageEffects,installation:'CDP Extensions.loadUnpacked',optionsInteraction:'DOM events on actual Options page',provider:'CDP fulfilled synthetic response before external transmission',fixture:'HTTP loopback only'},
  mode:pageEffects?'options-page-effects-and-native-restore':'options-save-only',
  limitations:[pageEffects?'仅当前macOS/Chrome、HTTP loopback、顶层新文档；未覆盖iframe、BFCache、重启或真实TLS':'未开启Allow User Scripts，本轮验证推荐保存与准确partial，不重复语言时区资格',
    '未验证真实action popup、其他浏览器或真实provider定位精度']};
try {
  evidence.distSha256 = await fingerprint();
  if (pageEffects) fixture = await startFixture();
  await withChrome(async c=>{
    evidence.chrome=c.browser;
    if (pageEffects) evidence.native = await probe(c, 'localhost');
    const {id}=await c.send('Extensions.loadUnpacked',{path:dist});
    const url=`chrome-extension://${id}/options/options.html`;
    const options=await c.page(url);
    await until(()=>c.evaluate(options,`document.getElementById('setupStatus')?.dataset.setup`),v=>v==='unconfigured');
    assert.equal(await c.evaluate(options,'document.title'),'VanishGeo 配置');
    assert.equal(await c.evaluate(options,'document.body.innerText.length>200'),true);
    assert.equal(c.providerRequests.length,0);
    if(pageEffects) evidence.nativeWebRtc = await readWebRtc(c,options);
    for(const id of ['onboardingLanguage','onboardingFontExposure','onboardingWebRtc'])
      assert.equal(await c.evaluate(options,`document.getElementById(${JSON.stringify(id)}).value`),'keep');
    evidence.checks.safeDefaultsAndNoImplicitRequest=true;
    await c.evaluate(options,`document.getElementById('onboardingEnable').click()`);
    assert.match(await c.evaluate(options,`document.getElementById('onboardingStatus').textContent`),/勾选明确启用/);
    assert.equal((await c.message(options,{action:'getSiteConfig'})).config.masterEnabled,false);
    evidence.checks.confirmationRequired=true;
    c.allowSyntheticProvider();
    await c.evaluate(options,`document.getElementById('onboardingDetect').click()`);
    await until(()=>c.evaluate(options,`document.getElementById('onboardingProfile').options.length`),v=>v===2);
    assert.equal(c.providerRequests.length,1);
    assert.deepEqual(c.dialogs,['confirm','prompt']);
    const confirmed=(await c.message(options,{action:'getSiteConfig'})).config;
    assert.equal(confirmed.exitLocationProfiles[0].verification,'verified');
    assert.equal(confirmed.exitLocationProfiles[0].countryCode,'JP');
    assert.equal(confirmed.masterEnabled,false);assert.equal(confirmed.rules.length,0);
    evidence.checks.activeDetectionConfirmedBeforeRecommendation=true;
    await c.evaluate(options,`document.getElementById('onboardingProfile').selectedIndex=1;
      document.getElementById('onboardingProfile').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('onboardingDomains').value='localhost';
      document.getElementById('onboardingDomains').dispatchEvent(new Event('input',{bubbles:true}));`);
    const text=await c.evaluate(options,`document.getElementById('onboardingRecommendation').textContent`);
    assert.match(text,/JP/);assert.match(text,/ja-JP/);assert.match(text,/未交叉验证/);
    assert.match(text,/全局语言、时区和地理位置设置不改/);
    assert.equal((await c.message(options,{action:'getSiteConfig'})).config.rules.length,0);
    assert.equal(c.providerRequests.length,1);evidence.checks.viewOnlyRecommendationDoesNotSave=true;
    await c.evaluate(options,`document.getElementById('onboardingConfirm').checked=true;
      document.getElementById('onboardingEnable').click()`);
    await until(()=>c.evaluate(options,`document.getElementById('setupStatus').dataset.setup`),v=>v==='enabled');
    await until(()=>c.evaluate(options,`document.getElementById('onboardingEnable').disabled`),v=>v===false);
    const kept=await c.message(options,{action:'getSiteConfig'});
    assert.deepEqual(kept.config.globalProfile,confirmed.globalProfile);
    assert.equal(kept.config.rules.length,1);assert.equal(kept.config.rules[0].domain,'localhost');
    assert.equal(kept.config.rules[0].overrides.language.mode,'inherit');
    assert.equal(kept.config.rules[0].overrides.timezone.value.mode,'auto');
    assert.equal(kept.config.webRtc.globalMode,'default');assert.equal(kept.config.fontExposure.enabled,false);
    assert.equal(kept.syncReport.status,'partial');assert.equal(kept.syncReport.pageRuntime.state,'switch-required');
    assert.match(await c.evaluate(options,`document.getElementById('onboardingStatus').textContent`),/已保存但未完全生效/);
    evidence.checks.keepLanguageAndGlobalPoliciesExplicitSave=true;
    evidence.checks.userSwitchRequiredReportedAsPartial=true;
    await c.evaluate(options,`document.getElementById('onboardingProfile').selectedIndex=1;
      document.getElementById('onboardingProfile').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('onboardingLanguage').value='exit';
      document.getElementById('onboardingLanguage').dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('onboardingFontExposure').value='vendor-software';
      document.getElementById('onboardingFontExposure').dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(await c.evaluate(options,`document.getElementById('onboardingConfirm').checked`),false);
    await c.evaluate(options,`document.getElementById('onboardingConfirm').checked=true;
      document.getElementById('onboardingEnable').click()`);
    await until(async()=>{const r=await c.message(options,{action:'getSiteConfig'});return r.config.rules[0].overrides.language.value?.language==='ja-JP'});
    const applied=await c.message(options,{action:'getSiteConfig'});
    assert.equal(applied.config.rules[0].overrides.language.value.enabled,true);
    assert.equal(applied.config.fontExposure.enabled,true);assert.equal(applied.config.fontExposure.mode,'vendor-software');
    assert.equal(applied.config.webRtc.globalMode,'default');assert.deepEqual(applied.config.globalProfile,confirmed.globalProfile);
    assert.equal(await c.evaluate(options,'chrome.scripting.getRegisteredContentScripts().then(s=>s.length===1&&s[0].js[0]==="font-exposure/filter.js")'),true);
    assert.equal(applied.syncReport.fontRuntime.state,'ready');
    assert.equal(await c.evaluate(options,'document.getElementById("fontExposureStatus").dataset.fontRuntime'), 'ready');
    assert.equal(c.providerRequests.length,1);evidence.checks.explicitExitLanguageAndAuthorizedFixedFontRegistration=true;
    if (pageEffects) {
      const details = await c.page(`chrome://extensions/?id=${id}`);
      await c.send('Page.bringToFront',{},details.sessionId);
      console.log('VG026_NATIVE_UI_REQUIRED allow-user-scripts');
      await until(()=>existsSync(join(uiSignals,'user-scripts-enabled')),Boolean,240000);
      assert.equal(await c.evaluate(options, 'chrome.userScripts.getScripts().then(()=>true).catch(()=>false)'), true);
      evidence.checks.normalAllowUserScriptsEnabled = true;
      // 正常Options再次明确提交，使生产对账在开关启用后完成。
      await c.evaluate(options, `document.getElementById('onboardingWebRtc').value='compatible'; document.getElementById('onboardingWebRtc').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('onboardingConfirm').checked=true; document.getElementById('onboardingEnable').click()`);
      await until(()=>c.evaluate(options,`!document.getElementById('onboardingEnable').disabled`));
      assert.equal(await c.evaluate(options, `document.getElementById('runtimeSyncStatus').dataset.status`),'ok');
      const ready = await readSavedState(c,options);
      evidence.enabledWebRtc = await readWebRtc(c,options);
      assert.equal(evidence.enabledWebRtc.value,'default_public_interface_only');
      assert.equal(evidence.enabledWebRtc.levelOfControl,'controlled_by_this_extension');
      assert.equal(ready.syncReport.status,'ok');
      evidence.appliedSync = { status:ready.syncReport.status,page:ready.syncReport.pageRuntime.state,font:ready.syncReport.fontRuntime.state,headers:ready.syncReport.components.headers.status };
      evidence.enabled = await probe(c,'localhost');
      evidence.unmatched = await probe(c,'127.0.0.1');
      assert.equal(evidence.enabled.language,'ja-JP');
      assert.deepEqual(evidence.enabled.languages,['ja-JP','ja']);
      assert.equal(evidence.enabled.timezone,'Asia/Tokyo');
      assert.equal(evidence.enabled.header,'ja-JP,ja;q=0.9');
      assert.equal(evidence.enabled.subresourceHeader,evidence.enabled.header);
      assert.notEqual(evidence.native.language,evidence.enabled.language,'原生语言必须有正负区分');
      assert.notEqual(evidence.native.timezone,evidence.enabled.timezone,'原生时区必须有正负区分');
      assert.equal(evidence.native.fonts.pingfang,true,'字体check原生对照必须可区分');
      assert.notEqual(evidence.native.fonts.times,evidence.native.fonts.sans,'测量原生对照必须可区分');
      assert.equal(evidence.enabled.fonts.pingfang,false);
      assert.equal(evidence.enabled.fonts.times,evidence.enabled.fonts.sans);
      assert.equal(evidence.enabled.fonts.sans,evidence.native.fonts.sans);
      assert.equal(evidence.enabled.fonts.serif,evidence.native.fonts.serif);
      assert.deepEqual(evidence.unmatched,evidence.native);
      evidence.checks.selectedPageFirstInlineLanguageTimezoneHeaderAndFonts = true;
      evidence.checks.unmatchedPageRemainsNative = true;
      // 关闭走Options实际保存入口；等待当前保存完成后再创建新文档。
      await c.evaluate(options, `document.getElementById('globalEnabled').checked=false; document.getElementById('save').click()`);
      await until(()=>c.evaluate(options,`document.getElementById('runtimeSyncStatus').dataset.status`),v=>v==='ok');
      const off = await readSavedState(c,options);
      evidence.disabledWebRtc = await readWebRtc(c,options);
      assert.deepEqual(evidence.disabledWebRtc,evidence.nativeWebRtc);
      evidence.checks.explicitWebRtcPolicyAndMasterOffRestore = true;
      assert.equal(off.config.masterEnabled,false); assert.equal(off.syncReport.status,'ok');
      evidence.disabled = await probe(c,'localhost');
      assert.deepEqual(evidence.disabled,evidence.native);
      const registries = await c.evaluate(options, `(async()=>({userScripts:(await chrome.userScripts.getScripts()).map(s=>s.id),contentScripts:(await chrome.scripting.getRegisteredContentScripts()).map(s=>s.id),dynamic:(await chrome.declarativeNetRequest.getDynamicRules()).map(r=>r.id),session:(await chrome.declarativeNetRequest.getSessionRules()).map(r=>r.id)}))()`);
      assert.deepEqual(registries,{userScripts:[],contentScripts:[],dynamic:[],session:[]});
      evidence.disabledRegistries = registries;
      evidence.checks.optionsMasterOffNewDocumentRestoresNative = true;
      evidence.checks.noManagementReconciliationBetweenUiSaveAndPageProbe = true;
      evidence.checks.disabledRegistrationsAndHeaderRulesEmpty = true;
      assert.equal(c.providerRequests.length,1);
      evidence.checks.syntheticProviderOnlyOneExplicitRequest = true;
    }
    assert.equal(c.errors.length,0);evidence.checks.noRuntimeExceptions=true;
  });
  assert.equal(await fingerprint(),evidence.distSha256);
  evidence.checks.unmodifiedDist=true;
  evidence.result='PASS';
} catch(error) {
  evidence.failure={kind:error.code==='ERR_ASSERTION'?'assertion':'environment-or-automation',
    reason:error.message.replace(/\/Users\/[^\s:]+/g,'<user-path>').slice(0,200)};
  process.exitCode=2;
} finally {
  if(fixture) await new Promise(resolve=>fixture.server.close(resolve));
  const output=option('--output');if(output)await writeFile(resolve(output),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}
