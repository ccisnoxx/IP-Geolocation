import type { RuntimePayload, AntiDetectionState, WorkerPatchConfig } from '../types';
import { registerFunctionSource, nativeSourceFor, defineRegisteredProperty } from '../registry';
import { normalizeTimezonePayload } from '../payload';

export function buildWorkerPatchSource(payload: RuntimePayload, documentStateKey: string, workerBootstrap: (config: WorkerPatchConfig) => void): string {
  const config = payload.languageConfig?.enabled ? payload.languageConfig : null;
  const language = config?.language || null;
  const patchConfig = {
    stateKey: `${documentStateKey}:worker`,
    intlMode: payload.intlMode === 'compatible' ? 'compatible' : 'strict',
    timezone: normalizeTimezonePayload(payload).timezone,
    language,
    languages: config?.languages?.length ? config.languages : language ? [language] : null
  };
  return `;(${workerBootstrap.toString()})(${JSON.stringify(patchConfig)});`;
}

export function installWorkerHooks(
  globals: typeof globalThis & Record<string, any>,
  realmState: AntiDetectionState,
  patchSource: string
): void {
  if (!patchSource) return;
  // 重复注入更新未来 worker 的补丁，保留已安装代理及现有 SharedWorker 身份。
  realmState.workerPatchSource = patchSource;
  if (realmState.installedSurfaces.has('worker')) return;
  realmState.installedSurfaces.add('worker');

  const urlApi = globals.URL;
  const createObjectURL = urlApi.createObjectURL.bind(urlApi);
  const revokeObjectURL = urlApi.revokeObjectURL.bind(urlApi);
  const construct = globals.Reflect.construct.bind(globals.Reflect);
  globals.addEventListener('pagehide', () => {
    realmState.sharedWorkerUrls.forEach((url) => revokeObjectURL(url));
    realmState.sharedWorkerUrls.clear();
  });

  const normalizeWorkerOptions = (value: string | WorkerOptions | undefined, shared: boolean): WorkerOptions | undefined => {
    if (value == null) return undefined;
    if (typeof value !== 'object' && typeof value !== 'function') {
      return shared ? { credentials: 'same-origin', name: `${value}`, type: 'classic' } : undefined;
    }
    // 按 WorkerOptions 的 WebIDL 字典顺序，只读取/转换一次已支持的成员。
    const rawCredentials = value.credentials;
    const credentials = rawCredentials === undefined ? 'same-origin' : `${rawCredentials}`;
    // 非法枚举仍由原生拒绝，且不得提前读取后续成员。
    if (!['omit', 'same-origin', 'include'].includes(credentials)) return { credentials, name: '', type: 'classic' } as WorkerOptions;
    const rawName = value.name;
    const name = rawName === undefined ? '' : `${rawName}`;
    const rawType = value.type;
    const type = rawType === undefined ? 'classic' : `${rawType}`;
    const snapshot = { credentials, name, type } as WorkerOptions;
    // 新浏览器的额外选项由原生读取；不在旧浏览器主动读取未知成员。
    globals.Object.defineProperty(snapshot, 'extendedLifetime', {
      get: () => (value as WorkerOptions & { extendedLifetime?: boolean }).extendedLifetime
    });
    return snapshot;
  };

  const prepareWorkerUrl = (sourceUrl: URL, options: WorkerOptions | undefined, shared: boolean) => {
    const type = options?.type ?? 'classic';
    const name = options?.name ?? '';
    const credentials = options?.credentials ?? 'same-origin';
    const currentPatch = realmState.workerPatchSource;
    const key = JSON.stringify([sourceUrl.href, type, name, credentials, currentPatch]);
    const cached = shared ? realmState.sharedWorkerUrls.get(key) : undefined;
    if (cached) return { url: cached, key, created: false };
    const moduleImport = `await import(${JSON.stringify(sourceUrl.href)});`;
    const body = type === 'module'
      ? shared
        // Chrome 可能在动态模块图完成前投递初始 connect；保留端口至业务监听器就绪。
        ? `${currentPatch}
const connections = [];
let replaying = false;
const schedule = self.setTimeout.bind(self);
const dispatch = self.dispatchEvent.bind(self);
const ConnectEvent = self.MessageEvent;
const collect = event => { if (!replaying) { event.stopImmediatePropagation(); connections.push(event); } };
self.addEventListener("connect", collect, true);
try { ${moduleImport} } catch (error) { self.removeEventListener("connect", collect, true); connections.length = 0; throw error; }
const deliver = () => {
  const event = connections.shift();
  if (!event) { self.removeEventListener("connect", collect, true); return; }
  replaying = true;
  try { dispatch(new ConnectEvent("connect", { data: event.data, origin: event.origin, lastEventId: event.lastEventId, source: event.source, ports: event.ports })); }
  finally { replaying = false; schedule(deliver, 0); }
};
schedule(deliver, 0);`
        : `${currentPatch}\n${moduleImport}`
      : `${currentPatch}\nimportScripts(${JSON.stringify(sourceUrl.href)});`;
    const url = createObjectURL(new globals.Blob([body], { type: 'text/javascript' }));
    if (shared) realmState.sharedWorkerUrls.set(key, url);
    return { url, key, created: true };
  };

  const installConstructor = (property: 'Worker' | 'SharedWorker') => {
    const NativeConstructor = globals[property];
    if (typeof NativeConstructor !== 'function') return;
    const shared = property === 'SharedWorker';
    const nativeDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals, property);
    const wrapper = new globals.Proxy(NativeConstructor, {
      construct(target: Function, args: [string | URL, (string | WorkerOptions)?], newTarget: Function) {
        // 跨源/非 HTTP(S) 交给原生；不要为不包装的调用额外读取 options。
        let sourceUrl: URL;
        try {
          sourceUrl = new urlApi(String(args[0]), globals.location?.href || location.href);
        } catch {
          return construct(target, args, newTarget);
        }
        const pageUrl = new urlApi(globals.location?.href || location.href);
        if (!/^https?:$/.test(sourceUrl.protocol) || sourceUrl.origin !== pageUrl.origin) return construct(target, args, newTarget);
        if (!shared && args[1] != null && typeof args[1] !== 'object' && typeof args[1] !== 'function') return construct(target, args, newTarget);
        const options = normalizeWorkerOptions(args[1], shared);
        const nativeArgs = [args[0], options];
        let entry: ReturnType<typeof prepareWorkerUrl> | null = null;
        try {
          entry = prepareWorkerUrl(sourceUrl, options, shared);
        } catch {
          // Blob 创建失败时，由原生路径给出最终结果；options getter 不重读。
          return construct(target, nativeArgs, newTarget);
        }
        if (!entry) return construct(target, nativeArgs, newTarget);
        let succeeded = false;
        try {
          const worker = construct(target, [entry.url, options], newTarget);
          succeeded = true;
          return worker;
        } catch {
          return construct(target, nativeArgs, newTarget);
        } finally {
          if (!shared || (!succeeded && entry.created)) {
            if (shared) realmState.sharedWorkerUrls.delete(entry.key);
            // Dedicated 构造器返回后已捕获 Blob；Shared URL 必须留给后续连接。
            revokeObjectURL(entry.url);
          }
        }
      }
    });
    registerFunctionSource(realmState, wrapper, nativeSourceFor(realmState, NativeConstructor));
    defineRegisteredProperty(globals, realmState, globals, property, {
      ...nativeDescriptor,
      value: wrapper
    }, 'worker', nativeDescriptor);
  };
  installConstructor('Worker');
  installConstructor('SharedWorker');
}
