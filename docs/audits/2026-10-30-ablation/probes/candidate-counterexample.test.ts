import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createContentBridge } from '/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/vanishgeo-ablation-20261030-m0yg_pqy/candidate-content.ts';

/**
 * 桥的 frame 归属逻辑：父页 payload 不能覆盖独立子域 iframe；clear 要按
 * 本 frame 的 URL 重拉；旧 payload（没有 hostname）保持兼容。
 *
 * 用 Node 的 MessageChannel 和一套最小 chrome/window 替身跑真实实现，
 * 不 mock 桥自身的分支。
 */
const NONCE = 'test-nonce';
const CHILD_URL = 'http://child.localhost:8765/fixtures/iframe/child-allowlisted.html';
const PARENT_REFERRER = 'http://parent.localhost:8765/';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await sleep(5);
  if (!predicate()) throw new Error('condition not met before timeout');
}

const activeHarnesses: Array<{ stop(): void }> = [];

after(() => {
  for (const harness of activeHarnesses) harness.stop();
});

function createHarness(options: { retryDelays?: number[]; autoAck?: boolean; ackDelayMs?: number; href?: string; referrer?: string } = {}) {
  const delivered: any[] = [];
  const pulls: string[] = [];
  const reports: any[] = [];
  const handshakes: any[] = [];
  const requests: any[] = [];
  const ports: MessagePort[] = [];
  let listener: ((message: any, sender?: any, sendResponse?: any) => void) | null = null;
  let runtimePort: MessagePort | null = null;
  let response: any = {
    status: 'ok',
    matched: true,
    payload: { hostname: 'child.localhost', domain: 'child.localhost', languageConfig: { language: 'en-US' } }
  };

  const chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: (message: any, callback?: (value: any) => void) => {
        requests.push(message);
        if (typeof callback === 'function') {
          pulls.push(message.url);
          const current = response;
          setTimeout(() => callback(current), 0);
          return undefined;
        }
        reports.push(message);
        return Promise.resolve({ status: 'ok' });
      },
      onMessage: {
        addListener: (fn: (message: any, sender?: any, sendResponse?: any) => void) => { listener = fn; }
      }
    }
  };

  const listeners = new Map<string, Array<(event: any) => void>>();
  const window = {
    location: { href: options.href ?? CHILD_URL },
    addEventListener: (type: string, fn: (event: any) => void) => {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (event: any) => void) => {
      const list = listeners.get(type) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    postMessage: (message: any, _target: string, transfer?: MessagePort[]) => {
      if (!message || message.__vanishGeo !== 'handshake' || !transfer || !transfer[0]) return;
      const port = transfer[0];
      handshakes.push(message);
      ports.push(port);
      runtimePort = port;
      port.onmessage = (event: MessageEvent) => { delivered.push(event.data); };
      port.start();
      if (options.autoAck === false) return;
      const send = () => port.postMessage({ __vanishGeo: 'ack', nonce: NONCE });
      if (options.ackDelayMs) setTimeout(send, options.ackDelayMs);
      else send();
    }
  };

  const handle = createContentBridge({
    window,
    document: { referrer: options.referrer ?? PARENT_REFERRER },
    chrome,
    nonce: NONCE,
    retryDelays: options.retryDelays
  });

  const harness = {
    delivered,
    requests,
    pulls,
    reports,
    handshakes,
    window,
    chrome,
    /** 模拟页面事件（pageshow 等） */
    emit(type: string, event: any) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    listenerCount(type: string) {
      return (listeners.get(type) || []).length;
    },
    get listener() { return listener; },
    get runtimePort() { return runtimePort; },
    setResponse(value: any) { response = value; },
    sendAck(nonce = NONCE) {
      runtimePort?.postMessage({ __vanishGeo: 'ack', nonce });
    },
    stop() {
      handle.stop();
      for (const port of ports) {
        try { port.close(); } catch { /* ignore */ }
      }
      try { runtimePort?.close(); } catch { /* ignore */ }
    }
  };
  activeHarnesses.push(harness);
  return harness;
}

test('初始拉取按自己的 URL 解析，父页 payload 被拒绝并触发重拉', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);

  assert.equal(harness.pulls.length, 1);
  assert.equal(harness.pulls[0], CHILD_URL);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost');

  const before = harness.pulls.length;
  harness.listener?.({ action: 'applyPayload', payload: { hostname: 'parent.localhost', domain: 'parent.localhost' } });
  await waitFor(() => harness.pulls.length > before);

  assert.equal(harness.pulls.length, before + 1, '父页 payload 必须触发本 frame 重拉');
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost', '不能把父页 payload 交给 runtime');
});

