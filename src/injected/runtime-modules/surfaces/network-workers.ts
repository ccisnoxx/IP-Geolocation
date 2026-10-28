import type { LanguageTimezonePayload } from '../../../shared/types';
import type { RuntimeGlobals, RuntimeState } from '../types';
import { defineRuntimeProperty, replaceMethod } from '../registry';

// HTTP入口按release采用Blob启动；入口CSP、全局相对URL和跨页Shared身份不等价于原生。
// 不重试原生构造，不创建额外Worker探测，不把策略拒绝转换成绕过路径。
export function installNetworkWorkers(root: RuntimeGlobals, state: RuntimeState, payload: LanguageTimezonePayload,
  bootstrap: (payload: LanguageTimezonePayload, sourceURL?: string, classic?: boolean) => void): void {
  if ((!payload.language && !payload.timezone && !payload.blockedFonts?.length) || !root.URL?.createObjectURL) return;
  const apply = state.originals.reflectApply;
  const construct = root.Reflect.construct;
  const URLCtor = root.URL;
  const create = state.blobWorkerRegistry?.createURL || URLCtor.createObjectURL;
  const revoke = state.blobWorkerRegistry?.revokeURL || URLCtor.revokeObjectURL;
  const sharedEntries = new Map<string, { url: string; urls: string[] }>();
  const cleanup = (urls: string[]) => { for (const url of urls) apply(revoke, URLCtor, [url]); };
  state.cleanup.push(() => { for (const entry of sharedEntries.values()) cleanup(entry.urls); sharedEntries.clear(); });
  const XHR = root.XMLHttpRequest;
  const open = XHR?.prototype.open;
  const send = XHR?.prototype.send;
  const status = XHR && state.originals.objectGetOwnPropertyDescriptor(XHR.prototype, 'status')?.get;

  for (const property of ['Worker', 'SharedWorker'] as const) {
    const Native = root[property];
    if (typeof Native !== 'function') continue;
    const shared = property === 'SharedWorker';
    const wrapper = new root.Proxy(Native, {
      construct(target: Function, args: unknown[], newTarget: Function) {
        if (!args.length || root.trustedTypes?.isScriptURL(args[0])) return construct(target, args, newTarget);
        const text = `${args[0]}`;
        let source: URL;
        try { source = new URLCtor(text, root.document?.baseURI || state.workerSourceURL || root.location.href); }
        catch { return construct(target, [text, ...args.slice(1)], newTarget); }
        const base = new URLCtor(root.location.href);
        // 嵌套HTTP Worker的父级location是blob，origin仍是创建页面的真实origin。
        const http = /^https?:$/.test(source.protocol) && source.origin === base.origin;
        const owned = shared && source.protocol === 'blob:' ? state.blobWorkerRegistry?.owned.get(source.href) : undefined;
        if (!http && !owned) return construct(target, [text, ...args.slice(1)], newTarget);
        const input = args[1] as WorkerOptions | string | null | undefined;
        if (!shared && input != null && typeof input !== 'object' && typeof input !== 'function') {
          return construct(target, [text, ...args.slice(1)], newTarget);
        }
        // 扩展寿命选项不在Chrome138合同内；整次保持原生，不能提前复制Blob后再读取其getter。
        if (shared && input != null && (typeof input === 'object' || typeof input === 'function') && 'extendedLifetime' in input) {
          root.console.warn('VanishGeo：带extendedLifetime的SharedWorker保持原生，未同步快照。');
          return construct(target, [text, input], newTarget);
        }
        let credentials = 'same-origin', name = '', type = 'classic';
        if (shared && input != null && typeof input !== 'object' && typeof input !== 'function') name = `${input}`;
        else if (input != null) {
          const dictionary = input as WorkerOptions;
          const value = dictionary.credentials;
          credentials = value === undefined ? 'same-origin' : `${value}`;
          if (!['omit', 'same-origin', 'include'].includes(credentials)) return construct(target, [text, { credentials }], newTarget);
          const rawName = dictionary.name; name = rawName === undefined ? '' : `${rawName}`;
          const rawType = dictionary.type; type = rawType === undefined ? 'classic' : `${rawType}`;
        }
        const options = { credentials, name, type };
        if (!['classic', 'module'].includes(type)) return construct(target, [text, options], newTarget);
        // 原生在WebIDL字典转换后解析相对URL；getter可能改写base元素。
        source = new URLCtor(text, root.document?.baseURI || state.workerSourceURL || root.location.href);
        if (!/^https?:$/.test(source.protocol) && !owned || /^https?:$/.test(source.protocol) && source.origin !== base.origin) return construct(target, [text, options], newTarget);
        const key = JSON.stringify([source.href, credentials, name, type]);
        const cached = sharedEntries.get(key);
        if (shared && cached) return construct(target, [cached.url, options], newTarget);
        if (owned) {
          // 与Dedicated Blob路径相同：getter可重入撤销，私有Map不是存活事实来源。
          if (!state.blobWorkerRegistry?.owned.has(source.href)) return construct(target, [text, options], newTarget);
          try {
            const request = new XHR(); apply(open!, request, ['GET', source.href, false]); apply(send!, request, []);
            if (apply(status!, request, []) !== 200) throw new Error('blob-unavailable');
          } catch {
            root.console.warn('VanishGeo：SharedWorker Blob源无法核验，保持原生加载。');
            return construct(target, [text, options], newTarget);
          }
        }
        const urls: string[] = [];
        const makeURL = (blob: Blob) => { const url = apply(create, URLCtor, [blob]); urls.push(url); return url; };
        try {
          const business = owned ? makeURL(owned) : source.href;
          const patch = `;(${bootstrap.toString()})(${JSON.stringify(payload)},${JSON.stringify(http ? source.href : undefined)},${type === 'classic'});`;
          // 静态module依赖保持原生消息启动顺序与TLA；补丁module先执行，业务相对import仍以原入口为基准。
          const body = type === 'module'
            ? `import ${JSON.stringify(makeURL(new root.Blob([patch, shared ? "" : ";URL.revokeObjectURL(import.meta.url);"], { type: 'text/javascript' })))};\nimport ${JSON.stringify(business)};`
            : `${patch}\nimportScripts(${JSON.stringify(business)});`;
          const url = makeURL(new root.Blob([body], { type: 'text/javascript' }));
          const worker = construct(target, [url, options], newTarget);
          if (shared) sharedEntries.set(key, { url, urls });
          else {
            // Worker构造捕获入口，依赖URL在error/terminate清理；prelude启动后自行回收。
            const finish = () => cleanup(urls);
            state.blobWorkerRegistry?.pending.set(worker, finish);
            apply(root.EventTarget.prototype.addEventListener, worker, ['error', finish, { once: true, capture: true }]);
            apply(revoke, URLCtor, [url]);
          }
          return worker;
        } catch (error) { cleanup(urls); throw error; }
      }
    });
    defineRuntimeProperty(root, state, root, property, { ...state.originals.objectGetOwnPropertyDescriptor(root, property), value: wrapper });
    replaceMethod(root, state, Native.prototype, 'constructor', wrapper);
  }
}
