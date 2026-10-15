#!/usr/bin/env node
// 使用独立临时 Chrome profile 验证扩展报告；无依赖，不操作用户日常 profile。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  if (typeof WebSocket !== 'function') throw new Error('此 smoke 需要 Node 22+ 的原生 WebSocket；无须安装生产依赖');
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) throw new Error('未找到真实 Chrome，可用 CHROME_BIN 指定');
  for (const path of ['manifest.json', 'diagnostic/report.html', 'diagnostic/report.js', 'diagnostic/report.css']) if (!existsSync(join(dist, path))) throw new Error(`缺少构建入口 ${path}，请先 npm run build`);
  const profile = await mkdtemp(join(tmpdir(), 'vanishgeo-diagnostic-smoke-'));
  const server = createLeakTestServer({ projectRoot: root });
  const requests = [];
  server.on('request', (req) => requests.push({ url: req.url, referer: req.headers.referer || '' }));
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
  const origin = `http://localhost:${server.address().port}`;
  const child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let cdp;
  try {
    const port = await until(async () => { try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, Boolean, 15000);
    const protocol = await (await fetch(`http://localhost:${port}/json/protocol`)).json();
    if (!protocol.domains.find((domain) => domain.domain === 'Extensions')?.commands.some((command) => command.name === 'loadUnpacked')) throw new Error('当前 Chrome 不支持 Extensions.loadUnpacked；无法自动加载扩展');
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    cdp = await connect(version.webSocketDebuggerUrl);
    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: dist });
    const createPage = async (url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      return { targetId, sessionId };
    };
    const report = await createPage(`chrome-extension://${extensionId}/diagnostic/report.html`);
    const evaluate = async (page, expression) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
      if (value.exceptionDetails) throw new Error('Chrome smoke 页面执行异常');
      return value.result.value;
    };
    await until(() => evaluate(report, 'document.readyState'), (value) => value === 'complete');
    assert.equal(await evaluate(report, 'document.title'), 'VanishGeo 扩展诊断报告');
    assert.ok(await evaluate(report, 'document.querySelector("#run") && document.body.textContent.includes("预期配置")'));
    // 合成配置仅写临时扩展 profile；不检测真实出口档案。
    const configure = async (allowlisted) => {
      const config = { masterEnabled: true, debugMode: false, rules: allowlisted ? [{ id: 'diagnostic-smoke', domain: 'localhost', enabled: true }] : [], globalProfile: {
        language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
        timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
        geolocation: { enabled: true, mode: 'manual', latitude: 12.345678, longitude: 23.456789, accuracy: 50, randomize: false, spoofPermission: true }
      }, webRtc: { globalMode: 'strict' } };
      const response = await evaluate(report, `chrome.runtime.sendMessage({action:'setSiteConfig',config:${JSON.stringify(config)}}).then(r=>({status:r.status,message:r.message}))`);
      assert.equal(response.status, 'ok', response.message);
    };
    smokePhase = 'allowlist';
    await configure(false);
    const target = await createPage(`${origin}/leak-test/leak-test.html?ui=zh`);
    await until(() => evaluate(target, 'document.readyState'), (value) => value === 'complete');
    const tabId = await evaluate(report, `chrome.tabs.query({}).then(t=>t.find(v=>v.url===${JSON.stringify(`${origin}/leak-test/leak-test.html?ui=zh`)}).id)`);
    const refresh = async () => {
      await evaluate(report, 'document.querySelector("#refresh").click()');
      await until(() => evaluate(report, 'document.querySelector("#target").options.length'), (n) => n > 0);
      await evaluate(report, `document.querySelector('#target').value='${tabId}'`);
    };
    await refresh();
    await evaluate(report, 'document.querySelector("#run").click()');
    await until(() => evaluate(report, 'document.querySelector("#status").textContent'), (value) => value.includes('未启用 allowlist'));
    smokePhase = 'initial-report';
    await configure(true);
    await until(() => evaluate(target, 'document.readyState'), (value) => value === 'complete');
    await until(() => evaluate(target, 'navigator.language'), (value) => value === 'ja-JP');
    await refresh();
    await evaluate(report, 'document.querySelector("#run").click()');
    await until(() => evaluate(report, 'document.querySelector("#status").textContent'), (value) => value.includes('诊断完成'));
    const rows = await evaluate(report, '[...document.querySelectorAll(".row")].map(r=>({label:r.querySelector("strong").textContent,verdict:r.querySelector(".badge").textContent}))');
    for (const label of ['Top language', 'Top languages', 'Top locale', 'Top timezone', 'Top Date offset', 'Top Date locale', 'Accept-Language', 'getCurrentPosition', 'watchPosition', 'WebRTC policy', 'Worker classic language', 'Worker module language', 'Worker shared language']) assert.equal(rows.find((row) => row.label === label)?.verdict, 'PASS', label);
    assert.ok(rows.some((row) => row.label.startsWith('iframe ') && row.label.endsWith(' language') && row.verdict === 'PASS'));
    assert.equal(rows.find((row) => row.label === 'WebRTC ICE')?.verdict, 'UNKNOWN');
    assert.ok(rows.some((row) => row.label.startsWith('Pass-through ') && row.verdict === 'PASS'));
    if (process.env.VANISHGEO_SMOKE_SCREENSHOT) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, report.sessionId);
      await writeFile(process.env.VANISHGEO_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
    assert.equal(await evaluate(target, 'document.querySelectorAll("iframe[id^=vanishgeo-diagnostic]").length'), 0);
    assert.equal(await evaluate(target, 'document.body.textContent.includes("12.345678") || document.body.textContent.includes("23.456789")'), false);
    assert.equal(await evaluate(target, 'location.search'), '?ui=zh');
    assert.ok(requests.some((request) => request.url === '/headers.json'));
    assert.equal(requests.some((request) => /12\.345678|23\.456789|expected|latitude|longitude/.test(request.url + request.referer)), false);
    await evaluate(report, 'document.querySelector("#cancel").click()');
    assert.equal(await evaluate(report, 'document.querySelectorAll(".row").length'), 0);
    smokePhase = 'api-navigation';
    // 真实文档导航：prepare 后重载同一 URL，旧 documentId 必须失效。
    const run = await evaluate(report, `chrome.runtime.sendMessage({action:'prepareDiagnosticRun',tabId:${tabId}}).then(r=>r.run)`);
    await cdp.send('Page.reload', {}, target.sessionId);
    await until(() => evaluate(target, 'document.readyState'), (value) => value === 'complete');
    const navigation = await evaluate(report, `chrome.runtime.sendMessage({action:'executeDiagnosticRun',runId:${JSON.stringify(run.runId)}}).then(r=>({status:r.status,code:r.code}))`);
    assert.equal(navigation.status, 'error');
    assert.equal(navigation.code, 'navigated');
    smokePhase = 'cancel';
    // 实际取消路径和一次消费，防止晚到结果重现。
    await refresh();
    await evaluate(report, 'document.querySelector("#run").click()');
    await until(() => evaluate(report, 'document.querySelector("#cancel").disabled'), (value) => value === false);
    await evaluate(report, 'document.querySelector("#cancel").click()');
    await sleep(6000);
    assert.equal(await evaluate(report, 'document.querySelectorAll(".row").length'), 0);
    assert.equal(await evaluate(report, 'document.querySelector("#run").disabled'), false);
    await evaluate(report, 'document.querySelector("#run").click()');
    await until(() => evaluate(report, 'document.querySelector("#cancel").disabled'), (value) => value === false);
    smokePhase = 'ui-navigation';
    await cdp.send('Page.reload', {}, target.sessionId);
    await until(() => evaluate(report, 'document.querySelector("#status").textContent'), (value) => value.includes('已导航'));
    assert.equal(await evaluate(report, 'document.querySelectorAll(".row").length'), 0);
    smokePhase = 'background-expiry';
    // 真实定时 TTL：后台准备中的 run 通过虚拟时钟推进；UI 定时清理另外检验。
    const { targetInfos } = await cdp.send('Target.getTargets');
    const serviceWorker = targetInfos.find((info) => info.type === 'service_worker' && info.url.startsWith(`chrome-extension://${extensionId}/`));
    assert.ok(serviceWorker, '扩展 service worker');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: serviceWorker.targetId, flatten: true });
    const worker = { sessionId };
    const expiring = await evaluate(report, `chrome.runtime.sendMessage({action:'prepareDiagnosticRun',tabId:${tabId}}).then(r=>r.run)`);
    try {
      await evaluate(worker, 'globalThis.__smokeOriginalNow=Date.now;Date.now=()=>globalThis.__smokeOriginalNow()+120001;true');
      const expired = await evaluate(report, `chrome.runtime.sendMessage({action:'executeDiagnosticRun',runId:${JSON.stringify(expiring.runId)}}).then(r=>({status:r.status,code:r.code}))`);
      assert.equal(expired.code, 'expired');
    } finally { await evaluate(worker, 'Date.now=globalThis.__smokeOriginalNow;delete globalThis.__smokeOriginalNow;true'); }
    await until(() => evaluate(target, 'document.readyState'), (value) => value === 'complete');
    await refresh();
    await evaluate(report, 'document.querySelector("#run").click()');
    await until(() => evaluate(report, 'document.querySelector("#status").textContent'), (value) => value.includes('诊断完成'));
    smokePhase = 'report-virtual-expiry';
    // 激活临时报告 tab，等待实际生产 TTL；不以虚拟时间替代浏览器计时。
    assert.ok(protocol.domains.find((domain) => domain.domain === 'Target')?.commands.some((command) => command.name === 'activateTarget'));
    await cdp.send('Target.activateTarget', { targetId: report.targetId });
    console.log('Chrome 报告 TTL：等待实际两分钟定时器；其他诊断场景已通过。');
    await sleep(120100);
    await until(() => evaluate(report, 'document.querySelector("#status").textContent'), (value) => value.includes('诊断已过期'));
    assert.equal(await evaluate(report, 'document.querySelectorAll(".row").length'), 0);
    assert.equal(cdp.errors.filter((session) => session === report.sessionId).length, 0, '报告页 Runtime exceptions');
    console.log(JSON.stringify({ browser: version.Browser, mode: 'real Chrome headless, temporary profile', result: 'PASS', rows: rows.reduce((counts, row) => ({ ...counts, [row.verdict]: (counts[row.verdict] || 0) + 1 }), {}), verified: ['report UI', 'allowlist rejection', 'MAIN signals', 'ordinary-origin header echo', 'policy and ICE separation', 'iframe', 'classic/module/shared workers', 'pass-through', 'target URL/DOM/request privacy', 'navigation (API and UI)', 'cancel and late result', 'expiry (background clock advanced, actual report timer)'], reportRuntimeErrors: 0 }, null, 2));
  } finally {
    cdp?.close();
    await new Promise((done) => server.close(done));
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(force);
    }
    await rm(profile, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
