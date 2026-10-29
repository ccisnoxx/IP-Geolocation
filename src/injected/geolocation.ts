export interface GeolocationConfigPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  randomize: boolean;
  randomRadiusMeters: number;
  spoofPermission: boolean;
  /**
   * 完全不调用系统定位。缺省（false/缺省）时，只有 `spoofPermission === false`
   * 那条路会把请求交给原生；打开它就是"哪怕权限伪装被关掉，也不去问系统"。
   *
   * 归一化已经把"打开 noNativeCall ⇒ 打开 spoofPermission"绑定死了，所以这里
   * `noNativeCall === true` 时 `spoofPermission` 理论上也是 true。这里再判一次是
   * fail-safe：被手改过的配置 / 旧烘焙包送进矛盾组合时，宁可自己出坐标，也不去
   * 触发系统的定位授权与定位记录。
   */
  noNativeCall?: boolean;
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
  /**
   * 测试用：自定义 watchPosition 的下一帧间隔。
   * 生产环境不传，走 2.5–4.2s 的随机抖动（见 nextWatchDelay）。
   */
  watchDelayMs?(): number;
}

/**
 * 静止设备上报的速度。真机在静止时给的读数就是 0（"能提供速度且为 0"），
 * 而 null 的含义是"这个平台不提供速度" —— 桌面网络定位通常给 null。
 * 这里选 0：坐标会话内固定，整组读数讲的是同一件事（没在动）。
 * 想更贴桌面 UA 的话，把 speed 与平台绑定即可（见 README「还能做」）。
 */
const STATIC_SPEED_METERS_PER_SECOND = 0;

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
 *    偏移量本身要像真机误差（Rayleigh 模长、无硬边界），且报告的 accuracy 必须
 *    覆盖这段位移 —— 详见 jitter() 与 buildCoordinates() 的注释。
 *
 * 4. **安全上下文一致**：Chrome 在非安全上下文（http 页、file://）对 geolocation
 *    一律返回 PERMISSION_DENIED。站点自己知道自己的协议，我们在这类页面上给坐标
 *    等于把"装了伪造扩展"写在一行 fetch 里 —— 直接把这整条请求交回浏览器。
 */
const EARTH_RADIUS_METERS = 6371000;

