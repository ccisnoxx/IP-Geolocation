#!/usr/bin/env node
// Node 22+ 原生 CDP，独立临时 profile；只采集本地时序 fixture，不操作用户 profile。
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, accept, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(100);
  }
  throw new Error(`Chrome smoke 等待目标状态超时：VG-009`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  const errors = [];
  const loadedDocuments = new Set();
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
    else if (message.method === 'Page.lifecycleEvent' && message.params.name === 'load') loadedDocuments.add(`${message.sessionId}:${message.params.loaderId}`);
  };
  return {
    errors,
    loadedDocuments,
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


export async function runInjectionAcceptance({ runs = 3, output = null } = {}) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('VG-009 runs 必须为1到20的整数');
  if (typeof WebSocket !== 'function') throw new Error('VG-009 自动验收需要 Node 22+ 原生 WebSocket');
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) throw new Error('未找到 Chrome，请通过 CHROME_BIN 指定；真实浏览器未验证');
  for (const file of ['manifest.json', 'diagnostic/report.js', 'fixtures/injection/earliest-inline.html', 'fixtures/injection/child.html']) {
    if (!existsSync(join(dist, file))) throw new Error('VG-009 缺少构建入口，请先 npm run build');
  }
  const profile = await mkdtemp(join(tmpdir(), 'vanishgeo-injection-'));
  const server = createLeakTestServer({ projectRoot: root });
  const requests = [];
  server.on('request', (request) => requests.push(request.url));
  let child;
  let cdp;
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, 'localhost', done); });
    const origin = `http://localhost:${server.address().port}`;
    child = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    let launchError = false;
    child.once('error', () => { launchError = true; });
    const port = await until(async () => {
      if (launchError) throw new Error('Chrome 进程无法启动');
      try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; }
    }, Boolean, 15000);
    const protocol = await (await fetch(`http://localhost:${port}/json/protocol`)).json();
    if (!protocol.domains.find((d) => d.domain === 'Extensions')?.commands.some((c) => c.name === 'loadUnpacked')) throw new Error('Chrome 缺少 Extensions.loadUnpacked，自动验收未执行');
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    cdp = await connect(version.webSocketDebuggerUrl);
    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: dist });
    const createPage = async (url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
      return { targetId, sessionId };
    };
    const evaluate = async (page, expression) => {
      const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId);
      if (response.exceptionDetails) throw new Error('VG-009 页面执行异常');
      return response.result.value;
    };
    const report = await createPage(`chrome-extension://${extensionId}/diagnostic/report.html`);
    await until(() => evaluate(report, 'document.readyState'), (v) => v === 'complete');
    const send = async (request) => {
      const response = await evaluate(report, `chrome.runtime.sendMessage(${JSON.stringify(request)})`);
      assert.equal(response.status, 'ok', 'VG-009 后台动作失败');
      return response;
    };
    // 禁止默认规则影响对照；配置仅在临时扩展内部提交，无真实出口检测。
    const config = { masterEnabled: true, rules: [], globalProfile: {
      language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: { enabled: false, mode: 'manual', latitude: 0, longitude: 0, accuracy: 50 }
    }, webRtc: { globalMode: 'default' } };
    await send({ action: 'setSiteConfig', config });
    const target = await createPage('about:blank');
    const fixtureUrl = `${origin}/fixtures/injection/earliest-inline.html`;
    const readFixture = `(() => {
      const frames = [window, ...Array.from(document.querySelectorAll('iframe'), f => f.contentWindow)];
      return frames.map(w => { const text=w.document.getElementById('injection-observations')?.textContent; return text ? JSON.parse(text) : null; });
    })()`;
    const navigate = async () => {
      const navigation = await cdp.send('Page.navigate', { url: fixtureUrl }, target.sessionId);
      assert.ok(!navigation.errorText && navigation.loaderId, 'VG-009 导航必须创建新文档');
      // 事件在导航前启用并缓存，快速 load 也不会丢；不把旧文档 JSON 当作新证据。
      await until(() => cdp.loadedDocuments.has(`${target.sessionId}:${navigation.loaderId}`), Boolean);
      // 等待 fixture 的 load 输出，仅用于取回已同步捕获的 earliest；不重采或替换 earliest。
      return until(() => evaluate(target, readFixture), (values) => values.length === 4 && values.every(Boolean));
    };
    const baseline = await navigate();
    const native = baseline[0].earliest;
    if (native.language === config.globalProfile.language.language) {
      config.globalProfile.language = { enabled: true, mode: 'custom', language: 'fr-FR', languages: ['fr-FR', 'fr'], acceptLanguage: 'fr-FR,fr;q=0.9' };
    }
    if (native.timezone === config.globalProfile.timezone.timezone) config.globalProfile.timezone.timezone = 'Asia/Kathmandu';
    config.rules = [{ id: 'injection-fixture', domain: 'localhost', enabled: true }];
    await send({ action: 'setSiteConfig', config });
    const tabId = await evaluate(report, `chrome.tabs.query({}).then(t => t.find(v => v.url === ${JSON.stringify(fixtureUrl)}).id)`);
    const attempts = [];
    const fields = ['language', 'languages', 'locale', 'timezone', 'offsetMinutes'];
    const valuesOf = (snapshot) => Object.fromEntries(fields.map((key) => [key, snapshot[key]]));
    for (let index = 0; index < runs; index++) {
      await navigate();
      // 用真实扩展报告的同一次 run 采样、比较并渲染；不拼接两次执行。
      await evaluate(report, `document.querySelector('#refresh').click()`);
      await until(() => evaluate(report, `Array.from(document.querySelector('#target').options).some(o=>o.value==='${tabId}')`), Boolean);
      await evaluate(report, `document.querySelector('#target').value='${tabId}'`);
      const result = await evaluate(report, `import(chrome.runtime.getURL('diagnostic/report.js')).then(m=>m.run(true))`);
      assert.ok(result?.evidence?.timing && Array.isArray(result.rows), 'VG-009 取消/过期/失效结果不能作为证据');
      const { evidence } = result;
      const rows = result.rows.map(({ label, verdict }) => ({ label, verdict }));
      const rendered = await evaluate(report, `Array.from(document.querySelectorAll('.row'), r=>({label:r.querySelector('strong').textContent,verdict:r.querySelector('.badge').textContent}))`);
      assert.deepEqual(rendered, rows, 'VG-009 保存与渲染必须为同一份判定');
      const frames = evidence.timing.map((frame) => {
        const original = baseline[frame.kind === 'top' ? 0 : frame.kind === 'iframe' ? 1 : frame.kind === 'srcdoc' ? 2 : 3];
        const stages = Object.fromEntries(['earliest', 'load', 'postLoad'].map((stage) => {
          const snapshot = frame.actual.value?.[stage];
          const stageRows = rows.filter((r) => r.label.startsWith(`${frame.kind} #${frame.frameId} ${stage} `));
          const verdict = stageRows.length !== 6 || stageRows.some((r) => r.verdict === 'UNKNOWN') ? 'UNKNOWN' : stageRows.some((r) => r.verdict === 'FAIL') ? 'FAIL' : 'PASS';
          const classification = !snapshot ? 'unavailable' : verdict === 'PASS' ? 'spoofed' : JSON.stringify(valuesOf(snapshot)) === JSON.stringify(valuesOf(original[stage === 'postLoad' ? 'load' : stage])) ? 'original' : 'mixed';
          return [stage, { verdict, classification, snapshot }];
        }));
        return { kind: frame.kind, frameId: frame.frameId, ...stages, error: frame.actual.error };
      });
      const counts = rows.reduce((a, r) => ({ ...a, [r.verdict]: a[r.verdict] + 1 }), { PASS: 0, FAIL: 0, UNKNOWN: 0 });
      attempts.push({ attempt: index + 1, counts, frames, rows });
      for (const frame of frames) console.log(`VG-009 #${index + 1} ${frame.kind}: earliest=${frame.earliest.verdict}/${frame.earliest.classification}, load=${frame.load.verdict}/${frame.load.classification}, postLoad=${frame.postLoad.verdict}/${frame.postLoad.classification}`);
      await evaluate(report, `document.querySelector('#cancel').click()`);
      assert.equal(await evaluate(report, `document.querySelectorAll('.row').length`), 0);
    }
    assert.equal(cdp.errors.length, 0, 'VG-009 Runtime exceptions');
    assert.ok(requests.every((url) => /^\/(?:fixtures\/injection\/(?:earliest-inline|child)\.html|favicon\.ico)$/.test(url)), 'VG-009 请求必须仅为固定fixture路径');
    const result = attempts.every((a) => a.counts.FAIL === 0 && a.counts.UNKNOWN === 0) ? 'PASS' : attempts.some((a) => a.counts.FAIL > 0) ? 'FAIL' : 'UNKNOWN';
    const record = { task: 'VG-009', browser: version.Browser, mode: 'real Chrome headless / temporary profile', result,
      fixture: 'fixtures/injection/earliest-inline.html', fixedEpochMs: 1768478400000,
      baseline, syntheticExpectation: { language: config.globalProfile.language, timezone: config.globalProfile.timezone.timezone }, attempts,
      runtimeExceptions: cdp.errors.length, requestsContainOnlyFixturePaths: true,
      limitations: ['页面实际快照不构成可信配置或生产授权', 'load 是 load 回调时刻，不等待后台初始化', '不代表 Chrome119 或人工验收'] };
    if (output) await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`VG-009 真实 Chrome ${version.Browser}：${result}；${runs}次导航；Runtime exceptions=0。`);
    return result === 'PASS' ? 0 : 1;
  } finally {
    cdp?.close();
    await new Promise((done) => server.close(done));
    if (child?.pid && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(force);
    }
    await rm(profile, { recursive: true, force: true });
  }
}
