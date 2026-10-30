#!/usr/bin/env node
/*
 * 原生形状对拍：同一台 Helium、同一页面，control（不加载扩展）vs patched（加载 dist）。
 *
 *   node tools/native-parity.mjs
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/native-parity.mjs
 *
 * 只比较"形状"：描述符 flags、name / length、Function.prototype.toString 的伪装结果、
 * 恒等关系（Date.prototype.constructor === Date 等）。不比较语言/时区的值 —— 那是
 * 功能对拍，值本来就应该不同。任何形状差异都会逐项打印控制组和补丁组的值。
 */
process.env.CHROME_PATH ||= '/Applications/Helium.app/Contents/MacOS/Helium';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

const { CDP, launchChrome, openPage, evaluate, killChrome, sleep } = await import('./lib/cdp.mjs');

const EXPECTED = { language: 'ja-JP', timezone: 'Asia/Tokyo', offset: -540 };
const extensionArg = process.argv.find((arg) => arg.startsWith('--extension='));
const extensionPath = extensionArg ? resolve(extensionArg.slice('--extension='.length)) : join(process.cwd(), 'dist');

const PROBE = String.raw`
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(2200);

  const safeToString = (fn) => {
    try { return Function.prototype.toString.call(fn); }
    catch (error) { return 'ERR:' + (error && error.message); }
  };

  const isConstructor = (value) => {
    try { Reflect.construct(function () {}, [], value); return true; }
    catch { return false; }
  };

  /**
   * 函数对象**自身**的形状。
   *
   * 只比 name / length / toString 是不够的：原生内建函数只暴露 length / name 两个
   * 自有属性、并且不可构造；普通函数表达式（尤其 sloppy 代码里的）还会长出
   * prototype / arguments / caller，而且能被当成 newTarget：
   *
   *     Object.getOwnPropertyNames(Function.prototype.toString)
   *     Reflect.construct(function () {}, [], Function.prototype.toString)  // 原生抛 TypeError
   *
   * 这两行都能一行分辨补丁，所以逐项对上才算"形状一致"。
   */
  const functionShape = (fn) => {
    const own = Object.getOwnPropertyNames(fn);
    const descriptors = {};
    for (const key of own) {
      const found = Object.getOwnPropertyDescriptor(fn, key);
      if (!found) continue;
      descriptors[key] = 'value' in found
        ? { kind: 'data', writable: found.writable, enumerable: found.enumerable, configurable: found.configurable }
        : { kind: 'accessor', enumerable: found.enumerable, configurable: found.configurable };
    }
    return {
      own,
      symbols: Object.getOwnPropertySymbols(fn).map((symbol) => Symbol.keyFor(symbol) || String(symbol)),
      descriptors,
      isConstructor: isConstructor(fn)
    };
  };

  const shape = (value) => {
    if (typeof value === 'function') {
      return { kind: 'function', name: value.name, length: value.length, toString: safeToString(value), fn: functionShape(value) };
    }
    if (value === null) return { kind: 'null' };
    if (value === undefined) return { kind: 'undefined' };
    return { kind: typeof value };
  };

  const descriptor = (object, key) => {
    if (!object) return { missing: true };
    const found = Object.getOwnPropertyDescriptor(object, key);
    if (!found) return { missing: true };
    const result = { enumerable: found.enumerable, configurable: found.configurable };
    if ('value' in found) {
      result.kind = 'data';
      result.writable = found.writable;
      result.value = shape(found.value);
    } else {
      result.kind = 'accessor';
      result.get = shape(found.get);
      result.set = shape(found.set);
    }
    return result;
  };

  const records = [];
  const add = (path, object, key) => records.push({ path, descriptor: descriptor(object, key) });

  add('globalThis.Date', globalThis, 'Date');
  add('Date.now', Date, 'now');
  add('Date.parse', Date, 'parse');
  add('Date.UTC', Date, 'UTC');
  add('Date.prototype', Date, 'prototype');
  add('Date.prototype.constructor', Date.prototype, 'constructor');
  add('Date.prototype.toString', Date.prototype, 'toString');
  add('Date.prototype.toISOString', Date.prototype, 'toISOString');
  add('Date.prototype.toJSON', Date.prototype, 'toJSON');
  add('Date.prototype.getTime', Date.prototype, 'getTime');
  add('Date.prototype.getTimezoneOffset', Date.prototype, 'getTimezoneOffset');
  add('Date.prototype.getHours', Date.prototype, 'getHours');
  add('Date.prototype.getDate', Date.prototype, 'getDate');
  add('Date.prototype.setHours', Date.prototype, 'setHours');
  add('Date.prototype.toLocaleString', Date.prototype, 'toLocaleString');
  add('Date.prototype.toLocaleDateString', Date.prototype, 'toLocaleDateString');
  add('Date.prototype.toLocaleTimeString', Date.prototype, 'toLocaleTimeString');
  add('Date.prototype.toDateString', Date.prototype, 'toDateString');
  add('Date.prototype.toTimeString', Date.prototype, 'toTimeString');
  add('Date.prototype.toUTCString', Date.prototype, 'toUTCString');
  add('Date.prototype.valueOf', Date.prototype, 'valueOf');
  add('Date.prototype.getFullYear', Date.prototype, 'getFullYear');
  add('Date.prototype.getMonth', Date.prototype, 'getMonth');
  add('Date.prototype.getDay', Date.prototype, 'getDay');
  add('Date.prototype.getMinutes', Date.prototype, 'getMinutes');
  add('Date.prototype.getSeconds', Date.prototype, 'getSeconds');
  add('Date.prototype.getMilliseconds', Date.prototype, 'getMilliseconds');
  add('Date.prototype.setFullYear', Date.prototype, 'setFullYear');
  add('Date.prototype.setMonth', Date.prototype, 'setMonth');
  add('Date.prototype.setDate', Date.prototype, 'setDate');
  add('Date.prototype.setMinutes', Date.prototype, 'setMinutes');
  add('Date.prototype.setSeconds', Date.prototype, 'setSeconds');
  add('Date.prototype.setMilliseconds', Date.prototype, 'setMilliseconds');
  add('Date.prototype.setTime', Date.prototype, 'setTime');
  records.push({ path: 'Date.prototype[Symbol.toPrimitive]', descriptor: descriptor(Date.prototype, Symbol.toPrimitive) });

  add('globalThis.Intl.DateTimeFormat', Intl, 'DateTimeFormat');
  add('Intl.DateTimeFormat.prototype', Intl.DateTimeFormat, 'prototype');
  add('Intl.DateTimeFormat.prototype.constructor', Intl.DateTimeFormat.prototype, 'constructor');
  add('Intl.DateTimeFormat.prototype.resolvedOptions', Intl.DateTimeFormat.prototype, 'resolvedOptions');
  add('Intl.DateTimeFormat.prototype.formatToParts', Intl.DateTimeFormat.prototype, 'formatToParts');
  add('Intl.DateTimeFormat.prototype.format', Intl.DateTimeFormat.prototype, 'format');
  add('Intl.DateTimeFormat.prototype.formatRange', Intl.DateTimeFormat.prototype, 'formatRange');
  add('Intl.DateTimeFormat.prototype.formatRangeToParts', Intl.DateTimeFormat.prototype, 'formatRangeToParts');
  add('Intl.DateTimeFormat.supportedLocalesOf', Intl.DateTimeFormat, 'supportedLocalesOf');

  add('Function.prototype.toString', Function.prototype, 'toString');
  add('globalThis.Worker', globalThis, 'Worker');
  add('globalThis.RTCPeerConnection', globalThis, 'RTCPeerConnection');
  add('Navigator.prototype.language', Navigator.prototype, 'language');
  add('Navigator.prototype.languages', Navigator.prototype, 'languages');
  add('navigator.language', navigator, 'language');
  add('navigator.languages', navigator, 'languages');
  add('Geolocation.prototype.getCurrentPosition', Geolocation.prototype, 'getCurrentPosition');
  add('Geolocation.prototype.watchPosition', Geolocation.prototype, 'watchPosition');
  add('Geolocation.prototype.clearWatch', Geolocation.prototype, 'clearWatch');
  add('HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement.prototype, 'toDataURL');
  add('HTMLCanvasElement.prototype.toBlob', HTMLCanvasElement.prototype, 'toBlob');
  add('CanvasRenderingContext2D.prototype.measureText', CanvasRenderingContext2D.prototype, 'measureText');
  add('CanvasRenderingContext2D.prototype.fillText', CanvasRenderingContext2D.prototype, 'fillText');
  add('CanvasRenderingContext2D.prototype.font', CanvasRenderingContext2D.prototype, 'font');
  add('FontFaceSet.prototype.check', Object.getPrototypeOf(document.fonts), 'check');
  add('GeolocationCoordinates.prototype.latitude', GeolocationCoordinates && GeolocationCoordinates.prototype, 'latitude');
  add('GeolocationCoordinates.prototype.longitude', GeolocationCoordinates && GeolocationCoordinates.prototype, 'longitude');
  add('GeolocationCoordinates.prototype.accuracy', GeolocationCoordinates && GeolocationCoordinates.prototype, 'accuracy');
  add('GeolocationPosition.prototype.coords', GeolocationPosition && GeolocationPosition.prototype, 'coords');

  const identities = {
    'Date.prototype.constructor === Date': Date.prototype.constructor === Date,
    'Object.getPrototypeOf(new Date()) === Date.prototype': Object.getPrototypeOf(new Date()) === Date.prototype,
    'new Date() instanceof Date': new Date() instanceof Date,
    'Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat': Intl.DateTimeFormat.prototype.constructor === Intl.DateTimeFormat,
    'Object.getPrototypeOf(new Intl.DateTimeFormat()) === Intl.DateTimeFormat.prototype': Object.getPrototypeOf(new Intl.DateTimeFormat()) === Intl.DateTimeFormat.prototype,
    'navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition': navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition,
    'Object.getPrototypeOf(navigator.geolocation) === Geolocation.prototype': Object.getPrototypeOf(navigator.geolocation) === Geolocation.prototype,
    'Object.getPrototypeOf(navigator) === Navigator.prototype': Object.getPrototypeOf(navigator) === Navigator.prototype,
    'navigator.languages === navigator.languages': navigator.languages === navigator.languages,
    'Object.isFrozen(navigator.languages)': Object.isFrozen(navigator.languages)
  };

  const ownKeys = {
    'Date.prototype': Object.getOwnPropertyNames(Date.prototype).sort(),
    'Intl.DateTimeFormat.prototype': Object.getOwnPropertyNames(Intl.DateTimeFormat.prototype).sort(),
    'Navigator.prototype': Object.getOwnPropertyNames(Navigator.prototype).sort(),
    'Geolocation.prototype': Object.getOwnPropertyNames(Geolocation.prototype).sort(),
    'HTMLCanvasElement.prototype': Object.getOwnPropertyNames(HTMLCanvasElement.prototype).sort(),
    'CanvasRenderingContext2D.prototype': Object.getOwnPropertyNames(CanvasRenderingContext2D.prototype).sort()
  };

  const functional = {
    language: navigator.language,
    languages: Array.from(navigator.languages),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date().getTimezoneOffset(),
    dateString: new Date(0).toString(),
    intlDate: new Intl.DateTimeFormat('en-US').format(new Date(0))
  };

  window.__parity = { records, identities, ownKeys, functional, ua: navigator.userAgent };
})().catch((error) => { window.__parityError = String((error && error.stack) || error); });
`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>parity</title></head><body><h1>parity</h1><script>${PROBE.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://localhost:${server.address().port}/`;

async function openPageStable(cdp, url) {
  const page = await openPage(cdp, url);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let href = '';
    try { href = await evaluate(cdp, page.sessionId, 'location.href'); }
    catch { /* navigation in progress */ }
    if (href === url) return page;
    // 扩展刚加载时首个 navigation 偶尔会被吞掉：明确重试一次，而不是把
    // about:blank 当成页面去采样（会把 control/patched 的 URL 比错）。
    if (attempt === 10 && href === 'about:blank') {
      await cdp.send('Page.navigate', { url }, page.sessionId).catch(() => {});
    }
    await sleep(100);
  }
  return page;
}

