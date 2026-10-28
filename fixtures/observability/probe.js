// 仅测试夹具使用；只采实际值，不接收扩展配置或连接扩展。
export function captureSurface() {
  const attempt = operation => { try { return { value: operation() }; } catch (error) { return { error: error.name }; } };
  const describe = (object, property) => {
    if (!object) return { status: 'UNSUPPORTED' };
    let owner = object, depth = 0;
    while (owner && !Object.hasOwn(owner, property)) { owner = Object.getPrototypeOf(owner); depth++; }
    if (!owner) return { status: 'UNSUPPORTED' };
    const d = Object.getOwnPropertyDescriptor(owner, property);
    const shape = fn => typeof fn === 'function' ? { name: fn.name, length: fn.length,
      source: Function.prototype.toString.call(fn), keys: Reflect.ownKeys(fn).map(String) } : null;
    return { depth, configurable: d.configurable, enumerable: d.enumerable, writable: d.writable,
      get: shape(d.get), set: shape(d.set), value: shape(d.value), type: typeof d.value };
  };
  const descriptors = {};
  const targets = [[navigator, ['language', 'languages', 'geolocation', 'permissions']],
    [Intl, ['DateTimeFormat', 'NumberFormat', 'Collator', 'RelativeTimeFormat']],
    [globalThis, ['Date', 'Worker', 'SharedWorker']],
    [Date.prototype, ['getTimezoneOffset', 'getHours', 'toString', 'toLocaleString']],
    [navigator.geolocation, ['getCurrentPosition', 'watchPosition', 'clearWatch']],
    [navigator.permissions, ['query']],
    [globalThis.CanvasRenderingContext2D?.prototype, ['measureText']],
    [globalThis.FontFaceSet?.prototype, ['check']]];
  targets.forEach(([object, properties], index) => properties.forEach(property => { descriptors[`${index}.${property}`] = describe(object, property); }));
  const date = new Date(1768478400000);
  const language = { language: navigator.language, languages: Array.from(navigator.languages),
    locale: Intl.DateTimeFormat().resolvedOptions().locale, explicitLocale: Intl.DateTimeFormat('en-GB').resolvedOptions().locale };
  const timezone = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: date.getTimezoneOffset(),
    local: [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()], string: date.toString(),
    explicitTimezone: Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).resolvedOptions().timeZone };
  const behavior = { invalidDateReceiver: attempt(() => Date.prototype.getHours.call({})),
    invalidLocale: attempt(() => new Intl.DateTimeFormat('invalid_locale').resolvedOptions()),
    invalidTimezone: attempt(() => new Intl.DateTimeFormat(undefined, { timeZone: 'Invalid/Zone' }).resolvedOptions()),
    languageGetterReceiver: attempt(() => {
      let object = navigator;
      while (object && !Object.hasOwn(object, 'language')) object = Object.getPrototypeOf(object);
      return Object.getOwnPropertyDescriptor(object, 'language').get.call({});
    }) };
  return { language, timezone, descriptors, behavior,
    api: { geolocation: typeof navigator.geolocation, permissions: typeof navigator.permissions,
      worker: typeof Worker, sharedWorker: typeof SharedWorker, rtc: typeof RTCPeerConnection,
      offscreenCanvas: typeof OffscreenCanvas, fontFaceSet: typeof globalThis.fonts },
    globals: Reflect.ownKeys(globalThis).map(String).filter(name => /vanishgeo|__vg|chrome-extension:/i.test(name)) };
}

export async function capturePage({ position = false } = {}) {
  const result = captureSurface();
  result.permission = navigator.permissions ? await navigator.permissions.query({ name: 'geolocation' })
    .then(value => ({ state: value.state, prototype: Object.getPrototypeOf(value)?.constructor?.name,
      ownKeys: Reflect.ownKeys(value).map(String), stateOwn: Object.hasOwn(value, 'state') }), error => ({ status: 'UNKNOWN', error: error.name }))
    : { status: 'UNSUPPORTED' };
  // 定位仅由隔离 runner 显式启用；真实 Profile 的被动观测不读取传感器。
  result.position = !position ? { status: 'UNKNOWN', reason: '未请求位置' } : !navigator.geolocation ? { status: 'UNSUPPORTED' }
    : result.permission.state !== 'granted' ? { status: 'UNKNOWN', reason: `权限 ${result.permission.state || 'unknown'}` }
      : await new Promise(resolve => navigator.geolocation.getCurrentPosition(value => resolve({
        latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy,
        prototype: Object.getPrototypeOf(value)?.constructor?.name, ownKeys: Reflect.ownKeys(value).map(String),
        coordsOwnKeys: Reflect.ownKeys(value.coords).map(String),
        nativeCoordsGetter: (() => {
          const getter = Object.getOwnPropertyDescriptor(GeolocationPosition.prototype, 'coords')?.get;
          if (!getter) return 'UNKNOWN';
          try { getter.call(value); return 'NATIVE'; } catch { return 'OBSERVABLE'; }
        })() }), error => resolve({ status: 'UNKNOWN', error: error.code }), { timeout: 1000 }));
  result.header = await fetch('/headers.json', { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    .then(response => response.json()).catch(error => ({ status: 'UNKNOWN', error: error.name }));
  const families = await fetch('/font-list.json', { credentials: 'omit' }).then(response => response.json());
  const context = document.createElement('canvas').getContext('2d');
  const text = 'mmmmWWWW汉字測試012345';
  result.fonts = !context || !document.fonts ? { status: 'UNSUPPORTED' } : [...families, 'Arial', 'monospace'].map(family => {
    context.font = `32px "${family}", monospace`;
    return { family, check: document.fonts.check(`32px "${family}"`), width: context.measureText(text).width };
  });
  result.ice = typeof RTCPeerConnection !== 'function' ? { status: 'UNSUPPORTED' } : await new Promise(resolve => {
    // 无 STUN/TURN；只保留候选类别计数，不存储地址或完整 SDP。
    const counts = {}; const peer = new RTCPeerConnection({ iceServers: [] }); let ended = false;
    const finish = () => { if (ended) return; ended = true; clearTimeout(timer); peer.close(); resolve({ counts,
      status: Object.keys(counts).length ? 'OBSERVABLE' : 'UNKNOWN', scope: 'host-only; no STUN/TURN' }); };
    const timer = setTimeout(finish, 1200);
    peer.onicecandidate = event => { if (!event.candidate) return finish(); const type = event.candidate.type || 'unknown'; counts[type] = (counts[type] || 0) + 1; };
    peer.createDataChannel('audit'); peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => finish());
  });
  // 结果写入 DOM 之前采集，避免把报告里的文本当作扩展注入。
  const nodes = Array.from(document.querySelectorAll('*'));
  result.dom = { extensionUrls: nodes.flatMap(node => Array.from(node.attributes)
    .filter(attr => /(?:chrome|moz)-extension:\/\//i.test(attr.value)).map(attr => `${node.tagName}.${attr.name}`)),
    markers: nodes.flatMap(node => Array.from(node.attributes).filter(attr => /vanishgeo|__vg/i.test(attr.name + ' ' + attr.value)).map(attr => `${node.tagName}.${attr.name}`)),
    structure: nodes.filter(node => node.id !== 'result').map(node => ({ tag: node.tagName,
      attributes: Array.from(node.attributes, attr => [attr.name, attr.value]).filter(([name]) => name !== 'src' || !node.matches('iframe')) })),
    resourceExtensionUrls: performance.getEntriesByType('resource').filter(entry => /(?:chrome|moz)-extension:\/\//i.test(entry.name)).length };
  return result;
}
