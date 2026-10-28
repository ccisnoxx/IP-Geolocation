import type { RuntimeState, RuntimeOriginals } from './types';

export function captureOriginals(globals: typeof globalThis & Record<string, any>): RuntimeOriginals {
  const objectCtor = globals.Object || Object;
  return {
    objectDefineProperty: objectCtor.defineProperty,
    objectGetOwnPropertyDescriptor: objectCtor.getOwnPropertyDescriptor,
    objectGetPrototypeOf: objectCtor.getPrototypeOf,
    objectSetPrototypeOf: objectCtor.setPrototypeOf,
    reflectApply: (globals.Reflect || Reflect).apply
  };
}

// 每次安装的状态只由返回的更新句柄和已安装的闭包持有，不写入 realm 全局对象。
export function createRuntimeState(globals: typeof globalThis & Record<string, any>): RuntimeState {
  return {
    active: true,
    restores: [],
    guardedFunctions: new WeakMap(),
    cleanup: [],
    runtimeReady: false,
    debugMode: false,
    originals: captureOriginals(globals),
    installedSurfaces: new Set<string>(),
    spoofOriginals: {},
    workerPatchSource: '',
    sharedWorkerUrls: new Map<string, string>(),
    values: {
      language: null,
      languages: null,
      timezone: null,
      geolocationCoordinate: null,
      blockedFontFamilyKeys: new Set<string>()
    }
  };
}

export function defineRuntimeProperty(
  globals: typeof globalThis & Record<string, any>,
  state: RuntimeState,
  owner: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor
): void {
  const original = state.originals.objectGetOwnPropertyDescriptor(owner, property);
  const guard = (replacement: Function, native: Function): Function => {
    const cached = state.guardedFunctions.get(replacement);
    if (cached?.native === native) return cached.wrapped;
    const apply = state.originals.reflectApply;
    const construct = (globals.Reflect || Reflect).construct;
    const wrapped: Function = new (globals.Proxy || Proxy)(replacement, {
      apply(target: Function, receiver: unknown, args: unknown[]) {
        return apply(state.active ? target : native, receiver, args);
      },
      construct(target: Function, args: unknown[], newTarget: Function): object {
        const current = state.active ? target : native;
        return construct(current, args, newTarget === wrapped ? current : newTarget);
      }
    });
    state.guardedFunctions.set(replacement, { native, wrapped });
    return wrapped;
  };
  const installed = { ...descriptor };
  for (const field of ['value', 'get', 'set'] as const) {
    if (typeof installed[field] === 'function' && typeof original?.[field] === 'function') installed[field] = guard(installed[field], original[field]);
  }
  state.originals.objectDefineProperty.call(globals.Object || Object, owner, property, installed);
  state.restores.push({ owner, property, original, installed: state.originals.objectGetOwnPropertyDescriptor(owner, property)! });
}

export function disposeRuntimeState(globals: typeof globalThis & Record<string, any>, state: RuntimeState): void {
  state.active = false;
  const errors: unknown[] = [];
  for (const cleanup of state.cleanup.splice(0)) {
    try { cleanup(); } catch (error) { errors.push(error); }
  }
  for (const entry of state.restores.splice(0).reverse()) {
    const current = state.originals.objectGetOwnPropertyDescriptor(entry.owner, entry.property);
    // 页面后续修改的descriptor由页面持有；不覆盖其字段或强行解除锁定。
    if (!current || !['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(key =>
      current[key as keyof PropertyDescriptor] === entry.installed[key as keyof PropertyDescriptor])) continue;
    try {
      if (entry.original) state.originals.objectDefineProperty.call(globals.Object || Object, entry.owner, entry.property, entry.original);
      else if (!(globals.Reflect || Reflect).deleteProperty(entry.owner, entry.property)) throw new Error('运行时属性未能删除');
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw Object.assign(new Error('页面运行时清理未完成，请完整重载'), { errors });
}

export function createNativeProxyFunction<T extends Function>(
  globals: typeof globalThis & Record<string, any>,
  nativeFunction: T,
  applyHandler: (target: T, thisArg: unknown, args: unknown[]) => unknown
): T {
  return new (globals.Proxy || Proxy)(nativeFunction, {
    apply(target: T, thisArg: unknown, args: unknown[]) {
      return applyHandler(target, thisArg, args);
    }
  }) as unknown as T;
}

export function replaceMethod(
  globals: typeof globalThis & Record<string, any>,
  state: RuntimeState,
  owner: object,
  property: PropertyKey,
  replacement: Function
): void {
  const descriptor = state.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, owner, property);
  defineRuntimeProperty(globals, state, owner, property, {
    ...(descriptor || { configurable: true, enumerable: false, writable: true }),
    value: replacement
  });
}
