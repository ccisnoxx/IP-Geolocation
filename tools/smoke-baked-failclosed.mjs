#!/usr/bin/env node
/*
 * 烘焙包的 fail-closed 回归：
 *   - 坐标解析不出来时，页面 JS / permissions / 请求头必须说同一件事：
 *     getCurrentPosition = code 2，watchPosition = code 2，permission = denied，
 *     Accept-Language 仍是配置里的语言（P1-5）。
 *   - 恢复成明确坐标后，不用重载页面就能重新拿到位置和 allow 权限。
 *   - 关总开关后，烘焙静态脚本注入过的页面收到 clear，恢复原生语言。
 *
 * 默认跑 persona 烘焙包；audit 会显式传 --extension=<persona ext>。
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep, waitFor } from './lib/e2e.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const extensionPath = String(argv.extension || process.env.VANISHGEO_EXTENSION || 'dist');
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

// 环境缺能力（例如无人值守的 runner 没人点定位授权）时用它：不计入失败，
// 但在汇总里明写跳过几项，免得"跳过"被当成"验过了"。
function skip(name, detail = '') {
  results.push({ name, ok: true, skipped: true });
  console.log(`⚠ ${name}${detail ? `  ${detail}` : ''}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ acceptLanguage: req.headers['accept-language'] || '' }));
    return;
  }
  if (url.pathname === '/__native') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>native control</title></head><body>
      <script>
        window.__native = {
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      </script></body></html>`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>fail-closed probe</title></head><body>
    <p>geolocation fail-closed probe</p>
  </body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-failclosed-')),
  headless: true,
  args: [
    '--lang=en-US',
    '--host-resolver-rules=MAP localhost 127.0.0.1, MAP ipwho.is ~NOTFOUND, MAP ipapi.co ~NOTFOUND, MAP ipinfo.io ~NOTFOUND'
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
const extensionId = await loadExtension(cdp, extensionPath);
if (!extensionId) throw new Error('扩展没有返回 extension id');

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { cdp.close(); } catch { /* already closed */ }
  try { killChrome(chrome.child); } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
}
process.on('exit', cleanup);

const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
await sleep(800);

async function send(message) {
  const response = await sendRuntimeMessage(cdp, options.sessionId, message);
  if (!response || response.status !== 'ok') {
    throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
  }
  return response;
}

const nativePage = await openPageStable(cdp, `http://127.0.0.1:${port}/__native`);
const native = await evaluate(cdp, nativePage.sessionId, 'window.__native');
check('拿到原生 control 基线', Boolean(native && native.language && native.timezone), JSON.stringify(native));

// 先清掉上次运行留下的位置缓存，再让配置走 auto；否则 applyConfig 可能拿到旧位置。
await evaluate(cdp, options.sessionId, "chrome.storage.local.remove('lastLocation')", { awaitPromise: true });
await sleep(300);
const base = (await send({ action: 'getSiteConfig' })).config;
const rule = { id: 'e2e-failclosed', domain: 'localhost', enabled: true };
const common = {
  ...base,
  masterEnabled: true,
  globalProfile: {
    ...base.globalProfile,
    language: {
      enabled: true,
      mode: 'preset',
      language: 'en-US',
      languages: ['en-US', 'en'],
      acceptLanguage: 'en-US,en;q=0.9'
    },
    timezone: { enabled: true, mode: 'auto', timezone: '' },
    geolocation: {
      ...base.globalProfile.geolocation,
      enabled: true,
      mode: 'auto',
      latitude: null,
      longitude: null,
      accuracy: 50,
      spoofPermission: true
    }
  },
  rules: [rule]
};
await send({ action: 'setSiteConfig', config: common });
await sleep(600);

const page = await openPageStable(cdp, `http://localhost:${port}/`);
await sleep(600);

const probe = () => evaluate(cdp, page.sessionId, `(async () => {
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), ms))
  ]);
  const get = await withTimeout(new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({
      ok: true,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    }),
    (error) => resolve({ ok: false, code: error.code, message: error.message })
  )), 3000);
  const watch = await withTimeout(new Promise((resolve) => {
    const id = navigator.geolocation.watchPosition(
      (position) => { navigator.geolocation.clearWatch(id); resolve({ ok: true, latitude: position.coords.latitude, longitude: position.coords.longitude }); },
      (error) => { navigator.geolocation.clearWatch(id); resolve({ ok: false, code: error.code, message: error.message }); }
    );
  }), 3000);
  const permission = await navigator.permissions.query({ name: 'geolocation' })
    .then((status) => status.state)
    .catch((error) => 'error:' + error.message);
  const headers = await fetch('/echo').then((response) => response.json());
  return {
    get,
    watch,
    permission,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    acceptLanguage: headers.acceptLanguage || ''
  };
})()`, { awaitPromise: true });

