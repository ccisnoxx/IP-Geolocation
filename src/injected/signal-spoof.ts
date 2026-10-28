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
    for (const part of formatterCache.formatter.formatToParts(new NativeDate(time))) {
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
    const time = receiver.getTime();
    if (!Number.isFinite(time)) return fallback.call(receiver);
    return pick(wallDate(time));
  }

  function formatDateString(date: any): string {
    const wall = wallDate(date.getTime());
    const month = MONTHS[Math.max(0, Math.min(11, wall.getUTCMonth()))];
    const weekday = WEEKDAYS[wall.getUTCDay()];
    return `${weekday} ${month} ${pad(wall.getUTCDate())} ${wall.getUTCFullYear()}`;
  }

  function formatTimeString(date: any): string {
    const time = date.getTime();
    const wall = wallDate(time);
    return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())} GMT${offsetText(time)} (${zoneLabel(time)})`;
  }

  /** 调用方没显式传 locale 时才用伪装值，显式传了就尊重调用方 */
  function effectiveLocale(locales: any): any {
    const language = deps.language();
    if (locales !== undefined && locales !== null) return locales;
    if (!language || language === native.locale) return undefined;
    return language;
  }

  function withZone(options: any): any {
    const zone = deps.timezone();
    if (!zone) return options;
    if (options === undefined || options === null) return { timeZone: zone };
    if (typeof options === 'object' && options.timeZone === undefined) {
      return { ...options, timeZone: zone };
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
      return offsetAt(this.getTime());
    }, 'getTimezoneOffset', 0));

    const getters: Array<[string, (wall: any) => number, (this: any) => number]> = [
      ['getFullYear', (wall) => wall.getUTCFullYear(), nativeGetFullYear],
      ['getYear', (wall) => wall.getUTCFullYear() - 1900, function (this: any) { return this.getFullYear() - 1900; }],
      ['getMonth', (wall) => wall.getUTCMonth(), nativeGetMonth],
      ['getDate', (wall) => wall.getUTCDate(), nativeGetDate],
      ['getDay', (wall) => wall.getUTCDay(), dateProto.getDay],
      ['getHours', (wall) => wall.getUTCHours(), nativeGetHours],
      ['getMinutes', (wall) => wall.getUTCMinutes(), nativeGetMinutes],
      ['getSeconds', (wall) => wall.getUTCSeconds(), nativeGetSeconds],
      ['getMilliseconds', (wall) => wall.getUTCMilliseconds(), nativeGetMilliseconds]
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
        const time = this.getTime();
        if (!Number.isFinite(time)) return NaN;
        const wall = wallDate(time);
        wall[utcKey](...args);
        const next = resolveWallTime(wall.getTime(), time);
        this.setTime(next);
        return next;
      }, key, arity));
    }

    // 非法日期必须原样报 'Invalid Date'：我们自己的格式化会把 NaN 变成
    // "Invalid Date 00:00:00 GMT+0900 (…)" 这种不存在的字符串。
    define('toString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToString.call(this);
      if (!Number.isFinite(this.getTime())) return 'Invalid Date';
      return `${formatDateString(this)} ${formatTimeString(this)}`;
    }, 'toString', 0));

    define('toDateString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToDateString.call(this);
      if (!Number.isFinite(this.getTime())) return 'Invalid Date';
      return formatDateString(this);
    }, 'toDateString', 0));

    define('toTimeString', disguise(function (this: any) {
      if (!deps.timezone()) return nativeToTimeString.call(this);
      if (!Number.isFinite(this.getTime())) return 'Invalid Date';
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
      if (args.length === 0) return new NativeDate();
      if (args.length === 1) {
        const value = args[0];
        if (typeof value === 'string') return new NativeDate(parseDateString(value));
        return new NativeDate(value);
      }
      const base = NativeDate.UTC(...args.map(Number));
      return new NativeDate(resolveWallTime(base, base));
    }

    const Spoofed: any = disguise(SpoofedDate, 'Date', 7);
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
      ['Segmenter', NativeSegmenter, false]
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
            nextOptions = { ...nextOptions, timeZone: zone };
          }
        }
        return new Native(nextLocales, nextOptions);
      };

      const spoofed = disguise(impl, name, Native.length);
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
        get: disguise(function () {
          return deps.language() || nativeLanguage;
        }, 'get language', 0),
        enumerable: languageDesc ? languageDesc.enumerable : true,
        configurable: true
      });
    } catch { /* ignore */ }

    remember(navProto, 'languages');
    try {
      Object.defineProperty(navProto, 'languages', {
        get: disguise(function () {
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