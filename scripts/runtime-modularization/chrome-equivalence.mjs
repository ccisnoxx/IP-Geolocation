#!/usr/bin/env node
// Node 22+；临时最小扩展中的最终函数经 scripting API 执行，不恢复生产派发。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import ts from 'typescript';
import { runtimePlugin } from '../../build/runtime-plugin.ts';
import { projectRoot } from '../../build/self-contained-runtime.ts';
import { createLeakTestServer } from '../serve-leak-test.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error('VG-012 Chrome 等待超时');
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`VG-012 CDP ${request.method} 失败`));
    else request.done(message.result);
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-012 CDP ${method} 超时`)); }, 15000);
        pending.set(id, { done, fail, timer, method });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-012 CDP 已关闭')); }
      pending.clear();
      socket.close();
    }
  };
}

const args = process.argv.slice(2);
const options = {};
for (let i=0;i<args.length;i+=2) {
  if (!['--baseline-runtime','--output'].includes(args[i]) || !args[i+1]) throw new Error('参数：--baseline-runtime <旧runtime.ts> --output <脱敏JSON>');
  options[args[i]] = args[i+1];
}
if (!options['--baseline-runtime']) throw new Error('必须提供任务前 runtime 维护源作为等价对照');
if (typeof WebSocket !== 'function') throw new Error('需要 Node 22+');
const chrome = [process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('真实 Chrome 不可用');
const temporary = await mkdtemp(join(tmpdir(),'vg012-chrome-'));
const server = createLeakTestServer({projectRoot});
const handler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request',(request,response)=> {
  if (request.url === '/vg012-strict') {
    response.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'none'; worker-src 'self'; frame-src 'self'"});
    response.end('<!doctype html><title>VG-012 strict</title><iframe src="/vg012-child"></iframe>');
  } else if (request.url === '/vg012-child') {
    response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>VG-012 child</title>');
  } else handler(request,response);
});
let child,cdp;
const payload = {extensionEnabled:true,debugMode:false,
  languageConfig:{enabled:true,language:'fr-FR',languages:['fr-FR','fr'],acceptLanguage:'fr-FR,fr;q=0.9'},
  timezoneConfig:{enabled:true,mode:'manual',timezone:'Europe/Paris'},
  geolocation:{enabled:true,latitude:12,longitude:23,accuracy:50,randomize:false,spoofPermission:true},
  canvasConfig:{enabled:true,spoofFonts:true,targetFonts:['Arial']}};
// 观察函数由 Chrome 自身序列化；结果只含合成值/布尔和固定 epoch，不采真实位置或 ICE。
async function snapshot() {
  const navProto=Object.getPrototypeOf(navigator), getter=Object.getOwnPropertyDescriptor(navProto,'language').get;
  let receiver;try {getter.call({});receiver='accepted';}catch(error){receiver=error.name;}
  const geo=await new Promise((done,fail)=>navigator.geolocation.getCurrentPosition(p=>done([p.coords.latitude,p.coords.longitude,p.coords.accuracy]),fail));
  const watch=await new Promise((done,fail)=>{const id=navigator.geolocation.watchPosition(p=>{navigator.geolocation.clearWatch(id);done([p.coords.latitude,p.coords.longitude]);},fail);});
  const permission=await navigator.permissions.query({name:'geolocation'});
  const notifications=await navigator.permissions.query({name:'notifications'});
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.font='12px Arial, monospace';const before=ctx.font,width=ctx.measureText('VanishGeo').width,after=ctx.font;
  ctx.font='12px monospace';const fallback=ctx.measureText('VanishGeo').width;
  return {language:navigator.language,languages:Array.from(navigator.languages),frozen:Object.isFrozen(navigator.languages),
    ownGetter:!!Object.getOwnPropertyDescriptor(navigator,'language'),receiver,getterSource:getter.toString(),getterName:getter.name,getterLength:getter.length,
    timezone:Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).resolvedOptions().timeZone,
    locale:Intl.NumberFormat('en-US').resolvedOptions().locale,
    dates:[Date.UTC(2024,0,15,12),Date.UTC(2024,6,15,12)].map(v=>{const d=new Date(v);return [d.getTimezoneOffset(),d.toString(),d.toLocaleString('en-US',{timeZone:'UTC'})];}),
    geo,watch,permission:permission.state,permissionPrototype:Object.getPrototypeOf(permission).constructor.name,notifications:notifications.state,
    canvasRestored:before===after,canvasFallback:width===fallback,
    anchorHidden:Object.getOwnPropertyDescriptor(globalThis,Symbol.for('vg012-document'))===undefined,
    symbolsHidden:!Object.getOwnPropertySymbols(globalThis).some(k=>Symbol.keyFor(k)==='vg012-document'),
    reflectHidden:!Reflect.ownKeys(globalThis).includes(Symbol.for('vg012-document')),
    nativePassThrough:__vg012Native.every(([owner,key,value])=>owner[key]===value)};
}
try {
  const extension=join(temporary,'extension');await mkdir(extension);
  const baseline=await readFile(resolve(options['--baseline-runtime']),'utf8');
  await writeFile(join(temporary,'baseline.js'),ts.transpileModule(baseline,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText);
  const probeEntry=join(temporary,'probe-entry.js');
  await writeFile(probeEntry,`import {applyVanishGeoRuntime as candidate} from ${JSON.stringify(resolve(projectRoot,'src/injected/runtime.ts'))};
