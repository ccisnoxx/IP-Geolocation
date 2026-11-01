import type { Disguise } from './disguise';

export interface SignalSpoofDeps {
  /** 当前目标时区；null 表示不动 Date */
  timezone(): string | null;
  /** 当前目标语言；null 表示不动 navigator.language */
  language(): string | null;
  languages(): string[] | null;
  disguise: Disguise;
}

export interface NativeSnapshot {
  timeZone: string;
  locale: string;
  language: string;
  languages: string[];
}

export interface SignalSpoof {
  /** 模块加载瞬间的真实环境。原生值已经是目标值的地方就不该打补丁。 */
  native: NativeSnapshot;
  installLanguage(): void;
  installDateMethods(): void;
  installDateConstructor(): void;
  installIntl(): void;
  /** 还原所有已安装的替换；之后可以再次 install（配置重新命中时要用） */
  uninstall(): void;
}

/**
 * Date / Intl / navigator.language 这一层"信号伪装"。
 *
 * 每家都独立成一个 install，是因为要不要装取决于**目标值和原生值是否不同**：
 * 在 TZ + `-AppleLanguages` 启动的 persona 浏览器里，这三样本来就对，一个原生对象
 * 都不该改 —— 那才是最难被识别的状态。
 */
export function createSignalSpoof(deps: SignalSpoofDeps): SignalSpoof {
  const scope: any = typeof globalThis !== 'undefined' ? globalThis : {};
  const NativeDate: any = Date;
  const dateProto: any = NativeDate.prototype;
  const IntlRef: any = Intl;

  // 一切原生实现都要在任何 patch 之前抓住
  const nativeGetTimezoneOffset = dateProto.getTimezoneOffset;
  /**
   * 读接收者的时间戳一律走原生 getTime：接收者不是 Date 时抛出与原生一致的
   * "this is not a Date object."；页面改写 Date.prototype.getTime 也影响不到我们的 getter。
   */
  const nativeGetTime = dateProto.getTime;
  const timeOf = (receiver: any): number => nativeGetTime.call(receiver);
  /**
   * 读接收者的时间戳；接收者不是 Date 时让**对应的原生方法**自己抛错。各方法措辞不同：
   * getter 是 "this is not a Date object."，setter / toString 是 "Method Date.prototype.xxx called
   * on incompatible receiver"。原生方法都先校验 this、再读参数，这里不传参数也不会有副作用。
   */
  const timeFor = (receiver: any, nativeFn: any): number => {
    try {
      return timeOf(receiver);
    } catch (error) {
      nativeFn.call(receiver);
      throw error;
    }
  };
  /**
   * 内部换算用到的 UTC 读写同样走原生：页面改写 Date.prototype.getUTCHours / setTime 或
   * Intl.DateTimeFormat.prototype.formatToParts 时，原生 getHours / setHours 不受影响，我们也不能受影响。
   */
  const nativeUTC: Record<string, any> = {};
  for (const key of ['getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds', 'getUTCMilliseconds', 'setUTCFullYear', 'setUTCMonth', 'setUTCDate', 'setUTCHours', 'setUTCMinutes', 'setUTCSeconds', 'setUTCMilliseconds', 'setTime']) nativeUTC[key] = dateProto[key];
  const utc = (date: any, key: string, ...args: any[]): number => nativeUTC[key].apply(date, args);
  const nativeGetYear = dateProto.getYear;
  const nativeLocalSetters: Record<string, any> = {};
  for (const key of ['setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds']) {
    nativeLocalSetters[key] = dateProto[key];
  }
  const nativeGetDay = dateProto.getDay;
  const nativeGetFullYear = dateProto.getFullYear;
  const nativeGetMonth = dateProto.getMonth;
  const nativeGetDate = dateProto.getDate;
  const nativeGetHours = dateProto.getHours;
  const nativeGetMinutes = dateProto.getMinutes;
  const nativeGetSeconds = dateProto.getSeconds;
  const nativeGetMilliseconds = dateProto.getMilliseconds;
  const nativeToString = dateProto.toString;
  const nativeToDateString = dateProto.toDateString;
  const nativeToTimeString = dateProto.toTimeString;
  const nativeToLocaleString = dateProto.toLocaleString;
  const nativeToLocaleDateString = dateProto.toLocaleDateString;
  const nativeToLocaleTimeString = dateProto.toLocaleTimeString;
  const nativeParse = NativeDate.parse;

  const NativeDateTimeFormat = IntlRef.DateTimeFormat;
  const NativeNumberFormat = IntlRef.NumberFormat;
  const NativeCollator = IntlRef.Collator;
  const NativeRelativeTimeFormat = IntlRef.RelativeTimeFormat;
  const NativePluralRules = IntlRef.PluralRules;
  const NativeListFormat = IntlRef.ListFormat;
  const NativeDisplayNames = IntlRef.DisplayNames;
  const NativeSegmenter = IntlRef.Segmenter;
  const NativeDurationFormat = IntlRef.DurationFormat;
  const nativeFormatToParts = NativeDateTimeFormat.prototype.formatToParts;

  /** 读系统时区 / 默认 locale 的其它入口，同样在任何 patch 之前抓住原生实现 */
  const captured = (target: any, key: string): { target: any; key: string; fn: any } => {
    let fn: any = null;
    try {
      if (target && typeof target[key] === 'function') fn = target[key];
    } catch { /* ignore */ }
    return { target, key, fn };
  };
  const TemporalRef: any = scope.Temporal && typeof scope.Temporal === 'object' ? scope.Temporal : null;
  const temporalNow = TemporalRef ? TemporalRef.Now : null;
  const temporalProto = (name: string): any => (TemporalRef && TemporalRef[name] ? TemporalRef[name].prototype : null);
  const nativeTimeZoneId = captured(temporalNow, 'timeZoneId');
  const nativeNowWithZone = ['plainDateTimeISO', 'zonedDateTimeISO', 'plainDateISO', 'plainTimeISO']
    .map((key) => captured(temporalNow, key));
  const nativeInstantToLocaleString = captured(temporalProto('Instant'), 'toLocaleString');
  const nativeTemporalToLocaleStrings = ['ZonedDateTime', 'PlainDateTime', 'PlainDate', 'PlainTime', 'PlainYearMonth', 'PlainMonthDay', 'Duration']
    .map((name) => captured(temporalProto(name), 'toLocaleString'));
  const nativeNumberToLocaleString = captured(scope.Number && scope.Number.prototype, 'toLocaleString');
  const nativeBigIntToLocaleString = captured(scope.BigInt && scope.BigInt.prototype, 'toLocaleString');
  const nativeLocaleCompare = captured(scope.String && scope.String.prototype, 'localeCompare');
  const nativeToLocaleUpperCase = captured(scope.String && scope.String.prototype, 'toLocaleUpperCase');
  const nativeToLocaleLowerCase = captured(scope.String && scope.String.prototype, 'toLocaleLowerCase');
  let nativeLastModified: { proto: any; get: any } | null = null;
  try {
    const proto = scope.Document && scope.Document.prototype;
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'lastModified') : undefined;
    if (descriptor && typeof descriptor.get === 'function') nativeLastModified = { proto, get: descriptor.get };
  } catch { /* ignore */ }

  // 每个补丁在动手之前记下原描述符；uninstall 按相反顺序放回去。
  // 这是"烘焙包排除站点 / 关总开关后能恢复原生"的基础。
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

  const disguise = deps.disguise;

  /**
   * 用 `makeImpl(原生函数)` 替换一个已抓住的原生方法，保留原描述符的
   * writable / enumerable / configurable 与 `length`，并登记还原。原生方法不存在就不动。
   */
  function patchMethod(slot: { target: any; key: string; fn: any }, makeImpl: (nativeFn: any) => any): void {
    if (!slot.target || typeof slot.fn !== 'function') return;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(slot.target, slot.key);
    } catch { /* ignore */ }
    if (!descriptor || !('value' in descriptor)) return;
    remember(slot.target, slot.key);
    try {
      Object.defineProperty(slot.target, slot.key, {
        value: disguise(makeImpl(slot.fn), slot.key, slot.fn.length),
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: true
      });
    } catch { /* ignore */ }
  }

  const native: NativeSnapshot = { timeZone: '', locale: '', language: '', languages: [] };
  try {
    const resolved = new NativeDateTimeFormat().resolvedOptions();
    native.timeZone = resolved.timeZone || '';
    native.locale = resolved.locale || '';
  } catch { /* ignore */ }
  try {
    native.language = scope.navigator ? (scope.navigator.language || '') : '';
  } catch { /* ignore */ }
  try {
    native.languages = scope.navigator && scope.navigator.languages
      ? Array.from(scope.navigator.languages as ArrayLike<string>)
      : [];
  } catch { /* ignore */ }

  let installedLanguage = false;
  let installedDateMethods = false;
  let installedDateConstructor = false;
  let installedIntl = false;

  // ---------- 时区计算 ----------

  let formatterCache: { zone: string; formatter: any } | null = null;
  // 缓存的 key 是"分钟桶"，所以时区一变就必须整体作废 —— 否则换城市之后
  // 前一分钟桶还会吐出旧时区的偏移量。
  let offsetCacheZone = '';
  let offsetCache = new Map<number, number>();

  function partsAt(time: number, zone: string): Record<string, string> {
    if (!formatterCache || formatterCache.zone !== zone) {
      formatterCache = {
        zone,
        formatter: new NativeDateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
          timeZoneName: 'long'
        })
      };
    }
    const out: Record<string, string> = {};
    for (const part of nativeFormatToParts.call(formatterCache.formatter, new NativeDate(time))) {
      if (part.type !== 'literal') out[part.type] = part.value;
    }
    return out;
  }

  /** 返回 getTimezoneOffset 语义的分钟数（UTC - 本地） */
  function offsetAt(time: number): number {
    const zone = deps.timezone();
    if (!zone) return nativeGetTimezoneOffset.call(new NativeDate(time));
    if (!Number.isFinite(time)) return nativeGetTimezoneOffset.call(new NativeDate(time));

    if (offsetCacheZone !== zone) {
      offsetCacheZone = zone;
      offsetCache = new Map<number, number>();
      formatterCache = null;
    }

    // 缓存键必须是**分钟**，不能是小时。
    //
    // 夏令时切换点是按本地时刻定义的（各地普遍是本地 02:00），换算成 UTC 之后不一定
    // 落在整点上：Australia/Lord_Howe 的 +10:30→+11:00 发生在 UTC 15:30，Pacific/
    // Chatham 的 +12:45→+13:45 落在 :45。用小时桶时，桶被切换**前**的调用填过一次，
    // 切换后那半小时内 getTimezoneOffset / getHours / toString 全部沿用旧偏移
    // （实测 Lord Howe 2026-10-04 返回 -630 而真值是 -660）。
    // 真实时区的切换点都落在整分，所以分钟桶既正确、也仍然只占一个 Map 条目。
    const bucket = Math.floor(time / 60000);
    const cached = offsetCache.get(bucket);
    if (cached !== undefined) return cached;

    let value: number;
    try {
      const parts = partsAt(time, zone);
      const asUTC = NativeDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      value = Math.round((time - asUTC) / 60000);
    } catch {
      value = nativeGetTimezoneOffset.call(new NativeDate(time));
    }
    // 分钟桶比小时桶多一个量级：页面上按毫秒随机取时间的检测脚本会很快填满 512 条，
    // 频繁 clear() 让它退化成每毫秒都重算一次 formatToParts。
    if (offsetCache.size > 4096) offsetCache.clear();
    offsetCache.set(bucket, value);
    return value;
  }

  /** 把时间戳换算成"墙上时间"，用 UTC getter 读出来就是目标时区的本地值 */
  function wallDate(time: number): any {
    return new NativeDate(time - offsetAt(time) * 60000);
  }

  /**
   * 墙上时间 → 真实时间戳（`wallDate` 的逆运算）。
   *
   * 收紧两轮是因为偏移量本身依赖结果时刻：跨 DST 时用第一轮的猜测值再算一次偏移，
   * 否则 `setHours` 在换季前后会偏一小时。没有伪装时区时这套运算退化成恒等映射。
   */
  function resolveWallTime(shifted: number, reference: number): number {
    if (!Number.isFinite(shifted)) return NaN;
    let real = shifted + offsetAt(reference) * 60000;
    for (let index = 0; index < 2; index += 1) {
      const next = shifted + offsetAt(real) * 60000;
      if (next === real) break;
      real = next;
    }
    return real;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (value: number) => String(value).padStart(2, '0');

  function offsetText(time: number): string {
    const offset = offsetAt(time);
    const sign = offset <= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  }

  function zoneLabel(time: number): string {
    const zone = deps.timezone();
    try {
      const parts = partsAt(time, zone || 'UTC');
      return parts.timeZoneName || zone || 'UTC';
    } catch {
      return zone || 'UTC';
    }
  }

  // ---------- Date ----------

  function wallNumber(receiver: any, pick: (date: any) => number, fallback: (this: any) => number): number {
    if (!deps.timezone()) return fallback.call(receiver);
    const time = timeFor(receiver, fallback);
    if (!Number.isFinite(time)) return fallback.call(receiver);
    return pick(wallDate(time));
  }

  function formatDateString(date: any): string {
    const wall = wallDate(timeOf(date));
    const month = MONTHS[Math.max(0, Math.min(11, utc(wall, 'getUTCMonth')))];
    const weekday = WEEKDAYS[utc(wall, 'getUTCDay')];
    return `${weekday} ${month} ${pad(utc(wall, 'getUTCDate'))} ${utc(wall, 'getUTCFullYear')}`;
  }

  function formatTimeString(date: any): string {
    const time = timeOf(date);
    const wall = wallDate(time);
    return `${pad(utc(wall, 'getUTCHours'))}:${pad(utc(wall, 'getUTCMinutes'))}:${pad(utc(wall, 'getUTCSeconds'))} GMT${offsetText(time)} (${zoneLabel(time)})`;
  }

  /** 调用方没显式传 locale 时才用伪装值，显式传了就尊重调用方 */
  function effectiveLocale(locales: any): any {
    const language = deps.language();
    if (locales !== undefined && locales !== null) return locales;
    if (!language || language === native.locale) return undefined;
    return language;
  }

  /**
   * 复制一份 options 并把 timeZone 补上，同时**不丢原型上的属性**。
   *
   * `{ ...options, timeZone }` 只搬自有可枚举属性。原生 Intl 读 options 用的是
   * `Get()`，会沿原型链查 —— 所以 `Intl.DateTimeFormat('en', Object.create({ year: 'numeric' }))`
   * 在原生里能正常格式化（继承的 year 生效），被我们展开一次之后继承属性全没了，
   * 输出从 "2026" 变成 "1/1/2026" 这种默认格式。
   *
   * 做法：新建对象时保留原型，再按描述符逐个复制自有属性（getter 也原样保留），
   * 最后写入自己的 timeZone。
   */
  function cloneWithTimeZone(options: any, zone: string): any {
    if (typeof options !== 'object' || options === null) return { timeZone: zone };
    let next: any;
    try {
      next = Object.create(Object.getPrototypeOf(options));
    } catch {
      next = {};
    }
    try {
      for (const key of Reflect.ownKeys(options)) {
        if (key === 'timeZone') continue;
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (descriptor) Object.defineProperty(next, key, descriptor);
      }
      Object.defineProperty(next, 'timeZone', { value: zone, writable: true, enumerable: true, configurable: true });
      return next;
    } catch {
      // 极端情况（不可复制的宿主对象）退回原来的展开语义，至少不比之前更差
      return { ...options, timeZone: zone };
    }
  }

  function withZone(options: any): any {
    const zone = deps.timezone();
    if (!zone) return options;
    if (options === undefined || options === null) return { timeZone: zone };
    if (typeof options === 'object' && options.timeZone === undefined) {
      return cloneWithTimeZone(options, zone);
    }
    return options;
  }

  function installDateMethods(): void {
    if (installedDateMethods) return;
    installedDateMethods = true;

    const define = (key: string, value: any) => {
      remember(dateProto, key);
      try {
        Object.defineProperty(dateProto, key, { value, writable: true, enumerable: false, configurable: true });
      } catch { /* ignore */ }
    };

    define('getTimezoneOffset', disguise(function (this: any) {
      return offsetAt(timeFor(this, nativeGetTimezoneOffset));
    }, 'getTimezoneOffset', 0));

    const getters: Array<[string, (wall: any) => number, (this: any) => number]> = [
      ['getFullYear', (wall) => utc(wall, 'getUTCFullYear'), nativeGetFullYear],
      ['getYear', (wall) => utc(wall, 'getUTCFullYear') - 1900, nativeGetYear],
      ['getMonth', (wall) => utc(wall, 'getUTCMonth'), nativeGetMonth],
      ['getDate', (wall) => utc(wall, 'getUTCDate'), nativeGetDate],
      ['getDay', (wall) => utc(wall, 'getUTCDay'), nativeGetDay],
      ['getHours', (wall) => utc(wall, 'getUTCHours'), nativeGetHours],
      ['getMinutes', (wall) => utc(wall, 'getUTCMinutes'), nativeGetMinutes],
      ['getSeconds', (wall) => utc(wall, 'getUTCSeconds'), nativeGetSeconds],
      ['getMilliseconds', (wall) => utc(wall, 'getUTCMilliseconds'), nativeGetMilliseconds]
    ];
    for (const [key, pick, fallback] of getters) {
      define(key, disguise(function (this: any) {
        return wallNumber(this, pick, fallback);
      }, key, 0));
    }

    // set* 全家必须和 get* 一起改。只改 getter 的话 `d.setHours(0,0,0,0)` 仍按宿主
    // 时区落点，下一行 `d.getHours()` 就返回非 0 —— 一行代码就能证明时区是假的。
    const setters: Array<[string, string, number]> = [
      ['setFullYear', 'setUTCFullYear', 3],
      ['setMonth', 'setUTCMonth', 2],
      ['setDate', 'setUTCDate', 1],
      ['setHours', 'setUTCHours', 4],
      ['setMinutes', 'setUTCMinutes', 3],
      ['setSeconds', 'setUTCSeconds', 2],
      ['setMilliseconds', 'setUTCMilliseconds', 1]
    ];
    for (const [key, utcKey, arity] of setters) {
      define(key, disguise(function (this: any, ...args: any[]) {
        const time = timeFor(this, nativeLocalSetters[key]);
        // setFullYear 是**唯一**在 Invalid Date 上仍然成功的 setter：规范先把 t 归成
        // +0 再落点；setMonth / setDate / setHours 这一族必须返回 NaN。
        // 早先所有 setter 共用一句 `return NaN`，于是
        // `new Date(NaN).setFullYear(2026)` 得到 NaN（原生是一个有效时间戳）。
        const base = Number.isFinite(time) ? time : (utcKey === 'setUTCFullYear' ? 0 : NaN);
        if (!Number.isFinite(base)) return NaN;
        const wall = wallDate(base);
        utc(wall, utcKey, ...args);
        const next = resolveWallTime(timeOf(wall), base);
        utc(this, 'setTime', next);
        return next;
      }, key, arity));
    }

    // 非法日期必须原样报 'Invalid Date'：我们自己的格式化会把 NaN 变成
    // "Invalid Date 00:00:00 GMT+0900 (…)" 这种不存在的字符串。
    define('toString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToString.call(this);
      if (!Number.isFinite(timeFor(this, nativeToString))) return 'Invalid Date';
      return `${formatDateString(this)} ${formatTimeString(this)}`;
    }, 'toString', 0));

    define('toDateString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToDateString.call(this);
      if (!Number.isFinite(timeFor(this, nativeToDateString))) return 'Invalid Date';
      return formatDateString(this);
    }, 'toDateString', 0));

    define('toTimeString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToTimeString.call(this);
      if (!Number.isFinite(timeFor(this, nativeToTimeString))) return 'Invalid Date';
      return formatTimeString(this);
    }, 'toTimeString', 0));

    define('toLocaleString', disguise(function (this: any, locales?: any, options?: any) {
      return nativeToLocaleString.call(this, effectiveLocale(locales), withZone(options));
    }, 'toLocaleString', 0));

    define('toLocaleDateString', disguise(function (this: any, locales?: any, options?: any) {
      return nativeToLocaleDateString.call(this, effectiveLocale(locales), withZone(options));
    }, 'toLocaleDateString', 0));

    define('toLocaleTimeString', disguise(function (this: any, locales?: any, options?: any) {
      return nativeToLocaleTimeString.call(this, effectiveLocale(locales), withZone(options));
    }, 'toLocaleTimeString', 0));

    installTemporal();
    installLastModified();
  }

  /**
   * Temporal 是 Date 之外第二套读系统时区的入口（Chrome 156 默认开启）：
   * `Temporal.Now.timeZoneId()` 直接返回宿主时区，`plainDateTimeISO()` 等不传时区时
   * 按宿主时区取墙上时间 —— 不补的话一行就能读到真实时区，还能与 Date 对质。
   *
   * 时区只注入给 Now 的默认参数与 `Instant.prototype.toLocaleString`：ZonedDateTime
   * 自带时区，给它的 toLocaleString 传 timeZone 会抛 TypeError（实测），所以其余类型
   * 只补默认 locale（`Duration.toLocaleString()` 同样读宿主默认 locale）。
   */
  function installTemporal(): void {
    patchMethod(nativeTimeZoneId, (nativeFn) => function (this: any) {
      return deps.timezone() || nativeFn.call(this);
    });
    for (const slot of nativeNowWithZone) {
      patchMethod(slot, (nativeFn) => function (this: any, ...args: any[]) {
        const zone = deps.timezone();
        if (zone && args[0] === undefined) return nativeFn.call(this, zone);
        return nativeFn.apply(this, args);
      });
    }
    patchMethod(nativeInstantToLocaleString, (nativeFn) => function (this: any, locales?: any, options?: any) {
      return nativeFn.call(this, effectiveLocale(locales), withZone(options));
    });
    for (const slot of nativeTemporalToLocaleStrings) {
      patchMethod(slot, (nativeFn) => function (this: any, locales?: any, options?: any) {
        return nativeFn.call(this, effectiveLocale(locales), options);
      });
    }
  }

  /**
   * `document.lastModified` 按宿主时区输出 `MM/DD/YYYY HH:MM:SS`，与 Date 对比即可露底。
   * 原生字符串按宿主本地时间解析回时间戳，再按目标时区以同一格式输出。
   */
  function installLastModified(): void {
    if (!nativeLastModified) return;
    const { proto, get: nativeGet } = nativeLastModified;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'lastModified');
    } catch { /* ignore */ }
    if (!descriptor) return;
    remember(proto, 'lastModified');
    try {
      Object.defineProperty(proto, 'lastModified', {
        get: disguise(function (this: any) {
          const text = nativeGet.call(this);
          const zone = deps.timezone();
          if (!zone) return text;
          const time = nativeParse(text);
          if (!Number.isFinite(time)) return text;
          try {
            const parts = partsAt(time, zone);
            return `${parts.month}/${parts.day}/${parts.year} ${pad(Number(parts.hour) % 24)}:${parts.minute}:${parts.second}`;
          } catch {
            return text;
          }
        }, 'get lastModified', 0),
        enumerable: descriptor.enumerable,
        configurable: true
      });
    } catch { /* ignore */ }
  }

  const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  /** 带显式时区标记的字符串是绝对时间，不该被搬到别的时区 */
  const HAS_ZONE = /(?:[zZ]\s*$|[+-]\d{2}:?\d{2}\s*$|\b(?:GMT|UTC)\b)/;

  /**
   * 字符串 → 时间戳。
   *
   * `new Date('2026-01-01T00:00:00')`（没有时区后缀）在原生语义里是**本地时间**，
   * 但"本地"是宿主时区。不改它的话，伪装东京时区之后
   * `new Date('2026-01-01T00:00:00').getHours()` 会得到 8 而不是 0。
   *
   * 三种情况分开处理：
   * - 纯日期 `YYYY-MM-DD`：按规范就是 UTC，原样返回；
   * - 带 `Z` / `+09:00` / `GMT` / `UTC`：绝对时间，原样返回；
   * - 其它（含各种实现自定的本地格式）：用原生 getter 读出宿主墙上时间，
   *   再按目标时区重新落点。这条对 "Jan 1 2026 00:00:00" 这类格式同样成立。
   */
  function parseDateString(value: any): number {
    const text = String(value).trim();
    const parsed = nativeParse(text);
    if (!Number.isFinite(parsed)) return NaN;
    if (!deps.timezone() || ISO_DATE_ONLY.test(text) || HAS_ZONE.test(text)) return parsed;

    const host = new NativeDate(parsed);
    const wall = NativeDate.UTC(
      nativeGetFullYear.call(host),
      nativeGetMonth.call(host),
      nativeGetDate.call(host),
      nativeGetHours.call(host),
      nativeGetMinutes.call(host),
      nativeGetSeconds.call(host),
      nativeGetMilliseconds.call(host)
    );
    return resolveWallTime(wall, parsed);
  }

  function installDateConstructor(): void {
    if (installedDateConstructor) return;
    installedDateConstructor = true;

    function SpoofedDate(this: any, ...args: any[]) {
      if (!new.target) return new NativeDate().toString();
      // 用 Reflect.construct 而不是 `new NativeDate(...)`：后者会把 new.target 丢掉，
      // `class D extends Date {}; new D() instanceof D` 会变成 false（而且 D 的
      // 原型上的方法全部不可见）。new.target === SpoofedDate 时落到 NativeDate，
      // 拿到的是同一条路径、同一个 [[DateValue]] 内部槽。
      const target: any = new.target;
      if (args.length === 0) return Reflect.construct(NativeDate, [], target);
      if (args.length === 1) {
        const value = args[0];
        if (typeof value === 'string') return Reflect.construct(NativeDate, [parseDateString(value)], target);
        return Reflect.construct(NativeDate, [value], target);
      }
      const base = NativeDate.UTC(...args.map(Number));
      return Reflect.construct(NativeDate, [resolveWallTime(base, base)], target);
    }

    // 为什么不用 Proxy 包住原生构造器：Proxy 能把 own keys 和描述符摆平，但
    // `Date.name`、派生类里的 `new.target` 链、以及 `Function.prototype.toString`
    // 的输出都得再补一层，`new Proxy(...)` 的 own keys 也还要逐个去抹。而注入层是
    // strict（vite banner 里的 "use strict"），普通函数不再长出 sloppy 才有的自有
    // `arguments`/`caller`，补上 prototype 与三个静态方法之后 own keys 就是
    // ['length','name','prototype','now','parse','UTC']，与原生逐项相同
    // （`npm run audit:parity` 在真浏览器里对照控制组验这条）。
    const Spoofed: any = disguise(SpoofedDate, 'Date', 7, { construct: true });
    try {
      // 原生 Date.prototype 是 non-writable / non-configurable，这里保持一致
      Object.defineProperty(Spoofed, 'prototype', { value: dateProto, writable: false });
    } catch { /* ignore */ }

    const statics: Array<[string, any, number]> = [
      ['now', disguise(NativeDate.now, 'now', 0), 0],
      ['parse', disguise(function parse(value: any) { return parseDateString(value); }, 'parse', 1), 1],
      ['UTC', disguise(NativeDate.UTC, 'UTC', 7), 7]
    ];
    for (const [key, value] of statics) {
      try {
        Object.defineProperty(Spoofed, key, { value, writable: true, enumerable: false, configurable: true });
      } catch { /* ignore */ }
    }

    remember(dateProto, 'constructor');
    try {
      Object.defineProperty(dateProto, 'constructor', {
        value: Spoofed, writable: true, enumerable: false, configurable: true
      });
    } catch { /* ignore */ }
    remember(scope, 'Date');
    try {
      scope.Date = Spoofed;
    } catch { /* ignore */ }
  }

  // ---------- Intl ----------

  function installIntl(): void {
    if (installedIntl) return;
    installedIntl = true;

    const specs: Array<[string, any, boolean]> = [
      ['DateTimeFormat', NativeDateTimeFormat, true],
      ['NumberFormat', NativeNumberFormat, false],
      ['Collator', NativeCollator, false],
      ['RelativeTimeFormat', NativeRelativeTimeFormat, false],
      ['PluralRules', NativePluralRules, false],
      ['ListFormat', NativeListFormat, false],
      ['DisplayNames', NativeDisplayNames, false],
      ['Segmenter', NativeSegmenter, false],
      ['DurationFormat', NativeDurationFormat, false]
    ];

    for (const [name, Native, needsZone] of specs) {
      if (typeof Native !== 'function') continue;

      const impl = function (this: any, locales?: any, options?: any) {
        const nextLocales = effectiveLocale(locales);
        let nextOptions = options;
        const zone = deps.timezone();
        if (needsZone && zone && zone !== native.timeZone) {
          if (nextOptions === undefined || nextOptions === null) {
            nextOptions = { timeZone: zone };
          } else if (typeof nextOptions === 'object' && nextOptions.timeZone === undefined) {
            // 不能用 `{ ...nextOptions, timeZone }`：展开只搬自有可枚举属性，
            // 原生 Intl 是沿原型链读的（见 cloneWithTimeZone 注释）
            nextOptions = cloneWithTimeZone(nextOptions, zone);
          }
        }
        // new 调用：保留 new.target（子类原型）；普通调用交给原生决定 —— DateTimeFormat /
        // NumberFormat / Collator 返回实例，Segmenter 等抛出原生的 "requires 'new'"
        return new.target
          ? Reflect.construct(Native, [nextLocales, nextOptions], new.target)
          : Reflect.apply(Native, this, [nextLocales, nextOptions]);
      };

      const spoofed = disguise(impl, name, Native.length, { construct: true });
      try {
        Object.defineProperty(spoofed, 'prototype', { value: Native.prototype, writable: false });
      } catch { /* ignore */ }
      // supportedLocalesOf 这类静态方法要跟着走，否则 Intl.DateTimeFormat 少一个属性
      const statics = Object.getOwnPropertyNames(Native);
      for (const key of statics) {
        if (key === 'length' || key === 'name' || key === 'prototype') continue;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(Native, key);
          if (descriptor) Object.defineProperty(spoofed, key, descriptor);
        } catch { /* ignore */ }
      }
      remember(Native.prototype, 'constructor');
      try {
        Object.defineProperty(Native.prototype, 'constructor', {
          value: spoofed, writable: true, enumerable: false, configurable: true
        });
      } catch { /* ignore */ }
      remember(IntlRef, name);
      try {
        IntlRef[name] = spoofed;
      } catch { /* ignore */ }
    }

    // 不经过 Intl 构造器、直接读宿主默认 locale 的入口。Array / TypedArray 的
    // toLocaleString 会委托给元素自己的 toLocaleString，补了 Number / Date 即可跟上。
    const withLocale = (nativeFn: any) => function (this: any, locales?: any, options?: any) {
      return nativeFn.call(this, effectiveLocale(locales), options);
    };
    patchMethod(nativeNumberToLocaleString, withLocale);
    patchMethod(nativeBigIntToLocaleString, withLocale);
    patchMethod(nativeLocaleCompare, (nativeFn) => function (this: any, that: any, locales?: any, options?: any) {
      return nativeFn.call(this, that, effectiveLocale(locales), options);
    });
    for (const slot of [nativeToLocaleUpperCase, nativeToLocaleLowerCase]) {
      patchMethod(slot, (nativeFn) => function (this: any, locales?: any) {
        return nativeFn.call(this, effectiveLocale(locales));
      });
    }
  }

  // ---------- navigator.language ----------

  function installLanguage(): void {
    if (installedLanguage) return;
    installedLanguage = true;

    const navProto = Object.getPrototypeOf(scope.navigator);
    const languageDesc = Object.getOwnPropertyDescriptor(navProto, 'language');
    const languagesDesc = Object.getOwnPropertyDescriptor(navProto, 'languages');

    // 关闭伪装时要回退到**安装瞬间**的原生值，而不是空串。配置被清空（切站点、
    // 关开关）后 getter 仍然生效，返回 '' / [] 等于当场造出一个真机不存在的状态。
    let nativeLanguage = native.language;
    let nativeLanguages = native.languages.slice();
    try {
      if (scope.navigator) {
        nativeLanguage = String(scope.navigator.language || nativeLanguage);
        nativeLanguages = scope.navigator.languages
          ? Array.from(scope.navigator.languages as ArrayLike<string>)
          : nativeLanguages;
      }
    } catch { /* ignore */ }
    const frozenNativeLanguages = Object.freeze(nativeLanguages.slice());

    // WebIDL 是 `readonly attribute FrozenArray<DOMString> languages`：除了冻结，
    // 还必须**每次返回同一个引用**。原生上 `navigator.languages === navigator.languages`
    // 恒为 true；每次 new 一个数组，一行恒等比较就能看出被动过。
    let cachedKey = '';
    let cachedLanguages: readonly string[] = frozenNativeLanguages;
    const currentLanguages = (): readonly string[] => {
      const target = deps.languages();
      if (!target || target.length === 0) return frozenNativeLanguages;
      const key = target.join('\u0001');
      if (key !== cachedKey) {
        cachedKey = key;
        cachedLanguages = Object.freeze(target.slice());
      }
      return cachedLanguages;
    };

    remember(navProto, 'language');
    try {
      Object.defineProperty(navProto, 'language', {
        get: disguise(function (this: any) {
          // 先让原生 getter 校验接收者：传错对象时抛出原生的 "Illegal invocation"
          if (languageDesc && typeof languageDesc.get === 'function') languageDesc.get.call(this);
          return deps.language() || nativeLanguage;
        }, 'get language', 0),
        enumerable: languageDesc ? languageDesc.enumerable : true,
        configurable: true
      });
    } catch { /* ignore */ }

    remember(navProto, 'languages');
    try {
      Object.defineProperty(navProto, 'languages', {
        get: disguise(function (this: any) {
          if (languagesDesc && typeof languagesDesc.get === 'function') languagesDesc.get.call(this);
          return currentLanguages();
        }, 'get languages', 0),
        enumerable: languagesDesc ? languagesDesc.enumerable : true,
        configurable: true
      });
    } catch { /* ignore */ }
  }

  function uninstall(): void {
    while (restores.length) {
      const restore = restores.pop();
      try { restore?.(); } catch { /* ignore */ }
    }
    installedLanguage = false;
    installedDateMethods = false;
    installedDateConstructor = false;
    installedIntl = false;
    formatterCache = null;
    offsetCacheZone = '';
    offsetCache = new Map();
  }

  return {
    native,
    installLanguage,
    installDateMethods,
    installDateConstructor,
    installIntl,
    uninstall
  };
}