import type { DiagnosticActual, DiagnosticCoordinate, DiagnosticRealm, Observation, PassThroughValues, InjectionTimingActual } from '../shared/diagnostic-report';

// 所有注入函数自包含；无预期配置参数、页面消息桥或页面持久化。
export function readDiagnosticDocument() {
  let diagnosticFrameToken: string | null = null;
  let frameSource: string | null = null;
  try {
    diagnosticFrameToken = window.frameElement?.getAttribute('id') || null;
    // 仅作描述性标签；document.write 后 about:blank 的 URL 可继承创建页 URL。
    if (window.frameElement?.hasAttribute('srcdoc')) frameSource = 'srcdoc';
    else if (window.frameElement?.getAttribute('src') === 'about:blank') frameSource = 'about:blank';
  }
  catch { /* 跨源父文档不可读；此字段只用于本次临时 DOM 清理识别。 */ }
  return { url: location.href, origin: globalThis.origin, diagnosticFrameToken, frameSource };
}

// 只读取 fixture 已有的实际数据；不向生产页面写入 marker 或采样代码。
export function collectInjectionTiming(): Observation<InjectionTimingActual> {
  const missing = (error: string) => ({ value: null, error });
  try {
    const text = document.getElementById('injection-observations')?.textContent;
    if (!text) return missing('timing_fixture_missing_or_not_loaded');
    if (text.length > 16384) return missing('timing_snapshot_invalid');
    const data = JSON.parse(text);
    if (data?.version !== 1) return missing('timing_snapshot_invalid');
    const read = (value: any) => {
      if (!value || !['language', 'locale', 'timezone', 'readyState'].every((key) => typeof value[key] === 'string' && value[key].length <= 128)
        || !Array.isArray(value.languages) || value.languages.length > 32 || !value.languages.every((v: unknown) => typeof v === 'string' && v.length <= 128)
        || !Number.isFinite(value.offsetMinutes) || !Number.isInteger(value.scriptIndex) || value.scriptIndex < 1
        || typeof value.inline !== 'boolean' || !Number.isFinite(value.capturedAtMs) || value.capturedAtMs < 0) throw new Error();
      return { language: value.language, languages: value.languages.slice(), locale: value.locale, timezone: value.timezone,
        offsetMinutes: value.offsetMinutes, readyState: value.readyState, scriptIndex: value.scriptIndex, inline: value.inline, capturedAtMs: value.capturedAtMs };
    };
    const earliest = read(data.earliest);
    const load = read(data.load);
    const options = Intl.DateTimeFormat().resolvedOptions();
    const postLoad = { language: navigator.language, languages: Array.from(navigator.languages), locale: options.locale, timezone: options.timeZone,
      offsetMinutes: new Date(1768478400000).getTimezoneOffset(), readyState: document.readyState, scriptIndex: document.scripts.length,
      inline: false, capturedAtMs: performance.now() };
    return { value: { version: 1, earliest, load, postLoad }, error: null };
  } catch { return missing('timing_snapshot_invalid'); }
}

export function collectDiagnosticRealm(): Observation<DiagnosticRealm> {
  try {
    const options = Intl.DateTimeFormat().resolvedOptions();
    const date = new Date(1768478400000);
    return { value: {
      language: navigator.language,
      languages: Array.from(navigator.languages),
      locale: options.locale,
      timezone: options.timeZone,
      offsetMinutes: date.getTimezoneOffset(),
      intl: {
        numberLocale: Intl.NumberFormat().resolvedOptions().locale,
        explicitLocale: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().locale,
        explicitTimezone: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone,
        explicitNumberLocale: Intl.NumberFormat('en-US').resolvedOptions().locale,
        explicitDateLocale: new Date(1768478400000).toLocaleString('en-US', { timeZone: 'UTC' }),
        explicitDateHour: Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date(1768478400000))
      },
      localeString: date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    }, error: null };
  } catch {
    return { value: null, error: 'realm_api_failed' };
  }
}

