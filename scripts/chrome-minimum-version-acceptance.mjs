#!/usr/bin/env node
// 原生 UI 驱动验收：本脚本只提供 loopback fixture、合成 provider 和只读取证。
// 安装、开关、Options 输入/确认、导航及退出由操作者在 Chrome 原生 UI 完成。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const chrome=process.env.CHROME_BIN;
assert.ok(chrome,'需要 CHROME_BIN');
assert.equal(process.argv[2],'--output');
const output=resolve(process.argv[3]);
const temporary=await mkdtemp(join(tmpdir(),'vg-minimum-chrome-'));
const profile=join(temporary,'profile');
const evidence={scope:'Chrome 138 normal UI acceptance',result:'IN_PROGRESS',chrome:null,distSha256:null,
 environment:{os:process.platform,arch:process.arch,temporaryProfile:true,normalUiInstallation:true,optionsInteraction:'native UI',provider:'synthetic response intercepted before external request',fixture:'HTTP loopback'},
 phases:{},coldStarts:[],providerRequests:0,errors:[],checks:{},cleanup:'PENDING',limitations:['仅macOS arm64和Chrome 138.0.7204.183；非全部平台或全部故障组合','provider为合成响应，不验证真实出口定位精度','HTTP fixture首inline可测；第三方HTTPS若补测仅按实际观测范围解释','Chrome自身后台网络未全量监控']};
