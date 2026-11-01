import test from 'node:test';
import assert from 'node:assert/strict';
import { installGeolocation, refreshGeolocationWatchPositions, staticSpeedForPlatform, uninstallGeolocation } from '../src/injected/geolocation';
import type { GeolocationConfigPayload, GeolocationPayload } from '../src/injected/geolocation';

/**
 * 定位层的三条约束都只能在"跑起来"之后验证，所以这里在宿主 realm 里搭一套
 * Chrome 形状的假 WebIDL 接口，再调用真实的 installGeolocation。
 *
 * 关键点是假接口要**照着原生形状**搭：属性是原型上的 getter + 实例零自有属性。
 * 如果假接口本身就搭成普通对象，那这个测试就等于自欺欺人。
 */

// 与 runtime.ts 里的 disguise 等价：toString → [native code]，name/length 保持原值
const disguise = (impl: any, name: string, length: number) => {
  Object.defineProperty(impl, 'name', { value: name, configurable: true });
  Object.defineProperty(impl, 'length', { value: length, configurable: true });
  return new Proxy(impl, {});
};

/** 换一套 watch 间隔重新装补丁（installGeolocation 是幂等的，必须先卸）。 */
function reinstall(withDelay?: () => number): void {
  uninstallGeolocation();
  installGeolocation({
    get: () => payload,
    disguise,
    now: () => Date.now(),
    ...(withDelay ? { watchDelayMs: withDelay } : {})
  });
}

const coordSlots = new WeakMap<object, any>();
const positionSlots = new WeakMap<object, any>();
const errorSlots = new WeakMap<object, any>();
const nativeCalls: string[] = [];

const permissionState: 'granted' | 'prompt' | 'denied' = 'prompt';
let permissionQueries = 0;
// 假原生实现的行为：成功（返回真实坐标 99/99）/ 被拒 / 永不回调
let nativeBehavior: 'success' | 'denied' | 'silent' = 'success';

const COORD_KEYS = ['latitude', 'longitude', 'accuracy', 'altitude', 'altitudeAccuracy', 'heading', 'speed'] as const;

