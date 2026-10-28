import type { RuntimeGlobals, RuntimeState } from '../types';
import { replaceMethod } from '../registry';

// HTTP classic入口变为Blob后，importScripts仍相对原HTTP入口解析；fetch/XHR/location不伪装。
export function installWorkerImportScripts(root: RuntimeGlobals, state: RuntimeState, sourceURL: string): void {
  if (typeof root.importScripts !== 'function') return;
  const apply = state.originals.reflectApply;
  const URLCtor = root.URL;
  let owner: object | null = root;
  while (owner && !state.originals.objectGetOwnPropertyDescriptor(owner, 'importScripts')) owner = state.originals.objectGetPrototypeOf(owner);
  if (!owner) return;
  replaceMethod(root, state, owner, 'importScripts', new root.Proxy(root.importScripts, {
    apply(target: Function, receiver: unknown, args: unknown[]) {
      // TrustedScriptURL的验证仍由原生拥有，不替换其对象身份。
      apply(target, receiver, []);
      const values = args.map(value => root.trustedTypes?.isScriptURL(value) ? value : `${value}`);
      let urls: unknown[];
      try { urls = values.map(value => typeof value === 'string' ? new URLCtor(value, sourceURL).href : value); }
      catch {
        // 解析失败由原生抛SyntaxError DOMException；转换已完成，不再次执行用户toString。
        return apply(target, receiver, values);
      }
      return apply(target, receiver, urls);
    }
  }));
}
