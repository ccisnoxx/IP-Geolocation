#!/usr/bin/env node
/*
 * P1：出口 IP 变化后，环境要跟着变。
 *
 *   node tools/smoke-ip-change.mjs
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-ip-change.mjs
 *
 * 做法：把 ipwho.is 映射到本地 HTTPS 服务（扩展的定位接口），先返回洛杉矶，
 * 页面加载后把假的出口切成伦敦，触发一次 manualUpdate，再重新加载页面核对：
 *   - 时区跟着出口变（Europe/London）
 *   - 语言不跟着出口变（配置里的 en-US，说明语言/定位是解耦的）
 *   - 请求头与页面语言仍然一致
 * 用 auto 构建（dist，非烘焙）——烘焙 persona 是固定画像，本来就不跟随。
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, evaluate, launchChrome, sleep, killChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { ensureCerts } from './lib/certs.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const extensionPath = String(argv.extension || join(process.cwd(), 'dist'));
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
const domain = String(argv.domain || 'claude.ai');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

// 假出口：一次换城市就是换这个对象
const EXITS = {
  losAngeles: { latitude: 37.7749, longitude: -122.4194, country: 'United States', region: 'California', city: 'Los Angeles', timezone: 'America/Los_Angeles', offset: -25200 },
  london: { latitude: 51.5072, longitude: -0.1276, country: 'United Kingdom', region: 'England', city: 'London', timezone: 'Europe/London', offset: 3600 }
};
let currentExit = EXITS.losAngeles;

const certs = ensureCerts([domain, 'ipwho.is', 'ipapi.co', 'ipinfo.io']);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  const host = String(req.headers.host || '');
  if (host.includes('ipwho.is')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ip: '198.51.100.7',
      success: true,
      type: 'IPv4',
      country: currentExit.country,
      region: currentExit.region,
      city: currentExit.city,
      latitude: currentExit.latitude,
      longitude: currentExit.longitude,
      timezone: { id: currentExit.timezone, utc: 'x', offset: currentExit.offset }
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="en"><body><h1>ip-change</h1></body></html>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-ipchange-')),
  headless: true,
  args: [
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP ${domain} 127.0.0.1:${port}, MAP ipwho.is 127.0.0.1:${port}, MAP ipapi.co 127.0.0.1:${port}, MAP ipinfo.io 127.0.0.1:${port}`
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
await loadExtension(cdp, extensionPath);
for (let index = 0; index < 40; index += 1) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  if (targetInfos.some((item) => item.url.includes('/background/service-worker.js'))) break;
  await sleep(250);
}

const { targetInfos: swTargets } = await cdp.send('Target.getTargets');
const swTarget = swTargets.find((item) => item.url.includes('/background/service-worker.js'));
const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
const sw = (expression) => evaluate(cdp, swSession, expression, { awaitPromise: true });

// 首次定位必须由扩展自己拿到（auto 模式）
for (let index = 0; index < 40; index += 1) {
  const tz = await sw(`chrome.storage.local.get('lastLocation').then((data) => (data.lastLocation && data.lastLocation.timezone) || null)`);
  if (tz) break;
  await sleep(250);
}
const initial = await sw(`chrome.storage.local.get('lastLocation').then((data) => JSON.stringify(data.lastLocation || null))`);
check('扩展首次定位来自出口 IP', /America\/Los_Angeles/.test(String(initial)), String(initial).slice(0, 120));

const page = await cdp.send('Target.createTarget', { url: 'about:blank' });
await cdp.send('Target.activateTarget', { targetId: page.targetId });
const pageSession = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
await cdp.send('Page.enable', {}, pageSession);
await cdp.send('Network.enable', {}, pageSession);

const headerLog = [];
cdp.on((message) => {
  if (message.method !== 'Network.requestWillBeSentExtraInfo') return;
  const headers = message.params.headers || {};
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (lower['accept-language']) headerLog.push(lower['accept-language']);
});

const siteUrl = `https://${domain}/`;
async function loadPage() {
  headerLog.length = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await cdp.send('Page.navigate', { url: siteUrl }, pageSession).catch(() => {});
    for (let tick = 0; tick < 10; tick += 1) {
      await sleep(400);
      const ready = await evaluate(cdp, pageSession, `document.readyState === 'complete' && !!document.querySelector('h1')`).catch(() => false);
      if (ready) return;
    }
  }
}

const snapshot = () => evaluate(cdp, pageSession, `(() => ({
  tz: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  offset: new Date().getTimezoneOffset(),
  nav: navigator.language,
  intl: new Intl.DateTimeFormat().resolvedOptions().locale,
  date: new Date(0).toLocaleDateString(),
  intlDate: new Intl.DateTimeFormat().format(new Date(0))
}))()`);

const expectedOffset = (timeZone) => {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date()).find((item) => item.type === 'timeZoneName');
  const match = String(part && part.value).match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '+' ? -minutes : minutes;
};

await loadPage();
const before = await snapshot();
check('阶段一：页面时区 = 出口 A', before.tz === 'America/Los_Angeles', `${before.tz} offset=${before.offset}`);
check('阶段一：请求头与页面语言一致', headerLog.some((value) => String(value).toLowerCase().startsWith(before.nav.toLowerCase())), `${headerLog[0] || '(未抓到)'} vs nav=${before.nav}`);

// 换出口：把假的定位接口切成伦敦
currentExit = EXITS.london;
// service worker 里给自己发消息拿不到响应，必须从扩展页发
const extensionId = await sw('chrome.runtime.id');
const probeTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/popup.html` });
const probeSession = (await cdp.send('Target.attachToTarget', { targetId: probeTarget.targetId, flatten: true })).sessionId;
await cdp.send('Runtime.enable', {}, probeSession);
await sleep(700);
const update = await evaluate(cdp, probeSession, `chrome.runtime.sendMessage({ action: 'manualUpdate' })`, { awaitPromise: true });
const updatedTz = update && update.geo && update.geo.location && update.geo.location.timezone;
check('切换出口后重新定位成功', updatedTz === 'Europe/London', JSON.stringify(updatedTz));

// 不重新加载时，已打开的页面也应该跟着变（updateAllTabs 会把新 payload 重注入）
await sleep(1500);
const liveAfterUpdate = await snapshot();
check('已打开的页面无需重载就跟随', liveAfterUpdate.tz === 'Europe/London', liveAfterUpdate.tz);

await loadPage();
const after = await snapshot();
check('阶段二：页面时区跟着出口变了', after.tz === 'Europe/London', `${after.tz} offset=${after.offset}`);
check('阶段二：UTC 偏移跟随时区', after.offset === expectedOffset('Europe/London'), `${after.offset} vs ${expectedOffset('Europe/London')}`);
check('阶段二：语言不跟着出口变（配置决定）', after.nav === 'en-US' && after.intl === 'en-US', `${after.nav} / ${after.intl}`);
check('阶段二：请求头仍然与页面语言一致', headerLog.some((value) => String(value).toLowerCase().startsWith(after.nav.toLowerCase())), `${headerLog[0] || '(未抓到)'} vs nav=${after.nav}`);
check('阶段二：toLocaleDateString 与 Intl 同源', after.date === after.intlDate, `${after.date} vs ${after.intlDate}`);

const stored = await sw(`chrome.storage.local.get('lastLocation').then((data) => (data.lastLocation && data.lastLocation.timezone) || null)`);
check('storage 里的 lastLocation 已更新', stored === 'Europe/London', String(stored));

cdp.close();
killChrome(chrome.child);
server.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
setTimeout(() => process.exit(failed.length ? 1 : 0), 300);