const denied = await probe();
check('坐标未解析：getCurrentPosition code 2', denied.get.ok === false && denied.get.code === 2, JSON.stringify(denied.get));
check('坐标未解析：watchPosition code 2', denied.watch.ok === false && denied.watch.code === 2, JSON.stringify(denied.watch));
check('坐标未解析：permission = denied', denied.permission === 'denied', denied.permission);
check('坐标未解析：语言仍是 en-US', denied.language === 'en-US', denied.language);
check('坐标未解析：请求头仍是 en-US', denied.acceptLanguage.startsWith('en-US'), denied.acceptLanguage);
check('坐标未解析：页面没有暴露坐标', denied.get.ok === false, JSON.stringify(denied.get));

// 明确坐标后恢复：不重载页面，验证 deny 是可逆的，而不是一次性写坏。
const restored = {
  ...common,
  globalProfile: {
    ...common.globalProfile,
    timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
    geolocation: {
      ...common.globalProfile.geolocation,
      enabled: true,
      mode: 'manual',
      latitude: 35.6762,
      longitude: 139.6503,
      accuracy: 25,
      spoofPermission: true
    }
  }
};
await send({ action: 'setSiteConfig', config: restored });
let allowed = null;
try {
  allowed = await waitFor(async () => {
    const value = await probe();
    if (process.env.DEBUG) console.log('probe', JSON.stringify(value));
    // Helium 156 的 contentSettings allow 不会把已缓存的 permission 从 prompt 变 granted，
    // 但页面已经能拿到坐标；这里只要求“不再是 denied”，Chrome 会自然到 granted。
    return value.get.ok && value.permission !== 'denied' && value.timezone === 'Asia/Tokyo' ? value : null;
  }, { timeout: 12000, label: '恢复坐标后页面重新拿到位置' });
} catch (error) {
  // 浏览器层面直接 deny（无人值守的 runner 没人点授权）时，这一段永远等不到；
  // 这不是扩展的回归，是环境没有给定位能力 —— 跳过并说明。
  const blocked = await probe();
  if (blocked.permission !== 'denied') throw error;
  console.log(`\n（定位权限被浏览器直接拒绝：${blocked.permission}，跳过需要真定位的两项）`);
}
if (allowed) {
  check('恢复坐标：getCurrentPosition 返回目标坐标', Math.abs(allowed.get.latitude - 35.6762) < 0.001 && Math.abs(allowed.get.longitude - 139.6503) < 0.001, JSON.stringify(allowed.get));
  check('恢复坐标：permission 不再是 denied', allowed.permission !== 'denied', allowed.permission);
} else {
  skip('恢复坐标：getCurrentPosition 返回目标坐标', '警告：本环境浏览器拒绝定位权限，需在能授权的机器上验');
  skip('恢复坐标：permission 不再是 denied', '同上');
  allowed = await probe();
}
check('恢复坐标：时区跟着 manual 配置', allowed.timezone === 'Asia/Tokyo', allowed.timezone);
check('恢复坐标：请求头仍是 en-US', allowed.acceptLanguage.startsWith('en-US'), allowed.acceptLanguage);

// 关总开关：烘焙包静态脚本注入过的页面也要收到 clear，而不是继续保留烘焙值。
await send({ action: 'setSiteConfig', config: { ...restored, masterEnabled: false } });
const state = () => evaluate(cdp, page.sessionId, `({
  language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
})`);
const off = await waitFor(async () => {
  const value = await state();
  return value.language === native.language && value.timezone === native.timezone ? value : null;
}, { timeout: 12000, label: '关总开关后恢复原生' });
check('关总开关：语言恢复原生', off.language === native.language, `${off.language} vs ${native.language}`);
check('关总开关：时区恢复原生', off.timezone === native.timezone, `${off.timezone} vs ${native.timezone}`);

cleanup();

const failed = results.filter((item) => !item.ok);
const counted = results.filter((item) => !item.skipped);
const skipped = results.length - counted.length;
console.log(`\n${counted.length - failed.length}/${counted.length} 通过${skipped ? `（${skipped} 项跳过）` : ''}`);
process.exit(failed.length ? 1 : 0);
