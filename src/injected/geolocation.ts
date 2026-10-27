export interface GeolocationConfigPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  randomize: boolean;
  randomRadiusMeters: number;
  spoofPermission: boolean;
}

/** 坐标解析不出来时的 fail-closed 模式：不碰原生权限，直接返回 POSITION_UNAVAILABLE */
export interface GeolocationDenyPayload {
  deny: true;
}

export type GeolocationPayload = GeolocationConfigPayload | GeolocationDenyPayload;

export interface GeolocationInstallerDeps {
  /** 当前 payload 的定位数据。必须是实时读取：配置可能在安装之后才到。 */
  get(): GeolocationPayload | null;
  /** 把实现伪装成原生函数（toString → [native code]，name/length 保持原值） */
  disguise(impl: any, name: string, length: number): any;
  /** 取当前时间戳（走 runtime 捕获的原生 Date） */
  now(): number;
}

interface CoordinateSlots {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

/**
 * 定位伪装层。
 *
 * 三条约束，每一条都对应一种一行代码就能做完的检测：
 *
 * 1. **形状**：原生 `GeolocationCoordinates` 的 latitude 是**原型上的 getter**，
 *    实例自身没有任何自有属性。造一个普通对象再 setPrototypeOf，`Object.keys`
 *    会一口气列出全部字段 —— 必须是「内部槽 + 原型 getter」。
 *
 * 2. **权限一致**：`spoofPermission: true` 时背景侧把 contentSettings 置为 allow，
 *    注入层直接给坐标，`permissions.query` 也会如实报 granted，两边说的是同一件事。
 *    `false` 时背景侧不碰权限，注入层就把**整个请求交给原生实现**（真实提示框、
 *    真实错误实例、真实超时），只在成功回调里替换坐标。否则 permissions.query 说
 *    "没授权"、getCurrentPosition 却照样返回坐标，两句话当场打架。
 *
 * 3. **随机偏移按会话固定**：每次调用重新摇点会让 watchPosition 每 3 秒瞬移几百米，
 *    连续两次 getCurrentPosition 给出不同坐标 —— 真机不会这样，比不随机更假。
 */
let installed = false;

// 安装前记下原描述符，uninstall 时按相反顺序放回去。模块级是因为
// Geolocation 的原型链是全局单例，一个 realm 只可能有一份补丁。
const restores: Array<() => void> = [];

function remember(target: any, key: string): void {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, key);
  } catch { /* ignore */ }
  restores.push(() => {
    try {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    } catch { /* ignore */ }
  });
}

/** 还原所有已安装的定位补丁；正在跑的 watchPosition 定时器一并停掉。 */
export function uninstallGeolocation(): void {
  while (restores.length) {
    const restore = restores.pop();
    try { restore?.(); } catch { /* ignore */ }
  }
  installed = false;
}

