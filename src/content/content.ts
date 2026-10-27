/**
 * ISOLATED world 桥：把后台解析好的 payload 送进 MAIN world。
 *
 * 通道模型换过一次，原因值得写下来。
 *
 * 旧做法是 `window.postMessage({ __vanishGeo: NONCE, payload })`：nonce 是构建期
 * 随机值，看起来安全，但页面的 `message` 监听器和我们监听的是**同一个事件**。
 * 页面只要 `window.addEventListener('message', e => e.data)` 就能读到 nonce 和
 * 整份 payload，之后想推什么就推什么 —— 共享秘密一旦上了公开频道就不再是秘密。
 *
 * 现在改成私有端口：
 *
 * 1. content script 在 `document_start` **同步**发出一条握手，携带 `MessagePort`；
 *    此刻页面还没有任何脚本执行，也就没有任何监听器能看到这条消息。
 * 2. MAIN world 的 runtime 早已挂好一次性监听器，收下端口后立刻移除自己的
 *    `message` 监听 —— 之后再没有任何可观测的握手。
 * 3. 后续 payload 全部走端口。端口只有两端持有（runtime 的闭包、这里的闭包），
 *    页面既看不到也拿不到；端口消息还要再校验一次 nonce，即使某个极端路径下
 *    端口被抢走，伪造消息也会被丢弃。
 *
 * persona 构建里 `__VANISHGEO_BRIDGE__` 为 false，这个文件整体空转：
 * 配置已经烘焙进 runtime.js，document_start 同步生效，完全不需要运行时通道。
 */
(function () {
  if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;
  if (typeof __VANISHGEO_NONCE__ !== 'string' || !__VANISHGEO_NONCE__) return;

  const NONCE = __VANISHGEO_NONCE__;

  // isolated world 的 window 与页面不共享，所以这里的标记页面上看不见
  const scope = window as unknown as Record<symbol, boolean>;
  const guard = Symbol.for('vanishgeo.bridge');
  if (scope[guard]) return;
  scope[guard] = true;

  let port: MessagePort | null = null;
  /** 端口还没就绪时暂存最后一份 payload，就绪后补发 */
  let pendingPayload: unknown = null;
  let handshakes = 0;

  const HANDSHAKE_RETRY = [60, 200, 600, 1500, 4000];

  const deliver = (payload: unknown): void => {
    if (!payload) return;
    if (!port) {
      pendingPayload = payload;
      return;
    }
    try {
      port.postMessage({ __vanishGeo: NONCE, payload });
    } catch { /* 端口已关闭 */ }
  };

  const pullPayload = (attempt = 0): void => {
    // Service Worker 可能正在冷启动，这时候 sendMessage 会报 "Receiving end does not exist"。
    // 退避重试几轮，别把这种情况当成"没有配置"。
    chrome.runtime.sendMessage({ action: 'getPayloadForUrl', url: window.location.href }, (response) => {
      const failed = chrome.runtime.lastError || !response || response.status === 'error';
      if (failed) {
        const delays = [40, 120, 300, 700];
        if (attempt < delays.length) setTimeout(() => pullPayload(attempt + 1), delays[attempt]);
        return;
      }
      if (!response.matched || !response.payload) return;
      deliver(response.payload);
    });
  };

  const onPortReady = (inbox: MessagePort): void => {
    port = inbox;
    if (pendingPayload) {
      const payload = pendingPayload;
      pendingPayload = null;
      deliver(payload);
    }
    pullPayload();
  };

  const handshake = (): void => {
    if (port) return;
    handshakes += 1;
    // 旧通道不 close：ack 可能还在队列里。关掉它等于把已经成功的握手扔掉，
    // 而 runtime 收下第一个端口后就不再监听 —— 那样就再也握不上手了。
    const channel = new MessageChannel();
    const inbox = channel.port1;
    inbox.onmessage = (event) => {
      const data: any = event.data;
      // runtime 报上来的"实际生效字体层"：转给后台存一份，诊断页要用。
      // 数字只有 runtime 知道（字表就编在它里面），这里只做搬运。
      //
      // 这一支必须排在 `if (port) return` 前面 —— 握手完成后这个端口就常开了，
      // 回报是在 payload 应用之后才来的，被那句提前返回挡掉过一次。
      if (data && data.__vanishGeo === NONCE && data.kind === 'fontLayers') {
        chrome.runtime.sendMessage({ action: 'reportFontLayers', url: window.location.href, layers: data.layers })
          ?.catch(() => undefined);
        return;
      }
      if (port) return;
      // ack 里带 nonce：确认对面真的是那个 runtime，而不是页面伪造的端口
      if (!data || data.__vanishGeo !== 'ack' || data.nonce !== NONCE) return;
      onPortReady(inbox);
    };
    inbox.start();
    // 同步发出。content script 在 document_start 执行，页面脚本还没跑，
    // 这条消息（和它携带的端口）页面观察不到。
    window.postMessage({ __vanishGeo: 'handshake' }, '*', [channel.port2]);
  };

  handshake();

  const scheduleRetry = (): void => {
    if (port || handshakes > HANDSHAKE_RETRY.length) return;
    // runtime 走动态注入时它比我们晚一步，这里补几次握手。这条路径上页面可能
    // 已经挂好监听器，但端口里的消息仍然需要 nonce，伪造不了。
    setTimeout(() => {
      if (port) return;
      handshake();
      scheduleRetry();
    }, HANDSHAKE_RETRY[handshakes - 1]);
  };
  scheduleRetry();

  // 后台推来的增量更新（配置变更、定位刷新）走这里，不再经 window.postMessage
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.action !== 'applyPayload') return;
    deliver(message.payload);
  });
})();