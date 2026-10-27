export interface WorkerPatchConfig {
  timezone?: string | null;
  language?: string | null;
  languages?: string[] | null;
  fontTargets?: string[] | null;
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
 *   Intl        DateTimeFormat / NumberFormat 的默认 locale 与默认 timeZone
 *   Canvas      OffscreenCanvasRenderingContext2D.measureText + fonts.check
 *
 * set* 家族是最容易被漏掉的一环：只改 getter 的话，`d.setHours(0,0,0,0)` 仍然按
 * 宿主时区落点，紧接着的 `d.getHours()` 就会返回非 0 —— 一行代码就能看出时区是假的。
 */
export function workerPatch(config: WorkerPatchConfig): void {
  const scope: any = typeof self !== 'undefined' ? self : (globalThis as any);

  const zone = (config && config.timezone) || '';
  const language = (config && config.language) || '';
  const languageList = config && Array.isArray(config.languages) && config.languages.length
    ? config.languages.slice()
    : (language ? [language] : []);

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

  const wrap = (impl: any, name: string, arity?: number) => {
    try { Object.defineProperty(impl, 'name', { value: name, configurable: true }); } catch { /* ignore */ }
    if (typeof arity === 'number') {
      try { Object.defineProperty(impl, 'length', { value: arity, configurable: true }); } catch { /* ignore */ }
    }
    try { signatures.set(impl, `function ${name}() { [native code] }`); } catch { /* ignore */ }
    return impl;
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

  // ---------- navigator ----------

  if (language) {
    const nav = scope.navigator;
    // 补在**原型**上，不是 navigator 实例上：原生 WorkerNavigator 的实例零自有属性，
    // `Object.getOwnPropertyNames(navigator)` 里出现 language / languages 就是一行检测。
    const navProto = nav ? Object.getPrototypeOf(nav) : null;
    if (navProto) {
      // WebIDL: readonly attribute FrozenArray<DOMString> —— 冻结之外还必须是稳定引用，
      // 否则 `navigator.languages === navigator.languages` 直接是 false。
      const frozenLanguages = Object.freeze(languageList.slice());
      putGetter(navProto, 'language', function () { return language; });
      putGetter(navProto, 'languages', function () { return frozenLanguages; });
    }
  }

  // ---------- Date ----------

  let formatter: any = null;
  const partsAt = (time: number) => {
    if (!formatter) {
      formatter = new NativeDTF('en-US', {
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
      });
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

  const spoofLocale = (locales: any): any => (locales === undefined || locales === null ? (language || undefined) : locales);
  const withZone = (options: any): any => {
    if (!zone) return options;
    if (options === undefined || options === null) return { timeZone: zone };
    if (typeof options === 'object' && options.timeZone === undefined) {
      const next: any = {};
      for (const key in options) {
        if (Object.prototype.hasOwnProperty.call(options, key)) next[key] = options[key];
      }
      next.timeZone = zone;
      return next;
    }
    return options;
  };

  if (zone) {
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
        const time = this.getTime();
        if (time !== time) return NaN;
        return pick(wall(time));
      };
      putValue(dateProto, name, wrap(impl, name), true);
    }

    putValue(dateProto, 'getTimezoneOffset', wrap(function (this: any) {
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
        const time = this.getTime();
        if (time !== time) return NaN;
        const shifted = wall(time);
        (shifted as any)[utcName].apply(shifted, args);
        const next = resolveWall(shifted.getTime());
        this.setTime(next);
        return next;
      };
      putValue(dateProto, name, wrap(impl, name, arity), true);
    }

    putValue(dateProto, 'toDateString', wrap(function (this: any) {
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      const shifted = wall(this.getTime());
      return `${weekdays[shifted.getUTCDay()]} ${months[shifted.getUTCMonth()]} ${pad(shifted.getUTCDate())} ${shifted.getUTCFullYear()}`;
    }, 'toDateString'), true);

    putValue(dateProto, 'toTimeString', wrap(function (this: any) {
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      const time = this.getTime();
      const shifted = wall(time);
      const offset = offsetAt(time);
      const sign = offset <= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      let label = zone;
      try { label = partsAt(time).timeZoneName || zone; } catch { /* ignore */ }
      return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} GMT${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)} (${label})`;
    }, 'toTimeString'), true);

    putValue(dateProto, 'toString', wrap(function (this: any) {
      // 非法日期必须整体返回 'Invalid Date'；拼两个子串会得到
      // "Invalid Date Invalid Date"，真机不会这么输出。
      if (this.getTime() !== this.getTime()) return 'Invalid Date';
      return `${(dateProto as any).toDateString.call(this)} ${(dateProto as any).toTimeString.call(this)}`;
    }, 'toString'), true);
  }

  if (zone || language) {
    putValue(dateProto, 'toLocaleString', wrap(function (this: any, locales?: any, options?: any) {
      return nativeToLocaleString.call(this, spoofLocale(locales), withZone(options));
    }, 'toLocaleString', 0), true);
    putValue(dateProto, 'toLocaleDateString', wrap(function (this: any, locales?: any, options?: any) {
      return nativeToLocaleDateString.call(this, spoofLocale(locales), withZone(options));
    }, 'toLocaleDateString', 0), true);
    putValue(dateProto, 'toLocaleTimeString', wrap(function (this: any, locales?: any, options?: any) {
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
    if (!zone || ISO_DATE_ONLY.test(text) || HAS_ZONE.test(text)) return parsed;

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

  if (zone) {
    const SpoofedDate = function (this: any, ...args: any[]) {
      if (!new.target) return new NativeDate().toString();
      if (args.length === 0) return new NativeDate();
      if (args.length === 1) {
        return typeof args[0] === 'string'
          ? new NativeDate(parseDateString(args[0]))
          : new NativeDate(args[0]);
      }
      const base = NativeDate.UTC(...args.map(Number));
      return new NativeDate(resolveWall(base));
    };
    const Spoofed: any = wrap(SpoofedDate, 'Date', 7);
    try { Object.defineProperty(Spoofed, 'prototype', { value: dateProto, writable: false }); } catch { /* ignore */ }
    putValue(Spoofed, 'now', wrap(NativeDate.now, 'now'), true);
    putValue(Spoofed, 'parse', wrap(function parse(value: any) { return parseDateString(value); }, 'parse', 1), true);
    putValue(Spoofed, 'UTC', wrap(NativeDate.UTC, 'UTC'), true);
    putValue(dateProto, 'constructor', Spoofed, true);
    try { scope.Date = Spoofed; } catch { /* ignore */ }
  }

  // ---------- Intl ----------

  if (zone || language) {
    const specs: Array<[string, any, boolean]> = [
      ['DateTimeFormat', NativeDTF, true],
      ['NumberFormat', NativeNF, false]
    ];
    for (let index = 0; index < specs.length; index += 1) {
      const name = specs[index][0];
      const Native = specs[index][1];
      const needsZone = specs[index][2];
      if (typeof Native !== 'function') continue;

      const spoofed: any = wrap(function (locales?: any, options?: any) {
        const nextLocales = locales === undefined ? (language || undefined) : locales;
        let nextOptions = options;
        if (needsZone && zone) {
          if (nextOptions === undefined || nextOptions === null) nextOptions = { timeZone: zone };
          else if (typeof nextOptions === 'object' && nextOptions.timeZone === undefined) {
            const merged: any = {};
            for (const key in nextOptions) {
              if (Object.prototype.hasOwnProperty.call(nextOptions, key)) merged[key] = nextOptions[key];
            }
            merged.timeZone = zone;
            nextOptions = merged;
          }
        }
        return new (Native as any)(nextLocales, nextOptions);
      }, name, 0);

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

  // ---------- Canvas（字体） ----------
  //
  // 字体伪装在 Worker 里走 OffscreenCanvas：主线程那套补丁够不到这里，
  // 页面只要开个 Worker 量一下宽度就能看出主线程被动过。
  const fontTargets = (config && config.fontTargets) || [];
  if (fontTargets.length) {
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
    const targets = new Set(fontTargets.map(key));
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
    patchMeasure(scope.OffscreenCanvasRenderingContext2D && scope.OffscreenCanvasRenderingContext2D.prototype);
    // fonts.check 不接管：原生对"字体集里没有的家族"本来就返回 true（它测的是
    // FontFaceSet，不是系统字体的安装情况）。我们一改成 false，反而制造出一个
    // 真机永远不会出现的信号 —— 检测方只需要问一句 check('12px Helvetica')。
  }
}