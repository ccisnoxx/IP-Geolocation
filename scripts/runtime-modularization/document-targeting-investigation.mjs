#!/usr/bin/env node
// Node 22+；只调查 VG-011 documentId 边界，不修改生产源码/权限或用户 profile。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const disableBfcache = process.argv.includes('--disable-bfcache');
const nativeOnly = process.argv.includes('--native-only');
const args = process.argv.slice(2).filter(value => !['--disable-bfcache','--native-only'].includes(value));
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('参数：--output <脱敏JSON>');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept = Boolean) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error('VG-011 documentId 调查等待超时');
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
  const temporary = await mkdtemp(join(tmpdir(), 'vg011-targeting-'));
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

// 直接由浏览器加载的原生 JS：无 Vite、无生成器，ID/导航/调用全部留在扩展上下文。
const nativeProbe = `
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function wait(read, accept) {
  const end=Date.now()+15000;
  while(Date.now()<end) { const v=await read(); if(accept(v))return v; await pause(50); }
  throw new Error('native probe timeout');
}
function observe(tabId,world='ISOLATED') {
  return chrome.scripting.executeScript({target:{tabId,allFrames:true},world,func:()=>({path:location.pathname,language:navigator.language,ready:document.readyState})});
}
export async function run(origin) {
  const tab=await chrome.tabs.create({url:origin+'/old'});
  const original=await wait(()=>observe(tab.id),v=>v.length===2&&v[0].result.path==='/old'&&v[0].result.ready==='complete');
  const oldId=original.find(v=>v.frameId===0).documentId;
  const frameId=original.find(v=>v.frameId!==0).documentId;
  const liveFrame=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[frameId]},world:'MAIN',func:()=>location.pathname});
  await chrome.tabs.update(tab.id,{url:origin+'/new'});
  const replacement=await wait(()=>observe(tab.id),v=>v.length===1&&v[0].documentId!==oldId&&v[0].result.path==='/new'&&v[0].result.ready==='complete');
  const newId=replacement[0].documentId;
  const capture=[];
  async function attempt(label,documentId,world) {
    const details={target:{tabId:tab.id,documentIds:[documentId]},world,func:()=>location.pathname};
    capture.push({label,hasDocumentIds:Array.isArray(details.target.documentIds),exactOld:details.target.documentIds[0]===oldId});
    try {
      const rows=await chrome.scripting.executeScript(details);
      return {rejected:false,count:rows.length,returnedOld:rows.some(r=>r.documentId===oldId),returnedReplacement:rows.some(r=>r.documentId===newId),readReplacement:rows.some(r=>r.result==='/new')};
    } catch(error) {return {rejected:true,noDocument:/No document|document.*not|not.*document/i.test(error.message)};}
  }
  const result={browserNavigation:'chrome.tabs.update',cdpSuppliesNoDocumentIds:true,bundler:'none',
    liveFrameTargeted:liveFrame.length===1&&liveFrame[0].documentId===frameId&&liveFrame[0].result==='/frame',
    navigationChangedDocument:oldId!==newId,
    documentIdFormat:{length:oldId.length,hex32:/^[A-F0-9]{32}$/.test(oldId)},
    nonexistent:await attempt('nonexistent',crypto.randomUUID().replaceAll('-','').toUpperCase(),'MAIN'),
    staleMain:await attempt('staleMain',oldId,'MAIN'),staleIsolated:await attempt('staleIsolated',oldId,'ISOLATED'),
    current:await attempt('current',newId,'MAIN'),capture};
  await pause(1000);
  result.staleAfterOneSecond=await attempt('staleAfterOneSecond',oldId,'MAIN');
  await chrome.tabs.remove(tab.id);
  return result;
}`;