function bootstrap(): void {
  function GeolocationCoordinates() { throw new TypeError('Illegal constructor'); }
  for (const key of COORD_KEYS) {
    Object.defineProperty(GeolocationCoordinates.prototype, key, {
      get(this: any) {
        const slot = coordSlots.get(this);
        return slot ? slot[key] : undefined;
      },
      enumerable: true,
      configurable: true
    });
  }
  Object.defineProperty(GeolocationCoordinates.prototype, 'toJSON', {
    value: function toJSON(this: any) {
      const slot = coordSlots.get(this) || {};
      return COORD_KEYS.reduce<any>((out, key) => { out[key] = slot[key] ?? null; return out; }, {});
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(GeolocationCoordinates.prototype, Symbol.toStringTag, {
    value: 'GeolocationCoordinates', configurable: true
  });

  function GeolocationPosition() { throw new TypeError('Illegal constructor'); }
  for (const key of ['coords', 'timestamp'] as const) {
    Object.defineProperty(GeolocationPosition.prototype, key, {
      get(this: any) {
        const slot = positionSlots.get(this);
        return slot ? slot[key] : undefined;
      },
      enumerable: true,
      configurable: true
    });
  }
  Object.defineProperty(GeolocationPosition.prototype, 'toJSON', {
    value: function toJSON(this: any) {
      const slot = positionSlots.get(this) || {};
      return { coords: slot.coords && slot.coords.toJSON ? slot.coords.toJSON() : null, timestamp: slot.timestamp ?? null };
    },
    writable: true,
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(GeolocationPosition.prototype, Symbol.toStringTag, {
    value: 'GeolocationPosition', configurable: true
  });

  function GeolocationPositionError() { throw new TypeError('Illegal constructor'); }
  Object.defineProperty(GeolocationPositionError, 'PERMISSION_DENIED', { value: 1, enumerable: true });
  Object.defineProperty(GeolocationPositionError, 'POSITION_UNAVAILABLE', { value: 2, enumerable: true });
  Object.defineProperty(GeolocationPositionError, 'TIMEOUT', { value: 3, enumerable: true });
  for (const key of ['code', 'message'] as const) {
    Object.defineProperty(GeolocationPositionError.prototype, key, {
      get(this: any) {
        const slot = errorSlots.get(this);
        return slot ? slot[key] : undefined;
      },
      enumerable: true,
      configurable: true
    });
  }
  Object.defineProperty(GeolocationPositionError.prototype, Symbol.toStringTag, {
    value: 'GeolocationPositionError', configurable: true
  });

  function Geolocation() {}
  const makeNativeError = (code: number, message: string) => {
    const error = Object.create(GeolocationPositionError.prototype);
    errorSlots.set(error, { code, message });
    return error;
  };
  Geolocation.prototype.getCurrentPosition = function getCurrentPosition(this: any, success?: any, error?: any) {
    nativeCalls.push('getCurrentPosition');
    if (nativeBehavior === 'silent') return;
    if (nativeBehavior === 'denied') {
      setTimeout(() => error?.(makeNativeError(1, 'User denied Geolocation')), 1);
      return;
    }
    const coords = Object.create(GeolocationCoordinates.prototype);
    coordSlots.set(coords, { latitude: 99, longitude: 99, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null });
    const position = Object.create(GeolocationPosition.prototype);
    positionSlots.set(position, { coords, timestamp: 1 });
    setTimeout(() => success?.(position), 1);
  };
  Geolocation.prototype.watchPosition = function watchPosition(this: any, success?: any) {
    nativeCalls.push('watchPosition');
    setTimeout(() => success?.(Object.create(GeolocationPosition.prototype)), 1);
    return 4242;
  };
  Geolocation.prototype.clearWatch = function clearWatch(this: any, id: number) { nativeCalls.push(`clearWatch:${id}`); };

  Object.defineProperty(globalThis, 'GeolocationCoordinates', { value: GeolocationCoordinates, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'GeolocationPosition', { value: GeolocationPosition, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'GeolocationPositionError', { value: GeolocationPositionError, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'Geolocation', { value: Geolocation, configurable: true, writable: true });

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      geolocation: Object.create(Geolocation.prototype),
      permissions: {
        query: async () => {
          permissionQueries += 1;
          return { state: permissionState };
        }
      }
    },
    configurable: true,
    writable: true
  });

  installGeolocation({ get: () => payload, disguise, now: () => Date.now() });
}

let payload: GeolocationPayload | null = null;

bootstrap();

function setPayload(overrides: Partial<GeolocationConfigPayload> = {}): void {
  payload = {
    latitude: 35.6762,
    longitude: 139.6503,
    accuracy: 30,
    randomize: false,
    randomRadiusMeters: 0,
    spoofPermission: true,
    ...overrides
  };
}

function request(): Promise<{ position: any; error: any }> {
  return new Promise((resolve) => {
    (navigator.geolocation as any).getCurrentPosition(
      (position: any) => resolve({ position, error: null }),
      (error: any) => resolve({ position: null, error })
    );
  });
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

test('Position / Coordinates 是 WebIDL 形状：属性在原型上、实例零自有属性', async () => {
  setPayload();
  const { position, error } = await request();
  assert.equal(error, null);

  const coords = position.coords;

  // 旧实现是普通对象 + setPrototypeOf：Object.keys 会列出全部字段
  assert.deepEqual(Object.keys(coords), [], '实例不该有任何自有属性');
  assert.equal(Object.prototype.hasOwnProperty.call(coords, 'latitude'), false);
  assert.equal(Object.getOwnPropertyDescriptor(coords, 'latitude'), undefined);
  assert.equal('latitude' in coords, true, '属性必须能从原型上读到');

  const desc = Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude')!;
  assert.equal(typeof desc.get, 'function');
  assert.equal(desc.set, undefined, 'WebIDL attribute 是只读的');
  assert.equal(desc.enumerable, true);
  assert.equal(desc.configurable, true);

  assert.equal(coords.latitude, 35.6762);
  assert.equal(coords.longitude, 139.6503);
  assert.equal(coords.altitude, null);
  // 静止设备：speed 跟平台走（Node 是桌面 → null），heading 按规范必须是 null
  assert.equal(coords.heading, null);
  assert.equal(coords.speed, null, '桌面上不该出现"能提供速度"的 0');
  assert.equal(Object.prototype.toString.call(coords), '[object GeolocationCoordinates]');
  assert.equal(coords instanceof GeolocationCoordinates, true);

  // position 同样零自有属性
  assert.deepEqual(Object.keys(position), []);
  assert.equal(Object.prototype.toString.call(position), '[object GeolocationPosition]');
  assert.equal(position.coords, coords);
  assert.equal(typeof position.timestamp, 'number');
});

test('toJSON 与 JSON.stringify 给出完整的字典', async () => {
  setPayload();
  const { position } = await request();

  const dict = position.coords.toJSON();
  assert.deepEqual(Object.keys(dict).sort(), [...COORD_KEYS].sort());
  assert.equal(dict.latitude, 35.6762);
  assert.equal(dict.altitude, null);

  const positionDict = position.toJSON();
  assert.equal(positionDict.coords.latitude, 35.6762);
  assert.equal(positionDict.timestamp, position.timestamp);
  assert.deepEqual(JSON.parse(JSON.stringify(position)).coords, dict);
});

test('原生实例走回退：真实定位不会被这套 getter 打坏', () => {
  const real = Object.create(GeolocationCoordinates.prototype);
  coordSlots.set(real, { latitude: 12.5, longitude: -3.25, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null });
  assert.equal(real.latitude, 12.5);
  assert.equal(real.longitude, -3.25);
});

test('spoofPermission=false 时权限流程整个交给原生实现，错误实例也是原生的', async () => {
  setPayload({ spoofPermission: false });
  nativeBehavior = 'denied';

  const before = nativeCalls.filter((call) => call === 'getCurrentPosition').length;
  const { position, error } = await request();

  assert.equal(nativeCalls.filter((call) => call === 'getCurrentPosition').length, before + 1,
    '必须真的调了原生 getCurrentPosition —— 否则永远不会弹出真实授权框');
  assert.equal(position, null);
  assert.equal(error.code, GeolocationPositionError.PERMISSION_DENIED);
  assert.equal(error.message, 'User denied Geolocation');
  assert.equal(Object.prototype.toString.call(error), '[object GeolocationPositionError]');
  assert.equal(error instanceof GeolocationPositionError, true);
});

test('spoofPermission=false 且原生成功时，只把坐标换成伪装值', async () => {
  setPayload({ spoofPermission: false });
  nativeBehavior = 'success';

  const { position, error } = await request();

  assert.equal(error, null);
  assert.equal(position.coords.latitude, 35.6762, '不能透出真实坐标 99');
  assert.equal(position.coords.longitude, 139.6503);
});

test('spoofPermission=true 时完全不碰原生实现（权限由背景侧 contentSettings 落实）', async () => {
  setPayload({ spoofPermission: true });
  nativeBehavior = 'success';
  const before = nativeCalls.length;
  const queriesBefore = permissionQueries;

  const { position, error } = await request();

  assert.equal(error, null);
  assert.ok(position);
  assert.equal(nativeCalls.length, before, '伪装授权时不该调用原生实现');
  assert.equal(permissionQueries, queriesBefore, '也不该去问真实权限');
});

test('noNativeCall=true：就算关掉权限伪装也不碰原生，自己出坐标', async () => {
  setPayload({ spoofPermission: false, noNativeCall: true });
  nativeBehavior = 'success';
  const before = nativeCalls.length;

  const { position, error } = await request();

  assert.equal(error, null);
  assert.equal(position.coords.latitude, 35.6762);
  assert.equal(nativeCalls.length, before, '一个字节都不该问系统定位');
});

test('noNativeCall=true 的 watchPosition 自己发 id，不走原生那条路', async () => {
  setPayload({ spoofPermission: false, noNativeCall: true });
  const before = nativeCalls.length;
  const seen: any[] = [];

  const id = (navigator.geolocation as any).watchPosition((position: any) => { seen.push(position.coords); });
  await new Promise((resolve) => setTimeout(resolve, 20));
  (navigator.geolocation as any).clearWatch(id);

  assert.notEqual(id, 4242, 'id 必须是我们自己发的，不能是原生给的');
  assert.ok(seen.length >= 1, '照样要回调');
  assert.equal(nativeCalls.length, before, 'watch 也不该碰原生');
});

test('随机偏移按会话固定：连续两次调用给出同一个点', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 1000 });

  const first = (await request()).position.coords;
  const second = (await request()).position.coords;

  assert.equal(second.latitude, first.latitude, '同一会话内坐标必须一致');
  assert.equal(second.longitude, first.longitude);

  // 仍然落在半径内（包括未随机时为 0）。偏移截断在半径上时，换一套公式回量会有浮点误差，留 1 米
  assert.ok(distanceMeters({ latitude: 35.6762, longitude: 139.6503 }, first) <= 1000 + 1);
});

test('payload 换了坐标就重新摇一次，不会一直用旧点', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 1000 });
  const tokyo = (await request()).position.coords;

  setPayload({ latitude: 48.8566, longitude: 2.3522, randomize: true, randomRadiusMeters: 1000 });
  const paris = (await request()).position.coords;

  assert.ok(distanceMeters({ latitude: 35.6762, longitude: 139.6503 }, paris) > 100000, '必须换到新坐标附近');
  assert.ok(distanceMeters({ latitude: 48.8566, longitude: 2.3522 }, paris) <= 1000 + 1);
  assert.notEqual(paris.latitude, tokyo.latitude);
});

