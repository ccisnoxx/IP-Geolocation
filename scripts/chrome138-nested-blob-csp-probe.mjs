#!/usr/bin/env node
// 复用VG-034的40组资格fixture；HTTP父Worker显式补丁，不代表生产HTTP覆盖。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.equal(process.argv[2],'--port');assert.equal(process.argv[4],'--output');
const port=Number(process.argv[3]),output=resolve(process.argv[5]);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();assert.equal(version.Browser,'Chrome/138.0.7204.183');
const socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});let seq=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP_TIMEOUT:'+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}))})}
const server=spawn(resolve(root,'node_modules/.bin/tsx'),['scripts/serve-nested-blob-worker-probe.ts'],{cwd:root,stdio:['ignore','pipe','pipe']});let buffer='',failure='';server.stdout.on('data',d=>buffer+=d);server.stderr.on('data',d=>failure+=d);let targetId;
const evidence={task:'VG-036',browser:version.Browser,scope:'HTTP loopback qualification; synthetic explicit bootstrap; not production HTTP Worker support',result:'IN_PROGRESS',cleanup:'PENDING',rows:[],sha256:{}};
try{
 const end=Date.now()+15000;while(!buffer.includes('VG034_PROBE_URL=')&&Date.now()<end){assert.equal(server.exitCode,null,failure);await new Promise(r=>setTimeout(r,100))}
 const url=buffer.match(/VG034_PROBE_URL=(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];assert.ok(url,'fixture启动失败');
 targetId=(await send('Target.createTarget',{url:'about:blank'})).targetId;const t=await send('Target.attachToTarget',{targetId,flatten:true});await send('Page.enable',{},t.sessionId);await send('Page.navigate',{url},t.sessionId);
 const limit=Date.now()+60000;let state;
 while(Date.now()<limit){const r=await send('Runtime.evaluate',{expression:'document.body?.innerText',returnByValue:true},t.sessionId);state=r.result.value;if(state?.includes('DONE 40'))break;await new Promise(r=>setTimeout(r,100))}
 assert.ok(state?.includes('DONE 40'),'40组未全部完成');evidence.rows=state.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));assert.equal(evidence.rows.length,40);assert.ok(evidence.rows.every(r=>r.passed),'存在失败用例');
 for(const p of ['scripts/serve-nested-blob-worker-probe.ts','build/self-contained-runtime.ts','src/injected/runtime-modules/blob-worker-entry.ts','src/injected/runtime-modules/surfaces/blob-worker.ts'])evidence.sha256[p]=createHash('sha256').update(await readFile(resolve(root,p))).digest('hex');
 evidence.result='PASS';
}finally{
 if(targetId)await send('Target.closeTarget',{targetId});socket.close();server.kill('SIGTERM');await new Promise(r=>{if(server.exitCode!==null)r();else server.on('exit',r)});evidence.cleanup='PASS';await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
}
console.log(evidence.result,evidence.rows.length,'qualification rows; cleanup',evidence.cleanup);
