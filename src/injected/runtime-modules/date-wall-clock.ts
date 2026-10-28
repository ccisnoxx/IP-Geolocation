import { createConversionObserver } from './surfaces/font-conversion';

// Date 参数转换交给原生方法；这里只负责目标时区的墙钟与时间戳换算。
export function createDateWallClock(
  root: typeof globalThis & Record<string, any>,
  NativeDate: DateConstructor,
  wallDate: (date: Date) => Date | null
) {
  const apply = root.Reflect.apply;
  const construct = root.Reflect.construct;
  const getTime = NativeDate.prototype.getTime;
  const setTime = NativeDate.prototype.setTime;
  const utcFullYear = NativeDate.prototype.setUTCFullYear;
  const utcHours = NativeDate.prototype.setUTCHours;
  const nativeParse = NativeDate.parse;
  const nativeUTC = NativeDate.UTC;
  const localGetters = ['getFullYear', 'getMonth', 'getDate', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds']
    .map(name => (NativeDate.prototype as unknown as Record<string, Function>)[name]);
  const observe = createConversionObserver(root, apply);
  const timestamp = (date: Date) => apply(getTime, date, []) as number;

  const instant = (local: number): number => {
    if (!Number.isFinite(local)) return NaN;
    const offsets = new Set<number>();
    // 覆盖普通DST及整日跳变两侧。重叠取较早时间，空缺按跳变前偏移向后平移。
    for (const delta of [-172800000, 0, 172800000]) {
      const sample = local + delta;
      const wall = wallDate(new NativeDate(sample));
      if (wall) offsets.add(sample - timestamp(wall));
    }
    const exact: number[] = [];
    const forward: Array<{ value: number; wall: number }> = [];
    for (const offset of offsets) {
      const value = local + offset;
      const projected = wallDate(new NativeDate(value));
      if (!projected) continue;
      const result = timestamp(projected);
      if (result === local) exact.push(value);
      else if (result > local) forward.push({ value, wall: result });
    }
    if (exact.length) return Math.min(...exact);
    forward.sort((a, b) => a.wall - b.wall || a.value - b.value);
    return forward[0]?.value ?? NaN;
  };

  const localString = (value: unknown, fallback: number): number => {
    if (typeof value !== 'string' || !Number.isFinite(fallback)) return fallback;
    // 日期独立形式仍为UTC；带Z/偏移的字符串仍由原生解析。
    const match = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
    if (!match) {
      const plain = value.replace(/\([^)]*\)/g, '').trim();
      if (/^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?$/.test(value)
        || /\b(?:gmt|utc|ut|est|edt|cst|cdt|mst|mdt|pst|pdt)\b|z\s*$/i.test(plain)
        || /(?:\s|\d:\d{2}(?::\d{2})?(?:\.\d+)?)[+-]\d{2}(?::?\d{2})?\s*$/.test(plain)) return fallback;
      // 仍让原生解析器处理其支持的本地格式；显式UTC消除宿主DST的归一化干扰。
      const utc = apply(nativeParse, NativeDate, [`${value} UTC`]);
      if (Number.isFinite(utc)) return instant(utc);
      // 某些原生接受格式不能附加时区标记，按捕获的原生本地字段移植。
      const parsed = new NativeDate(fallback);
      const fields = localGetters.map(getter => apply(getter, parsed, []));
      const wall = new NativeDate(0);
      apply(utcFullYear, wall, fields.slice(0, 3));
      apply(utcHours, wall, fields.slice(3));
      return instant(timestamp(wall));
    }
    const wall = new NativeDate(0);
    apply(utcFullYear, wall, [Number(match[1]), Number(match[2]) - 1, Number(match[3])]);
    apply(utcHours, wall, [Number(match[4]), Number(match[5]), Number(match[6] || 0), Number((match[7] || '').slice(0, 3).padEnd(3, '0'))]);
    return instant(timestamp(wall));
  };

  const setters: Record<string, Function> = {};
  for (const name of ['FullYear', 'Month', 'Date', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
    const nativeLocal = (NativeDate.prototype as unknown as Record<string, Function>)[`set${name}`];
    const nativeUtc = (NativeDate.prototype as unknown as Record<string, Function>)[`setUTC${name}`];
    setters[`set${name}`] = new root.Proxy(nativeLocal, {
      apply(_target: Function, receiver: Date, args: unknown[]) {
        const time = timestamp(receiver); // 原生品牌校验先于参数转换。
        const wall = wallDate(new NativeDate(time)) || new NativeDate(NaN);
        const local = apply(nativeUtc, wall, args);
        return apply(setTime, receiver, [instant(local)]);
      }
    });
  }
  setters.setYear = new root.Proxy((NativeDate.prototype as unknown as Record<string, Function>).setYear, {
    apply(_target: Function, receiver: Date, args: unknown[]) {
      const time = timestamp(receiver);
      const year = +(args[0] as number);
      const integer = Math.trunc(year);
      const wall = Number.isNaN(time) ? new NativeDate(0) : wallDate(new NativeDate(time))!;
      const local = apply(utcFullYear, wall, [integer >= 0 && integer <= 99 ? 1900 + integer : year]);
      return apply(setTime, receiver, [instant(local)]);
    }
  });

  return {
    setters,
    parse: new root.Proxy(nativeParse, {
      apply(target: Function, receiver: unknown, args: unknown[]) {
        let primitive = args[0];
        const value = primitive !== null && (typeof primitive === 'object' || typeof primitive === 'function')
          ? observe(primitive, result => { primitive = result; }) : primitive;
        const native = apply(target, receiver, args.length ? [value, ...args.slice(1)] : args);
        return localString(primitive, native);
      }
    }),
    construct(args: unknown[], newTarget: Function): Date {
      if (args.length > 1) return construct(NativeDate, [instant(apply(nativeUTC, NativeDate, args))], newTarget);
      let primitive = args[0];
      let forwarded = args;
      if (primitive !== null && (typeof primitive === 'object' || typeof primitive === 'function')) {
        // Date实例有原生内部值复制快路，不能用转换观察器改变它的语义。
        let dateValue = false;
        try { timestamp(primitive as Date); dateValue = true; } catch { /* 非Date走原生ToPrimitive。 */ }
        if (!dateValue) forwarded = [observe(primitive, result => { primitive = result; })];
      }
      const date = construct(NativeDate, forwarded, newTarget) as Date;
      const native = timestamp(date);
      const value = localString(primitive, native);
      if (!Object.is(value, native)) apply(setTime, date, [value]);
      return date;
    }
  };
}
