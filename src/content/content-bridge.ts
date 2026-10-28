import type { FontRuntimePayload, GeolocationPayload, LanguageTimezonePayload } from '../shared/types';

export type LiveRuntimePayloads = { page: LanguageTimezonePayload | null; font: FontRuntimePayload | null; geolocation: GeolocationPayload | null };
type RuntimeApi = {
  id: string;
  sendMessage(message: unknown): Promise<any>;
  onMessage: {
    addListener(listener: (request: any, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined): void;
    removeListener(listener: (request: any, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => boolean | undefined): void;
  };
};

export function createContentBridge(scope: Window & { console: Console }, runtime: RuntimeApi): () => void {
  const nonces = new Map<keyof LiveRuntimePayloads, string>();
  let sequence = 0;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let requested = 0;
  const refresh = () => {
    requested++;
    if (inFlight || stopped) return;
    inFlight = (async () => {
      let completed = 0;
      while (!stopped && completed !== requested) {
        const generation = requested;
        const current = ++sequence;
        try {
          const response = await runtime.sendMessage({ action: 'getLiveRuntimeUpdate' });
          if (stopped) return;
          if (generation === requested) {
            if (response?.status !== 'ok' || !response.payloads) throw new Error('页面更新读取未确认');
            for (const [surface, nonce] of nonces) scope.postMessage({ kind: 'vg-live-update-v1', surface, nonce,
              sequence: current, payloadText: JSON.stringify(response.payloads[surface]) }, scope.location.origin);
          }
        } catch {
          if (!stopped) scope.console.warn('VanishGeo：页面更新通道暂不可用，请完整重载页面。');
        }
        completed = generation;
      }
    })().finally(() => { inFlight = null; });
  };
  const onWindow = (event: MessageEvent) => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    const data = event.data;
    if (data?.kind !== 'vg-live-request-v1' || !['page', 'font', 'geolocation'].includes(data.surface)
      || typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce)) return;
    nonces.set(data.surface, data.nonce);
    refresh();
  };
  const onRuntime = (request: any, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
    if (sender.id !== runtime.id || request?.action !== 'refreshLiveRuntime') return;
    // 立即确认收到通知；pull会重入后台配置队列，不能让保存事务等待它。
    refresh();
    respond({ notified: true });
    return false;
  };
  const stop = () => {
    stopped = true; sequence++;
    scope.removeEventListener('message', onWindow);
    scope.removeEventListener('pagehide', onHide);
    runtime.onMessage.removeListener(onRuntime);
    nonces.clear();
  };
  const onHide = (event: PageTransitionEvent) => { if (!event.persisted) stop(); };
  scope.addEventListener('message', onWindow);
  scope.addEventListener('pagehide', onHide);
  runtime.onMessage.addListener(onRuntime);
  scope.postMessage({ kind: 'vg-live-ready-v1' }, scope.location.origin);
  return stop;
}
