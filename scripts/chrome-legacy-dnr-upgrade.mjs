#!/usr/bin/env node
// VG-028：临时 profile 原位升级；请求头仅在内存比较，正式证据仅布尔/计数。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const oldBuild = value('--upgrade-from');
const output = value('--output');
if (!oldBuild || args.some((arg, i) => i % 2 === 0 && !['--upgrade-from', '--output'].includes(arg)) || args.length % 2) {
  throw new Error('参数：--upgrade-from <旧dist> [--output <脱敏JSON>]');
}
const pause = ms => new Promise(done => setTimeout(done, ms));
let phase = 'prepare';
async function until(read, accept = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await pause(100);
  }
  throw new Error('等待阶段超时');
}

const evidence = { task: 'VG-028', result: 'BLOCKED', chrome: null, checks: {},
  scope: 'legacy-dnr-same-profile-upgrade', mechanism: 'Extensions.loadUnpacked same staged path; package version unchanged',
  limitations: ['未开启 Allow User Scripts，不验证语言/时区首脚本或字体生产恢复', '未监控 Chrome 自身全部后台网络；fixture 仅请求 loopback'],
  cleanup: 'UNKNOWN', failure: null };
const temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-dnr-upgrade-'));
const staged = join(temporary, 'extension');
const profile = join(temporary, 'profile');
let browser;
let socket;
const pending = new Map();
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/headers.json') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ acceptLanguage: request.headers['accept-language'] || '' }));
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Native header fixture</title>');
  }
});
try {
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '找不到 Chrome');
  assert.equal(typeof WebSocket, 'function', '需要 Node22+');
  for (const directory of [resolve(oldBuild), join(root, 'dist')]) {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    assert.ok(manifest.permissions.includes('declarativeNetRequest'));
    assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
  }
  await cp(resolve(oldBuild), staged, { recursive: true });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  phase = 'chrome-startup';
  browser = spawn(chrome, ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => {
    if (browser.exitCode !== null || browser.signalCode) throw new Error('浏览器提前退出');
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; }
  });
  const protocol = await (await fetch(`http://127.0.0.1:${port}/json/protocol`)).json();
  for (const [domain, command] of [['Extensions', 'loadUnpacked'], ['ServiceWorker', 'stopAllWorkers'], ['ServiceWorker', 'startWorker']]) {
    assert.ok(protocol.domains.find(item => item.domain === domain)?.commands.some(item => item.name === command));
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  evidence.chrome = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) {
      const error = new Error('Chrome 协议拒绝操作');
      error.protocol = { method: request.method, code: message.error.code,
        detail: message.error.message.replaceAll(temporary, '<temporary>').replaceAll(root, '<workspace>')
          .replace(/\/Users\/[^\s:]+/g, '<user-path>').replace(/[a-p]{32}/g, '<extension>').slice(0, 240) };
      request.fail(error);
    }
    else request.done(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error('Chrome 协议超时')); }, 15000);
    pending.set(id, { done, fail, timer, method });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const attach = async targetId => {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    return sessionId;
  };
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error('扩展或fixture表达式失败');
    return result.result.value;
  };
  const page = async url => {
    const { targetId } = await send('Target.createTarget', { url });
    const sessionId = await attach(targetId);
    await until(() => evaluate(sessionId, 'document.readyState'), state => state === 'complete');
    return { targetId, sessionId };
  };
  const { id } = await send('Extensions.loadUnpacked', { path: staged });
  const workerUrl = `chrome-extension://${id}/background/service-worker.js`;
  const workerTarget = async () => (await send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === workerUrl);
  const worker = () => until(async () => {
    const target = await workerTarget();
    if (!target) return null;
    try { return await attach(target.targetId); }
    catch (error) {
      // 扩展替换时已观察到 discovery→attach 间旧 target 消失，只重试此明确的只读竞态。
      if (error.protocol?.code === -32602 && error.protocol.detail === 'No target with given id found') return null;
      throw error;
    }
  });
  let workerSession = await worker();
  await until(() => evaluate(workerSession, 'Boolean(globalThis.chrome?.storage?.local)'));
  let options = await page(`chrome-extension://${id}/options/options.html`);
  const fixture = await page(origin);
  const header = () => evaluate(fixture.sessionId, "fetch('/headers.json',{cache:'no-store',credentials:'omit'}).then(r=>r.json()).then(r=>r.acceptLanguage)");
  const nativeHeader = await header();
  assert.ok(nativeHeader.length);
  const message = request => evaluate(options.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(request)})`);
  phase = 'old-build-and-seed';
  const legacy = { schemaVersion: 2, masterEnabled: true, rules: [{ id: 'upgrade', domain: '127.0.0.1', enabled: true }],
    globalProfile: { language: { enabled: true, mode: 'custom', language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'ja-JP' },
      timezone: { enabled: false, mode: 'auto', timezone: '' }, geolocation: { enabled: false, mode: 'auto' } },
    canvas: { enabled: true, spoofFonts: true, targetFonts: ['MiSans', 'Custom Fixture Font'] }, webRtc: { globalMode: 'default' } };
  const oldSaved = await message({ action: 'setSiteConfig', config: legacy });
  assert.ok(['ok', 'partial'].includes(oldSaved.status));
  assert.equal(oldSaved.config.schemaVersion, 2, '升级对照必须来自真实旧构建');
  await evaluate(workerSession, `chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[1100,2100],addRules:[
    {id:1100,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Accept-Language',operation:'set',value:'ja-JP'}]},condition:{urlFilter:'127.0.0.1',resourceTypes:['xmlhttprequest']}},
    {id:2100,priority:1,action:{type:'block'},condition:{urlFilter:'never-hit.synthetic.invalid'}}]})`);
  assert.equal(await header(), 'ja-JP');
  assert.notEqual(nativeHeader, 'ja-JP');
  evidence.checks.oldRuleActive = true;
  for (const target of (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.url.startsWith(`chrome-extension://${id}/`))) {
    await send('Target.closeTarget', { targetId: target.targetId });
  }
  // 更新前释放旧 worker 调试会话，避免将旧 target/执行上下文误作候选就绪。
  await send('Target.detachFromTarget', { sessionId: workerSession });
  phase = 'same-path-stage';
  await rm(staged, { recursive: true });
  await cp(join(root, 'dist'), staged, { recursive: true });
  phase = 'load-candidate-at-same-path';
  const updated = await send('Extensions.loadUnpacked', { path: staged });
  assert.equal(updated.id, id);
  workerSession = await worker();
  phase = 'wait-candidate-storage';
  await until(() => evaluate(workerSession, 'Boolean(globalThis.chrome?.storage?.local)'));
  phase = 'wait-candidate-schema-and-marker';
  await until(() => evaluate(workerSession, "chrome.storage.local.get(['siteSpoofConfig','legacyDnrCleanupV3Complete']).then(r=>r.siteSpoofConfig?.schemaVersion===3&&r.legacyDnrCleanupV3Complete===true)"));
  const counts = async () => evaluate(workerSession, 'chrome.declarativeNetRequest.getDynamicRules().then(r=>({managed:r.filter(x=>x.id>=1100&&x.id<=2099).length,foreign:r.filter(x=>x.id===2100).length}))');
  assert.deepEqual(await counts(), { managed: 0, foreign: 1 });
  evidence.checks.upgradeCleanup = true;
  evidence.checks.foreignRuleRetained = true;
  evidence.checks.upgradedHeaderNative = await header() === nativeHeader;
  assert.equal(evidence.checks.upgradedHeaderNative, true);
  options = await page(`chrome-extension://${id}/options/options.html`);
  for (const language of ['de-DE', 'fr-FR']) {
    const state = await message({ action: 'getSiteConfig' });
    const config = state.config;
    assert.equal(config.schemaVersion, 3);
    assert.deepEqual(config.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['MiSans', 'Custom Fixture Font'] });
    assert.ok(!JSON.stringify(config).match(/"(?:canvas|acceptLanguage)"/));
    config.globalProfile.language = { enabled: true, mode: 'custom', language, languages: [language] };
    const saved = await message({ action: 'setSiteConfig', config });
    assert.equal(saved.syncReport.components.legacyDnrCleanup.status, 'ok');
    assert.equal(await header(), nativeHeader);
    assert.deepEqual(await counts(), { managed: 0, foreign: 1 });
  }
  evidence.checks.configMigration = true;
  evidence.checks.languageChangesKeepNativeHeader = true;
  phase = 'worker-stop-wake';
  for (const target of (await send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.url.startsWith(`chrome-extension://${id}/`))) {
    await send('Target.closeTarget', { targetId: target.targetId });
  }
  const lifecycle = await page('about:blank');
  // marker 已存在，故意留下新的旧范围规则，证明唤醒会真正复核而非命中缓存。
  await evaluate(workerSession, "chrome.declarativeNetRequest.updateDynamicRules({addRules:[{id:2099,action:{type:'block'},condition:{urlFilter:'never-hit.synthetic.invalid'}}]})");
  await send('Target.detachFromTarget', { sessionId: workerSession });
  await send('ServiceWorker.enable', {}, lifecycle.sessionId);
  await send('ServiceWorker.stopAllWorkers', {}, lifecycle.sessionId);
  await until(async () => !await workerTarget());
  await send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${id}/` }, lifecycle.sessionId);
  workerSession = await worker();
  await until(() => evaluate(workerSession, 'Boolean(globalThis.chrome?.storage?.local)'));
  await until(() => evaluate(workerSession, "chrome.storage.session.get('runtimeSyncMetadata').then(r=>r.runtimeSyncMetadata?.report?.components?.legacyDnrCleanup?.status==='ok')"));
  await until(counts, value => value.managed === 0 && value.foreign === 1);
  assert.deepEqual(await counts(), { managed: 0, foreign: 1 });
  assert.equal(await header(), nativeHeader);
  evidence.checks.workerStopWake = true;
  evidence.result = 'PASS';
} catch (error) {
  evidence.failure = { phase, kind: error.code === 'ERR_ASSERTION' ? 'assertion' : 'environment-or-automation',
    reason: error.code === 'ERR_ASSERTION' ? '断言未满足'
      : ['等待阶段超时', '浏览器提前退出', 'Chrome 协议拒绝操作', 'Chrome 协议超时', '扩展或fixture表达式失败'].includes(error.message) ? error.message : '运行环境操作失败' };
  if (error.protocol) evidence.failure.protocol = error.protocol;
  process.exitCode = 2;
} finally {
  for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('探针关闭')); }
  pending.clear(); socket?.close();
  if (browser && browser.exitCode === null && !browser.signalCode) {
    const exited = new Promise(done => browser.once('exit', done));
    browser.kill('SIGTERM');
    const force = setTimeout(() => browser.kill('SIGKILL'), 5000);
    await exited; clearTimeout(force);
  }
  if (server.listening) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
  evidence.cleanup = 'PASS';
  if (output) await writeFile(resolve(output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
