export interface WorkerPatchConfig {
  timezone?: string | null;
  language?: string | null;
  languages?: string[] | null;
  fontTargets?: string[] | null;
  /**
   * 配置热更新的握手口令（每个文档随机生成，由 runtime 通过 postMessage 下发）。
   *
   * 补丁入口是创建时序列化进 blob 的，Worker 跑起来之后唯一的同步通道就是消息。
   * 带口令是为了让页面无法伪造一条"把时区改回去"的配置消息 —— 页面压根不知道口令。
   */
  token?: string | null;
  /** true = 这次下发的是关配置，所有补丁入口退回原生语义 */
  disabled?: boolean | null;
}

/**
 * 注入到 Worker / SharedWorker 里的补丁。
 *
 * **必须完全自包含**：这个函数会被 `toString()` 后塞进 blob 当 Worker 的入口，
 * 所以它不能引用模块作用域里的任何东西（不能 import、不能用 runtime.ts 里的
 * `disguise` / `state` / 缓存）。看起来比外面那套代码"土"是必然的代价。
 *
 * 覆盖范围要和主线程对齐，否则页面开个 Worker 逐个字段比一遍就知道主线程被动过：
 *
 *   navigator   language / languages
 *   Date        构造器（多参数按目标时区解释）、getTimezoneOffset、get* 全家、
 *               **set* 全家**、toLocale* 全家、toString/toDateString/toTimeString
 *   Intl        DateTimeFormat / NumberFormat / Collator / RelativeTimeFormat /
 *               PluralRules / ListFormat / DisplayNames / Segmenter 的默认 locale
 *               （DateTimeFormat 还带默认 timeZone）—— 与主线程的 8 类覆盖一致
 *   Canvas      OffscreenCanvasRenderingContext2D.measureText / fillText / strokeText
 *
 * set* 家族是最容易被漏掉的一环：只改 getter 的话，`d.setHours(0,0,0,0)` 仍然按
 * 宿主时区落点，紧接着的 `d.getHours()` 就会返回非 0 —— 一行代码就能看出时区是假的。
 */
