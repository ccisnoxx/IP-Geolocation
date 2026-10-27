import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisguise } from '../src/injected/disguise';
import { createSignalSpoof } from '../src/injected/signal-spoof';

/**
 * 这一层跑的是真 Date / 真 Intl —— 不打桩。
 *
 * 之所以能这么测：`signal-spoof` 里所有时区运算都显式带 `timeZone` 走
 * `Intl.DateTimeFormat`，不依赖宿主 TZ，所以在任何机器上结果都一样。
 * 唯一会改全局的是 installDateConstructor（替换 globalThis.Date），
 * node --test 每个文件一个进程，出了这个文件就没人受影响。
 */

const current: { timezone: string | null; language: string | null; languages: string[] | null } = {
  timezone: 'Asia/Tokyo',
  language: 'ja-JP',
  languages: ['ja-JP', 'ja']
};

// 先建 disguise（它会在创建瞬间抓走原生 Function.prototype.toString），再建信号层
const disguise = createDisguise();
const signals = createSignalSpoof({
  timezone: () => current.timezone,
  language: () => current.language,
  languages: () => current.languages,
  disguise
});

signals.installDateMethods();
signals.installDateConstructor();
signals.installIntl();

test('getTimezoneOffset 跟着目标时区走（东京 -540）', () => {
  assert.equal(new Date('2026-01-01T00:00:00Z').getTimezoneOffset(), -540);
  assert.equal(new Date('2026-07-01T00:00:00Z').getTimezoneOffset(), -540, '东京没有夏令时');
});

test('字符串日期：无时区后缀按目标时区的本地时间解释', () => {
  const date = new Date('2026-01-01T00:00:00');
  // 东京本地 00:00 == UTC 前一天 15:00
  assert.equal(date.toISOString(), '2025-12-31T15:00:00.000Z');
  assert.equal(date.getHours(), 0);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(new Date('2026-01-01 00:00:00').getHours(), 0, '空格分隔的写法同样成立');
});