async function runControl() {
  const { child, websocketUrl } = await launchChrome({ userDataDir: mkdtempSync(join(tmpdir(), 'vgparity-control-')), headless: true, args: ['--lang=en-US'] });
  const cdp = await CDP.connect(websocketUrl);
  try {
    const page = await openPageStable(cdp, pageUrl);
    await sleep(2800);
    return await evaluate(cdp, page.sessionId, 'window.__parity || null');
  } finally {
    cdp.close();
    killChrome(child);
  }
}

async function runPatched(extensionPath) {
  const { child, websocketUrl } = await launchChrome({ userDataDir: mkdtempSync(join(tmpdir(), 'vgparity-patched-')), headless: true, args: ['--lang=en-US'] });
  const cdp = await CDP.connect(websocketUrl);
  try {
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    await sleep(800);
    const options = await openPage(cdp, `chrome-extension://${id}/options/options.html`);
    const send = (message) => evaluate(
      cdp,
      options.sessionId,
      `new Promise((resolve, reject) => chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response)))`,
      { awaitPromise: true }
    );
    const base = (await send({ action: 'getSiteConfig' })).config;
    const config = {
      ...base,
      masterEnabled: true,
      globalProfile: {
        ...base.globalProfile,
        language: {
          enabled: true,
          mode: 'preset',
          language: EXPECTED.language,
          languages: [EXPECTED.language, 'ja'],
          acceptLanguage: 'ja-JP,ja;q=0.9'
        },
        timezone: { enabled: true, mode: 'manual', timezone: EXPECTED.timezone },
        geolocation: { ...base.globalProfile.geolocation, enabled: false, mode: 'auto', latitude: null, longitude: null }
      },
      rules: [{ id: 'parity', domain: 'localhost', enabled: true, overrides: {
        language: { mode: 'inherit', value: null },
        timezone: { mode: 'inherit', value: null },
        geolocation: { mode: 'inherit', value: null }
      } }]
    };
    const saved = await send({ action: 'setSiteConfig', config });
    if (!saved || saved.status === 'error') throw new Error('setSiteConfig failed: ' + JSON.stringify(saved));
    await sleep(300);

    const page = await openPageStable(cdp, pageUrl);
    await sleep(3200);
    const result = await evaluate(cdp, page.sessionId, 'window.__parity || null');
    if (!result) {
      console.error('patched probe error:', await evaluate(cdp, page.sessionId, 'JSON.stringify({href:location.href, ready:document.readyState, error:window.__parityError, text:document.body && document.body.innerText, html:document.documentElement && document.documentElement.outerHTML.slice(0,300)})'));
    }
    return result;
  } finally {
    cdp.close();
    killChrome(child);
  }
}

