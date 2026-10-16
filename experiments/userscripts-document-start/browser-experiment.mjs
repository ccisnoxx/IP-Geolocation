#!/usr/bin/env node
// Node 22+ 原生 CDP；仅执行包内固定控制动作和 fixture 观测，不派发页面补丁。
import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFixtureServer } from './fixture.mjs';
import { createEvidence } from './acceptance.mjs';
import { probeNetwork, probeInheritedNetwork } from './network-probe.mjs';
import { createChromeStartupDiagnostics } from './chrome-startup-diagnostics.mjs';
import { chromeSandboxStatus } from './chrome-sandbox-status.mjs';

const evidence = createEvidence();
const chromeStartup = createChromeStartupDiagnostics();
class Blocked extends Error {}
class MechanismFailure extends Error {}
class ContextTransition extends Error {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept = Boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (chromeStartup.result.status === 'DENIED') throw new Blocked('CHROME_SANDBOX_INITIALIZATION_DENIED');
    let result;
    try { result = await read(); }
    catch (error) {
      // 导航销毁旧执行上下文是预期过渡；其余失败仍显式传播。
      if (!(error instanceof ContextTransition)) throw error;
    }
    if (accept(result)) return result;
    await delay(50);
  }
  throw new Blocked('AUTOMATION_TIMEOUT');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close(); reject(new Blocked('CDP_CONNECT_TIMEOUT'));
    }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer); socket.close(); reject(new Blocked('CDP_CONNECT_FAILED'));
    }, { once: true });
  });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error && /context.*(?:destroyed|not found)|Cannot find context/i.test(message.error.message)) {
      request.reject(new ContextTransition());
    } else if (message.error) request.reject(new Blocked('CDP_COMMAND_FAILED'));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Blocked('CDP_CLOSED'));
    }
    pending.clear();
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Blocked('CDP_COMMAND_TIMEOUT'));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() { socket.close(); }
  };
}