export function collectDiagnosticPassThrough(): Observation<PassThroughValues> {
  const values: PassThroughValues = {};
  const read = (key: string, fn: () => string | number | boolean) => {
    try { values[key] = fn(); } catch { values[key] = null; }
  };
  read('platform', () => navigator.platform);
  read('userAgent', () => navigator.userAgent);
  read('hardwareConcurrency', () => navigator.hardwareConcurrency);
  read('deviceMemory', () => (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? NaN);
  read('screen', () => `${screen.width}x${screen.height}/${screen.colorDepth}`);
  read('devicePixelRatio', () => devicePixelRatio);
  read('webgpuExists', () => Boolean((navigator as Navigator & { gpu?: unknown }).gpu));
  read('codec', () => {
    const video = document.createElement('video');
    return `${video.canPlayType('video/mp4; codecs="avc1.42E01E"')}/${video.canPlayType('video/webm; codecs="vp8"')}`;
  });
  read('webglRenderer', () => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) throw new Error();
    try {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debug) throw new Error();
      return String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  });
  read('audioSampleRate', () => {
    const audio = new AudioContext();
    const rate = audio.sampleRate;
    void audio.close().catch(() => undefined);
    return rate;
  });
  if (typeof values.deviceMemory === 'number' && !Number.isFinite(values.deviceMemory)) values.deviceMemory = null;
  return { value: values, error: null };
}

// 建立普通同源子文档；token 只用于清理 DOM，不含 run ID 或配置。
export async function createDiagnosticFrame(): Promise<string> {
  const frame = document.createElement('iframe');
  const token = `vanishgeo-diagnostic-${crypto.randomUUID()}`;
  frame.id = token;
  frame.hidden = true;
  frame.src = new URL('/leak-test/leak-test.html?ui=zh', location.origin).href;
  frame.referrerPolicy = 'no-referrer';
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    document.body.appendChild(frame);
  });
  // 动态 ISOLATED 初始化可在 load 后完成；这是采样窗口，不宣称保证时序。
  await new Promise((resolve) => setTimeout(resolve, 250));
  return token;
}

export function removeDiagnosticFrame(token: string): void {
  document.getElementById(token)?.remove();
}

