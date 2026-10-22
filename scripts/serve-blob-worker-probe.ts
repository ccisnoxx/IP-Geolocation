// 当前Chrome的本地CSP/生命周期对照；不读写扩展配置，不连接外部服务。
import http from 'node:http';
import { generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';

const runtime = assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime');
const payload = { language: { language: 'en-US', languages: ['en-US', 'en'] }, timezone: 'America/Los_Angeles', intlMode: 'compatible' };
const cases = ['normal', 'connect-blocked', 'script-blocked'];
const modes = ['native', 'patched'];
const track = `window.probeURLs=[];window.probeWarnings=[];
const originalCreate=URL.createObjectURL;URL.createObjectURL=function(blob){const url=originalCreate.call(URL,blob);probeURLs.push(url);return url};
const originalWarn=console.warn;console.warn=function(...args){probeWarnings.push(String(args[0]));originalWarn.apply(console,args)};`;
const probe = `(async()=>{
  const [mode,policy]=location.pathname.slice(1).split('/');
  const inspector=document.createElement('iframe');inspector.src='/inspector';
  await new Promise(resolve=>{inspector.onload=resolve;document.body.append(inspector)});
  const source='postMessage({language:navigator.language,languages:Array.from(navigator.languages),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})';
  let worker;const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  const outcome=await new Promise(resolve=>{
    const timer=setTimeout(()=>{worker?.terminate();resolve({error:'timeout'})},4000);
    try {worker=new Worker(url);worker.onmessage=e=>{clearTimeout(timer);resolve({value:e.data})};
      worker.onerror=e=>{e.preventDefault();clearTimeout(timer);resolve({error:'worker-error'})};URL.revokeObjectURL(url)}
    catch(e){clearTimeout(timer);resolve({error:e.name})}
  });
  // 在terminate之前核验启动/error路径，避免terminate掩盖泄漏。
  const live=probeURLs.filter(url=>{try{const x=new inspector.contentWindow.XMLHttpRequest();x.open('GET',url,false);x.send();return x.status===200}catch{return false}}).length;
  worker?.terminate();URL.revokeObjectURL(url);inspector.remove();
  const value=outcome.value;
  const synced=!!value&&value.language==='en-US'&&JSON.stringify(value.languages)==='["en-US","en"]'&&value.timezone==='America/Los_Angeles';
  const native=!!value&&value.language===navigator.language&&value.timezone===Intl.DateTimeFormat().resolvedOptions().timeZone;
  const warning=probeWarnings.some(x=>x.includes('本次语言/时区未同步'));
  const expected=mode==='native'?native:policy==='normal'?synced:policy==='connect-blocked'?!!value&&!synced&&warning:outcome.error==='worker-error';
  const result={mode,policy,passed:expected&&live===0,businessRan:!!value,synced,warning,liveURLs:live,error:outcome.error||null};
  document.body.textContent=JSON.stringify(result);parent.postMessage({vg033:result},location.origin);
})()`;

const server = http.createServer((request, response) => {
  const path = new URL(request.url!, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/track.js' || path === '/install.js' || path === '/probe.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(path === '/track.js' ? track : path === '/install.js' ? `(${runtime})(${JSON.stringify(payload)});` : probe);
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (path === '/inspector') { response.end('<!doctype html><title>Blob store inspector</title>'); return; }
  if (path === '/') {
    response.end(`<!doctype html><title>VG-033 Blob Worker 对照</title><h1>VG-033 本地 Chrome 对照</h1><pre id="results"></pre>
      <script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.vg033)document.querySelector('#results').textContent+=JSON.stringify(e.data.vg033)+'\\n'})</script>
      ${modes.flatMap(mode => cases.map(policy => `<iframe src="/${mode}/${policy}" title="${mode} ${policy}"></iframe>`)).join('')}`);
    return;
  }
  const [mode, policy] = path.slice(1).split('/');
  if (!modes.includes(mode) || !cases.includes(policy)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Security-Policy', `script-src 'self'${policy === 'script-blocked' ? '' : ' blob:'}; worker-src blob:; connect-src ${policy === 'connect-blocked' ? "'none'" : 'blob:'}`);
  response.end(`<!doctype html><title>${mode} ${policy}</title><script src="/track.js"></script>${mode === 'patched' ? '<script src="/install.js"></script>' : ''}<script defer src="/probe.js"></script>`);
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address() as import('node:net').AddressInfo;
  console.log(`VG033_PROBE_URL=http://127.0.0.1:${address.port}/`);
});
