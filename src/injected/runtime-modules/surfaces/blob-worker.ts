import type { LanguageTimezonePayload } from '../../../shared/types';
import type { RuntimeGlobals, RuntimeState } from '../types';
import { defineRuntimeProperty } from '../registry';

export function installBlobWorker(
  root: RuntimeGlobals,
  state: RuntimeState,
  payload: LanguageTimezonePayload,
  bootstrap: (payload: LanguageTimezonePayload) => void
): void {
  if (!payload.language && !payload.timezone && !payload.blockedFonts?.length || typeof root.Worker !== 'function'
    || typeof root.URL?.createObjectURL !== 'function') return;
  const NativeWorker = root.Worker;
  const NativeURL = root.URL;
  const NativeXHR = root.XMLHttpRequest;
  const xhrOpen = NativeXHR.prototype.open;
  const xhrSend = NativeXHR.prototype.send;
  const xhrStatus = state.originals.objectGetOwnPropertyDescriptor(NativeXHR.prototype, 'status')!.get!;
  const addListener = root.EventTarget.prototype.addEventListener;
  const createURL = root.URL.createObjectURL;
  const revokeURL = root.URL.revokeObjectURL;
  const apply = root.Reflect.apply;
  const construct = root.Reflect.construct;
  const registry = state.blobWorkerRegistry || (state.blobWorkerRegistry = { owned: new Map<string, Blob>(), pending: new WeakMap<Worker, () => void>() });
  registry.createURL = createURL; registry.revokeURL = revokeURL;
  const { owned, pending } = registry;
  const patch = `;(${bootstrap.toString()})(${JSON.stringify(payload)});`;
  const replace = (owner: object, key: string, value: Function) => {
    defineRuntimeProperty(root, state, owner, key, {
      ...state.originals.objectGetOwnPropertyDescriptor(owner, key), value
    });
  };
  replace(root.URL, 'createObjectURL', new root.Proxy(createURL, {
    apply(target: Function, receiver: unknown, args: unknown[]) {
      const url = apply(target, receiver, args);
      // 不跟踪其他 realm、MediaSource 或用户提供的未知 URL。
      if (args[0] instanceof root.Blob) owned.set(url, args[0] as Blob);
      return url;
    }
  }));
  replace(root.URL, 'revokeObjectURL', new root.Proxy(revokeURL, {
    apply(target: Function, receiver: unknown, args: unknown[]) {
      if (!args.length) return apply(target, receiver, args);
      // DOMString 转换一次，避免 String 对象撤销后仍从私有映射复活源。
      const url = `${args[0]}`;
      const result = apply(target, receiver, [url]);
      // 原生撤销会规范化scheme和首尾空白。
      try { owned.delete(new NativeURL(url).href); } catch { /* 非法URL的原生撤销本就无操作。 */ }
      return result;
    }
  }));
  replace(NativeWorker.prototype, 'terminate', new root.Proxy(NativeWorker.prototype.terminate, {
    apply(target: Function, receiver: Worker, args: unknown[]) {
      const result = apply(target, receiver, args);
      pending.get(receiver)?.();
      pending.delete(receiver);
      return result;
    }
  }));
  const workerWrapper = new root.Proxy(NativeWorker, {
    construct(target: Function, args: unknown[], newTarget: Function) {
      if (!args.length || root.trustedTypes?.isScriptURL(args[0])) return construct(target, args, newTarget);
      // 普通URL对象与字符串均执行一次WebIDL转换；TrustedScriptURL保持原生验证路径。
      const scriptURL = `${args[0]}`;
      let sourceURL: string;
      try { sourceURL = new NativeURL(scriptURL).href; }
      catch { return construct(target, [scriptURL, ...args.slice(1)], newTarget); }
      if (!owned.has(sourceURL)) return construct(target, [scriptURL, ...args.slice(1)], newTarget);
      const input = args[1] as WorkerOptions | null | undefined;
      if (input != null && typeof input !== 'object' && typeof input !== 'function') return construct(target, [scriptURL, ...args.slice(1)], newTarget);
      // 与原生 WorkerOptions 相同顺序，读取和转换一次。非法枚举仍由原生报错。
      const rawCredentials = input?.credentials;
      const credentials = rawCredentials === undefined ? 'same-origin' : `${rawCredentials}`;
      if (!['omit', 'same-origin', 'include'].includes(credentials)) return construct(target, [scriptURL, { credentials }], newTarget);
      const rawName = input?.name;
      const name = rawName === undefined ? '' : `${rawName}`;
      const rawType = input?.type;
      const type = rawType === undefined ? 'classic' : `${rawType}`;
      const options = { credentials, name, type };
      if (type !== 'classic' && type !== 'module') return construct(target, [scriptURL, options], newTarget);
      // options getter 可重入撤销 URL；不能复活原生已无法加载的源。
      const blob = owned.get(sourceURL);
      if (!blob) return construct(target, [sourceURL, options], newTarget);
      // 同源其他realm可撤销此URL，Map不是存活事实来源。仅核验已跟踪blob，不访问网络。
      // 同步读取是保留原生构造同步性/立即revoke语义的成本；CSP拒绝时明确未覆盖。
      try {
        const request = new NativeXHR();
        apply(xhrOpen, request, ['GET', sourceURL, false]);
        apply(xhrSend, request, []);
        if (apply(xhrStatus, request, []) !== 200) throw new Error('blob-unavailable');
      } catch {
        root.console.warn('VanishGeo：Blob Worker 源无法核验，本次语言/时区未同步，保持原生加载。');
        return construct(target, [sourceURL, options], newTarget);
      }

      const urls: string[] = [];
      const makeURL = (value: Blob) => {
        const url = apply(createURL, root.URL, [value]);
        urls.push(url);
        return url;
      };
      const cleanup = () => { for (const url of urls) apply(revokeURL, root.URL, [url]); };
      try {
        // 保留私有源副本，页面可在构造后立即撤销自己的 URL。
        const source = makeURL(blob);
        let body: string;
        if (type === 'module') {
          // 静态依赖按序执行：先补丁，再业务模块及其依赖；保留原生模块启动/消息排队。
          const prelude = makeURL(new root.Blob([patch, `\nURL.revokeObjectURL(${JSON.stringify(source)});\nURL.revokeObjectURL(import.meta.url);`], { type: 'text/javascript' }));
          body = `import ${JSON.stringify(prelude)};\nimport ${JSON.stringify(source)};`;
        } else {
          // 独立 Script 保留业务源码的严格模式指令及全局声明语义，不使用 eval/Function。
          body = `${patch}\n(function () { const revoke = URL.revokeObjectURL.bind(URL); try { importScripts(${JSON.stringify(source)}); } finally { revoke(${JSON.stringify(source)}); } })();`;
        }
        const entry = makeURL(new root.Blob([body], { type: 'text/javascript' }));
        const worker = construct(target, [entry, options], newTarget) as Worker;
        pending.set(worker, cleanup);
        apply(addListener, worker, ['error', cleanup, { once: true, capture: true }]);
        // 构造器已捕获入口；源副本由 Worker 启动、错误或 terminate 路径清理。
        apply(revokeURL, root.URL, [entry]);
        return worker;
      } catch (error) {
        cleanup();
        throw error;
      }
    }
  });
  replace(root, 'Worker', workerWrapper);
  replace(NativeWorker.prototype, 'constructor', workerWrapper);
}
