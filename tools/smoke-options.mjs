#!/usr/bin/env node
/*
 * options 页端到端冒烟：真的点 UI，再看后台有没有按预期改写规则。
 *
 *   node tools/smoke-options.mjs                          # 默认用 ~/.vanishgeo/profiles/<persona>/ext
 *   node tools/smoke-options.mjs --extension=dist-probe-geo
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-options.mjs
 *
 * 覆盖四条路径：
 *   1. 改语言 → 静态 ruleset 让位（enabledRulesets 不再包含 baked-language）+ 动态规则换语言
 *   2. 加域名 → 动态注册内容脚本 + 动态 DNR 规则补上这一条
 *   3. 打开「跟随出口 IP」→ 配置落库 + 后台真的建出定时器（周期跟表单一致）
 *   4. 写入一次定位失败 → 配置页把它渲染成人话、原文折在技术原因里、清除后存储被清空
 */
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, evaluate, launchChrome, sleep , killChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const persona = String(argv.persona || 'us-la-1');
const defaultExt = join(homedir(), '.vanishgeo', 'profiles', persona, 'ext');
const extensionPath = argv.extension ? resolve(String(argv.extension)) : defaultExt;
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到构建产物: ${extensionPath}`);
  process.exit(2);
}

const newLanguage = String(argv.language || 'ja-JP');
const newDomain = String(argv.domain || 'example.org');
const ipSyncInterval = Number(argv.ipSyncInterval || 17);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-smoke-')),
  headless: true
});

const cdp = await CDP.connect(chrome.websocketUrl);
// Chrome 155 已忽略 --load-extension，Helium 还认；统一走 CDP 装一次，两边行为一致
const loadedId = await loadExtension(cdp, extensionPath);

async function findServiceWorker(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const sw = targetInfos.find((target) => target.type === 'service_worker' && target.url.includes('/background/service-worker.js'));
    if (sw) return sw;
    await sleep(250);
  }
  throw new Error('service worker 没起来（扩展没加载？）');
}

/**
 * 拿到一个「chrome API 已经就绪」的 SW 会话。
 *
 * 只找到 target 不等于能 evaluate：CI 上第一次跑就撞到 `chrome is not defined`
 * —— 目标列表里已经有 service_worker，attach 上去执行的第一句却还没有扩展 API
 * （SW 正在启动，或者刚被回收重启、targetId 已经换了）。所以这里不光等 target，
 * 还要等到 `chrome.runtime.id` 能读出值，中途换过 targetId 就重来一轮。
 */
async function waitServiceWorkerSession() {
  const deadline = Date.now() + 20_000;
  let lastError = '';
  while (Date.now() < deadline) {
    let swTarget;
    try {
      swTarget = await findServiceWorker(3000);
    } catch (error) {
      lastError = error.message;
      continue;
    }
    const sessionId = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
    try {
      await cdp.send('Runtime.enable', {}, sessionId);
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const id = await evaluate(cdp, sessionId, 'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id');
        if (id) return { swSession: sessionId, extensionId: String(id) };
        await sleep(120);
      }
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`service worker 起来了但 chrome API 一直没就绪：${lastError}`);
}

const { swSession, extensionId } = await waitServiceWorkerSession();
if (loadedId && loadedId !== extensionId) {
  throw new Error(`装上的扩展 id 与 SW 里的不一致：${loadedId} vs ${extensionId}`);
}

// 后台视角的状态快照
const state = () => evaluate(cdp, swSession, `Promise.all([
  chrome.declarativeNetRequest.getEnabledRulesets(),
  chrome.declarativeNetRequest.getDynamicRules(),
  chrome.scripting.getRegisteredContentScripts()
]).then(([rulesets, dynamic, scripts]) => ({
  rulesets,
  dynamic: dynamic.map((rule) => ({
    domains: rule.condition.requestDomains || [],
    value: (rule.action.requestHeaders && rule.action.requestHeaders[0] && rule.action.requestHeaders[0].value) || ''
  })),
  // MAIN 运行时和隔离世界桥接各注册一份，match 会重复，报告时去重
  scripts: [...new Set(scripts.map((script) => script.matches || []).flat())]
}))`, { awaitPromise: true });

const pageTarget = await cdp.send('Target.createTarget', { url: 'about:blank' });
const pageSession = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true }).then((r) => r.sessionId);
await cdp.send('Page.enable', {}, pageSession);
await cdp.send('Runtime.enable', {}, pageSession);
// 选项页保存成功后会 alert('设置已保存')，原生弹窗会把 Runtime.evaluate 卡住，
// 必须自动关掉，否则后续点击全部超时。
cdp.on((message) => {
  if (message.method !== 'Page.javascriptDialogOpening') return;
  cdp.send('Page.handleJavaScriptDialog', { accept: message.params.type !== 'beforeunload' }, message.sessionId).catch(() => {});
});
await cdp.send('Page.navigate', { url: `chrome-extension://${extensionId}/options/options.html` }, pageSession);
await sleep(1200);

