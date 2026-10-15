import type { WorkerPatchConfig } from '../types';
import type { WorkerState } from './registry';
import { createIntlPolicy } from '../intl-policy';

export function installWorkerDateTime(state: WorkerState, patchConfig: WorkerPatchConfig) {
  const { root, originalGetOwnPropertyDescriptor, originalFunctionToString, originalSetPrototypeOf, functionSources } = state;
  const language = patchConfig.language;
  if (patchConfig.timezone || language) {
    const OriginalDate = root.Date;
    const OriginalDateTimeFormat = root.Intl && (root.Intl.DateTimeFormat as any);
    const originalResolvedOptions = OriginalDateTimeFormat && OriginalDateTimeFormat.prototype.resolvedOptions;
    const originalDateToString = OriginalDate && OriginalDate.prototype.toString;
    const originalDateToDateString = OriginalDate && OriginalDate.prototype.toDateString;
    const originalDateToTimeString = OriginalDate && OriginalDate.prototype.toTimeString;
    const originalDateToLocaleString = OriginalDate && OriginalDate.prototype.toLocaleString;
    const originalDateToLocaleDateString = OriginalDate && OriginalDate.prototype.toLocaleDateString;
    const originalDateToLocaleTimeString = OriginalDate && OriginalDate.prototype.toLocaleTimeString;
    const originalGetTimezoneOffset = OriginalDate && OriginalDate.prototype.getTimezoneOffset;
    const policy = createIntlPolicy(patchConfig.intlMode, language, patchConfig.timezone);
    const normalizeLocale = policy.locale;
    const normalizeIntlOptions = policy.options;
    const registerSource = (replacement: unknown, nativeFunction?: Function) => {
      if (typeof replacement === 'function' && typeof nativeFunction === 'function') {
        functionSources.set(replacement, originalFunctionToString.call(nativeFunction));
      }
    };
    const replaceMethod = (owner: object, property: string, replacement: Function, nativeFunction?: Function) => {
      const descriptor = originalGetOwnPropertyDescriptor.call(root.Object, owner, property);
      registerSource(replacement, nativeFunction || descriptor?.value);
      root.Object.defineProperty(owner, property, {
        ...(descriptor || { configurable: true, enumerable: false, writable: true }),
        value: replacement
      });
    };

    if (root.Intl && OriginalDateTimeFormat) {
      function SpoofedDateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return new OriginalDateTimeFormat(normalizeLocale(locales), normalizeIntlOptions(options));
      }
      originalSetPrototypeOf.call(root.Object, SpoofedDateTimeFormat, OriginalDateTimeFormat);
      SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
      if (typeof OriginalDateTimeFormat.supportedLocalesOf === 'function') {
        (SpoofedDateTimeFormat as any).supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
      }
      registerSource(SpoofedDateTimeFormat, OriginalDateTimeFormat);
      root.Object.defineProperty(root.Intl, 'DateTimeFormat', {
        ...(originalGetOwnPropertyDescriptor.call(root.Object, root.Intl, 'DateTimeFormat') || { configurable: true, enumerable: false, writable: true }),
        value: SpoofedDateTimeFormat
      });

      if (typeof originalResolvedOptions === 'function') {
        replaceMethod(OriginalDateTimeFormat.prototype, 'resolvedOptions', function resolvedOptions(this: Intl.DateTimeFormat) {
          const options = originalResolvedOptions.call(this);
          if (policy.compatible) return options;
          return {
            ...options,
            locale: language || options.locale,
            timeZone: patchConfig.timezone || options.timeZone
          };
        }, originalResolvedOptions);
      }

      const intlRecord = root.Intl as unknown as Record<string, any>;
      ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
        .forEach((name) => {
          const OriginalCtor = intlRecord[name];
          if (typeof OriginalCtor !== 'function') return;
          function SpoofedIntlConstructor(locales?: string | string[], options?: unknown) {
            return new OriginalCtor(normalizeLocale(locales), options);
          }
          originalSetPrototypeOf.call(root.Object, SpoofedIntlConstructor, OriginalCtor);
          SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
          if (typeof OriginalCtor.supportedLocalesOf === 'function') {
            SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
          }
          registerSource(SpoofedIntlConstructor, OriginalCtor);
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
          return parts;
        } catch {
          return null;
        }
      };
      const resolveOffset = (date: Date) => {
        const parts = getParts(date);
        if (!parts) return originalGetTimezoneOffset.call(date);
        const asUTC = OriginalDate.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour) % 24,
          Number(parts.minute),
          Number(parts.second)
        );
        return Math.round((date.getTime() - asUTC) / 60000);
      };
      const makeWallDate = (args: IArguments | unknown[]) => {
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
        return new OriginalDate(utc);
      };
      const getWallDate = (date: Date) => {
        const parts = getParts(date);
        if (!parts) return null;
        return new OriginalDate(OriginalDate.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour) % 24,
          Number(parts.minute),
          Number(parts.second),
          date.getUTCMilliseconds()
        ));
      };
      const pad = (value: number) => String(value).padStart(2, '0');
      const formatOffset = (date: Date) => {
        const offset = resolveOffset(date);
        const sign = offset <= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
      };

      function SpoofedDate(this: Date, ...args: unknown[]) {
        if (!(this instanceof SpoofedDate)) {
          return new (SpoofedDate as any)().toString();
        }
        if (args.length === 0) return new OriginalDate();
        if (args.length === 1) return new OriginalDate(args[0] as any);
        return makeWallDate(args);
      }
      originalSetPrototypeOf.call(root.Object, SpoofedDate, OriginalDate);
      SpoofedDate.prototype = OriginalDate.prototype;
      SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
      SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
      SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
      registerSource(SpoofedDate, OriginalDate);
      root.Object.defineProperty(root, 'Date', {
        ...(originalGetOwnPropertyDescriptor.call(root.Object, root, 'Date') || { configurable: true, enumerable: false, writable: true }),
        value: SpoofedDate
      });

      replaceMethod(OriginalDate.prototype, 'getTimezoneOffset', function getTimezoneOffset(this: Date) {
        return resolveOffset(this);
      }, originalGetTimezoneOffset);
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
      }, originalDateToDateString);
      replaceMethod(OriginalDate.prototype, 'toTimeString', function toTimeString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originalDateToTimeString.call(this);
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
      }, originalDateToTimeString);
      replaceMethod(OriginalDate.prototype, 'toString', function toString(this: Date) {
        const parts = getParts(this);
        if (!parts) return originalDateToString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || patchConfig.timezone})`;
      }, originalDateToString);
    }

    if (OriginalDate) {
      if (originalDateToLocaleString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleString', function toLocaleString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        }, originalDateToLocaleString);
      }
      if (originalDateToLocaleDateString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleDateString', function toLocaleDateString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        }, originalDateToLocaleDateString);
      }
      if (originalDateToLocaleTimeString) {
        replaceMethod(OriginalDate.prototype, 'toLocaleTimeString', function toLocaleTimeString(this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          return originalDateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
        }, originalDateToLocaleTimeString);
      }
    }
  }


}
