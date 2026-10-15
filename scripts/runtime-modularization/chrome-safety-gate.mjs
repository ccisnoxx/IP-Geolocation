#!/usr/bin/env node
// Node 22+；真实 Chrome 安全暂停验证，只使用临时 dist 副本/profile 与本地合成页面。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('参数：--output <脱敏JSON>');
const disableBfcache = false;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept = Boolean) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error('VG-011 安全闸门验证等待超时');
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const closed = new Promise(done => socket.addEventListener('close',done,{once:true}));
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`VG-011 CDP ${request.method} 失败`));
    else request.done(message.result);
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-011 CDP ${method} 超时`)); }, 20000);
        pending.set(id, { done, fail, timer, method });
        socket.send(JSON.stringify({id, method, params, sessionId}));
      });
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('调查已关闭')); }
      pending.clear(); socket.close(); return closed;
    }
  };
}

async function withChrome(prepare, work) {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome || typeof WebSocket !== 'function') throw new Error('需要 Chrome 与 Node22+');
  const temporary = await mkdtemp(join(tmpdir(), 'vg011-safety-'));
  let child;
  let cdp;
  try {
    const extension = join(temporary, 'extension');
    await mkdir(extension);
    await prepare(extension);
    const profile = join(temporary, 'profile');
    child = spawn(chrome, ['--headless=new','--enable-unsafe-extension-debugging','--remote-debugging-port=0',`--user-data-dir=${profile}`,
      '--disable-background-networking','--no-first-run','--no-default-browser-check',
      ...(disableBfcache ? ['--disable-features=BackForwardCache'] : []),'about:blank'], {stdio:'ignore'});
    let launchError = false;
    child.once('error', () => { launchError = true; });
    const port = await until(async () => {
      if (launchError) throw new Error('Chrome 启动失败');
      try { return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; } catch { return null; }
    });
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    cdp = await connect(version.webSocketDebuggerUrl);
    const {id} = await cdp.send('Extensions.loadUnpacked', {path:extension});
    const attach = async (targetId) => (await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
    const evaluate = async (sessionId, expression) => {
      const response = await cdp.send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true},sessionId);
      if (response.exceptionDetails) {
        const summary=(response.exceptionDetails.exception?.description??response.exceptionDetails.text).split('\n')[0]
          .replace(/[A-Fa-f0-9]{32}/g,'<document>').replace(/chrome-extension:\/\/[^/]+/g,'<extension>');
        throw new Error(`调查探针执行异常：${summary}`);
      }
      return response.result.value;
    };
    const createPage = async (path) => {
      const {targetId} = await cdp.send('Target.createTarget',{url:`chrome-extension://${id}/${path}`});
      const sessionId = await attach(targetId);
      await until(() => evaluate(sessionId,'document.readyState'), (v) => v === 'complete');
      return sessionId;
    };
    return await work({id, cdp, attach, evaluate, createPage, browser:version.Browser});
  } finally {
    await cdp?.close();
    if (child?.pid && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit',done)); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'),5000); await exited; clearTimeout(force);
    }
    await rm(temporary,{recursive:true,force:true});
  }
}

// 测试专用 wrapper 只计数和延迟可信初始化通知；生产入口及权限逐字保持。
const hooks = `
const trace={dispatches:0,mainDispatches:0,arm:false,pending:null,pendingDocument:null,outcomes:[]};
globalThis.__vg011Gate=trace;
const execute=chrome.scripting.executeScript.bind(chrome.scripting);
chrome.scripting.executeScript=details=>{
  trace.dispatches++;if(details.world==='MAIN')trace.mainDispatches++;
  return execute(details);
};
const add=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
chrome.runtime.onMessage.addListener=listener=>add((request,sender,respond)=>{
  const reply=value=>{
    if(request?.action==='initializeRuntimeForSender') trace.outcomes.push({status:value?.status,paused:/页面伪装已暂停/.test(value?.message||''),hasPayload:Boolean(value?.payload)});
    respond(value);
  };
  if(request?.action==='initializeRuntimeForSender'&&trace.arm){
    trace.arm=false;trace.pendingDocument=sender.documentId;
    trace.pending=()=>{listener(request,sender,reply);trace.pending=null;};return true;
  }
  return listener(request,sender,reply);
});
`;

