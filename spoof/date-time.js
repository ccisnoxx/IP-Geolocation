// Main-world timezone and locale patch helpers.
(function(root) {
  function normalizeTimezonePayload(payload) {
    const timezoneConfig = payload.timezoneConfig || { enabled: false, mode: 'auto', timezone: '' };
    const timezone = timezoneConfig.enabled === false
      ? null
      : timezoneConfig.mode === 'manual' && timezoneConfig.timezone
        ? timezoneConfig.timezone
        : payload.timezone || null;
    return { timezone };
  }

  function installDateTimeSpoof(config) {
    const timezone = config && config.timezone ? config.timezone : null;
    const spoofLanguage = config && config.language ? config.language : null;
    if (!timezone && !spoofLanguage) return;

    const globals = typeof globalThis !== 'undefined' ? globalThis : window;
    const originals = globals.__ipGeoOriginals || (globals.__ipGeoOriginals = {
      Date: globals.Date,
      DateTimeFormat: globals.Intl && globals.Intl.DateTimeFormat,
      NumberFormat: globals.Intl && globals.Intl.NumberFormat,
      Collator: globals.Intl && globals.Intl.Collator,
      RelativeTimeFormat: globals.Intl && globals.Intl.RelativeTimeFormat,
      ListFormat: globals.Intl && globals.Intl.ListFormat,
      PluralRules: globals.Intl && globals.Intl.PluralRules,
      DisplayNames: globals.Intl && globals.Intl.DisplayNames,
      Segmenter: globals.Intl && globals.Intl.Segmenter,
      resolvedOptions: globals.Intl
        && globals.Intl.DateTimeFormat
        && globals.Intl.DateTimeFormat.prototype.resolvedOptions,
      dateToString: globals.Date.prototype.toString,
      dateToDateString: globals.Date.prototype.toDateString,
      dateToTimeString: globals.Date.prototype.toTimeString,
      dateToLocaleString: globals.Date.prototype.toLocaleString,
      dateToLocaleDateString: globals.Date.prototype.toLocaleDateString,
      dateToLocaleTimeString: globals.Date.prototype.toLocaleTimeString,
      getTimezoneOffset: globals.Date.prototype.getTimezoneOffset
    });

    const OriginalDate = originals.Date;
    const OriginalDateTimeFormat = originals.DateTimeFormat;
    if (!OriginalDate || !OriginalDateTimeFormat) return;

    const originalResolvedOptions = originals.resolvedOptions;
    const originalGetTimezoneOffset = originals.getTimezoneOffset;

    const isWhoerPage = () => {
      try {
        const host = String((globals.location && globals.location.hostname) || '');
        return /(^|\.)whoer\.com$/i.test(host);
      } catch (error) {
        return false;
      }
    };

    const installWhoerTimezoneCompatibility = () => {
      if (!timezone || !isWhoerPage()) return;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'zone');
        if (descriptor && !descriptor.configurable) return;
        Object.defineProperty(String.prototype, 'zone', {
          get() {
            return String(this);
          },
          configurable: true
        });
      } catch (error) {}
    };

    installWhoerTimezoneCompatibility();

    const getParts = (date, timeZone = timezone) => {
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
        const parts = {};
        formatter.formatToParts(date).forEach((part) => {
          if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return parts;
      } catch (error) {
        return null;
      }
    };

    const resolveOffset = (date) => {
      const parts = getParts(date);
      if (!parts) {
        return originalGetTimezoneOffset.call(date);
      }
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

    const makeWallDate = (args) => {
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

    const getWallDate = (date) => {
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

    const normalizeLocale = (locales) => spoofLanguage || locales;
    const normalizeIntlOptions = (options) => {
      const normalized = { ...(options || {}) };
      if (timezone) normalized.timeZone = timezone;
      return normalized;
    };

    const installLocaleConstructorSpoof = (name) => {
      if (!spoofLanguage || !globals.Intl) return;
      const OriginalCtor = originals[name];
      if (typeof OriginalCtor !== 'function') return;

      function SpoofedIntlConstructor(locales, options) {
        return new OriginalCtor(normalizeLocale(locales), options);
      }

      Object.setPrototypeOf(SpoofedIntlConstructor, OriginalCtor);
      SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
      if (typeof OriginalCtor.supportedLocalesOf === 'function') {
        SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
      }
      globals.Intl[name] = SpoofedIntlConstructor;
    };

    function SpoofedDateTimeFormat(locales, options) {
      return new OriginalDateTimeFormat(normalizeLocale(locales), normalizeIntlOptions(options));
    }
    Object.setPrototypeOf(SpoofedDateTimeFormat, OriginalDateTimeFormat);
    SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
    SpoofedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
    globals.Intl.DateTimeFormat = SpoofedDateTimeFormat;
    globals.Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const options = originalResolvedOptions.call(this);
      return {
        ...options,
        locale: spoofLanguage || options.locale,
        timeZone: timezone || options.timeZone
      };
    };

    [
      'NumberFormat',
      'Collator',
      'RelativeTimeFormat',
      'ListFormat',
      'PluralRules',
      'DisplayNames',
      'Segmenter'
    ].forEach(installLocaleConstructorSpoof);

    if (timezone) {
      function SpoofedDate(...args) {
        if (!(this instanceof SpoofedDate)) {
          return new SpoofedDate().toString();
        }
        if (args.length === 0) return new OriginalDate();
        if (args.length === 1) return new OriginalDate(args[0]);
        return makeWallDate(args);
      }
      Object.setPrototypeOf(SpoofedDate, OriginalDate);
      SpoofedDate.prototype = OriginalDate.prototype;
      SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
      SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
      SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
      globals.Date = SpoofedDate;

      OriginalDate.prototype.getTimezoneOffset = function() {
        return resolveOffset(this);
      };
      OriginalDate.prototype.getFullYear = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
      };
      OriginalDate.prototype.getYear = function() {
        return this.getFullYear() - 1900;
      };
      OriginalDate.prototype.getMonth = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMonth() : this.getUTCMonth();
      };
      OriginalDate.prototype.getDate = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDate() : this.getUTCDate();
      };
      OriginalDate.prototype.getDay = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDay() : this.getUTCDay();
      };
      OriginalDate.prototype.getHours = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCHours() : this.getUTCHours();
      };
      OriginalDate.prototype.getMinutes = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
      };
      OriginalDate.prototype.getSeconds = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
      };
      OriginalDate.prototype.getMilliseconds = function() {
        return this.getUTCMilliseconds();
      };

      const pad = (value) => String(value).padStart(2, '0');
      const formatOffset = (date) => {
        const offset = resolveOffset(date);
        const sign = offset <= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
      };
      OriginalDate.prototype.toDateString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToDateString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
      };
      OriginalDate.prototype.toTimeString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToTimeString.call(this);
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || timezone})`;
      };
      OriginalDate.prototype.toString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || timezone})`;
      };
    }

    OriginalDate.prototype.toLocaleString = function(locales, options) {
      return originals.dateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleDateString = function(locales, options) {
      return originals.dateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleTimeString = function(locales, options) {
      return originals.dateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };

    if (globals.Temporal && globals.Temporal.Now && timezone) {
      try {
        globals.Temporal.Now.timeZoneId = () => timezone;
      } catch (error) {}
    }
  }

  const api = {
    normalizeTimezonePayload,
    installDateTimeSpoof
  };

  root.IPGeoSpoofDateTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
