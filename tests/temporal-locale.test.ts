import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisguise } from '../src/injected/disguise';
import { createSignalSpoof } from '../src/injected/signal-spoof';

/**
 * Date / Intl 之外读系统时区与默认 locale 的入口：Temporal、Intl.DurationFormat、
 * Number / BigInt / String 的 locale 方法、document.lastModified。
 *
 * Node 没有 Temporal 与 Document：在调用 createSignalSpoof **之前**放一组记录入参的替身
 * （它在调用瞬间、而不是模块加载时抓原生实现），再验证注入的参数、描述符形状与还原。
 * Number / String / DurationFormat 用真实 Intl，目标 locale 选与默认结果确实不同的那种。
 */

const calls: Array<{ key: string; args: unknown[] }> = [];
const record = (key: string, result: (...args: any[]) => unknown) => function (this: unknown, ...args: unknown[]) {
  calls.push({ key, args });
  return result(...args);
};
const now: Record<string, unknown> = {};
for (const key of ['instant', 'timeZoneId', 'plainDateTimeISO', 'zonedDateTimeISO', 'plainDateISO', 'plainTimeISO']) {
  Object.defineProperty(now, key, {
    value: record(key, (zone?: unknown) => (key === 'timeZoneId' ? 'Asia/Shanghai' : `${key}:${String(zone)}`)),
    writable: true,
    enumerable: false,
    configurable: true
  });
}
const temporal: Record<string, any> = { Now: now };
for (const name of ['Instant', 'ZonedDateTime', 'PlainDateTime', 'PlainDate', 'PlainTime', 'PlainYearMonth', 'PlainMonthDay', 'Duration']) {
  const Type = function () { /* 替身构造器 */ } as any;
  Object.defineProperty(Type.prototype, 'toLocaleString', {
    value: record(`${name}.toLocaleString`, () => name),
    writable: true,
    enumerable: false,
    configurable: true
  });
  temporal[name] = Type;
}
(globalThis as any).Temporal = temporal;

const RAW_LAST_MODIFIED = '01/02/2026 03:04:05';
class FakeDocument {}
Object.defineProperty(FakeDocument.prototype, 'lastModified', {
  get() { return RAW_LAST_MODIFIED; },
  enumerable: true,
  configurable: true
});
(globalThis as any).Document = FakeDocument;

const originals = {
  numberToLocaleString: Number.prototype.toLocaleString,
  bigIntToLocaleString: BigInt.prototype.toLocaleString,
  localeCompare: String.prototype.localeCompare,
  timeZoneId: (now as any).timeZoneId,
  durationFormat: (Intl as any).DurationFormat
};


const current: { timezone: string | null; language: string | null } = { timezone: 'Asia/Tokyo', language: 'de-DE' };
const disguise = createDisguise();
const signals = createSignalSpoof({
  timezone: () => current.timezone,
  language: () => current.language,
  languages: () => (current.language ? [current.language] : null),
  disguise
});
signals.installDateMethods();
signals.installIntl();

const lastCall = (key: string) => [...calls].reverse().find((call) => call.key === key);

test('Temporal.Now.timeZoneId 返回目标时区，*ISO() 不传时区时补上目标时区', () => {
  const T = (globalThis as any).Temporal;
  assert.equal(T.Now.timeZoneId(), 'Asia/Tokyo');
  assert.equal(T.Now.plainDateTimeISO(), 'plainDateTimeISO:Asia/Tokyo');
  assert.equal(T.Now.zonedDateTimeISO(), 'zonedDateTimeISO:Asia/Tokyo');
  assert.equal(T.Now.plainDateISO(), 'plainDateISO:Asia/Tokyo');
  assert.equal(T.Now.plainTimeISO(), 'plainTimeISO:Asia/Tokyo');
  assert.equal(T.Now.plainDateTimeISO('UTC'), 'plainDateTimeISO:UTC', '显式传的时区原样交还');
  assert.equal(T.Now.instant(), 'instant:undefined', 'instant 与时区无关，不动');
});