test('匹配本 frame 的 payload 直接应用，不产生额外拉取', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;

  harness.listener?.({ action: 'applyPayload', payload: { hostname: 'child.localhost', domain: 'child.localhost', languageConfig: { language: 'ja-JP' } } });
  await waitFor(() => harness.delivered.at(-1)?.payload.languageConfig.language === 'ja-JP');

  assert.equal(harness.pulls.length, before);
  assert.equal(harness.delivered.at(-1)?.payload.languageConfig.language, 'ja-JP');
});

test('clear 不直接清空：先按本 frame URL 重拉，命中就重新 apply', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;

  harness.listener?.({ action: 'applyPayload', clear: true });
  await waitFor(() => harness.pulls.length > before);

  assert.equal(harness.pulls.length, before + 1);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost');
});

test('clear 后重拉未命中才下发 clear', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  harness.setResponse({ status: 'ok', matched: false, payload: null });

  harness.listener?.({ action: 'applyPayload', clear: true });
  await waitFor(() => harness.delivered.at(-1)?.payload?.clear === true);

  assert.deepEqual(harness.delivered.at(-1)?.payload, { clear: true });
});

test('没有 hostname 的旧 payload 保持兼容', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);

  harness.listener?.({ action: 'applyPayload', payload: { domain: 'legacy.example', languageConfig: { language: 'fr-FR' } } });
  await waitFor(() => harness.delivered.at(-1)?.payload.languageConfig.language === 'fr-FR');

  assert.equal(harness.delivered.at(-1)?.payload.languageConfig.language, 'fr-FR');
});

test('字体层回报按本 frame 的 URL 转发', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);

  harness.runtimePort?.postMessage({ __vanishGeo: NONCE, kind: 'fontLayers', layers: ['platform'] });
  await waitFor(() => harness.reports.length === 1);

  assert.equal(harness.reports.length, 1);
  assert.equal(harness.reports[0].action, 'reportFontLayers');
  assert.equal(harness.reports[0].url, CHILD_URL);
  assert.deepEqual(harness.reports[0].layers, ['platform']);
});


test('BFCache 恢复（pageshow.persisted）会按本 frame 重拉 payload', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;

  harness.emit('pageshow', { persisted: true });
  await waitFor(() => harness.pulls.length === before + 1);

  assert.equal(harness.pulls.length, before + 1);
  assert.equal(harness.pulls.at(-1), CHILD_URL, '重拉必须用本 frame 的地址，而不是父页的');
});

test('普通加载的 pageshow（persisted=false）不重复拉取', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;

  harness.emit('pageshow', { persisted: false });
  harness.emit('pageshow', undefined);
  await new Promise((done) => setTimeout(done, 30));

  assert.equal(harness.pulls.length, before, '首屏已经在拉，重复拉取会白打一遍后台');
});

test('stop() 之后 pageshow 不再拉取（监听器要摘掉）', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;

  harness.stop();
  assert.equal(harness.listenerCount('pageshow'), 0);
  harness.emit('pageshow', { persisted: true });
  await new Promise((done) => setTimeout(done, 30));

  assert.equal(harness.pulls.length, before);
});

test('Worker 包装失败按本 frame 的 URL 转发给后台', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);

  harness.runtimePort?.postMessage({
    __vanishGeo: NONCE,
    kind: 'workerFallback',
    reason: 'csp-blocked',
    script: 'http://child.localhost/worker.js',
    message: "Failed to construct 'Worker': CSP"
  });
  await waitFor(() => harness.reports.length === 1);

  assert.equal(harness.reports[0].action, 'reportWorkerFallback');
  assert.equal(harness.reports[0].url, CHILD_URL);
  assert.equal(harness.reports[0].reason, 'csp-blocked');
  assert.equal(harness.reports[0].script, 'http://child.localhost/worker.js');
});

test('错误 nonce 的 workerFallback 回报被丢弃', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);

  harness.runtimePort?.postMessage({ __vanishGeo: 'wrong', kind: 'workerFallback', reason: 'csp-blocked' });
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(harness.reports.length, 0);
});