test('spoofPermission=false 的 watchPosition 直接复用原生的 watch id', async () => {
  setPayload({ spoofPermission: false });

  const seen: any[] = [];
  const id = (navigator.geolocation as any).watchPosition((position: any) => seen.push(position));
  assert.equal(id, 4242, 'id 必须是原生给的，clearWatch 才能转交回去');

  await new Promise((resolve) => setTimeout(resolve, 20));
  (navigator.geolocation as any).clearWatch(id);

  assert.equal(seen[0].coords.latitude, 35.6762, '原生回调里的坐标同样要换掉');
  assert.ok(nativeCalls.includes('clearWatch:4242'));
});

test('watchPosition 的每次回调都落在同一个点上，clearWatch 能停掉', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 500 });
  reinstall(() => 5);

  const seen: any[] = [];
  let id = 0;
  try {
    await new Promise<void>((resolve) => {
      id = navigator.geolocation.watchPosition((position) => {
        seen.push(position.coords);
        if (seen.length === 3) resolve();
      });
    });
    navigator.geolocation.clearWatch(id);
    const count = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(seen.length, count, 'clear 后跨过多个心跳仍无回调');
    for (const coords of seen) {
      assert.equal(coords.latitude, seen[0].latitude);
      assert.equal(coords.longitude, seen[0].longitude);
    }
  } finally {
    navigator.geolocation.clearWatch(id);
    reinstall();
  }
});
test('坐标未解析时 deny：不调用原生，直接返回 POSITION_UNAVAILABLE', async () => {
  payload = { deny: true };
  const before = nativeCalls.length;
  const { position, error } = await request();
  assert.equal(position, null);
  assert.equal(error.code, 2);
  assert.equal(error.message, 'Position unavailable');
  assert.equal(nativeCalls.length, before, 'deny 不能把请求交给原生实现');
});