/** 两点间球面距离（米）。只用来量"我到底把点挪了多远"，精度够用。 */
function distanceMeters(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

let installed = false;

// 安装前记下原描述符，uninstall 时按相反顺序放回去。模块级是因为
// Geolocation 的原型链是全局单例，一个 realm 只可能有一份补丁。
const restores: Array<() => void> = [];

/**
 * 安装后的 watchPosition 在被叫醒时立刻推一帧。未安装时是 null。
 * 之所以要这个钩子：坐标可能在 watch 注册**之后**才变（配置保存、跟随出口 IP 落地），
 * 那时候页面已经挂着一路 watch，它不该等到下一个心跳才发现"位置换了"。
 */
let notifyWatchChange: (() => void) | null = null;

/** 让已安装的 watchPosition 立刻推一帧（仅当坐标真的变了）。 */
export function refreshGeolocationWatchPositions(): void {
  try { notifyWatchChange?.(); } catch { /* ignore */ }
}

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
  notifyWatchChange = null;
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

  interface WatchEntry {
    success: any;
    error: any;
    timer: any;
    first: any;
    lastKey: string;
    cancelled: boolean;
  }
  // value 为 null 表示 deny 模式发出的 id：没有定时器，但不能让 clearWatch 把它
  // 当成"不是我们的 id"转交给原生 —— 原生 id 是小的自增值，很容易撞上。
  const watches = new Map<number, WatchEntry | null>();
  let nextWatchId = 1;
  const stopEntry = (entry: WatchEntry): void => {
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.first) clearTimeout(entry.first);
    entry.timer = null;
    entry.first = null;
  };
  restores.push(() => {
    watches.forEach((entry) => { if (entry) stopEntry(entry); });
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

  let sessionPoint: { latitude: number; longitude: number; offsetMeters: number } | null = null;
  let sessionKey = '';

  const jitter = (lat: number, lon: number, radiusMeters: number) => {
    if (!(radiusMeters > 0)) return { latitude: lat, longitude: lon };
    const earthRadius = EARTH_RADIUS_METERS;
    // 位移模长的分布决定这个点像不像设备给的：
    //
    //   * 半径上均匀（`Math.random() * R`）在面积上密度 ∝ 1/r，样本全堆在圆心附近，
    //     并且半径恰好等于 R 的地方有一条硬边界 —— 真机 GPS 误差没有这种东西。
    //   * 真机误差近似二维高斯，模长是 Rayleigh。σ = R/3 让 99.7% 落在半径内，
    //     再截断到 R，把「最多偏 R 米」这句对用户的承诺守住（否则长尾会飞出半径）。
    //
    // 拉普拉斯（geo-indistinguishability）不适合这里：它是为差分隐私预算服务的，
    // 不是为"看起来像设备"服务的。
    const sigma = radiusMeters / 3;
    const distance = Math.min(radiusMeters, sigma * Math.sqrt(-2 * Math.log(1 - Math.random())));
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

  const sessionPointFor = (geo: GeolocationConfigPayload): { latitude: number; longitude: number; offsetMeters: number } => {
    const radius = geo.randomize ? Math.max(0, Number(geo.randomRadiusMeters) || 0) : 0;
    const key = `${geo.latitude},${geo.longitude},${radius}`;
    if (sessionPoint && sessionKey === key) return sessionPoint;

    sessionKey = key;
    const point = jitter(geo.latitude, geo.longitude, radius);
    // 摇完才知道挪了多远：accuracy 要跟着这个数走（见 buildCoordinates）
    sessionPoint = {
      ...point,
      offsetMeters: distanceMeters(geo.latitude, geo.longitude, point.latitude, point.longitude)
    };
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
      // 报告的精度必须覆盖被挪动的距离。配 50m 精度、坐标偏 1km，站点把 accuracy
      // 当权重对多次上报做加权平均，就能把点拉回配置坐标 —— 这组数字自己就矛盾。
      // 真机上 accuracy 本来就是"这个点有多准"，所以取 hypot 再**向上**取整：
      // 向下取整在大位移时会出现 accuracy 比位移还小的边角（hypot(30, 2000) = 2000.22
      // 会 round 成 2000，而实际偏移可能是 2000.19）。没挪动时原样透传配置值。
      accuracy: point.offsetMeters > 0
        ? Math.ceil(Math.hypot(geo.accuracy, point.offsetMeters))
        : geo.accuracy,
      // 静止设备的读数：坐标在整个会话里固定，所以速度就是 0。
      // 规范对这组字段有硬约束，编错一个就比 null 更容易被抓住：
      //   · `heading` 在 speed 为 0（或未知）时**必须**是 null —— 想给出非 null 的
      //     朝向就得承认"设备在动"，而坐标不动，两条信息当场打架；
      //   · `altitudeAccuracy` 只有 `altitude` 非 null 时才允许有值，而伪造高度
      //     要经得起按坐标查一遍地形高程（DEM/高程接口），收益远小于风险。
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: STATIC_SPEED_METERS_PER_SECOND
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
   * `noNativeCall: true` 是这条委派的刹车：它表示"一个字节都不要问系统"——系统定位
   * 服务、浏览器定位日志、macOS 菜单栏的定位箭头都不该被点亮。归一化会强制这种配置
   * 同时打开 `spoofPermission`（否则 permissions.query 与行为对不上），所以正常配置
   * 下两者不会打架；真打起来时按"不碰原生"处理。
   *
   * 旧实现完全忽略这个开关 —— 权限是 prompt/denied 的页面上 getCurrentPosition 照样
   * 返回坐标，而 permissions.query 说"没授权"，两句话当场打架。先查权限再自造
   * PERMISSION_DENIED 也不对：那样永远不会弹出真实授权框，行为同样对不上。
   */
  /**
   * 非安全上下文（http 页面、file://）：浏览器对 geolocation **一律** PERMISSION_DENIED。
   * 站点自己知道自己的协议，我们在这类页面上返回坐标，等于告诉它"有扩展在改定位"。
   *
   * 判定用 `=== false` 而不是 `!isSecureContext`：老浏览器/非 window 环境可能没有这个
   * 属性，缺省必须当作"安全"，否则所有页面都会退化成原生定位。
   */
  const insecureContext = (): boolean => {
    try { return (scope as any).isSecureContext === false; } catch { return false; }
  };

  const reportPermissionDenied = (error?: any): void => {
    setTimeout(() => {
      try { error?.(buildError(1, 'Only secure origins are allowed')); } catch { /* ignore */ }
    }, 1);
  };

  const reportUnavailable = (error?: any): void => {
    setTimeout(() => {
      try { error?.(buildError(2, 'Position unavailable')); } catch { /* ignore */ }
    }, 1);
  };

  /** 是否把整条权限流程交回原生：只有"不伪装权限"且"没要求完全不碰原生"时才允许。 */
  const delegateToNative = (geo: GeolocationConfigPayload): boolean =>
    geo.spoofPermission === false && geo.noNativeCall !== true;

  const deliver = (geo: GeolocationConfigPayload, success?: any): void => {
    const position = buildPosition(geo);
    // 原生实现走任务队列，这里同样走宏任务（不能用 microtask）
    setTimeout(() => {
      try { success?.(position); } catch { /* ignore */ }
    }, 1);
  };

  // ---------- watch 的节奏 ----------

  /**
   * 真机的 watch 回调间隔不是常数：固定 3000ms 心跳等于在页面里挂了个节拍器，
   * 量两帧间隔就能认出"这不是设备的定位流"。每帧在 2.5–4.2s 里重摇一次，
   * 静止时坐标不变 —— 站点看到的是"同一个点、间隔抖动"，和 GPS 静止时一致。
   */
  const nextWatchDelay = (): number => {
    const custom = deps.watchDelayMs?.();
    if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 0) return custom;
    return 2500 + Math.floor(Math.random() * 1700);
  };

  /** 坐标变化检测用：米级以下的抖动不值得再推一帧。 */
  const coordinateKey = (geo: GeolocationConfigPayload): string =>
    `${Math.round(geo.latitude * 1e6)},${Math.round(geo.longitude * 1e6)}`;

  const emitWatch = (entry: WatchEntry): void => {
    const geo = deps.get();
    // 配置在 watch 期间变成"解析不出来"：真机这时候回调错误并结束这一路 watch
    if (!geo || 'deny' in geo) {
      stopEntry(entry);
      // 占位保留这个 id（置 null 而不是删掉）：否则 clearWatch 会把它当成"不是我们的
      // id"转交给原生，而原生 id 是小的自增值，很容易误清掉站点自己的 watch。
      watches.forEach((value, key) => { if (value === entry) watches.set(key, null); });
      reportUnavailable(entry.error);
      return;
    }
    entry.lastKey = coordinateKey(geo);
    const position = buildPosition(geo);
    try { entry.success?.(position); } catch { /* ignore */ }
  };

  const scheduleWatch = (entry: WatchEntry): void => {
    if (entry.cancelled) return;
    entry.timer = setTimeout(() => {
      if (entry.cancelled) return;
      emitWatch(entry);
      scheduleWatch(entry);
    }, nextWatchDelay());
  };

  notifyWatchChange = () => {
    watches.forEach((entry) => {
      if (!entry || entry.cancelled) return;
      const geo = deps.get();
      if (!geo || 'deny' in geo) { emitWatch(entry); return; }
      if (coordinateKey(geo) === entry.lastKey) return;
      // 坐标变了：立刻推一帧，并把心跳重新排期（否则同一秒里会收到两帧）
      if (entry.timer) clearTimeout(entry.timer);
      emitWatch(entry);
      scheduleWatch(entry);
    });
  };

  // ---------- Geolocation 方法 ----------

  defineMember(proto, 'getCurrentPosition', disguise(function (this: any, success?: any, error?: any, options?: any) {
    const geo = deps.get();
    // deny：坐标解析不出来时 fail-closed。即使 spoofPermission=false 也不交给原生，
    // 否则站点拿到的是真实定位 —— 这正是这条路径要避免的。
    if (!geo || 'deny' in geo) { reportUnavailable(error); return; }

    // 非安全上下文一致性：这条必须排在一切"给坐标"的分支之前。deny 仍然优先——
    // 配置坏了的时候宁可错误码对不上，也不能把请求交给原生（那才是真实定位）。
    if (insecureContext()) {
      if (typeof nativeGetCurrentPosition === 'function') {
        nativeGetCurrentPosition.call(this, success, error, options);
        return;
      }
      reportPermissionDenied(error);
      return;
    }

    if (delegateToNative(geo) && typeof nativeGetCurrentPosition === 'function') {
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

    // 非安全上下文：原生 watch 在这里只会报 PERMISSION_DENIED，交回给它最省事；
    // 原生不存在时自己造一条同码错误，别让 watchPosition 静默不回调。
    if (insecureContext()) {
      if (typeof nativeWatchPosition === 'function') {
        return nativeWatchPosition.call(this, success, error, options);
      }
      watches.set(id, null);
      reportPermissionDenied(error);
      return id;
    }

    // 把请求交给原生 watch：权限与错误由浏览器负责，回调里的坐标换成伪装值。
    // 回调节奏也跟着真实设备走，比自造一个 3 秒定时器更像真机。
    if (delegateToNative(geo) && typeof nativeWatchPosition === 'function') {
      return nativeWatchPosition.call(this, function () {
        try { success?.(buildPosition(geo)); } catch { /* ignore */ }
      }, error, options);
    }

    const entry: WatchEntry = { success, error, timer: null, first: null, lastKey: '', cancelled: false };
    watches.set(id, entry);
    // 首帧不能等心跳：真机第一次回调通常几百毫秒内就到，等一整个间隔本身就是指纹
    entry.first = setTimeout(() => {
      entry.first = null;
      if (!entry.cancelled) emitWatch(entry);
    }, 1);
    scheduleWatch(entry);
    return id;
  }, 'watchPosition', 0));

  defineMember(proto, 'clearWatch', disguise(function (this: any, id: number) {
    const entry = watches.get(id);
    if (entry === undefined) {
      // 不是我们发的 id：转交给原生（spoofPermission=false 时原生 watch 直接返回它的 id）
      if (typeof nativeClearWatch === 'function') nativeClearWatch.call(this, id);
      return;
    }
    watches.delete(id);
    if (entry) stopEntry(entry);
  }, 'clearWatch', 1));

  return true;
}
