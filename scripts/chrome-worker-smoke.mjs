#!/usr/bin/env node
// 使用独立临时 Chrome profile 验证 worker 身份与 URL 生命周期；无依赖，不操作用户日常 profile。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLeakTestServer } from './serve-leak-test.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
let smokePhase = 'startup';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error(`Chrome smoke 等待目标状态超时：${smokePhase}`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  const errors = [];
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.fail(new Error(`Chrome 协议 ${request.method} 失败：${message.error.message}`));
      else request.done(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.sessionId);
  };
  return {
    errors,
    send(method, params = {}, sessionId) {
      return new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Chrome 协议 ${method} 超时`)); }, 20000);
        pending.set(id, { done, fail, timer, method });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() { for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('Chrome smoke 已关闭')); } pending.clear(); socket.close(); }
  };
}

async function main() {
  if (typeof WebSocket !== 'function') throw new Error('此 smoke 需要 Node 22+ 原生 WebSocket');
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) throw new Error('未找到真实 Chrome，可用 CHROME_BIN 指定');
  for (const file of ['manifest.json', 'diagnostic/report.html', 'fixtures/workers/top.html', 'fixtures/workers/shared-worker-module.js', 'fixtures/workers/module-observation.js']) {
    if (!existsSync(join(dist, file))) throw new Error(`缺少构建入口 ${file}，请先 npm run build`);
  }
  const profile = await mkdtemp(join(tmpdir(), 'vanishgeo-worker-smoke-'));
  const server = createLeakTestServer({ projectRoot: root });
  let cleanupObservation;
  const handler = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (request, response) => {
    if (request.url === '/worker-smoke-cleanup') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { cleanupObservation = JSON.parse(body); response.writeHead(204); response.end(); });
    } else if (request.url === '/worker-smoke-csp.html') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "worker-src 'self'" });
      response.end('<!doctype html><title>Worker CSP smoke</title>');
    } else handler(request, response);
  });
  let child;
  let cdp;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
    const origin = `http://localhost:${server.address().port}`;
    child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    const port = await until(async () => { try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, Boolean, 15000);
    const protocol = await (await fetch(`http://localhost:${port}/json/protocol`)).json();
    if (!protocol.domains.find(domain => domain.domain === 'Extensions')?.commands.some(command => command.name === 'loadUnpacked')) throw new Error('当前 Chrome 不支持 Extensions.loadUnpacked');
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    cdp = await connect(version.webSocketDebuggerUrl);
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: dist });
    const page = async (url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      return { sessionId };
    };
    const evaluate = async (target, expression) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target.sessionId);
      if (value.exceptionDetails) throw new Error(`Chrome 页面执行异常：${smokePhase}`);
      return value.result.value;
    };
    const report = await page(`chrome-extension://${id}/diagnostic/report.html`);
    await until(() => evaluate(report, 'document.readyState'), value => value === 'complete');
    // 仅临时 profile 的合成语言/时区配置，不请求出口 provider/位置/ICE。
    const config = { masterEnabled: true, rules: [{ id: 'worker-smoke', domain: 'localhost', enabled: true }], globalProfile: {
      language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: { enabled: false, mode: 'manual', latitude: 12, longitude: 23, accuracy: 50 }
    }, webRtc: { globalMode: 'default' } };
    const configured = await evaluate(report, `chrome.runtime.sendMessage({action:'setSiteConfig',config:${JSON.stringify(config)}}).then(r=>({status:r.status,message:r.message}))`);
    assert.equal(configured.status, 'ok', configured.message);
    const target = await page('about:blank');
    // 测试仪表只在临时 profile 的目标页，生产 runtime 不新增 marker/消息桥。
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => {
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        const state = { created: [], revoked: [], Worker, SharedWorker };
        window.__workerSmoke = state;
        URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
        URL.revokeObjectURL = url => { state.revoked.push(url); return revoke(url); };
      })();
    ` }, target.sessionId);
    await cdp.send('Page.navigate', { url: `${origin}/fixtures/workers/top.html` }, target.sessionId);
    smokePhase = 'fixture';
    await until(() => evaluate(target, 'navigator.language'), value => value === 'ja-JP');
    await until(() => evaluate(target, 'typeof runWorkerDiagnostics'), value => value === 'function');
    const result = await evaluate(target, 'runWorkerDiagnostics()');
    for (const key of ['classicWorker', 'moduleWorker', 'sharedWorker', 'sharedIdentity', 'moduleSharedIdentity', 'delayedSharedIdentity', 'nestedWorker']) {
      assert.equal(result[key].status, 'ok', JSON.stringify({key,...result[key]}));
      assert.equal(result[key].result.language, 'ja-JP', key);
      assert.equal(result[key].result.timezone, 'Asia/Tokyo', key);
    }
    for (const key of ['sharedIdentity', 'moduleSharedIdentity', 'delayedSharedIdentity']) {
      assert.deepEqual(result[key].identity, { sameScope: true, counts: [1, 2], differentName: true });
    }
    for (const key of ['moduleWorker', 'moduleSharedIdentity', 'delayedSharedIdentity']) {
      assert.deepEqual(result[key].result.moduleObservation, { language: 'ja-JP', timezone: 'Asia/Tokyo' });
    }
    const reflection = await evaluate(target, `['Worker','SharedWorker'].every(key => {
      const native = __workerSmoke[key], wrapper = window[key];
      class Derived extends wrapper {}
      const instance = new Derived('/fixtures/workers/worker-classic.js');
      if (instance.port) instance.port.close(); else instance.terminate();
      return instance instanceof Derived && wrapper.prototype === native.prototype && wrapper.name === native.name
        && wrapper.length === native.length && wrapper.toString() === native.toString();
    })`);
    assert.equal(reflection, true);
    const noNew = await evaluate(target, `['Worker','SharedWorker'].every(key => { try { window[key]('/fixtures/workers/worker-classic.js'); return false; } catch (error) { return error.name === 'TypeError'; } })`);
    assert.equal(noNew, true);
    const invalidOptions = await evaluate(target, `['Worker','SharedWorker'].every(key => {
      let laterReads=0;
      try { new window[key]('/fixtures/workers/shared-worker.js', {credentials:'invalid',get name(){laterReads++;return 'invalid';},get type(){laterReads++;return 'classic';}}); return false; }
      catch(error) { return error.name==='TypeError' && laterReads===0; }
    })`);
    assert.equal(invalidOptions, true);
    smokePhase = 'cross-origin';
    const fallback = await evaluate(target, `(() => {
      const url = ${JSON.stringify(origin.replace('localhost', '127.0.0.1') + '/fixtures/workers/worker-classic.js')};
      const before = __workerSmoke.created.length;
      const errors = ['Worker','SharedWorker'].map(key => {
        function attempt(ctor) { try { const value = new ctor(url); if (value.port) value.port.close(); else value.terminate(); return 'constructed'; } catch(error) { return error.name; } }
        return attempt(window[key]) === attempt(__workerSmoke[key]);
      });
      return errors.every(Boolean) && before === __workerSmoke.created.length;
    })()`);
    assert.equal(fallback, true);
    smokePhase = 'async-error';
    const failure = await evaluate(target, `new Promise(resolve => {
      const worker = new Worker('/fixtures/workers/missing-script.js');
      const timer = setTimeout(() => { worker.terminate(); resolve(false); }, 5000);
      worker.onerror = event => { event.preventDefault(); clearTimeout(timer); worker.terminate(); resolve(true); };
    })`);
    assert.equal(failure, true);
    const lifetime = await evaluate(target, `({created:__workerSmoke.created.length,revoked:__workerSmoke.revoked.length,unique:new Set(__workerSmoke.revoked).size})`);
    assert.ok(lifetime.revoked > 0 && lifetime.revoked < lifetime.created);
    assert.equal(lifetime.revoked, lifetime.unique);
    await evaluate(target, `addEventListener('pagehide', () => navigator.sendBeacon('/worker-smoke-cleanup',JSON.stringify({
      created:__workerSmoke.created.length,revoked:__workerSmoke.revoked.length,unique:new Set(__workerSmoke.revoked).size
    }))); true`);
    smokePhase = 'pagehide';
    await cdp.send('Page.navigate', { url: 'about:blank' }, target.sessionId);
    const counts = await until(() => cleanupObservation, Boolean);
    assert.ok(counts.created > 0);
    assert.equal(counts.created, counts.revoked);
    assert.equal(counts.revoked, counts.unique);
    smokePhase = 'csp';
    await cdp.send('Page.navigate', { url: `${origin}/worker-smoke-csp.html` }, target.sessionId);
    await until(() => evaluate(target, 'navigator.language'), value => value === 'ja-JP');
    const csp = await evaluate(target, `Promise.all(['Worker','SharedWorker'].map(key => new Promise(resolve => {
      let worker;
      const finish = value => { clearTimeout(timer); if (worker) { if(worker.port) worker.port.close(); else worker.terminate(); } resolve(value); };
      const timer = setTimeout(() => finish('timeout'),5000);
      try {
        worker = new window[key]('/fixtures/workers/' + (key === 'Worker' ? 'worker-classic.js' : 'shared-worker.js'));
        worker.onerror = event => { event.preventDefault(); finish('error'); };
        if(worker.port) worker.port.onmessage = () => finish('loaded'); else worker.onmessage = () => finish('loaded');
      } catch(error) { finish(error.name); }
    })))`);
    assert.ok(csp.every(value => value === 'error'), 'CSP Blob 异步拒绝仍产生原生 error，不改变脚本网络路径');
    console.log(JSON.stringify({ browser: version.Browser, fixture: 'passed', sharedIdentity: 'classic/module passed', moduleDependencyPatch: 'passed', captureAndMicrotaskOrder: 'passed', dedicatedAndNestedLoadAfterRevoke: 'passed', nativeReflectionAndCrossOrigin: 'passed', asyncErrorAndCsp: 'passed', pagehide: 'all URLs revoked once', runtimeExceptions: cdp.errors.length }));
    assert.equal(cdp.errors.length, 0);
  } finally {
    cdp?.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(done => { const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(timer); done(); }); });
    }
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    await rm(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
