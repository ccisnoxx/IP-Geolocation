#!/usr/bin/env node
// 原生 UI 导航到 example.com；只读观测真实 TLS 响应与实际发送的语言头。
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
assert.equal(process.argv[2],'--port');assert.equal(process.argv[4],'--output');
const port=Number(process.argv[3]),output=process.argv[5];
const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target=list.find(t=>t.type==='page'&&t.url.startsWith('http://localhost:'));
assert.ok(target,'需要已有loopback探针标签');
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
const pending=new Map(),requests=new Map();let seq=0;
const evidence={scope:'real HTTPS example.com postload observation',responses:[],failures:[],observations:[],limitations:['第三方站点仅记录标准Accept-Language和合成配置观测，站点可见测试网络出口；不保存公网IP','不证明HTTPS首inline或HTTPS冷启动；不绕过TLS验证，不安装证书','关闭后不调用原生定位，不测真实传感器结果']};
const save=()=>writeFile(output,JSON.stringify(evidence,null,2)+'\n');
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP_TIMEOUT'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
 const p=m.params;
 if(m.method==='Network.requestWillBeSent'&&p.type==='Document'&&p.request.url==='https://example.com/')requests.set(p.requestId,{url:p.request.url});
 if(m.method==='Network.requestWillBeSentExtraInfo'&&requests.has(p.requestId))requests.get(p.requestId).acceptLanguage=Object.entries(p.headers).find(([k])=>k.toLowerCase()==='accept-language')?.[1];
 if(m.method==='Network.responseReceived'&&requests.has(p.requestId)){
  const s=p.response.securityDetails;const record={requestId:p.requestId,status:p.response.status,securityState:p.response.securityState,protocol:s?.protocol,subjectName:s?.subjectName,issuer:s?.issuer,fromServiceWorker:p.response.fromServiceWorker,fromDiskCache:p.response.fromDiskCache};evidence.responses.push(record);void save();
 }
 if(m.method==='Network.loadingFailed'&&requests.has(p.requestId)){evidence.failures.push({error:p.errorText});void save();}
};
await send('Network.enable');console.log('HTTPS_OBSERVER_READY');
const input=createInterface({input:process.stdin});
for await(const line of input){
 const phase=line.trim();if(phase==='finish'){await save();socket.close();input.close();process.stdin.pause();break;}
 try{
 const r=await send('Runtime.evaluate',{expression:`(async()=>({url:location.href,secure:isSecureContext,language:navigator.language,languages:[...navigator.languages],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,title:document.title,geolocation:${phase==='enabled'?"await new Promise(resolve=>navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude}),e=>resolve({error:e.code}),{timeout:3000}))":"'not-called'"}}))()`,awaitPromise:true,returnByValue:true});
 assert.ok(!r.exceptionDetails);for(const response of evidence.responses){response.acceptLanguage=requests.get(response.requestId)?.acceptLanguage;}
 evidence.observations.push({phase,...r.result.value});await save();console.log(JSON.stringify(evidence));
 }catch(e){evidence.failures.push({phase,error:e.message});await save();console.error(e.message);}
}
