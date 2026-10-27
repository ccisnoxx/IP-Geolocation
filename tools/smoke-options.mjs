#!/usr/bin/env node
/*
 * options 页端到端冒烟：真的点 UI，再看后台有没有按预期改写规则。
 *
 *   node tools/smoke-options.mjs                          # 默认用 ~/.vanishgeo/profiles/<persona>/ext
 *   node tools/smoke-options.mjs --extension=dist-probe-geo
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-options.mjs
 *
 * 覆盖两条写入路径：
 *   1. 改语言 → 静态 ruleset 让位（enabledRulesets 不再包含 baked-language）+ 动态规则换语言
 *   2. 加域名 → 动态注册内容脚本 + 动态 DNR 规则补上这一条
 */
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, evaluate, launchChrome, sleep , killChrome } from './lib/cdp.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const persona = String(argv.persona || 'us-la-1');
const defaultExt = join(homedir(), '.vanishgeo', 'profiles', persona, 'ext');
const extensionPath = argv.extension ? resolve(String(argv.extension)) : defaultExt;
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到构建产物: ${extensionPath}`);
  process.exit(2);
}

const newLanguage = String(argv.language || 'ja-JP');
const newDomain = String(argv.domain || 'example.org');
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
await cdp.send('Extensions.loadUnpacked', { path: extensionPath });

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

const swTarget = await findServiceWorker();
const swSession = (await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true })).sessionId;
const extensionId = await evaluate(cdp, swSession, 'chrome.runtime.id');

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

cdp.close();
killChrome(chrome.child);

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);