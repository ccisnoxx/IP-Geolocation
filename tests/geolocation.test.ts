import test from 'node:test';
import assert from 'node:assert/strict';
import { installGeolocation } from '../src/injected/geolocation';
import type { GeolocationPayload } from '../src/injected/geolocation';

/**
 * 定位层的三条约束都只能在"跑起来"之后验证，所以这里在宿主 realm 里搭一套
 * Chrome 形状的假 WebIDL 接口，再调用真实的 installGeolocation。
 *
 * 关键点是假接口要**照着原生形状**搭：属性是原型上的 getter + 实例零自有属性。
 * 如果假接口本身就搭成普通对象，那这个测试就等于自欺欺人。
 */

const coordSlots = new WeakMap<object, any>();
const positionSlots = new WeakMap<object, any>();
const errorSlots = new WeakMap<object, any>();
const nativeCalls: string[] = [];

let permissionState: 'granted' | 'prompt' | 'denied' = 'prompt';
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

  // 与 runtime.ts 里的 disguise 等价：toString → [native code]，name/length 保持原值
  const disguise = (impl: any, name: string, length: number) => {
    Object.defineProperty(impl, 'name', { value: name, configurable: true });
    Object.defineProperty(impl, 'length', { value: length, configurable: true });
    return new Proxy(impl, {});
  };

  installGeolocation({ get: () => payload, disguise, now: () => Date.now() });
}

let payload: GeolocationPayload | null = null;

bootstrap();

function setPayload(overrides: Partial<GeolocationPayload> = {}): void {
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
  assert.equal(Object.hasOwn(coords, 'latitude'), false);
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
  assert.equal(coords.heading, null);
  assert.equal(coords.speed, null);
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

test('随机偏移按会话固定：连续两次调用给出同一个点', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 1000 });

  const first = (await request()).position.coords;
  const second = (await request()).position.coords;

  assert.equal(second.latitude, first.latitude, '同一会话内坐标必须一致');
  assert.equal(second.longitude, first.longitude);

  // 仍然落在半径内（包括未随机时为 0）
  assert.ok(distanceMeters({ latitude: 35.6762, longitude: 139.6503 }, first) <= 1000);
});

test('payload 换了坐标就重新摇一次，不会一直用旧点', async () => {
  setPayload({ randomize: true, randomRadiusMeters: 1000 });
  const tokyo = (await request()).position.coords;

  setPayload({ latitude: 48.8566, longitude: 2.3522, randomize: true, randomRadiusMeters: 1000 });
  const paris = (await request()).position.coords;

  assert.ok(distanceMeters({ latitude: 35.6762, longitude: 139.6503 }, paris) > 100000, '必须换到新坐标附近');
  assert.ok(distanceMeters({ latitude: 48.8566, longitude: 2.3522 }, paris) <= 1000);
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

  const seen: any[] = [];
  const id = (navigator.geolocation as any).watchPosition((position: any) => { seen.push(position.coords); });

  await new Promise((resolve) => setTimeout(resolve, 20));
  (navigator.geolocation as any).clearWatch(id);

  assert.ok(seen.length >= 1, '至少要回调一次');
  for (const coords of seen) {
    assert.equal(coords.latitude, seen[0].latitude);
    assert.equal(coords.longitude, seen[0].longitude);
  }
});