type RuntimePayload = {
  extensionEnabled?: boolean;
  enabled?: boolean;
  debugMode?: boolean;
  languageConfig?: {
    enabled: boolean;
    language: string;
    languages: string[];
    acceptLanguage: string;
  } | null;
  timezone?: string | null;
  timezoneConfig?: {
    enabled: boolean;
    mode: 'auto' | 'manual';
    timezone: string;
  };
  geolocation?: {
    enabled?: boolean;
    latitude: number;
    longitude: number;
    accuracy?: number;
    country?: string;
    randomize?: boolean;
    randomRadiusMeters?: number;
    spoofPermission?: boolean;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  canvasConfig?: {
    enabled: boolean;
    spoofFonts: boolean;
    targetFonts: string[];
  };
};

(function() {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (root.__vanishGeoRuntimeReady) return;
  root.__vanishGeoRuntimeReady = true;

  const log = (...args: unknown[]) => {
    if (root.__vanishGeoDebug) {
      console.log('[VanishGeo]', ...args);
    }
  };

  function safeDefineProperty(target: object, property: PropertyKey, descriptor: PropertyDescriptor): void {
    try {
      Object.defineProperty(target, property, descriptor);
    } catch {
      try {
        Object.defineProperty(Object.getPrototypeOf(target), property, descriptor);
      } catch {}
    }
  }

  function normalizeTimezonePayload(payload: RuntimePayload): { timezone: string | null } {
    const timezoneConfig = payload.timezoneConfig || { enabled: false, mode: 'auto', timezone: '' };
    const timezone = timezoneConfig.enabled === false
      ? null
      : timezoneConfig.mode === 'manual' && timezoneConfig.timezone
        ? timezoneConfig.timezone
        : payload.timezone || null;
    return { timezone };
  }

  function installLanguageSpoof(language: string | null, languages: string[] | null): void {
    if (!language) return;
    const normalizedLanguages = languages && languages.length ? languages.slice() : [language];
    const navigatorTarget = navigator as Navigator & Record<string, unknown>;
    const navigatorPrototype = Object.getPrototypeOf(navigatorTarget);

    const languageDescriptor = {
      get: () => language,
      configurable: true,
      enumerable: true
    };
    const languagesDescriptor = {
      get: () => Object.freeze(normalizedLanguages.slice()),
      configurable: true,
      enumerable: true
    };

    safeDefineProperty(navigatorTarget, 'language', languageDescriptor);
    safeDefineProperty(navigatorPrototype, 'language', languageDescriptor);
    safeDefineProperty(navigatorTarget, 'languages', languagesDescriptor);
    safeDefineProperty(navigatorPrototype, 'languages', languagesDescriptor);

    if ('userLanguage' in navigatorTarget) {
      safeDefineProperty(navigatorPrototype, 'userLanguage', languageDescriptor);
    }
    if ('browserLanguage' in navigatorTarget) {
      safeDefineProperty(navigatorPrototype, 'browserLanguage', languageDescriptor);
    }
  }

  function installDateTimeSpoof(config: { timezone?: string | null; language?: string | null }): void {
    const timezone = config && config.timezone ? config.timezone : null;
    const spoofLanguage = config && config.language ? config.language : null;
    if (!timezone && !spoofLanguage) return;

    const globals = typeof globalThis !== 'undefined' ? globalThis as any : window as any;
    const originals = globals.__vanishGeoOriginals || (globals.__vanishGeoOriginals = {
      Date: globals.Date,
      DateTimeFormat: globals.Intl && globals.Intl.DateTimeFormat,
      NumberFormat: globals.Intl && globals.Intl.NumberFormat,
      Collator: globals.Intl && globals.Intl.Collator,
      RelativeTimeFormat: globals.Intl && globals.Intl.RelativeTimeFormat,
      ListFormat: globals.Intl && globals.Intl.ListFormat,
      PluralRules: globals.Intl && globals.Intl.PluralRules,
      DisplayNames: globals.Intl && globals.Intl.DisplayNames,
      Segmenter: globals.Intl && globals.Intl.Segmenter,
      resolvedOptions: globals.Intl && globals.Intl.DateTimeFormat && globals.Intl.DateTimeFormat.prototype.resolvedOptions,
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

    const getParts = (date: Date, timeZone = timezone) => {
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

    const normalizeLocale = (locales?: string | string[]) => spoofLanguage || locales;
    const normalizeIntlOptions = (options?: Intl.DateTimeFormatOptions) => {
      const normalized = { ...(options || {}) };
      if (timezone) normalized.timeZone = timezone;
      return normalized;
    };

    const installLocaleConstructorSpoof = (name: string) => {
      if (!spoofLanguage || !globals.Intl) return;
      const OriginalCtor = originals[name];
      if (typeof OriginalCtor !== 'function') return;

      function SpoofedIntlConstructor(locales?: string | string[], options?: unknown) {
        return new OriginalCtor(normalizeLocale(locales), options);
      }

      Object.setPrototypeOf(SpoofedIntlConstructor, OriginalCtor);
      SpoofedIntlConstructor.prototype = OriginalCtor.prototype;
      if (typeof OriginalCtor.supportedLocalesOf === 'function') {
        SpoofedIntlConstructor.supportedLocalesOf = OriginalCtor.supportedLocalesOf.bind(OriginalCtor);
      }
      globals.Intl[name] = SpoofedIntlConstructor;
    };

    function SpoofedDateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
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

    ['NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat', 'PluralRules', 'DisplayNames', 'Segmenter']
      .forEach(installLocaleConstructorSpoof);

    if (timezone) {
      function SpoofedDate(this: Date, ...args: unknown[]) {
        if (!(this instanceof SpoofedDate)) {
          return new (SpoofedDate as any)().toString();
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

      const pad = (value: number) => String(value).padStart(2, '0');
      const formatOffset = (date: Date) => {
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

    OriginalDate.prototype.toLocaleString = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleDateString = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleTimeString = function(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return originals.dateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };

    if (globals.Temporal && globals.Temporal.Now && timezone) {
      try {
        globals.Temporal.Now.timeZoneId = () => timezone;
      } catch {}
    }
  }

  function randomCoordinateInRadius(lat: number, lon: number, radiusMeters: number) {
    if (radiusMeters <= 0) return { latitude: lat, longitude: lon };
    const earthRadius = 6371000;
    const distance = Math.random() * radiusMeters;
    const bearing = Math.random() * 2 * Math.PI;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / earthRadius)
      + Math.cos(lat1) * Math.sin(distance / earthRadius) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(distance / earthRadius) * Math.cos(lat1),
      Math.cos(distance / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
    );
    return {
      latitude: Math.max(-90, Math.min(90, (lat2 * 180) / Math.PI)),
      longitude: (((lon2 * 180) / Math.PI) + 540) % 360 - 180
    };
  }

  function createGeolocationController(geolocation: NonNullable<RuntimePayload['geolocation']>) {
    const watches = new Map<number, number>();
    let nextWatchId = 1;

    const getCoordinates = () => {
      let latitude = Number(geolocation.latitude);
      let longitude = Number(geolocation.longitude);
      if (geolocation.randomize && Number(geolocation.randomRadiusMeters) > 0) {
        const randomized = randomCoordinateInRadius(latitude, longitude, Number(geolocation.randomRadiusMeters));
        latitude = randomized.latitude;
        longitude = randomized.longitude;
      }
      return {
        latitude,
        longitude,
        accuracy: Number.isFinite(Number(geolocation.accuracy)) ? Number(geolocation.accuracy) : 50
      };
    };

    const buildPosition = () => {
      const coords = getCoordinates();
      return {
        coords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      } as GeolocationPosition;
    };

    return {
      getCurrentPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
        queueMicrotask(() => {
          try {
            successCallback(buildPosition());
          } catch {
            errorCallback?.({
              code: 2,
              message: 'Position unavailable',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            } as GeolocationPositionError);
          }
        });
      },
      watchPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
        const watchId = nextWatchId;
        nextWatchId += 1;
        const intervalId = window.setInterval(() => {
          try {
            successCallback(buildPosition());
          } catch {
            errorCallback?.({
              code: 2,
              message: 'Position unavailable',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            } as GeolocationPositionError);
          }
        }, 3000);
        watches.set(watchId, intervalId);
        queueMicrotask(() => {
          if (watches.has(watchId)) successCallback(buildPosition());
        });
        return watchId;
      },
      clearWatch(watchId: number) {
        const intervalId = watches.get(watchId);
        if (intervalId === undefined) return;
        window.clearInterval(intervalId);
        watches.delete(watchId);
      }
    };
  }

  function installGeolocationSpoof(geolocation: RuntimePayload['geolocation']): void {
    if (!geolocation || !Number.isFinite(Number(geolocation.latitude)) || !Number.isFinite(Number(geolocation.longitude))) return;
    const navigatorTarget = navigator as Navigator & { geolocation?: Geolocation };
    if (!navigatorTarget.geolocation) {
      safeDefineProperty(navigatorTarget, 'geolocation', {
        value: {},
        configurable: true
      });
    }
    const controller = createGeolocationController(geolocation);
    const geo = navigatorTarget.geolocation as Geolocation;
    safeDefineProperty(geo, 'getCurrentPosition', {
      value: controller.getCurrentPosition,
      configurable: true
    });
    safeDefineProperty(geo, 'watchPosition', {
      value: controller.watchPosition,
      configurable: true
    });
    safeDefineProperty(geo, 'clearWatch', {
      value: controller.clearWatch,
      configurable: true
    });
    root.__vanishGeoGeolocationController = controller;

    if (geolocation.spoofPermission !== false && navigator.permissions) {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = ((permissionDesc: PermissionDescriptor) => {
        if (permissionDesc && permissionDesc.name === 'geolocation') {
          return Promise.resolve({
            state: 'granted',
            name: 'geolocation',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return true; }
          } as PermissionStatus);
        }
        return originalQuery(permissionDesc);
      }) as Permissions['query'];
    }
  }

  function installWorkerHooks(patchSource: string): void {
    if (!patchSource || root.__vanishGeoWorkerHooked) return;
    root.__vanishGeoWorkerHooked = true;

    const makeWorkerUrl = (scriptURL: string | URL, options?: WorkerOptions) => {
      const sourceUrl = new URL(String(scriptURL), location.href).href;
      const isModule = options && typeof options === 'object' && options.type === 'module';
      const body = isModule
        ? `${patchSource}\nawait import(${JSON.stringify(sourceUrl)});`
        : `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl)});`;
      return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    };

    if (typeof Worker === 'function') {
      const NativeWorker = Worker;
      root.Worker = function(scriptURL: string | URL, options?: WorkerOptions) {
        try {
          return new NativeWorker(makeWorkerUrl(scriptURL, options), options);
        } catch {
          return new NativeWorker(scriptURL, options);
        }
      } as unknown as typeof Worker;
      Object.setPrototypeOf(root.Worker, NativeWorker);
      root.Worker.prototype = NativeWorker.prototype;
    }

    if (typeof SharedWorker === 'function') {
      const NativeSharedWorker = SharedWorker;
      root.SharedWorker = function(scriptURL: string | URL, optionsOrName?: string | WorkerOptions) {
        try {
          const options = optionsOrName && typeof optionsOrName === 'object' ? optionsOrName : undefined;
          return new NativeSharedWorker(makeWorkerUrl(scriptURL, options), optionsOrName as any);
        } catch {
          return new NativeSharedWorker(scriptURL, optionsOrName as any);
        }
      } as unknown as typeof SharedWorker;
      Object.setPrototypeOf(root.SharedWorker, NativeSharedWorker);
      root.SharedWorker.prototype = NativeSharedWorker.prototype;
    }
  }

  const FONT_SIZE_PATTERN =
    /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

  function fontFamilyKey(family: string): string {
    return family.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '').toLowerCase();
  }

  function splitFontFamilies(familyList: string): string[] {
    const families: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;
    for (const char of familyList) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        current += char;
        escaped = true;
        continue;
      }
      if ((char === '"' || char === "'") && !quote) {
        quote = char;
        current += char;
        continue;
      }
      if (quote && char === quote) {
        quote = null;
        current += char;
        continue;
      }
      if (char === ',' && !quote) {
        if (current.trim()) families.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) families.push(current.trim());
    return families;
  }

  function getFallbackFont(font: string, targetFontKeys: Set<string>): string | null {
    const sizeMatch = font.match(FONT_SIZE_PATTERN);
    if (!sizeMatch || sizeMatch.index === undefined) return null;
    const familyStart = sizeMatch.index + sizeMatch[0].length;
    const prefix = font.slice(0, familyStart).trim();
    const families = splitFontFamilies(font.slice(familyStart).trim());
    if (!families.length) return null;
    const fallbackFamilies = families.filter((family) => !targetFontKeys.has(fontFamilyKey(family)));
    if (fallbackFamilies.length === families.length) return null;
    return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : 'monospace'}`;
  }

  function installCanvasSpoof(canvas: RuntimePayload['canvasConfig']): void {
    if (!canvas || !canvas.enabled || !canvas.spoofFonts || !Array.isArray(canvas.targetFonts)) return;
    if (root.__vanishGeoCanvasHooked) return;
    root.__vanishGeoCanvasHooked = true;

    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const targetFontKeys = new Set(canvas.targetFonts.map(fontFamilyKey));

    function measureTextWithFontFallback(ctx: CanvasRenderingContext2D, text: string): TextMetrics {
      if (ctx.font && targetFontKeys.size > 0) {
        const fallbackFont = getFallbackFont(ctx.font, targetFontKeys);
        if (fallbackFont) {
          const originalFont = ctx.font;
          ctx.font = fallbackFont;
          try {
            return originalMeasureText.call(ctx, text);
          } finally {
            ctx.font = originalFont;
          }
        }
      }
      return originalMeasureText.call(ctx, text);
    }

    HTMLCanvasElement.prototype.getContext = new Proxy(originalGetContext, {
      apply(target, thisArg, args: any[]) {
        const context = Reflect.apply(target, thisArg, args);
        if (context && args[0] === '2d' && 'measureText' in context) {
          Object.defineProperty(context, 'measureText', {
            value: function measureText(this: CanvasRenderingContext2D, text: string) {
              return measureTextWithFontFallback(this, text);
            },
            writable: true,
            enumerable: false,
            configurable: true
          });
        }
        return context;
      }
    }) as typeof HTMLCanvasElement.prototype.getContext;

    CanvasRenderingContext2D.prototype.measureText = function measureText(this: CanvasRenderingContext2D, text: string) {
      return measureTextWithFontFallback(this, text);
    };

    if (document.fonts && document.fonts.check) {
      const originalCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function(font: string, text?: string) {
        if (font && typeof font === 'string' && getFallbackFont(font, targetFontKeys)) {
          return false;
        }
        return originalCheck(font, text);
      };
    }
  }

  function buildWorkerPatchSource(patchConfig: { timezone: string | null; language: string | null; languages: string[] | null }): string {
    const languagePatch = `
      (() => {
        const language = ${JSON.stringify(patchConfig.language)};
        const languages = ${JSON.stringify(patchConfig.languages || [])};
        if (!language || !self.navigator) return;
        try { Object.defineProperty(self.navigator, 'language', { get: () => language, configurable: true }); } catch {}
        try { Object.defineProperty(self.navigator, 'languages', { get: () => Object.freeze(languages.slice()), configurable: true }); } catch {}
      })();
    `;
    return `;(${installDateTimeSpoof.toString()})(${JSON.stringify(patchConfig)});\n${languagePatch}`;
  }

  function applySpoof(payload: RuntimePayload): void {
    if (!payload) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;
    root.__vanishGeoDebug = Boolean(payload.debugMode);

    const geolocation = payload.geolocation || (
      Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude))
        ? { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
        : null
    );
    const timezonePayload = normalizeTimezonePayload(payload);
    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const spoofLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const spoofLanguages = languageConfig && Array.isArray(languageConfig.languages) && languageConfig.languages.length
      ? languageConfig.languages
      : spoofLanguage ? [spoofLanguage] : null;

    installLanguageSpoof(spoofLanguage, spoofLanguages);
    installGeolocationSpoof(geolocation);
    installDateTimeSpoof({ timezone: timezonePayload.timezone, language: spoofLanguage });
    installCanvasSpoof(payload.canvasConfig);
    installWorkerHooks(buildWorkerPatchSource({
      timezone: timezonePayload.timezone,
      language: spoofLanguage,
      languages: spoofLanguages
    }));
    log('applied payload', payload);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'vanishgeo-extension' || data.type !== 'apply-spoof') return;
    applySpoof(data.payload);
  });
})();
