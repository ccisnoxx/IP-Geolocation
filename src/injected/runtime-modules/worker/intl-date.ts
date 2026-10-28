import type { WorkerPatchConfig } from '../types';
import type { WorkerState } from './registry';
import { createIntlPolicy } from '../intl-policy';
import { createDateWallClock } from '../date-wall-clock';

export function installWorkerDateTime(state: WorkerState, patchConfig: WorkerPatchConfig) {
  const { root, originalGetOwnPropertyDescriptor, originalSetPrototypeOf } = state;
  const language = patchConfig.language;
  if (patchConfig.timezone || language) {
    const OriginalDate = root.Date;
    const OriginalDateTimeFormat = root.Intl && (root.Intl.DateTimeFormat as any);
    const originalDateToString = OriginalDate && OriginalDate.prototype.toString;
    const originalDateToDateString = OriginalDate && OriginalDate.prototype.toDateString;
    const originalDateToTimeString = OriginalDate && OriginalDate.prototype.toTimeString;
    const originalDateToLocaleString = OriginalDate && OriginalDate.prototype.toLocaleString;
    const originalDateToLocaleDateString = OriginalDate && OriginalDate.prototype.toLocaleDateString;
    const originalDateToLocaleTimeString = OriginalDate && OriginalDate.prototype.toLocaleTimeString;
    const originalGetTimezoneOffset = OriginalDate && OriginalDate.prototype.getTimezoneOffset;
    const reflectApply = root.Reflect.apply;
    const reflectConstruct = root.Reflect.construct;
    const policy = createIntlPolicy(patchConfig.intlMode, language, patchConfig.timezone);
    const normalizeLocale = policy.locale;
    const normalizeIntlOptions = policy.options;
    const replaceMethod = (owner: object, property: string, replacement: Function) => {
      const descriptor = originalGetOwnPropertyDescriptor.call(root.Object, owner, property);
      root.Object.defineProperty(owner, property, {
        ...(descriptor || { configurable: true, enumerable: false, writable: true }),
        value: replacement
      });
    };

    if (root.Intl && OriginalDateTimeFormat) {
      function SpoofedDateTimeFormat(this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        const args = [normalizeLocale(locales), normalizeIntlOptions(options)];
        return new.target ? reflectConstruct(OriginalDateTimeFormat, args, new.target) : reflectApply(OriginalDateTimeFormat, this, args);
      }
      originalSetPrototypeOf.call(root.Object, SpoofedDateTimeFormat, OriginalDateTimeFormat);
      SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
      if (typeof OriginalDateTimeFormat.supportedLocalesOf === 'function') {
        (SpoofedDateTimeFormat as any).supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
      }
      root.Object.defineProperty(root.Intl, 'DateTimeFormat', {
        ...(originalGetOwnPropertyDescriptor.call(root.Object, root.Intl, 'DateTimeFormat') || { configurable: true, enumerable: false, writable: true }),
        value: SpoofedDateTimeFormat
      });

      const intlRecord = root.Intl as unknown as Record<string, any>;
      ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
        .forEach((name) => {
          const OriginalCtor = intlRecord[name];
          if (typeof OriginalCtor !== 'function') return;
          function SpoofedIntlConstructor(this: unknown, locales?: string | string[], options?: unknown) {
            const args = [normalizeLocale(locales), options];
            return new.target ? reflectConstruct(OriginalCtor, args, new.target) : reflectApply(OriginalCtor, this, args);
          }
          originalSetPrototypeOf.call(root.Object, SpoofedIntlConstructor, OriginalCtor);
          SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
          if (typeof OriginalCtor.supportedLocalesOf === 'function') {
            SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
          }
          root.Object.defineProperty(root.Intl, name, {
            ...(originalGetOwnPropertyDescriptor.call(root.Object, root.Intl, name) || { configurable: true, enumerable: false, writable: true }),
            value: SpoofedIntlConstructor
          });
        });
    }

    if (patchConfig.timezone && OriginalDate && OriginalDateTimeFormat && originalGetTimezoneOffset) {
      const getParts = (date: Date, timeZone = patchConfig.timezone) => {
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
        if (!parts) return originalGetTimezoneOffset.call(date);
        const asUTC = dateFromParts(parts).getTime();
        return Math.round((date.getTime() - asUTC) / 60000);
      };
      const getWallDate = (date: Date) => {
        const parts = getParts(date);
        if (!parts) return null;
        return dateFromParts(parts, date.getUTCMilliseconds());
      };
      const wallClock = createDateWallClock(root, OriginalDate, getWallDate);
      const pad = (value: number) => String(value).padStart(2, '0');
      const formatOffset = (date: Date) => {
        const offset = resolveOffset(date);
        const sign = offset <= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
      };

      function SpoofedDate(...args: unknown[]) {
        if (!new.target) return new OriginalDate().toString();
        return wallClock.construct(args, new.target);
      }
      originalSetPrototypeOf.call(root.Object, SpoofedDate, OriginalDate);
      SpoofedDate.prototype = OriginalDate.prototype;
      SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
      SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
      SpoofedDate.parse = wallClock.parse;
      root.Object.defineProperty(root, 'Date', {
        ...(originalGetOwnPropertyDescriptor.call(root.Object, root, 'Date') || { configurable: true, enumerable: false, writable: true }),
        value: SpoofedDate
      });

      for (const [name, setter] of Object.entries(wallClock.setters)) replaceMethod(OriginalDate.prototype, name, setter);

      replaceMethod(OriginalDate.prototype, 'getTimezoneOffset', function getTimezoneOffset(this: Date) {
        return resolveOffset(this);
      });
      replaceMethod(OriginalDate.prototype, 'getFullYear', function getFullYear(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
      });
      replaceMethod(OriginalDate.prototype, 'getYear', function getYear(this: Date) {
        return this.getFullYear() - 1900;
      });
      replaceMethod(OriginalDate.prototype, 'getMonth', function getMonth(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMonth() : this.getUTCMonth();
      });
      replaceMethod(OriginalDate.prototype, 'getDate', function getDate(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDate() : this.getUTCDate();
      });
      replaceMethod(OriginalDate.prototype, 'getDay', function getDay(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDay() : this.getUTCDay();
      });
      replaceMethod(OriginalDate.prototype, 'getHours', function getHours(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCHours() : this.getUTCHours();
      });
      replaceMethod(OriginalDate.prototype, 'getMinutes', function getMinutes(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
      });
      replaceMethod(OriginalDate.prototype, 'getSeconds', function getSeconds(this: Date) {
        const wall = getWallDate(this);
        return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
      });
      replaceMethod(OriginalDate.prototype, 'getMilliseconds', function getMilliseconds(this: Date) {
        return this.getUTCMilliseconds();
      });
      replaceMethod(OriginalDate.prototype, 'toDateString', function toDateString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originalDateToDateString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
      });
      replaceMethod(OriginalDate.prototype, 'toTimeString', function toTimeString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originalDateToTimeString.call(this);
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
      });
      replaceMethod(OriginalDate.prototype, 'toString', function toString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originalDateToString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
      });
    }

    if (OriginalDate) {
      if (originalDateToLocaleString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleString', function toLocaleString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        });
      }
      if (originalDateToLocaleDateString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleDateString', function toLocaleDateString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        });
      }
      if (originalDateToLocaleTimeString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleTimeString', function toLocaleTimeString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        });
      }
    }
  }


}
