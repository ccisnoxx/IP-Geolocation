#!/usr/bin/env node
// VG-017 隔离机制实验：只有合成语言 getter，不装载生产 runtime、不改变正式 dist。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--output', '参数：--output <脱敏JSON>');
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept = Boolean) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(50); }
  throw new Error('VG-017 状态等待超时');
}
const samples = new Map();
const gates = new Set();
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function fixture(run, kind) {
  // 页面只上报实际值，合成预期仅在扩展/驱动中；每个子文档自己运行首脚本。
  return `<head><script>window.__vg017First=navigator.language;addEventListener('load',()=>window.__vg017Load=navigator.language);fetch('/sample',{method:'POST',body:JSON.stringify({run:${JSON.stringify(run)},kind:${JSON.stringify(kind)},language:navigator.language})});</script></head><body></body>`;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/sample' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { const v = JSON.parse(body); samples.set(`${v.run}:${v.kind}`, v.language); res.end('ok'); });
    return;
  }
  if (url.pathname === '/gate') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(gates.has(url.searchParams.get('run')))); return; }
  const run = url.searchParams.get('run');
  let html = fixture(run, url.pathname === '/child' ? 'iframe' : 'top');
  if (url.pathname === '/top') {
    const blank = JSON.stringify(fixture(run, 'blank')).replaceAll('</script>', '<\\/script>');
    html += `<iframe src="/child?run=${run}"></iframe><iframe srcdoc="${escapeHtml(fixture(run, 'srcdoc'))}"></iframe><script>const frame=document.createElement('iframe');document.body.appendChild(frame);frame.contentDocument.open();frame.contentDocument.write(${blank});frame.contentDocument.close();</script>`;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html);
});

