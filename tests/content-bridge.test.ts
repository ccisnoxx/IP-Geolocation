import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createContentBridge } from '../src/content/content-bridge';

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

function createHarness(options: { retryDelays?: number[]; autoAck?: boolean; ackDelayMs?: number } = {}) {
  const delivered: any[] = [];
  const pulls: string[] = [];
  const reports: any[] = [];
  const handshakes: any[] = [];
  const ports: MessagePort[] = [];
  let listener: ((message: any) => void) | null = null;
  let runtimePort: MessagePort | null = null;
  let response: any = {
    status: 'ok',
    matched: true,
    payload: { hostname: 'child.localhost', domain: 'child.localhost', languageConfig: { language: 'en-US' } }
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message: any, callback?: (value: any) => void) => {
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
        addListener: (fn: (message: any) => void) => { listener = fn; }
      }
    }
  };

  const window = {
    location: { href: CHILD_URL },
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
    document: { referrer: PARENT_REFERRER },
    chrome,
    nonce: NONCE,
    retryDelays: options.retryDelays
  });

  const harness = {
    delivered,
    pulls,
    reports,
    handshakes,
    window,
    chrome,
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

test('端口 postMessage 抛错时 deliver 不把异常抛给调用方', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  harness.runtimePort?.close();
  assert.doesNotThrow(() => {
    harness.listener?.({ action: 'applyPayload', payload: { hostname: 'child.localhost', domain: 'child.localhost', languageConfig: { language: 'fr-FR' } } });
  });
  await sleep(10);
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

test('MessagePort.postMessage 同步抛错时由 deliver 吞掉', async () => {
  const harness = createHarness();
  await waitFor(() => harness.delivered.length > 0);
  const original = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = () => { throw new Error('port closed'); };
  try {
    assert.doesNotThrow(() => {
      harness.listener?.({ action: 'applyPayload', payload: { hostname: 'child.localhost', domain: 'child.localhost' } });
    });
  } finally {
    MessagePort.prototype.postMessage = original;
  }
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
