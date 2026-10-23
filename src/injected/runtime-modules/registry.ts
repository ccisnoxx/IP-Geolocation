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
  state.originals.objectDefineProperty.call(globals.Object || Object, owner, property, descriptor);
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
