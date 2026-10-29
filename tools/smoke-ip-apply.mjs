#!/usr/bin/env node
/*
 * 「从 IP 自动配置」的端到端验收 —— 不换网络、不打外部接口。
 *
 *   node tools/smoke-ip-apply.mjs
 *   node tools/smoke-ip-apply.mjs --ext=dist
 *
 * 验的是那个被用户报成"点了没反应"的按钮，必须在**真实弹窗页面**里表现正确：
 *
 *   1. 点一下 → 后台查出口 → 坐标/时区/语言**写进配置**（manual），不是只刷 lastLocation；
 *   2. 弹窗里的经纬度/时区输入框立刻显示新值，按钮下面出现"已按出口 IP … 配置"；
 *   3. 出口查不到时，按钮下面必须出现失败原因 —— 静默无反应是这次要消灭的故障；
 *   4. 保存之后配置仍然是 manual 的出口值（没被 auto 档悄悄吃掉）。
 *
 * 归属地接口用 --host-resolver-rules 指到本地 HTTPS 桩，返回值随时可改 ——
 * 改一次等价于"换了一个出口"，不用真的连 VPN。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evaluate, killChrome, launchChrome, sleep } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return { [key]: value === undefined ? true : value };
}));
const EXT = resolve(ROOT, String(argv.ext || 'dist'));
const API_DOMAINS = ['ipwho.is', 'ipapi.co', 'ipinfo.io'];
const OUT = join(ROOT, 'tools', 'out');

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

// ---------- 本地归属地桩（mode=ok 给坐标，mode=fail 只有国名） ----------

let hitCount = 0;
let mode = 'ok';
const exit = {
  ip: '203.0.113.9',
  country: 'United States',
  code: 'US',
  timezone: 'America/Los_Angeles',
  latitude: 34.0522,
  longitude: -118.2437
};

const certs = ensureCerts(API_DOMAINS);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  hitCount += 1;
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (mode === 'fail') {
    // 三家都只回国名不回国码、没有坐标 —— parseExitIpResponse 全部拒绝
    res.end(JSON.stringify({ ip: exit.ip, country: { name: exit.country } }));
    return;
  }
  if (host === 'ipapi.co') {
    res.end(JSON.stringify({
      ip: exit.ip,
      country_name: exit.country,
      country_code: exit.code,
      timezone: exit.timezone,
      latitude: exit.latitude,
      longitude: exit.longitude
    }));
  } else if (host === 'ipinfo.io') {
    res.end(JSON.stringify({
      ip: exit.ip,
      country: exit.code,
      timezone: exit.timezone,
      loc: `${exit.latitude},${exit.longitude}`
    }));
  } else {
    res.end(JSON.stringify({
      ip: exit.ip,
      success: true,
      country: exit.country,
      country_code: exit.code,
      timezone: { id: exit.timezone },
      latitude: exit.latitude,
      longitude: exit.longitude
    }));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vg-ipapply-')),
  headless: true,
  args: [
    '--ignore-certificate-errors',
    `--host-resolver-rules=${API_DOMAINS.map((domain) => `MAP ${domain} 127.0.0.1:${port}`).join(',')}`
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
await cdp.send('Extensions.loadUnpacked', { path: EXT });
await sleep(2600);

const { targetInfos } = await cdp.send('Target.getTargets');
const sw = targetInfos.find((item) => item.type === 'service_worker' && item.url.includes('/background/'));
if (!sw) throw new Error('没找到扩展的 service worker（先 npm run build）');
const extId = sw.url.split('/')[2];
console.log(`扩展 id: ${extId}（${EXT}）`);

const openPage = async (path, settle = 1800) => {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  // 扩展页面按真实弹窗尺寸渲染：默认 800x600 的窗口会把快速配置区挤出可视区，
  // 截图就只剩一片背景色
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 420,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  }, sessionId);
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/${path}` }, sessionId);
  await loaded.catch(() => undefined);
  await sleep(settle);
  return { sessionId, targetId };
};

const options = await openPage('options/options.html', 2200);
const call = (message) => evaluate(cdp, options.sessionId, `(async () => {
  const response = await chrome.runtime.sendMessage(${JSON.stringify(message)});
  if (!response) throw new Error('空响应');
  if (response.status === 'error') throw new Error(response.message);
  return JSON.stringify(response);
})()`, { awaitPromise: true }).then((json) => JSON.parse(json));

// ---------- 1) 后台动作本身：查出口 → 写配置 ----------

console.log('--- 1) applyFromExitIp：坐标/时区/语言写进配置 ---');
const applied = await call({ action: 'applyFromExitIp' });
console.log(`outcome: ${JSON.stringify(applied.outcome)}`);
record('后台返回成功', applied.outcome?.ok === true, JSON.stringify(applied.outcome));
record('弹窗拿到新配置', Boolean(applied.config), applied.config ? 'yes' : 'no');
record('时区落 manual 并写进配置',
  applied.config?.globalProfile?.timezone?.mode === 'manual'
  && applied.config?.globalProfile?.timezone?.timezone === 'America/Los_Angeles',
  JSON.stringify(applied.config?.globalProfile?.timezone));
record('坐标落 manual 并写进配置',
  applied.config?.globalProfile?.geolocation?.mode === 'manual'
  && applied.config?.globalProfile?.geolocation?.latitude === 34.0522
  && applied.config?.globalProfile?.geolocation?.longitude === -118.2437,
  JSON.stringify(applied.config?.globalProfile?.geolocation?.latitude));
record('语言跟着国家变成 en-US', applied.config?.globalProfile?.language?.language === 'en-US',
  applied.config?.globalProfile?.language?.language);
record('清掉手选预设（否则界面一边显示美国一边给洛杉矶坐标）',
  applied.config?.profile?.activeProfileId === null, String(applied.config?.profile?.activeProfileId));

// 自动同步的账本不许被手动点一次改写
const state = await call({ action: 'getExitIpSyncState' });
record('没有偷偷占用 lastSyncedExitIp 账本', String(state.storedIp || '') !== exit.ip, `storedIp=${state.storedIp}`);
record('lastLocation 同步更新', state.lastLocation?.timezone === 'America/Los_Angeles', JSON.stringify(state.lastLocation?.timezone));

// ---------- 2) 真实弹窗：点按钮 → 输入框与状态行都要变 ----------

console.log('\n--- 2) 真实弹窗里点「从 IP 自动配置」---');

// 先把配置退回"出厂 auto 档"：用户第一次点这个按钮时的状态
const fresh = (await call({ action: 'getSiteConfig' })).config;
fresh.globalProfile.timezone = { enabled: true, mode: 'auto', timezone: '' };
fresh.globalProfile.geolocation = { ...fresh.globalProfile.geolocation, mode: 'auto', latitude: null, longitude: null };
fresh.profile.activeProfileId = null;
await call({ action: 'setSiteConfig', config: fresh });
await sleep(400);

// 这时候才打开弹窗，让它读到 auto 档（旧配置下的弹窗已经被导航丢弃）
const popup = await openPage('popup/popup.html', 2400);

mkdirSync(OUT, { recursive: true });
const shot = async (name) => {
  // 坐标框在「配置」页签里，默认显示的是概览页 —— 先切页签再量。
  // 面板改版换过 DOM（旧的 .profile-section 已经不存在），所以锚点按 #latitude
  // 往上找卡片；一个都找不到时只跳过截图，不让验收因为截图塌掉。
  const raw = await evaluate(cdp, popup.sessionId, `(() => {
    const tab = document.querySelector('[data-view="config"]');
    if (tab && !tab.classList.contains('is-active')) tab.click();
    const anchor = document.getElementById('latitude');
    const section = (anchor && anchor.closest('.card')) || document.querySelector('.card');
    if (!section) return 'null';
    section.scrollIntoView({ block: 'start' });
    const box = section.getBoundingClientRect();
    return JSON.stringify({ x: 0, y: Math.max(0, box.top - 8 + window.scrollY), width: 420, height: box.height + 16, scale: 2 });
  })()`);
  if (!raw || raw === 'null') {
    console.log(`截图跳过（找不到坐标卡片）：${name}`);
    return;
  }
  const clip = JSON.parse(raw);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip }, popup.sessionId);
  const file = join(OUT, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`截图: ${file}`);
};

// auto 档不该是空框：没有坐标可显示时它就是"点了没反应"的观感来源
hitCount = 0;
const before = await evaluate(cdp, popup.sessionId, `JSON.stringify({
  latitude: document.getElementById('latitude').value,
  longitude: document.getElementById('longitude').value,
  timezone: document.getElementById('timezone').value
})`).then(JSON.parse);
console.log(`点击前（auto 档，上次定位在洛杉矶）：lat=${before.latitude || '(空)'} tz=${before.timezone || '(空)'}`);
record('auto 档用上次定位填满输入框（不是空白）',
  before.latitude === '34.0522' && before.timezone === 'America/Los_Angeles',
  `${before.latitude || '(空)'} / ${before.timezone || '(空)'}`);

// 换出口：桩改成东京，再点一次 —— 值必须真的动
Object.assign(exit, { ip: '203.0.113.7', country: 'Japan', code: 'JP', timezone: 'Asia/Tokyo', latitude: 35.6812, longitude: 139.7671 });

await evaluate(cdp, popup.sessionId, `document.getElementById('getFromIP').click()`);
let after = { latitude: '', longitude: '', timezone: '', status: '', tone: '' };
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(250);
  after = await evaluate(cdp, popup.sessionId, `JSON.stringify({
    latitude: document.getElementById('latitude').value,
    longitude: document.getElementById('longitude').value,
    timezone: document.getElementById('timezone').value,
    status: document.getElementById('ipConfigStatus').textContent || '',
    tone: document.getElementById('ipConfigStatus').dataset.tone || ''
  })`).then(JSON.parse);
  if (after.tone === 'ok' || after.tone === 'error') break;
}
console.log(`点击后：lat=${after.latitude} lon=${after.longitude} tz=${after.timezone} | ${after.status}`);
record('弹窗坐标框变成新出口的坐标', after.latitude === '35.6812' && after.longitude === '139.7671', `${after.latitude}/${after.longitude}`);
record('弹窗时区变成新出口的时区', after.timezone === 'Asia/Tokyo', after.timezone);
record('按钮下面给出成功提示', after.tone === 'ok' && after.status.includes('203.0.113.7'), after.status);
record('只打一次归属地接口', hitCount === 1, `${hitCount} 次`);
await shot('ip-apply-ok.png');

// ---------- 3) 保存之后别被 auto 档吃掉 ----------

console.log('\n--- 3) 保存之后配置还是出口值 ---');
const saved = (await call({ action: 'getSiteConfig' })).config;
record('保存后仍是 manual 的东京时区',
  saved.globalProfile.timezone.mode === 'manual' && saved.globalProfile.timezone.timezone === 'Asia/Tokyo',
  JSON.stringify(saved.globalProfile.timezone));

// ---------- 4) 出口查不到：必须报错，不能静默 ----------

console.log('\n--- 4) 出口查不到时，按钮下面必须有失败原因 ---');
mode = 'fail';
await evaluate(cdp, popup.sessionId, `document.getElementById('ipConfigStatus').dataset.tone = ''`);
await evaluate(cdp, popup.sessionId, `document.getElementById('getFromIP').click()`);
let failed = { status: '', tone: '', disabled: true };
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(250);
  failed = await evaluate(cdp, popup.sessionId, `JSON.stringify({
    status: document.getElementById('ipConfigStatus').textContent || '',
    tone: document.getElementById('ipConfigStatus').dataset.tone || '',
    disabled: document.getElementById('getFromIP').disabled
  })`).then(JSON.parse);
  if (failed.tone === 'error') break;
}
console.log(`失败提示：${failed.status}`);
record('失败时状态行是 error 档', failed.tone === 'error', failed.tone);
record('失败文案说人话（不是三条接口报错拼在一起）',
  /自动配置失败/.test(failed.status) && /查不到出口 IP/.test(failed.status) && !/https:\/\//.test(failed.status),
  failed.status);
record('按钮恢复可点（不是永远转圈）', failed.disabled === false, String(failed.disabled));

// ---------- 留证据：成功/失败各一张截图 ----------

await shot('ip-apply-error.png');

// ---------- 汇总 ----------

const failures = checks.filter((item) => !item.ok);
console.log('\n================ 汇总 ================');
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} 通过`);

await killChrome(chrome);
server.close();
process.exit(failures.length ? 1 : 0);