test('SW 冷启动连续失败：收到 clear 后重试耗尽必须主动 clear', async () => {
  const harness = createHarness({ retryDelays: [1, 1, 1] });
  await waitFor(() => harness.delivered.length > 0);

  harness.setResponse({ status: 'error' });
  harness.listener?.({ action: 'applyPayload', clear: true });

  await waitFor(() => harness.delivered.some((message) => message.payload?.clear === true));
  assert.equal(harness.delivered.at(-1)?.payload?.clear, true);
});

test('普通首屏拉取失败只重试，不把烘焙值主动清掉', async () => {
  const harness = createHarness({ retryDelays: [1, 1] });
  // 第一次回调之前改成失败：模拟 SW 还没醒，页面静态脚本已应用烘焙值。
  harness.setResponse({ status: 'error' });
  await sleep(20);

  assert.equal(harness.delivered.some((message) => message.payload?.clear === true), false);
});

test('握手晚于首屏响应时，payload 先挂起，端口就绪后补发', async () => {
  const harness = createHarness({ ackDelayMs: 20 });
  await waitFor(() => harness.delivered.length > 0);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost');
});

test('非法 ack 不建立端口，合法 ack 才补发', async () => {
  const harness = createHarness({ autoAck: false });
  await waitFor(() => harness.handshakes.length === 1);
  assert.equal(harness.delivered.length, 0);

  harness.sendAck('wrong-nonce');
  await sleep(10);
  assert.equal(harness.delivered.length, 0);

  harness.sendAck();
  await waitFor(() => harness.delivered.length > 0);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost');
});

test('没有 ack 时按退避重试握手，stop 后不再重试', async () => {
  const harness = createHarness({ autoAck: false });
  await waitFor(() => harness.handshakes.length >= 2, 500);
  const count = harness.handshakes.length;
  harness.stop();
  await sleep(120);
  assert.equal(harness.handshakes.length, count);
});

test('接收端关闭后 applyPayload 不抛错，也不再投递新 payload', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const deliveredCount = harness.delivered.length;
  harness.runtimePort?.close();
  assert.doesNotThrow(() => {
    harness.listener?.({ action: 'applyPayload', payload: { hostname: 'child.localhost', domain: 'child.localhost', languageConfig: { language: 'fr-FR' } } });
  });
  await sleep(10);
  assert.equal(harness.delivered.length, deliveredCount);
  assert.equal(harness.delivered.at(-1)?.payload.languageConfig.language, 'en-US');
});

test('端口就绪前的 clear 先挂起，端口就绪后补发 clear', async () => {
  const harness = createHarness({ autoAck: false });
  await waitFor(() => harness.handshakes.length === 1);
  harness.setResponse({ status: 'ok', matched: false, payload: null });
  harness.listener?.({ action: 'applyPayload', clear: true });
  await waitFor(() => harness.pulls.length >= 1);
  assert.equal(harness.delivered.length, 0);
  harness.sendAck();
  await waitFor(() => harness.delivered.some((message) => message.payload?.clear === true));
});

test('发送端 postMessage 同步异常不向 applyPayload 调用方传播', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const original = MessagePort.prototype.postMessage;
  let attempts = 0;
  MessagePort.prototype.postMessage = () => {
    attempts += 1;
    throw new Error('port closed');
  };
  try {
    assert.doesNotThrow(() => {
      harness.listener?.({ action: 'applyPayload', payload: { hostname: 'child.localhost', domain: 'child.localhost' } });
    });
  } finally {
    MessagePort.prototype.postMessage = original;
  }
  assert.equal(attempts, 1, '必须实际触发发送异常，不能只验证提前返回');
});

test('重复创建同一 window 时第二个实例直接 no-op', () => {
  const harness = createHarness();
  const second = createContentBridge({
    window: harness.window,
    document: { referrer: PARENT_REFERRER },
    chrome: harness.chrome,
    nonce: NONCE
  });
  assert.doesNotThrow(() => second.stop());
});

test('响应 payload 的 hostname 不匹配时丢弃，不交给 runtime', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.delivered.length;
  harness.setResponse({
    status: 'ok',
    matched: true,
    payload: { hostname: 'parent.localhost', domain: 'parent.localhost' }
  });
  harness.listener?.({ action: 'applyPayload', payload: { hostname: 'parent.localhost' } });
  await waitFor(() => harness.pulls.length >= 2);
  await sleep(20);
  assert.equal(harness.delivered.length, before);
});

test('端口就绪后的非 ack 消息被忽略，不再触发第二次握手', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const handshakes = harness.handshakes.length;
  harness.runtimePort?.postMessage({ __vanishGeo: NONCE, kind: 'other' });
  await sleep(80);
  assert.equal(harness.handshakes.length, handshakes);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'child.localhost');
});

