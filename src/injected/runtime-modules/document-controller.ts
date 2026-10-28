import { createRuntimeState, disposeRuntimeState } from './registry';
import type { RuntimeGlobals, RuntimeState } from './types';

export function createDocumentController<T>(root: RuntimeGlobals, install: (state: RuntimeState, payload: T) => void) {
  let current: RuntimeState | null = null;
  let serialized: string | undefined;
  let blobRegistry: RuntimeState['blobWorkerRegistry'];
  let geolocationObjects: RuntimeState['geolocationObjects'];
  const clear = (exiting = false) => {
    const previous = current;
    current = null;
    if (previous) {
      previous.documentExiting = exiting;
      blobRegistry = previous.blobWorkerRegistry;
      geolocationObjects = previous.geolocationObjects;
      disposeRuntimeState(root, previous);
    }
  };
  return {
    update(payload: T | null) {
      const next = JSON.stringify(payload);
      if (next === serialized) return;
      serialized = undefined;
      clear();
      if (payload !== null) {
        const state = createRuntimeState(root);
        state.blobWorkerRegistry = blobRegistry;
        state.geolocationObjects = geolocationObjects;
        current = state;
        try { install(state, payload); }
        catch (error) { clear(); throw error; }
      }
      serialized = next;
    },
    dispose: () => clear(true)
  };
}

// nonce只路由当前文档的本地更新，不是身份凭据。页面消息不进入扩展配置/权限决策。
export function mountDocumentUpdates<T>(root: RuntimeGlobals, surface: 'page' | 'font' | 'geolocation',
  controller: { update(payload: T | null): void; dispose(): void }, parse: (value: unknown) => T | null): void {
  if (typeof root.postMessage !== 'function' || typeof root.addEventListener !== 'function' || !root.crypto?.getRandomValues) return;
  const bytes = new root.Uint8Array(16);
  root.crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes as Uint8Array, value => value.toString(16).padStart(2, '0')).join('');
  const origin = root.origin;
  const post = root.postMessage.bind(root);
  const add = root.addEventListener.bind(root);
  const remove = root.removeEventListener.bind(root);
  let sequence = -1;
  const request = () => post({ kind: 'vg-live-request-v1', nonce, surface }, origin);
  const receive = (event: MessageEvent) => {
    if ((event.source as unknown) !== root || event.origin !== origin) return;
    const data = event.data;
    if (data?.kind === 'vg-live-ready-v1') { request(); return; }
    if (data?.kind !== 'vg-live-update-v1' || data.nonce !== nonce || data.surface !== surface
      || !Number.isSafeInteger(data.sequence) || data.sequence <= sequence || typeof data.payloadText !== 'string') return;
    try {
      const payload = parse(JSON.parse(data.payloadText));
      controller.update(payload);
      sequence = data.sequence;
    } catch {
      root.console.warn('VanishGeo：页面实时更新未完成，请完整重载页面。');
    }
  };
  const shown = () => request();
  const hidden = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    remove('message', receive); remove('pageshow', shown); remove('pagehide', hidden);
    controller.dispose();
  };
  add('message', receive); add('pageshow', shown); add('pagehide', hidden);
  request();
}