let failed = 0;
let total = 0;
try {
  const control = await runControl();
  const patched = await runPatched(extensionPath);
  if (!control || !patched) throw new Error(`probe failed: control=${Boolean(control)} patched=${Boolean(patched)}`);

  const controlByPath = new Map(control.records.map((record) => [record.path, record.descriptor]));
  for (const record of patched.records) {
    total += 1;
    const native = controlByPath.get(record.path);
    const same = JSON.stringify(native) === JSON.stringify(record.descriptor);
    if (!same) failed += 1;
    console.log(`${same ? '✓' : '✗'} ${record.path}`);
    if (!same) {
      console.log(`    native : ${JSON.stringify(native)}`);
      console.log(`    patched: ${JSON.stringify(record.descriptor)}`);
    }
  }

  for (const [name, value] of Object.entries(patched.identities)) {
    total += 1;
    const controlValue = control.identities[name];
    const ok = value === true && controlValue === true;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} 恒等 ${name}  native=${controlValue} patched=${value}`);
  }

  for (const [name, keys] of Object.entries(patched.ownKeys)) {
    total += 1;
    const nativeKeys = control.ownKeys[name];
    const ok = JSON.stringify(nativeKeys) === JSON.stringify(keys);
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ownKeys ${name}`);
    if (!ok) {
      console.log(`    native : ${JSON.stringify(nativeKeys)}`);
      console.log(`    patched: ${JSON.stringify(keys)}`);
    }
  }

  const functionalChecks = [
    ['navigator.language', patched.functional.language, EXPECTED.language],
    ['timezone', patched.functional.timeZone, EXPECTED.timezone],
    ['UTC offset', patched.functional.offset, EXPECTED.offset]
  ];
  for (const [name, value, expected] of functionalChecks) {
    total += 1;
    const ok = value === expected;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} 功能 ${name}  ${value} (期望 ${expected})`);
  }

  console.log(`\nUA: ${patched.ua}`);
  console.log(`${total - failed}/${total} 通过`);
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;
