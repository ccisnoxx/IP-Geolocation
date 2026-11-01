import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisguise } from '../src/injected/disguise';
import { createSignalSpoof } from '../src/injected/signal-spoof';

/**
 * 补丁在"非正常调用"下必须与原生同形：传错接收者时抛同样的错误、页面改写原型上的
 * 其它方法时不被带偏、Intl 构造器的 new / 非 new / 子类语义不变。
 * 这些都是公开指纹库判断"被改过"的常用写法，一行就能测出差异。
 *
 * 做法：安装补丁**之前**先记下原生行为，安装后逐项比对。
 */

type Outcome = { threw: boolean; name?: string; message?: string; value?: unknown };
const outcome = (fn: () => unknown): Outcome => {
  try {
    return { threw: false, value: fn() };
  } catch (error: any) {
    return { threw: true, name: error && error.constructor && error.constructor.name, message: error && error.message };
  }
};

// Node 自带的 navigator 读取函数对错误接收者不抛错，与浏览器不同。换成与浏览器 WebIDL 同形的替身：
// 原型上的 getter，接收者不是 Navigator 实例时抛 "Illegal invocation"。
class FakeNavigator {}
for (const [key, value] of [['language', 'zh-CN'], ['languages', Object.freeze(['zh-CN', 'zh'])]] as const) {
  Object.defineProperty(FakeNavigator.prototype, key, {
    get(this: unknown) {
      if (!(this instanceof FakeNavigator)) throw new TypeError('Illegal invocation');
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
Object.defineProperty(globalThis, 'navigator', { value: new FakeNavigator(), configurable: true, writable: true });

const navProto = Object.getPrototypeOf(globalThis.navigator);
const languageGetter = Object.getOwnPropertyDescriptor(navProto, 'language')?.get;
const languagesGetter = Object.getOwnPropertyDescriptor(navProto, 'languages')?.get;

// 原生：错误接收者
const wrongReceiverCases: Record<string, () => unknown> = {
  'getHours.call({})': () => Date.prototype.getHours.call({} as any),
  'getTimezoneOffset.call({})': () => Date.prototype.getTimezoneOffset.call({} as any),
  'setHours.call({}, 1)': () => (Date.prototype.setHours as any).call({}, 1),
  'toString.call({})': () => Date.prototype.toString.call({} as any),
  'toDateString.call({})': () => Date.prototype.toDateString.call({} as any),
  'toLocaleString.call({})': () => Date.prototype.toLocaleString.call({} as any),
  'getHours.call(null)': () => Date.prototype.getHours.call(null as any)
};
if (languageGetter) wrongReceiverCases['navigator language getter.call({})'] = () => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.navigator), 'language')!.get!.call({});
if (languagesGetter) wrongReceiverCases['navigator languages getter.call({})'] = () => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.navigator), 'languages')!.get!.call({});
const nativeOutcomes = Object.fromEntries(Object.entries(wrongReceiverCases).map(([key, fn]) => [key, outcome(fn)]));
const nativeSegmenterCall = outcome(() => ((Intl as any).Segmenter)());

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

test('错误接收者：抛出的错误类型与信息与原生完全一致', () => {
  for (const [key, fn] of Object.entries(wrongReceiverCases)) {
    const patched = outcome(fn);
    assert.equal(nativeOutcomes[key].threw, true, `${key} 原生应当抛错（否则这条用例比不出差异）`);
    assert.deepEqual(patched, nativeOutcomes[key], key);
  }
});

test('页面改写原型上的其它 Date 方法，补丁版 get / set 不被带偏', () => {
  const proto: any = Date.prototype;
  const saved: Record<string, any> = {};
  for (const key of ['getUTCHours', 'getUTCFullYear', 'setUTCHours', 'setTime', 'getTime']) saved[key] = proto[key];
  const savedFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
  const date = new Date('2026-01-01T00:00:00Z');
  try {
    proto.getUTCHours = () => 99;
    proto.getUTCFullYear = () => 1900;
    proto.setUTCHours = () => NaN;
    proto.setTime = () => NaN;
    proto.getTime = () => 0;
    Intl.DateTimeFormat.prototype.formatToParts = () => [];
    assert.equal(date.getHours(), 9, '东京 09:00');
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getTimezoneOffset(), -540);
    const next = date.setHours(15, 0, 0, 0);
    assert.equal(next, Date.UTC(2026, 0, 1, 6));
    assert.equal(date.valueOf(), Date.UTC(2026, 0, 1, 6), 'setHours 真的写回了时间戳');
  } finally {
    for (const [key, value] of Object.entries(saved)) proto[key] = value;
    Intl.DateTimeFormat.prototype.formatToParts = savedFormatToParts;
  }
});

test('Intl 构造器：非 new 调用按原生语义，子类保留自己的原型', () => {
  // DateTimeFormat 允许非 new 调用（旧语义），仍要带上目标时区
  assert.equal((Intl.DateTimeFormat as any)().resolvedOptions().timeZone, 'Asia/Tokyo');
  assert.equal((Intl.NumberFormat as any)().resolvedOptions().locale, 'ja-JP');
  // Segmenter 必须用 new：原生抛错，补丁也要抛同样的错
  assert.equal(nativeSegmenterCall.threw, true);
  assert.deepEqual(outcome(() => ((Intl as any).Segmenter)()), nativeSegmenterCall);

  class Formatter extends Intl.DateTimeFormat {
    hello() { return 'subclass'; }
  }
  const instance = new Formatter();
  assert.equal(instance instanceof Formatter, true);
  assert.equal(instance.hello(), 'subclass');
  assert.equal(instance.resolvedOptions().timeZone, 'Asia/Tokyo');
});

test('正常读取不受影响：navigator 读到目标语言', () => {
  assert.equal((globalThis.navigator as any).language, 'ja-JP');
  assert.deepEqual([...(globalThis.navigator as any).languages], ['ja-JP', 'ja']);
});
