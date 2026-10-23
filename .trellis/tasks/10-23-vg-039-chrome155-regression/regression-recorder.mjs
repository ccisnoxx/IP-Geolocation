// 临时验收记录器：普通 HTTP 回环、人工只读计数，不操作扩展或配置。
import {createServer} from 'node:http';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

const [output,control,baselineFile,portText,resumeFile]=process.argv.slice(2);
if(!output||!control||!baselineFile||existsSync(output)||existsSync(control)) throw new Error('需要新的证据／控制文件和私有基线');
const port=portText===undefined?0:Number(portText);
if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('本机观测端口无效');
function canonical(v) { return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v; }
const baseline=JSON.parse(await readFile(baselineFile,'utf8'));
const baselineHash=createHash('sha256').update(JSON.stringify(canonical(baseline))).digest('hex');
const baselineProfileHash=createHash('sha256').update(JSON.stringify(canonical(baseline.exitLocationProfiles))).digest('hex');
const phases=['baseline','utc','la-old','la-new','off-old','off-new','restored'];
const instructions=['代理核对当前原始备份与只读摘要。','代理重建 UTC 观测文档并记录。','仅时区变更后，代理采旧文档并核对动态重载提示。','代理完整重建后采新文档，沿用上一阶段注册读回。','四项关闭后，代理先采旧文档并核对注册清理。','代理完整重建后采新文档，沿用上一阶段注册读回。','按已核验的普通保存接口恢复原始配置，禁止文件导入；代理重建文档后核对。'];
function signal() { const r=Intl.DateTimeFormat().resolvedOptions(); return {language:navigator.language,languages:Array.from(navigator.languages),locale:r.locale,timeZone:r.timeZone,winter:new Date(Date.UTC(2026,0,15)).getTimezoneOffset(),summer:new Date(Date.UTC(2026,6,15)).getTimezoneOffset()}; }
async function readback(probeUrl) {
  function canonical(v) { return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v; }
  async function hash(v) { const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''); }
  const [u,c,d,s,local,session,rtc,loopbackTabs]=await Promise.all([chrome.userScripts.getScripts(),chrome.scripting.getRegisteredContentScripts(),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.storage.local.get('siteSpoofConfig'),chrome.storage.session.get('runtimeSyncMetadata'),chrome.privacy.network.webRTCIPHandlingPolicy.get({}),chrome.tabs.query({url:'http://127.0.0.1/*'})]);
  const config=local.siteSpoofConfig, r=session.runtimeSyncMetadata?.report;
  if(!config||config.schemaVersion!==3||!r||!Array.isArray(session.runtimeSyncMetadata.pendingReloads)) throw new Error('配置或同步报告尚未确认');
  const probe=loopbackTabs.filter(x=>x.url===probeUrl);
  const owned=d.filter(x=>x.id>=40000&&x.id<=49999).sort((a,b)=>a.id-b.id);
  return {configHash:await hash(config),profileHash:await hash(config.exitLocationProfiles),masterEnabled:config.masterEnabled,webRtcMode:config.webRtc.globalMode,rtcPolicy:rtc.value,rtcControl:rtc.levelOfControl,
    verified:config.exitLocationProfiles.filter(x=>x.verification==='verified').length,bound:config.rules.filter(x=>x.exitLocationProfileId!==null).length,
    probeTabs:probe.length,probePageDebt:session.runtimeSyncMetadata.pendingReloads.filter(x=>probe.some(t=>t.id===x.tabId)&&(!x.surfaces||x.surfaces.includes('page'))).length,
    page:u.filter(x=>x.id.startsWith('vanishgeo-language-timezone-')).length,geo:u.filter(x=>x.id.startsWith('vanishgeo-geolocation-')).length,font:c.filter(x=>x.id.startsWith('vanishgeo-font-exposure-')).length,
    legacy:c.filter(x=>x.id==='vanishgeo-runtime-init').length,dynamic:owned.length,session:s.filter(x=>x.id>=30000&&x.id<=39999).length,headerHash:await hash(owned),
    pageState:r.pageRuntime?.state??'unknown',geoState:r.geolocationRuntime?.state??'unknown',fontState:r.fontRuntime?.state??'unknown',
    pageCount:r.pageRuntime?.registeredRuleCount??null,geoCount:r.geolocationRuntime?.registeredRuleCount??null,fontCount:r.fontRuntime?.registeredRuleCount??null,
    pageReload:r.pageRuntime?.reloadRequired??false,status:r.status,headers:r.components.headers?.status??'unknown',content:r.components.contentScripts.status,webrtc:r.components.webrtc.status};
}
const expression=()=> 'JSON.stringify(await ('+readback.toString()+')('+JSON.stringify(parentOrigin+'/parent')+'), null, 2)';
const keys=['configHash','profileHash','masterEnabled','webRtcMode','rtcPolicy','rtcControl','verified','bound','probeTabs','probePageDebt','page','geo','font','legacy','dynamic','session','headerHash','pageState','geoState','fontState','pageCount','geoCount','fontCount','pageReload','status','headers','content','webrtc'];
function validReadback(x) {
  if(!x||typeof x!=='object'||JSON.stringify(Object.keys(x).sort())!==JSON.stringify([...keys].sort())) throw new Error('只接受指定的计数与摘要，不接受配置正文或注册 ID');
  for(const k of ['configHash','profileHash','headerHash']) if(!/^[a-f0-9]{64}$/.test(x[k])) throw new Error('摘要格式无效');
  for(const k of ['masterEnabled','pageReload']) if(typeof x[k]!=='boolean') throw new Error('状态格式无效');
  for(const k of ['verified','bound','probeTabs','probePageDebt','page','geo','font','legacy','dynamic','session','pageCount','geoCount','fontCount']) if(!(Number.isSafeInteger(x[k])&&x[k]>=0)&&!(k.endsWith('Count')&&x[k]===null)) throw new Error('计数格式无效');
  if(!['strict','compatible','default'].includes(x.webRtcMode)) throw new Error('WebRTC 模式无效');
  if(!['default','default_public_interface_only','default_public_and_private_interfaces','disable_non_proxied_udp'].includes(x.rtcPolicy)||!['not_controllable','controlled_by_other_extensions','controllable_by_this_extension','controlled_by_this_extension'].includes(x.rtcControl))throw new Error('WebRTC 实际策略格式无效');
  for(const k of ['pageState','geoState']) if(!['ready','disabled','api-unsupported','permission-required','switch-required','sync-failed','unknown'].includes(x[k])) throw new Error('页面状态无效');
  if(!['ready','disabled','paused','custom-paused','sync-failed','unknown'].includes(x.fontState)) throw new Error('字体状态无效');
  for(const k of ['status','headers','content','webrtc']) if(!['ok','partial','failed','unknown'].includes(x[k])) throw new Error('同步状态无效');
}
function validSignal(x) {
  const expected=['language','languages','locale','timeZone','winter','summer'];
  return Boolean(x&&typeof x==='object'&&JSON.stringify(Object.keys(x).sort())===JSON.stringify(expected.sort())&&
    ['language','locale','timeZone'].every(k=>typeof x[k]==='string'&&x[k].length>0)&&
    Array.isArray(x.languages)&&x.languages.length>0&&x.languages.every(v=>typeof v==='string'&&v.length>0)&&
    ['winter','summer'].every(k=>Number.isSafeInteger(x[k])));
}
function baselineComparable(observation) {
  if(!observation||observation.error)return false;
  const {parent,child}=observation;
  if(!parent||!child||!parent.token||!child.token||parent.token===child.token)return false;
  const signals=[parent.first,parent.live,child.first,child.live];
  if(!signals.every(validSignal))return false;
  const reference=JSON.stringify(canonical(parent.first));
  if(!signals.every(x=>JSON.stringify(canonical(x))===reference))return false;
  return Array.isArray(child.workers)&&child.workers.length===2&&['classic','module'].every(type=>{
    const workers=child.workers.filter(x=>x?.type===type);
    return workers.length===1&&!workers[0].error&&validSignal(workers[0].signal)&&JSON.stringify(canonical(workers[0].signal))===reference;
  });
}
const evidence={task:'VG-039',status:'IN_PROGRESS',scope:'当前原始备份；保留可信档案的普通保存恢复；关闭注册与iframe提示',baselineHash,baselineProfileHash,baselineVerifiedCount:baseline.exitLocationProfiles.filter(x=>x.verification==='verified').length,baselineBoundCount:baseline.rules.filter(x=>x.exitLocationProfileId!==null).length,records:[],cleanup:null,limitations:['扩展配置及注册摘要由用户在正常控制台手工只读采集；网页不访问扩展API','重载提示可见性由用户确认，不能冒充自动读取扩展DOM','恢复仅走现有普通保存接口，后台保留当前可信档案，不使用文件导入或建立verified身份','不调用定位、ICE或外部provider；没有其他扩展或Chrome设置操作']};
// 记录进程已两次在交接期间退出；续采保留原始记录及来源摘要，不重造浏览器基线。
if(resumeFile){
  const bytes=await readFile(resumeFile),previous=JSON.parse(bytes);
  if(previous.baselineHash!==baselineHash||previous.baselineProfileHash!==baselineProfileHash||previous.baselineVerifiedCount!==evidence.baselineVerifiedCount||previous.baselineBoundCount!==evidence.baselineBoundCount||!previous.records?.length||previous.records.length>=phases.length||JSON.stringify(previous.records.map(x=>x.phase))!==JSON.stringify(phases.slice(0,previous.records.length))||!previous.baselineChecks||!Object.values(previous.baselineChecks).every(x=>x===true))throw new Error('续采来源未通过基线或阶段核对');
  previous.records.forEach(x=>validReadback(x.privileged));
  evidence.records=previous.records;
  evidence.baselineChecks=previous.baselineChecks;
  evidence.resumedFromSha256=createHash('sha256').update(bytes).digest('hex');
}
const save=()=>writeFile(output,JSON.stringify(evidence,null,2)+'\n');
let parentOrigin,childOrigin,closing=false,queue=Promise.resolve(),blocked=false;
const state=()=>({phase:phases[evidence.records.length]??null,instruction:instructions[evidence.records.length]??'采样已结束，等待代理核验。',blocked});
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
function parentHtml() { return `<!doctype html><meta charset="utf-8"><title>VG-039 两项回归</title><script>window.first=${signal.toString()}();window.token=crypto.randomUUID();</script>
<style>body{font:16px system-ui;max-width:960px;margin:30px auto;padding:0 20px;line-height:1.6}textarea,pre{width:100%;box-sizing:border-box;white-space:pre-wrap}textarea{height:160px}button{padding:10px 20px}pre{font-size:12px;background:#eee;padding:12px}</style>
<h1>VanishGeo：关闭注册与 iframe 回归</h1><p id="phase"></p><p>由代理负责采样和翻页；用户只需在扩展正常界面操作，并回复只读摘要。</p><textarea id="snapshot"></textarea><p><label><input type="checkbox" id="hint">我已在 VanishGeo 管理页看到“已有受影响页面需完整重载／关闭后重新打开”提示（la-old 必须确认）</label></p><button id="record">记录当前阶段</button><p id="result"></p><div id="frame"></div><details><summary>只读控制台表达式（不含配置正文或注册ID输出）</summary><pre>${esc(expression())}</pre></details>
<script>
const read=${signal.toString()}, c=${JSON.stringify(childOrigin)};
const frame=document.createElement('iframe');frame.title='localhost 子文档';frame.style='width:100%;height:70px';
const ready=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));frame.src=c+'/child';document.getElementById('frame').append(frame);
let current;
async function update(){current=await fetch('/state',{cache:'no-store'}).then(r=>r.json());document.getElementById('phase').textContent=(current.phase??'结束')+'：'+current.instruction;document.getElementById('record').disabled=!current.phase||current.blocked;}
async function sample(){await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('iframe-load-timeout')),15000);ready.then(()=>{clearTimeout(t);resolve();});});const id=crypto.randomUUID();const child=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('iframe-timeout'));},15000);function receive(e){if(e.source!==frame.contentWindow||e.origin!==c||e.data?.id!==id)return;clearTimeout(timeout);window.removeEventListener('message',receive);resolve(e.data);}window.addEventListener('message',receive);frame.contentWindow.postMessage({id},c);});const browser=await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);return {parent:{token,first,live:read()},child,browser:browser.fullVersionList};}
document.getElementById('record').onclick=async()=>{const button=document.getElementById('record');button.disabled=true;try{const text=document.getElementById('snapshot').value;const privileged=text.trim()?JSON.parse(text):null;let observation;try{observation=await sample();}catch(e){observation={error:e.message};}const response=await fetch('/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:current.phase,privileged,sawHint:document.getElementById('hint').checked,observation})});const result=await response.json();if(!response.ok)throw new Error(result.error);document.getElementById('snapshot').value='';document.getElementById('hint').checked=false;await update();document.getElementById('result').textContent=result.message;}catch(e){document.getElementById('result').textContent='未记录：'+e.message;button.disabled=false;}};update();
</script>`; }
function childHtml(header) { return `<!doctype html><meta charset="utf-8"><title>localhost 子文档</title><script>
const read=${signal.toString()},first=read(),token=crypto.randomUUID(),parentOrigin=${JSON.stringify(parentOrigin)},header=${JSON.stringify(header).replaceAll('<','\\u003c')};
async function worker(type){let w,t;const url=URL.createObjectURL(new Blob(['postMessage(('+read.toString()+')())'],{type:'text/javascript'}));try{return await new Promise(resolve=>{const finish=x=>{clearTimeout(t);resolve({type,...x});};try{w=new Worker(url,{type});w.onmessage=e=>finish({signal:e.data});w.onerror=e=>{e.preventDefault();finish({error:'worker-error'});};t=setTimeout(()=>finish({error:'worker-timeout'}),12000);}catch(e){finish({error:'worker-construction-error'});}});}finally{w?.terminate();URL.revokeObjectURL(url);}}
window.addEventListener('message',async e=>{if(e.source!==parent||e.origin!==parentOrigin||typeof e.data?.id!=='string')return;parent.postMessage({id:e.data.id,token,first,live:read(),header,workers:await Promise.all([worker('classic'),worker('module')])},parentOrigin);});
</script><p>仅普通 localhost iframe 的首次／当前语言时区与本页 Blob Worker。</p>`; }
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
const server=createServer(async(request,response)=>{
  response.setHeader('Cache-Control','no-store');
  if(request.method==='GET'&&request.url==='/parent'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(parentHtml());return;}
  if(request.method==='GET'&&request.url==='/child'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(childHtml(request.headers['accept-language']??''));return;}
  if(request.method==='GET'&&request.url==='/state'){await queue;json(response,200,state());return;}
  if(request.method!=='POST'||request.url!=='/record'){json(response,404,{error:'Not Found'});return;}
  if(request.headers.origin!==parentOrigin){json(response,403,{error:'Origin rejected'});return;}
  try{
    const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>128*1024)throw new Error('请求过大');chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const operation=queue.then(async()=>{
      if(blocked||body.phase!==state().phase)throw new Error('阶段不符，原始记录不覆盖');
      const reused=body.privileged===null&&['la-new','off-new'].includes(body.phase);
      if(reused) body.privileged=evidence.records.at(-1).privileged;
      validReadback(body.privileged);
      if(typeof body.sawHint!=='boolean')throw new Error('提示确认格式无效');
      evidence.records.push({phase:body.phase,source:reused?'previous-phase-readback':'user-copied-read-only-counts',privileged:body.privileged,sawHint:body.sawHint,observation:body.observation,recordedAt:new Date().toISOString()});
      if(body.phase==='baseline'){
        evidence.baselineChecks={configMatches:body.privileged.configHash===baselineHash,profilesMatch:body.privileged.profileHash===baselineProfileHash&&body.privileged.verified===evidence.baselineVerifiedCount&&body.privileged.bound===evidence.baselineBoundCount,realmsComparable:baselineComparable(body.observation),probeIdentified:body.privileged.probeTabs===1,chrome155:Array.isArray(body.observation?.browser)&&body.observation.browser.some(x=>x.brand==='Google Chrome'&&/^155\./.test(x.version))};
        if(!Object.values(evidence.baselineChecks).every(Boolean)){blocked=true;evidence.status='BASELINE_UNCONFIRMED';}
      }
      await save();return {message:blocked?'基线未通过只读核验；停止配置切换，等待代理核对。':'已保存原始观测；按下一阶段说明继续。'};
    });queue=operation.catch(()=>{});json(response,200,await operation);
  }catch{json(response,400,{error:'输入或阶段未通过检查；只接受指定的计数／摘要 JSON，记录未覆盖。'});}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
parentOrigin='http://127.0.0.1:'+server.address().port;childOrigin='http://localhost:'+server.address().port;
evidence.recorderSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
await save();await writeFile(control,JSON.stringify({pid:process.pid,parent:parentOrigin+'/parent'})+'\n');console.log('RECORDER_READY',parentOrigin+'/parent');
async function finish(){if(closing)return;closing=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await queue;await rm(control,{force:true});evidence.cleanup={serverClosed:!server.listening,controlRemoved:true};if(evidence.status==='IN_PROGRESS')evidence.status=evidence.records.length===7?'COLLECTED':'INCOMPLETE';await save();}
process.once('SIGINT',finish);process.once('SIGTERM',finish);
