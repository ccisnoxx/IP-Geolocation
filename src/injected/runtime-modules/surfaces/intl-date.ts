import type { RuntimeState } from '../types';
import { defineRuntimeProperty, replaceMethod } from '../registry';
import { createIntlPolicy } from '../intl-policy';

export function installDateTimeSpoof(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  config: { timezone?: string | null; language?: string | null; intlMode?: 'strict' | 'compatible'; includeTemporal?: boolean }
): void {
  realmState.values.timezone = config && config.timezone ? config.timezone : null;
  realmState.values.language = config && config.language ? config.language : realmState.values.language;
  const timezone = realmState.values.timezone;
  const spoofLanguage = realmState.values.language;
  if (!timezone && !spoofLanguage) return;

  const originalKey = 'intlDateOriginals';
  const originals = realmState.spoofOriginals[originalKey] || (realmState.spoofOriginals[originalKey] = {
    Date: globals.Date,
    DateTimeFormat: globals.Intl && globals.Intl.DateTimeFormat,
    NumberFormat: globals.Intl && globals.Intl.NumberFormat,
    Collator: globals.Intl && globals.Intl.Collator,
    RelativeTimeFormat: globals.Intl && globals.Intl.RelativeTimeFormat,
    ListFormat: globals.Intl && (globals.Intl as unknown as Record<string, any>).ListFormat,
    PluralRules: globals.Intl && globals.Intl.PluralRules,
    DisplayNames: globals.Intl && globals.Intl.DisplayNames,
    Segmenter: globals.Intl && (globals.Intl as unknown as Record<string, any>).Segmenter,
    resolvedOptions: globals.Intl && globals.Intl.DateTimeFormat && globals.Intl.DateTimeFormat.prototype.resolvedOptions,
    dateToString: globals.Date && globals.Date.prototype.toString,
    dateToDateString: globals.Date && globals.Date.prototype.toDateString,
    dateToTimeString: globals.Date && globals.Date.prototype.toTimeString,
    dateToLocaleString: globals.Date && globals.Date.prototype.toLocaleString,
    dateToLocaleDateString: globals.Date && globals.Date.prototype.toLocaleDateString,
    dateToLocaleTimeString: globals.Date && globals.Date.prototype.toLocaleTimeString,
    getTimezoneOffset: globals.Date && globals.Date.prototype.getTimezoneOffset
  });

  const OriginalDate = originals.Date;
  const OriginalDateTimeFormat = originals.DateTimeFormat;
  if (!OriginalDate || !OriginalDateTimeFormat) return;

  const originalResolvedOptions = originals.resolvedOptions;
  const originalGetTimezoneOffset = originals.getTimezoneOffset;
  const reflectApply = realmState.originals.reflectApply;
  const reflectConstruct = globals.Reflect.construct;

  const getParts = (date: Date, timeZone = realmState.values.timezone) => {
    if (!timeZone) return null;
    try {
      const formatter = new OriginalDateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        era: 'short',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        timeZoneName: 'long'
      });
      const parts: Record<string, string> = {};
      formatter.formatToParts(date).forEach((part: Intl.DateTimeFormatPart) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
      });
      // Date 字符串与墙钟换算使用完整年份；公元前 1 年对应年份 0。
      const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
      parts.year = year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
      return parts;
    } catch {
      return null;
    }
  };

  const dateFromParts = (parts: Record<string, string>, milliseconds = 0) => {
    const date = new OriginalDate(0);
    // 格式化年份不应触发 Date.UTC 对 0..99 的 1900 年映射。
    date.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    date.setUTCHours(Number(parts.hour) % 24, Number(parts.minute), Number(parts.second), milliseconds);
    return date;
  };

  const resolveOffset = (date: Date) => {
    const parts = getParts(date);
    if (!parts || !realmState.values.timezone) return originalGetTimezoneOffset.call(date);
    const asUTC = dateFromParts(parts).getTime();
    return Math.round((date.getTime() - asUTC) / 60000);
  };

  const makeWallTime = (args: unknown[]) => {
    const year = Number(args[0]);
    const month = Number(args[1]);
    const day = args.length > 2 ? Number(args[2]) : 1;
    const hour = args.length > 3 ? Number(args[3]) : 0;
    const minute = args.length > 4 ? Number(args[4]) : 0;
    const second = args.length > 5 ? Number(args[5]) : 0;
    const ms = args.length > 6 ? Number(args[6]) : 0;
    let utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms);
    for (let index = 0; index < 3; index += 1) {
      utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms)
        + resolveOffset(new OriginalDate(utc)) * 60000;
    }
    return utc;
  };

  const getWallDate = (date: Date) => {
    const parts = getParts(date);
    if (!parts) return null;
    return dateFromParts(parts, date.getUTCMilliseconds());
  };

  const policy = createIntlPolicy(config.intlMode, spoofLanguage, timezone);
  const normalizeLocale = policy.locale;
  const normalizeIntlOptions = policy.options;

  const installLocaleConstructorSpoof = (name: string) => {
    if (!globals.Intl) return;
    const OriginalCtor = originals[name];
    if (typeof OriginalCtor !== 'function') return;

    function SpoofedIntlConstructor(this: unknown, locales?: string | string[], options?: unknown) {
      const args = [normalizeLocale(locales), options];
      return new.target ? reflectConstruct(OriginalCtor, args, new.target) : reflectApply(OriginalCtor, this, args);
    }

    realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedIntlConstructor, OriginalCtor);
    SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
    if (typeof OriginalCtor.supportedLocalesOf === 'function') {
      SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
    }
    defineRuntimeProperty(globals, realmState, globals.Intl, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: SpoofedIntlConstructor
    });
  };

  if (!realmState.installedSurfaces.has('intl-date-format')) {
    realmState.installedSurfaces.add('intl-date-format');

    function SpoofedDateTimeFormat(this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const args = [normalizeLocale(locales), normalizeIntlOptions(options)];
      return new.target ? reflectConstruct(OriginalDateTimeFormat, args, new.target) : reflectApply(OriginalDateTimeFormat, this, args);
    }
    realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedDateTimeFormat, OriginalDateTimeFormat);
    SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
    SpoofedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
    defineRuntimeProperty(globals, realmState, globals.Intl, 'DateTimeFormat', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: SpoofedDateTimeFormat
    });

    if (typeof originalResolvedOptions === 'function') {
      replaceMethod(globals, realmState, globals.Intl.DateTimeFormat.prototype, 'resolvedOptions', function resolvedOptions(this: Intl.DateTimeFormat) {
        const options = originalResolvedOptions.call(this);
        if (policy.compatible) return options;
        return {
          ...options,
          locale: realmState.values.language || options.locale,
          timeZone: realmState.values.timezone || options.timeZone
        };
      });
    }

    ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
      .forEach(installLocaleConstructorSpoof);
  }

  if (realmState.values.timezone && !realmState.installedSurfaces.has('date-timezone')) {
    realmState.installedSurfaces.add('date-timezone');

    function SpoofedDate(...args: unknown[]) {
      if (!new.target) return new OriginalDate().toString();
      return reflectConstruct(OriginalDate, args.length > 1 ? [makeWallTime(args)] : args, new.target);
    }
    realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, SpoofedDate, OriginalDate);
    SpoofedDate.prototype = OriginalDate.prototype;
    SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
    SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
    SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
    defineRuntimeProperty(globals, realmState, globals, 'Date', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: SpoofedDate
    });

    replaceMethod(globals, realmState, OriginalDate.prototype, 'getTimezoneOffset', function getTimezoneOffset(this: Date) {
      return resolveOffset(this);
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getFullYear', function getFullYear(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getYear', function getYear(this: Date) {
      return this.getFullYear() - 1900;
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getMonth', function getMonth(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCMonth() : this.getUTCMonth();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getDate', function getDate(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCDate() : this.getUTCDate();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getDay', function getDay(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCDay() : this.getUTCDay();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getHours', function getHours(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCHours() : this.getUTCHours();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getMinutes', function getMinutes(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getSeconds', function getSeconds(this: Date) {
      const wall = getWallDate(this);
      return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'getMilliseconds', function getMilliseconds(this: Date) {
      return this.getUTCMilliseconds();
    });

    const pad = (value: number) => String(value).padStart(2, '0');
    const formatOffset = (date: Date) => {
      const offset = resolveOffset(date);
      const sign = offset <= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
    };
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toDateString', function toDateString(this: Date) {
      const parts = getParts(this);
      if (!parts) return originals.dateToDateString.call(this);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
      return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toTimeString', function toTimeString(this: Date) {
      const parts = getParts(this);
      if (!parts) return originals.dateToTimeString.call(this);
      return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || realmState.values.timezone})`;
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toString', function toString(this: Date) {
      const parts = getParts(this);
      if (!parts) return originals.dateToString.call(this);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
      return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || realmState.values.timezone})`;
    });

    if (config.includeTemporal !== false && globals.Temporal && globals.Temporal.Now) {
      try {
        globals.Temporal.Now.timeZoneId = () => realmState.values.timezone;
      } catch {}
    }
  }

  if (!realmState.installedSurfaces.has('date-locale-methods')) {
    realmState.installedSurfaces.add('date-locale-methods');
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleString', function toLocaleString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleDateString', function toLocaleDateString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    });
    replaceMethod(globals, realmState, OriginalDate.prototype, 'toLocaleTimeString', function toLocaleTimeString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    });
  }
}
