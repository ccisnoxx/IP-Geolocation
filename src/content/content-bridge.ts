import { resolvePayloadHostname, resolvePayloadUrl } from '../shared/frame-url';

/**
 * runtime（MAIN）与桥（ISOLATED）握手用的 window 事件名，runtime.ts 里有同值常量。
 * 两个入口都是经典脚本，共享模块会被拆成带 import 的公共 chunk，所以各写一份，
 * 由 tests/extension-wiring.test.ts 校验两份产物一致。事件名随发行包公开，
 * 安全性不依赖它保密，只依赖 document_start 同步派发的时机。
 */
export const BRIDGE_EVENT = 'vanishgeo:bridge';

/** 后台 frame-receipts.ts 校验凭证身份失败时的错误文案；content.js 不能 import 后台模块，由测试校验一致 */
export const STALE_FRAME_EVIDENCE_ERROR = 'invalid frame evidence identity';

/**
 * ISOLATED world 桥的实现。content.ts 只负责读构建期常量并调用这里，
 * 这样桥的 frame 归属 / payload 校验 / 重拉逻辑可以在 Node 里直接单测。
 */
export interface ContentBridgeEnvironment {
  window: any;
  document: { referrer: string };
  chrome: any;
  nonce: string;
  /** 测试用：覆盖冷启动重试间隔；生产默认覆盖约 48 秒 */
  retryDelays?: number[];
}

export interface ContentBridgeHandle {
  /** 测试/热重载用：关端口、停重试与合并重拉定时器 */
  stop(): void;
}