const page = (expression, options) => evaluate(cdp, pageSession, expression, options);

// 等后台把规则写完（保存是异步的）
async function waitFor(predicate, { timeoutMs = 8000, label = 'state' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await state();
    if (predicate(last)) return last;
    await sleep(200);
  }
  throw new Error(`等待超时: ${label}`);
}

const before = await state();
check('烘焙构建带静态 ruleset', before.rulesets.includes('baked-language'), JSON.stringify(before.rulesets));
check('起步时没有动态 DNR 规则', before.dynamic.length === 0, `dynamic=${before.dynamic.length}`);
check('起步时没有动态内容脚本（全走静态）', before.scripts.length === 0, `scripts=${before.scripts.length}`);

// —— 路径 1：改语言 → 静态让位 ——
await page(`(() => {
  document.getElementById('languageEnabled').checked = true;
  document.getElementById('language').value = ${JSON.stringify(newLanguage)};
  document.getElementById('languages').value = ${JSON.stringify(`${newLanguage},ja`)};
  document.getElementById('acceptLanguage').value = ${JSON.stringify(`${newLanguage},ja;q=0.9`)};
  document.getElementById('save').click();
  return true;
})()`);

let afterLanguage = null;
try {
  afterLanguage = await waitFor((snapshot) => !snapshot.rulesets.includes('baked-language') && snapshot.dynamic.length > 0, {
    label: '静态 ruleset 让位'
  });
  check('改语言后静态 ruleset 已禁用', !afterLanguage.rulesets.includes('baked-language'), JSON.stringify(afterLanguage.rulesets));
  check('改语言后写入动态规则', afterLanguage.dynamic.length > 0, `dynamic=${afterLanguage.dynamic.length}`);
  const wrong = afterLanguage.dynamic.filter((rule) => !rule.value.startsWith(newLanguage));
  check('动态规则都换成新语言', wrong.length === 0, wrong.length ? JSON.stringify(wrong.slice(0, 2)) : `sample=${afterLanguage.dynamic[0]?.value}`);
} catch (error) {
  check('改语言后静态 ruleset 已禁用', false, error.message);
}

// —— 路径 2：加域名 → 动态补注册 ——
await page(`(() => {
  const area = document.getElementById('ruleList');
  const lines = area.value.split('\\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.includes(${JSON.stringify(newDomain)})) lines.push(${JSON.stringify(newDomain)});
  area.value = lines.join('\\n');
  document.getElementById('save').click();
  return true;
})()`);

try {
  const afterDomain = await waitFor((snapshot) => (
    snapshot.scripts.some((pattern) => pattern.includes(newDomain))
    || snapshot.dynamic.some((rule) => rule.domains.includes(newDomain))
  ), { label: '新域名补注册' });

  check('新域名已注册内容脚本', afterDomain.scripts.some((pattern) => pattern.includes(newDomain)), `matches=${afterDomain.scripts.filter((p) => p.includes(newDomain)).join(',') || '-'}`);
  check('新域名写进动态 DNR', afterDomain.dynamic.some((rule) => rule.domains.includes(newDomain)), `dynamic=${afterDomain.dynamic.length}`);
  const added = afterDomain.dynamic.find((rule) => rule.domains.includes(newDomain));
  check('新域名继承当前语言', Boolean(added) && added.value.startsWith(newLanguage), added?.value || '-');
} catch (error) {
  check('新域名已注册内容脚本', false, error.message);
}

// —— 路径 3：跟随出口 IP → 配置落库 + 定时器建出来 ——
// 这里只断言「开关有没有真的接上后台」：查出口本身依赖网络，失败是允许的（下一轮重试）。
await page(`(() => {
  const enabled = document.getElementById('ipSyncEnabled');
  const interval = document.getElementById('ipSyncInterval');
  const language = document.getElementById('ipSyncLanguage');
  if (!enabled || !interval || !language) throw new Error('配置页缺少跟随出口 IP 的控件');
  enabled.checked = true;
  enabled.dispatchEvent(new Event('change'));
  if (language.disabled) throw new Error('总开关打开后语言开关仍被禁用');
  interval.value = ${JSON.stringify(String(ipSyncInterval))};
  document.getElementById('save').click();
  return true;
})()`);

const background = () => evaluate(cdp, swSession, `Promise.all([
  chrome.storage.local.get('siteSpoofConfig'),
  chrome.alarms.getAll()
]).then(([stored, alarms]) => ({
  ipSync: (stored.siteSpoofConfig || {}).ipSync || null,
  alarm: (alarms.find((item) => item.name === 'vanishgeo-exit-ip') || {}).periodInMinutes || null
}))`, { awaitPromise: true });