test('同一 tick 的多次 clear 只安排一次重拉', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;
  harness.listener?.({ action: 'applyPayload', clear: true });
  harness.listener?.({ action: 'applyPayload', clear: true });
  await waitFor(() => harness.pulls.length > before);
  await sleep(20);
  assert.equal(harness.pulls.length, before + 1);
});

test('无 timer / 无端口时 stop 也能安全退出', () => {
  const harness = createHarness({ autoAck: false });
  assert.doesNotThrow(() => harness.stop());
});

test('后台广播里的无关消息直接忽略，不触发重拉', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;
  assert.doesNotThrow(() => {
    harness.listener?.(null);
    harness.listener?.({ action: 'somethingElse' });
    harness.listener?.({ action: 'applyPayload', payload: 42 });
  });
  await sleep(30);
  assert.equal(harness.pulls.length, before + 1, '只有无效 payload 的那条触发一次重拉');
});

test('opaque frame 采用可信 runtime effectiveUrl 校验 payload，忽略不同的本地 referrer 和 MAIN 自报域', async () => {
  const harness = createHarness({ href: 'about:srcdoc', referrer: PARENT_REFERRER });
  harness.setResponse({
    status: 'ok', matched: true, effectiveUrl: 'https://proven.example/frame',
    payload: { hostname: 'proven.example', domain: 'proven.example' }
  });
  await waitFor(() => harness.delivered.length > 0);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'proven.example');

  const before = harness.delivered.length;
  harness.runtimePort?.postMessage({ __vanishGeo: NONCE, kind: 'other', effectiveUrl: 'https://attacker.example/' });
  harness.listener?.({ action: 'applyPayload', effectiveUrl: 'https://attacker.example/', payload: { hostname: 'attacker.example' } });
  await waitFor(() => harness.pulls.length >= 2);
  await sleep(20);
  assert.equal(harness.delivered.some((entry) => entry.payload?.hostname === 'attacker.example'), false);
  assert.equal(harness.delivered.length, before + 1);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'proven.example');
});

test('可信 effectiveUrl 仍须与响应 payload hostname 精确一致，旧 referrer 命中不能绕过', async () => {
  const harness = createHarness({ href: 'about:blank', referrer: PARENT_REFERRER });
  harness.setResponse({
    status: 'ok', matched: true, effectiveUrl: 'https://proven.example/frame',
    payload: { hostname: 'parent.localhost', domain: 'parent.localhost' }
  });
  await waitFor(() => harness.pulls.length === 1);
  await sleep(20);
  assert.deepEqual(harness.delivered, []);
});

test('父链暂不可用的 error 响应保留首屏重试，恢复后按可信 effectiveUrl 应用且不提前 clear', async () => {
  const harness = createHarness({ href: 'data:text/html,hello', referrer: '', retryDelays: [30, 30] });
  harness.setResponse({ status: 'error', message: 'document chain unavailable' });
  await waitFor(() => harness.pulls.length === 1);
  await sleep(10);
  assert.equal(harness.delivered.length, 0);
  harness.setResponse({
    status: 'ok', matched: true, effectiveUrl: 'https://proven.example/',
    payload: { hostname: 'proven.example' }
  });
  await waitFor(() => harness.delivered.length > 0);
  assert.equal(harness.pulls.length, 2);
  assert.equal(harness.delivered.some((entry) => entry.payload?.clear === true), false);
  assert.equal(harness.delivered.at(-1)?.payload.hostname, 'proven.example');
});

test('文档定向重拉信号只请求自己的规则，不采用消息里的 payload', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.pulls.length;
  harness.listener?.({ action: 'refreshPayload', payload: { hostname: 'foreign.example' } });
  await waitFor(() => harness.pulls.length > before);
  assert.equal(harness.pulls.at(-1), CHILD_URL);
  assert.equal(harness.delivered.some((entry) => entry.payload?.hostname === 'foreign.example'), false);
});

test('总开关关闭立即 clear，并忽略关闭前尚未返回的配置', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  let pending: ((response: any) => void) | undefined;
  harness.chrome.runtime.sendMessage = ((_message: any, callback?: (response: any) => void) => { pending = callback; }) as any;
  harness.listener?.({ action: 'refreshPayload' });
  await waitFor(() => Boolean(pending));
  harness.listener?.({ action: 'applyPayload', clear: true, globalDisabled: true });
  pending!({ status: 'ok', matched: true, payload: { hostname: 'child.localhost' } });
  await waitFor(() => harness.delivered.at(-1)?.payload?.clear === true);
  await sleep(20);
  assert.equal(harness.delivered.at(-1)?.payload.clear, true);
});


