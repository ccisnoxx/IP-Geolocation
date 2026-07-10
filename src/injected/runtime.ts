type RuntimePayload = {
  extensionEnabled?: boolean;
  enabled?: boolean;
  debugMode?: boolean;
  languageConfig?: {
    enabled: boolean;
    language: string;
    languages: string[];
    acceptLanguage: string;
  } | null;
  timezone?: string | null;
  timezoneConfig?: {
    enabled: boolean;
    mode: 'auto' | 'manual';
    timezone: string;
  };
  geolocation?: {
    enabled?: boolean;
    latitude: number;
    longitude: number;
    accuracy?: number;
    country?: string;
    randomize?: boolean;
    randomRadiusMeters?: number;
    spoofPermission?: boolean;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  canvasConfig?: {
    enabled: boolean;
    spoofFonts: boolean;
    targetFonts: string[];
  };
};

type SurfaceName =
  | 'navigator'
  | 'intl-date'
  | 'geolocation-permissions'
  | 'canvas'
  | 'worker'
  | 'iframe'
  | 'internal';

type ReflectionOriginals = {
  objectDefineProperty: typeof Object.defineProperty;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  objectGetOwnPropertyDescriptors: typeof Object.getOwnPropertyDescriptors;
  objectGetOwnPropertyNames: typeof Object.getOwnPropertyNames;
  objectGetOwnPropertySymbols: typeof Object.getOwnPropertySymbols;
  objectGetPrototypeOf: typeof Object.getPrototypeOf;
  objectSetPrototypeOf: typeof Object.setPrototypeOf;
  functionToString: typeof Function.prototype.toString;
  reflectApply: typeof Reflect.apply;
  reflectGetOwnPropertyDescriptor: typeof Reflect.getOwnPropertyDescriptor;
  reflectOwnKeys: typeof Reflect.ownKeys;
  symbolFor: typeof Symbol.for;
  symbolKeyFor: typeof Symbol.keyFor;
};

type DescriptorEntry = {
  descriptor: PropertyDescriptor;
  surface: SurfaceName;
};

type AntiDetectionState = {
  anchor: symbol;
  runtimeReady: boolean;
  listenerInstalled: boolean;
  reflectionInstalled: boolean;
  debugMode: boolean;
  originals: ReflectionOriginals;
  descriptors: WeakMap<object, Map<PropertyKey, DescriptorEntry>>;
  functionSources: WeakMap<Function, string>;
  hiddenProperties: WeakMap<object, Set<PropertyKey>>;
  installedSurfaces: Set<string>;
  spoofOriginals: Record<string, any>;
  values: {
    language: string | null;
    languages: string[] | null;
    timezone: string | null;
    geolocation: RuntimePayload['geolocation'];
    geolocationCoordinate: { key: string; latitude: number; longitude: number } | null;
    canvasTargetFontKeys: Set<string>;
  };
  lastPayload: RuntimePayload | null;
};

(function() {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const MAIN_STATE_KEY = 'chrome.runtime.vanishgeo.state';

  function captureOriginals(globals: typeof globalThis & Record<string, any>): ReflectionOriginals {
    const objectCtor = globals.Object || Object;
    const functionCtor = globals.Function || Function;
    const reflectCtor = globals.Reflect || Reflect;
    const symbolCtor = globals.Symbol || Symbol;
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
      reflectOwnKeys: reflectCtor.ownKeys,
      symbolFor: symbolCtor.for,
      symbolKeyFor: symbolCtor.keyFor
    };
  }

  function getPropertyMap<K, V>(map: WeakMap<object, Map<K, V>>, owner: object): Map<K, V> {
    let propertyMap = map.get(owner);
    if (!propertyMap) {
      propertyMap = new Map<K, V>();
      map.set(owner, propertyMap);
    }
    return propertyMap;
  }

  function getPropertySet(map: WeakMap<object, Set<PropertyKey>>, owner: object): Set<PropertyKey> {
    let propertySet = map.get(owner);
    if (!propertySet) {
      propertySet = new Set<PropertyKey>();
      map.set(owner, propertySet);
    }
    return propertySet;
  }

  function cloneDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
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

  function nativeSourceFor(state: AntiDetectionState, fn: Function | undefined, fallbackName = ''): string {
    if (typeof fn === 'function') {
      try {
        return state.originals.functionToString.call(fn);
      } catch {}
    }
    return `function ${fallbackName}() { [native code] }`;
  }

  function registerFunctionSource(state: AntiDetectionState, fn: unknown, source: string): void {
    if (typeof fn === 'function') {
      state.functionSources.set(fn, source);
    }
  }

  function registerDescriptor(
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

  function registerHiddenProperty(state: AntiDetectionState, owner: object, property: PropertyKey): void {
    getPropertySet(state.hiddenProperties, owner).add(property);
  }

  function isHiddenProperty(state: AntiDetectionState, owner: object, property: PropertyKey): boolean {
    return Boolean(state.hiddenProperties.get(owner)?.has(property));
  }

  function getRegisteredDescriptor(
    state: AntiDetectionState,
    owner: object,
    property: PropertyKey
  ): PropertyDescriptor | undefined {
    return state.descriptors.get(owner)?.get(property)?.descriptor;
  }

  function filterHiddenKeys(state: AntiDetectionState, owner: object, keys: PropertyKey[]): PropertyKey[] {
    const hidden = state.hiddenProperties.get(owner);
    if (!hidden || hidden.size === 0) return keys;
    return keys.filter((key) => !hidden.has(key));
  }

  function installReflectionVirtualization(
    globals: typeof globalThis & Record<string, any>,
    state: AntiDetectionState
  ): void {
    if (state.reflectionInstalled) return;
    state.reflectionInstalled = true;

    const objectCtor = globals.Object || Object;
    const functionCtor = globals.Function || Function;
    const reflectCtor = globals.Reflect || Reflect;
    const symbolCtor = globals.Symbol || Symbol;
    const originals = state.originals;
    const stateKeyDecoy = symbolCtor(MAIN_STATE_KEY);

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

    const patchedSymbolFor = function(key: unknown) {
      if (typeof key !== 'symbol' && String(key) === MAIN_STATE_KEY) return stateKeyDecoy;
      return originals.symbolFor.call(symbolCtor, key as string);
    };

    const patchedSymbolKeyFor = function(key: symbol) {
      if (key === state.anchor) return undefined;
      if (key === stateKeyDecoy) return MAIN_STATE_KEY;
      return originals.symbolKeyFor.call(symbolCtor, key);
    };

    registerFunctionSource(state, patchedGetOwnPropertyDescriptor, nativeSourceFor(state, originals.objectGetOwnPropertyDescriptor, 'getOwnPropertyDescriptor'));
    registerFunctionSource(state, patchedReflectGetOwnPropertyDescriptor, nativeSourceFor(state, originals.reflectGetOwnPropertyDescriptor, 'getOwnPropertyDescriptor'));
    registerFunctionSource(state, patchedGetOwnPropertyDescriptors, nativeSourceFor(state, originals.objectGetOwnPropertyDescriptors, 'getOwnPropertyDescriptors'));
    registerFunctionSource(state, patchedGetOwnPropertyNames, nativeSourceFor(state, originals.objectGetOwnPropertyNames, 'getOwnPropertyNames'));
    registerFunctionSource(state, patchedGetOwnPropertySymbols, nativeSourceFor(state, originals.objectGetOwnPropertySymbols, 'getOwnPropertySymbols'));
    registerFunctionSource(state, patchedOwnKeys, nativeSourceFor(state, originals.reflectOwnKeys, 'ownKeys'));
    registerFunctionSource(state, patchedFunctionToString, nativeSourceFor(state, originals.functionToString, 'toString'));
    registerFunctionSource(state, patchedSymbolFor, nativeSourceFor(state, originals.symbolFor, 'for'));
    registerFunctionSource(state, patchedSymbolKeyFor, nativeSourceFor(state, originals.symbolKeyFor, 'keyFor'));

    const objectDescriptor = (property: PropertyKey) => originals.objectGetOwnPropertyDescriptor.call(objectCtor, objectCtor, property);
    const reflectDescriptor = (property: PropertyKey) => originals.objectGetOwnPropertyDescriptor.call(objectCtor, reflectCtor, property);
    const symbolDescriptor = (property: PropertyKey) => originals.objectGetOwnPropertyDescriptor.call(objectCtor, symbolCtor, property);
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
    defineRegisteredProperty(globals, state, symbolCtor, 'for', {
      ...(symbolDescriptor('for') || { configurable: true, writable: true }),
      value: patchedSymbolFor
    }, 'internal', symbolDescriptor('for'));
    defineRegisteredProperty(globals, state, symbolCtor, 'keyFor', {
      ...(symbolDescriptor('keyFor') || { configurable: true, writable: true }),
      value: patchedSymbolKeyFor
    }, 'internal', symbolDescriptor('keyFor'));
  }

  function getAntiDetectionState(globals: typeof globalThis & Record<string, any>): AntiDetectionState {
    const symbolCtor = globals.Symbol || Symbol;
    const objectCtor = globals.Object || Object;
    const anchor = symbolCtor.for ? symbolCtor.for(MAIN_STATE_KEY) : Symbol(MAIN_STATE_KEY);
    let state = (globals as Record<PropertyKey, any>)[anchor] as AntiDetectionState | undefined;

    if (!state) {
      const originals = captureOriginals(globals);
      state = {
        anchor,
        runtimeReady: false,
        listenerInstalled: false,
        reflectionInstalled: false,
        debugMode: false,
        originals,
        descriptors: new WeakMap<object, Map<PropertyKey, DescriptorEntry>>(),
        functionSources: new WeakMap<Function, string>(),
        hiddenProperties: new WeakMap<object, Set<PropertyKey>>(),
        installedSurfaces: new Set<string>(),
        spoofOriginals: {},
        values: {
          language: null,
          languages: null,
          timezone: null,
          geolocation: null,
          geolocationCoordinate: null,
          canvasTargetFontKeys: new Set<string>()
        },
        lastPayload: null
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

  function defineRegisteredProperty(
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

  function createNativeProxyFunction<T extends Function>(
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

  function replaceMethod(
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

  const state = getAntiDetectionState(root);
  if (state.runtimeReady) return;
  state.runtimeReady = true;

  const log = (...args: unknown[]) => {
    if (state.debugMode) {
      console.log('[VanishGeo]', ...args);
    }
  };

  function normalizeTimezonePayload(payload: RuntimePayload): { timezone: string | null } {
    const timezoneConfig = payload.timezoneConfig || { enabled: false, mode: 'auto', timezone: '' };
    const timezone = timezoneConfig.enabled === false
      ? null
      : timezoneConfig.mode === 'manual' && timezoneConfig.timezone
        ? timezoneConfig.timezone
        : payload.timezone || null;
    return { timezone };
  }

  function installNativeBackedNavigatorGetter(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    property: string,
    getSpoofedValue: () => unknown
  ): void {
    const navigatorTarget = globals.navigator as Navigator & Record<string, unknown>;
    if (!navigatorTarget) return;
    const navigatorPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, navigatorTarget);
    const originalDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, navigatorPrototype, property);

    if (!originalDescriptor || typeof originalDescriptor.get !== 'function' || originalDescriptor.configurable === false) {
      return;
    }

    const nativeGetter = originalDescriptor.get;
    const spoofedGetter = createNativeProxyFunction(globals, realmState, nativeGetter, (target, thisArg, args) => {
      if (thisArg === navigatorTarget) {
        return getSpoofedValue();
      }
      return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
    });

    defineRegisteredProperty(globals, realmState, navigatorPrototype, property, {
      ...originalDescriptor,
      get: spoofedGetter
    }, 'navigator', originalDescriptor);
  }

  function installLanguageSpoof(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    language: string | null,
    languages: string[] | null
  ): void {
    realmState.values.language = language;
    realmState.values.languages = languages && languages.length ? languages.slice() : language ? [language] : null;
    if (!language) return;

    if (!realmState.installedSurfaces.has('navigator-language')) {
      realmState.installedSurfaces.add('navigator-language');
      installNativeBackedNavigatorGetter(globals, realmState, 'language', () => realmState.values.language);
      installNativeBackedNavigatorGetter(globals, realmState, 'languages', () => Object.freeze((realmState.values.languages || []).slice()));
    }
  }

  function installDateTimeSpoof(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    config: { timezone?: string | null; language?: string | null }
  ): void {
    realmState.values.timezone = config && config.timezone ? config.timezone : null;
    realmState.values.language = config && config.language ? config.language : realmState.values.language;
    const timezone = realmState.values.timezone;
    const spoofLanguage = realmState.values.language;
    if (!timezone && !spoofLanguage) return;

    const originalKey = 'intlDateOriginals';
    const originals = realmState.spoofOriginals[originalKey] || (realmState.spoofOriginals[originalKey] = {
      Date: globals.Date,
      DateTimeFormat: globals.Intl && globals.Intl.DateTimeFormat,
      NumberFormat: globals.Intl && globals.Intl.NumberFormat,
      Collator: globals.Intl && globals.Intl.Collator,
      RelativeTimeFormat: globals.Intl && globals.Intl.RelativeTimeFormat,
      ListFormat: globals.Intl && (globals.Intl as unknown as Record<string, any>).ListFormat,
      PluralRules: globals.Intl && globals.Intl.PluralRules,
      DisplayNames: globals.Intl && globals.Intl.DisplayNames,
      Segmenter: globals.Intl && (globals.Intl as unknown as Record<string, any>).Segmenter,
      resolvedOptions: globals.Intl && globals.Intl.DateTimeFormat && globals.Intl.DateTimeFormat.prototype.resolvedOptions,
      dateToString: globals.Date && globals.Date.prototype.toString,
      dateToDateString: globals.Date && globals.Date.prototype.toDateString,
      dateToTimeString: globals.Date && globals.Date.prototype.toTimeString,
      dateToLocaleString: globals.Date && globals.Date.prototype.toLocaleString,
      dateToLocaleDateString: globals.Date && globals.Date.prototype.toLocaleDateString,
      dateToLocaleTimeString: globals.Date && globals.Date.prototype.toLocaleTimeString,
      getTimezoneOffset: globals.Date && globals.Date.prototype.getTimezoneOffset
    });

    const OriginalDate = originals.Date;
    const OriginalDateTimeFormat = originals.DateTimeFormat;
    if (!OriginalDate || !OriginalDateTimeFormat) return;

    const originalResolvedOptions = originals.resolvedOptions;
    const originalGetTimezoneOffset = originals.getTimezoneOffset;

    const getParts = (date: Date, timeZone = realmState.values.timezone) => {
      if (!timeZone) return null;
      try {
        const formatter = new OriginalDateTimeFormat('en-US', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
          timeZoneName: 'long'
        });
        const parts: Record<string, string> = {};
        formatter.formatToParts(date).forEach((part: Intl.DateTimeFormatPart) => {
          if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return parts;
      } catch {
        return null;
      }
    };

    const resolveOffset = (date: Date) => {
      const parts = getParts(date);
      if (!parts || !realmState.values.timezone) return originalGetTimezoneOffset.call(date);
      const asUTC = OriginalDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      return Math.round((date.getTime() - asUTC) / 60000);
    };

    const makeWallDate = (args: IArguments | unknown[]) => {
      const year = Number(args[0]);
      const month = Number(args[1]);
      const day = args.length > 2 ? Number(args[2]) : 1;
      const hour = args.length > 3 ? Number(args[3]) : 0;
      const minute = args.length > 4 ? Number(args[4]) : 0;
      const second = args.length > 5 ? Number(args[5]) : 0;
      const ms = args.length > 6 ? Number(args[6]) : 0;
      let utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms);
      for (let index = 0; index < 3; index += 1) {
        utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms)
          + resolveOffset(new OriginalDate(utc)) * 60000;
      }
      return new OriginalDate(utc);
    };

    const getWallDate = (date: Date) => {
      const parts = getParts(date);
      if (!parts) return null;
      return new OriginalDate(OriginalDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second),
        date.getUTCMilliseconds()
      ));
    };

    const normalizeLocale = (locales?: string | string[]) => realmState.values.language || locales;
    const normalizeIntlOptions = (options?: Intl.DateTimeFormatOptions) => {
      const normalized = { ...(options || {}) };
      if (realmState.values.timezone) normalized.timeZone = realmState.values.timezone;
      return normalized;
    };

    const installLocaleConstructorSpoof = (name: string) => {
      if (!globals.Intl) return;
      const OriginalCtor = originals[name];
      if (typeof OriginalCtor !== 'function') return;

      function SpoofedIntlConstructor(locales?: string | string[], options?: unknown) {
        return new OriginalCtor(normalizeLocale(locales), options);
      }

      realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedIntlConstructor, OriginalCtor);
      SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
      if (typeof OriginalCtor.supportedLocalesOf === 'function') {
        SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
      }
      defineRegisteredProperty(globals, realmState, globals.Intl, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: SpoofedIntlConstructor
      }, 'intl-date', realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals.Intl, name));
    };

    if (!realmState.installedSurfaces.has('intl-date-format')) {
      realmState.installedSurfaces.add('intl-date-format');

      function SpoofedDateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return new OriginalDateTimeFormat(normalizeLocale(locales), normalizeIntlOptions(options));
      }
      realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedDateTimeFormat, OriginalDateTimeFormat);
      SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
      SpoofedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
      defineRegisteredProperty(globals, realmState, globals.Intl, 'DateTimeFormat', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: SpoofedDateTimeFormat
      }, 'intl-date', realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals.Intl, 'DateTimeFormat'));

      if (typeof originalResolvedOptions === 'function') {
        replaceMethod(globals, realmState, globals.Intl.DateTimeFormat.prototype, 'resolvedOptions', function resolvedOptions(this: Intl.DateTimeFormat) {
          const options = originalResolvedOptions.call(this);
          return {
            ...options,
            locale: realmState.values.language || options.locale,
            timeZone: realmState.values.timezone || options.timeZone
          };
        }, 'intl-date', originalResolvedOptions);
      }

      ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
        .forEach(installLocaleConstructorSpoof);
    }

    if (realmState.values.timezone && !realmState.installedSurfaces.has('date-timezone')) {
      realmState.installedSurfaces.add('date-timezone');

      function SpoofedDate(this: Date, ...args: unknown[]) {
        if (!(this instanceof SpoofedDate)) {
          return new (SpoofedDate as any)().toString();
        }
        if (args.length === 0) return new OriginalDate();
        if (args.length === 1) return new OriginalDate(args[0]);
        return makeWallDate(args);
      }
      realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedDate, OriginalDate);
      SpoofedDate.prototype = OriginalDate.prototype;
      SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
      SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
      SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
      defineRegisteredProperty(globals, realmState, globals, 'Date', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: SpoofedDate
      }, 'intl-date', realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals, 'Date'));

      replaceMethod(globals, realmState, OriginalDate.prototype, 'getTimezoneOffset', function getTimezoneOffset(this: Date) {
        return resolveOffset(this);
      }, 'intl-date', originalGetTimezoneOffset);
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getFullYear', function getFullYear(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getYear', function getYear(this: Date) {
        return this.getFullYear() - 1900;
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getMonth', function getMonth(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMonth() : this.getUTCMonth();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getDate', function getDate(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDate() : this.getUTCDate();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getDay', function getDay(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDay() : this.getUTCDay();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getHours', function getHours(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCHours() : this.getUTCHours();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getMinutes', function getMinutes(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getSeconds', function getSeconds(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
      }, 'intl-date');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'getMilliseconds', function getMilliseconds(this: Date) {
        return this.getUTCMilliseconds();
      }, 'intl-date');

      const pad = (value: number) => String(value).padStart(2, '0');
      const formatOffset = (date: Date) => {
        const offset = resolveOffset(date);
        const sign = offset <= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
      };
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toDateString', function toDateString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originals.dateToDateString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
      }, 'intl-date', originals.dateToDateString);
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toTimeString', function toTimeString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originals.dateToTimeString.call(this);
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || realmState.values.timezone})`;
      }, 'intl-date', originals.dateToTimeString);
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toString', function toString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originals.dateToString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || realmState.values.timezone})`;
      }, 'intl-date', originals.dateToString);

      if (globals.Temporal && globals.Temporal.Now) {
        try {
          globals.Temporal.Now.timeZoneId = () => realmState.values.timezone;
        } catch {}
      }
    }

    if (!realmState.installedSurfaces.has('date-locale-methods')) {
      realmState.installedSurfaces.add('date-locale-methods');
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleString', function toLocaleString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return originals.dateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
      }, 'intl-date', originals.dateToLocaleString);
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleDateString', function toLocaleDateString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return originals.dateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
      }, 'intl-date', originals.dateToLocaleDateString);
      replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleTimeString', function toLocaleTimeString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return originals.dateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
      }, 'intl-date', originals.dateToLocaleTimeString);
    }
  }

  function randomCoordinateInRadius(lat: number, lon: number, radiusMeters: number) {
    if (radiusMeters <= 0) return { latitude: lat, longitude: lon };
    const earthRadius = 6371000;
    const distance = Math.random() * radiusMeters;
    const bearing = Math.random() * 2 * Math.PI;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / earthRadius)
      + Math.cos(lat1) * Math.sin(distance / earthRadius) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(distance / earthRadius) * Math.cos(lat1),
      Math.cos(distance / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
    );
    return {
      latitude: Math.max(-90, Math.min(90, (lat2 * 180) / Math.PI)),
      longitude: (((lon2 * 180) / Math.PI) + 540) % 360 - 180
    };
  }

  function getStableGeolocationCoordinate(realmState: AntiDetectionState, geolocation: NonNullable<RuntimePayload['geolocation']>) {
    const latitude = Number(geolocation.latitude);
    const longitude = Number(geolocation.longitude);
    const radius = Number(geolocation.randomRadiusMeters) > 0 ? Number(geolocation.randomRadiusMeters) : 0;
    const key = [
      latitude,
      longitude,
      geolocation.randomize === true,
      radius
    ].join('|');

    if (realmState.values.geolocationCoordinate?.key === key) {
      return realmState.values.geolocationCoordinate;
    }

    const coordinate = geolocation.randomize && radius > 0
      ? randomCoordinateInRadius(latitude, longitude, radius)
      : { latitude, longitude };
    realmState.values.geolocationCoordinate = { key, ...coordinate };
    return realmState.values.geolocationCoordinate;
  }

  function buildGeolocationPosition(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    geolocation: NonNullable<RuntimePayload['geolocation']>
  ) {
    const coordinate = getStableGeolocationCoordinate(realmState, geolocation);
    const latitude = coordinate.latitude;
    const longitude = coordinate.longitude;
    return {
      coords: {
        latitude,
        longitude,
        accuracy: Number.isFinite(Number(geolocation.accuracy)) ? Number(geolocation.accuracy) : 50,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: globals.Date ? globals.Date.now() : Date.now()
    } as GeolocationPosition;
  }

  function installGeolocationSpoof(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    geolocation: RuntimePayload['geolocation']
  ): void {
    realmState.values.geolocation = geolocation;
    if (!geolocation || !Number.isFinite(Number(geolocation.latitude)) || !Number.isFinite(Number(geolocation.longitude))) return;
    if (realmState.installedSurfaces.has('geolocation')) return;
    realmState.installedSurfaces.add('geolocation');

    const navigatorTarget = globals.navigator as Navigator & { geolocation?: Geolocation; permissions?: Permissions };
    if (!navigatorTarget) return;
    if (!navigatorTarget.geolocation) {
      defineRegisteredProperty(globals, realmState, navigatorTarget, 'geolocation', {
        value: {},
        configurable: true
      }, 'geolocation-permissions');
    }

    const watches = new Map<number, ReturnType<typeof setInterval>>();
    let nextWatchId = 1;
    const geo = navigatorTarget.geolocation as Geolocation;
    const geoPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, geo);
    const geoOwner = geoPrototype || geo;

    const getCurrentPosition = function getCurrentPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
      if (typeof successCallback !== 'function') {
        throw new TypeError('Geolocation success callback must be a function');
      }
      (globals.queueMicrotask || queueMicrotask)(() => {
        try {
          successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
        } catch {
          errorCallback?.({
            code: 2,
            message: 'Position unavailable',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
          } as GeolocationPositionError);
        }
      });
    };

    const watchPosition = function watchPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
      if (typeof successCallback !== 'function') {
        throw new TypeError('Geolocation success callback must be a function');
      }
      const watchId = nextWatchId;
      nextWatchId += 1;
      const intervalId = globals.setInterval(() => {
        try {
          successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
        } catch {
          errorCallback?.({
            code: 2,
            message: 'Position unavailable',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
          } as GeolocationPositionError);
        }
      }, 3000);
      watches.set(watchId, intervalId);
      (globals.queueMicrotask || queueMicrotask)(() => {
        if (watches.has(watchId)) successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
      });
      return watchId;
    };

    const clearWatch = function clearWatch(watchId: number) {
      const intervalId = watches.get(watchId);
      if (intervalId === undefined) return;
      globals.clearInterval(intervalId);
      watches.delete(watchId);
    };

    replaceMethod(globals, realmState, geoOwner, 'getCurrentPosition', getCurrentPosition, 'geolocation-permissions');
    replaceMethod(globals, realmState, geoOwner, 'watchPosition', watchPosition, 'geolocation-permissions');
    replaceMethod(globals, realmState, geoOwner, 'clearWatch', clearWatch, 'geolocation-permissions');

    const createGrantedPermissionStatus = (nativeStatus?: PermissionStatus): PermissionStatus => {
      if (nativeStatus && typeof globals.Proxy === 'function') {
        return new globals.Proxy(nativeStatus, {
          get(target: PermissionStatus, property: PropertyKey, receiver: unknown) {
            if (property === 'state') return 'granted';
            if (property === 'name') return 'geolocation';
            return (globals.Reflect || Reflect).get(target, property, receiver);
          }
        });
      }

      const status = typeof globals.EventTarget === 'function'
        ? new globals.EventTarget()
        : {};
      const permissionPrototype = globals.PermissionStatus?.prototype;
      if (permissionPrototype) {
        try {
          realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, status, permissionPrototype);
        } catch {}
      }
      realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'state', {
        configurable: true,
        enumerable: true,
        value: 'granted'
      });
      realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'name', {
        configurable: true,
        enumerable: true,
        value: 'geolocation'
      });
      realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'onchange', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: null
      });
      return status as PermissionStatus;
    };

    if (geolocation.spoofPermission !== false && navigatorTarget.permissions) {
      const permissions = navigatorTarget.permissions;
      const permissionsPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, permissions);
      const prototypeDescriptor = permissionsPrototype
        ? realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, permissionsPrototype, 'query')
        : undefined;
      const ownDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, permissions, 'query');
      const queryOwner = prototypeDescriptor ? permissionsPrototype : permissions;
      const originalDescriptor = prototypeDescriptor || ownDescriptor;
      const originalQuery = originalDescriptor && typeof originalDescriptor.value === 'function'
        ? originalDescriptor.value
        : permissions.query;
      if (typeof originalQuery === 'function') {
        const query = createNativeProxyFunction(globals, realmState, originalQuery, (target, thisArg, args) => {
          const permissionDesc = args[0] as PermissionDescriptor | undefined;
          if (permissionDesc && permissionDesc.name === 'geolocation') {
            return Promise.resolve(realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args))
              .then((nativeStatus) => createGrantedPermissionStatus(nativeStatus as PermissionStatus))
              .catch(() => createGrantedPermissionStatus());
          }
          return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
        });
        defineRegisteredProperty(globals, realmState, queryOwner, 'query', {
          ...(originalDescriptor || { configurable: true, enumerable: false, writable: true }),
          value: query
        }, 'geolocation-permissions', originalDescriptor);
      }
    }
  }

  const FONT_SIZE_PATTERN =
    /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

  function fontFamilyKey(family: string): string {
    return family.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '').toLowerCase();
  }

  function splitFontFamilies(familyList: string): string[] {
    const families: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;
    for (const char of familyList) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        current += char;
        escaped = true;
        continue;
      }
      if ((char === '"' || char === "'") && !quote) {
        quote = char;
        current += char;
        continue;
      }
      if (quote && char === quote) {
        quote = null;
        current += char;
        continue;
      }
      if (char === ',' && !quote) {
        if (current.trim()) families.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) families.push(current.trim());
    return families;
  }

  function getFallbackFont(font: string, targetFontKeys: Set<string>): string | null {
    const sizeMatch = font.match(FONT_SIZE_PATTERN);
    if (!sizeMatch || sizeMatch.index === undefined) return null;
    const familyStart = sizeMatch.index + sizeMatch[0].length;
    const prefix = font.slice(0, familyStart).trim();
    const families = splitFontFamilies(font.slice(familyStart).trim());
    if (!families.length) return null;
    const fallbackFamilies = families.filter((family) => !targetFontKeys.has(fontFamilyKey(family)));
    if (fallbackFamilies.length === families.length) return null;
    return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : 'monospace'}`;
  }

  function installCanvasSpoof(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    canvas: RuntimePayload['canvasConfig']
  ): void {
    if (!canvas || !canvas.enabled || !canvas.spoofFonts || !Array.isArray(canvas.targetFonts)) return;
    realmState.values.canvasTargetFontKeys = new Set(canvas.targetFonts.map(fontFamilyKey));
    if (realmState.installedSurfaces.has('canvas')) return;
    realmState.installedSurfaces.add('canvas');
    if (!globals.CanvasRenderingContext2D || !globals.HTMLCanvasElement) return;

    const originalMeasureText = globals.CanvasRenderingContext2D.prototype.measureText;
    const originalGetContext = globals.HTMLCanvasElement.prototype.getContext;

    function measureTextWithFontFallback(ctx: CanvasRenderingContext2D, text: string): TextMetrics {
      if (ctx.font && realmState.values.canvasTargetFontKeys.size > 0) {
        const fallbackFont = getFallbackFont(ctx.font, realmState.values.canvasTargetFontKeys);
        if (fallbackFont) {
          const originalFont = ctx.font;
          ctx.font = fallbackFont;
          try {
            return originalMeasureText.call(ctx, text);
          } finally {
            ctx.font = originalFont;
          }
        }
      }
      return originalMeasureText.call(ctx, text);
    }

    const getContext = createNativeProxyFunction(globals, realmState, originalGetContext, (target, thisArg, args) => (
      realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args)
    ));
    defineRegisteredProperty(globals, realmState, globals.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: getContext
    }, 'canvas', realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals.HTMLCanvasElement.prototype, 'getContext'));

    replaceMethod(globals, realmState, globals.CanvasRenderingContext2D.prototype, 'measureText', function measureText(this: CanvasRenderingContext2D, text: string) {
      return measureTextWithFontFallback(this, text);
    }, 'canvas', originalMeasureText);

    if (globals.document?.fonts && globals.document.fonts.check) {
      const originalCheck = globals.document.fonts.check;
      const fontFaceSetPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, globals.document.fonts);
      const checkOwner = fontFaceSetPrototype || globals.document.fonts;
      const check = createNativeProxyFunction(globals, realmState, originalCheck, (target, thisArg, args) => {
        const font = args[0] as string | undefined;
        if (font && typeof font === 'string' && getFallbackFont(font, realmState.values.canvasTargetFontKeys)) {
          return false;
        }
        return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
      });
      defineRegisteredProperty(globals, realmState, checkOwner, 'check', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: check
      }, 'canvas', realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, checkOwner, 'check'));
    }
  }

  function workerBootstrap(patchConfig: { timezone: string | null; language: string | null; languages: string[] | null }) {
    const root = self as unknown as typeof globalThis & Record<string, any>;
    const stateKeyName = 'chrome.runtime.vanishgeo.state';
    const stateKey = root.Symbol.for(stateKeyName);
    const stateKeyDecoy = root.Symbol(stateKeyName);
    const originalGetOwnPropertySymbols = root.Object.getOwnPropertySymbols;
    const originalGetOwnPropertyDescriptor = root.Object.getOwnPropertyDescriptor;
    const originalOwnKeys = root.Reflect.ownKeys;
    const originalFunctionToString = root.Function.prototype.toString;
    const originalSymbolFor = root.Symbol.for;
    const originalSymbolKeyFor = root.Symbol.keyFor;
    const originalSetPrototypeOf = root.Object.setPrototypeOf;
    const functionSources = new WeakMap<Function, string>();
    if (!(root as Record<PropertyKey, any>)[stateKey]) {
      root.Object.defineProperty(root, stateKey, { value: true, enumerable: false, configurable: false });
    }
    const symbolFor = function(key: unknown) {
      if (typeof key !== 'symbol' && String(key) === stateKeyName) return stateKeyDecoy;
      return originalSymbolFor.call(root.Symbol, key as string);
    };
    const symbolKeyFor = function(key: symbol) {
      if (key === stateKey) return undefined;
      if (key === stateKeyDecoy) return stateKeyName;
      return originalSymbolKeyFor.call(root.Symbol, key);
    };
    functionSources.set(symbolFor, originalFunctionToString.call(originalSymbolFor));
    functionSources.set(symbolKeyFor, originalFunctionToString.call(originalSymbolKeyFor));
    root.Object.getOwnPropertySymbols = function getOwnPropertySymbols(obj: object) {
      return originalGetOwnPropertySymbols.call(Object, obj).filter((key) => !(obj === root && key === stateKey));
    };
    root.Reflect.ownKeys = function ownKeys(obj: object) {
      return originalOwnKeys.call(Reflect, obj).filter((key) => !(obj === root && key === stateKey));
    };
    root.Function.prototype.toString = function toString(this: Function) {
      return functionSources.get(this) || originalFunctionToString.call(this);
    };
    root.Object.defineProperty(root.Symbol, 'for', {
      value: symbolFor,
      configurable: true,
      writable: true
    });
    root.Object.defineProperty(root.Symbol, 'keyFor', {
      value: symbolKeyFor,
      configurable: true,
      writable: true
    });

    const language = patchConfig.language;
    const languages = patchConfig.languages && patchConfig.languages.length ? patchConfig.languages.slice() : language ? [language] : null;
    const nav = root.navigator;
    if (nav && language) {
      const navProto = root.Object.getPrototypeOf(nav);
      ['language', 'languages'].forEach((property) => {
        const descriptor = root.Object.getOwnPropertyDescriptor(navProto, property);
        if (descriptor && typeof descriptor.get === 'function') {
          const nativeGetter = descriptor.get;
          const nativeSource = originalFunctionToString.call(nativeGetter);
          const getter = new root.Proxy(nativeGetter, {
            apply(target: Function, thisArg: unknown, args: unknown[]) {
              if (thisArg === nav) return property === 'language' ? language : root.Object.freeze((languages || []).slice());
              return root.Reflect.apply(target, thisArg, args);
            }
          });
          functionSources.set(getter, nativeSource);
          root.Object.defineProperty(navProto, property, { ...descriptor, get: getter as () => unknown });
        }
      });
    }

    if (patchConfig.timezone || language) {
      const OriginalDate = root.Date;
      const OriginalDateTimeFormat = root.Intl && (root.Intl.DateTimeFormat as any);
      const originalResolvedOptions = OriginalDateTimeFormat && OriginalDateTimeFormat.prototype.resolvedOptions;
      const originalDateToString = OriginalDate && OriginalDate.prototype.toString;
      const originalDateToDateString = OriginalDate && OriginalDate.prototype.toDateString;
      const originalDateToTimeString = OriginalDate && OriginalDate.prototype.toTimeString;
      const originalDateToLocaleString = OriginalDate && OriginalDate.prototype.toLocaleString;
      const originalDateToLocaleDateString = OriginalDate && OriginalDate.prototype.toLocaleDateString;
      const originalDateToLocaleTimeString = OriginalDate && OriginalDate.prototype.toLocaleTimeString;
      const originalGetTimezoneOffset = OriginalDate && OriginalDate.prototype.getTimezoneOffset;
      const normalizeLocale = (locales?: string | string[]) => language || locales;
      const normalizeIntlOptions = (options?: Intl.DateTimeFormatOptions) => {
        const normalized = { ...(options || {}) };
        if (patchConfig.timezone) normalized.timeZone = patchConfig.timezone;
        return normalized;
      };
      const registerSource = (replacement: unknown, nativeFunction?: Function) => {
        if (typeof replacement === 'function' && typeof nativeFunction === 'function') {
          functionSources.set(replacement, originalFunctionToString.call(nativeFunction));
        }
      };
      const replaceMethod = (owner: object, property: string, replacement: Function, nativeFunction?: Function) => {
        const descriptor = originalGetOwnPropertyDescriptor.call(root.Object, owner, property);
        registerSource(replacement, nativeFunction || descriptor?.value);
        root.Object.defineProperty(owner, property, {
          ...(descriptor || { configurable: true, enumerable: false, writable: true }),
          value: replacement
        });
      };

      if (root.Intl && OriginalDateTimeFormat) {
        function SpoofedDateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return new OriginalDateTimeFormat(normalizeLocale(locales), normalizeIntlOptions(options));
        }
        originalSetPrototypeOf.call(root.Object, SpoofedDateTimeFormat, OriginalDateTimeFormat);
        SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
        if (typeof OriginalDateTimeFormat.supportedLocalesOf === 'function') {
          (SpoofedDateTimeFormat as any).supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
        }
        registerSource(SpoofedDateTimeFormat, OriginalDateTimeFormat);
        root.Object.defineProperty(root.Intl, 'DateTimeFormat', {
          ...(originalGetOwnPropertyDescriptor.call(root.Object, root.Intl, 'DateTimeFormat') || { configurable: true, enumerable: false, writable: true }),
          value: SpoofedDateTimeFormat
        });

        if (typeof originalResolvedOptions === 'function') {
          replaceMethod(OriginalDateTimeFormat.prototype, 'resolvedOptions', function resolvedOptions(this: Intl.DateTimeFormat) {
            const options = originalResolvedOptions.call(this);
            return {
              ...options,
              locale: language || options.locale,
              timeZone: patchConfig.timezone || options.timeZone
            };
          }, originalResolvedOptions);
        }

        const intlRecord = root.Intl as unknown as Record<string, any>;
        ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
          .forEach((name) => {
            const OriginalCtor = intlRecord[name];
            if (typeof OriginalCtor !== 'function') return;
            function SpoofedIntlConstructor(locales?: string | string[], options?: unknown) {
              return new OriginalCtor(normalizeLocale(locales), options);
            }
            originalSetPrototypeOf.call(root.Object, SpoofedIntlConstructor, OriginalCtor);
            SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
            if (typeof OriginalCtor.supportedLocalesOf === 'function') {
              SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
            }
            registerSource(SpoofedIntlConstructor, OriginalCtor);
            root.Object.defineProperty(root.Intl, name, {
              ...(originalGetOwnPropertyDescriptor.call(root.Object, root.Intl, name) || { configurable: true, enumerable: false, writable: true }),
              value: SpoofedIntlConstructor
            });
          });
      }

      if (patchConfig.timezone && OriginalDate && OriginalDateTimeFormat && originalGetTimezoneOffset) {
        const getParts = (date: Date, timeZone = patchConfig.timezone) => {
          if (!timeZone) return null;
          try {
            const formatter = new OriginalDateTimeFormat('en-US', {
              timeZone,
              hourCycle: 'h23',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              weekday: 'short',
              timeZoneName: 'long'
            });
            const parts: Record<string, string> = {};
            formatter.formatToParts(date).forEach((part: Intl.DateTimeFormatPart) => {
              if (part.type !== 'literal') parts[part.type] = part.value;
            });
            return parts;
          } catch {
            return null;
          }
        };
        const resolveOffset = (date: Date) => {
          const parts = getParts(date);
          if (!parts) return originalGetTimezoneOffset.call(date);
          const asUTC = OriginalDate.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour) % 24,
            Number(parts.minute),
            Number(parts.second)
          );
          return Math.round((date.getTime() - asUTC) / 60000);
        };
        const makeWallDate = (args: IArguments | unknown[]) => {
          const year = Number(args[0]);
          const month = Number(args[1]);
          const day = args.length > 2 ? Number(args[2]) : 1;
          const hour = args.length > 3 ? Number(args[3]) : 0;
          const minute = args.length > 4 ? Number(args[4]) : 0;
          const second = args.length > 5 ? Number(args[5]) : 0;
          const ms = args.length > 6 ? Number(args[6]) : 0;
          let utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms);
          for (let index = 0; index < 3; index += 1) {
            utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms)
              + resolveOffset(new OriginalDate(utc)) * 60000;
          }
          return new OriginalDate(utc);
        };
        const getWallDate = (date: Date) => {
          const parts = getParts(date);
          if (!parts) return null;
          return new OriginalDate(OriginalDate.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour) % 24,
            Number(parts.minute),
            Number(parts.second),
            date.getUTCMilliseconds()
          ));
        };
        const pad = (value: number) => String(value).padStart(2, '0');
        const formatOffset = (date: Date) => {
          const offset = resolveOffset(date);
          const sign = offset <= 0 ? '+' : '-';
          const abs = Math.abs(offset);
          return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
        };

        function SpoofedDate(this: Date, ...args: unknown[]) {
          if (!(this instanceof SpoofedDate)) {
            return new (SpoofedDate as any)().toString();
          }
          if (args.length === 0) return new OriginalDate();
          if (args.length === 1) return new OriginalDate(args[0] as any);
          return makeWallDate(args);
        }
        originalSetPrototypeOf.call(root.Object, SpoofedDate, OriginalDate);
        SpoofedDate.prototype = OriginalDate.prototype;
        SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
        SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
        SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
        registerSource(SpoofedDate, OriginalDate);
        root.Object.defineProperty(root, 'Date', {
          ...(originalGetOwnPropertyDescriptor.call(root.Object, root, 'Date') || { configurable: true, enumerable: false, writable: true }),
          value: SpoofedDate
        });

        replaceMethod(OriginalDate.prototype, 'getTimezoneOffset', function getTimezoneOffset(this: Date) {
          return resolveOffset(this);
        }, originalGetTimezoneOffset);
        replaceMethod(OriginalDate.prototype, 'getFullYear', function getFullYear(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
        });
        replaceMethod(OriginalDate.prototype, 'getYear', function getYear(this: Date) {
          return this.getFullYear() - 1900;
        });
        replaceMethod(OriginalDate.prototype, 'getMonth', function getMonth(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCMonth() : this.getUTCMonth();
        });
        replaceMethod(OriginalDate.prototype, 'getDate', function getDate(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCDate() : this.getUTCDate();
        });
        replaceMethod(OriginalDate.prototype, 'getDay', function getDay(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCDay() : this.getUTCDay();
        });
        replaceMethod(OriginalDate.prototype, 'getHours', function getHours(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCHours() : this.getUTCHours();
        });
        replaceMethod(OriginalDate.prototype, 'getMinutes', function getMinutes(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
        });
        replaceMethod(OriginalDate.prototype, 'getSeconds', function getSeconds(this: Date) {
          const wall = getWallDate(this);
          return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
        });
        replaceMethod(OriginalDate.prototype, 'getMilliseconds', function getMilliseconds(this: Date) {
          return this.getUTCMilliseconds();
        });
        replaceMethod(OriginalDate.prototype, 'toDateString', function toDateString(this: Date) {
          const parts = getParts(this);
          if (!parts) return originalDateToDateString.call(this);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
          return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
        }, originalDateToDateString);
        replaceMethod(OriginalDate.prototype, 'toTimeString', function toTimeString(this: Date) {
          const parts = getParts(this);
          if (!parts) return originalDateToTimeString.call(this);
          return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
        }, originalDateToTimeString);
        replaceMethod(OriginalDate.prototype, 'toString', function toString(this: Date) {
          const parts = getParts(this);
          if (!parts) return originalDateToString.call(this);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
          return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
        }, originalDateToString);
      }

      if (OriginalDate) {
        if (originalDateToLocaleString) {
          replaceMethod(OriginalDate.prototype, 'toLocaleString', function toLocaleString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
            return originalDateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
          }, originalDateToLocaleString);
        }
        if (originalDateToLocaleDateString) {
          replaceMethod(OriginalDate.prototype, 'toLocaleDateString', function toLocaleDateString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
            return originalDateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
          }, originalDateToLocaleDateString);
        }
        if (originalDateToLocaleTimeString) {
          replaceMethod(OriginalDate.prototype, 'toLocaleTimeString', function toLocaleTimeString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
            return originalDateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
          }, originalDateToLocaleTimeString);
        }
      }
    }

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
      const WorkerWrapper = function Worker(this: Worker, scriptURL: string | URL, options?: WorkerOptions) {
        try {
          return new NativeWorker(makeWorkerUrl(scriptURL, options), options);
        } catch {
          return new NativeWorker(scriptURL, options);
        }
      };
      functionSources.set(WorkerWrapper, originalFunctionToString.call(NativeWorker));
      root.Object.setPrototypeOf(WorkerWrapper, NativeWorker);
      WorkerWrapper.prototype = NativeWorker.prototype;
      root.Worker = WorkerWrapper as unknown as typeof Worker;
    }
  }

  function buildWorkerPatchSource(patchConfig: { timezone: string | null; language: string | null; languages: string[] | null }): string {
    return `;(${workerBootstrap.toString()})(${JSON.stringify(patchConfig)});`;
  }

  function installWorkerHooks(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState,
    patchSource: string
  ): void {
    if (!patchSource || realmState.installedSurfaces.has('worker')) return;
    realmState.installedSurfaces.add('worker');

    const makeWorkerUrl = (scriptURL: string | URL, options?: WorkerOptions) => {
      const pageUrl = new globals.URL(globals.location?.href || location.href);
      const sourceUrl = new globals.URL(String(scriptURL), pageUrl.href);
      if (!/^https?:$/.test(sourceUrl.protocol) || sourceUrl.origin !== pageUrl.origin) {
        return null;
      }
      const isModule = options && typeof options === 'object' && options.type === 'module';
      const body = isModule
        ? `${patchSource}\nawait import(${JSON.stringify(sourceUrl.href)});`
        : `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl.href)});`;
      return globals.URL.createObjectURL(new globals.Blob([body], { type: 'text/javascript' }));
    };

    if (typeof globals.Worker === 'function') {
      const NativeWorker = globals.Worker;
      const workerDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals, 'Worker');
      const WorkerWrapper = function Worker(this: Worker, scriptURL: string | URL, options?: WorkerOptions) {
        try {
          const workerUrl = makeWorkerUrl(scriptURL, options);
          return new NativeWorker(workerUrl || scriptURL, options);
        } catch {
          return new NativeWorker(scriptURL, options);
        }
      };
      realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, WorkerWrapper, NativeWorker);
      (WorkerWrapper as unknown as typeof Worker).prototype = NativeWorker.prototype;
      registerFunctionSource(realmState, WorkerWrapper, nativeSourceFor(realmState, NativeWorker));
      defineRegisteredProperty(globals, realmState, globals, 'Worker', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: WorkerWrapper as unknown as typeof Worker
      }, 'worker', workerDescriptor);
    }

    if (typeof globals.SharedWorker === 'function') {
      const NativeSharedWorker = globals.SharedWorker;
      const sharedWorkerDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, globals, 'SharedWorker');
      const SharedWorkerWrapper = function SharedWorker(this: SharedWorker, scriptURL: string | URL, optionsOrName?: string | WorkerOptions) {
        try {
          const options = optionsOrName && typeof optionsOrName === 'object' ? optionsOrName : undefined;
          const workerUrl = makeWorkerUrl(scriptURL, options);
          return new NativeSharedWorker(workerUrl || scriptURL, optionsOrName as any);
        } catch {
          return new NativeSharedWorker(scriptURL, optionsOrName as any);
        }
      };
      realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SharedWorkerWrapper, NativeSharedWorker);
      (SharedWorkerWrapper as unknown as typeof SharedWorker).prototype = NativeSharedWorker.prototype;
      registerFunctionSource(realmState, SharedWorkerWrapper, nativeSourceFor(realmState, NativeSharedWorker));
      defineRegisteredProperty(globals, realmState, globals, 'SharedWorker', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: SharedWorkerWrapper as unknown as typeof SharedWorker
      }, 'worker', sharedWorkerDescriptor);
    }
  }

  function installIframePropagation(
    globals: typeof globalThis & Record<string, any>,
    realmState: AntiDetectionState
  ): void {
    if (realmState.installedSurfaces.has('iframe') || !globals.document?.createElement) return;
    realmState.installedSurfaces.add('iframe');

    const documentTarget = globals.document;
    const documentPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, documentTarget);
    const prototypeDescriptor = documentPrototype
      ? realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, documentPrototype, 'createElement')
      : undefined;
    const ownDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, documentTarget, 'createElement');
    const createElementOwner = prototypeDescriptor ? documentPrototype : documentTarget;
    const originalDescriptor = prototypeDescriptor || ownDescriptor;
    const originalCreateElement = originalDescriptor && typeof originalDescriptor.value === 'function'
      ? originalDescriptor.value
      : documentTarget.createElement;
    if (typeof originalCreateElement !== 'function') return;

    const applyToFrame = (element: HTMLIFrameElement) => {
      try {
        const frameWindow = element.contentWindow as (typeof globalThis & Record<string, any>) | null;
        if (!frameWindow || !realmState.lastPayload) return;
        void frameWindow.location.href;
        applySpoofToRealm(frameWindow, realmState.lastPayload);
      } catch {
        // Cross-origin frames are explicitly out of scope for first-version propagation.
      }
    };

    const createElement = createNativeProxyFunction(globals, realmState, originalCreateElement, (target, thisArg, args) => {
      const element = realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
      const tagName = String(args[0] || '').toLowerCase();
      if (tagName === 'iframe' && element && typeof element.addEventListener === 'function') {
        element.addEventListener('load', () => applyToFrame(element as HTMLIFrameElement));
        globals.setTimeout?.(() => applyToFrame(element as HTMLIFrameElement), 0);
      }
      return element;
    });

    defineRegisteredProperty(globals, realmState, createElementOwner, 'createElement', {
      ...(originalDescriptor || { configurable: true, enumerable: false, writable: true }),
      value: createElement
    }, 'iframe', originalDescriptor);
  }

  function applySpoofToRealm(globals: typeof globalThis & Record<string, any>, payload: RuntimePayload): void {
    if (!payload) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;

    const realmState = getAntiDetectionState(globals);
    realmState.debugMode = Boolean(payload.debugMode);
    realmState.lastPayload = payload;

    const geolocation = payload.geolocation || (
      Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude))
        ? { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
        : null
    );
    const timezonePayload = normalizeTimezonePayload(payload);
    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const spoofLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const spoofLanguages = languageConfig && Array.isArray(languageConfig.languages) && languageConfig.languages.length
      ? languageConfig.languages
      : spoofLanguage ? [spoofLanguage] : null;

    installLanguageSpoof(globals, realmState, spoofLanguage, spoofLanguages);
    installGeolocationSpoof(globals, realmState, geolocation);
    installDateTimeSpoof(globals, realmState, { timezone: timezonePayload.timezone, language: spoofLanguage });
    installCanvasSpoof(globals, realmState, payload.canvasConfig);
    installWorkerHooks(globals, realmState, buildWorkerPatchSource({
      timezone: timezonePayload.timezone,
      language: spoofLanguage,
      languages: spoofLanguages
    }));
    installIframePropagation(globals, realmState);
    log('applied payload', payload);
  }

  if (!state.listenerInstalled) {
    state.listenerInstalled = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'vanishgeo-extension' || data.type !== 'apply-spoof') return;
      applySpoofToRealm(root, data.payload);
    });
  }
})();