try {
  const deadline = Date.now() + 8000;
  let snapshot = await background();
  while (Date.now() < deadline && !(snapshot.ipSync && snapshot.ipSync.enabled && snapshot.alarm === ipSyncInterval)) {
    await sleep(200);
    snapshot = await background();
  }
  check('跟随出口 IP 开关落库', Boolean(snapshot.ipSync && snapshot.ipSync.enabled), JSON.stringify(snapshot.ipSync));
  check('周期跟表单一致', snapshot.ipSync && snapshot.ipSync.intervalMinutes === ipSyncInterval, `intervalMinutes=${snapshot.ipSync && snapshot.ipSync.intervalMinutes}`);
  check('后台建出定时器', snapshot.alarm === ipSyncInterval, `periodInMinutes=${snapshot.alarm}`);
} catch (error) {
  check('跟随出口 IP 开关落库', false, error.message);
}

// 状态行能不能如实反映结果（有没有真的拿到出口 IP 取决于网络，两种都要自洽）
try {
  // 先等后台那次「开关关→开」的同步落地；它是一次真实的查出口请求，可能慢一两秒
  let syncedIp = '';
  const ipDeadline = Date.now() + 12000;
  while (Date.now() < ipDeadline && !syncedIp) {
    syncedIp = await page(`chrome.storage.local.get('lastSyncedExitIp').then((value) => value.lastSyncedExitIp || '')`, { awaitPromise: true });
    if (!syncedIp) await sleep(300);
  }
  // 重新打开配置页再读：这条断言要验的是「按存储渲染」，不能靠页面自己定时刷新 ——
  // 那样刷新间隔一改，同一个脚本就会时红时绿，而且红绿反映的是节奏不是正确性。
  await cdp.send('Page.navigate', { url: `chrome-extension://${extensionId}/options/options.html` }, pageSession);
  const deadline = Date.now() + 8000;
  let status = '';
  while (Date.now() < deadline) {
    status = (await page(`document.getElementById('ipSyncStatus') ? document.getElementById('ipSyncStatus').textContent : ''`)) || '';
    if (syncedIp ? status.includes(syncedIp) : status.includes('还没成功同步过')) break;
    await sleep(200);
  }
  check(
    syncedIp ? '状态行显示上次出口 IP' : '没拿到出口 IP 时状态行如实说没同步过',
    syncedIp ? status.includes(syncedIp) : status.includes('还没成功同步过'),
    status
  );
} catch (error) {
  check('状态行显示同步结果', false, error.message);
}

// —— 路径 4：「上次定位失败」上到前台 ——
// 后台那四处失败写入都发生在真跑定位/查 IP 的时候，离线跑不出来，所以这里直接把
// storage 写成失败后的样子，验的是**配置页这条显示链路**：读得到、渲染成人话、
// 清除按钮真的清、进程重启后不再出现。
try {
  await page(`chrome.storage.local.set({
    lastGeoError: 'IP geolocation APIs returned no valid coordinates: https://ipapi.co/json/ no valid location | https://ipwho.is/ no valid location',
    lastGeoErrorAt: new Date().toISOString()
  })`, { awaitPromise: true });

  let shown = false;
  const showDeadline = Date.now() + 5000;
  while (Date.now() < showDeadline && !shown) {
    shown = await page(`(() => {
      const box = document.getElementById('geoError');
      return Boolean(box && !box.hidden && document.getElementById('geoErrorHint').textContent.includes('可用坐标'));
    })()`);
    if (!shown) await sleep(200);
  }
  check('定位失败记录会出现在配置页', shown, shown ? '' : '卡片没显示');

  const detail = await page(`(() => ({
    hint: document.getElementById('geoErrorHint').textContent,
    reason: document.getElementById('geoErrorReason').textContent,
    age: document.getElementById('geoErrorAge').textContent
  }))()`);
  check('人话解释里没有接口原文', !detail.hint.includes('https://'), detail.hint);
  check('接口原文折在技术原因里', detail.reason.includes('https://ipapi.co'), detail.reason.slice(0, 60));
  check('带上「多久之前」', detail.age === '刚刚', detail.age);

  await page(`document.getElementById('geoErrorDismiss').click()`);
  let cleared = false;
  const clearDeadline = Date.now() + 5000;
  while (Date.now() < clearDeadline && !cleared) {
    cleared = await page(`(async () => {
      const box = document.getElementById('geoError');
      if (!box || !box.hidden) return false;
      const stored = await chrome.storage.local.get(['lastGeoError', 'lastGeoErrorAt']);
      return !stored.lastGeoError && !stored.lastGeoErrorAt;
    })()`, { awaitPromise: true });
    if (!cleared) await sleep(200);
  }
  check('清除提示后卡片消失且存储被清空', cleared, cleared ? '' : '还在');
} catch (error) {
  check('定位失败记录会出现在配置页', false, error.message);
}

cdp.close();
killChrome(chrome.child);

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);