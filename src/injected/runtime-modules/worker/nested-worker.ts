import type { WorkerPatchConfig } from '../types';
import type { WorkerState } from './registry';

export function installNestedWorker(state: WorkerState, patchConfig: WorkerPatchConfig, workerBootstrap: (config: WorkerPatchConfig) => void) {
  const { root, originalFunctionToString, functionSources } = state;
  const patchSource = `;(${workerBootstrap.toString()})(${JSON.stringify(patchConfig)});`;
  const makeWorkerUrl = (scriptURL: string | URL, options?: WorkerOptions) => {
    const sourceUrl = new URL(String(scriptURL), location.href).href;
    const isModule = options && typeof options === 'object' && options.type === 'module';
    const body = isModule
      ? `${patchSource}\nawait import(${JSON.stringify(sourceUrl)});`
      : `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl)});`;
    return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
  };
  if (typeof root.Worker === 'function') {
    const NativeWorker = root.Worker;
    const WorkerWrapper = new root.Proxy(NativeWorker, {
      construct(target: typeof Worker, args: [string | URL, WorkerOptions?], newTarget: Function) {
        let workerUrl: string | null = null;
        try {
          workerUrl = makeWorkerUrl(args[0], args[1]);
          return root.Reflect.construct(target, [workerUrl, ...args.slice(1)], newTarget);
        } catch {
          return root.Reflect.construct(target, args, newTarget);
        } finally {
          // 原生构造器已捕获 Blob URL；不等待业务消息，也不保留嵌套临时 URL。
          if (workerUrl) root.URL.revokeObjectURL(workerUrl);
        }
      }
    });
    functionSources.set(WorkerWrapper, originalFunctionToString.call(NativeWorker));
    root.Worker = WorkerWrapper as unknown as typeof Worker;
  }
}
