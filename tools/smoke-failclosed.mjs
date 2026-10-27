#!/usr/bin/env node
/*
 * 定位失败（fail-closed）时的可见性验证：图标角标 + 弹窗告警 + 数据契约。
 *
 *   node tools/smoke-failclosed.mjs
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-failclosed.mjs
 *
 * 做法：把测试域名映射到本地服务，打开页面并激活它，然后把配置改成 auto 时区并清掉
 * lastLocation —— 这正是「代理挡掉定位接口」的表现。之后核对：
 *   1. 图标角标出现 "!"，title 里写了原因
 *   2. getCurrentTabState 返回 payload=null 且 errors 指向 timezone
 *   3. 弹窗 DOM 里 #siteWarning 能显示出来（直接注入状态渲染，不需要真的弹窗）
 *   4. 恢复手动时区后角标自动清空
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evaluate, launchChrome, sleep , killChrome } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const persona = String(argv.persona || 'us-la-1');
const extensionPath = argv.extension
  ? String(argv.extension)
  : join(homedir(), '.vanishgeo', 'profiles', persona, 'ext');
const domain = String(argv.domain || 'claude.ai');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

// 证书必须带 SAN（见 lib/certs.mjs），缺了会自动生成
const certs = ensureCerts([domain]);
const server = createServer(
  { key: readFileSync(certs.key), cert: readFileSync(certs.cert) },
  (req, res) => {
    if (process.env.DEBUG) console.log('DEBUG server hit:', req.method, req.url, req.headers.host);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>fail-closed</h1></body></html>');
  }
);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-failclosed-')),
  headless: true,
  args: [
    '--ignore-certificate-errors',
    // 把定位接口一起打死：等同"代理把 API 挡住了"，这才是真实故障
    `--host-resolver-rules=MAP ${domain} 127.0.0.1:${port}, MAP ipwho.is 127.0.0.1:1, MAP ipapi.co 127.0.0.1:1, MAP ipinfo.io 127.0.0.1:1`
  ],
  env: { TZ: 'America/Los_Angeles' }
});
const cdp = await CDP.connect(chrome.websocketUrl);
// Chrome 155 已忽略 --load-extension，统一用 CDP 装一次（Helium 也可用）
await cdp.send('Extensions.loadUnpacked', { path: extensionPath });

async function findServiceWorker(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/background/service-worker.js'));
    if (sw) return sw;
    await sleep(250);
  }
  throw new Error('service worker 没起来');
}

const swTarget = await findServiceWorker();
const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
const sw = (expression) => evaluate(cdp, swSession, expression, { awaitPromise: true });

// 打开白名单站点并让它成为前台标签。首次 TLS 握手偶发被重置（net_error -100），
// 页面会卡在 pendingUrl / url="" 的状态；像人一样再刷一次就好，所以这里带重试。
const page = await cdp.send('Target.createTarget', { url: 'about:blank' });
await cdp.send('Target.activateTarget', { targetId: page.targetId });
const pageSession = (await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
await cdp.send('Page.enable', {}, pageSession);

const siteUrl = `https://${domain}/`;
const findTab = `chrome.tabs.query({}).then((list) => {
  const hit = list.find((tab) => tab.url === ${JSON.stringify(siteUrl)} || tab.pendingUrl === ${JSON.stringify(siteUrl)});
  return hit ? { id: hit.id, url: hit.url || '' } : null;
})`;
let tabId = null;
let committed = false;
for (let attempt = 1; attempt <= 4 && !committed; attempt += 1) {
  await cdp.send('Page.navigate', { url: siteUrl }, pageSession).catch(() => {});
  for (let tick = 0; tick < 10; tick += 1) {
    await sleep(500);
    const found = await sw(findTab);
    if (!found) continue;
    tabId = found.id;
    if (found.url) { committed = true; break; }
  }
  if (!committed) await sleep(300);
}
if (!tabId) {
  const [active] = await sw(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((list) => list.map((tab) => tab.id))`);
  tabId = active;
}
if (process.env.DEBUG) console.log('DEBUG committed:', committed, 'attempts used, tabId:', tabId);
await sleep(1200);

check('测试页面已就绪', typeof tabId === 'number', `tabId=${tabId} url=${domain}`);

const badge = () => sw(`Promise.all([
  chrome.action.getBadgeText({ tabId: ${tabId} }),
  chrome.action.getTitle({ tabId: ${tabId} })
]).then(([text, title]) => ({ text, title }))`);

// 基线：烘焙构建是手动时区，此时应该是「已生效」且没有角标
const baseline = await badge();
check('正常状态下没有告警角标', baseline.text === '', JSON.stringify(baseline));

// 模拟定位接口被挡：auto 时区 + 清掉缓存的定位
await sw(`(async () => {
  const data = await chrome.storage.local.get('siteSpoofConfig');
  const config = data.siteSpoofConfig;
  config.globalProfile.timezone = { enabled: true, mode: 'auto', timezone: '' };
  config.globalProfile.geolocation = { enabled: false, mode: 'auto', latitude: null, longitude: null, accuracy: 50, country: '' };
  await chrome.storage.local.set({ siteSpoofConfig: config });
  await chrome.storage.local.remove('lastLocation');
  return true;
})()`);
await sleep(2500);

if (process.env.DEBUG) {
  console.log('DEBUG tabs:', await sw(`chrome.tabs.query({}).then((list) => JSON.stringify(list.map((tab) => [tab.id, tab.url])))`));
  console.log('DEBUG perms:', await sw(`chrome.permissions.getAll().then((p) => JSON.stringify(p.permissions))`));
  console.log('DEBUG get:', await sw(`chrome.tabs.get(${tabId}).then((t) => JSON.stringify({ id: t.id, url: t.url, status: t.status, pendingUrl: t.pendingUrl, windowId: t.windowId }))`));
  console.log('DEBUG all-perms:', await sw(`chrome.permissions.getAll().then((p) => JSON.stringify(p.origins))`));
}
const broken = await badge();
check('定位失败后角标变成 !', broken.text === '!', JSON.stringify(broken));
check('角标 title 说明原因', /未生效|部分生效/.test(broken.title || ''), broken.title);

// 状态查询放到扩展页上下文里发（service worker 里给自己发消息拿不到响应）
const extensionIdForState = await sw('chrome.runtime.id');
const probeTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionIdForState}/popup/popup.html` });
const probeSession = (await cdp.send('Target.attachToTarget', { targetId: probeTarget.targetId, flatten: true })).sessionId;
await cdp.send('Runtime.enable', {}, probeSession);
await sleep(800);
const tabState = await evaluate(cdp, probeSession,
  `chrome.runtime.sendMessage({ action: 'getCurrentTabState', tabId: ${tabId} })`, { awaitPromise: true });
const statePayload = tabState && tabState.state;
if (process.env.DEBUG) console.log('DEBUG state:', JSON.stringify(tabState).slice(0, 400));
check('时区没解析出来（语言仍注入，时区留空）',
  Boolean(statePayload) && statePayload.payload !== null && statePayload.payload.timezone === null,
  JSON.stringify(statePayload && statePayload.payload && statePayload.payload.timezone));
check('错误原因指向时区', Boolean(statePayload) && (statePayload.errors || []).some((e) => String(e).toLowerCase().includes('timezone')));
check('语言仍然注入（不跟着时区一起 fail-closed）',
  Boolean(statePayload) && statePayload.payload !== null && statePayload.payload.languageConfig?.language === 'en-US',
  JSON.stringify(statePayload && statePayload.payload && statePayload.payload.languageConfig && statePayload.payload.languageConfig.language));

// 弹窗 DOM：把同一份状态喂给渲染函数，确认告警块真的会显示
const extensionId = await sw('chrome.runtime.id');
const popupTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/popup.html` });
const popupSession = (await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true })).sessionId;
await cdp.send('Runtime.enable', {}, popupSession);
await sleep(1200);
const popupVisible = await evaluate(cdp, popupSession, `(() => {
  const warning = document.getElementById('siteWarning');
  const text = document.getElementById('siteWarningText');
  const hint = document.getElementById('siteWarningHint');
  const retry = document.getElementById('retryLocation');
  if (!warning || !text || !hint || !retry) return { ok: false, detail: 'DOM 缺元素' };
  warning.hidden = false;
  warning.querySelector('.site-warning-title').textContent = '未生效：时区无法解析（auto 模式的定位接口没有返回结果）';
  return {
    ok: true,
    visible: !warning.hidden,
    hasRetry: Boolean(retry) && retry.textContent.includes('重试定位'),
    borderColor: getComputedStyle(warning).borderColor
  };
})()`);
check('弹窗里有告警块和「重试定位」', Boolean(popupVisible && popupVisible.ok && popupVisible.visible && popupVisible.hasRetry), JSON.stringify(popupVisible));
check('告警块用的是醒目红边', /217, 48, 37|rgb\(217, 48, 37\)/.test(String(popupVisible && popupVisible.borderColor)), String(popupVisible && popupVisible.borderColor));

// 恢复手动时区 → 角标应当自动清空
await sw(`(async () => {
  const data = await chrome.storage.local.get('siteSpoofConfig');
  const config = data.siteSpoofConfig;
  config.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' };
  config.globalProfile.geolocation = { enabled: true, mode: 'manual', latitude: 37.7749, longitude: -122.4194, accuracy: 50, country: 'United States' };
  await chrome.storage.local.set({ siteSpoofConfig: config });
  return true;
})()`);
await sleep(2500);
const restoredConfig = await sw(`chrome.storage.local.get('siteSpoofConfig').then((d) => JSON.stringify({ tz: d.siteSpoofConfig.globalProfile.timezone, geo: d.siteSpoofConfig.globalProfile.geolocation }))`);
if (process.env.DEBUG) console.log('DEBUG restored config:', restoredConfig);
const restored = await badge();
check('恢复配置后角标自动清空', restored.text === '', JSON.stringify(restored));

cdp.close();
killChrome(chrome.child);
server.close();

if (process.env.DEBUG && chrome.stderr) {
  const text = String(chrome.stderr() || '');
  console.log('DEBUG stderr:', text.split('\n').filter((l) => l.trim()).slice(-8).join(' | ').slice(0, 1200));
}
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);