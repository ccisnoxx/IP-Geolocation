import type { RuntimePayload, RuntimeState, RuntimeGeolocation } from '../types';
import { createNativeProxyFunction, replaceMethod } from '../registry';
import { createConversionObserver } from './font-conversion';

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

export function getStableGeolocationCoordinate(realmState: RuntimeState, geolocation: RuntimeGeolocation) {
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

// 错误对象沿用现有只读字段；Position/Coordinates 的值由私有 WeakMap 持有。
function readonlyObject(globals: typeof globalThis & Record<string, any>, prototype: object | undefined, fields: Record<string, unknown>) {
  const result = globals.Object.create(prototype || globals.Object.prototype);
  for (const [key, value] of Object.entries(fields)) {
    globals.Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}

function geolocationObjects(globals: typeof globalThis & Record<string, any>, state: RuntimeState) {
  if (state.geolocationObjects) return state.geolocationObjects;
  const coordinates = new WeakMap<object, Record<string, number | null>>();
  const positions = new WeakMap<object, { coords: GeolocationCoordinates; timestamp: number }>();
  const apply = state.originals.reflectApply;
  const install = (prototype: object, store: WeakMap<object, any>, names: string[], serialize: (record: any) => unknown) => {
    for (const name of names) {
      const descriptor = state.originals.objectGetOwnPropertyDescriptor(prototype, name)!;
      state.originals.objectDefineProperty(prototype, name, { ...descriptor,
        get: createNativeProxyFunction(globals, descriptor.get!, (target, receiver) => {
          const record = store.get(receiver as object);
          return record ? record[name] : apply(target, receiver, []);
        })
      });
    }
    const nativeToJSON = state.originals.objectGetOwnPropertyDescriptor(prototype, 'toJSON')!.value;
    // 已交付Position的寿命独立于策略；只读适配器保留至realm销毁，不继续产生定位值。
    state.originals.objectDefineProperty(prototype, 'toJSON', {
      ...state.originals.objectGetOwnPropertyDescriptor(prototype, 'toJSON'),
      value: createNativeProxyFunction(globals, nativeToJSON, (target, receiver, args) => {
        const record = store.get(receiver as object);
        return record ? serialize(record) : apply(target, receiver, args);
      })
    });
  };
  install(globals.GeolocationCoordinates.prototype, coordinates,
    ['latitude', 'longitude', 'accuracy', 'altitude', 'altitudeAccuracy', 'heading', 'speed'], record => ({ ...record }));
  install(globals.GeolocationPosition.prototype, positions, ['coords', 'timestamp'], record => ({
    coords: { ...coordinates.get(record.coords)! }, timestamp: record.timestamp
  }));
  state.geolocationObjects = { coordinates, positions };
  return state.geolocationObjects;
}

export function buildGeolocationPosition(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  geolocation: RuntimeGeolocation
): GeolocationPosition {
  const coordinate = getStableGeolocationCoordinate(realmState, geolocation);
  const fields = {
    latitude: coordinate.latitude, longitude: coordinate.longitude, accuracy: geolocation.accuracy ?? 50,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null
  };
  const store = geolocationObjects(globals, realmState);
  const coords = globals.Object.create(globals.GeolocationCoordinates.prototype);
  store.coordinates.set(coords, fields);
  const timestamp = globals.Date.now();
  const position = globals.Object.create(globals.GeolocationPosition.prototype);
  store.positions.set(position, { coords, timestamp });
  return position;
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
  const apply = realmState.originals.reflectApply;
  const observeConversion = createConversionObserver(globals, apply);
  const snapshot = 'unavailable' in geolocation ? null : { ...geolocation };
  if (snapshot) getStableGeolocationCoordinate(realmState, snapshot);
  realmState.installedSurfaces.add('geolocation');

  const requests = new Set<PositionRequest>();
  const watches = new Map<number, PositionRequest>();
  const nativeWatches = new Set<number>();
  const nativeRequests = new Set<{ active: boolean; error: Function | null }>();
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
  const resolvePermission = async (): Promise<{ code: number }> => {
    if (!policyAllows()) return { code: 1 };
    return { code: snapshot ? 0 : 2 };
  };
  const schedule = (request: PositionRequest) => {
    if (!request.active || request.delivered || request.timer !== null || request.querying || !visible()) return;
    const generation = request.generation;
    request.timer = globals.setTimeout(() => {
      request.timer = null;
      request.querying = true;
      const enqueueResult = (permission: { code: number }) => {
        if (!request.active || generation !== request.generation) return;
        request.querying = false;
        if (!visible()) return;
        request.timer = globals.setTimeout(() => {
          request.timer = null;
          if (!request.active || generation !== request.generation || !visible()) return;
          let resultCode = permission.code;
          // 在回调任务交付前再次检查文档策略；权限等待不消耗 acquisition timeout。
          try {
            if (!policyAllows()) resultCode = 1;
          } catch { resultCode = 2; }
          let position: GeolocationPosition | null = null;
          if (resultCode === 0) {
            if (cached && request.options.maximumAge > 0
              && cached.position.timestamp > globals.Date.now() - request.options.maximumAge
              && cached.highAccuracy === request.options.enableHighAccuracy) position = cached.position;
            else if (request.options.timeout === 0) resultCode = 3;
            else {
              position = buildGeolocationPosition(globals, realmState, snapshot!);
              cached = { position, highAccuracy: request.options.enableHighAccuracy };
            }
          }
          request.delivered = true;
          if (request.id === null || resultCode === 1) retire(request);
          if (request.id !== null && resultCode === 0) request.timer = globals.setTimeout(() => {
            request.timer = null; request.delivered = false; schedule(request);
          }, 3000);
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
      if (snapshot?.spoofPermission === false) {
        // release 合同：原生方法拥有授权、传感器、options转换及回调节奏；只替换成功值。
        if (name === 'clearWatch') {
          let converted = args[0];
          const forwarded = converted !== null && (typeof converted === 'object' || typeof converted === 'function')
            ? [observeConversion(converted, value => { converted = value; }), ...args.slice(1)] : args;
          const result = apply(target, thisArg, forwarded);
          // 观察同一次原生转换；异常由原方法拥有，不重复调用用户valueOf。
          if (args.length && (converted === null || typeof converted !== 'object' && typeof converted !== 'function')) nativeWatches.delete(+(converted as number) >> 0);
          return result;
        }
        if (typeof args[0] !== 'function') return apply(target, thisArg, args);
        const success = args[0] as PositionCallback;
        const onError = args[1];
        const pending = { active: true, error: typeof onError === 'function' ? onError : null };
        if (name === 'getCurrentPosition') nativeRequests.add(pending);
        let result;
        try {
          result = apply(target, thisArg, [function successPosition() {
            nativeRequests.delete(pending);
            if (realmState.active && pending.active) apply(success, undefined, [buildGeolocationPosition(globals, realmState, snapshot)]);
          }, typeof onError === 'function' ? function nativeError(error: GeolocationPositionError) {
            nativeRequests.delete(pending);
            if (realmState.active && pending.active) apply(onError, undefined, [error]);
          } : onError, ...args.slice(2)]);
        } catch (error) { pending.active = false; nativeRequests.delete(pending); throw error; }
        if (name === 'watchPosition') nativeWatches.add(result);
        return result;
      }
      if (name === 'clearWatch') {
        if (!args.length) throw new TypeError('Geolocation clearWatch requires a watch id');
        const id = +(args[0] as number) >> 0;
        const request = watches.get(id);
        if (request) retire(request);
        else return apply(target, thisArg, [id]);
        return;
      }
      const id = requestPosition(name === 'watchPosition', args);
      if (id !== null) return id;
    }));
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
  realmState.cleanup.push(() => {
    const errors: unknown[] = [];
    const cancelled = [...requests].filter(request => request.id === null && request.active && !request.delivered && request.error).map(request => request.error!)
      .concat([...nativeRequests].filter(request => request.active && request.error).map(request => request.error as PositionErrorCallback));
    if (!disposed && !realmState.documentExiting && cancelled.length) {
      // 同文档更新必须完成oneshot；隐藏/冻结期间等待可见，退出则不再向旧文档交付。
      let suspended = false, frozen = false, exited = false, timer: ReturnType<typeof setTimeout> | null = null;
      const stop = () => {
        exited = true;
        if (timer !== null) globals.clearTimeout(timer);
        document.removeEventListener('visibilitychange', attempt); document.removeEventListener('resume', resumed);
        document.removeEventListener('freeze', freeze); globals.removeEventListener('pageshow', shown); globals.removeEventListener('pagehide', hide);
      };
      const attempt = () => {
        if (exited || timer !== null || suspended || frozen || document.visibilityState === 'hidden') return;
        timer = globals.setTimeout(() => {
          timer = null;
          if (document.visibilityState === 'hidden' || suspended || frozen) return;
          if (exited || globals.closed || frameElement && !frameElement.isConnected) { stop(); return; }
          const callback = cancelled.shift()!;
          // 每个callback独立任务；真正交付前重查生命周期，异常也不吞掉其他请求。
          try { apply(callback, undefined, [errorPosition(2)]); }
          finally { if (cancelled.length) attempt(); else stop(); }
        }, 0);
      };
      const freeze = () => { frozen = true; };
      const resumed = () => { frozen = false; attempt(); };
      const shown = () => { suspended = false; attempt(); };
      const hide = (event: PageTransitionEvent) => { if (event.persisted) suspended = true; else stop(); };
      document.addEventListener('visibilitychange', attempt); document.addEventListener('resume', resumed);
      document.addEventListener('freeze', freeze); globals.addEventListener('pageshow', shown); globals.addEventListener('pagehide', hide);
      attempt();
    }
    for (const pending of nativeRequests) {
      pending.active = false;
    }
    nativeRequests.clear();
    for (const id of nativeWatches) {
      try { apply(nativeClearWatch, geo, [id]); } catch (error) { errors.push(error); }
    }
    nativeWatches.clear();
    onPageHide({ persisted: false } as PageTransitionEvent);
    if (errors.length) throw Object.assign(new Error('原生定位watch清理未完成'), { errors });
  });
}