test('字符串日期：纯日期按规范是 UTC，不会被搬', () => {
  const date = new Date('2026-01-01');
  assert.equal(date.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(date.getHours(), 9, 'UTC 零点在东京是早上 9 点');
});

test('字符串日期：带时区标记的是绝对时间，原样返回', () => {
  assert.equal(new Date('2026-01-01T00:00:00Z').toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(new Date('2026-01-01T00:00:00+09:00').toISOString(), '2025-12-31T15:00:00.000Z');
  assert.equal(new Date('2026-01-01T00:00:00-05:00').getHours(), 14);
});

test('Date.parse 与 new Date(string) 说同一句话', () => {
  const parsed = Date.parse('2026-01-01T00:00:00');
  assert.equal(parsed, new Date('2026-01-01T00:00:00').getTime());
  assert.equal(parsed, Date.parse('2026-01-01T00:00:00+09:00'));
});

test('非法日期：三件套都必须是原生的那条 "Invalid Date"', () => {
  const bad = new Date('nope');
  assert.ok(Number.isNaN(bad.getTime()));
  assert.ok(Number.isNaN(bad.getHours()), 'getter 保持 NaN');
  assert.equal(bad.toString(), 'Invalid Date');
  assert.equal(bad.toDateString(), 'Invalid Date');
  assert.equal(bad.toTimeString(), 'Invalid Date');

  const nan = new Date(NaN);
  assert.equal(nan.toString(), 'Invalid Date');
});

test('toString 的形状与原生一致', () => {
  const text = new Date('2026-01-01T00:00:00').toString();
  assert.match(text, /^Thu Jan 01 2026 00:00:00 GMT\+0900 \(/);
  assert.match(text, /\)$/);
});

test('setter 与 getter 落在同一个时区（只改 getter 会当场露馅）', () => {
  const date = new Date('2026-01-01T00:00:00');
  date.setHours(15, 30, 0, 0);
  assert.equal(date.getHours(), 15);
  assert.equal(date.getMinutes(), 30);
  assert.equal(date.toISOString(), '2026-01-01T06:30:00.000Z');

  const next = new Date('2026-01-01T00:00:00');
  next.setFullYear(2027, 5, 15);
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth(), 5);
  assert.equal(next.getDate(), 15);
});

test('多参数构造函数按目标时区解释', () => {
  const date = new Date(2026, 0, 1, 9, 0, 0);
  assert.equal(date.getHours(), 9);
  assert.equal(date.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('Date 本身仍然是个像原生的函数', () => {
  assert.equal(typeof Date, 'function');
  assert.equal(Date.name, 'Date');
  assert.equal(Date.length, 7);
  assert.equal(Date.prototype, new Date().constructor.prototype);
  assert.equal(new Date().constructor, Date);
  assert.equal(typeof Date.now(), 'number');
  assert.equal(Date.toString(), 'function Date() { [native code] }');
});

test('实例没有任何自有属性（原生 Date 也是这样）', () => {
  assert.deepEqual(Object.keys(new Date()), []);
  assert.deepEqual(Object.getOwnPropertyNames(new Date()), []);
});

test('函数签名：不用 Proxy，toString 输出与原生同形', () => {
  // Proxy 的 toString 会退化成 "function () { [native code] }"，名字丢掉
  assert.equal(Date.prototype.setHours.toString(), 'function setHours() { [native code] }');
  assert.equal(Date.prototype.getHours.toString(), 'function getHours() { [native code] }');
  assert.equal(Date.prototype.getTimezoneOffset.toString(), 'function getTimezoneOffset() { [native code] }');
  assert.equal(Date.prototype.toLocaleString.toString(), 'function toLocaleString() { [native code] }');
  assert.equal(Function.prototype.toString.toString(), 'function toString() { [native code] }');

  // name / length 同样要对得上原生的 arity 表
  assert.equal(Date.prototype.setFullYear.length, 3);
  assert.equal(Date.prototype.setMonth.length, 2);
  assert.equal(Date.prototype.setDate.length, 1);
  assert.equal(Date.prototype.setHours.length, 4);
  assert.equal(Date.prototype.setMinutes.length, 3);
  assert.equal(Date.prototype.setSeconds.length, 2);
  assert.equal(Date.prototype.setMilliseconds.length, 1);
  assert.equal(Date.prototype.getHours.length, 0);
});

test('toString 补丁不碰页面自己的函数', () => {
  function pageFunction(a: number, b: number) { return a + b; }
  assert.match(Function.prototype.toString.call(pageFunction), /function pageFunction/);
  assert.equal(Function.prototype.toString.call(() => 1).includes('native code'), false);
});

test('Intl 跟着时区和语言走', () => {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  assert.equal(resolved.timeZone, 'Asia/Tokyo');
  assert.match(resolved.locale, /^ja/);

  // 显式传了就尊重调用方
  const explicit = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions();
  assert.equal(explicit.timeZone, 'UTC');
  assert.equal(explicit.locale, 'en-US');

  // 构造器本身也要像原生
  assert.equal(Intl.DateTimeFormat.name, 'DateTimeFormat');
  assert.equal(Intl.DateTimeFormat.toString(), 'function DateTimeFormat() { [native code] }');
  assert.equal(typeof Intl.DateTimeFormat.supportedLocalesOf, 'function');
  assert.equal(Intl.DateTimeFormat.prototype, new Intl.DateTimeFormat('en').constructor.prototype);
  assert.equal(Intl.NumberFormat.name, 'NumberFormat');

  // 静态方法要跟着走，而且不能因为 this 变了就报错
  assert.deepEqual([...Intl.DateTimeFormat.supportedLocalesOf(['en', 'zh'])], ['en', 'zh']);
  assert.equal(Intl.DateTimeFormat.supportedLocalesOf.name, 'supportedLocalesOf');
  assert.equal(Intl.DateTimeFormat.supportedLocalesOf.toString(), 'function supportedLocalesOf() { [native code] }');

  // toJSON 仍然走 ISO（UTC），不该被时区带偏
  assert.equal(new Date('2026-01-01T00:00:00').toJSON(), '2025-12-31T15:00:00.000Z');
});

test('navigator.languages 是冻结数组（FrozenArray 语义）', () => {
  const navProto = {
    get language() { return 'en-US'; },
    get languages() { return ['en-US']; }
  };
  const navigator = Object.create(navProto);
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true });

  signals.installLanguage();

  assert.equal(navigator.language, 'ja-JP');
  assert.deepEqual([...navigator.languages], ['ja-JP', 'ja']);
  assert.equal(Object.isFrozen(navigator.languages), true);
  assert.throws(() => (navigator.languages as string[]).push('xx'), /not extensible|read only/i);

  // WebIDL attribute 仍然挂在原型上、只读、可枚举
  const desc = Object.getOwnPropertyDescriptor(navProto, 'languages')!;
  assert.equal(typeof desc.get, 'function');
  assert.equal(desc.set, undefined);
  assert.equal(desc.enumerable, true);
  assert.equal(desc.configurable, true);
  // V8 对原生访问器输出的是 "function get x() { [native code] }"，带 get 前缀
  assert.equal(desc.get!.toString(), 'function get languages() { [native code] }');
  assert.equal(desc.get!.name, 'get languages');
});

test('原生快照可用，且"要不要打补丁"由调用方按快照决定', () => {
  // 模块本身不做"该不该改"的判断 —— 它把这个决定交给 runtime：
  // 目标值 == 原生值的场景（TZ + -AppleLanguages 启动的 persona 浏览器）里
  // 一个原生对象都不该动，那是最难被识别的状态。
  assert.equal(typeof signals.native.timeZone, 'string');
  assert.ok(signals.native.timeZone.length > 0);
  assert.equal(typeof signals.native.language, 'string');

  const before = Date.prototype.getHours;
  // 只构造不安装：不该碰任何全局对象
  createSignalSpoof({ timezone: () => 'Europe/Paris', language: () => 'fr-FR', languages: () => null, disguise });
  assert.equal(Date.prototype.getHours, before, '构造阶段必须无副作用');
});