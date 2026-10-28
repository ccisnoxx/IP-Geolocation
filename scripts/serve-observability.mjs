#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const fixture = new URL('../fixtures/observability/', import.meta.url);
const fontSource = await readFile(new URL('../src/shared/font-families.ts', import.meta.url), 'utf8');
const families = Array.from(fontSource.matchAll(/^  '([^']+)'/gm), match => match[1]);
const probe = await readFile(new URL('probe.js', fixture), 'utf8');
// 同一无闭包探针供 classic Worker 使用，不动态编译、不使用 eval。
const classic = probe.slice(probe.indexOf('export function captureSurface'), probe.indexOf('export async function capturePage')).replace('export ', '');
export function createObservabilityServer() {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Permissions-Policy', `geolocation=(self "http://localhost:${response.socket.localPort}" "http://127.0.0.1:${response.socket.localPort}")`);
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/headers.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ acceptLanguage: request.headers['accept-language'] || null })); return; }
    if (path === '/font-list.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(families)); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    if (path === '/live.html') response.end('<!doctype html><meta charset="utf-8"><title>Live contract</title><script>document.documentElement.dataset.first=JSON.stringify({language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});</script>');
    else if (path === '/entry-csp.js') {
      response.setHeader('Content-Security-Policy', "connect-src 'none'");
      response.end(`fetch(new URL('/headers.json',self.location.origin).href).then(()=>postMessage({connectionAllowed:true}),()=>postMessage({connectionAllowed:false}));`);
    }
    else if (path === '/shared-counter.js') response.end('let count=0;onconnect=event=>{const port=event.ports[0];port.postMessage({count:++count,language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});port.onmessage=()=>port.postMessage({count,language:navigator.language});};');
    else if (path === '/worker-helper.js') response.end('export const relativeImport=true;');
    else if (path === '/worker-contract-module.js') response.end(`import {relativeImport} from './worker-helper.js';await Promise.resolve();let relativeURL;try{relativeURL=new URL('asset.json',location.href).protocol}catch(error){relativeURL=error.name}postMessage({relativeImport,relativeURL,entryIsBlob:location.protocol==='blob:',businessIsHttp:import.meta.url.startsWith('http:'),language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});`);
    else if (path === '/worker-classic.js') response.end(`${classic}\npostMessage(captureSurface());`);
    else if (path === '/worker.js') response.end(request.url.includes('module')
      ? "import { captureSurface } from '/probe.js'; postMessage(captureSurface());"
      : `importScripts('/worker-classic.js');`);
    else if (path === '/shared.js') response.end("import { captureSurface } from '/probe.js'; onconnect = event => { event.ports[0].postMessage(captureSurface()); };");
    else if (['/probe.js', '/page.js'].includes(path)) response.end(await readFile(new URL(path.slice(1), fixture)));
    else if (path === '/') response.end('<!doctype html><meta charset="utf-8"><title>Browser surface audit</title><script type="module" src="/page.js"></script><h1>Browser surface audit</h1><p>仅本机观测；无 STUN/TURN、无扩展配置桥。结果由维护者与原生对照比较。</p><pre id="result">采样中</pre>');
    else { response.statusCode = 404; response.end('Not found'); }
  });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = createObservabilityServer();
  server.listen(Number(process.env.PORT || 8790), '127.0.0.1', () => console.log(`Browser surface audit: http://localhost:${server.address().port}/`));
}