const workerWrapper = `
const trace={armed:false,pending:null,senders:[],outcomes:[],release:null};
globalThis.__vg011Investigation=trace;
const add=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
chrome.runtime.onMessage.addListener=listener=>add((request,sender,respond)=>{
  if(request?.action==='initializeRuntimeForSender')trace.senders.push({id:sender.id,documentId:sender.documentId,url:sender.url,tabId:sender.tab?.id});
  return listener(request,sender,respond);
});
const execute=chrome.scripting.executeScript.bind(chrome.scripting);
chrome.scripting.executeScript=async details=>{
  const runtime=details.world==='MAIN'&&details.args?.[0]?.extensionEnabled===true&&typeof details.args?.[1]==='string';
  if(!runtime||!trace.armed)return execute(details);
  trace.armed=false;
  trace.pending={target:structuredClone(details.target),argumentDocumentId:details.args[1],world:details.world,functionName:details.func.name,
    functionContainsProductionRegistry:details.func.toString().includes('getAntiDetectionState')};
  await new Promise(done=>{trace.release=done;});
  try {const rows=await execute(details);trace.outcomes.push({rejected:false,rows:rows.map(r=>({documentId:r.documentId,frameId:r.frameId}))});return rows;}
  catch(error){trace.outcomes.push({rejected:true,noDocument:/No document|document.*not|not.*document/i.test(error.message)});throw error;}
};
`;