test('坐标未解析时 watchPosition 也返回 POSITION_UNAVAILABLE', async () => {
  payload = { deny: true };
  const before = nativeCalls.filter((call) => call.startsWith('clearWatch')).length;
  let watchId = 0;
  const error = await new Promise<any>((resolve) => {
    watchId = (navigator.geolocation as any).watchPosition(() => resolve(null), (value: any) => resolve(value));
    assert.equal(typeof watchId, 'number');
  });
  assert.equal(error.code, 2);
  assert.equal(error.message, 'Position unavailable');
  (navigator.geolocation as any).clearWatch(watchId);
  assert.equal(
    nativeCalls.filter((call) => call.startsWith('clearWatch')).length,
    before,
    'deny 自己发出的 watch id 不能转交给原生 clearWatch'
  );
});

// ---------- 噪声模型 / accuracy 一致性 ----------

/** 固定种子的伪随机：分布在测试里必须可复现，否则断言就是在碰运气 */
async function withSeededRandom<T>(seed: number, run: () => Promise<T>): Promise<T> {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    // 必须 await：采样是异步的（每次定位回调走宏任务），同步返回会让种子提前还原，
    // 断言就变成在碰运气
    return await run();
  } finally {
    Math.random = original;
  }
}

/** 摇 n 次得到的位移样本：每次换个纬度，逼 sessionPointFor 重新摇 */
async function sampleOffsets(count: number, radius: number, baseAccuracy = 30): Promise<number[]> {
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    setPayload({ latitude: 35 + i * 1e-6, longitude: 139.6503, accuracy: baseAccuracy, randomize: true, randomRadiusMeters: radius });
    const { position } = await request();
    offsets.push(distanceMeters({ latitude: 35 + i * 1e-6, longitude: 139.6503 }, position.coords));
  }
  return offsets;
}

