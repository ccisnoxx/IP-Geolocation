#!/usr/bin/env node
// Node 22+；临时最小扩展中的最终函数经 scripting API 执行，不恢复生产派发。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import { runtimePlugin } from '../build/runtime-plugin.ts';
import { projectRoot } from '../build/self-contained-runtime.ts';
import { createLeakTestServer } from './serve-leak-test.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error('VG-013 Chrome 等待超时');
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
    if (message.error) request.fail(new Error(`VG-013 CDP ${request.method} 失败`));
    else request.done(message.result);
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-013 CDP ${method} 超时`)); }, 15000);
        pending.set(id, { done, fail, timer, method });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-013 CDP 已关闭')); }
      pending.clear();
      socket.close();
    }
  };
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('参数：--output <脱敏JSON>');
if (typeof WebSocket !== 'function') throw new Error('需要 Node 22+');
const chrome = [process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('真实 Chrome 不可用');
const temporary = await mkdtemp(join(tmpdir(),'vg013-chrome-'));
const server = createLeakTestServer({projectRoot});
const handler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request',(request,response)=> {
  if (request.url === '/intl-top' || request.url === '/intl-frame') {
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end(request.url === '/intl-top' ? '<!doctype html><title>Intl modes</title><iframe src="/intl-frame"></iframe>' : '<!doctype html><title>Intl frame</title>');
  } else handler(request,response);
});
let child, cdp;
function checkRealm(value, mode) {
  assert.equal(value.locale,'fr-FR'); assert.equal(value.timezone,'Europe/Paris');
  assert.equal(value.intl.numberLocale,'fr-FR');
  const locale=mode==='compatible'?'en-US':'fr-FR', zone=mode==='compatible'?'UTC':'Europe/Paris';
  assert.equal(value.intl.explicitLocale,locale); assert.equal(value.intl.explicitTimezone,zone);
  assert.equal(value.intl.explicitNumberLocale,locale);
  assert.equal(value.intl.explicitDateLocale,new Date(1768478400000).toLocaleString(locale,{timeZone:zone}));
  assert.equal(value.intl.explicitDateHour,new Intl.DateTimeFormat(locale,{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date(1768478400000)));
}
try {
  const extension=join(temporary,'extension'); await mkdir(extension);
  const entry=join(temporary,'entry.js');
  await writeFile(entry,`import {applyVanishGeoRuntime} from ${JSON.stringify(resolve(projectRoot,'src/injected/runtime.ts'))};