let nativeResult;
let nativeMayStart=false;
const server=createServer((request,response)=>{
  if(request.url==='/native-ready') {
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(nativeMayStart));return;
  }
  if(request.method==='POST'&&request.url==='/native-result') {
    let body='';
    request.on('data',chunk=>{body+=chunk;});
    request.on('end',()=>{
      try { nativeResult=JSON.parse(body);response.writeHead(200);response.end(); }
      catch { response.writeHead(400);response.end(); }
    });
    return;
  }
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'none'; frame-src 'self'",'Cache-Control':'no-store'});
  response.end(request.url==='/old'?'<title>old</title><iframe src="/frame"></iframe>':'<title>replacement</title>');
});
try {
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port;
  const origin=`http://localhost:${port}`;
  const native=await withChrome(async extension=>{
    await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'VG011 native document targeting',version:'1.0',permissions:['scripting','tabs'],host_permissions:['http://localhost/*'],web_accessible_resources:[]}));
    await writeFile(join(extension,'probe.html'),'<title>native probe</title>');
    await writeFile(join(extension,'probe.js'),nativeProbe);
  },async c=>{
    const page=await c.createPage('probe.html');
    // CDP 只安排启动；关闭连接后，扩展自己完成 ID/导航/调用，结果只回传本机。
    await c.evaluate(page,`setTimeout(async()=>{
      while(!(await fetch(${JSON.stringify(`${origin}/native-ready`)}).then(r=>r.json())))await new Promise(r=>setTimeout(r,50));
      import(chrome.runtime.getURL('probe.js')).then(m=>m.run(${JSON.stringify(origin)}))
      .then(result=>fetch(${JSON.stringify(`${origin}/native-result`)},{method:'POST',body:JSON.stringify({result})}))
      .catch(()=>fetch(${JSON.stringify(`${origin}/native-result`)},{method:'POST',body:JSON.stringify({error:true})}));
    },0);true`);
    await c.cdp.close();
    nativeMayStart=true;
    const envelope=await until(()=>nativeResult);
    assert.ok(!envelope.error,'原生探针失败');
    return {browser:c.browser,cdpDisconnectedDuringProbe:true,...envelope.result};
  });
  console.log('VG-011 native:',JSON.stringify(native));

  const production=nativeOnly?null:await withChrome(async extension=>{
    await cp(join(root,'dist'),extension,{recursive:true});
    const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
    manifest.background.service_worker='background/investigation-wrapper.js';
    await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
    await writeFile(join(extension,'background/investigation-hooks.js'),workerWrapper);
    await writeFile(join(extension,'background/investigation-wrapper.js'),"import './investigation-hooks.js';\nimport './service-worker.js';\n");
    for (const file of ['background/service-worker.js','content/content.js']) {
      assert.equal(await readFile(join(extension,file),'utf8'),await readFile(join(root,'dist',file),'utf8'));
    }
    const temporaryManifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
    const originalManifest=JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8'));
    for (const field of ['permissions','host_permissions','web_accessible_resources']) assert.deepEqual(temporaryManifest[field],originalManifest[field]);
  },async c=>{
    const worker=await until(async()=> (await c.cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${c.id}/background/investigation-wrapper.js`));
    const sw=await c.attach(worker.targetId);
    await until(()=>c.evaluate(sw,'Boolean(globalThis.__vg011Investigation)'));
    const options=await c.createPage('options/options.html');
    const message=request=>c.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
    const config={masterEnabled:true,rules:[{id:'synthetic-localhost',domain:'localhost',enabled:true}],webRtc:{globalMode:'default'},globalProfile:{
      language:{enabled:true,mode:'custom',language:'fr-FR',languages:['fr-FR','fr'],acceptLanguage:'fr-FR,fr;q=0.9'},
      timezone:{enabled:false,mode:'manual',timezone:'UTC'},geolocation:{enabled:false,mode:'manual',latitude:0,longitude:0,accuracy:50}},canvas:{enabled:false,spoofFonts:false,targetFonts:[]}};
    const saved=await message({action:'setSiteConfig',config});assert.equal(saved.status,'ok');
    // 旧文档为无 iframe 的 /new，避免把子帧调用当成被延迟的 top 调用。
    await c.evaluate(sw,'__vg011Investigation.armed=true');
    const tab=await c.evaluate(options,`chrome.tabs.create({url:${JSON.stringify(`${origin}/new`)}})`);
    await until(()=>c.evaluate(sw,'Boolean(__vg011Investigation.pending)'));
    const pending=await c.evaluate(sw,'__vg011Investigation.pending');
    const observation=()=>c.evaluate(options,`chrome.scripting.executeScript({target:{tabId:${tab.id},allFrames:true},world:'MAIN',func:()=>({language:navigator.language,path:location.pathname,ready:document.readyState})})`);
    await c.evaluate(options,`chrome.tabs.update(${tab.id},{url:${JSON.stringify(`http://127.0.0.1:${port}/replacement`)}})`);
    const before=await until(observation,rows=>rows.length===1&&rows[0].documentId!==pending.target.documentIds[0]&&rows[0].result.path==='/replacement'&&rows[0].result.ready==='complete');
    const state=await message({action:'getCurrentTabState'});assert.equal(state.state.matched,false);
    await c.evaluate(sw,'__vg011Investigation.release();true');
    const outcome=await until(()=>c.evaluate(sw,'__vg011Investigation.outcomes[0]'));
    const after=await observation();
    const sender=await c.evaluate(sw,`__vg011Investigation.senders.find(s=>s.documentId===${JSON.stringify(pending.target.documentIds[0])})`);
    assert.ok(sender);
    return {browser:c.browser,mode:'production dist copy / delayed native scripting dispatch',
      wrapperChangesOnlyTiming:true,productionWorkerAndContentByteIdentical:true,manifestPermissionsUnchanged:true,trustedSenderCaptured:true,
      senderIdMatchesExtension:sender.id===c.id,senderDocumentMatchesTarget:sender.documentId===pending.target.documentIds[0],
      argumentDocumentMatchesTarget:pending.argumentDocumentId===pending.target.documentIds[0],targetHasOnlyTabAndDocumentIds:Object.keys(pending.target).sort().join(',')==='documentIds,tabId',
      productionFunctionName:pending.functionName,functionContainsProductionRegistry:pending.functionContainsProductionRegistry,
      replacementMatched:false,documentChanged:before[0].documentId!==pending.target.documentIds[0],
      outcome:{rejected:outcome.rejected,noDocument:outcome.noDocument??false,returnedReplacement:outcome.rows?.some(r=>r.documentId===before[0].documentId)??false},
      replacementInitiallyNative:before[0].result.language!=='fr-FR',replacementChangedByStaleCall:after[0].result.language!==before[0].result.language,
      replacementHasConfiguredLanguage:after[0].result.language==='fr-FR'};
  });
  if(production)console.log('VG-011 production:',JSON.stringify(production));
  const record={task:'VG-011',bfcacheDisabledByFlag:disableBfcache,nativeOnly,investigation:'COMPLETE',
    documentTargetSafety:(production?production.replacementChangedByStaleCall:native.staleMain.returnedReplacement)?'FAIL':'PASS',productionAffected:production?.replacementChangedByStaleCall??null,
    native,production,limitations:[nativeOnly?'单个临时 profile，非用户人工验收':'两个独立临时 profile，非用户人工验收','生产 wrapper 只延迟已解析 payload 后的真实 API 调用，未修改源码/权限/配置解析','无 Chrome119 或全部导航生命周期矩阵']};
  if(args[1])await writeFile(args[1],`${JSON.stringify(record,null,2)}\n`);
} finally { await new Promise(done=>server.close(done)); }