test('blob 父读取只接受本扩展 runtime 查询，未握手时也同步响应且不拉取配置', () => {
  const harness = createHarness({ autoAck: false, href: 'blob:https://parent.example/document', referrer: 'https://forged.example/' });
  const parent = { location: { href: 'https://parent.example/current' } };
  (parent as any).parent = parent;
  (harness.window as any).parent = parent;
  const responses: any[] = [];
  harness.listener?.({ action: 'readBlobParent', url: 'https://forged.example/', parentUrl: 'https://forged.example/' },
    { id: 'test-extension' }, (result: any) => responses.push(result));
  assert.deepEqual(responses, [{ url: 'blob:https://parent.example/document', parentUrl: 'https://parent.example/current' }]);
  assert.deepEqual(harness.requests, []);
  for (const sender of [undefined, {}, { id: 'other-extension' }]) {
    harness.listener?.({ action: 'readBlobParent' }, sender, (result: any) => responses.push(result));
  }
  assert.equal(responses.length, 1);
  assert.equal(harness.handshakes.length, 1, '只读取父位置，不另造 MAIN 握手');
  harness.stop();
});

test('blob 现场查询穿过已知 opaque 祖先，最近 HTTP 父地址每次重读', () => {
  const harness = createHarness({ autoAck: false, href: 'blob:https://parent.example/document' });
  const web: any = { location: { href: 'http://parent.example/before' } };
  web.parent = web;
  let parent = web;
  for (const href of ['about:blank', 'about:srcdoc', 'blob:https://parent.example/parent', 'data:text/html,parent', 'filesystem:https://parent.example/temporary/parent']) {
    parent = { location: { href }, parent };
  }
  (harness.window as any).parent = parent;
  const read = () => {
    let result;
    harness.listener?.({ action: 'readBlobParent' }, { id: 'test-extension' }, (response: any) => { result = response; });
    return result;
  };
  assert.deepEqual(read(), { url: 'blob:https://parent.example/document', parentUrl: 'http://parent.example/before' });
  web.location.href = 'http://parent.example/after';
  assert.deepEqual(read(), { url: 'blob:https://parent.example/document', parentUrl: 'http://parent.example/after' });
  harness.stop();
});

test('blob 现场查询不越过 SOP、未知 scheme、无父窗口，也不为已导航的 HTTP 文档应答父规则', () => {
  const harness = createHarness({ autoAck: false, href: 'blob:https://parent.example/document', referrer: 'https://forged.example/' });
  const top: any = { location: { href: 'https://forged.example/' } };
  top.parent = top;
  const blocked: any = { parent: top };
  Object.defineProperty(blocked, 'location', { get() { throw new DOMException('native SOP denial', 'SecurityError'); } });
  const read = () => {
    let result: any;
    harness.listener?.({ action: 'readBlobParent' }, { id: 'test-extension' }, (response: any) => { result = response; });
    return result;
  };
  for (const parent of [blocked, ...['file:///tmp/parent', 'chrome://settings/', 'about:config'].map(href => ({ location: { href }, parent: top })), harness.window]) {
    (harness.window as any).parent = parent;
    const response = read();
    assert.equal(response.status, 'error');
    assert.equal(response.parentUrl, undefined);
    assert.ok(response.message);
  }
  harness.window.location.href = 'https://parent.example/new-document';
  (harness.window as any).parent = top;
  assert.match(read().message, /not blob/);
  assert.deepEqual(harness.requests, []);
  harness.stop();
});


test('opaqueOnly 无配置提示只让支持的不透明文档重拉，HTTP 与未知协议忽略', async () => {
  for (const href of ['blob:https://parent.example/doc', 'data:text/html,private', 'about:blank', 'about:srcdoc', 'filesystem:https://parent.example/temporary/doc', 'https://child.localhost/web', 'file:///tmp/page', 'about:config']) {
    const harness = createHarness({ href });
    await waitFor(() => harness.pulls.length === 1);
    const opaque = /^(blob:|data:|filesystem:|about:blank$|about:srcdoc$)/.test(href);
    harness.listener?.({ action: 'refreshPayload', opaqueOnly: true });
    if (opaque) await waitFor(() => harness.pulls.length === 2);
    else { await sleep(10); assert.equal(harness.pulls.length, 1); }
    assert.ok(harness.requests.every(request => request.action === 'getPayloadForUrl'));
    harness.stop();
  }
});