async function fingerprint(){const h=createHash('sha256');async function visit(p=''){for(const e of (await readdir(join(root,'dist',p),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(!p&&e.name==='_metadata')continue;const n=join(p,e.name);if(e.isDirectory())await visit(n);else{h.update(n);h.update(await readFile(join(root,'dist',n)));}}}await visit();return h.digest('hex');}
evidence.distSha256=await fingerprint();
let phase='native',browser,socket,seq=0,connected=false,launchedAt=0;
const pending=new Map(),targets=new Map();
const save=()=>writeFile(output,JSON.stringify(evidence,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1200;i++){const v=await fn();if(v)return v;await pause(100);}throw new Error('等待超时');}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(req.url==='/echo'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({header:req.headers['accept-language']||''}));return;}
 if(req.url==='/report'&&req.method==='POST'){
  let body='';for await(const data of req)body+=data;
  const report=JSON.parse(body);const bucket=evidence.phases[phase]??={navigations:[],reports:[]};
  bucket.reports.push({...report,beforeCdp:!connected,sinceLaunchMs:Date.now()-launchedAt});
  await save();res.end('ok');console.log('REPORT',phase,JSON.stringify(report));return;
 }
 const nonce=randomUUID(),header=req.headers['accept-language']||'';
 const bucket=evidence.phases[phase]??={navigations:[],reports:[]};
 bucket.navigations.push({nonce,header,host:req.headers.host,path:req.url,beforeCdp:!connected,sinceLaunchMs:Date.now()-launchedAt});
 res.setHeader('Content-Type','text/html;charset=utf-8');
 res.end(`<!doctype html><html><head><script>
 const c=document.createElement('canvas').getContext('2d');
 function w(f){c.font='32px '+f;return c.measureText('Wim中文012').width;}
 const snapshot={nonce:${JSON.stringify(nonce)},header:${JSON.stringify(header)},firstInline:true,language:navigator.language,languages:[...navigator.languages],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,fonts:{pingfang:document.fonts.check('16px "PingFang SC"'),times:w('"Times New Roman"'),sans:w('sans-serif'),serif:w('serif')}};
 fetch('/echo').then(r=>r.json()).then(r=>{snapshot.subresourceHeader=r.header;document.getElementById('result').textContent=JSON.stringify(snapshot,null,2);return fetch('/report',{method:'POST',body:JSON.stringify(snapshot)})});
 </script></head><body><h1>VanishGeo Chrome 138 observation</h1><pre id="result"></pre></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP_TIMEOUT:'+method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});}
async function evaluate(sessionId,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,'只读表达式失败');return r.result.value;}
async function connect(){
 const port=await until(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}});
 const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
 assert.match(version.Browser,/Chrome\/138\.0\.7204\.183$/);evidence.chrome=version.Browser;
 socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});connected=true;
 socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
 void(async()=>{
  if(m.method==='Target.attachedToTarget'){
   const sid=m.params.sessionId,info=m.params.targetInfo;targets.set(info.targetId,{sid,info});
   if(info.type==='service_worker')await send('Fetch.enable',{patterns:['https://ipwho.is/*','https://ipapi.co/*','https://ipinfo.io/*'].map(urlPattern=>({urlPattern}))},sid);
   await send('Runtime.runIfWaitingForDebugger',{},sid);
  }else if(m.method==='Target.detachedFromTarget'){for(const[id,t]of targets)if(t.sid===m.params.sessionId)targets.delete(id);
  }else if(m.method==='Fetch.requestPaused'){
   evidence.providerRequests++;
   await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({success:true,ip:'203.0.113.10',latitude:0,longitude:0,country:'Synthetic',country_code:'JP',timezone:{id:'Asia/Tokyo'}})).toString('base64')},m.sessionId);await save();
  }
 })().catch(e=>{evidence.errors.push(e.message);console.error(e.message);});
 };
 await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});await save();
}
async function launch(initial=false){launchedAt=Date.now();connected=false;targets.clear();browser=spawn(chrome,['--remote-debugging-port=0','--user-data-dir='+profile,'--disable-background-networking','--disable-component-update','--no-proxy-server','--no-first-run','--no-default-browser-check',...(initial?[`http://localhost:${port}/probe`]:[])],{stdio:'ignore'});if(initial)await connect();}
function processTree(){const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));const pids=new Set([browser.pid]);let n;do{n=pids.size;for(const[p,pp]of rows)if(pids.has(pp))pids.add(p);}while(n!==pids.size);return [...pids];}
let exiting=[];
console.log('FIXTURE',`http://localhost:${port}/probe`,'UNMATCHED',`http://127.0.0.1:${port}/probe`);
console.log('Commands: phase <label>, inspect, arm-exit, restart <label>, connect, finish');
await launch(true);
const input=createInterface({input:process.stdin});
for await(const line of input){
 const [cmd,arg]=line.trim().split(' ');
 try{
  if(cmd==='phase'){assert.ok(arg);phase=arg;console.log('PHASE',phase);}
  else if(cmd==='inspect'){
   const all=await send('Target.getTargets');const info=all.targetInfos.find(t=>t.url.startsWith('chrome-extension://')&&t.url.includes('/options/'));
   assert.ok(info,'请先用UI打开Options');let t=targets.get(info.targetId);if(!t){const r=await send('Target.attachToTarget',{targetId:info.targetId,flatten:true});t={sid:r.sessionId};}
   const state=await evaluate(t.sid,`(async()=>{const c=(await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig;const m=(await chrome.storage.session.get('runtimeSyncMetadata')).runtimeSyncMetadata;return {masterEnabled:c?.masterEnabled,rules:c?.rules?.map(r=>({domain:r.domain,enabled:r.enabled,overrides:r.overrides})),verified:c?.exitLocationProfiles?.map(p=>p.verification),sync:m?.report,ui:{setup:document.getElementById('setupStatus')?.dataset.setup,status:document.getElementById('runtimeSyncStatus')?.dataset.status,onboarding:document.getElementById('onboardingStatus')?.textContent,recommendation:document.getElementById('onboardingRecommendation')?.textContent},dynamicCount:(await chrome.declarativeNetRequest.getDynamicRules()).length}})()`);
   (evidence.phases[phase]??={navigations:[],reports:[]}).state=state;await save();console.log('STATE',JSON.stringify(state));
  }else if(cmd==='arm-exit'){exiting=processTree();console.log('EXIT_ARMED',exiting.length);}
  else if(cmd==='restart'){
   assert.ok(exiting.length);assert.equal(browser.exitCode,0,'必须先用UI完全退出');
   assert.ok(exiting.every(pid=>{try{process.kill(pid,0);return false;}catch(e){assert.equal(e.code,'ESRCH');return true;}}),'进程树仍有成员');
   evidence.coldStarts.push({phase:arg,gracefulExit:true,observedProcessCount:exiting.length,observedProcessTreeExited:true,noStartupUrl:true});
   socket?.close();await rm(join(profile,'DevToolsActivePort'),{force:true});phase=arg;await launch();console.log('RESTARTED_NO_CDP');await save();
  }else if(cmd==='connect'){await connect();console.log('CONNECTED', { reportsBeforeConnect: evidence.phases[phase]?.reports.filter(r=>r.beforeCdp).length || 0 });}
  else if(cmd==='finish'){
   assert.equal(browser.exitCode,0,'先用UI退出');assert.ok(exiting.every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}));
   assert.equal(await fingerprint(),evidence.distSha256);evidence.result='OBSERVATIONS_COMPLETE';evidence.cleanup='PASS';socket?.close();server.close();await rm(temporary,{recursive:true,force:true});await save();console.log('FINISHED');input.close();process.stdin.pause();break;
  }
 }catch(e){evidence.errors.push({command:cmd,message:e.message});await save();console.error('COMMAND_FAILED',e.message);}
}