test('随机偏移的模长是 Rayleigh 分布，不是半径上的均匀分布', async () => {
  const radius = 1000;
  const offsets = await withSeededRandom(20261029, () => sampleOffsets(600, radius));

  assert.equal(offsets.length, 600);
  assert.ok(offsets.every((value) => value <= radius + 1), '承诺过最多偏 R 米，截断不能失效');

  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] / radius;

  // Rayleigh(σ=R/3) 的中位数是 σ·√(2ln2) ≈ 0.392R。
  // 半径上均匀会给 0.5R，面积上均匀（√u）会给 0.707R —— 这条断言专门用来把它们区分开。
  assert.ok(median > 0.33 && median < 0.45, `中位数应像 Rayleigh（≈0.39R），实际 ${median.toFixed(3)}R`);

  // 近圆心比例：均匀半径会把 5% 的样本塞进 0.05R 以内，Rayleigh 只有 1.4%
  const nearCenter = offsets.filter((value) => value < 0.05 * radius).length / offsets.length;
  assert.ok(nearCenter < 0.035, `圆心附近不该堆样本，实际 ${(nearCenter * 100).toFixed(1)}%`);
});

test('开随机时 accuracy 必须覆盖位移，不能出现"50 米精度、1 公里偏移"', async () => {
  const radius = 2000;
  // 固定种子：这条断言贴着取整边界（大位移时 round 会掉到位移以下），
  // 用真随机等于让它隔三差五红一次
  const samples = await withSeededRandom(77031, async () => {
    const rows: Array<{ offset: number; accuracy: number }> = [];
    for (let i = 0; i < 12; i += 1) {
      setPayload({ latitude: 35 + i * 1e-6, longitude: 139.6503, accuracy: 30, randomize: true, randomRadiusMeters: radius });
      const { position } = await request();
      rows.push({
        offset: distanceMeters({ latitude: 35 + i * 1e-6, longitude: 139.6503 }, position.coords),
        accuracy: position.coords.accuracy
      });
    }
    return rows;
  });

  for (const { offset, accuracy } of samples) {
    assert.equal(accuracy, Math.ceil(Math.hypot(30, offset)), 'accuracy 必须等于 hypot(配置精度, 位移) 向上取整');
    assert.ok(accuracy >= offset, '报告的精度至少要覆盖它自己偏离的距离');
  }
  assert.ok(Math.max(...samples.map((row) => row.offset)) > 0, '至少要有一次真的挪动了');
});

test('不开随机时 accuracy 原样透传，不凭空变大', async () => {
  setPayload({ accuracy: 30, randomize: false, randomRadiusMeters: 2000 });
  const { position } = await request();
  assert.equal(position.coords.accuracy, 30);
  assert.equal(position.coords.latitude, 35.6762);
});

// ---------- 非安全上下文一致性 ----------

test('非安全上下文（http / file://）里不给坐标：整条请求交回原生', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true, writable: true });
  try {
    setPayload({ spoofPermission: true });
    nativeBehavior = 'success';
    const before = nativeCalls.filter((call) => call === 'getCurrentPosition').length;

    const { position, error } = await request();

    assert.equal(error, null);
    assert.equal(nativeCalls.filter((call) => call === 'getCurrentPosition').length, before + 1,
      '必须真的问一次原生 —— 真实浏览器在这里只会报 PERMISSION_DENIED');
    assert.equal(position.coords.latitude, 99, '不能把伪装坐标交出去');
  } finally {
    delete (globalThis as any).isSecureContext;
  }
});

test('非安全上下文里原生拒绝时，页面拿到的是原生的错误实例', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true, writable: true });
  try {
    setPayload({ spoofPermission: true });
    nativeBehavior = 'denied';
    const { position, error } = await request();

    assert.equal(position, null);
    assert.equal(error.code, GeolocationPositionError.PERMISSION_DENIED);
    assert.equal(error instanceof GeolocationPositionError, true);
  } finally {
    delete (globalThis as any).isSecureContext;
  }
});

test('非安全上下文里的 watchPosition 也交回原生（id 才能被 clearWatch 转交）', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true, writable: true });
  try {
    setPayload({ spoofPermission: true });
    const id = (navigator.geolocation as any).watchPosition(() => undefined);
    assert.equal(id, 4242);
    (navigator.geolocation as any).clearWatch(id);
    assert.ok(nativeCalls.includes('clearWatch:4242'));
  } finally {
    delete (globalThis as any).isSecureContext;
  }
});