const temp = await mkdtemp(join(tmpdir(), 'vg017-timing-'));
let child, socket;
const pending = new Map();
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = `http://localhost:${server.address().port}`;
  const extension = join(temp, 'extension'); await mkdir(extension);
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'VG017 isolated timing research', version: '1.0',
    permissions: ['scripting', 'tabs', 'storage'], host_permissions: ['http://localhost/*'], web_accessible_resources: [], background: { service_worker: 'worker.js' } }));
  await writeFile(join(extension, 'control.html'), '<title>VG017 controller</title>');
  await writeFile(join(extension, 'content.js'), "chrome.runtime.sendMessage({action:'init'}).catch(()=>{});");
  await writeFile(join(extension, 'main.js'), "Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=> 'qaa-QM'});");
  await writeFile(join(extension, 'worker.js'), `
let completed=0,pending=0,errors=0;
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(request.action==='status'){respond({completed,pending,errors});return;}
 if(request.action==='reset'){completed=0;pending=0;errors=0;respond(true);return;}
 if(request.action!=='init')return;
 pending++;
 (async()=>{
  const {fixture}=await chrome.storage.local.get('fixture');
  if(fixture.gated)while(!(await fetch(fixture.origin+'/gate?run='+fixture.run).then(r=>r.json())))await new Promise(r=>setTimeout(r,20));
  await chrome.scripting.executeScript({target:{tabId:sender.tab.id,documentIds:[sender.documentId]},world:'MAIN',injectImmediately:true,
   func:payload=>Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=>payload.language}),args:[{language:'qaa-QM'}]});
  completed++;respond(true);
 })().catch(()=>{errors++;respond(false);}).finally(()=>pending--);
 return true;
});
`);
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '需要 Chrome'); assert.equal(typeof WebSocket, 'function', '需要 Node22+');
  child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${join(temp, 'profile')}`,
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  let launchError = false; child.once('error', () => { launchError = true; });
  const port = await until(async () => { assert.equal(launchError, false, 'Chrome启动失败'); try { return (await readFile(join(temp, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } });
  const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let sequence = 0;
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-017 CDP超时：${method}`)); }, 20000);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error('VG-017 CDP调用失败')); else request.done(message.result);
  };
  const { id } = await send('Extensions.loadUnpacked', { path: extension });
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${id}/control.html` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    assert.ok(!r.exceptionDetails, 'VG-017 控制页表达式异常'); return r.result.value;
  };
  await until(() => evaluate('document.readyState'), v => v === 'complete');
  const cases = [];
  await send('ServiceWorker.enable', {}, sessionId);
  for (const mode of ['native', 'async-warm', 'async-cold', 'async-gated', 'direct-main']) {
    await evaluate('chrome.scripting.unregisterContentScripts()');
    await evaluate(`chrome.storage.local.set({fixture:${JSON.stringify({ origin, run: mode, gated: mode === 'async-gated' })}})`);
    await evaluate("chrome.runtime.sendMessage({action:'reset'})");
    if (mode !== 'native') await evaluate(`chrome.scripting.registerContentScripts([{id:'timing',matches:['http://localhost/*'],js:[${JSON.stringify(mode === 'direct-main' ? 'main.js' : 'content.js')}],runAt:'document_start',world:${JSON.stringify(mode === 'direct-main' ? 'MAIN' : 'ISOLATED')},allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:false}])`);
    if (mode === 'async-cold') {
      await send('ServiceWorker.stopAllWorkers', {}, sessionId);
      await until(async () => !(await send('Target.getTargets')).targetInfos.some(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`)));
    }
    const tab = await evaluate(`chrome.tabs.create({url:${JSON.stringify(origin + '/top?run=' + mode)}})`);
    await until(() => ['top', 'iframe', 'srcdoc', 'blank'].every(kind => samples.has(`${mode}:${kind}`)));
    gates.add(mode);
    await until(() => evaluate(`chrome.tabs.get(${tab.id}).then(t=>t.status)`), v => v === 'complete');
    if (mode.startsWith('async')) await until(() => evaluate("chrome.runtime.sendMessage({action:'status'})"), v => v.completed > 0 && v.pending === 0);
    const rows = await evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id},allFrames:true},world:'MAIN',func:()=>({first:window.__vg017First,load:window.__vg017Load,now:navigator.language})})`);
    const observations = ['top', 'iframe', 'srcdoc', 'blank'].map(kind => ({ kind, earliestSpoofed: samples.get(`${mode}:${kind}`) === 'qaa-QM' }));
    const statuses = rows.map(row => ({ top: row.frameId === 0, firstSpoofed: row.result.first === 'qaa-QM', loadSpoofed: row.result.load === 'qaa-QM', postLoadSpoofed: row.result.now === 'qaa-QM' }));
    const worker = await evaluate("chrome.runtime.sendMessage({action:'status'})");
    assert.equal(rows.length, 4, '应有四个当前文档'); assert.equal(worker.errors, 0, '异步派发失败');
    if (mode === 'native') assert.ok(observations.every(v => !v.earliestSpoofed) && statuses.every(v => !v.postLoadSpoofed));
    if (mode === 'async-gated') assert.ok(observations.every(v => !v.earliestSpoofed), '确定性异步窗口应保留原生首读');
    cases.push({ mode, registrationBeforeNavigation: true, workerStoppedBeforeNavigation: mode === 'async-cold', deterministicGate: mode === 'async-gated', observations, stages: statuses, worker: { completed: worker.completed, errors: worker.errors }, scope: mode === 'direct-main' ? '固定合成值的独立MAIN脚本，不具备生产动态payload' : '最小机制实验，非生产扩展' });
    await evaluate(`chrome.tabs.remove(${tab.id})`);
    console.log(`VG-017 ${mode}: earliest=${observations.filter(v => v.earliestSpoofed).length}/4; postLoad=${statuses.filter(v => v.postLoadSpoofed).length}/4`);
  }
  await writeFile(args[1], JSON.stringify({ task: 'VG-017', collection: 'COMPLETE', browser: version.Browser, platform: process.platform, arch: process.arch, node: process.version,
    productionChanged: false, productionRestored: false, fullTimingGuarantee: 'NOT_ESTABLISHED', cases,
    limitations: ['只有合成language getter，不是生产runtime或配置解析验收', 'direct MAIN改变调度架构且使用固定值，不能证明生产动态配置首脚本可用', '冷后台由真实stopAllWorkers及target消失确认；未测试整个浏览器冷启动', '固定本机fixture和有限文档种类，不证明所有CSP/跨origin/浏览器时序', '原生实际语言仅在本轮临时内存中比较，不写正式证据；不调用位置/provider/STUN'] }, null, 2) + '\n');
} finally {
  for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('研究结束')); }
  pending.clear(); socket?.close();
  if (child?.pid && child.exitCode === null) { const ended = new Promise(done => child.once('exit', done)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); }
  server.closeAllConnections(); await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