test('文档私有凭证同步存储后才ACK，只向本扩展runtime读取且绝不进入MAIN端口', async () => {
  const harness = createHarness({ autoAck: false, href: 'data:text/html,doc' });
  const receipt = { body: 'signed browser facts', mac: '00'.repeat(32) };
  const sender = { id: 'test-extension' };
  const query = (message: any, from: any = sender) => {
    let response: any;
    harness.listener?.(message, from, (value: any) => { response = value; });
    return response;
  };
  assert.deepEqual(query({ action: 'readFrameEvidence' }), { frameEvidence: null });
  for (const from of [{}, { id: 'other-extension' }]) {
    assert.equal(query({ action: 'storeFrameEvidence', frameEvidence: receipt }, from), undefined);
  }
  assert.deepEqual(query({ action: 'readFrameEvidence' }), { frameEvidence: null });
  assert.deepEqual(query({ action: 'storeFrameEvidence', frameEvidence: receipt }), { stored: true });
  assert.deepEqual(query({ action: 'readFrameEvidence' }), { frameEvidence: receipt });
  assert.deepEqual(harness.requests, []);
  assert.deepEqual(harness.delivered, []);
  harness.stop();
  assert.deepEqual(query({ action: 'readFrameEvidence' }), { frameEvidence: null });
});

test('成功runtime响应的凭证只留在ISOLATED，端口上报不能替换它', async () => {
  const harness = createHarness({ autoAck: false });
  const receipt = { body: 'browser-only receipt', mac: 'ab'.repeat(32) };
  harness.setResponse({ status: 'ok', matched: true, effectiveUrl: CHILD_URL,
    frameEvidence: receipt, payload: { hostname: 'child.localhost', languageConfig: { language: 'en-US' } } });
  harness.sendAck();
  await waitFor(() => harness.delivered.length > 0);
  let read: any;
  const readReceipt = () => {
    harness.listener?.({ action: 'readFrameEvidence' }, { id: 'test-extension' }, (value: any) => { read = value.frameEvidence; });
    return read;
  };
  assert.deepEqual(readReceipt(), receipt);
  assert.ok(harness.delivered.every(message => !JSON.stringify(message).includes('browser-only receipt')));
  harness.runtimePort?.postMessage({ __vanishGeo: NONCE, kind: 'fontLayers', layers: ['canvas'], frameEvidence: { body: 'forged' } });
  await waitFor(() => harness.reports.length > 0);
  assert.deepEqual(readReceipt(), receipt);
  assert.ok(harness.reports.every(message => !('frameEvidence' in message)));
  harness.stop();
});

test('跨clear迟到的成功响应保留文档凭证，但旧payload不能重新应用', async () => {
  const harness = createHarness({ autoAck: false });
  let callback: ((response: any) => void) | undefined;
  harness.chrome.runtime.sendMessage = (message: any, cb?: (response: any) => void) => {
    if (cb) callback = cb;
    return undefined as any;
  };
  harness.sendAck();
  await waitFor(() => Boolean(callback));
  harness.listener?.({ action: 'applyPayload', clear: true, globalDisabled: true });
  await waitFor(() => harness.delivered.at(-1)?.payload.clear === true);
  const receipt = { body: 'late but authenticated document proof', mac: 'cd'.repeat(32) };
  callback?.({ status: 'ok', matched: true, effectiveUrl: CHILD_URL, frameEvidence: receipt,
    payload: { hostname: 'child.localhost', languageConfig: { language: 'fr-FR' } } });
  await sleep(10);
  let stored: any;
  harness.listener?.({ action: 'readFrameEvidence' }, { id: 'test-extension' }, (value: any) => { stored = value.frameEvidence; });
  assert.deepEqual(stored, receipt);
  assert.equal(harness.delivered.at(-1)?.payload.clear, true);
  harness.stop();
});

test('消融反例：拉取响应的异域 hostname 与显式 clear 组合', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const before = harness.delivered.length;
  harness.setResponse({ status: 'ok', matched: true, effectiveUrl: CHILD_URL, payload: { clear: true, hostname: 'parent.localhost' } });
  harness.emit('pageshow', { persisted: true });
  await sleep(60);
  assert.equal(harness.delivered.length, before, '保持原有行为：拉取响应先按本 frame hostname 拒绝');
});
