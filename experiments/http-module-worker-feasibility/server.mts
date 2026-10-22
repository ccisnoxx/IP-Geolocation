// 历史实验夹具：仅替换机器路径和输出目录；正式采样入口为 /case?case=baseline。
// 未接入生产；原 iframe 根入口未完成，保留供解释历史夹具，不用于复验。
import http from 'node:http';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateBlobWorkerRuntime,assertSelfContainedFunction} from '../../build/self-contained-runtime.ts';
const out=mkdtempSync(join(tmpdir(),'vanishgeo-http-module-'));
console.log('PROBE_OUTPUT='+out);
const runtime=assertSelfContainedFunction((await generateBlobWorkerRuntime()).code,'applyBlobWorkerRuntime');
const payload={language:{language:'en-US',languages:['en-US','en']},timezone:'America/Los_Angeles',intlMode:'compatible'};
const prelude=`(${runtime})(${JSON.stringify(payload)});`;
const cases=['baseline','page-worker-self','page-worker-none','page-connect-none','response-connect-none','response-worker-none','response-script-none','response-report-only','redirect'];
const requests:any[]=[];const results:any[]=[];
const pagePolicy=(c:string)=>`default-src 'self'; script-src 'self' 'nonce-probe' blob:; worker-src ${c==='page-worker-none'?"'none'":c==='page-worker-self'?"'self'":"'self' blob:"}; connect-src ${c==='page-connect-none'?"'none'":"'self'"}`;
const responsePolicy=(c:string)=>c==='response-connect-none'?"connect-src 'none'":c==='response-worker-none'?"worker-src 'none'":c==='response-script-none'?"script-src 'none'":null;
const snapshot=`({language:navigator.language,languages:[...navigator.languages],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,winter:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),summer:new Date('2026-07-15T12:00:00Z').getTimezoneOffset()})`;
const entry=`import {dep} from './dep.js';
const violations=[];addEventListener('securitypolicyviolation',e=>violations.push({directive:e.effectiveDirective,disposition:e.disposition,blocked:e.blockedURI}));
const capture=async f=>{try{return {ok:true,value:await f()}}catch(e){return {ok:false,name:e.name,message:e.message}}};
const child=url=>new Promise((resolve,reject)=>{let w,t;try{w=new Worker(url,{type:'module'});t=setTimeout(()=>{w.terminate();reject(new Error('child-timeout'))},1500);w.onmessage=e=>{clearTimeout(t);w.terminate();resolve(e.data)};w.onerror=e=>{e.preventDefault();clearTimeout(t);w.terminate();reject(new Error('child-error'))}}catch(e){reject(e)}});
const xhr=url=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET',url);x.onload=()=>resolve(x.responseText);x.onerror=()=>reject(new Error('xhr-error'));x.send()});
const r={entry:import.meta.url,location:self.location.href,first:${snapshot},dep};
r.dynamic=await capture(async()=>{const m=await import('./dynamic.js');return m.dynamic});
r.asset=await capture(async()=>await (await fetch(new URL('./asset.json',import.meta.url))).json());
r.relativeFetch=await capture(async()=>await (await fetch('./asset.json')).json());
r.relativeXHR=await capture(()=>xhr('./asset.json'));
r.absoluteFetch=await capture(async()=>await (await fetch(new URL('/asset.json',import.meta.url))).json());
r.relativeChild=await capture(()=>child('./child.js'));
r.moduleRelativeChild=await capture(()=>child(new URL('./child.js',import.meta.url)));
await new Promise(r=>setTimeout(r,80));r.violations=violations;postMessage(r);`;
const runner=`(async()=>{const c=new URL(location.href).searchParams.get('case');const outcomes=[];addEventListener('error',e=>parent.postMessage({case:c,fixtureError:e.message},location.origin));const shared=globalThis.SharedWorker;
for(const mode of ['native','wrapped']){
 parent.postMessage({stage:c+':'+mode},location.origin);const urls=[];const target=new URL((c==='redirect'?'/redirect.js':'/modules/entry.js')+'?case='+c+'&mode='+mode,location.href).href;
 let url=target;if(mode==='wrapped'){const p=URL.createObjectURL(new Blob([${JSON.stringify(prelude)}],{type:'text/javascript'}));urls.push(p);url=URL.createObjectURL(new Blob(['import '+JSON.stringify(p)+';\\nimport '+JSON.stringify(target)+';'],{type:'text/javascript'}));urls.push(url)}
 const result=await new Promise(resolve=>{let w,t;try{w=new Worker(url,{type:'module'});t=setTimeout(()=>{w.terminate();resolve({status:'timeout'})},6000);w.onmessage=e=>{clearTimeout(t);w.terminate();resolve({status:'message',data:e.data})};w.onerror=e=>{e.preventDefault();clearTimeout(t);w.terminate();resolve({status:'error',message:e.message||'worker-error'})}}catch(e){resolve({status:'constructor-error',name:e.name,message:e.message})}});
 urls.forEach(u=>URL.revokeObjectURL(u));outcomes.push({mode,...result});
}
const result={case:c,outcomes,sharedUnchanged:shared===globalThis.SharedWorker,controlledBySW:!!navigator.serviceWorker.controller};document.body.textContent=JSON.stringify(result,null,2);await fetch('/case-results',{method:'POST',body:JSON.stringify({userAgent:navigator.userAgent,result})});const cases=${JSON.stringify(cases)};const next=cases[cases.indexOf(c)+1];location.href=next?'/case?case='+next:'/summary';
})();`;
const index=`<!doctype html><meta charset="utf-8"><title>HTTP module Worker 可行性实验</title><h1>当前 Chrome：原生与 Blob 包装对照</h1><pre id="status">RUNNING</pre><main id="results"></main><script>
(async()=>{const results=[];for(const c of ${JSON.stringify(cases)}){const result=await new Promise(resolve=>{const f=document.createElement('iframe');f.style.height='50px';const listener=e=>{if(e.data.stage)document.querySelector('#status').textContent=e.data.stage;if(e.source===f.contentWindow&&e.origin===location.origin&&e.data.case===c){removeEventListener('message',listener);resolve(e.data)}};addEventListener('message',listener);f.src='/case?case='+c;document.body.append(f)});results.push(result);const p=document.createElement('pre');p.textContent=JSON.stringify(result,null,2);document.querySelector('#results').append(p)}const evidence={userAgent:navigator.userAgent,createdAt:new Date().toISOString(),scope:'current Chrome; HTTP loopback; no extension config changes',results};await fetch('/results',{method:'POST',body:JSON.stringify(evidence)});document.querySelector('#status').textContent='DONE '+results.length+' pairs';})();</script>`;
const server=http.createServer((req,res)=>{const u=new URL(req.url!,'http://localhost');res.setHeader('Cache-Control','no-store');let policy=responsePolicy(u.searchParams.get('case')||'');
 if(u.pathname==='/case-results'&&req.method==='POST'){let b='';req.on('data',d=>b+=d);req.on('end',()=>{const e=JSON.parse(b);results.push(e.result);writeFileSync(out+'/evidence.json',JSON.stringify({userAgent:e.userAgent,createdAt:new Date().toISOString(),scope:'current Chrome; HTTP loopback; no extension config changes',results,requests},null,2));res.end('saved');console.log('CASE_SAVED',e.result.case)});return}
 if(u.pathname==='/summary'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<meta charset="utf-8"><h1>DONE '+results.length+' pairs</h1><pre>'+JSON.stringify(results,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')+'</pre>');return}
 if(u.pathname==='/results'&&req.method==='POST'){let b='';req.on('data',d=>b+=d);req.on('end',()=>{writeFileSync(out+'/evidence.json',JSON.stringify({...JSON.parse(b),requests},null,2));res.end('saved');console.log('EVIDENCE_SAVED')});return}
 console.log(req.method,u.pathname,u.search);requests.push({path:u.pathname,query:u.search,method:req.method,destination:req.headers['sec-fetch-dest']||null,responseCSP:u.pathname.endsWith('entry.js')?policy:u.pathname==='/case'?pagePolicy(u.searchParams.get('case')!):null});
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(index)}
 else if(u.pathname==='/case'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',pagePolicy(u.searchParams.get('case')!).replace("connect-src 'none'",'connect-src http://'+req.headers.host+'/case-results'));res.end('<!doctype html><meta charset="utf-8"><body><h1>Worker probe</h1><script nonce="probe">'+runner+'</script>')}
 else if(u.pathname==='/redirect.js'){res.writeHead(302,{Location:'/redirected/entry.js'+u.search});res.end()}
 else if(u.pathname.endsWith('/entry.js')){res.setHeader('Content-Type','text/javascript');if(policy)res.setHeader('Content-Security-Policy',policy);if(u.searchParams.get('case')==='response-report-only')res.setHeader('Content-Security-Policy-Report-Only',"connect-src 'none'; report-uri /csp-report");res.end(entry)}
 else if(u.pathname.endsWith('/dep.js')){res.setHeader('Content-Type','text/javascript');res.end(`export const dep={url:import.meta.url,first:${snapshot}};`)}
 else if(u.pathname.endsWith('/dynamic.js')){res.setHeader('Content-Type','text/javascript');res.end(`await Promise.resolve();export const dynamic={url:import.meta.url,first:${snapshot}};`)}
 else if(u.pathname.endsWith('/asset.json')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:u.pathname,synthetic:true}))}
 else if(u.pathname.endsWith('/child.js')){res.setHeader('Content-Type','text/javascript');res.end('postMessage({url:import.meta.url,location:location.href});')}
 else if(u.pathname==='/csp-report'){res.writeHead(204);res.end()}
 else {res.writeHead(404);res.end()}
});
server.listen(0,'127.0.0.1',()=>{const port=(server.address() as any).port;writeFileSync(out+'/url.txt','http://127.0.0.1:'+port+'/');console.log('PROBE_URL=http://127.0.0.1:'+port+'/')});