export function installGeolocation(deps: GeolocationInstallerDeps): boolean {
  const scope: any = typeof globalThis !== 'undefined' ? globalThis : {};
  const proto = scope.Geolocation && scope.Geolocation.prototype;
  // 安装标记留在模块作用域：在 Geolocation.prototype 上挂个自有属性，
  // getOwnPropertyNames 一眼就能看见，等于给页面留了个"已注入"的记号。
  if (!proto) return false;
  // 已经装过时返回 true：调用方用返回值同步安装状态，不能让它误以为没装上。
  if (installed) return true;
  installed = true;

  const disguise = deps.disguise;
  // 原生实现要在替换之前抓住：spoofPermission=false 的路径要把整条权限流程交还给它
  const nativeGetCurrentPosition = proto.getCurrentPosition;
  const nativeWatchPosition = proto.watchPosition;
  const nativeClearWatch = proto.clearWatch;
  const coordinateSlots = new WeakMap<object, CoordinateSlots>();
  const positionSlots = new WeakMap<object, { coords: any; timestamp: number }>();
  const errorSlots = new WeakMap<object, { code: number; message: string }>();

  // value 为 null 表示 deny 模式发出的 id：没有定时器，但不能让 clearWatch 把它
  // 当成"不是我们的 id"转交给原生 —— 原生 id 是小的自增值，很容易撞上。
  const watches = new Map<number, any>();
  let nextWatchId = 1;
  restores.push(() => {
    watches.forEach((handle) => { if (handle !== null) clearInterval(handle); });
    watches.clear();
  });

  /** WebIDL 的 attribute / operation 都是 enumerable + configurable */
  const defineMember = (target: any, key: string, value: any): void => {
    remember(target, key);
    try {
      Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    } catch { /* ignore */ }
  };

  /**
   * 把原型上的属性换成读内部槽的 getter。
   *
   * 必须保留对原生 getter 的回退：真实定位拿到的实例走同一个原型，但在 WeakMap 里
   * 没有槽位，不回退就会读到 undefined。
   */
  const patchAttribute = <T>(target: any, key: string, store: WeakMap<object, T>, read: (slot: T) => any): void => {
    if (!target) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const nativeGetter = descriptor && typeof descriptor.get === 'function' ? descriptor.get : null;
    remember(target, key);
    try {
      Object.defineProperty(target, key, {
        get: disguise(function (this: any) {
          const slot = store.get(this);
          if (slot === undefined) return nativeGetter ? nativeGetter.call(this) : undefined;
          return read(slot);
        }, `get ${key}`, 0),
        enumerable: true,
        configurable: true
      });
    } catch { /* ignore */ }
  };

  const patchToJSON = <T>(target: any, store: WeakMap<object, T>, toDictionary: (slot: T) => any): void => {
    if (!target) return;
    const nativeToJSON = target.toJSON;
    // 原生没有 toJSON 就别加：凭空多出一个方法是比缺少一个方法更明显的指纹
    if (typeof nativeToJSON !== 'function') return;
    defineMember(target, 'toJSON', disguise(function (this: any) {
      const slot = store.get(this);
      if (slot === undefined) return nativeToJSON.call(this);
      return toDictionary(slot);
    }, 'toJSON', 0));
  };

  // ---------- 接口形状 ----------

  const coordsProto = scope.GeolocationCoordinates && scope.GeolocationCoordinates.prototype;
  if (coordsProto) {
    patchAttribute(coordsProto, 'latitude', coordinateSlots, (slot) => slot.latitude);
    patchAttribute(coordsProto, 'longitude', coordinateSlots, (slot) => slot.longitude);
    patchAttribute(coordsProto, 'accuracy', coordinateSlots, (slot) => slot.accuracy);
    patchAttribute(coordsProto, 'altitude', coordinateSlots, (slot) => slot.altitude);
    patchAttribute(coordsProto, 'altitudeAccuracy', coordinateSlots, (slot) => slot.altitudeAccuracy);
    patchAttribute(coordsProto, 'heading', coordinateSlots, (slot) => slot.heading);
    patchAttribute(coordsProto, 'speed', coordinateSlots, (slot) => slot.speed);
    patchToJSON(coordsProto, coordinateSlots, (slot) => ({
      latitude: slot.latitude,
      longitude: slot.longitude,
      accuracy: slot.accuracy,
      altitude: slot.altitude,
      altitudeAccuracy: slot.altitudeAccuracy,
      heading: slot.heading,
      speed: slot.speed
    }));
  }

  const positionProto = scope.GeolocationPosition && scope.GeolocationPosition.prototype;
  if (positionProto) {
    patchAttribute(positionProto, 'coords', positionSlots, (slot) => slot.coords);
    patchAttribute(positionProto, 'timestamp', positionSlots, (slot) => slot.timestamp);
    patchToJSON(positionProto, positionSlots, (slot) => ({
      coords: slot.coords && typeof slot.coords.toJSON === 'function' ? slot.coords.toJSON() : slot.coords,
      timestamp: slot.timestamp
    }));
  }

  const errorProto = scope.GeolocationPositionError && scope.GeolocationPositionError.prototype;
  if (errorProto) {
    patchAttribute(errorProto, 'code', errorSlots, (slot) => slot.code);
    patchAttribute(errorProto, 'message', errorSlots, (slot) => slot.message);
  }

  // ---------- 会话内固定的随机偏移 ----------

  let sessionPoint: { latitude: number; longitude: number } | null = null;
  let sessionKey = '';

  const jitter = (lat: number, lon: number, radiusMeters: number) => {
    if (!(radiusMeters > 0)) return { latitude: lat, longitude: lon };
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
  };

  const sessionPointFor = (geo: GeolocationConfigPayload): { latitude: number; longitude: number } => {
    const radius = geo.randomize ? Math.max(0, Number(geo.randomRadiusMeters) || 0) : 0;
    const key = `${geo.latitude},${geo.longitude},${radius}`;
    if (sessionPoint && sessionKey === key) return sessionPoint;

    sessionKey = key;
    sessionPoint = jitter(geo.latitude, geo.longitude, radius);
    return sessionPoint;
  };

  // ---------- 实例构造 ----------

  const buildCoordinates = (geo: GeolocationConfigPayload): any => {
    const point = sessionPointFor(geo);
    const target = scope.GeolocationCoordinates && scope.GeolocationCoordinates.prototype;
    const coords = target ? Object.create(target) : {};
    coordinateSlots.set(coords, {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: geo.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    });
    return coords;
  };

  const buildPosition = (geo: GeolocationConfigPayload): any => {
    const target = scope.GeolocationPosition && scope.GeolocationPosition.prototype;
    const position = target ? Object.create(target) : {};
    positionSlots.set(position, { coords: buildCoordinates(geo), timestamp: deps.now() });
    return position;
  };

  const buildError = (code: number, message: string): any => {
    const target = scope.GeolocationPositionError && scope.GeolocationPositionError.prototype;
    if (!target) return { code, message };
    const error = Object.create(target);
    errorSlots.set(error, { code, message });
    return error;
  };

  // ---------- 权限 ----------

  /**
   * `spoofPermission: true` 表示"把权限伪装成已授权"：背景侧已经把 contentSettings
   * 置为 allow，注入层直接给坐标，两边说的是同一件事。
   *
   * `spoofPermission: false` 表示"只改坐标，不碰权限"。这时**不查权限、不编错误码**，
   * 而是把整个请求交给原生实现：真实提示框、真实错误实例、真实超时都由浏览器负责，
   * 我们只在它成功之后把回调里的坐标换掉。
   *
   * 旧实现完全忽略这个开关 —— 权限是 prompt/denied 的页面上 getCurrentPosition 照样
   * 返回坐标，而 permissions.query 说"没授权"，两句话当场打架。先查权限再自造
   * PERMISSION_DENIED 也不对：那样永远不会弹出真实授权框，行为同样对不上。
   */
  const reportUnavailable = (error?: any): void => {
    setTimeout(() => {
      try { error?.(buildError(2, 'Position unavailable')); } catch { /* ignore */ }
    }, 1);
  };

  const deliver = (geo: GeolocationConfigPayload, success?: any): void => {
    const position = buildPosition(geo);
    // 原生实现走任务队列，这里同样走宏任务（不能用 microtask）
    setTimeout(() => {
      try { success?.(position); } catch { /* ignore */ }
    }, 1);
  };

  // ---------- Geolocation 方法 ----------

  defineMember(proto, 'getCurrentPosition', disguise(function (this: any, success?: any, error?: any, options?: any) {
    const geo = deps.get();
    // deny：坐标解析不出来时 fail-closed。即使 spoofPermission=false 也不交给原生，
    // 否则站点拿到的是真实定位 —— 这正是这条路径要避免的。
    if (!geo || 'deny' in geo) { reportUnavailable(error); return; }

    if (geo.spoofPermission === false && typeof nativeGetCurrentPosition === 'function') {
      // 权限、提示、错误码、超时全部走真实实现，只替换成功回调里的坐标
      nativeGetCurrentPosition.call(this, function () {
        deliver(geo, success);
      }, error, options);
      return;
    }

    deliver(geo, success);
  }, 'getCurrentPosition', 0));

  defineMember(proto, 'watchPosition', disguise(function (this: any, success?: any, error?: any, options?: any) {
    const geo = deps.get();
    const id = nextWatchId;
    nextWatchId += 1;
    // deny 优先于权限委托：坐标解析不出来时，原生 watch 也不能把真实位置交出去。
    if (!geo || 'deny' in geo) {
      watches.set(id, null);
      reportUnavailable(error);
      return id;
    }

    // 把请求交给原生 watch：权限与错误由浏览器负责，回调里的坐标换成伪装值。
    // 回调节奏也跟着真实设备走，比自造一个 3 秒定时器更像真机。
    if (geo.spoofPermission === false && typeof nativeWatchPosition === 'function') {
      return nativeWatchPosition.call(this, function () {
        try { success?.(buildPosition(geo)); } catch { /* ignore */ }
      }, error, options);
    }

    const emit = () => {
      try { success?.(buildPosition(geo)); } catch { /* ignore */ }
    };
    setTimeout(emit, 1);
    // 同一会话内坐标固定，所以每次回调都是"同一个点"，和真实设备静止时一致
    watches.set(id, setInterval(emit, 3000));
    return id;
  }, 'watchPosition', 0));

  defineMember(proto, 'clearWatch', disguise(function (this: any, id: number) {
    const handle = watches.get(id);
    if (handle === undefined) {
      // 不是我们发的 id：转交给原生（spoofPermission=false 时原生 watch 直接返回它的 id）
      if (typeof nativeClearWatch === 'function') nativeClearWatch.call(this, id);
      return;
    }
    watches.delete(id);
    if (handle === null) return;
    clearInterval(handle);
  }, 'clearWatch', 1));

  return true;
}