test('Temporal 的 toLocaleString：Instant 补 locale 与时区，ZonedDateTime 只补 locale', () => {
  const T = (globalThis as any).Temporal;
  T.Instant.prototype.toLocaleString.call({});
  const instant = lastCall('Instant.toLocaleString')!;
  assert.equal(instant.args[0], 'de-DE');
  assert.equal((instant.args[1] as any).timeZone, 'Asia/Tokyo');

  // ZonedDateTime 自带时区，传 timeZone 选项会抛 TypeError（Chrome 实测）
  T.ZonedDateTime.prototype.toLocaleString.call({});
  const zoned = lastCall('ZonedDateTime.toLocaleString')!;
  assert.equal(zoned.args[0], 'de-DE');
  assert.equal(zoned.args[1], undefined);

  T.Duration.prototype.toLocaleString.call({}, 'fr-FR');
  assert.equal(lastCall('Duration.toLocaleString')!.args[0], 'fr-FR', '显式 locale 原样交还');
});

test('替换后的 Temporal 方法保持原生形状', () => {
  const T = (globalThis as any).Temporal;
  for (const key of ['timeZoneId', 'plainDateTimeISO']) {
    const descriptor = Object.getOwnPropertyDescriptor(T.Now, key)!;
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.value.length, 0);
    assert.equal(Function.prototype.toString.call(descriptor.value), `function ${key}() { [native code] }`);
    assert.deepEqual(Object.getOwnPropertyNames(descriptor.value).sort(), ['length', 'name']);
  }
});

test('Number / BigInt / String 的默认 locale 跟着目标语言走', () => {
  assert.equal((1234.5).toLocaleString(), '1.234,5', 'de-DE 的千分位与小数点');
  assert.equal((12345678n).toLocaleString(), '12.345.678');
  assert.equal([1234.5, 2].toLocaleString().startsWith('1.234,5'), true, 'Array 委托给元素自己的 toLocaleString');
  assert.equal((1234.5).toLocaleString('en-US'), '1,234.5', '显式 locale 原样交还');

  current.language = 'sv-SE';
  assert.equal('ä'.localeCompare('z'), 1, '瑞典语里 ä 排在 z 之后');
  current.language = 'tr-TR';
  assert.equal('i'.toLocaleUpperCase(), 'İ', '土耳其语带点大写 I');
  assert.equal('I'.toLocaleLowerCase(), 'ı');
  current.language = 'de-DE';
});

test('Intl.DurationFormat 的默认 locale 跟着目标语言走', { skip: typeof (Intl as any).DurationFormat !== 'function' }, () => {
  assert.equal(new (Intl as any).DurationFormat().resolvedOptions().locale, 'de-DE');
});

test('document.lastModified 按目标时区以同一格式输出', () => {
  const time = Date.parse(RAW_LAST_MODIFIED);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(time).map((part) => [part.type, part.value]));
  const expected = `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  assert.equal((new FakeDocument() as any).lastModified, expected);
  const descriptor = Object.getOwnPropertyDescriptor(FakeDocument.prototype, 'lastModified')!;
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.set, undefined);

  current.timezone = null;
  assert.equal((new FakeDocument() as any).lastModified, RAW_LAST_MODIFIED, '没有目标时区时原样返回');
  current.timezone = 'Asia/Tokyo';
});

test('uninstall 把以上入口全部还原成原生', () => {
  signals.uninstall();
  const T = (globalThis as any).Temporal;
  assert.equal(T.Now.timeZoneId(), 'Asia/Shanghai');
  assert.equal(T.Now.plainDateTimeISO(), 'plainDateTimeISO:undefined');
  assert.equal((new FakeDocument() as any).lastModified, RAW_LAST_MODIFIED);
  assert.equal(Number.prototype.toLocaleString, originals.numberToLocaleString);
  assert.equal(BigInt.prototype.toLocaleString, originals.bigIntToLocaleString);
  assert.equal(String.prototype.localeCompare, originals.localeCompare);
  assert.equal(T.Now.timeZoneId, originals.timeZoneId);
  assert.equal((Intl as any).DurationFormat, originals.durationFormat);
});
