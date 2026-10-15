import type { AntiDetectionState, ReflectionOriginals, DescriptorEntry, SurfaceName } from './types';

export function captureOriginals(globals: typeof globalThis & Record<string, any>): ReflectionOriginals {
  const objectCtor = globals.Object || Object;
  const functionCtor = globals.Function || Function;
  const reflectCtor = globals.Reflect || Reflect;
  return {
    objectDefineProperty: objectCtor.defineProperty,
    objectGetOwnPropertyDescriptor: objectCtor.getOwnPropertyDescriptor,
    objectGetOwnPropertyDescriptors: objectCtor.getOwnPropertyDescriptors,
    objectGetOwnPropertyNames: objectCtor.getOwnPropertyNames,
    objectGetOwnPropertySymbols: objectCtor.getOwnPropertySymbols,
    objectGetPrototypeOf: objectCtor.getPrototypeOf,
    objectSetPrototypeOf: objectCtor.setPrototypeOf,
    functionToString: functionCtor.prototype.toString,
    reflectApply: reflectCtor.apply,
    reflectGetOwnPropertyDescriptor: reflectCtor.getOwnPropertyDescriptor,
    reflectOwnKeys: reflectCtor.ownKeys
  };
}

export function getPropertyMap<K, V>(map: WeakMap<object, Map<K, V>>, owner: object): Map<K, V> {
  let propertyMap = map.get(owner);
  if (!propertyMap) {
    propertyMap = new Map<K, V>();
    map.set(owner, propertyMap);
  }
  return propertyMap;
}

export function getPropertySet(map: WeakMap<object, Set<PropertyKey>>, owner: object): Set<PropertyKey> {
  let propertySet = map.get(owner);
  if (!propertySet) {
    propertySet = new Set<PropertyKey>();
    map.set(owner, propertySet);
  }
  return propertySet;
}

export function cloneDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone: PropertyDescriptor = {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable
  };
  if ('value' in descriptor || 'writable' in descriptor) {
    clone.value = descriptor.value;
    clone.writable = descriptor.writable;
  } else {
    clone.get = descriptor.get;
    clone.set = descriptor.set;
  }
  return clone;
}

export function nativeSourceFor(state: AntiDetectionState, fn: Function | undefined, fallbackName = ''): string {
  if (typeof fn === 'function') {
    try {
      return state.originals.functionToString.call(fn);
    } catch {}
  }
  return `function ${fallbackName}() { [native code] }`;
}

export function registerFunctionSource(state: AntiDetectionState, fn: unknown, source: string): void {
  if (typeof fn === 'function') {
    state.functionSources.set(fn, source);
  }
}

export function registerDescriptor(
  state: AntiDetectionState,
  owner: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
  surface: SurfaceName
): void {
  getPropertyMap(state.descriptors, owner).set(property, {
    descriptor: cloneDescriptor(descriptor),
    surface
  });
}

export function registerHiddenProperty(state: AntiDetectionState, owner: object, property: PropertyKey): void {
  getPropertySet(state.hiddenProperties, owner).add(property);
}

export function isHiddenProperty(state: AntiDetectionState, owner: object, property: PropertyKey): boolean {
  return Boolean(state.hiddenProperties.get(owner)?.has(property));
}

export function getRegisteredDescriptor(
  state: AntiDetectionState,
  owner: object,
  property: PropertyKey
): PropertyDescriptor | undefined {
  return state.descriptors.get(owner)?.get(property)?.descriptor;
}

export function filterHiddenKeys(state: AntiDetectionState, owner: object, keys: PropertyKey[]): PropertyKey[] {
  const hidden = state.hiddenProperties.get(owner);
  if (!hidden || hidden.size === 0) return keys;
  return keys.filter((key) => !hidden.has(key));
}

