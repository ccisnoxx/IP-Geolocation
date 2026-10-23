import type { RuntimePayload, RuntimeState } from '../types';
import { createNativeProxyFunction, replaceMethod } from '../registry';

export function randomCoordinateInRadius(lat: number, lon: number, radiusMeters: number) {
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

export function getStableGeolocationCoordinate(realmState: RuntimeState, geolocation: NonNullable<RuntimePayload['geolocation']>) {
  const { latitude, longitude } = geolocation;
  const radius = geolocation.randomRadiusMeters || 0;
  const key = [latitude, longitude, geolocation.randomize === true, radius].join('|');
  if (realmState.values.geolocationCoordinate?.key === key) return realmState.values.geolocationCoordinate;
  const coordinate = geolocation.randomize && radius > 0
    ? randomCoordinateInRadius(latitude, longitude, radius)
    : { latitude, longitude };
  realmState.values.geolocationCoordinate = { key, ...coordinate };
  return realmState.values.geolocationCoordinate;
}

// 原型兼容不等于浏览器内部 slot；原生 prototype getter 仍会拒绝这些合成对象。
function readonlyObject(globals: typeof globalThis & Record<string, any>, prototype: object | undefined, fields: Record<string, unknown>) {
  const result = globals.Object.create(prototype || globals.Object.prototype);
  for (const [key, value] of Object.entries(fields)) {
    globals.Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}

export function buildGeolocationPosition(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  geolocation: NonNullable<RuntimePayload['geolocation']>
): GeolocationPosition {
  const coordinate = getStableGeolocationCoordinate(realmState, geolocation);
  const fields = {
    latitude: coordinate.latitude, longitude: coordinate.longitude, accuracy: geolocation.accuracy ?? 50,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null
  };
  const coords = readonlyObject(globals, globals.GeolocationCoordinates?.prototype, fields);
  globals.Object.defineProperty(coords, 'toJSON', { value: function toJSON() { return { ...fields }; } });
  globals.Object.freeze(coords);
  const timestamp = globals.Date.now();
  const position = readonlyObject(globals, globals.GeolocationPosition?.prototype, { coords, timestamp });
  globals.Object.defineProperty(position, 'toJSON', {
    value: function toJSON() { return { coords: { ...fields }, timestamp }; }
  });
  return globals.Object.freeze(position);
}

type PositionRequest = {
  id: number | null;
  success: PositionCallback;
  error: PositionErrorCallback | null;
  options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number };
  active: boolean;
  delivered: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  querying: boolean;
};

export function installGeolocationSpoof(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  geolocation: RuntimePayload['geolocation']
): void {
  if (!geolocation || geolocation.enabled === false || realmState.installedSurfaces.has('geolocation')) return;
  if (!/^https?:$/.test(globals.location?.protocol) || globals.origin === 'null' || globals.isSecureContext !== true) return;
  const navigatorTarget = globals.navigator as Navigator;
  const geo = navigatorTarget?.geolocation;
  const document = globals.document as Document | undefined;
  if (!geo || !document) return;
  const geoOwner = realmState.originals.objectGetPrototypeOf(geo);
  if (!geoOwner || geoOwner !== globals.Geolocation?.prototype || !['getCurrentPosition', 'watchPosition', 'clearWatch'].every(name =>
    typeof realmState.originals.objectGetOwnPropertyDescriptor(geoOwner, name)?.value === 'function')) return;
  const nativeClearWatch = realmState.originals.objectGetOwnPropertyDescriptor(geoOwner, 'clearWatch')!.value as Geolocation['clearWatch'];
  const permissions = navigatorTarget.permissions;
  const queryOwner = permissions && realmState.originals.objectGetPrototypeOf(permissions);
  const nativeQuery = queryOwner === globals.Permissions?.prototype
    ? realmState.originals.objectGetOwnPropertyDescriptor(queryOwner, 'query')?.value as Permissions['query'] | undefined
    : undefined;
  const apply = realmState.originals.reflectApply;
  const snapshot = { ...geolocation };
  getStableGeolocationCoordinate(realmState, snapshot);
  realmState.installedSurfaces.add('geolocation');

  const requests = new Set<PositionRequest>();
  const watches = new Map<number, PositionRequest>();
  const frameElement = globals.frameElement as Element | null;
  let nextWatchId = 1;
  let frozen = false;
  let suspended = false;
  let disposed = false;
  let hidden = document.visibilityState === 'hidden';
  let cached: { position: GeolocationPosition; highAccuracy: boolean } | null = null;
  const visible = () => !disposed && !suspended && !frozen && document.visibilityState !== 'hidden'
    && globals.closed !== true && (!frameElement || frameElement.isConnected);
  const policyAllows = () => {
    const policyDocument = document as Document & {
      permissionsPolicy?: { allowsFeature(feature: string): boolean };
      featurePolicy?: { allowsFeature(feature: string): boolean };
    };
    const policy = policyDocument.permissionsPolicy || policyDocument.featurePolicy;
    return !policy || policy.allowsFeature('geolocation');
  };
  const errorPosition = (code: number): GeolocationPositionError => globals.Object.freeze(readonlyObject(
    globals, globals.GeolocationPositionError?.prototype, {
      code, message: code === 1 ? 'Geolocation permission denied' : code === 3 ? 'Geolocation request timed out' : 'Geolocation permission unavailable',
      PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3
    }
  ));
  const stopPending = (request: PositionRequest) => {
    request.generation += 1;
    request.querying = false;
    if (request.timer !== null) globals.clearTimeout(request.timer);
    request.timer = null;
  };
  const retire = (request: PositionRequest) => {
    stopPending(request);
    request.active = false;
    requests.delete(request);
    if (request.id !== null) watches.delete(request.id);
  };
  const resolvePermission = async (): Promise<{ code: number; status?: PermissionStatus }> => {
    if (!policyAllows()) return { code: 1 };
    if (snapshot.spoofPermission !== false) return { code: 0 };
    if (typeof nativeQuery !== 'function') return { code: 2 };
    const status = await apply(nativeQuery, permissions, [{ name: 'geolocation' }]) as PermissionStatus;
    return { code: status.state === 'granted' ? 0 : 1, status };
  };
  const schedule = (request: PositionRequest) => {
    if (!request.active || request.delivered || request.timer !== null || request.querying || !visible()) return;
    const generation = request.generation;
    request.timer = globals.setTimeout(() => {
      request.timer = null;
      request.querying = true;
      const enqueueResult = (permission: { code: number; status?: PermissionStatus }) => {
        if (!request.active || generation !== request.generation) return;
        request.querying = false;
        if (!visible()) return;
        request.timer = globals.setTimeout(() => {
          request.timer = null;
          if (!request.active || generation !== request.generation || !visible()) return;
          let resultCode = permission.code;
          // 在回调任务交付前再次检查文档策略；权限等待不消耗 acquisition timeout。
          try {
            if (!policyAllows() || permission.status && permission.status.state !== 'granted') resultCode = 1;
          } catch { resultCode = 2; }
          let position: GeolocationPosition | null = null;
          if (resultCode === 0) {
            if (cached && request.options.maximumAge > 0
              && cached.position.timestamp > globals.Date.now() - request.options.maximumAge
              && cached.highAccuracy === request.options.enableHighAccuracy) position = cached.position;
            else if (request.options.timeout === 0) resultCode = 3;
            else {
              position = buildGeolocationPosition(globals, realmState, snapshot);
              cached = { position, highAccuracy: request.options.enableHighAccuracy };
            }
          }
          request.delivered = true;
          if (request.id === null || resultCode === 1) retire(request);
          // 回调异常由浏览器报告，不能被转换为另一次定位 error 回调。
          if (resultCode) { if (request.error) apply(request.error, undefined, [errorPosition(resultCode)]); }
          else apply(request.success, undefined, [position]);
        }, 0);
      };
      resolvePermission().then(enqueueResult, () => enqueueResult({ code: 2 }));
    }, 0);
  };
  const clampUnsignedLong = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    const number = +(value as number);
    if (Number.isNaN(number) || number <= 0) return 0;
    if (number >= 0xFFFFFFFF) return 0xFFFFFFFF;
    const floor = Math.floor(number);
    const fraction = number - floor;
    return fraction === 0.5 ? floor + floor % 2 : Math.round(number);
  };
  const convertArguments = (args: unknown[]) => {
    if (typeof args[0] !== 'function') throw new TypeError('Geolocation success callback must be a function');
    if (args[1] != null && typeof args[1] !== 'function') throw new TypeError('Geolocation error callback must be a function');
    const options = args[2];
    if (options != null && typeof options !== 'object' && typeof options !== 'function') {
      throw new TypeError('Geolocation options must be a dictionary');
    }
    const source = options as PositionOptions | null | undefined;
    // WebIDL 字典按成员名排序读取和转换，每个成员只读取一次。
    const enableHighAccuracy = Boolean(source?.enableHighAccuracy);
    const maximumAge = clampUnsignedLong(source?.maximumAge, 0);
    const timeout = clampUnsignedLong(source?.timeout, 0xFFFFFFFF);
    return { success: args[0] as PositionCallback, error: (args[1] ?? null) as PositionErrorCallback | null,
      options: { enableHighAccuracy, maximumAge, timeout } };
  };
  const requestPosition = (watch: boolean, args: unknown[]) => {
    const converted = convertArguments(args);
    // options getter/转换可以重入；转换完成后才为本次请求分配并预留 ID。
    const id = watch ? nextWatchId : null;
    if (id !== null) nextWatchId = nextWatchId === 0x7FFFFFFF ? 1 : nextWatchId + 1;
    const request: PositionRequest = { ...converted, id, active: true, delivered: false, generation: 0, timer: null, querying: false };
    if (!disposed) {
      requests.add(request);
      if (id !== null) watches.set(id, request);
      schedule(request);
    }
    return id;
  };
  for (const name of ['getCurrentPosition', 'watchPosition', 'clearWatch'] as const) {
    const nativeMethod = realmState.originals.objectGetOwnPropertyDescriptor(geoOwner, name)!.value as Geolocation[typeof name];
    replaceMethod(globals, realmState, geoOwner, name, createNativeProxyFunction(globals, nativeMethod, (target, thisArg, args) => {
      if (thisArg !== geo) {
        // clearWatch(0) 只作无定位副作用的原生品牌检查；合法其他 realm 保持原生路径。
        apply(nativeClearWatch, thisArg, [0]);
        return apply(target, thisArg, args);
      }
      if (name === 'clearWatch') {
        if (!args.length) throw new TypeError('Geolocation clearWatch requires a watch id');
        const id = +(args[0] as number) >> 0;
        const request = watches.get(id);
        if (request) retire(request);
        return;
      }
      const id = requestPosition(name === 'watchPosition', args);
      if (id !== null) return id;
    }));
  }

  if (snapshot.spoofPermission !== false && typeof nativeQuery === 'function') {
    const syntheticStatuses = new WeakMap<object, { handler: unknown; listener: EventListener }>();
    const wrapStatus = (nativeStatus: PermissionStatus): PermissionStatus => {
      // 原生查询/读取失败继续拒绝；合成授权不随浏览器的真实授权事件改变。
      void nativeStatus.state;
      const prototype = realmState.originals.objectGetPrototypeOf(nativeStatus);
      const stateGetter = realmState.originals.objectGetOwnPropertyDescriptor(prototype, 'state')?.get;
      const nameGetter = realmState.originals.objectGetOwnPropertyDescriptor(prototype, 'name')?.get;
      const onchangeDescriptor = realmState.originals.objectGetOwnPropertyDescriptor(prototype, 'onchange');
      const status = new globals.EventTarget() as PermissionStatus;
      realmState.originals.objectSetPrototypeOf(status, prototype);
      const eventState = { handler: null as unknown, listener: ((event: Event) => {
        if (typeof eventState.handler === 'function' && apply(eventState.handler, status, [event]) === false) event.preventDefault();
      }) as EventListener };
      syntheticStatuses.set(status, eventState);
      const readNative = (getter: Function | undefined, receiver: unknown) => {
        if (!getter) throw new TypeError('PermissionStatus receiver');
        return apply(getter, receiver, []);
      };
      realmState.originals.objectDefineProperty(status, 'state', {
        configurable: true, enumerable: true,
        get: function state(this: object) {
          return syntheticStatuses.has(this) ? policyAllows() ? 'granted' : 'denied' : readNative(stateGetter, this);
        }
      });
      realmState.originals.objectDefineProperty(status, 'name', {
        configurable: true, enumerable: true,
        get: function name(this: object) {
          return syntheticStatuses.has(this) ? 'geolocation' : readNative(nameGetter, this);
        }
      });
      realmState.originals.objectDefineProperty(status, 'onchange', {
        configurable: true, enumerable: true,
        get: function onchange(this: object) {
          const current = syntheticStatuses.get(this);
          return current ? current.handler : readNative(onchangeDescriptor?.get, this);
        },
        set: function onchange(this: object, value: unknown) {
          const current = syntheticStatuses.get(this);
          if (!current) {
            if (!onchangeDescriptor?.set) throw new TypeError('PermissionStatus receiver');
            apply(onchangeDescriptor.set, this, [value]);
            return;
          }
          // EventHandler 的非对象转 null；非 callable 对象保留引用但调用时无操作。
          const next = value !== null && (typeof value === 'object' || typeof value === 'function') ? value : null;
          if (current.handler === null && next !== null) {
            apply(globals.EventTarget.prototype.addEventListener, this, ['change', current.listener]);
          } else if (current.handler !== null && next === null) {
            apply(globals.EventTarget.prototype.removeEventListener, this, ['change', current.listener]);
          }
          current.handler = next;
        }
      });
      return status;
    };
    if (queryOwner && realmState.originals.objectGetOwnPropertyDescriptor(queryOwner, 'query')) {
      replaceMethod(globals, realmState, queryOwner, 'query', createNativeProxyFunction(globals, nativeQuery, (target, thisArg, args) => {
        if (thisArg !== permissions || args[0] === null || typeof args[0] !== 'object' && typeof args[0] !== 'function') {
          return apply(target, thisArg, args);
        }
        try {
          const descriptor = args[0] as PermissionDescriptor;
          const name = `${descriptor.name}`;
          const converted = new globals.Proxy({}, {
            get(_object: object, property: PropertyKey) {
              return property === 'name' ? name : globals.Reflect.get(descriptor, property, descriptor);
            }
          });
          const result = apply(target, thisArg, [converted, ...args.slice(1)]);
          return name === 'geolocation' ? globals.Promise.resolve(result).then(wrapStatus) : result;
        } catch (error) { return globals.Promise.reject(error); }
      }));
    }
  }

  const pause = () => { for (const request of requests) stopPending(request); };
  const resume = () => {
    for (const request of requests) { request.delivered = false; schedule(request); }
  };
  const onVisibility = () => {
    const nextHidden = document.visibilityState === 'hidden';
    if (hidden === nextHidden) return;
    hidden = nextHidden;
    if (hidden) pause(); else resume();
  };
  const onFreeze = () => { frozen = true; pause(); };
  const onResume = () => { if (frozen) { frozen = false; resume(); } };
  const onPageShow = () => { if (suspended) { suspended = false; resume(); } };
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) { suspended = true; pause(); return; }
    disposed = true;
    for (const request of requests) retire(request);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    globals.removeEventListener('pagehide', onPageHide);
    globals.removeEventListener('pageshow', onPageShow);
  };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);
  globals.addEventListener('pagehide', onPageHide);
  globals.addEventListener('pageshow', onPageShow);
}
