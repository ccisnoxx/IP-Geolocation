import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisguise } from '../src/injected/disguise';
import { createSignalSpoof } from '../src/injected/signal-spoof';
import { installCanvasFontPatches, uninstallCanvasFontPatches } from '../src/injected/canvas-patch';
import { installLocalFontsFilter, uninstallLocalFontsFilter } from '../src/injected/local-fonts';
import { installGeolocation, uninstallGeolocation } from '../src/injected/geolocation';

/**
 * "清除"路径的回归测试。
 *
 * 烘焙构建的静态 content_scripts 会在 document_start 先应用一遍烘焙值；站点被排除
 * 或总开关被关掉时，桥必须能把补丁逐项还原。这些测试逐个钉住 installer 的还原
 * 契约，尤其是 **还原之后还能再次安装**（用户重新启用站点时要走这条路）。
 */

test('signal spoof：还原 Date / Intl / navigator 后可以再次安装', () => {
  const NativeDate = Date;
  const nativeGetHours = Date.prototype.getHours;
  const nativeDateTimeFormat = Intl.DateTimeFormat;
  const nativeLanguage = navigator.language;
  const disguise = createDisguise();
  const signals = createSignalSpoof({
    timezone: () => 'Asia/Tokyo',
    language: () => 'ja-JP',
    languages: () => ['ja-JP', 'ja'],
    disguise
  });

  signals.installLanguage();
  signals.installDateMethods();
  signals.installDateConstructor();
  signals.installIntl();
  assert.equal(navigator.language, 'ja-JP');
  assert.notEqual(Date.prototype.getHours, nativeGetHours);
  assert.notEqual(Date, NativeDate);
  assert.notEqual(Intl.DateTimeFormat, nativeDateTimeFormat);

  signals.uninstall();
  assert.equal(navigator.language, nativeLanguage);
  assert.equal(Date.prototype.getHours, nativeGetHours);
  assert.equal(Date, NativeDate);
  assert.equal(Intl.DateTimeFormat, nativeDateTimeFormat);

  // 标志位必须一起复位，否则重新命中站点时 installer 会直接 return
  signals.installLanguage();
  signals.installDateMethods();
  assert.equal(navigator.language, 'ja-JP');
  assert.notEqual(Date.prototype.getHours, nativeGetHours);
  signals.uninstall();
  assert.equal(Date.prototype.getHours, nativeGetHours);
});

test('canvas：还原 measureText 的原描述符', () => {
  const nativeMeasureText = function measureText() {
    return { width: 1 };
  };
  const proto: any = { font: '12px sans-serif' };
  Object.defineProperty(proto, 'measureText', {
    value: nativeMeasureText,
    writable: true,
    enumerable: true,
    configurable: true
  });
  const scope: any = { CanvasRenderingContext2D: { prototype: proto } };
  const deps = {
    fallbackFont: () => null,
    disguise: (fn: any) => fn,
    define: (target: any, key: string, value: any) => {
      Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    }
  };

  assert.deepEqual(installCanvasFontPatches(scope, deps), ['CanvasRenderingContext2D']);
  assert.notEqual(proto.measureText, nativeMeasureText);

  uninstallCanvasFontPatches(scope);
  assert.equal(proto.measureText, nativeMeasureText);
});

test('local fonts：还原 queryLocalFonts 的原描述符', () => {
  const native = function queryLocalFonts() {
    return Promise.resolve([]);
  };
  const scope: any = {};
  Object.defineProperty(scope, 'queryLocalFonts', {
    value: native,
    writable: true,
    enumerable: true,
    configurable: true
  });

  assert.equal(installLocalFontsFilter(scope, { isHidden: () => false, disguise: (fn: any) => fn }), true);
  assert.notEqual(scope.queryLocalFonts, native);

  uninstallLocalFontsFilter(scope);
  assert.equal(scope.queryLocalFonts, native);
});

test('geolocation：还原 getCurrentPosition / watchPosition / clearWatch', () => {
  const nativeGetCurrentPosition = function getCurrentPosition() { /* native */ };
  const nativeWatchPosition = function watchPosition() { return 1; };
  const nativeClearWatch = function clearWatch() { /* native */ };
  class Geolocation {}
  for (const [key, value] of Object.entries({
    getCurrentPosition: nativeGetCurrentPosition,
    watchPosition: nativeWatchPosition,
    clearWatch: nativeClearWatch
  })) {
    Object.defineProperty(Geolocation.prototype, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  (globalThis as any).Geolocation = Geolocation;

  try {
    installGeolocation({
      get: () => ({
        latitude: 35.6762,
        longitude: 139.6503,
        accuracy: 30,
        randomize: false,
        randomRadiusMeters: 0,
        spoofPermission: true
      }),
      disguise: (fn: any) => fn,
      now: () => 0
    });
    assert.notEqual((Geolocation.prototype as any).getCurrentPosition, nativeGetCurrentPosition);

    uninstallGeolocation();
    assert.equal((Geolocation.prototype as any).getCurrentPosition, nativeGetCurrentPosition);
    assert.equal((Geolocation.prototype as any).watchPosition, nativeWatchPosition);
    assert.equal((Geolocation.prototype as any).clearWatch, nativeClearWatch);
  } finally {
    delete (globalThis as any).Geolocation;
  }
});
test('disguise：还原 Function.prototype.toString，再次 disguise 会重新安装', () => {
  const nativeToString = Function.prototype.toString;
  const disguise = createDisguise();
  assert.notEqual(Function.prototype.toString, nativeToString);

  disguise.uninstall();
  assert.equal(Function.prototype.toString, nativeToString);

  const impl = function fakeSetHours() { /* fake */ };
  // disguise 现在返回**重建后**的函数：方法形状（见下一条测试），所以断言看返回值
  const shaped = disguise(impl, 'setHours', 0);
  assert.equal(shaped.toString(), 'function setHours() { [native code] }');
  assert.notEqual(Function.prototype.toString, nativeToString);
  disguise.uninstall();
  assert.equal(Function.prototype.toString, nativeToString);
});

test('disguise：默认给方法形状 —— 没有自有 prototype，也不能被 new', () => {
  const disguise = createDisguise();
  const shaped = disguise(function fakeGetHours(this: any) { return 42; }, 'getHours', 0);

  // 原生原型方法两样都成立：没有自有 prototype，`new` 抛 TypeError
  assert.deepEqual(Object.getOwnPropertyNames(shaped), ['length', 'name']);
  assert.equal(Object.prototype.hasOwnProperty.call(shaped, 'prototype'), false);
  assert.throws(() => new (shaped as any)(), TypeError);
  assert.equal(shaped.call({}), 42);

  // 构造器要显式声明：保留自有 prototype，`new` 可用
  const ctor = disguise(function Fake(this: any, value: any) { this.value = value; }, 'Fake', 1, { construct: true });
  assert.equal(Object.prototype.hasOwnProperty.call(ctor, 'prototype'), true);
  const instance = new (ctor as any)('x');
  assert.equal(instance.value, 'x');
  disguise.uninstall();
});
