// 当前Chrome的Worker内部CSP/生命周期资格验证，仅loopback和合成payload。
import http from 'node:http';
import { generateBlobWorkerRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
const runtime = assertSelfContainedFunction((await generateBlobWorkerRuntime()).code, 'applyBlobWorkerRuntime');
const payload = {language:{language:'en-US',languages:['en-US','en']},timezone:'America/Los_Angeles',intlMode:'compatible'};
const leaf = `postMessage({language:navigator.language,languages:Array.from(navigator.languages),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})`;
const parent = (mode: string, kind: string, type: string) => `
const urls=[],warnings=[];
const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL), shared=globalThis.SharedWorker;
URL.createObjectURL=blob=>{const url=create(blob);urls.push(url);return url};
console.warn=(...args)=>warnings.push(String(args[0]));
${mode === 'patched' ? `(${runtime})(${JSON.stringify(payload)});` : ''}
onmessage=event=>{
 const kind=${JSON.stringify(kind)},type=${JSON.stringify(type)};
 let worker,timer,dependency;
 let source=kind==='error'?'throw new Error("probe-error")':${JSON.stringify(leaf)};
 if(${JSON.stringify(mode)}==='native-import'){dependency=URL.createObjectURL(new Blob(['globalThis.dependencyLoaded=true;'],{type:'text/javascript'}));source=(type==='module'?'import '+JSON.stringify(dependency)+';':'importScripts('+JSON.stringify(dependency)+');')+source;}
 const url=kind==='http'?new URL('/leaf.js',location.href).href:kind==='foreign'?event.data.foreign:URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
 if(kind==='revoked')URL.revokeObjectURL(url);
 const finish=outcome=>{clearTimeout(timer);if(dependency)URL.revokeObjectURL(dependency);const localLive=urls.map((url,i)=>{try{const x=new XMLHttpRequest();x.open('GET',url,false);x.send();return x.status===200?i:-1}catch{return -1}}).filter(i=>i>=0);postMessage({outcome,urls,warnings,localLive,sharedUnchanged:globalThis.SharedWorker===shared});};
 try {
  worker=new Worker(url,{type});
  timer=setTimeout(()=>{worker.terminate();finish({error:'timeout'})},5000);
  worker.onmessage=e=>finish({value:e.data});
  worker.onerror=e=>{e.preventDefault();finish({error:'worker-error'})};
  if(kind!=='foreign'&&kind!=='http')URL.revokeObjectURL(url);
  if(kind==='terminate'){worker.terminate();finish({terminated:true})}
 }catch(e){finish({error:e.name})}
};`;
const page = `<!doctype html><meta charset="utf-8"><title>VG-034 嵌套边界验证</title><h1>VG-034 Worker 内部对照</h1><main id="results"></main><script>
(async()=>{
const cases=[],importControls=new Map();
for(const type of ['classic','module']) {
 for(const policy of ['normal','connect-blocked','script-blocked','script-none','worker-blocked']) for(const mode of ['native','native-import','patched'])cases.push({type,policy,mode,kind:'success'});
 for(const kind of ['error','terminate','revoked','http','foreign'])cases.push({type,policy:'normal',mode:'patched',kind});
}
for(const c of cases){
 let parent;const foreign=URL.createObjectURL(new Blob([${JSON.stringify(leaf)}],{type:'text/javascript'}));
 const result=await new Promise(resolve=>{
 const timer=setTimeout(()=>{parent?.terminate();resolve({...c,passed:false,error:'parent-timeout'})},7000);
 parent=new Worker('/parent.js?'+new URLSearchParams(c),{type:c.type});
 parent.onerror=e=>{e.preventDefault();clearTimeout(timer);parent.terminate();resolve({...c,passed:false,error:'parent-error'})};
 parent.onmessage=async e=>{
 clearTimeout(timer);const d=e.data,v=d.outcome.value;
 const live=d.urls.filter(url=>{try{const x=new XMLHttpRequest();x.open('GET',url,false);x.send();return x.status===200}catch{return false}}).length;
 await new Promise(resolve=>setTimeout(resolve,100));
 const settled=d.urls.filter(url=>{try{const x=new XMLHttpRequest();x.open('GET',url,false);x.send();return x.status===200}catch{return false}}).length;
 const synced=!!v&&v.language==='en-US'&&JSON.stringify(v.languages)==='["en-US","en"]'&&v.timezone==='America/Los_Angeles';
 const warning=d.warnings.some(x=>x.includes('本次语言/时区未同步'));
 let expected;
 if(c.policy==='worker-blocked')expected=['worker-error','SecurityError'].includes(d.outcome.error);
 else if(c.kind==='terminate')expected=d.outcome.terminated;
 else if(c.kind==='revoked'||c.kind==='error')expected=d.outcome.error==='worker-error';
 else if(c.mode==='native-import'){importControls.set(c.type+':'+c.policy,!!v);expected=!!v||d.outcome.error==='worker-error';}
 else if(c.mode==='patched'&&(c.policy==='script-blocked'||c.policy==='script-none'))expected=importControls.get(c.type+':'+c.policy)?synced:d.outcome.error==='worker-error';
 else if(c.kind==='http'||c.kind==='foreign'||c.mode==='native')expected=!!v&&!synced;
 else if(c.policy==='connect-blocked')expected=!!v&&!synced&&warning;
 else expected=synced;
 parent.terminate();resolve({...c,passed:!!expected&&settled===0&&d.localLive.length===0&&d.sharedUnchanged,synced,warning,liveURLsBeforeParentTerminate:live,settled,localLive:d.localLive,error:d.outcome.error||null});
 };parent.postMessage({foreign});
 });URL.revokeObjectURL(foreign);
 const pre=document.createElement('pre');pre.textContent=JSON.stringify(result);document.querySelector('#results').append(pre);
}
const done=document.createElement('p');done.textContent='DONE '+cases.length;document.body.append(done);
})();</script>`;
const server=http.createServer((request,response)=>{
 const url=new URL(request.url!,'http://localhost');
 response.setHeader('Cache-Control','no-store');
 if(url.pathname==='/parent.js'){
  const mode=url.searchParams.get('mode')!,kind=url.searchParams.get('kind')!,type=url.searchParams.get('type')!,policy=url.searchParams.get('policy');
  response.setHeader('Content-Type','text/javascript');
  response.setHeader('Content-Security-Policy',`worker-src ${policy==='worker-blocked'?"'none'":"blob: 'self'"}; script-src ${policy==='script-none'?"'none'":"'self'"+(policy==='script-blocked'?'':' blob:')}; connect-src ${policy==='connect-blocked'?"'none'":'blob:'}`);
  response.end(parent(mode,kind,type));
 }else if(url.pathname==='/leaf.js'){response.setHeader('Content-Type','text/javascript');response.end(leaf)}
 else if(url.pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page)}
 else {response.writeHead(404);response.end()}
});
server.listen(0,'127.0.0.1',()=>console.log('VG034_PROBE_URL=http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port+'/'));