test('deny 仍然优先于安全上下文守卫：配置坏了时不把请求交给原生', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true, writable: true });
  try {
    payload = { deny: true };
    nativeBehavior = 'success';
    const before = nativeCalls.filter((call) => call === 'getCurrentPosition').length;

    const { position, error } = await request();

    assert.equal(position, null);
    assert.equal(error.code, 2);
    assert.equal(nativeCalls.filter((call) => call === 'getCurrentPosition').length, before);
  } finally {
    delete (globalThis as any).isSecureContext;
  }
});

test('安全上下文恢复后照常给伪装坐标', async () => {
  setPayload({ accuracy: 30 });
  const { position } = await request();
  assert.equal(position.coords.latitude, 35.6762);
});

// ---------- watch 的节奏 ----------

test('watchPosition 的首帧不等心跳（真机第一次定位是几百毫秒内的事）', async () => {
  setPayload();
  // 心跳故意设得极慢：能拿到首帧就说明它没有搭心跳的便车
  reinstall(() => 60_000);

  const stamps: number[] = [];
  const started = Date.now();
  const id = (navigator.geolocation as any).watchPosition(() => stamps.push(Date.now() - started));
  await new Promise((resolve) => setTimeout(resolve, 120));
  (navigator.geolocation as any).clearWatch(id);

  assert.ok(stamps.length >= 1, '首帧必须回调');
  assert.ok(stamps[0] < 1000, `首帧不能等到心跳：${stamps[0]}ms`);
});

test('watchPosition 每帧重新取间隔，不会整段 watch 用一个常数', async () => {
  setPayload();
  const delays = [40, 120, 40, 120];
  let index = 0;
  reinstall(() => delays[index++ % delays.length]);

  const stamps: number[] = [];
  const id = (navigator.geolocation as any).watchPosition(() => stamps.push(Date.now()));
  await new Promise((resolve) => setTimeout(resolve, 400));
  (navigator.geolocation as any).clearWatch(id);

  assert.ok(stamps.length >= 3, `至少要有三帧才量得出间隔：${stamps.length}`);
  const gaps = stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
  // 固定节奏的实现会给出几乎相等的间隔；这里是 40/120 交替，必然一短一长
  assert.ok(Math.max(...gaps) - Math.min(...gaps) >= 50, `间隔必须逐帧重摇：${gaps.join(',')}`);
});

test('watchPosition 的默认心跳落在 2.5–4.2s（误差留 100ms）', async () => {
  setPayload();
  reinstall();

  const stamps: number[] = [];
  const id = (navigator.geolocation as any).watchPosition(() => stamps.push(Date.now()));
  await new Promise((resolve) => setTimeout(resolve, 4600));
  (navigator.geolocation as any).clearWatch(id);

  assert.ok(stamps.length >= 2, `4.6s 内至少两帧：${stamps.length}`);
  const gap = stamps[1] - stamps[0];
  assert.ok(gap >= 2400 && gap <= 4400, `默认间隔必须落在 2.5–4.2s：${gap}ms`);
});

test('坐标变了立刻推一帧，没变就不重复推', async () => {
  setPayload();
  reinstall(() => 60_000);

  const seen: any[] = [];
  const id = (navigator.geolocation as any).watchPosition((position: any) => seen.push(position.coords));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(seen.length, 1, '首帧');

  // 坐标没动：叫醒也不该多发一帧（真机静止时不产生新定位）
  refreshGeolocationWatchPositions();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen.length, 1, '坐标没变不该重复推帧');

  setPayload({ latitude: 48.8566, longitude: 2.3522 });
  refreshGeolocationWatchPositions();
  await new Promise((resolve) => setTimeout(resolve, 30));
  (navigator.geolocation as any).clearWatch(id);

  assert.equal(seen.length, 2, '坐标变了要立刻推一帧，不等心跳');
  assert.equal(seen[1].latitude, 48.8566);
  assert.equal(seen[1].longitude, 2.3522);
});

