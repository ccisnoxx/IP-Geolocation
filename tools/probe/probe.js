/*
 * VanishGeo 反检测探针
 * 在任意页面控制台里粘贴本文件，然后执行：
 *   await __runProbe('manual')
 *
 * 它枚举的是「风控/反滥用脚本实际用来判定环境异常」的那批不变量：
 *   1. 原生函数是否还是 [native code]
 *   2. 构造函数/原型上的恒等关系是否成立
 *   3. 页面全局有没有被扩展写脏
 *   4. 时区、语言、头信息三者是否自洽
 *   5. 跨源 iframe（Turnstile / reCAPTCHA）里同一批值是否一致
 */
(function () {
  const nativeSource = (fn) => {
    try {
      return Function.prototype.toString.call(fn);
    } catch (error) {
      return `ERR:${error && error.message}`;
    }
  };
  const isNative = (fn) => /\[native code\]/.test(nativeSource(fn));

  const FN_PATHS = [
    ['Date', () => Date],
    ['Date.prototype.getTimezoneOffset', () => Date.prototype.getTimezoneOffset],
    ['Date.prototype.getHours', () => Date.prototype.getHours],
    ['Date.prototype.getFullYear', () => Date.prototype.getFullYear],
    ['Date.prototype.toString', () => Date.prototype.toString],
    ['Date.prototype.toLocaleString', () => Date.prototype.toLocaleString],
    ['Date.prototype.toLocaleDateString', () => Date.prototype.toLocaleDateString],
    ['Intl.DateTimeFormat', () => Intl.DateTimeFormat],
    ['Intl.DateTimeFormat.prototype.resolvedOptions', () => Intl.DateTimeFormat.prototype.resolvedOptions],
    ['Intl.NumberFormat', () => Intl.NumberFormat],
    ['Intl.Collator', () => Intl.Collator],
    ['Intl.RelativeTimeFormat', () => Intl.RelativeTimeFormat],
    ['Intl.PluralRules', () => Intl.PluralRules],
    ['Navigator.prototype.language(get)', () => Object.getOwnPropertyDescriptor(Navigator.prototype, 'language')?.get],
    ['Navigator.prototype.languages(get)', () => Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages')?.get],
    ['Permissions.prototype.query', () => Permissions.prototype.query],
    ['Geolocation.prototype.getCurrentPosition', () => Geolocation.prototype.getCurrentPosition],
    ['Geolocation.prototype.watchPosition', () => Geolocation.prototype.watchPosition],
    ['HTMLCanvasElement.prototype.getContext', () => HTMLCanvasElement.prototype.getContext],
    ['CanvasRenderingContext2D.prototype.measureText', () => CanvasRenderingContext2D.prototype.measureText],
    ['HTMLCanvasElement.prototype.toDataURL', () => HTMLCanvasElement.prototype.toDataURL],
    ['FontFaceSet.prototype.check', () => (document.fonts ? Object.getPrototypeOf(document.fonts).check : undefined)],
    ['Worker', () => Worker],
    ['SharedWorker', () => SharedWorker],
    ['Function.prototype.toString', () => Function.prototype.toString],
    ['navigator.sendBeacon', () => navigator.sendBeacon],
    ['RTCPeerConnection', () => globalThis.RTCPeerConnection],
    ['Notification.requestPermission', () => Notification.requestPermission]
  ];

  const IDENTITY_CHECKS = [
    ['Date.prototype.constructor === Date', () => Date.prototype.constructor === Date],
    ['Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat', () => Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat],
    ['Intl.NumberFormat.prototype.constructor === Intl.NumberFormat', () => Intl.NumberFormat.prototype.constructor === Intl.NumberFormat],
    ['new Date().constructor === Date', () => new Date().constructor === Date],
    ['navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition', () => navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition],
    ['navigator.permissions.query === Permissions.prototype.query', () => navigator.permissions.query === Permissions.prototype.query],
    ['document.fonts.check === FontFaceSet.prototype.check', () => (document.fonts ? document.fonts.check === Object.getPrototypeOf(document.fonts).check : true)],
    ['Worker.prototype.constructor === Worker', () => Worker.prototype.constructor === Worker],
    ['no own "language" property on navigator', () => Object.getOwnPropertyDescriptor(navigator, 'language') === undefined],
    ['no own "languages" property on navigator', () => Object.getOwnPropertyDescriptor(navigator, 'languages') === undefined],
    ['no own "geolocation" property on navigator', () => Object.getOwnPropertyDescriptor(navigator, 'geolocation') === undefined],
    ['Intl.DateTimeFormat.prototype.resolvedOptions === new Intl.DateTimeFormat().resolvedOptions', () => new Intl.DateTimeFormat().resolvedOptions === Intl.DateTimeFormat.prototype.resolvedOptions]
  ];

  function collectNatives() {
    const spoofed = [];
    const missing = [];
    for (const [name, get] of FN_PATHS) {
      let value;
      try {
        value = get();
      } catch {
        missing.push(name);
        continue;
      }
      if (typeof value !== 'function') {
        missing.push(name);
        continue;
      }
      if (!isNative(value)) {
        spoofed.push({ name, head: nativeSource(value).slice(0, 80).replace(/\s+/g, ' ') });
      }
    }
    return { spoofed, missing };
  }

  function collectIdentity() {
    const failures = [];
    for (const [name, check] of IDENTITY_CHECKS) {
      let ok = false;
      try {
        ok = Boolean(check());
      } catch {
        ok = false;
      }
      if (!ok) failures.push(name);
    }
    return failures;
  }

  function collectGlobals() {
    const suspicious = [];
    const seen = new Set();
    const push = (key, how) => {
      if (seen.has(`${how}:${key}`)) return;
      seen.add(`${how}:${key}`);
      suspicious.push({ key, how });
    };
    for (const key of Object.keys(window)) {
      if (/vanish|spoof|__vg|anti-?detect|fake/i.test(key)) push(key, 'enumerable');
    }
    for (const key of Object.getOwnPropertyNames(window)) {
      if (/vanish|spoof|__vg/i.test(key)) push(key, 'own');
    }
    return suspicious;
  }

  function collectTimezone() {
    const now = new Date();
    const claimed = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = {};
    try {
      for (const part of new Intl.DateTimeFormat('en-US', {
        timeZone: claimed,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).formatToParts(now)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
    } catch {
      /* ignore */
    }
    const hourFromIntl = parts.hour === undefined ? null : Number(parts.hour) % 24;
    const hourFromDate = now.getHours();
    const offsetFromDate = -now.getTimezoneOffset();
    const offsetFromIntl = parts.year === undefined
      ? null
      : Math.round((Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        hourFromIntl,
        Number(parts.minute),
        Number(parts.second)
      ) - now.getTime()) / 60000);
    return {
      claimed,
      offsetFromDate,
      offsetFromIntl,
      hourFromIntl,
      hourFromDate,
      toStringHead: String(now.toString()).slice(0, 40),
      offsetsAgree: offsetFromDate === offsetFromIntl,
      wallClockAgrees: hourFromIntl === hourFromDate
    };
  }

  function collectLocale() {
    let intlLocale = null;
    try {
      intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      /* ignore */
    }
    let explicitOverrideIgnored = null;
    try {
      explicitOverrideIgnored = new Intl.DateTimeFormat('de-DE').resolvedOptions().locale !== 'de-DE';
    } catch {
      /* ignore */
    }
    return {
      intlLocale,
      navLanguage: navigator.language,
      navLanguages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : null,
      explicitLocaleHonored: explicitOverrideIgnored === null ? null : !explicitOverrideIgnored
    };
  }

  async function collectPermissions() {
    const out = { tag: null, protoOk: null, microtask: null, hasOnchange: null };
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      out.tag = Object.prototype.toString.call(status);
      out.protoOk = typeof PermissionStatus === 'function' && Object.getPrototypeOf(status) === PermissionStatus.prototype;
      out.state = status.state;
      out.microtask = Object.getOwnPropertyDescriptor(status, 'onchange') !== undefined
        && (Object.getOwnPropertyDescriptor(status, 'onchange').value === null
          || typeof Object.getOwnPropertyDescriptor(status, 'onchange').get === 'function');
    } catch (error) {
      out.error = String(error && error.message);
    }
    try {
      const status = await navigator.permissions.query({ name: 'notifications' });
      out.controlTag = Object.prototype.toString.call(status);
    } catch {
      /* ignore */
    }
    return out;
  }

  async function collectGeolocation() {
    const out = { sameFn: null, callbackBeforeTimeout: null, error: null, coords: null, positionTag: null, coordsTag: null };
    try {
      out.sameFn = navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition;
    } catch {
      /* ignore */
    }
    out.callbackBeforeTimeout = await new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 0);
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            try {
              out.coords = `${position.coords.latitude.toFixed(4)},${position.coords.longitude.toFixed(4)}`;
              out.positionTag = Object.prototype.toString.call(position);
              out.coordsTag = Object.prototype.toString.call(position.coords);
            } catch { /* ignore */ }
            finish(true);
          },
          () => finish(true),
          { timeout: 600, maximumAge: 0 }
        );
      } catch {
        finish(null);
      }
      setTimeout(() => finish(null), 1500);
    });
    return out;
  }

  function collectFonts() {
    const out = { checkSame: true, pingfangByCheck: null, pingfangByMetrics: null };
    if (!document.fonts) return out;
    try {
      out.checkSame = document.fonts.check === Object.getPrototypeOf(document.fonts).check;
      out.pingfangByCheck = document.fonts.check('16px "PingFang SC"');
      out.hanSansByCheck = document.fonts.check('16px "Noto Sans CJK SC"');
    } catch {
      /* ignore */
    }
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const probeText = '中文测试ABCabc012';
      ctx.font = '72px monospace';
      const base = ctx.measureText(probeText).width;
      ctx.font = '72px "PingFang SC", monospace';
      const withFont = ctx.measureText(probeText).width;
      out.pingfangByMetrics = Math.abs(withFont - base) > 0.5;
      out.measureTextSame = ctx.measureText === CanvasRenderingContext2D.prototype.measureText;
    } catch {
      /* ignore */
    }
    return out;
  }

  async function collectBridge() {
    const before = navigator.language;
    let accepted = false;
    try {
      window.postMessage({
        source: 'vanishgeo-extension',
        type: 'apply-spoof',
        payload: {
          extensionEnabled: true,
          languageConfig: { enabled: true, language: 'zz-ZZ', languages: ['zz-ZZ'] }
        }
      }, '*');
    } catch (error) {
      return { sent: false, error: String(error && error.message) };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    accepted = navigator.language !== before;
    return { sent: true, before, after: navigator.language, magicStringAccepted: accepted };
  }

  async function collectHeaders() {
    const out = {};
    try {
      await fetch(`/api/echo?t=${Date.now()}`, { cache: 'no-store' });
      const log = await (await fetch(`/api/log?t=${Date.now()}`, { cache: 'no-store' })).json();
      const requests = Array.isArray(log.requests) ? log.requests : [];
      const doc = requests.find((entry) => entry.kind === 'document');
      const echo = requests.filter((entry) => entry.kind === 'echo').pop();
      out.documentAcceptLanguage = doc ? doc.acceptLanguage : null;
      out.xhrAcceptLanguage = echo ? echo.acceptLanguage : null;
      out.documentSecChUa = doc ? doc.secChUa : null;
    } catch (error) {
      out.error = String(error && error.message);
    }
    return out;
  }

  async function collectSensors() {
    return {
      webdriver: navigator.webdriver,
      ua: navigator.userAgent,
      platform: navigator.platform,
      uaPlatform: navigator.userAgentData ? navigator.userAgentData.platform : null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
      plugins: navigator.plugins ? navigator.plugins.length : null,
      webglVendor: (() => {
        try {
          const gl = document.createElement('canvas').getContext('webgl');
          const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
          return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
        } catch {
          return null;
        }
      })()
    };
  }

  async function collectServiceWorker() {
    const out = {
      supported: 'serviceWorker' in navigator,
      tz: null, locale: null, lang: null, offset: null, dateStr: null, numberFormat: null,
      error: null
    };
    if (!out.supported) return out;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting || registration.installing;
      if (!worker) throw new Error('no service worker instance');
      if (worker.state !== 'activated') {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') { clearTimeout(timer); resolve(true); }
          });
        });
      }
      const channel = new MessageChannel();
      const reply = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);
        channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
        worker.postMessage({ type: 'vg-probe' }, [channel.port2]);
      });
      if (reply) Object.assign(out, reply);
    } catch (error) {
      out.error = String(error && error.message);
    }
    return out;
  }

  async function collectWorker() {
    const out = { nativeCtor: null, tz: null, lang: null, error: null };
    try {
      out.nativeCtor = /\[native code\]/.test(Function.prototype.toString.call(Worker));
    } catch { /* ignore */ }
    try {
      const source = 'self.onmessage = () => self.postMessage({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language });';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      out.tz = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 2000);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          out.lang = event.data.lang;
          resolve(event.data.tz);
        };
        worker.postMessage('go');
      });
      worker.terminate();
      URL.revokeObjectURL(url);
    } catch (error) {
      out.error = String(error && error.message);
    }
    return out;
  }

  function collectIntlConsistency() {
    const out = {};
    const attempt = (key, fn) => {
      try { out[key] = fn(); } catch (error) { out[key] = `ERR:${error && error.message}`; }
    };
    attempt('defaultLocale', () => Intl.DateTimeFormat().resolvedOptions().locale);
    attempt('explicitLocaleHonored', () => Intl.DateTimeFormat('de-DE').resolvedOptions().locale);
    attempt('explicitZoneHonored', () => Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo' }).resolvedOptions().timeZone);
    attempt('numberDefault', () => new Intl.NumberFormat().format(1234.5));
    attempt('numberExplicitDe', () => new Intl.NumberFormat('de-DE').format(1234.5));
    attempt('dateUtcZero', () => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(new Date(0)));
    attempt('dateAtTokyo', () => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date(0)));
    attempt('numberToLocaleString', () => (1234.5).toLocaleString());
    attempt('dateLocaleDateString', () => new Date(0).toLocaleDateString());
    attempt('dateIntlFormat', () => new Intl.DateTimeFormat().format(new Date(0)));
    attempt('dateToString', () => new Date(0).toString());
    attempt('dateCtorWallClock', () => new Date(2024, 0, 1, 12, 0, 0).getTime());
    attempt('relativeFormat', () => new Intl.RelativeTimeFormat().format(-1, 'day'));
    return out;
  }

  async function runProbe(label) {
    const report = {
      label: label || 'probe',
      href: location.href,
      sensors: await collectSensors(),
      timezone: collectTimezone(),
      locale: collectLocale(),
      natives: collectNatives(),
      identityFailures: collectIdentity(),
      globals: collectGlobals(),
      permissions: await collectPermissions(),
      geolocation: await collectGeolocation(),
      fonts: collectFonts(),
      intl: collectIntlConsistency(),
      worker: await collectWorker(),
      serviceWorker: await collectServiceWorker(),
      bridge: await collectBridge(),
      headers: await collectHeaders()
    };
    report.early = window.__early || null;
    report.verdict = {
      nativeSpoofed: report.natives.spoofed.length,
      identityBroken: report.identityFailures.length,
      globalsLeaked: report.globals.length,
      tzConsistent: report.timezone.offsetsAgree && report.timezone.wallClockAgrees,
      headerMatchesJs: report.headers.documentAcceptLanguage
        ? report.headers.documentAcceptLanguage.toLowerCase().startsWith(String(report.locale.navLanguage).toLowerCase())
        : null,
      bridgeExploitable: report.bridge.magicStringAccepted === true,
      // toLocaleDateString 和 Intl.DateTimeFormat 必须给同一个日期格式，否则页面
      // 拿两者一比就知道 locale 被单独改过
      localeConsistent: report.intl.dateLocaleDateString === report.intl.dateIntlFormat,
      fontInternallyConsistent: report.fonts.pingfangByCheck === report.fonts.pingfangByMetrics
        || report.fonts.pingfangByCheck === null
    };
    return report;
  }

  window.__runProbe = runProbe;
})();