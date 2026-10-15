#!/usr/bin/env node
// node --import tsx scripts/runtime-modularization/chrome-spike.mjs [--output <脱敏JSON>]
// 仅加载临时最小扩展与 localhost；不操作用户 profile，不连接 provider。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import { buildRuntimeSpike } from './build-spike.ts';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error('VG-011 Chrome 等待超时');
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`VG-011 CDP ${request.method} 失败`));
    else request.done(message.result);
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`VG-011 CDP ${method} 超时`)); }, 15000);
        pending.set(id, { done, fail, timer, method });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('VG-011 CDP 已关闭')); }
      pending.clear();
      socket.close();
    }
  };
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('参数：--output <JSON路径>');
if (typeof WebSocket !== 'function') throw new Error('VG-011 Chrome spike 需要 Node 22+');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('未找到 Chrome；可用 CHROME_BIN 指定，真实浏览器未验证');
const temporary = await mkdtemp(join(tmpdir(), 'vg011-chrome-'));
const server = createServer((request, response) => {
  if (!['/', '/child', '/favicon.ico'].includes(request.url)) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'none'; frame-src 'self'",
    'Cache-Control': 'no-store'
  });
  response.end(request.url === '/' ? '<!doctype html><title>VG-011</title><iframe src="/child"></iframe>' : '<!doctype html><title>VG-011 child</title>');
});
let child;
let cdp;
try {
  const extension = join(temporary, 'extension');
  const generated = await buildRuntimeSpike(join(temporary, 'generated'));
  await mkdir(extension);
  const entry = join(temporary, 'probe-entry.js');
  await writeFile(entry, `import { applyRuntimeSpike } from ${JSON.stringify(generated)};
    export function observe(tabId, world) {
      return chrome.scripting.executeScript({target:{tabId,allFrames:true},world,func:()=>navigator.language});
    }
    export function inject(tabId, documentId, language) {
      return chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',injectImmediately:true,
        func:applyRuntimeSpike,args:[{language},documentId]});
    }
    export function control(tabId, documentId) {
      return chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',
        func:()=>location.pathname});
    }`);
  // 使用最终扩展 bundle 中的函数，由真实 scripting API 序列化；CDP 不执行补丁源码。
  await build({configFile:false,publicDir:false,logLevel:'silent',build:{outDir:extension,emptyOutDir:false,
    target:'es2020',minify:false,sourcemap:true,rollupOptions:{input:entry,preserveEntrySignatures:'strict',output:{format:'es',entryFileNames:'probe.js'}}}});
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({manifest_version:3,name:'VG-011 isolated spike',version:'1.0',
    minimum_chrome_version:'119',permissions:['scripting','tabs'],host_permissions:['http://localhost/*'],web_accessible_resources:[]}));
  await writeFile(join(extension, 'probe.html'), '<!doctype html><title>VG-011 extension probe</title>');
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
  const origin = `http://localhost:${server.address().port}`;
  const profile = join(temporary, 'profile');
  child = spawn(chrome, ['--headless=new','--enable-unsafe-extension-debugging','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
  let launchError = false;
  child.once('error', () => { launchError = true; });
  const port = await until(async () => {
    if (launchError) throw new Error('VG-011 Chrome 无法启动');
    try { return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; } catch { return null; }
  }, Boolean);
  const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
  cdp = await connect(version.webSocketDebuggerUrl);
  const {id:extensionId} = await cdp.send('Extensions.loadUnpacked', {path:extension});
  const createPage = async (url) => {
    const {targetId} = await cdp.send('Target.createTarget', {url});
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId,flatten:true});
    return {sessionId};
  };
  const evaluate = async (page, expression) => {
    const response = await cdp.send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}, page.sessionId);
    if (response.exceptionDetails) throw new Error('VG-011 扩展探针执行异常');
    return response.result.value;
  };
  const probe = await createPage(`chrome-extension://${extensionId}/probe.html`);
  const target = await createPage(origin);
  await until(() => evaluate(target,'document.readyState'), (v) => v === 'complete');
  const tabId = await evaluate(probe, `chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(`${origin}/`)}).id)`);
  const call = (method, values) => evaluate(probe, `import(chrome.runtime.getURL('probe.js')).then(m=>m.${method}(...${JSON.stringify(values)}))`);
  const baseline = await until(() => call('observe',[tabId,'ISOLATED']), (v) => v.length === 2);
  const top = baseline.find((v) => v.frameId === 0);
  const frame = baseline.find((v) => v.frameId !== 0);
  assert.ok(top.documentId && frame.documentId);
  const language = top.result === 'fr-FR' ? 'ja-JP' : 'fr-FR';
  const injectedFrame = await call('inject',[tabId,frame.documentId,language]);
  assert.equal(injectedFrame.length,1);
  assert.equal(injectedFrame[0].documentId,frame.documentId);
  const afterFrame = await call('observe',[tabId,'MAIN']);
  assert.equal(afterFrame.find((v)=>v.frameId===0).result,top.result);
  assert.equal(afterFrame.find((v)=>v.frameId===frame.frameId).result,language);
  const injectedTop = await call('inject',[tabId,top.documentId,language]);
  assert.equal(injectedTop[0].documentId,top.documentId);
  const main = await call('observe',[tabId,'MAIN']);
  assert.ok(main.every((v)=>v.result===language));
  const isolated = await call('observe',[tabId,'ISOLATED']);
  assert.deepEqual(isolated.map(v=>[v.documentId,v.result]).sort(),baseline.map(v=>[v.documentId,v.result]).sort());
  await cdp.send('Page.enable',{},target.sessionId);
  const navigation = await cdp.send('Page.navigate',{url:`${origin}/child`},target.sessionId);
  await until(async () => {
    const tree = await cdp.send('Page.getFrameTree',{},target.sessionId);
    return tree.frameTree.frame.loaderId===navigation.loaderId && !tree.frameTree.childFrames?.length
      && await evaluate(target,"location.pathname==='/child' && document.readyState==='complete'");
  }, Boolean);
  const beforeStale = await call('observe',[tabId,'MAIN']);
  assert.notEqual(beforeStale[0].documentId,top.documentId);
  assert.equal(beforeStale[0].result,top.result,'新文档必须先恢复原生值');
  const control = await evaluate(probe, `import(chrome.runtime.getURL('probe.js')).then(m=>m.control(${tabId},${JSON.stringify(top.documentId)})).then(r=>({rejected:false,resultCount:r.length,returnedReplacement:r.some(v=>v.documentId===${JSON.stringify(beforeStale[0].documentId)}),observedReplacementPath:r.some(v=>v.result==='/child')}),()=>({rejected:true,resultCount:0,returnedReplacement:false,observedReplacementPath:false}))`);
  const stale = await evaluate(probe, `import(chrome.runtime.getURL('probe.js')).then(m=>m.inject(${tabId},${JSON.stringify(top.documentId)},${JSON.stringify(language)})).then(r=>({rejected:false,resultCount:r.length,returnedOldDocument:r.some(v=>v.documentId===${JSON.stringify(top.documentId)})}),()=>({rejected:true,resultCount:0,returnedOldDocument:false}))`);
  const replacement = await call('observe',[tabId,'MAIN']);
  const staleSafe = replacement[0].result===top.result;
  const result = staleSafe ? 'PASS' : 'FAIL';
  const record = {task:'VG-011',browser:version.Browser,result,coreMechanism:'PASS',mode:'real Chrome headless / isolated temporary extension',
    surface:'navigator.language',syntheticLanguage:language,csp:"default-src 'none'; script-src 'none'; frame-src 'self'",
    checks:{finalBundleFunction:true,mainWorld:true,topDocument:true,iframeDocument:true,iframeDoesNotPatchTop:true,
      isolatedUnchanged:true,staleDocumentDoesNotPatchReplacement:staleSafe,webAccessibleResourcesEmpty:true},
    staleDocumentInjection:stale,handwrittenControl:control,
    limitations:['最小测试扩展，不是生产 runtime 全量等价或人工验收','未验证 Chrome119、worker 或首 inline 时序','不验证生产 sender 授权路径；既有定向 mocks 提供该层证据']};
  if (args[1]) await writeFile(args[1],`${JSON.stringify(record,null,2)}\n`);
  console.log(`VG-011 ${version.Browser}: core=PASS；旧 documentId 安全检查=${result}；手写对照执行到替换文档=${control.returnedReplacement}。`);
  process.exitCode = result === 'PASS' ? 0 : 1;
} finally {
  cdp?.close();
  await new Promise((done) => server.close(done));
  if (child?.pid && child.exitCode === null) {
    const exited = new Promise((done) => child.once('exit',done));
    child.kill('SIGTERM');
    const force = setTimeout(()=>child.kill('SIGKILL'),5000);
    await exited;
    clearTimeout(force);
  }
  await rm(temporary,{recursive:true,force:true});
}