export function installReflectionVirtualization(
  globals: typeof globalThis & Record<string, any>,
  state: AntiDetectionState
): void {
  if (state.reflectionInstalled) return;
  state.reflectionInstalled = true;

  const objectCtor = globals.Object || Object;
  const functionCtor = globals.Function || Function;
  const reflectCtor = globals.Reflect || Reflect;
  const originals = state.originals;

  const patchedGetOwnPropertyDescriptor = function getOwnPropertyDescriptor(obj: object, prop: PropertyKey) {
    if (obj && isHiddenProperty(state, obj, prop)) return undefined;
    const registered = obj ? getRegisteredDescriptor(state, obj, prop) : undefined;
    if (registered) return cloneDescriptor(registered);
    return originals.objectGetOwnPropertyDescriptor.call(objectCtor, obj, prop);
  };

  const patchedReflectGetOwnPropertyDescriptor = function getOwnPropertyDescriptor(obj: object, prop: PropertyKey) {
    if (obj && isHiddenProperty(state, obj, prop)) return undefined;
    const registered = obj ? getRegisteredDescriptor(state, obj, prop) : undefined;
    if (registered) return cloneDescriptor(registered);
    return originals.reflectGetOwnPropertyDescriptor.call(reflectCtor, obj, prop);
  };

  const patchedGetOwnPropertyDescriptors = function getOwnPropertyDescriptors(obj: object) {
    const descriptors = originals.objectGetOwnPropertyDescriptors.call(objectCtor, obj);
    if (!obj || !descriptors) return descriptors;

    for (const key of filterHiddenKeys(state, obj, originals.reflectOwnKeys.call(reflectCtor, descriptors))) {
      const registered = getRegisteredDescriptor(state, obj, key);
      if (registered) {
        originals.objectDefineProperty.call(objectCtor, descriptors, key, {
          value: cloneDescriptor(registered),
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }

    const hidden = state.hiddenProperties.get(obj);
    if (hidden) {
      for (const key of hidden) {
        delete (descriptors as Record<PropertyKey, unknown>)[key];
      }
    }
    return descriptors;
  };

  const patchedGetOwnPropertyNames = function getOwnPropertyNames(obj: object) {
    return filterHiddenKeys(state, obj, originals.objectGetOwnPropertyNames.call(objectCtor, obj)) as string[];
  };

  const patchedGetOwnPropertySymbols = function getOwnPropertySymbols(obj: object) {
    return filterHiddenKeys(state, obj, originals.objectGetOwnPropertySymbols.call(objectCtor, obj)) as symbol[];
  };

  const patchedOwnKeys = function ownKeys(obj: object) {
    return filterHiddenKeys(state, obj, originals.reflectOwnKeys.call(reflectCtor, obj));
  };

  const patchedFunctionToString = function toString(this: Function) {
    const source = state.functionSources.get(this);
    if (source) return source;
    return originals.functionToString.call(this);
  };

  registerFunctionSource(state, patchedGetOwnPropertyDescriptor, nativeSourceFor(state, originals.objectGetOwnPropertyDescriptor, 'getOwnPropertyDescriptor'));
  registerFunctionSource(state, patchedReflectGetOwnPropertyDescriptor, nativeSourceFor(state, originals.reflectGetOwnPropertyDescriptor, 'getOwnPropertyDescriptor'));
  registerFunctionSource(state, patchedGetOwnPropertyDescriptors, nativeSourceFor(state, originals.objectGetOwnPropertyDescriptors, 'getOwnPropertyDescriptors'));
  registerFunctionSource(state, patchedGetOwnPropertyNames, nativeSourceFor(state, originals.objectGetOwnPropertyNames, 'getOwnPropertyNames'));
  registerFunctionSource(state, patchedGetOwnPropertySymbols, nativeSourceFor(state, originals.objectGetOwnPropertySymbols, 'getOwnPropertySymbols'));
  registerFunctionSource(state, patchedOwnKeys, nativeSourceFor(state, originals.reflectOwnKeys, 'ownKeys'));
  registerFunctionSource(state, patchedFunctionToString, nativeSourceFor(state, originals.functionToString, 'toString'));

  const objectDescriptor = (property: PropertyKey) => originals.objectGetOwnPropertyDescriptor.call(objectCtor, objectCtor, property);
  const reflectDescriptor = (property: PropertyKey) => originals.objectGetOwnPropertyDescriptor.call(objectCtor, reflectCtor, property);
  const functionToStringDescriptor = originals.objectGetOwnPropertyDescriptor.call(objectCtor, functionCtor.prototype, 'toString');

  originals.objectDefineProperty.call(objectCtor, objectCtor, 'getOwnPropertyDescriptor', {
    ...(objectDescriptor('getOwnPropertyDescriptor') || { configurable: true, writable: true }),
    value: patchedGetOwnPropertyDescriptor
  });
  originals.objectDefineProperty.call(objectCtor, objectCtor, 'getOwnPropertyDescriptors', {
    ...(objectDescriptor('getOwnPropertyDescriptors') || { configurable: true, writable: true }),
    value: patchedGetOwnPropertyDescriptors
  });
  originals.objectDefineProperty.call(objectCtor, objectCtor, 'getOwnPropertyNames', {
    ...(objectDescriptor('getOwnPropertyNames') || { configurable: true, writable: true }),
    value: patchedGetOwnPropertyNames
  });
  originals.objectDefineProperty.call(objectCtor, objectCtor, 'getOwnPropertySymbols', {
    ...(objectDescriptor('getOwnPropertySymbols') || { configurable: true, writable: true }),
    value: patchedGetOwnPropertySymbols
  });
  originals.objectDefineProperty.call(objectCtor, reflectCtor, 'getOwnPropertyDescriptor', {
    ...(reflectDescriptor('getOwnPropertyDescriptor') || { configurable: true, writable: true }),
    value: patchedReflectGetOwnPropertyDescriptor
  });
  originals.objectDefineProperty.call(objectCtor, reflectCtor, 'ownKeys', {
    ...(reflectDescriptor('ownKeys') || { configurable: true, writable: true }),
    value: patchedOwnKeys
  });
  originals.objectDefineProperty.call(objectCtor, functionCtor.prototype, 'toString', {
    ...(functionToStringDescriptor || { configurable: true, writable: true }),
    value: patchedFunctionToString
  });
}

export function getAntiDetectionState(globals: typeof globalThis & Record<string, any>, runtimeAnchor: symbol): AntiDetectionState {
  const objectCtor = globals.Object || Object;
  const anchor = runtimeAnchor;
  let state = (globals as Record<PropertyKey, any>)[anchor] as AntiDetectionState | undefined;

  if (!state) {
    const originals = captureOriginals(globals);
    state = {
      anchor,
      runtimeReady: false,
      reflectionInstalled: false,
      debugMode: false,
      originals,
      descriptors: new WeakMap<object, Map<PropertyKey, DescriptorEntry>>(),
      functionSources: new WeakMap<Function, string>(),
      hiddenProperties: new WeakMap<object, Set<PropertyKey>>(),
      installedSurfaces: new Set<string>(),
      spoofOriginals: {},
      workerPatchSource: '',
      sharedWorkerUrls: new Map<string, string>(),
      values: {
        language: null,
        languages: null,
        timezone: null,
        geolocation: null,
        geolocationCoordinate: null,
        canvasTargetFontKeys: new Set<string>()
      }
    };
    originals.objectDefineProperty.call(objectCtor, globals, anchor, {
      value: state,
      configurable: false,
      enumerable: false,
      writable: false
    });
    registerHiddenProperty(state, globals, anchor);
  }

  installReflectionVirtualization(globals, state);
  return state;
}

export function defineRegisteredProperty(
  globals: typeof globalThis & Record<string, any>,
  state: AntiDetectionState,
  owner: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
  surface: SurfaceName,
  nativeDescriptor?: PropertyDescriptor
): void {
  const objectCtor = globals.Object || Object;
  const originalDescriptor = nativeDescriptor || state.originals.objectGetOwnPropertyDescriptor.call(objectCtor, owner, property);

  if (typeof descriptor.value === 'function') {
    const nativeSource = nativeSourceFor(state, originalDescriptor?.value, String(property));
    registerFunctionSource(state, descriptor.value, nativeSource);
  }
  if (typeof descriptor.get === 'function') {
    const nativeSource = nativeSourceFor(state, originalDescriptor?.get, `get ${String(property)}`);
    registerFunctionSource(state, descriptor.get, nativeSource);
  }
  if (typeof descriptor.set === 'function') {
    const nativeSource = nativeSourceFor(state, originalDescriptor?.set, `set ${String(property)}`);
    registerFunctionSource(state, descriptor.set, nativeSource);
  }

  state.originals.objectDefineProperty.call(objectCtor, owner, property, descriptor);
  const actualDescriptor = state.originals.objectGetOwnPropertyDescriptor.call(objectCtor, owner, property) || descriptor;
  registerDescriptor(state, owner, property, actualDescriptor, surface);
}

export function createNativeProxyFunction<T extends Function>(
  globals: typeof globalThis & Record<string, any>,
  state: AntiDetectionState,
  nativeFunction: T,
  applyHandler: (target: T, thisArg: unknown, args: unknown[]) => unknown,
  nativeSource?: string
): T {
  const proxyCtor = globals.Proxy || Proxy;
  const proxy = new proxyCtor(nativeFunction, {
    apply(target: T, thisArg: unknown, args: unknown[]) {
      return applyHandler(target, thisArg, args);
    }
  }) as unknown as T;
  registerFunctionSource(state, proxy as unknown as Function, nativeSource || nativeSourceFor(state, nativeFunction));
  return proxy;
}

export function replaceMethod(
  globals: typeof globalThis & Record<string, any>,
  state: AntiDetectionState,
  owner: object,
  property: PropertyKey,
  replacement: Function,
  surface: SurfaceName,
  nativeFunction?: Function
): void {
  const objectCtor = globals.Object || Object;
  const originalDescriptor = state.originals.objectGetOwnPropertyDescriptor.call(objectCtor, owner, property);
  const descriptor: PropertyDescriptor = {
    ...(originalDescriptor || { configurable: true, enumerable: false, writable: true }),
    value: replacement
  };
  registerFunctionSource(state, replacement, nativeSourceFor(state, nativeFunction || originalDescriptor?.value, String(property)));
  defineRegisteredProperty(globals, state, owner, property, descriptor, surface, originalDescriptor);
}
