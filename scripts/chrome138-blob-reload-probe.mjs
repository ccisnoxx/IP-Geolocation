#!/usr/bin/env node
// 独立临时Chrome138中的关闭/reload快照边界；沿用同一生产fixture与正常管理消息。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
assert.equal(process.argv[2],'--port');assert.equal(process.argv[4],'--production');assert.equal(process.argv[6],'--output');
const production=JSON.parse(await readFile(process.argv[5],'utf8')),output=process.argv[7];
const blob=production.production.flatMap(r=>r.records).join('\n').match(/blob:(http:\/\/localhost:\d+)\//);assert.ok(blob);
const version=await(await fetch('http://127.0.0.1:'+Number(process.argv[3])+'/json/version')).json();assert.equal(version.Browser,'Chrome/138.0.7204.183');
const socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);let seq=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(new Error('CDP_TIMEOUT:'+method)),15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}))})}
async function evaluate(t,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},t.sessionId);assert.ok(!r.exceptionDetails);return r.result.value}
async function waitValue(fn){const end=Date.now()+15000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,80))}throw new Error('OBSERVATION_TIMEOUT')}
const evidence={task:'VG-036',chrome:version.Browser,scope:'production master switch and full reload; temporary profile; not browser restart',result:'IN_PROGRESS',observations:{},checks:[],cleanup:'PENDING'};
let target,options,config;const check=(name,passed)=>{evidence.checks.push({name,passed:!!passed});assert.ok(passed,name)};
const pick=v=>({language:v.language,languages:v.languages,timeZone:v.timeZone});const native=pick(production.production.find(r=>r.phase==='native-before-install').first),enabled={language:'en-US',languages:['en-US','en'],timeZone:'America/Los_Angeles'};const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
try{
 const infos=(await send('Target.getTargets')).targetInfos;const o=infos.find(t=>t.url.startsWith('chrome-extension://')&&t.url.endsWith('/options/options.html'));assert.ok(o);options={...await send('Target.attachToTarget',{targetId:o.targetId,flatten:true})};
 const message=async r=>{const v=await evaluate(options,'chrome.runtime.sendMessage('+JSON.stringify(r)+')');assert.ok(v&&v.status!=='error');return v};config=(await message({action:'getSiteConfig'})).config;assert.equal(config.masterEnabled,true);
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});target={targetId,...await send('Target.attachToTarget',{targetId,flatten:true})};await send('Page.enable',{},target.sessionId);await send('Page.navigate',{url:blob[1]+'/probe?policy=normal'},target.sessionId);
 const ready=()=>waitValue(async()=>{const s=await evaluate(target,'document.querySelector("pre")?.textContent');return s?.startsWith('{')?JSON.parse(s):null});await ready();
 const probe=`(async()=>{const s=()=>({language:navigator.language,languages:[...navigator.languages],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});const u=URL.createObjectURL(new Blob(['postMessage(('+s.toString()+')())'],{type:'text/javascript'}));const w=new Worker(u);URL.revokeObjectURL(u);try{return await new Promise((resolve,reject)=>{w.onmessage=e=>resolve(e.data);w.onerror=()=>reject(new Error('worker-error'));setTimeout(()=>reject(new Error('worker-timeout')),3000)})}finally{w.terminate()}})()`;
 evidence.observations.enabled=await evaluate(target,probe);check('enabled-worker',same(evidence.observations.enabled,enabled));
 config.masterEnabled=false;let saved=await message({action:'setSiteConfig',config});check('disabled-sync',saved.syncReport.pageRuntime.state==='disabled'&&saved.syncReport.components.headers.status==='ok');
 evidence.observations.disabledOldDocument=await evaluate(target,probe);check('old-document-retains-snapshot',same(evidence.observations.disabledOldDocument,enabled));
 await send('Page.reload',{},target.sessionId);await waitValue(()=>evaluate(target,'document.readyState==="complete"'));await ready();evidence.observations.disabledAfterReload=await evaluate(target,probe);check('disabled-full-reload-native',same(evidence.observations.disabledAfterReload,native));
 config.masterEnabled=true;saved=await message({action:'setSiteConfig',config});check('reenabled-sync',saved.syncReport.pageRuntime.state==='ready');evidence.observations.reenabledBeforeReload=await evaluate(target,probe);check('native-document-not-hot-patched',same(evidence.observations.reenabledBeforeReload,native));
 await send('Page.reload',{},target.sessionId);await waitValue(()=>evaluate(target,'document.readyState==="complete"'));await ready();evidence.observations.reenabledAfterReload=await evaluate(target,probe);check('reenabled-reload-synced',same(evidence.observations.reenabledAfterReload,enabled));evidence.result='PASS';
}finally{if(target)await send('Target.closeTarget',{targetId:target.targetId});if(options)await send('Target.detachFromTarget',{sessionId:options.sessionId});socket.close();evidence.cleanup='PASS';await writeFile(output,JSON.stringify(evidence,null,2)+'\n')}
console.log(evidence.result,evidence.checks.length,'reload checks');