test('watch 期间配置变成 deny：报 POSITION_UNAVAILABLE 并结束这一路 watch', async () => {
  setPayload();
  reinstall(() => 40);

  const frames: any[] = [];
  const errors: any[] = [];
  const id = (navigator.geolocation as any).watchPosition(
    (position: any) => frames.push(position),
    (error: any) => errors.push(error)
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  const framesBefore = frames.length;

  payload = { deny: true };
  refreshGeolocationWatchPositions();
  await new Promise((resolve) => setTimeout(resolve, 160));

  assert.equal(errors.length, 1, '只报一次错');
  assert.equal(errors[0].code, 2);
  assert.equal(frames.length, framesBefore, '报了错就不该再推坐标');

  const nativeBefore = nativeCalls.length;
  (navigator.geolocation as any).clearWatch(id);
  assert.equal(nativeCalls.length, nativeBefore, '结束后的 id 仍然不能转交给原生 clearWatch');
  payload = null;
});

test('静止设备的读数自洽：speed 跟平台走、heading=null、不编高度', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 800 });
  const { position } = await request();
  const coords = position.coords;

  // Node 的 navigator 是桌面（platform=darwin/linux/win32，UA 不含移动标志）：
  // 桌面 Chrome 的网络定位不提供速度，所以这里是 null 而不是 0。
  assert.equal(coords.speed, null, '桌面平台是"不提供速度"的 null，不是"能提供且为 0"');
  assert.equal(coords.heading, null, 'speed 未知时 heading 必须是 null');
  assert.equal(coords.altitude, null);
  assert.equal(coords.altitudeAccuracy, null, 'altitude 为 null 时 altitudeAccuracy 不能有值');

  // toJSON 走的是同一份槽位，口径必须一致
  const json = coords.toJSON();
  assert.equal(json.speed, null);
  assert.equal(json.heading, null);
});

test('speed 与平台绑定：移动端 0，桌面端 null，判不出来时按桌面给 null', () => {
  const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' };
  const windows = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' };
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36', platform: 'Linux armv8l' };
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' };
  // UA-CH 优先：platform 说是 Android，UA 里没有 mobile 标志也算移动端
  const viaUaCh = { userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux', userAgentData: { platform: 'Android', mobile: true } };
  // UA-CH 明确说"不是移动端"时，UA 字符串不再参与判断
  const uaChDesktop = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile', platform: 'Linux', userAgentData: { platform: 'macOS', mobile: false } };

  assert.equal(staticSpeedForPlatform(desktop), null, '桌面 → null（平台不提供速度）');
  assert.equal(staticSpeedForPlatform(windows), null);
  assert.equal(staticSpeedForPlatform(android), 0, 'Android → 0（能提供，且静止）');
  assert.equal(staticSpeedForPlatform(iphone), 0);
  assert.equal(staticSpeedForPlatform(viaUaCh), 0, 'UA-CH 的 mobile 是权威信号');
  assert.equal(staticSpeedForPlatform(uaChDesktop), null, 'UA-CH 说不是移动端就当桌面');
  assert.equal(staticSpeedForPlatform({}), null, '判不出来按桌面；null 是"没信息"，不编读数');
  assert.equal(staticSpeedForPlatform(null), null);
});

test('所有坐标读数都满足规范的字段约束（不是只对默认配置成立）', async () => {
  const configs = [
    {},
    { randomize: true, randomRadiusMeters: 2000, accuracy: 5 },
    { randomize: true, randomRadiusMeters: 0, accuracy: 500 },
    { accuracy: 5000 }
  ];
  for (const config of configs) {
    for (let index = 0; index < 5; index += 1) {
      setPayload({ ...config, latitude: 35 + index * 0.01, longitude: 139 + index * 0.01 });
      const { position } = await request();
      const coords = position.coords;
      const label = JSON.stringify(config);
      // 规范约束 1：heading 只在 speed > 0 时才有值
      assert.ok(coords.heading === null || Number(coords.speed) > 0, `heading/speed 不自洽：${label}`);
      // 规范约束 2：altitudeAccuracy 只在 altitude 非 null 时才允许有值
      assert.ok(coords.altitudeAccuracy === null || coords.altitude !== null, `altitudeAccuracy/altitude 不自洽：${label}`);
      // 规范约束 3：accuracy 是"位置有多准"，不能比实际偏移小
      assert.ok(coords.accuracy >= 0 && Number.isFinite(coords.accuracy), `accuracy 非法：${label}`);
      // 规范约束 4：speed 必须是当前平台真会给出的值（桌面 null / 移动端 0），
      // 且会话内恒定 —— 这里跑在桌面上，所以必须一直是 null
      assert.equal(coords.speed, null, `桌面平台的 speed 必须是 null：${label}`);
    }
  }
  payload = null;
});