export function workerPatch(config: WorkerPatchConfig): void {
  const scope: any = typeof self !== 'undefined' ? self : (globalThis as any);

  const initial: WorkerPatchConfig = config || {};

  /**
   * 可行变配置：**所有补丁入口都从这里读**，不读创建时闭包里的常量。
   *
   * 为什么必须可变：Worker 的入口是创建时烘焙进 blob 的，配置一旦变化，已跑的
   * Worker 拿不到新值 —— 页面只要在 Worker 里问一次 `new Date().getTimezoneOffset()`
   * 就能发现它和主线程说的不是一回事。主线程会在创建后以及每次配置变化时
   * postMessage 一条带口令的配置（见 applyLiveConfig），这里收到后原地更新。
   *
   * 配置变成空时所有入口退回原生语义（不再伪装），这也是"关闭补丁"能生效的原因。
   */
  const live = {
    zone: initial.timezone || '',
    language: initial.language || '',
    languages: Array.isArray(initial.languages) && initial.languages.length
      ? initial.languages.slice()
      : (initial.language ? [initial.language] : []),
    fontTargets: Array.isArray(initial.fontTargets) ? initial.fontTargets.slice() : []
  };

  /**
   * 伪装成原生函数。
   *
   * 不用 `new Proxy(impl, {})`：`Function.prototype.toString` 对 Proxy 走"未知可调用
   * 对象"分支，输出 `function () { [native code] }` —— **函数名丢了**，和原生期望的
   * `function setHours() { [native code] }` 一比就知道被动过。改成在
   * `Function.prototype.toString` 上查表，签名与原生同形。
   *
   * `arity` 是原生的 `Function.prototype.length`，同样必须一致：
   * `Date.prototype.setHours.length === 4` 也是一行检测。
   */
  const signatures = new WeakMap<object, string>();
  const nativeFunctionToString = Function.prototype.toString;
  const toStringProbe = function toString(this: any) {
    if (typeof this === 'function') {
      const signature = signatures.get(this);
      if (signature !== undefined) return signature;
    }
    return nativeFunctionToString.call(this);
  };
  signatures.set(toStringProbe, 'function toString() { [native code] }');
  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: toStringProbe, writable: true, enumerable: false, configurable: true
    });
  } catch { /* ignore */ }

  /**
   * 方法形状的等价实现：原生原型方法没有自有 `prototype`，也不能被 `new`。
   *
   * `function foo() {}` 声明两样都相反，`Object.getOwnPropertyNames(Date.prototype.getHours)`
   * 在原生上返回 `[]`、在补丁上返回 `['prototype']` —— 一行就能分辨。方法简写
   * `{ [name]() {} }[name]` 恰好两样都对。构造器走 `{ construct: true }` 保留可构造性。
   */
  const methodShaped = (impl: any, name: string): any => {
    const holder: any = {
      [name](this: any, ...args: any[]) {
        return Reflect.apply(impl, this, args);
      }
    };
    return holder[name];
  };
  const wrap = (impl: any, name: string, arity?: number, options?: { construct?: boolean }) => {
    const shaped = options && options.construct === true ? impl : methodShaped(impl, name);
    try { Object.defineProperty(shaped, 'name', { value: name, configurable: true }); } catch { /* ignore */ }
    // 没显式给 arity 时沿用 impl 自己的 length：方法简写的 length 恒为 0，
    // 直接留着会让 `Date.prototype.setHours.length` 从 4 变成 0 —— 一行就能测出来。
    const length = typeof arity === 'number' ? arity : (typeof impl.length === 'number' ? impl.length : undefined);
    if (typeof length === 'number') {
      try { Object.defineProperty(shaped, 'length', { value: length, configurable: true }); } catch { /* ignore */ }
    }
    try { signatures.set(shaped, `function ${name}() { [native code] }`); } catch { /* ignore */ }
    return shaped;
  };
  /**
   * 替换成员时保留原描述符的 enumerable。
   *
   * WebIDL 的 operation（`measureText`）在原型上是可枚举的，ES class 的方法不是；
   * 全局属性（`window.Worker`）同样可枚举。一律写成 false 会留下一个纯描述符指纹，
   * 比函数内容本身好查得多。
   */
  const enumerableOf = (target: any, key: string, fallback: boolean): boolean => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor && typeof descriptor.enumerable === 'boolean') return descriptor.enumerable;
    } catch { /* ignore */ }
    return fallback;
  };
  const putGetter = (target: any, key: string, getter: any): void => {
    try {
      Object.defineProperty(target, key, {
        get: wrap(getter, `get ${key}`),
        enumerable: enumerableOf(target, key, true),
        configurable: true
      });
    } catch { /* ignore */ }
  };
  const putValue = (target: any, key: string, value: any, writable: boolean): void => {
    try {
      Object.defineProperty(target, key, {
        value,
        writable,
        enumerable: enumerableOf(target, key, false),
        configurable: true
      });
    } catch { /* ignore */ }
  };

  // 一切原生实现都要在任何 patch 之前抓住：下面的助手函数自己也要用真实的 Date / Intl
  const NativeDate: any = scope.Date || Date;
  const IntlRef: any = scope.Intl || Intl;
  const NativeDTF: any = IntlRef.DateTimeFormat;
  const NativeNF: any = IntlRef.NumberFormat;
  const dateProto: any = NativeDate.prototype;
  const nativeGetTimezoneOffset = dateProto.getTimezoneOffset;
  const nativeToLocaleString = dateProto.toLocaleString;
  const nativeToLocaleDateString = dateProto.toLocaleDateString;
  const nativeToLocaleTimeString = dateProto.toLocaleTimeString;
  // 字符串日期需要在**替换之前**抓住的原生 getter：宿主时区的墙上时间必须用原生读数，
  // 用我们自己的 getter 会把伪装值当成宿主值，二次换算直接偏掉一个时差。
  const nativeParse = NativeDate.parse;
  const nativeGetFullYear = dateProto.getFullYear;
  const nativeGetMonth = dateProto.getMonth;
  const nativeGetDate = dateProto.getDate;
  const nativeGetHours = dateProto.getHours;
  const nativeGetMinutes = dateProto.getMinutes;
  const nativeGetSeconds = dateProto.getSeconds;
  const nativeGetMilliseconds = dateProto.getMilliseconds;
  const nativeToDateString = dateProto.toDateString;
  const nativeToTimeString = dateProto.toTimeString;
  const nativeToString = dateProto.toString;
  const nativeGetYear = dateProto.getYear;
  const nativeGetDay = dateProto.getDay;
  /** 配置被清空时要把调用原样交还给原生实现（这就是"关补丁"）。 */
  const nativeGetters: Record<string, any> = {
    getFullYear: nativeGetFullYear,
    getYear: nativeGetYear,
    getMonth: nativeGetMonth,
    getDate: nativeGetDate,
    getDay: nativeGetDay,
    getHours: nativeGetHours,
    getMinutes: nativeGetMinutes,
    getSeconds: nativeGetSeconds,
    getMilliseconds: nativeGetMilliseconds
  };
  const nativeSetters: Record<string, any> = {
    setFullYear: dateProto.setFullYear,
    setMonth: dateProto.setMonth,
    setDate: dateProto.setDate,
    setHours: dateProto.setHours,
    setMinutes: dateProto.setMinutes,
    setSeconds: dateProto.setSeconds,
    setMilliseconds: dateProto.setMilliseconds
  };

  // ---------- navigator ----------

  // 无论创建时有没有语言配置都装上 getter：值从 live 里读，配置关掉就退回原生值。
  // 这样"关补丁"和"创建后才配语言"都不需要重新造一个 Worker。
  const nav = scope.navigator;
  // 补在**原型**上，不是 navigator 实例上：原生 WorkerNavigator 的实例零自有属性，
  // `Object.getOwnPropertyNames(navigator)` 里出现 language / languages 就是一行检测。
  const navProto = nav ? Object.getPrototypeOf(nav) : null;
  if (navProto) {
    // 原生 language / languages 的取值（配置清空时原样返回）
    const nativeLanguageDescriptor = Object.getOwnPropertyDescriptor(navProto, 'language');
    const nativeLanguagesDescriptor = Object.getOwnPropertyDescriptor(navProto, 'languages');
    const nativeLanguageValue = (): any => {
      if (nativeLanguageDescriptor && typeof nativeLanguageDescriptor.get === 'function') {
        return nativeLanguageDescriptor.get.call(nav);
      }
      return nav.language;
    };
    const nativeLanguagesValue = (): any => {
      if (nativeLanguagesDescriptor && typeof nativeLanguagesDescriptor.get === 'function') {
        return nativeLanguagesDescriptor.get.call(nav);
      }
      return nav.languages;
    };

    // WebIDL: readonly attribute FrozenArray<DOMString> —— 冻结之外还必须是稳定引用，
    // 否则 `navigator.languages === navigator.languages` 直接是 false。
    let frozenLanguages: any = null;
    let frozenFrom: string[] = [];
    const currentLanguages = (): any => {
      if (!live.language || !live.languages.length) return nativeLanguagesValue();
      if (frozenFrom.length !== live.languages.length || frozenFrom.some((item, index) => item !== live.languages[index])) {
        frozenLanguages = Object.freeze(live.languages.slice());
        frozenFrom = live.languages.slice();
      }
      return frozenLanguages;
    };

    putGetter(navProto, 'language', function () {
      return live.language || nativeLanguageValue();
    });
    putGetter(navProto, 'languages', currentLanguages);
  }

  // ---------- Date ----------

  let formatter: any = null;
  let formatterZone = '\u0000';
  const partsAt = (time: number) => {
    // formatter 绑定了 zone，配置热更新后必须重建 —— 用 formatterZone 记住当前绑的是谁
    if (!formatter || formatterZone !== live.zone) {
      formatter = new NativeDTF('en-US', {
        timeZone: live.zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        timeZoneName: 'long'
      });
      formatterZone = live.zone;
    }
    const out: any = {};
    const parts = formatter.formatToParts(new NativeDate(time));
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part.type !== 'literal') out[part.type] = part.value;
    }
    return out;
  };

  /** getTimezoneOffset 语义的分钟数（UTC - 本地） */
  const offsetAt = (time: number): number => {
    // 没有目标时区时直接用宿主偏移：省掉一次 formatToParts，语义完全相同
    if (!live.zone) return nativeGetTimezoneOffset.call(new NativeDate(time));
    try {
      const parts = partsAt(time);
      const asUTC = NativeDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      const value = Math.round((time - asUTC) / 60000);
      return value === value ? value : nativeGetTimezoneOffset.call(new NativeDate(time));
    } catch {
      try { return nativeGetTimezoneOffset.call(new NativeDate(time)); } catch { return 0; }
    }
  };

  /** 时间戳 → "墙上时间"，用 UTC getter 读出来就是目标时区的本地值 */
  const wall = (time: number) => new NativeDate(time - offsetAt(time) * 60000);
  /** 墙上时间 → 时间戳（跨 DST 再收敛一次，避免错一小时） */
  const resolveWall = (shifted: number): number => {
    if (shifted !== shifted) return NaN;
    let real = shifted + offsetAt(shifted) * 60000;
    for (let index = 0; index < 2; index += 1) {
      const next = shifted + offsetAt(real) * 60000;
      if (next === real) break;
      real = next;
    }
    return real;
  };

  const pad = (value: number) => String(value).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const spoofLocale = (locales: any): any => (
    locales === undefined || locales === null ? (live.language || undefined) : locales
  );
  /**
   * 复制 options 并补 timeZone，**保留原型链**。
   *
   * 原生 Intl 读 options 用 Get()，会沿原型链查；只复制自有可枚举属性会让
   * `Object.create({ year: 'numeric' })` 这种写法丢掉继承项（主线程那份已改，
   * 这里必须同步，否则 Worker 与主线程的输出直接对不上）。
   */
  const withZone = (options: any): any => {
    if (!live.zone) return options;
    if (options === undefined || options === null) return { timeZone: live.zone };
    if (typeof options === 'object' && options.timeZone === undefined) {
      let next: any;
      try {
        next = Object.create(Object.getPrototypeOf(options));
      } catch {
        next = {};
      }
      try {
        const keys = Reflect.ownKeys(options);
        for (let index = 0; index < keys.length; index += 1) {
          const key: any = keys[index];
          if (key === 'timeZone') continue;
          const descriptor = Object.getOwnPropertyDescriptor(options, key);
          if (descriptor) Object.defineProperty(next, key, descriptor);
        }
        Object.defineProperty(next, 'timeZone', { value: live.zone, writable: true, enumerable: true, configurable: true });
        return next;
      } catch {
        next = {};
        for (const key in options) {
          if (Object.prototype.hasOwnProperty.call(options, key)) next[key] = options[key];
        }
        next.timeZone = live.zone;
        return next;
      }
    }
    return options;
  };

  // 注意这里**不再**写 `if (zone) { ... }`：创建时没有时区配置、之后才配上的 Worker
  // 也必须能生效。每个入口自己判断 live.zone —— 为空就把调用原样交还原生实现，
  // 语义与"从没打过补丁"完全一致（这也是关闭补丁后能真正还原的原因）。
  {
    const getters: Array<[string, (wall: any) => number]> = [
      ['getFullYear', (selfWall) => selfWall.getUTCFullYear()],
      ['getYear', (selfWall) => selfWall.getUTCFullYear() - 1900],
      ['getMonth', (selfWall) => selfWall.getUTCMonth()],
      ['getDate', (selfWall) => selfWall.getUTCDate()],
      ['getDay', (selfWall) => selfWall.getUTCDay()],
      ['getHours', (selfWall) => selfWall.getUTCHours()],
      ['getMinutes', (selfWall) => selfWall.getUTCMinutes()],
      ['getSeconds', (selfWall) => selfWall.getUTCSeconds()],
      ['getMilliseconds', (selfWall) => selfWall.getUTCMilliseconds()]
    ];
    for (let index = 0; index < getters.length; index += 1) {
      const name = getters[index][0];
      const pick = getters[index][1];
      const impl = function (this: any) {
        if (!live.zone) return nativeGetters[name].call(this);
        const time = this.getTime();
        if (time !== time) return NaN;
        return pick(wall(time));
      };
      putValue(dateProto, name, wrap(impl, name), true);
    }

    putValue(dateProto, 'getTimezoneOffset', wrap(function (this: any) {
      if (!live.zone) return nativeGetTimezoneOffset.call(this);
      const time = this.getTime();
      if (time !== time) return NaN;
      return offsetAt(time);
    }, 'getTimezoneOffset', 0), true);

    // set* 全家：把参数按"墙上时间"落到 UTC 上，再换算回真实时间戳。
    // 参数原样透传给 setUTC*，所以原生那套缺省值语义（少传几个参数 = 保留当前值、
    // 显式传 undefined = Invalid Date）都被完整继承。
    const setters: Array<[string, string, number]> = [
      ['setFullYear', 'setUTCFullYear', 3],
      ['setMonth', 'setUTCMonth', 2],
      ['setDate', 'setUTCDate', 1],
      ['setHours', 'setUTCHours', 4],
      ['setMinutes', 'setUTCMinutes', 3],
      ['setSeconds', 'setUTCSeconds', 2],
      ['setMilliseconds', 'setUTCMilliseconds', 1]
    ];
    for (let index = 0; index < setters.length; index += 1) {
      const name = setters[index][0];
      const utcName = setters[index][1];
      const arity = setters[index][2];
      const impl = function (this: any, ...args: any[]) {
        if (!live.zone) return nativeSetters[name].apply(this, args);
        const time = this.getTime();
        // setFullYear 在 Invalid Date 上仍然成功（规范把 t 归成 +0），其余 setter 必须 NaN
        const base = time === time ? time : (utcName === 'setUTCFullYear' ? 0 : NaN);
        if (base !== base) return NaN;
        const shifted = wall(base);
        (shifted as any)[utcName].apply(shifted, args);
        const next = resolveWall(shifted.getTime());
        this.setTime(next);
        return next;
      };
      putValue(dateProto, name, wrap(impl, name, arity), true);
    }

    putValue(dateProto, 'toDateString', wrap(function (this: any) {
      if (!live.zone) return nativeToDateString.call(this);
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      const shifted = wall(this.getTime());
      return `${weekdays[shifted.getUTCDay()]} ${months[shifted.getUTCMonth()]} ${pad(shifted.getUTCDate())} ${shifted.getUTCFullYear()}`;
    }, 'toDateString'), true);

    putValue(dateProto, 'toTimeString', wrap(function (this: any) {
      if (!live.zone) return nativeToTimeString.call(this);
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      const time = this.getTime();
      const shifted = wall(time);
      const offset = offsetAt(time);
      const sign = offset <= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      let label = live.zone;
      try { label = partsAt(time).timeZoneName || live.zone; } catch { /* ignore */ }
      return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} GMT${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)} (${label})`;
    }, 'toTimeString'), true);

    putValue(dateProto, 'toString', wrap(function (this: any) {
      if (!live.zone) return nativeToString.call(this);
      // 非法日期必须整体返回 'Invalid Date'；拼两个子串会得到
      // "Invalid Date Invalid Date"，真机不会这么输出。
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      return `${(dateProto as any).toDateString.call(this)} ${(dateProto as any).toTimeString.call(this)}`;
    }, 'toString'), true);

    // toLocale* 一族同时受语言与时区影响，两样都空时原样透传
    putValue(dateProto, 'toLocaleString', wrap(function (this: any, locales?: any, options?: any) {
      if (!live.zone && !live.language) return nativeToLocaleString.call(this);
      return nativeToLocaleString.call(this, spoofLocale(locales), withZone(options));
    }, 'toLocaleString', 0), true);
    putValue(dateProto, 'toLocaleDateString', wrap(function (this: any, locales?: any, options?: any) {
      if (!live.zone && !live.language) return nativeToLocaleDateString.call(this);
      return nativeToLocaleDateString.call(this, spoofLocale(locales), withZone(options));
    }, 'toLocaleDateString', 0), true);
    putValue(dateProto, 'toLocaleTimeString', wrap(function (this: any, locales?: any, options?: any) {
      if (!live.zone && !live.language) return nativeToLocaleTimeString.call(this);
      return nativeToLocaleTimeString.call(this, spoofLocale(locales), withZone(options));
    }, 'toLocaleTimeString', 0), true);
  }

  // new Date(y, m, d, ...) 这组参数在原生里是按宿主时区解释的。不换掉构造器，
  // Worker 里 `new Date(2026, 0, 1).getHours()` 就会和主线程对不上。
  const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  /** 带显式时区标记的字符串是绝对时间，不该被搬 */
  const HAS_ZONE = /(?:[zZ]\s*$|[+-]\d{2}:?\d{2}\s*$|\b(?:GMT|UTC)\b)/;

  /**
   * 字符串 → 时间戳。
   *
   * `new Date('2026-01-01T00:00:00')` 在原生语义里是**本地时间**，但"本地"是宿主时区。
   * 不搬的话，伪装东京时区后 `new Date('2026-01-01T00:00:00').getHours()` 会是 8 而不是 0。
   * 纯日期（按规范就是 UTC）和带 Z/±hh:mm 的绝对时间原样返回。
   */
  const parseDateString = (value: any): number => {
    const text = String(value).trim();
    const parsed = nativeParse(text);
    if (parsed !== parsed) return NaN;
    if (!live.zone || ISO_DATE_ONLY.test(text) || HAS_ZONE.test(text)) return parsed;

    const host = new NativeDate(parsed);
    const shifted = NativeDate.UTC(
      nativeGetFullYear.call(host),
      nativeGetMonth.call(host),
      nativeGetDate.call(host),
      nativeGetHours.call(host),
      nativeGetMinutes.call(host),
      nativeGetSeconds.call(host),
      nativeGetMilliseconds.call(host)
    );
    return resolveWall(shifted);
  };

  // 构造器同样无条件安装：没有时区配置时它整段透传给原生（含 new.target 语义），
  // 有配置时按目标时区解释多参数 / 无时区标记的字符串。
  {
    const SpoofedDate = function (this: any, ...args: any[]) {
      if (!live.zone) return Reflect.construct(NativeDate, args, new.target || NativeDate);
      if (!new.target) return nativeToString.call(new NativeDate());
      // Reflect.construct 保留 new.target：`class D extends Date {}; new D() instanceof D`
      // 才能是 true（早先直接 `new NativeDate()` 会把子类的原型丢掉）
      const target: any = new.target;
      if (args.length === 0) return Reflect.construct(NativeDate, [], target);
      if (args.length === 1) {
        return typeof args[0] === 'string'
          ? Reflect.construct(NativeDate, [parseDateString(args[0])], target)
          : Reflect.construct(NativeDate, [args[0]], target);
      }
      const base = NativeDate.UTC(...args.map(Number));
      return Reflect.construct(NativeDate, [resolveWall(base)], target);
    };
    const Spoofed: any = wrap(SpoofedDate, 'Date', 7, { construct: true });
    try { Object.defineProperty(Spoofed, 'prototype', { value: dateProto, writable: false }); } catch { /* ignore */ }
    putValue(Spoofed, 'now', wrap(NativeDate.now, 'now'), true);
    putValue(Spoofed, 'parse', wrap(function parse(value: any) { return parseDateString(value); }, 'parse', 1), true);
    putValue(Spoofed, 'UTC', wrap(NativeDate.UTC, 'UTC'), true);
    putValue(dateProto, 'constructor', Spoofed, true);
    try { scope.Date = Spoofed; } catch { /* ignore */ }
  }

  // ---------- Intl ----------

  // 覆盖必须和主线程的 8 类完全一致。早先这里只有 DateTimeFormat / NumberFormat，
  // 页面在 Worker 里问一句 `new Intl.Collator().resolvedOptions().locale` 就能看出
  // 主线程被改过、Worker 没改 —— 而 Worker 恰恰是最容易被忽略的执行上下文。
  {
    const specs: Array<[string, any, boolean]> = [
      ['DateTimeFormat', NativeDTF, true],
      ['NumberFormat', NativeNF, false],
      ['Collator', IntlRef.Collator, false],
      ['RelativeTimeFormat', IntlRef.RelativeTimeFormat, false],
      ['PluralRules', IntlRef.PluralRules, false],
      ['ListFormat', IntlRef.ListFormat, false],
      ['DisplayNames', IntlRef.DisplayNames, false],
      ['Segmenter', IntlRef.Segmenter, false]
    ];
    for (let index = 0; index < specs.length; index += 1) {
      const name = specs[index][0];
      const Native = specs[index][1];
      const needsZone = specs[index][2];
      if (typeof Native !== 'function') continue;

      const spoofed: any = wrap(function (locales?: any, options?: any) {
        // 配置为空：原样交还原生，连参数都不碰
        if (!live.zone && !live.language) return new (Native as any)(locales, options);
        const nextLocales = spoofLocale(locales);
        const nextOptions = needsZone ? withZone(options) : options;
        return new (Native as any)(nextLocales, nextOptions);
      }, name, 0, { construct: true });

      try { Object.defineProperty(spoofed, 'prototype', { value: Native.prototype, writable: false }); } catch { /* ignore */ }
      // supportedLocalesOf 这类静态方法要跟着走，否则 Worker 里少一个属性
      const statics = Object.getOwnPropertyNames(Native);
      for (let slot = 0; slot < statics.length; slot += 1) {
        const key = statics[slot];
        if (key === 'length' || key === 'name' || key === 'prototype') continue;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(Native, key);
          if (descriptor) Object.defineProperty(spoofed, key, descriptor);
        } catch { /* ignore */ }
      }
      try {
        Object.defineProperty(Native.prototype, 'constructor', {
          value: spoofed, writable: true, enumerable: false, configurable: true
        });
      } catch { /* ignore */ }
      try { IntlRef[name] = spoofed; } catch { /* ignore */ }
    }
  }

  // 字体目标集合的重建钩子：canvas 段在下面用闭包持有 Set，配置热更新时
  // 需要以新集合替换旧集合，这里先占个位（默认空操作，canvas 段会覆盖它）。
  let rebuildFontTargets: () => void = () => {};

  // ---------- Canvas（字体） ----------
  //
  // 字体伪装在 Worker 里走 OffscreenCanvas：主线程那套补丁够不到这里，
  // 页面只要开个 Worker 量一下宽度就能看出主线程被动过。
  //
  // 同样无条件安装：目标集合由 live 派生，为空时 replacement() 恒返回 null
  // （所有方法原样透传），所以"创建时没有字体配置、之后打开"也能生效。
  {
    const FONT_SIZE = /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;
    // 归一化规则必须与 shared/font-aliases 的 normalizeFontFamily 完全一致：
    // 去引号/空白/小写，并去掉尾随字重（Chromium 把 "PingFang SC Light" 当成独立族名）。
    const key = (family: string) => family
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/["']/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\s*(?:w[1-9]|ultra\s*light|extra\s*light|demilight|demi\s*light|light|thin|hairline|book|regular|normal|roman|medium|semibold|semi\s*bold|demibold|demi\s*bold|bold|extrabold|extra\s*bold|heavy|black|ultra)$/, '')
      .replace(/\s+/g, '');
    const buildTargets = () => new Set(live.fontTargets.map(key));
    let targets = buildTargets();
    rebuildFontTargets = () => { targets = buildTargets(); };
    const splitFamilies = (list: string) => {
      const out: string[] = [];
      let current = '';
      let quote: string | null = null;
      let escaped = false;
      for (const char of list) {
        if (escaped) { current += char; escaped = false; continue; }
        if (char === '\\') { current += char; escaped = true; continue; }
        if ((char === '"' || char === "'") && !quote) { quote = char; current += char; continue; }
        if (quote && char === quote) { quote = null; current += char; continue; }
        if (char === ',' && !quote) { if (current.trim()) out.push(current.trim()); current = ''; continue; }
        current += char;
      }
      if (current.trim()) out.push(current.trim());
      return out;
    };
    /**
     * 命中被伪装字体时返回改写后的 font 串，否则 null。
     *
     * 一个都不剩时填 `"__vg_absent__"` —— 必须与 font-mask.ts 里的
     * MISSING_FONT_FAMILY 一致（这个函数会被 toString() 塞进 blob，无法 import）。
     * 填 monospace 会让隐藏项量出等宽宽度，而真机上的"缺失"是默认回落宽度，
     * 两者差一截，一个对照组就能把"藏起来了"和"真没有"分开。
     */
    const replacement = (font: string) => {
      if (!font) return null;
      const sizeMatch = font.match(FONT_SIZE);
      if (!sizeMatch || sizeMatch.index === undefined) return null;
      const familyStart = sizeMatch.index + sizeMatch[0].length;
      const prefix = font.slice(0, familyStart).trim();
      const families = splitFamilies(font.slice(familyStart).trim());
      if (!families.length) return null;
      const kept = families.filter((family) => !targets.has(key(family)));
      if (kept.length === families.length) return null;
      return `${prefix} ${kept.length ? kept.join(', ') : '"__vg_absent__"'}`;
    };
    const patchMeasure = (proto: any) => {
      const native = proto && proto.measureText;
      if (typeof native !== 'function') return;
      const patched = function (this: any, text: string) {
        const next = replacement(this.font);
        if (!next) return native.call(this, text);
        const original = this.font;
        this.font = next;
        try { return native.call(this, text); } finally { this.font = original; }
      };
      putValue(proto, 'measureText', wrap(patched, 'measureText'), true);
    };
    /**
     * 绘制方法必须和度量用同一条改写路径。
     *
     * 只改 measureText 时，`fillText` 仍然用本机真实字形落像素：检测方拿候选族和
     * 一个必然不存在的族各画一遍比像素，不同就说明字体在。主线程和 Worker 各自
     * 都要覆盖，少一边就等于给检测方留了一条"换个执行上下文再问一次"的路。
     */
    const patchDraw = (proto: any) => {
      const methods = ['fillText', 'strokeText'];
      for (let index = 0; index < methods.length; index += 1) {
        const method = methods[index];
        const nativeDraw = proto && proto[method];
        if (typeof nativeDraw !== 'function') continue;
        const patched = function (this: any, text: string, x: number, y: number, maxWidth?: number) {
          const next = replacement(this.font);
          if (!next) {
            return arguments.length > 3
              ? nativeDraw.call(this, text, x, y, maxWidth)
              : nativeDraw.call(this, text, x, y);
          }
          const original = this.font;
          this.font = next;
          try {
            return arguments.length > 3
              ? nativeDraw.call(this, text, x, y, maxWidth)
              : nativeDraw.call(this, text, x, y);
          } finally { this.font = original; }
        };
        putValue(proto, method, wrap(patched, method), true);
      }
    };
    const offscreenProto = scope.OffscreenCanvasRenderingContext2D && scope.OffscreenCanvasRenderingContext2D.prototype;
    patchMeasure(offscreenProto);
    patchDraw(offscreenProto);
    // fonts.check 不接管：原生对"字体集里没有的家族"本来就返回 true（它测的是
    // FontFaceSet，不是系统字体的安装情况）。我们一改成 false，反而制造出一个
    // 真机永远不会出现的信号 —— 检测方只需要问一句 check('12px Helvetica')。
  }

  // ---------- 配置热更新 ----------

  /**
   * 原地更新 live 配置。`disabled` 或空配置 = 全部退回原生语义。
   *
   * 注意这里**不重建任何补丁**：所有入口都是"读 live → 决定伪装或透传"的形状，
   * 所以一次赋值就让整个 Worker 换到新配置；这也是关闭补丁后存量 Worker 能真正
   * 还原的原因（不需要 reload，也没有残留的旧闭包值）。
   */
  const applyLiveConfig = (next: WorkerPatchConfig | null | undefined) => {
    const source = next || {};
    const off = source.disabled === true;
    live.zone = off ? '' : (source.timezone || '');
    live.language = off ? '' : (source.language || '');
    const fromConfig = !off && Array.isArray(source.languages)
      ? source.languages.filter((item) => typeof item === 'string' && item)
      : [];
    live.languages = fromConfig.length
      ? fromConfig.slice()
      : (live.language ? [live.language] : []);
    live.fontTargets = !off && Array.isArray(source.fontTargets) ? source.fontTargets.slice() : [];
    rebuildFontTargets();
  };

  const token = typeof initial.token === 'string' && initial.token ? initial.token : '';
  // 没有口令就不开通道：口令是唯一的可信边界，无口令的通道等于把配置写权限交给页面。
  // `addEventListener` 守卫是给测试/非 Worker 上下文用的（那里压根没有事件循环）。
  if (token && typeof scope.addEventListener === 'function') {
    scope.addEventListener('message', (event: any) => {
      const data = event && event.data;
      // 页面同样能往这个 Worker postMessage（主线程没独占消息通道），但它不知道口令，
      // 伪造的"把时区改回宿主"消息在这一行被丢掉。
      if (!data || typeof data !== 'object' || data.__vanishGeoWorkerConfig !== token) return;
      // 命中即认领：别让页面挂的监听器顺带看到配置内容
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      applyLiveConfig(data.config || null);
    });
  }
}