export function createContentBridge(environment: ContentBridgeEnvironment): ContentBridgeHandle {

  const NONCE = environment.nonce;

  // isolated world 的 window 与页面不共享，所以这里的标记页面上看不见
  const scope = environment.window as Record<symbol, boolean>;
  const guard = Symbol.for('vanishgeo.bridge');
  if (scope[guard]) return { stop() { /* already running */ } };
  scope[guard] = true;

  let port: MessagePort | null = null;
  /** 仅 runtime 后台交付；不进入 MAIN，也不由端口输入更新。 */
  let frameEvidence: unknown = null;
  /** 端口还没就绪时暂存最后一份 payload，就绪后补发 */
  let pendingPayload: unknown = null;
  /**
   * 后台给的用户脚本认领口令（见 background/user-scripts.ts），随每条 payload 交给注入层：
   * 内容脚本那份注入层据此判断同一文档里的用户脚本那份是否真的在，决定休眠转发还是自己应用。
   * 只取自扩展后台的响应 / 消息，不经页面。
   */
  let userScriptToken: string | null = null;
  const rememberToken = (source: any): void => {
    if (source && typeof source.userScriptToken === 'string' && source.userScriptToken) userScriptToken = source.userScriptToken;
  };

  /**
   * 保留给旧后台的地址提示；当前后台只采用浏览器 sender URL 和可证明的父文档链。
   * 本地 referrer 可能不同于后台采用的最近 HTTP(S) 父文档，不能用于后台授权。
   */
  const payloadUrl = (): string => resolvePayloadUrl(environment.window.location.href, environment.document.referrer);

  /** 仅由可信 runtime 拉取响应更新，MAIN 消息不能修改这项归属参考。 */
  let effectiveHostname: string | undefined;
  const frameHostname = (): string => effectiveHostname ?? resolvePayloadHostname(environment.window.location.href, environment.document.referrer)
    .toLowerCase()
    .replace(/\.+$/, '');

  /**
   * payload 是不是按当前 frame 解析的。
   *
   * `tabs.sendMessage(tabId, ...)` 默认发给所有 frame，而 payload 是按**顶层标签页**
   * 的 URL 算的。父页 `example.com`、iframe `child.example.com` 各自有规则时，
   * 子框架会先收到父页 payload；只比对 `payload.domain` 不够（父规则也是子域的后缀），
   * 必须比对解析时的精确 hostname。没有 hostname 的旧 payload 保持兼容。
   */
  const payloadForThisFrame = (payload: any): boolean => {
    if (!payload || typeof payload !== 'object') return false;
    const target = typeof payload.hostname === 'string' ? payload.hostname.toLowerCase() : '';
    if (!target) return true;
    return target === frameHostname();
  };

  let pullSeq = 0;
  let pullTimer: ReturnType<typeof setTimeout> | null = null;
  let pullRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 收到 clear 后如果后台一直叫不醒，最终必须自己 clear；否则排除站点/关总开关
   * 会停留在烘焙值。普通首屏拉取失败不能 clear（可能只是 SW 冷启动慢），只重试。
   */
  let pendingClear = false;
  const PULL_RETRY = environment.retryDelays && environment.retryDelays.length
    ? environment.retryDelays
    : [40, 120, 300, 700, 1500, 3000, 6000, 12000, 24000];

  /** 合并同一轮里的多次重拉（父页 payload + clear 可能连续到达） */
  const requestPull = (clear = false): void => {
    if (clear) pendingClear = true;
    if (pullTimer) return;
    pullTimer = setTimeout(() => {
      pullTimer = null;
      pullPayload();
    }, 0);
  };

  // 后台说"这个站点现在不该有伪装"时下发的指令。runtime 收到后逐项还原原型/构造器。
  const CLEAR_PAYLOAD = { clear: true } as const;

  const deliver = (payload: unknown): boolean => {
    if (!payload) return false;
    if ((payload as any).clear !== true && !payloadForThisFrame(payload)) return false;
    if (!port) {
      pendingPayload = payload;
      return true;
    }
    try {
      port.postMessage({ __vanishGeo: NONCE, payload, userScriptToken });
      return true;
    } catch {
      return false;
    }
  };

  const clearPullRetry = (): void => {
    if (pullRetryTimer) clearTimeout(pullRetryTimer);
    pullRetryTimer = null;
  };

  const pullPayload = (attempt = 0): void => {
    // Service Worker 可能正在冷启动，这时候 sendMessage 会报 "Receiving end does not exist"。
    // 退避重试到约 48 秒（覆盖 SW 安装/唤醒），仍失败且此前收到过 clear 时
    // 主动下发 clear —— 这是排除站点/关总开关的最后兜底。
    clearPullRetry();
    const seq = ++pullSeq;
    environment.chrome.runtime.sendMessage({ action: 'getPayloadForUrl', url: payloadUrl() }, (response: any) => {
      if (!environment.chrome.runtime.lastError && response?.status === 'ok' && response.frameEvidence) frameEvidence = response.frameEvidence;
      if (!environment.chrome.runtime.lastError && response?.status === 'ok') rememberToken(response);
      // Chrome 119 的 tabs.sendMessage 不按 documentId 隔离（实测会投给同 frame 的新文档）：
      // 已被导航替换的旧文档的 storeFrameEvidence 可能落到这里，留下不属于本文档的凭证，
      // 后台每次读取都按身份不符拒绝，解析失败又不会写入新凭证。丢掉它，重试时后台
      // 改用浏览器快照解析；后台校验不放宽，丢弃最坏只是回到失败关闭。
      if (response?.status === 'error' && response.message === STALE_FRAME_EVIDENCE_ERROR) frameEvidence = null;
      if (seq !== pullSeq) return; // 更新的拉取已经发出，别用旧响应覆盖
      const failed = environment.chrome.runtime.lastError || !response || response.status === 'error';
      if (failed) {
        if (attempt < PULL_RETRY.length) {
          pullRetryTimer = setTimeout(() => pullPayload(attempt + 1), PULL_RETRY[attempt]);
          return;
        }
        if (pendingClear) {
          pendingClear = false;
          deliver(CLEAR_PAYLOAD);
        }
        return;
      }
      pendingClear = false;
      if (typeof response.effectiveUrl === 'string') {
        effectiveHostname = resolvePayloadHostname(response.effectiveUrl, '').toLowerCase().replace(/\.+$/, '');
      }
      // 不匹配也要说话：烘焙构建的静态脚本已经先应用了一遍烘焙值，这里必须
      // 显式 clear，否则排除站点 / 关总开关后页面会一直停在烘焙的时区和语言上。
      if (!response.matched || !response.payload) {
        deliver(CLEAR_PAYLOAD);
        return;
      }
      if (!payloadForThisFrame(response.payload)) return;
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

  /** runtime 的诊断回报：字体层与 Worker 包装失败。只搬运给后台，判定与聚合都在后台。 */
  const onRuntimeReport = (event: MessageEvent): void => {
    const data: any = event.data;
    if (!data || data.__vanishGeo !== NONCE) return;
    if (data.kind === 'fontLayers') {
      environment.chrome.runtime.sendMessage({ action: 'reportFontLayers', url: payloadUrl(), layers: data.layers })
        ?.catch(() => undefined);
      return;
    }
    if (data.kind === 'workerFallback') {
      environment.chrome.runtime.sendMessage({
        action: 'reportWorkerFallback',
        url: payloadUrl(),
        reason: data.reason,
        script: data.script,
        message: data.message
      })?.catch(() => undefined);
    }
  };

  /**
   * 同步握手。桥在 document_start 先于 runtime 执行（动态注册时 Chrome 先跑 ISOLATED；
   * 静态清单按声明顺序，构建时把桥排在前面），在这里挂好监听；runtime 随后同步派发
   * 携带私有端口的 BRIDGE_EVENT，此时页面还没有任何脚本执行过，端口不经过页面可见的
   * 通道。preventDefault 是给 runtime 的同步回执，未回执时 runtime 关掉端口只留烘焙值。
   *
   * 只收第一个端口。剩余边界：runtime 缺席的文档里这个监听会一直挂着，页面可以塞进
   * 自己的端口，从而读到本 frame 的 payload 并伪造两类诊断回报；它拿不到 runtime 的
   * 控制入口（runtime 不监听任何 window 事件）。
   */
  const onBridgeEvent = (event: any): void => {
    const inbox: MessagePort | undefined = event && event.ports && event.ports[0];
    if (port || !inbox) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    environment.window.removeEventListener(BRIDGE_EVENT, onBridgeEvent, true);
    inbox.onmessage = onRuntimeReport;
    onPortReady(inbox);
  };
  environment.window.addEventListener(BRIDGE_EVENT, onBridgeEvent, true);

  /**
   * BFCache 恢复：内容脚本不会重新注入，payload 也不会自己再来一遍。
   *
   * 页面冻结期间配置可能已经变了（规则开关、时区、排除站点、定位刷新），恢复后它
   * 仍跑旧值，而弹窗照样显示"已生效" —— 这是状态与事实不符，跟静默回退是同一类问题。
   * 所以 persisted 恢复时按本 frame 的规则重拉一次；普通加载的 pageshow
   * （persisted === false）不重拉，首屏拉取已经在跑了。
   */
  const onPageShow = (event: any): void => {
    if (!event || event.persisted !== true) return;
    requestPull();
  };
  try {
    environment.window.addEventListener?.('pageshow', onPageShow);
  } catch { /* 非浏览器环境（测试替身）忽略 */ }

  // 后台推来的增量更新（配置变更、定位刷新）走这里，不再经 window.postMessage。
  // clear 也要先重拉自己的 payload：父页未命中而子域 iframe 命中时，广播 clear
  // 不能把子框架的伪装一起清掉；重拉后按本 frame 的规则决定 apply / clear。
  environment.chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (message?.action === 'readFrameEvidence' || message?.action === 'storeFrameEvidence') {
      if (!environment.chrome.runtime.id || sender?.id !== environment.chrome.runtime.id) return;
      if (message.action === 'storeFrameEvidence') {
        frameEvidence = message.frameEvidence;
        sendResponse({ stored: true });
      } else sendResponse({ frameEvidence });
      return;
    }
    if (message?.action === 'readBlobParent') {
      if (!environment.chrome.runtime.id || sender?.id !== environment.chrome.runtime.id) return;
      // 此查询只走扩展 runtime，不经过 MAIN。同步读取原生父对象；SOP 拒绝时明确失败。
      // 与后台序列化探测保持相同规则，避免跨入口共享模块使经典 content.js 产生 import。
      try {
        let frame = environment.window;
        const url = frame.location.href;
        if (new URL(url).protocol !== 'blob:') throw new Error('target document is not blob');
        while (frame !== frame.parent) {
          frame = frame.parent;
          const parentUrl = new URL(frame.location.href);
          if (/^https?:$/.test(parentUrl.protocol)) { sendResponse({ url, parentUrl: parentUrl.href }); return; }
          if (!['blob:', 'data:', 'filesystem:'].includes(parentUrl.protocol)
            && !(parentUrl.protocol === 'about:' && ['blank', 'srcdoc'].includes(parentUrl.pathname))) break;
        }
        throw new Error('blob document has no accessible HTTP parent');
      } catch (error) {
        sendResponse({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (message?.action === 'refreshPayload') {
      if (message.opaqueOnly === true) {
        const url = new URL(environment.window.location.href);
        if (!['blob:', 'data:', 'filesystem:'].includes(url.protocol)
          && !(url.protocol === 'about:' && ['blank', 'srcdoc'].includes(url.pathname))) return;
      }
      requestPull();
      return;
    }
    if (!message || message.action !== 'applyPayload') return;
    rememberToken(message);
    if (message.clear) {
      // 总开关关闭对所有文档都成立，不依赖此时是否还能查询到父链。
      if (message.globalDisabled === true) {
        ++pullSeq;
        clearPullRetry();
        if (pullTimer) clearTimeout(pullTimer);
        pullTimer = null;
        pendingClear = false;
        deliver(CLEAR_PAYLOAD);
        return;
      }
      requestPull(true);
      return;
    }
    if (!payloadForThisFrame(message.payload)) {
      requestPull();
      return;
    }
    deliver(message.payload);
  });
  return {
    stop(): void {
      try { environment.window.removeEventListener?.('pageshow', onPageShow); } catch { /* ignore */ }
      try { environment.window.removeEventListener?.(BRIDGE_EVENT, onBridgeEvent, true); } catch { /* ignore */ }
      if (pullTimer) clearTimeout(pullTimer);
      pullTimer = null;
      clearPullRetry();
      try { port?.close(); } catch { /* ignore */ }
      port = null;
      pendingPayload = null;
      frameEvidence = null;
    }
  };

}
