#!/usr/bin/env node
/*
 * 「跟随出口 IP」的端到端验收 —— 不换网络也能验。
 *
 *   node tools/smoke-ip-follow.mjs
 *   node tools/smoke-ip-follow.mjs --site=https://example.com/   # 换一个检测站
 *   node tools/smoke-ip-follow.mjs --offline                     # 只跑扩展侧，不碰外部网站
 *
 * 做法：把三家归属地接口（ipwho.is / ipapi.co / ipinfo.io）用 --host-resolver-rules
 * 指向本地 HTTPS 桩，桩的返回值随时可改 —— 改一次就等价于"出口 IP 换了一次"。
 * 然后用真实消息通道（setSiteConfig / addDomainRule / checkExitIpSync）驱动功能，
 * 最后在一个**真实的第三方指纹检测站**上读它自己的判定：这比只读 window 的值更硬，
 * 因为那是用户真正会看到的东西。
 *
 * 为什么要用真站而不只是断言返回值：扩展可以在 background 里把配置改得很漂亮，
 * 而页面一个字节都没变 —— 只有让第三方页面自己算一遍，才能证明补丁真的落到页面上。
 *
 * 默认站点是 https://fuck-claude.vercel.app/zh/（纯本地检测、不上传结果）。
 * 它靠 `Intl.DateTimeFormat().resolvedOptions().timeZone` 与 `navigator.languages`
 * 打分，正好是这两层要验的东西。站点改版会让「读面板」这一步失效 —— 那部分是
 * 尽力而为的，读不到只警告；扩展侧的断言不受影响。
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
  return [key, value === undefined ? true : value];
}));

const EXT = resolve(ROOT, String(argv.ext || 'dist'));
const SITE = String(argv.site || 'https://fuck-claude.vercel.app/zh/');
const OFFLINE = argv.offline === true;
const OUT = join(ROOT, 'tools', 'out');
const API_DOMAINS = ['ipwho.is', 'ipapi.co', 'ipinfo.io'];

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};
const warn = (message) => console.log(`! ${message}`);

// ---------- 本地归属地桩 ----------

let hitCount = 0;
const exit = { ip: '203.0.113.7', country: 'Japan', code: 'JP', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 };

const certs = ensureCerts(API_DOMAINS);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  hitCount += 1;
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (host === 'ipapi.co') {
    res.end(JSON.stringify({ ip: exit.ip, country_name: exit.country, country_code: exit.code, timezone: exit.timezone, latitude: exit.latitude, longitude: exit.longitude }));
  } else if (host === 'ipinfo.io') {
    res.end(JSON.stringify({ ip: exit.ip, country: exit.code, timezone: exit.timezone, loc: `${exit.latitude},${exit.longitude}` }));
  } else {
    // ipwho.is 的真实响应同时带 country 与 country_code；这里照抄，缺了代码
    // syncLanguage 会静默不生效（正是本脚本第一次跑出来的那个坑）
    res.end(JSON.stringify({ ip: exit.ip, success: true, country: exit.country, country_code: exit.code, timezone: { id: exit.timezone }, latitude: exit.latitude, longitude: exit.longitude }));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vg-ipfollow-')),
  headless: true,
  args: ['--ignore-certificate-errors', `--host-resolver-rules=${API_DOMAINS.map((domain) => `MAP ${domain} 127.0.0.1:${port}`).join(',')}`]
});
const cdp = await CDP.connect(chrome.websocketUrl);
await cdp.send('Extensions.loadUnpacked', { path: EXT });
await sleep(2600);

const { targetInfos } = await cdp.send('Target.getTargets');
const sw = targetInfos.find((item) => item.type === 'service_worker' && item.url.includes('/background/'));
if (!sw) throw new Error('没找到扩展的 service worker（先 npm run build）');
const extId = sw.url.split('/')[2];
console.log(`扩展 id: ${extId}（${EXT}）`);

// 借配置页做消息通道：它是扩展自己的页面，chrome.runtime 一定可用
const optionsTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` });
const { sessionId: opt } = await cdp.send('Target.attachToTarget', { targetId: optionsTarget.targetId, flatten: true });
await sleep(2000);

const call = (message) => evaluate(cdp, opt, `(async () => {
  const response = await chrome.runtime.sendMessage(${JSON.stringify(message)});
  if (!response) throw new Error('空响应');
  if (response.status === 'error') throw new Error(response.message);
  return JSON.stringify(response);
})()`, { awaitPromise: true }).then((json) => JSON.parse(json));

const nativeTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(`本机时区：${nativeTz}\n`);

// ---------- 1) 保护关闭：页面必须还是原生值 ----------

console.log('--- 1) 保护关掉时，检测站不该看到任何改动 ---');
const baseConfig = (await call({ action: 'getSiteConfig' })).config;
await call({ action: 'setSiteConfig', config: { ...baseConfig, masterEnabled: false } });
await sleep(600);
const nativeSnap = await snap('保护关闭');
record('保护关闭时页面读到本机时区', nativeSnap.tz === nativeTz, `${nativeSnap.tz}`);

// ---------- 2) 打开跟随，桩给日本 ----------

console.log('\n--- 2) 打开保护 + 白名单该站 + 打开跟随，出口在日本 ---');
const onConfig = (await call({ action: 'getSiteConfig' })).config;
onConfig.masterEnabled = true;
onConfig.ipSync = { enabled: true, syncLanguage: false, intervalMinutes: 5 };
onConfig.globalProfile.timezone = { mode: 'manual', timezone: nativeTz };
onConfig.globalProfile.geolocation = { mode: 'manual', latitude: 31.23, longitude: 121.47, accuracy: 50, country: 'China' };
onConfig.globalProfile.language = { language: 'zh-CN', languages: ['zh-CN', 'zh'], acceptLanguage: 'zh-CN,zh;q=0.9' };
await call({ action: 'setSiteConfig', config: onConfig });
await call({ action: 'addDomainRule', domain: new URL(SITE).hostname });
await sleep(800);
await call({ action: 'checkExitIpSync', force: true });
await sleep(800);
const japanSnap = await snap('出口日本');
record('时区跟着出口走到 Asia/Tokyo', japanSnap.tz === 'Asia/Tokyo', japanSnap.tz);
record('语言不跟着出口走（仍是 zh-CN）', japanSnap.lang === 'zh-CN', japanSnap.lang);

// ---------- 3) 换出口：桩改成美国 ----------

console.log('\n--- 3) 出口换成美国（同一个浏览器，不换网络）---');
exit.ip = '198.51.100.42';
exit.country = 'United States';
exit.code = 'US';
exit.timezone = 'America/Chicago';
exit.latitude = 41.85;
exit.longitude = -87.65;
hitCount = 0;
const usMerge = await call({ action: 'checkExitIpSync', force: true });
const usLayers = usMerge.outcome?.layers || [];
console.log(`同步结果：${JSON.stringify(usMerge.outcome)}`);
record('换出口后时区/坐标一起改', usLayers.includes('timezone') && usLayers.includes('geolocation'), usLayers.join(','));
record('只打一次归属地接口', hitCount === 1, `${hitCount} 次`);
await sleep(800);
const usSnap = await snap('出口美国');
record('页面读到 America/Chicago', usSnap.tz === 'America/Chicago', usSnap.tz);
record('时区偏移跟着走（UTC-5 / UTC-6）', Math.abs(usSnap.off) === 300 || Math.abs(usSnap.off) === 360, `${usSnap.off} 分钟`);

// ---------- 4) 同一个 IP 再同步一次 ----------

console.log('\n--- 4) IP 没变时再同步一次（不该重写配置）---');
const sameMerge = await call({ action: 'checkExitIpSync', force: true });
record('同一个 IP 判定为没变', sameMerge.outcome?.changed === false, JSON.stringify(sameMerge.outcome?.layers || []));

// ---------- 5) 打开「语言也跟随」 ----------

console.log('\n--- 5) 打开「语言也跟随」，强制重对齐 ---');
const withLang = (await call({ action: 'getSiteConfig' })).config;
withLang.ipSync = { enabled: true, syncLanguage: true, intervalMinutes: 5 };
await call({ action: 'setSiteConfig', config: withLang });
await sleep(600);
const langMerge = await call({ action: 'checkExitIpSync', force: true });
record('语言层被规划出来', (langMerge.outcome?.layers || []).includes('language'), JSON.stringify(langMerge.outcome?.layers || []));
await sleep(800);
const langSnap = await snap('语言跟随');
record('页面语言变成 en-US', langSnap.lang === 'en-US', langSnap.lang);
record('时区没被语言层带偏', langSnap.tz === 'America/Chicago', langSnap.tz);

// ---------- 汇总 ----------

const failed = checks.filter((item) => !item.ok);
console.log('\n================ 汇总 ================');
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (usSnap.panelTz) console.log(`检测站面板自己显示：${usSnap.panelTz}`);
else if (!OFFLINE) warn('没读到检测站面板的判定（站点改版或网络不通）；扩展侧断言照常有效，截图见 tools/out/');

await killChrome(chrome);
server.close();
process.exit(failed.length ? 1 : 0);

// ---------- 打开检测站、读它自己的判定 ----------

async function snap(label) {
  const target = await cdp.send('Target.createTarget', { url: SITE });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await sleep(4200);

  const loadFailed = await evaluate(cdp, sessionId, 'location.href.startsWith("chrome-error")');
  if (loadFailed) {
    warn(`打不开检测站 ${SITE}，跳过面板读数`);
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    return { tz: null, lang: null, off: null, panelTz: null, text: '' };
  }

  // 这个站是「点一下才检测」的纯本地实现
  await evaluate(cdp, sessionId, `(() => {
    const node = [...document.querySelectorAll('button, [role=button]')]
      .find((el) => (el.textContent || '').trim() === '开始检测');
    if (node) node.click();
    return Boolean(node);
  })()`);
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    const text = await evaluate(cdp, sessionId, 'document.body.innerText || ""');
    if (text.includes('时区') && !text.includes('检测中')) break;
  }

  const raw = await evaluate(cdp, sessionId, `JSON.stringify({
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    off: new Date().getTimezoneOffset(),
    text: document.body.innerText || '',
    panelTz: (() => {
      const token = /(?:America|Asia|Europe|Australia|Pacific|Africa)\\/[A-Za-z_]+/;
      // 说明文字里也提到 Asia/Shanghai，按「含 Intl/Claude/比对」排掉
      const nodes = [...document.querySelectorAll('span,div,p,code,b,strong')]
        .filter((el) => token.test(el.textContent || ''))
        .filter((el) => !/Intl|Claude|比对/.test(el.textContent || ''))
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      const hit = nodes[0] ? (nodes[0].textContent || '').match(token) : null;
      return hit ? hit[0] : null;
    })()
  })`);

  try {
    mkdirSync(OUT, { recursive: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, `ip-follow-${label}.png`), Buffer.from(shot.data, 'base64'));
  } catch (error) {
    warn(`截图失败：${error.message}`);
  }

  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  const result = JSON.parse(raw);
  console.log(`  [${label}] tz=${result.tz} lang=${result.lang} offset=${result.off} · 面板 tz=${result.panelTz || '未读到'}`);
  if (result.panelTz && result.panelTz !== result.tz) {
    warn(`检测站面板（${result.panelTz}）与页面读到的值（${result.tz}）不一致，可能是站点把多个信号混在一起显示了`);
  }
  return result;
}