export async function collectDiagnosticActual(): Promise<DiagnosticActual> {
  const missing = <T>(error: string): Observation<T> => ({ value: null, error });
  const ok = <T>(value: T): Observation<T> => ({ value, error: null });
  let realm: Observation<DiagnosticRealm>;
  try {
    const options = Intl.DateTimeFormat().resolvedOptions();
    const date = new Date(1768478400000);
    realm = ok({ language: navigator.language, languages: Array.from(navigator.languages), locale: options.locale, timezone: options.timeZone, offsetMinutes: date.getTimezoneOffset(), intl: {
        numberLocale: Intl.NumberFormat().resolvedOptions().locale,
        explicitLocale: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().locale,
        explicitTimezone: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone,
        explicitNumberLocale: Intl.NumberFormat('en-US').resolvedOptions().locale,
        explicitDateLocale: new Date(1768478400000).toLocaleString('en-US', { timeZone: 'UTC' }),
        explicitDateHour: Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date(1768478400000))
      }, localeString: date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) });
  } catch { realm = missing('realm_api_failed'); }

  async function header(): Promise<Observation<string>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/headers.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok || new URL(response.url).origin !== location.origin) return missing('header_echo_unavailable');
      const data = await response.json();
      return typeof data?.acceptLanguage === 'string' && data.acceptLanguage.length <= 1024
        ? ok(data.acceptLanguage) : missing('header_echo_invalid');
    } catch { return missing('header_echo_failed'); }
    finally { clearTimeout(timer); }
  }
  function position(watch: boolean): Promise<Observation<DiagnosticCoordinate>> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(missing('geolocation_unsupported'));
      let id: number | undefined;
      let settled = false;
      const finish = (value: Observation<DiagnosticCoordinate>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (id !== undefined) navigator.geolocation.clearWatch(id);
        resolve(value);
      };
      const timer = setTimeout(() => finish(missing('geolocation_timeout')), 5000);
      const success = (value: GeolocationPosition) => {
        const c = value.coords;
        if (![c.latitude, c.longitude, c.accuracy].every(Number.isFinite) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || c.accuracy < 0) finish(missing('geolocation_invalid'));
        else finish(ok({ latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy }));
      };
      const failure = (error: GeolocationPositionError) => finish(missing(error.code === 1 ? 'geolocation_denied' : 'geolocation_failed'));
      try {
        if (watch) {
          id = navigator.geolocation.watchPosition(success, failure, { timeout: 5000, maximumAge: 0 });
          if (settled) navigator.geolocation.clearWatch(id);
        } else navigator.geolocation.getCurrentPosition(success, failure, { timeout: 5000, maximumAge: 0 });
      } catch { finish(missing('geolocation_failed')); }
    });
  }
  async function permission(): Promise<Observation<string>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        navigator.permissions.query({ name: 'geolocation' }).then((result) => ok(result.state)),
        new Promise<Observation<string>>((resolve) => { timer = setTimeout(() => resolve(missing('permission_timeout')), 5000); })
      ]);
    } catch { return missing('permission_unavailable'); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  function ice(): Promise<DiagnosticActual['ice']> {
    return new Promise((resolve) => {
      let pc: RTCPeerConnection;
      try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); }
      catch { return resolve(missing('ice_unsupported')); }
      const value = { total: 0, ip: 0, mdns: 0, other: 0, complete: false };
      let settled = false;
      const seen = new Set<string>();
      const finish = (error: string | null, complete = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pc.onicecandidate = null;
        pc.onicegatheringstatechange = null;
        pc.close();
        // 候选字符串仅在采样窗口去重，结束后释放；报告不返回地址。
        seen.clear();
        value.complete = complete;
        resolve(error ? missing(error) : ok(value));
      };
      const timer = setTimeout(() => finish(null), 5000);
      pc.onicecandidate = (event) => {
        if (!event.candidate) return finish(null, true);
        const candidate = event.candidate.candidate;
        if (seen.has(candidate)) return;
        seen.add(candidate);
        value.total++;
        const address = candidate.trim().split(/\s+/)[4] || '';
        if (/\.local$/i.test(address)) value.mdns++;
        else if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) || address.includes(':')) value.ip++;
        else value.other++;
      };
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') finish(null, true); };
      try {
        pc.createDataChannel('vanishgeo-diagnostic');
        void pc.createOffer().then((offer) => { if (!settled) return pc.setLocalDescription(offer); }).catch(() => finish('ice_failed'));
      } catch { finish('ice_failed'); }
    });
  }
  function worker(kind: 'classic' | 'module' | 'shared'): Promise<Observation<DiagnosticRealm>> {
    return new Promise((resolve) => {
      let stop = () => {};
      let settled = false;
      const finish = (value: Observation<DiagnosticRealm>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop();
        resolve(value);
      };
      const timer = setTimeout(() => finish(missing('worker_timeout_or_fixture_missing')), 5000);
      const message = (event: MessageEvent) => {
        const data = event.data;
        if (!data || typeof data.language !== 'string' || !Array.isArray(data.languages) || !data.languages.every((v: unknown) => typeof v === 'string') || typeof data.dateTimeFormatLocale !== 'string' || typeof data.timezone !== 'string' || !Number.isFinite(data.offsetMinutes)) return finish(missing('worker_invalid'));
        const intlKeys = ['numberLocale', 'explicitLocale', 'explicitTimezone', 'explicitNumberLocale', 'explicitDateLocale', 'explicitDateHour'] as const;
        const intl = data.intl && intlKeys.every(key => typeof data.intl[key] === 'string' && data.intl[key].length <= 256)
          ? Object.fromEntries(intlKeys.map(key => [key, data.intl[key]])) as NonNullable<DiagnosticRealm['intl']> : undefined;
        finish(ok({ language: data.language, languages: data.languages, locale: data.dateTimeFormatLocale, timezone: data.timezone, offsetMinutes: data.offsetMinutes, intl }));
      };
      try {
        if (kind === 'shared') {
          const instance = new SharedWorker(`/fixtures/workers/shared-worker.js?diagnostic=${crypto.randomUUID()}`);
          stop = () => instance.port.close();
          instance.onerror = () => finish(missing('worker_failed_or_fixture_missing'));
          instance.port.onmessageerror = () => finish(missing('worker_invalid'));
          instance.port.onmessage = message;
          instance.port.start();
        } else {
          const instance = new Worker(`/fixtures/workers/worker-${kind}.js`, { type: kind === 'module' ? 'module' : 'classic' });
          stop = () => instance.terminate();
          instance.onmessage = message;
          instance.onmessageerror = () => finish(missing('worker_invalid'));
          instance.onerror = () => finish(missing('worker_failed_or_fixture_missing'));
        }
      } catch { finish(missing('worker_unsupported_or_blocked')); }
    });
  }
  const [headerValue, current, watch, permissionValue, iceValue, classic, module, shared] = await Promise.all([header(), position(false), position(true), permission(), ice(), worker('classic'), worker('module'), worker('shared')]);
  return { realm, header: headerValue, position: current, watch, permission: permissionValue, ice: iceValue, workers: { classic, module, shared } };
}