// 快照只存在于测试页面，不接收配置。引用/descriptor 与原生函数 source 分别检查。
const fixtureScript = `
(()=>{
 const surfaces=[
  [Navigator.prototype,'language'],[Navigator.prototype,'languages'],[window,'Date'],
  ...['DateTimeFormat','NumberFormat','Collator','PluralRules','RelativeTimeFormat','ListFormat','DisplayNames'].map(k=>[Intl,k]),
  [Date.prototype,'getTimezoneOffset'],[Date.prototype,'getFullYear'],[Date.prototype,'toString'],
  [Geolocation.prototype,'getCurrentPosition'],[Geolocation.prototype,'watchPosition'],[Geolocation.prototype,'clearWatch'],
  [Permissions.prototype,'query'],[CanvasRenderingContext2D.prototype,'font'],
  [CanvasRenderingContext2D.prototype,'measureText'],[CanvasRenderingContext2D.prototype,'fillText'],
  [window,'Worker'],[window,'SharedWorker'],[Function.prototype,'toString'],
  [Object,'getOwnPropertySymbols'],[Object,'getOwnPropertyNames'],[Object,'getOwnPropertyDescriptor'],[Reflect,'ownKeys']
 ];
 const source=Function.prototype.toString, descriptor=Object.getOwnPropertyDescriptor;
 const originals=surfaces.map(([owner,key])=>descriptor(owner,key));
 const initialNative=originals.every(d=>!d||['value','get','set'].every(k=>typeof d[k]!=='function'||source.call(d[k]).includes('[native code]')));
 const token=crypto.randomUUID();let persisted=false;
 addEventListener('pageshow',event=>{persisted=event.persisted;});
 window.__vg011Read=()=>({token,persisted,initialNative,
  unchanged:surfaces.every(([owner,key],i)=>{const a=descriptor(owner,key),b=originals[i];return JSON.stringify(a&&[a.configurable,a.enumerable,a.writable])===JSON.stringify(b&&[b.configurable,b.enumerable,b.writable])&&['value','get','set'].every(k=>a?.[k]===b?.[k]);}),
  language:navigator.language,timezone:new Intl.DateTimeFormat().resolvedOptions().timeZone,ready:document.readyState});
})();
`;
const server=createServer((request,response)=>{
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; worker-src 'self'"});
  response.end(`<title>VG011 gate fixture</title><script>${fixtureScript}</script>${request.url==='/gate-frame'?'':'<iframe src="/gate-frame"></iframe>'}`);
});
try {
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port, origin=`http://localhost:${port}`;
  const record=await withChrome(async extension=>{
    await cp(join(root,'dist'),extension,{recursive:true});
    const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
    manifest.background.service_worker='background/safety-wrapper.js';
    await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
    await writeFile(join(extension,'background/safety-hooks.js'),hooks);
    await writeFile(join(extension,'background/safety-wrapper.js'),"import './safety-hooks.js';\nimport './service-worker.js';\n");
    for(const file of ['background/service-worker.js','content/content.js']) assert.equal(await readFile(join(extension,file),'utf8'),await readFile(join(root,'dist',file),'utf8'));
    const original=JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8'));
    for(const field of ['permissions','host_permissions','web_accessible_resources'])assert.deepEqual(manifest[field],original[field]);
  },async c=>{
    const options=await c.createPage('options/options.html');
    const message=request=>c.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
    async function workerSession(){
      const worker=await until(async()=> (await c.cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${c.id}/background/safety-wrapper.js`));
      const session=await c.attach(worker.targetId);
      await until(()=>c.evaluate(session,'Boolean(globalThis.__vg011Gate)'));
      return session;
    }
    let sw=await workerSession();
    const config={masterEnabled:true,rules:[{id:'synthetic-localhost',domain:'localhost',enabled:true}],webRtc:{globalMode:'strict'},globalProfile:{
      language:{enabled:true,mode:'custom',language:'fr-FR',languages:['fr-FR','fr'],acceptLanguage:'fr-FR,fr;q=0.9'},
      timezone:{enabled:true,mode:'manual',timezone:'Pacific/Honolulu'},
      geolocation:{enabled:true,mode:'manual',latitude:0,longitude:0,accuracy:50}},canvas:{enabled:true,spoofFonts:true,targetFonts:['Arial']}};
    function assertPaused(response){
      assert.equal(response.syncReport.status,'partial');
      assert.equal(response.syncReport.components.contentScripts.status,'partial');
      assert.equal(response.syncReport.components.contentScripts.errors[0].code,'runtime-injection-paused');
      assert.equal(response.syncReport.components.dnr.status,'ok');
      assert.equal(response.syncReport.components.webrtc.status,'ok');
    }
    const saved=await message({action:'setSiteConfig',config});assertPaused(saved);
    const observe=tabId=>c.evaluate(options,`chrome.scripting.executeScript({target:{tabId:${tabId},allFrames:true},world:'MAIN',func:()=>window.__vg011Read?.()})`);
    async function loaded(tabId,previous){
      return until(()=>observe(tabId),rows=>rows.length===2&&rows.every(r=>r.result?.ready==='complete')&&(!previous||rows[0].result.token!==previous));
    }
    function assertNative(rows){
      for(const row of rows){assert.equal(row.result.initialNative,true);assert.equal(row.result.unchanged,true);assert.notEqual(row.result.language,'fr-FR');assert.notEqual(row.result.timezone,'Pacific/Honolulu');}
    }
    const tab=await c.evaluate(options,`chrome.tabs.create({url:${JSON.stringify(`${origin}/gate-a`)}})`);
    let before=await loaded(tab.id);assertNative(before);
    const tabTarget=await until(async()=> (await c.cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===`${origin}/gate-a`));
    const page=await c.attach(tabTarget.targetId);
    async function queueOldInitialization(){
      await c.evaluate(sw,'__vg011Gate.arm=true');
      // 不等待被延迟通知的响应；Chrome 自己生成 sender.documentId，未提供配置。
      await c.evaluate(options,`chrome.scripting.executeScript({target:{tabId:${tab.id},frameIds:[0]},world:'ISOLATED',func:()=>{chrome.runtime.sendMessage({action:'initializeRuntimeForSender'},()=>void chrome.runtime.lastError);}});true`);
      await until(()=>c.evaluate(sw,'Boolean(__vg011Gate.pending)'));
      const old=await c.evaluate(sw,'__vg011Gate.pendingDocument');assert.equal(old,before[0].documentId);
      return old;
    }
    async function releaseAndCheck(old){
      const count=await c.evaluate(sw,'__vg011Gate.outcomes.length');
      await c.evaluate(sw,'__vg011Gate.pending();true');
      const outcome=await until(()=>c.evaluate(sw,`__vg011Gate.outcomes[${count}]`));
      assert.equal(outcome.status,'error');assert.equal(outcome.paused,true);assert.equal(outcome.hasPayload,false);
      const rows=await loaded(tab.id);assertNative(rows);
      const trace=await c.evaluate(sw,'({dispatches:__vg011Gate.dispatches,main:__vg011Gate.mainDispatches})');
      assert.equal(trace.dispatches,0);assert.equal(trace.main,0);
      return {rejectedBeforeDispatch:true,productionRuntimeDispatches:0,pageAndIframeApisNative:true,documentChanged:rows[0].documentId!==old};
    }
    const cases={};
    let old=await queueOldInitialization();
    const oldToken=before[0].result.token;
    await c.evaluate(page,`location.assign(${JSON.stringify(`${origin}/gate-b`)});true`);
    await loaded(tab.id,oldToken);
    cases.bfcache=await releaseAndCheck(old);
    await c.evaluate(page,'history.back();true');
    before=await until(()=>observe(tab.id),rows=>rows.length===2&&rows[0].result?.token===oldToken&&rows[0].result.persisted);
    assertNative(before);cases.bfcache.restoredWithPersistedTrue=true;
    assert.equal(before[0].documentId,old);
    // BFCache 恢复后再通知也必须拒绝，不能仅覆盖替换文档。
    await queueOldInitialization();await releaseAndCheck(old);
    old=await queueOldInitialization();
    await c.evaluate(page,`location.assign(${JSON.stringify(`http://127.0.0.1:${port}/gate-cross`)});true`);
    await loaded(tab.id,before[0].result.token);
    cases.crossOrigin=await releaseAndCheck(old);assert.equal(cases.crossOrigin.documentChanged,true);
    // 非 allowlist 替换页仍是原生；回到 allowlist，再做同 URL reload。
    const crossToken=(await loaded(tab.id))[0].result.token;
    await c.evaluate(page,`location.assign(${JSON.stringify(`${origin}/gate-reload`)});true`);
    before=await loaded(tab.id,crossToken);assertNative(before);
    old=await queueOldInitialization();
    const reloadToken=before[0].result.token;
    await c.evaluate(page,'location.reload();true');
    await loaded(tab.id,reloadToken);
    cases.sameUrlReload=await releaseAndCheck(old);assert.equal(cases.sameUrlReload.documentChanged,true);
    // 旧版本残留的动态脚本通过当前对账撤销；不得通过保存/重试再次注册。
    const seedScript=()=>c.evaluate(options,"chrome.scripting.registerContentScripts([{id:'vanishgeo-runtime-init',matches:['http://localhost/*'],js:['content/content.js'],runAt:'document_start',world:'ISOLATED',allFrames:true,persistAcrossSessions:true}])");
    await seedScript();
    assertPaused(await message({action:'reconcileRuntime'}));
    assert.deepEqual(await c.evaluate(options,"chrome.scripting.getRegisteredContentScripts({ids:['vanishgeo-runtime-init']})"),[]);
    assertPaused(await message({action:'setSiteConfig',config:saved.config}));
    assertPaused(await message({action:'reconcileRuntime'}));
    const preRestart=await c.evaluate(sw,'__vg011Gate.dispatches');assert.equal(preRestart,0);
    // 真实停止并重新唤醒 MV3 service worker；不把 createServices mock 当作后台重启。
    await seedScript();
    await c.cdp.send('ServiceWorker.enable',{},options);
    await c.cdp.send('ServiceWorker.stopAllWorkers',{},options);
    await until(async()=>!(await c.cdp.send('Target.getTargets')).targetInfos.some(t=>t.type==='service_worker'&&t.url===`chrome-extension://${c.id}/background/safety-wrapper.js`));
    assertPaused(await message({action:'reconcileRuntime'}));
    sw=await workerSession();
    assert.deepEqual(await c.evaluate(options,"chrome.scripting.getRegisteredContentScripts({ids:['vanishgeo-runtime-init']})"),[]);
    before=await loaded(tab.id);old=await queueOldInitialization();await releaseAndCheck(old);
    const postRestart=await c.evaluate(sw,'__vg011Gate.dispatches');assert.equal(postRestart,0);
    // 在真实扩展页加载/保存/重试后检查可见文本，避免只有后台返回值证据。
    await c.cdp.send('Page.reload',{},options);
    await until(()=>c.evaluate(options,"document.getElementById('runtimeSyncStatus')?.textContent"),text=>text?.includes('页面伪装已暂停'));
    await c.evaluate(options,"document.getElementById('retryRuntimeSync').click();true");
    await until(()=>c.evaluate(options,"document.getElementById('retryRuntimeSync').disabled"),disabled=>disabled===false);
    const ui=await c.evaluate(options,"({status:document.getElementById('runtimeSyncStatus').textContent,setup:document.getElementById('setupStatus').textContent})");
    assert.match(ui.status,/页面伪装已暂停/);assert.match(ui.status,/重试同步不会恢复/);assert.match(ui.setup,/部分生效/);
    const popup=await c.createPage('popup/popup.html');
    for(const [session,selector] of [[options,"document.getElementById('globalEnabled').closest('label').textContent"],[popup,"document.querySelector('.primary-card .control-copy').textContent"]]){
      const text=await c.evaluate(session,selector);
      assert.match(text,/控制已保存的总开关/);assert.match(text,/页面伪装已暂停/);assert.match(text,/DNR\/WebRTC 以同步结果为准/);
      assert.doesNotMatch(text,/允许站点.*使用当前环境配置/);
    }
    const popupUi=await until(()=>c.evaluate(popup,"document.getElementById('runtimeSyncStatus').textContent"),text=>text.includes('页面伪装已暂停'));
    assert.match(popupUi,/请求头规则与 WebRTC 按各自状态/);
    await c.evaluate(options,`chrome.tabs.remove(${tab.id})`);
    return {task:'VG-011',browser:c.browser,extensionGate:'PASS',browserDefectFixed:false,
      productionWorkerAndContentByteIdentical:true,manifestPermissionsUnchanged:true,
      scenarios:cases,productionRuntimeDispatches:preRestart+postRestart,
      initializerRemoved:true,configSaveAndSameSignatureRetryBlocked:true,realServiceWorkerRestartBlocked:true,
      dnrReport:'ok',webRtcReport:'ok',optionsAndPopupPauseVisible:true,masterSwitchScopeVisible:true,
      limitations:['真实 Chrome headless 单版本定向验证，非人工验收','未撤销已执行 hook；旧 BFCache 文档须关闭并重建','原生 Chrome 错投另由保留的 native-only 对照报告','未调用原生位置或 ICE/STUN，无外部 provider 请求']};
  });
  console.log(JSON.stringify(record,null,2));
  if(args[1])await writeFile(args[1],`${JSON.stringify(record,null,2)}\n`);
} finally {await new Promise(done=>server.close(done));}