import {collectDiagnosticRealm} from ${JSON.stringify(resolve(projectRoot,'src/background/diagnostic-probe.ts'))};
export function inject(tabId,documentId,payload){return chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',func:applyVanishGeoRuntime,args:[payload,'vg013-document']});}
export function observe(tabId,world){return chrome.scripting.executeScript({target:{tabId,allFrames:true},world,func:collectDiagnosticRealm});}`);
  await build({root:projectRoot,configFile:false,publicDir:false,logLevel:'silent',plugins:[runtimePlugin()],build:{outDir:extension,emptyOutDir:false,minify:false,target:'es2020',rollupOptions:{input:entry,preserveEntrySignatures:'strict',output:{entryFileNames:'probe.js',format:'es'}}}});
  await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'VG-013 Intl probe',version:'1.0',permissions:['scripting','tabs'],host_permissions:['http://localhost/*'],web_accessible_resources:[]}));
  await writeFile(join(extension,'probe.html'),'<!doctype html><title>Intl probe</title>');
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'localhost',done);});
  const origin=`http://localhost:${server.address().port}`, profile=join(temporary,'profile');
  child=spawn(chrome,['--headless=new','--enable-unsafe-extension-debugging','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  let launchError=false;child.once('error',()=>{launchError=true;});
  const port=await until(async()=>{if(launchError)throw new Error('Chrome 启动失败');try{return(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},Boolean);
  const version=await(await fetch(`http://localhost:${port}/json/version`)).json();cdp=await connect(version.webSocketDebuggerUrl);
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  const page=async url=>{const {targetId}=await cdp.send('Target.createTarget',{url});const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});await cdp.send('Page.enable',{},sessionId);return {sessionId,targetId};};
  const evaluate=async(target,expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},target.sessionId);if(r.exceptionDetails)throw new Error('VG-013 浏览器探针执行失败');return r.result.value;};
  const probe=await page(`chrome-extension://${id}/probe.html`);
  const call=(method,values)=>evaluate(probe,`import(chrome.runtime.getURL('probe.js')).then(m=>m.${method}(...${JSON.stringify(values)}))`);
  const modes={};
  for (const mode of ['strict','compatible']) {
    const target=await page(`${origin}/intl-top`);
    await until(()=>evaluate(target,'document.readyState'),v=>v==='complete');
    const tabId=await evaluate(probe,`chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(`${origin}/intl-top`)}).id)`);
    const frames=await until(()=>call('observe',[tabId,'MAIN']),v=>v.length===2);
    const isolated=await call('observe',[tabId,'ISOLATED']);
    const payload={extensionEnabled:true,intlMode:mode,languageConfig:{enabled:true,language:'fr-FR',languages:['fr-FR'],acceptLanguage:'fr-FR'},timezoneConfig:{enabled:true,mode:'manual',timezone:'Europe/Paris'}};
    // 当前文档逐个定向；子帧注入不应改动 top。
    const frame=frames.find(f=>f.frameId!==0), top=frames.find(f=>f.frameId===0);
    await call('inject',[tabId,frame.documentId,payload]);
    const childOnly=await call('observe',[tabId,'MAIN']);
    assert.deepEqual(childOnly.find(f=>f.frameId===0).result,top.result);
    await call('inject',[tabId,top.documentId,payload]);
    const observed=await call('observe',[tabId,'MAIN']);
    for(const value of observed)checkRealm(value.result.value,mode);
    assert.deepEqual((await call('observe',[tabId,'ISOLATED'])).map(f=>f.result),isolated.map(f=>f.result));
    const semantics=await evaluate(target,`(() => {
      const names=['NumberFormat','Collator','RelativeTimeFormat','ListFormat','PluralRules','DisplayNames','Segmenter'];
      return {offsets:[new Date(Date.UTC(2024,0,15,12)).getTimezoneOffset(),new Date(Date.UTC(2024,6,15,12)).getTimezoneOffset()],
        locales:names.filter(k=>typeof Intl[k]==='function').map(k=>[k,new Intl[k]('en-US',k==='DisplayNames'?{type:'region'}:undefined).resolvedOptions().locale]),
        explicitError:(()=>{try{Intl.DateTimeFormat('en-US',{timeZone:'Invalid/Zone'});return 'none'}catch(e){return e.name}})(),
        inherited:Intl.DateTimeFormat('en-US',Object.create({timeZone:'UTC'})).resolvedOptions().timeZone,
        prototypeDefault:(()=>{Object.defineProperty(Object.prototype,'hour',{value:'invalid-fixture',configurable:true});
          try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch(error){return error.name;}finally{delete Object.prototype.hour;}})()};
    })()`);
    assert.deepEqual(semantics.offsets,[-60,-120]);
    assert.equal(semantics.explicitError,mode==='compatible'?'RangeError':'none');
    assert.equal(semantics.inherited,mode==='compatible'?'UTC':'Europe/Paris');
    assert.equal(semantics.prototypeDefault,mode==='compatible'?'Europe/Paris':'RangeError');
    // 复用原生 locale 协商，包括 PluralRules 的地区裁剪。
    for(const [name,locale] of semantics.locales)assert.equal(locale,new Intl[name](mode==='compatible'?'en-US':'fr-FR',name==='DisplayNames'?{type:'region'}:undefined).resolvedOptions().locale);
    const workers=await evaluate(target,`Promise.all(['classic','module','shared','shared-module','nested'].map(kind=>new Promise((done,fail)=>{
      const timer=setTimeout(()=>fail(new Error('worker timeout')),8000);
      let worker;const finish=data=>{clearTimeout(timer);if(worker.port)worker.port.close();else worker.terminate();done([kind,data]);};
      if(kind.startsWith('shared')){worker=new SharedWorker('/fixtures/workers/'+(kind==='shared'?'shared-worker.js':'shared-worker-module.js'),{type:kind==='shared'?'classic':'module',name:'intl-'+kind});worker.port.onmessage=e=>finish(e.data);worker.port.start();}
      else {worker=new Worker('/fixtures/workers/'+(kind==='nested'?'nested-parent.js':'worker-'+kind+'.js'),{type:kind==='module'?'module':'classic'});worker.onmessage=e=>finish(kind==='nested'?e.data.result:e.data);if(kind==='nested')worker.postMessage({childUrl:new URL('/fixtures/workers/nested-child.js',location.href).href});}
      worker.onerror=()=>{clearTimeout(timer);if(worker.port)worker.port.close();else worker.terminate();fail(new Error('worker failed'));};
    }))).then(Object.fromEntries)`);
    for(const data of Object.values(workers))checkRealm({locale:data.dateTimeFormatLocale,timezone:data.timezone,intl:data.intl},mode);
    modes[mode]={topAndIframe:true,isolatedUnchanged:true,defaultAndExplicit:true,dateDstAndNativeErrors:true,otherIntlConstructors:true,workers:Object.keys(workers)};
    await cdp.send('Target.closeTarget',{targetId:target.targetId});
  }
  // 正式 dist 仅验证配置/迁移与管理页保存；不使用它恢复 MAIN。
  const productionDirectory=join(temporary,'production');
  // Chrome会写DNR索引缓存，不能直接加载待审查dist并改变产物清单。
  await cp(resolve(projectRoot,'dist'),productionDirectory,{recursive:true,filter:source=>basename(source)!=='_metadata'});
  const production=await cdp.send('Extensions.loadUnpacked',{path:productionDirectory});
  const options=await page(`chrome-extension://${production.id}/options/options.html`);
  await until(()=>evaluate(options,"document.getElementById('intlMode')?.value"),v=>v==='strict');
  // 控件的静态默认值早于 module listener 和异步 populateForm；等待初始化末步。
  await until(()=>evaluate(options,"document.getElementById('webrtcPolicyStatus')?.textContent.includes('控制级别：')"),Boolean);
  await evaluate(options,'window.alert=()=>{}');
  await evaluate(options,`document.getElementById('timezone').value='UTC';document.getElementById('intlMode').value='compatible';document.getElementById('save').click()`);
  await until(()=>evaluate(options,"chrome.storage.local.get('siteSpoofConfig').then(v=>v.siteSpoofConfig?.intlMode)"),v=>v==='compatible');
  const popup=await page(`chrome-extension://${production.id}/popup/popup.html`);
  await until(()=>evaluate(popup,"document.getElementById('intlMode')?.value"),v=>v==='compatible');
  await evaluate(popup,"document.getElementById('intlMode').value='strict';document.getElementById('intlMode').dispatchEvent(new Event('change'))");
  await until(()=>evaluate(popup,"chrome.storage.local.get('siteSpoofConfig').then(v=>v.siteSpoofConfig?.intlMode)"),v=>v==='strict');
  const migration=await evaluate(options,`(async()=>{
    const data=await chrome.storage.local.get('siteSpoofConfig'),raw=data.siteSpoofConfig;raw.schemaVersion=2;delete raw.intlMode;
    await chrome.storage.local.set({siteSpoofConfig:raw});
    const read=()=>chrome.runtime.sendMessage({action:'getSiteConfig'});
    const first=await read(),second=await read(),stored=(await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig;
    return {strict:first.config.intlMode==='strict',idempotent:JSON.stringify(first.config)===JSON.stringify(second.config),schemaMigrated:stored.schemaVersion===5,pausePreserved:!((await chrome.scripting.getRegisteredContentScripts()).length)};
  })()`);
  assert.ok(Object.values(migration).every(Boolean));
  const result={task:'VG-013',browser:version.Browser,result:'PASS',productionDispatchRestored:false,modes,configuration:{optionsSave:true,popupSave:true,...migration},limitations:['临时扩展当前文档的隔离 runtime 验证，不是生产派发恢复','正式dist仅验证管理保存及schema迁移；生产首屏/热更新另用正式候选runner','未执行 Chrome119/其他浏览器或完整人工验收，无 provider/位置/ICE 请求']};
  if(args[1])await writeFile(resolve(args[1]),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  cdp?.close();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');done();},5000);child.once('exit',()=>{clearTimeout(timer);done();});});}
  server.closeAllConnections();await new Promise(done=>server.close(done));
  await rm(temporary,{recursive:true,force:true});
}