import {applyVanishGeoRuntime as baseline} from './baseline.js';
export function inject(tabId,documentId,variant,payload){return chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',injectImmediately:true,func:variant==='baseline'?baseline:candidate,args:[payload,'vg012-document']});}
export function observe(tabId,world){return chrome.scripting.executeScript({target:{tabId,allFrames:true},world,func:()=>({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});}`);
  await build({root:projectRoot,configFile:false,publicDir:false,logLevel:'silent',plugins:[runtimePlugin()],build:{outDir:extension,emptyOutDir:false,minify:false,target:'es2020',
    rollupOptions:{input:probeEntry,preserveEntrySignatures:'strict',output:{entryFileNames:'probe.js',format:'es'}}}});
  await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'VG-012 equivalence probe',version:'1.0',minimum_chrome_version:'119',
    permissions:['scripting','tabs'],host_permissions:['http://localhost/*'],web_accessible_resources:[]}));
  await writeFile(join(extension,'probe.html'),'<!doctype html><title>VG-012 probe</title>');
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'localhost',done);});
  const origin=`http://localhost:${server.address().port}`;
  const profile=join(temporary,'profile');
  child=spawn(chrome,['--headless=new','--enable-unsafe-extension-debugging','--remote-debugging-port=0',`--user-data-dir=${profile}`,
    '--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  const port=await until(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},Boolean);
  const version=await (await fetch(`http://localhost:${port}/json/version`)).json();cdp=await connect(version.webSocketDebuggerUrl);
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  const page=async url=>{const {targetId}=await cdp.send('Target.createTarget',{url});const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});await cdp.send('Page.enable',{},sessionId);return {sessionId,targetId};};
  const evaluate=async(target,expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},target.sessionId);if(r.exceptionDetails)throw new Error(`VG-012 probe 失败：${r.exceptionDetails.exception?.description?.split('\n')[0]||'执行异常'}`);return r.result.value;};
  const probe=await page(`chrome-extension://${id}/probe.html`);
  const call=(method,values)=>evaluate(probe,`import(chrome.runtime.getURL('probe.js')).then(m=>m.${method}(...${JSON.stringify(values)}))`);
  const observations={};
  for(const variant of ['baseline','candidate']) {
    const target=await page('about:blank');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__vg012Native=[[navigator,'hardwareConcurrency',navigator.hardwareConcurrency],[navigator,'deviceMemory',navigator.deviceMemory],[globalThis,'screen',screen],[globalThis,'AudioContext',AudioContext],[navigator,'gpu',navigator.gpu]];`},target.sessionId);
    await cdp.send('Page.navigate',{url:`${origin}/fixtures/workers/top.html`},target.sessionId);
    await until(()=>evaluate(target,'document.readyState'),v=>v==='complete');
    const tabId=await evaluate(probe,`chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(`${origin}/fixtures/workers/top.html`)}).id)`);
    const identity=(await call('observe',[tabId,'ISOLATED'])).find(v=>v.frameId===0);
    await call('inject',[tabId,identity.documentId,variant,payload]);
    const state=await evaluate(target,`(${snapshot.toString()})()`);
    assert.equal(state.language,'fr-FR');assert.equal(state.permission,'granted');assert.equal(state.canvasRestored,true);assert.equal(state.canvasFallback,true);assert.equal(state.nativePassThrough,true);
    const workers=await evaluate(target,`runWorkerDiagnostics().then(rows=>Object.fromEntries(Object.entries(rows).filter(([k])=>k!=='serviceWorker').map(([key,row])=>[key,{status:row.status,identity:row.identity||null,language:row.result?.language,timezone:row.result?.timezone,module:row.result?.moduleObservation||null}])))`);
    for(const row of Object.values(workers)){assert.equal(row.status,'ok');assert.equal(row.language,'fr-FR');assert.equal(row.timezone,'Europe/Paris');}
    await evaluate(target,`globalThis.__vg012Getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get`);
    await call('inject',[tabId,identity.documentId,variant,{...payload,languageConfig:{...payload.languageConfig,language:'ja-JP',languages:['ja-JP']}}]);
    const repeated=await evaluate(target,`({sameGetter:__vg012Getter===Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get,language:navigator.language})`);
    const future=await evaluate(target,`new Promise((done,fail)=>{const w=new Worker('/fixtures/workers/worker-classic.js');w.onmessage=e=>{w.terminate();done(e.data.language)};w.onerror=fail;})`);
    assert.equal(repeated.sameGetter,true);assert.equal(repeated.language,'fr-FR');assert.equal(future,'ja-JP');
    const isolated=(await call('observe',[tabId,'ISOLATED'])).find(v=>v.frameId===0).result;
    assert.deepEqual(isolated,identity.result);
    await cdp.send('Target.closeTarget',{targetId:target.targetId});
    const strict=await page(`${origin}/vg012-strict`);
    await until(()=>evaluate(strict,'document.readyState'),v=>v==='complete');
    const strictTab=await evaluate(probe,`chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(`${origin}/vg012-strict`)}).id)`);
    const frames=await until(()=>call('observe',[strictTab,'MAIN']),v=>v.length===2);
    const frame=frames.find(v=>v.frameId!==0),top=frames.find(v=>v.frameId===0);
    await call('inject',[strictTab,frame.documentId,variant,payload]);
    const afterFrame=await call('observe',[strictTab,'MAIN']);
    assert.deepEqual(afterFrame.find(v=>v.frameId===0).result,top.result);
    assert.equal(afterFrame.find(v=>v.frameId!==0).result.language,'fr-FR');
    await call('inject',[strictTab,top.documentId,variant,payload]);
    assert.ok((await call('observe',[strictTab,'MAIN'])).every(v=>v.result.language==='fr-FR'));
    await cdp.send('Target.closeTarget',{targetId:strict.targetId});
    observations[variant]={state,workers,repeated:{sameGetter:repeated.sameGetter,language:repeated.language,future},isolatedUnchanged:true,strictCspAndIframe:true};
  }
  assert.deepEqual(observations.candidate,observations.baseline);
  const result={task:'VG-012',browser:version.Browser,result:'PASS',productionDispatchRestored:false,
    baselineRuntimeSha256:createHash('sha256').update(baseline).digest('hex'),
    checks:{fullPageEquivalence:true,registryReflection:true,navigatorIntlDateDst:true,geolocationWatchPermissions:true,canvasFallbackAndRestore:true,
      nativeDevicePassThrough:true,classicModuleSharedNestedWorkers:true,sharedIdentityAndModuleOrder:true,repeatedFutureWorkerOnly:true,isolatedUnchanged:true,strictCspAndIframe:true},
    limitations:['仅当前文档直接注入的隔离等价验证；生产安全暂停另测','不修复 stale documentId 或 earliest-inline 竞态','无 Chrome119/浏览器矩阵或人工验收']};
  if(options['--output'])await writeFile(resolve(options['--output']),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  cdp?.close();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');done();},5000);child.once('exit',()=>{clearTimeout(timer);done();});});}
  server.closeAllConnections();await new Promise(done=>server.close(done));
  await rm(temporary,{recursive:true,force:true});
}