let server, child, cdp, temp, control;
const pages = [];
let registrationOwned = false;
try {
  if (typeof process.send !== 'function' || !process.connected) throw new Blocked('INTERNAL_COLLECTOR_REQUIRES_GUARDED_LAUNCH');
  if (typeof WebSocket !== 'function') throw new Blocked('NODE_22_REQUIRED');
  if (process.env.VG_US_NETWORK_BACKEND === 'linux-netns') {
    evidence.network.backend = 'linux-network-namespace';
    const links = JSON.parse(execFileSync('ip', ['-j', 'link'], { encoding: 'utf8' }));
    const routes4 = JSON.parse(execFileSync('ip', ['-j', 'route', 'show', 'table', 'all'], { encoding: 'utf8' }));
    const routes6 = JSON.parse(execFileSync('ip', ['-j', '-6', 'route', 'show', 'table', 'all'], { encoding: 'utf8' }));
    evidence.network.topology = {
      onlyLoopbackInterface: links.length === 1 && links[0].ifname === 'lo' && links[0].flags.includes('UP'),
      ipv4ProhibitDefault: routes4.some(route => route.type === 'prohibit' && route.dst === 'default'),
      ipv6ProhibitDefault: routes6.some(route => route.type === 'prohibit' && route.dst === 'default'),
      noExternalRoutes: [...routes4, ...routes6].every(route => route.type === 'prohibit' || route.dev === 'lo'),
      nonRootCollector: process.getuid() !== 0
    };
    if (!Object.values(evidence.network.topology).every(value => value === true)) throw new Blocked('NETWORK_NAMESPACE_UNVERIFIED');
  }
  evidence.network.policyApplied = true;
  Object.assign(evidence.network.checks, await probeNetwork());
  if (Object.values(evidence.network.checks).includes('FAIL')) {
    evidence.network.status = 'FAIL';
    throw new Blocked('NETWORK_RESTRICTION_FAILED');
  }
  evidence.network.checks.inherited = await probeInheritedNetwork();
  if (!Object.values(evidence.network.checks).every(status => status === 'PASS')) throw new Blocked('NETWORK_RESTRICTION_UNVERIFIED');
  evidence.network.status = 'PASS';
  server = createFixtureServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  const otherOrigin = `http://127.0.0.1:${server.address().port}`;
  let port;
  {
    const executable = [process.env.CHROME_BIN,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
    if (!executable) throw new Blocked('CHROME_NOT_FOUND');
    const versionOutput = await promisify(execFile)(executable, ['--version'], { timeout: 5000 });
    const executableVersion = /(?:Chrome|Chromium)[^\d]*(\d+(?:\.\d+){3})/.exec(versionOutput.stdout);
    if (!executableVersion) throw new Blocked('CHROME_VERSION_UNKNOWN');
    evidence.environment.chromeVersion = executableVersion[1];
    evidence.environment.chromeVersionSource = 'EXECUTABLE_VERSION_COMMAND';
    temp = process.env.VG_US_EXPERIMENT_TEMP;
    if (!temp) throw new Blocked('OWNED_PROFILE_REQUIRED');
    // 此调试选项只允许 CDP 装载临时扩展；绝不启用或绕过 Allow User Scripts。
    child = spawn(executable, [
      '--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=0',
      `--user-data-dir=${temp}`, '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.once('spawn', () => { evidence.environment.realChrome = true; });
    child.stderr.on('data', chunk => {
      chromeStartup.feed(chunk);
      if (chromeStartup.result.status === 'DENIED') {
        // 已知启动不兼容即停止自己的浏览器，不等待子进程反复崩溃或重试 CDP。
        cdp?.close();
        child.kill('SIGTERM');
      }
    });
    child.stderr.once('end', () => chromeStartup.finish());
    let launchError = false;
    child.once('error', () => { launchError = true; });
    port = await until(async () => {
      if (launchError || child.exitCode !== null) throw new Blocked('CHROME_LAUNCH_FAILED');
      try { return (await readFile(join(temp, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    });
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(10000)
  })).json();
  const product = /(?:HeadlessChrome|Chrome|Chromium)\/(\d+(?:\.\d+){3})/.exec(version.Browser);
  if (!product) throw new Blocked('CHROME_VERSION_UNKNOWN');
  evidence.environment.chromeVersion = product[1];
  evidence.environment.chromeVersionSource = 'CDP_BROWSER_VERSION';
  evidence.environment.realChrome = true;
  if (Number(product[1].split('.')[0]) < 138) throw new Blocked('CHROME_138_REQUIRED');
  // 只使用已核实的 loopback 端点，忽略服务端返回的任意 hostname。
  const ws = new URL(version.webSocketDebuggerUrl);
  cdp = await connect(`ws://127.0.0.1:${port}${ws.pathname}`);
  async function evaluate(page, expression) {
    const response = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    }, page.sessionId);
    if (response.exceptionDetails) throw new Blocked('CONTROL_OR_OBSERVATION_EXCEPTION');
    return response.result.value;
  }
  async function createPage(url = 'about:blank') {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const page = { targetId };
    pages.push(page);
    Object.assign(page, await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Page.enable', {}, page.sessionId);
    return page;
  }
  if (process.platform === 'linux') {
    const sandboxPage = await createPage('chrome://sandbox');
    const sandboxText = await until(() => evaluate(sandboxPage, 'document.body.innerText'), text => text?.includes('Seccomp'));
    evidence.environment.chromeSandbox = chromeSandboxStatus(sandboxText);
    evidence.environment.chromeSandbox.observedPage = sandboxText;
    if (evidence.environment.chromeSandbox.status !== 'PASS') throw new Blocked('CHROME_SANDBOX_UNVERIFIED');
  }
  const extensionId = (await cdp.send('Extensions.loadUnpacked', {
    path: fileURLToPath(new URL('./extension/', import.meta.url))
  })).id;
  control = await createPage(`chrome-extension://${extensionId}/control.html`);
  await until(() => evaluate(control, 'Boolean(globalThis.vgExperiment)'));
  let probe = await evaluate(control, 'vgExperiment.probe()');
  const details = await createPage(`chrome://extensions/?id=${extensionId}`);
  // 只读取实际呈现的 Chrome UI，并向可见开关派发可信鼠标输入；不调用设置/权限私有 API。
  const readToggle = `(() => {
    const find = root => { for (const node of root.querySelectorAll('*')) {
      if (node.id === 'allow-user-scripts') return node;
      if (node.shadowRoot) { const found = find(node.shadowRoot); if (found) return found; }
    }};
    const row = find(document);
    const toggle = row?.shadowRoot?.querySelector('cr-toggle');
    if (!toggle) return null;
    toggle.scrollIntoView({ block: 'center' });
    const rect = toggle.getBoundingClientRect();
    return { checked: toggle.checked, disabled: toggle.disabled, visible: rect.width > 0 && rect.height > 0,
      x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`;
  const before = await until(() => evaluate(details, readToggle), row => row?.visible && !row.disabled);
  evidence.environment.userScriptsSwitch = { method: 'Chrome-extension-details-trusted-pointer', before: before.checked,
    apiBefore: probe.available, after: 'UNKNOWN' };
  if (before.checked !== false || probe.available !== false) throw new Blocked('FRESH_USER_SCRIPTS_SWITCH_UNEXPECTED');
  await cdp.send('Target.activateTarget', { targetId: details.targetId });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount: 1 }, details.sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x, y: before.y, button: 'left', clickCount: 1 }, details.sessionId);
  const after = await until(() => evaluate(details, readToggle), row => row?.checked === true);
  evidence.environment.userScriptsSwitch.after = after.checked;
  evidence.environment.allowUserScriptsUiState = 'ENABLED';
  probe = await evaluate(control, 'vgExperiment.probe()');
  evidence.environment.apiAvailable = probe.available;
  evidence.environment.allowUserScripts = probe.available;
  evidence.environment.allowUserScriptsEvidence = probe.available
    ? '默认开关关闭/API 不可用；正常扩展详情页可信鼠标点击后开关开启，getScripts 实际成功'
    : '正常扩展详情页开关开启后，getScripts 仍不可用或抛错';
  if (!probe.available) throw new Blocked('USER_SCRIPTS_UNAVAILABLE');
  if (!probe.empty) throw new Blocked('EXPERIMENT_ALREADY_HAS_REGISTRATIONS');

  // 仅取回 fixture 自身保存的首脚本/load 记录；postLoad 在这里独立采集。
  const readExpression = `(() => {
    const windows = [window, ...Array.from(document.querySelectorAll('iframe'), f => f.contentWindow)];
    if (windows.length !== 2 || windows.some(w => !w.vgObservation?.load || !w.vgObservation.pageshow.length)) return null;
    return windows.map(w => ({ ...w.vgObservation, url: w.location.href, postLoad: w.vgReadCurrent() }));
  })()`;
  const read = page => evaluate(page, readExpression);
  async function navigate(page, url, previous) {
    const result = await cdp.send('Page.navigate', { url }, page.sessionId);
    if (result.errorText || !result.loaderId) throw new Blocked('NEW_DOCUMENT_NAVIGATION_FAILED');
    return until(() => read(page), rows => rows && (!previous || rows[0].instance !== previous[0].instance));
  }
  async function newDocument(url = `${origin}/matched/top.html`) {
    const page = await createPage();
    return { page, rows: await navigate(page, url) };
  }
  async function reload(page, previous) {
    await cdp.send('Page.reload', {}, page.sessionId);
    return until(() => read(page), rows => rows && rows[0].instance !== previous[0].instance);
  }
  const baseline = (await newDocument()).rows;
  const nativeValues = baseline.map(row => row.earliest.value);
  if (nativeValues.some(value => ['x-vg-a', 'x-vg-b'].includes(value))) throw new Blocked('NATIVE_CONTROL_COLLIDES');
  function publicSample(sample, index) {
    return {
      value: ['x-vg-a', 'x-vg-b'].includes(sample.value) ? sample.value
        : sample.value === nativeValues[index] ? '<native-control>' : '<other-redacted>',
      readyState: sample.readyState, scriptIndex: sample.scriptIndex, inline: sample.inline
    };
  }
  function summarize(rows) {
    return rows.map((row, index) => ({
      frame: index === 0 ? 'top' : 'same-origin-http-iframe',
      earliest: publicSample(row.earliest, index), load: publicSample(row.load, index),
      postLoad: publicSample(row.postLoad, index),
      pageshow: row.pageshow.map(event => ({ persisted: event.persisted, sample: publicSample(event.sample, index) }))
    }));
  }
  function check(id, rows, expectedValues, extra = {}, extraPass = true) {
    const row = evidence.scenarios.find(scenario => scenario.id === id);
    row.actual = { frames: summarize(rows), independentDocuments: rows[0].instance !== rows[1].instance, ...extra };
    for (const phase of ['earliest', 'load', 'postLoad']) {
      row.phases[phase] = rows.every((frame, index) => {
        const expected = expectedValues[index] === 'native' ? nativeValues[index] : expectedValues[index];
        return frame[phase].value === expected && (phase !== 'earliest' ||
          (frame.earliest.readyState === 'loading' && frame.earliest.scriptIndex === 1 && frame.earliest.inline === true));
      }) ? 'PASS' : 'FAIL';
    }
    row.status = Object.values(row.phases).every(status => status === 'PASS') &&
      row.actual.independentDocuments && extraPass ? 'PASS' : 'FAIL';
    if (row.status === 'FAIL') throw new MechanismFailure(`SCENARIO_FAILED:${id}`);
  }
  async function action(name, field) {
    // name 只来自本文件固定调用，不接收网页/HTTP 输入。
    let ok;
    try { ok = await evaluate(control, `vgExperiment.${name}()`); }
    catch (error) { evidence.mechanism[field] = 'FAIL'; throw error; }
    evidence.mechanism[field] = ok ? 'PASS' : 'FAIL';
    if (!ok) throw new MechanismFailure(`REGISTRATION_READBACK_FAILED:${field}`);
  }
  check('A-native', baseline, ['native', 'native']);
  registrationOwned = true;
  await action('registerA', 'register');
  const heldA = await newDocument();
  check('B-register-A', heldA.rows, ['x-vg-a', 'x-vg-a']);
  const toReload = await newDocument();
  check('B-broad-subpath', (await newDocument(`${origin}/matched/sub/deep.html`)).rows, ['x-vg-a', 'x-vg-a']);
  check('E-other-origin', (await newDocument(`${otherOrigin}/matched/top.html`)).rows, ['native', 'native']);
  await action('updateB', 'update');
  const existingA = await read(heldA.page);
  check('C-existing-A', existingA, ['x-vg-a', 'x-vg-a'], {
    sameDocuments: existingA.every((row, i) => row.instance === heldA.rows[i].instance)
  }, existingA.every((row, i) => row.instance === heldA.rows[i].instance));
  const reloadedB = await reload(toReload.page, toReload.rows);
  check('C-reload-B', reloadedB, ['x-vg-b', 'x-vg-b'], {
    newDocuments: reloadedB.every((row, i) => row.instance !== toReload.rows[i].instance), sameURL: reloadedB.every((row, i) => row.url === toReload.rows[i].url)
  }, reloadedB.every((row, i) => row.instance !== toReload.rows[i].instance && row.url === toReload.rows[i].url));
  const newB = await newDocument();
  check('C-new-tab-B', newB.rows, ['x-vg-b', 'x-vg-b']);

  const historyA = await cdp.send('Page.getNavigationHistory', {}, heldA.page.sessionId);
  const entryA = historyA.entries[historyA.currentIndex].id;
  const away = await navigate(heldA.page, `${otherOrigin}/matched/top.html`, heldA.rows);
  check('F-history-away', away, ['native', 'native']);
  const historyAway = await cdp.send('Page.getNavigationHistory', {}, heldA.page.sessionId);
  const entryAway = historyAway.entries[historyAway.currentIndex].id;
  await cdp.send('Page.navigateToHistoryEntry', { entryId: entryA }, heldA.page.sessionId);
  const back = await until(() => read(heldA.page), rows => rows && rows[0].instance !== away[0].instance);
  const restored = back[0].instance === heldA.rows[0].instance;
  const persisted = back[0].pageshow.at(-1).persisted;
  const childRestored = back[1].instance === heldA.rows[1].instance;
  const childPersisted = back[1].pageshow.at(-1).persisted;
  check('F-history-back', back, [restored ? 'x-vg-a' : 'x-vg-b', childRestored ? 'x-vg-a' : 'x-vg-b'], {
    restoredOriginalDocument: restored, pageshowPersisted: persisted,
    childRestoredOriginalDocument: childRestored, childPageshowPersisted: childPersisted,
    bfcacheObserved: restored && persisted
  }, restored === persisted && childRestored === childPersisted &&
    back[0].pageshow.at(-1).sample.value === (restored ? 'x-vg-a' : 'x-vg-b') &&
    back[1].pageshow.at(-1).sample.value === (childRestored ? 'x-vg-a' : 'x-vg-b'));
  await cdp.send('Page.navigateToHistoryEntry', { entryId: entryAway }, heldA.page.sessionId);
  const forward = await until(() => read(heldA.page), rows => rows && rows[0].instance !== back[0].instance);
  check('F-history-forward', forward, ['native', 'native'], {
    restoredOriginalDocument: forward[0].instance === away[0].instance,
    pageshowPersisted: forward[0].pageshow.at(-1).persisted,
    childRestoredOriginalDocument: forward[1].instance === away[1].instance,
    childPageshowPersisted: forward[1].pageshow.at(-1).persisted
  }, forward.every((row, i) => row.pageshow.at(-1).sample.value === nativeValues[i] &&
    (row.instance === away[i].instance) === row.pageshow.at(-1).persisted));
  await action('narrowB', 'narrowUpdate');
  check('E-narrow-inside', (await newDocument(`${origin}/matched/sub/deep.html`)).rows, ['x-vg-b', 'x-vg-b']);
  check('E-narrow-outside', (await newDocument(`${origin}/outside/top.html`)).rows, ['native', 'x-vg-b']);
  check('E-narrow-near-miss', (await newDocument(`${origin}/matchedness/top.html`)).rows, ['native', 'x-vg-b']);
  await action('unregister', 'unregister');
  registrationOwned = false;
  const existingB = await read(newB.page);
  check('D-existing-B', existingB, ['x-vg-b', 'x-vg-b'], {
    sameDocuments: existingB.every((row, i) => row.instance === newB.rows[i].instance)
  }, existingB.every((row, i) => row.instance === newB.rows[i].instance));
  check('D-new-native', (await newDocument()).rows, ['native', 'native']);
  check('D-reload-native', await reload(newB.page, newB.rows), ['native', 'native']);
  // 本进程只采集；父 runner 在网络、生产文件和所有必需项齐备后统一判定。
} catch (error) {
  const sandboxDenied = chromeStartup.result.status === 'DENIED';
  const failed = !sandboxDenied && error instanceof MechanismFailure;
  evidence.conclusion = failed ? 'NO_GO' : 'BLOCKED';
  evidence.exitCode = failed ? 1 : 2;
  // 任意异常文本可能包含路径/URL/ID。正式输出只使用固定分类。
  evidence.stopReason = sandboxDenied ? 'CHROME_SANDBOX_INITIALIZATION_DENIED'
    : error instanceof Blocked || failed ? error.message : 'UNCLASSIFIED_AUTOMATION_ERROR';
} finally {
  const cleanupFailures = [];
  if (registrationOwned && cdp && control?.sessionId) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'vgExperiment.unregister()', awaitPromise: true, returnByValue: true
      }, control.sessionId);
      if (result.exceptionDetails || result.result.value !== true) cleanupFailures.push('REGISTRATION_CLEANUP_FAILED');
    } catch { cleanupFailures.push('REGISTRATION_CLEANUP_FAILED'); }
  }
  if (cdp) {
    // 此入口只拥有自行启动的 Chrome；进程退出即关闭本次全部标签，不依赖失效的 CDP。
    if (child) {
      try { await cdp.send('Browser.close'); } catch { /* 关闭浏览器可能先断开 CDP。 */ }
    }
    cdp.close();
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (temp) {
    try { await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { cleanupFailures.push('TEMP_PROFILE_CLEANUP_FAILED'); }
  }
  chromeStartup.finish();
  evidence.environment.chromeStartup = { ...chromeStartup.result };
  if (chromeStartup.result.status === 'DENIED') {
    evidence.environment.chromeDiagnostic = 'CHROME_SANDBOX_INITIALIZATION_DENIED';
    evidence.stopReason = 'CHROME_SANDBOX_INITIALIZATION_DENIED';
    evidence.conclusion = 'BLOCKED'; evidence.exitCode = 2;
  }
  evidence.cleanup = { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures };
  if (cleanupFailures.length) {
    evidence.conclusion = 'BLOCKED'; evidence.exitCode = 2;
    evidence.stopReason ??= 'CLEANUP_FAILED';
  }
  if (typeof process.send === 'function' && process.connected) {
    await new Promise((resolve, reject) => process.send({ type: 'experiment-evidence', evidence }, error => error ? reject(error) : resolve()));
    process.disconnect();
    // 内部退出码只表示 IPC 交付完成；实验退出码由 runner 统一生成。
  } else {
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = 2;
  }
}
