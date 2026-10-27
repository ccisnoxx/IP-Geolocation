#!/usr/bin/env node
/*
 * 真实站点一致性验证：打开真实注册页，核对「页面看到的值」是否跟着代理出口 IP。
 *
 *   node tools/smoke-real-site.mjs                                  # https://claude.ai/signup
 *   node tools/smoke-real-site.mjs --url=https://claude.ai/login
 *   CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" node tools/smoke-real-site.mjs
 *
 * 不映射域名、不改 DNS —— 走的就是本机当前的出口（代理/TUN）。判定三件事：
 *   1. 页面时区 == 出口 IP 的时区（真实跟随，不是本地机器时区）
 *   2. 页面语言 / Intl locale / 请求头 Accept-Language 三者一致
 *   3. 页面真的渲染出来了（不是 ERR_ABORTED、不是空白）
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP, evaluate, launchChrome, sleep , killChrome } from './lib/cdp.mjs';
import { lookupExit as lookupExitShared } from './lib/exit.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const persona = String(argv.persona || 'us-la-1');
const personaFile = join(homedir(), '.vanishgeo', 'personas', `${persona}.json`);
const personaConfig = existsSync(personaFile) ? JSON.parse(readFileSync(personaFile, 'utf8')) : {};
const extensionPath = argv.extension
  ? String(argv.extension)
  : join(homedir(), '.vanishgeo', 'profiles', persona, 'ext');
const url = String(argv.url || 'https://claude.ai/signup');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

function skip(name, detail) {
  results.push({ name, ok: true, skipped: true });
  console.log(`⚠ ${name}  ${detail || ''}`);
}

async function lookupExit() {
  // 支持由 audit 统一查一次再传进来，避免多组检查把接口打到限流
  const injected = process.env.VANISHGEO_EXIT_JSON;
  if (injected) {
    try { return JSON.parse(injected); } catch { /* 落回实时查询 */ }
  }
  return lookupExitShared();
}
const exitInfo = await lookupExit();

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-real-')),
  headless: false,
  args: ['--window-size=1512,900'],
  env: {} // 不传 TZ：让扩展自己负责时区，测的才是"扩展起没起作用"
});
const cdp = await CDP.connect(chrome.websocketUrl);
// 统一用 CDP 装载（Chrome 155 已忽略 --load-extension，Helium 两者都行），并等它真的起来
await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
for (let index = 0; index < 40; index += 1) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  if (targetInfos.some((item) => item.url.includes('/background/service-worker.js'))) break;
  await sleep(250);
}
const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Network.enable', {}, sessionId);

// 抓主文档真实发出的请求头（扩展的 DNR 规则是在网络层生效的，这里能看到最终值）
const documentHeaders = [];
cdp.on((message) => {
  if (message.method === 'Page.javascriptDialogOpening') {
    cdp.send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(() => {});
  }
  if (message.method === 'Network.requestWillBeSentExtraInfo') {
    const headers = message.params.headers || {};
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (lower['accept-language'] && lower['user-agent'] && !lower['sec-fetch-dest']) return;
    if (lower['accept-language']) documentHeaders.push(lower);
  }
});

// 首次连接经代理偶发被重置，重试一次即可（CPD timeout 也会触发重试）
let nav = null;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    nav = await cdp.send('Page.navigate', { url }, sessionId);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await sleep(1500);
  }
}
// 等页面真的画出内容（SPA 首屏可能要几秒；最多等 20s）
let rendered = null;
for (let index = 0; index < 15; index += 1) {
  await sleep(1000);
  try {
    rendered = await evaluate(cdp, sessionId, `(() => ({
      ready: document.readyState,
      text: document.body ? document.body.textContent.trim().length : 0,
      children: document.body ? document.body.children.length : 0
    }))()`);
    if (rendered.ready === 'complete' && (rendered.text > 0 || rendered.children > 0)) break;
  } catch {
    // 页面切换执行上下文/主线程被长任务占住时会超时，继续等下一轮
    rendered = null;
  }
}
if (process.env.DEBUG) console.log('DEBUG rendered:', JSON.stringify(rendered));

const page = await evaluate(cdp, sessionId, `(async () => {
  const intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Date().getTimezoneOffset();
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyLength: document.body ? document.body.textContent.trim().length : 0,
    bodyText: document.body ? document.body.innerText.trim().length : 0,
    htmlLang: document.documentElement.lang || null,
    nav: navigator.language,
    navs: navigator.languages,
    intlLocale,
    tz,
    offset,
    localeDate: new Date(0).toLocaleDateString(),
    intlDate: new Intl.DateTimeFormat().format(new Date(0)),
    htmlChildren: document.body ? document.body.children.length : 0
  };
})()`, { awaitPromise: true });

const header = documentHeaders[documentHeaders.length - 1] || null;
const ipTz = exitInfo && exitInfo.tz;
// 期望偏移直接从出口 IP 的 IANA 时区名算（不依赖接口有没有给 utc_offset）
function offsetMinutesFor(timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((item) => item.type === 'timeZoneName');
    const match = String(part && part.value).match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return timeZone === 'UTC' ? 0 : null;
    const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === '+' ? -minutes : minutes; // 与 getTimezoneOffset 同号：西为正
  } catch {
    return null;
  }
}
const ipOffsetMinutes = ipTz ? offsetMinutesFor(ipTz) : null;

console.log(`\n目标    ${url}`);
console.log(`出口    ${exitInfo ? `${exitInfo.ip} · ${exitInfo.country} · ${exitInfo.city} · ${ipTz} ` : '查询失败（三个接口都没通）'}`);
console.log(`页面    tz=${page.tz} offset=${page.offset} nav=${page.nav} Intl=${page.intlLocale} html-lang=${page.htmlLang}`);
console.log(`请求头  Accept-Language=${header ? header['accept-language'] : '(未抓到)'}\n`);

check('站点文档已就位（不是错误页/空白）', Boolean(page.title) && !nav.errorText && page.htmlChildren > 0,
  nav.errorText ? String(nav.errorText) : `title="${String(page.title).slice(0, 40)}" readyState=${page.readyState} 文本=${page.bodyLength}字(可见=${page.bodyText})/children=${page.htmlChildren}`);
if (ipTz) {
  check('页面时区 == 出口 IP 时区（跟随代理）', page.tz === ipTz, `页面 ${page.tz} vs IP ${ipTz}`);
  check('UTC 偏移与出口 IP 一致', ipOffsetMinutes !== null && page.offset === ipOffsetMinutes, `页面 ${page.offset} vs IP ${ipOffsetMinutes}`);
} else {
  skip('页面时区 == 出口 IP 时区', `出口时区未知（${exitInfo ? exitInfo.source : '全部接口失败'}），仅核对国家`);
}
check('时区不是本机默认值（扩展确实改写了）', page.tz !== 'Asia/Shanghai', page.tz);
check('navigator.language / Intl locale 一致', page.nav === page.intlLocale, `${page.nav} / ${page.intlLocale}`);
check('toLocaleDateString 与 Intl 同源', page.localeDate === page.intlDate, `${page.localeDate} vs ${page.intlDate}`);
check('请求头 Accept-Language 与 navigator.language 一致',
  Boolean(header) && String(header['accept-language']).toLowerCase().startsWith(String(page.nav).toLowerCase()),
  header ? `${header['accept-language']} vs nav=${page.nav}` : '未抓到请求头');
if (personaConfig.locale) {
  check(`与 persona 语言一致（${personaConfig.locale}）`, page.nav === personaConfig.locale, page.nav);
}

cdp.close();
killChrome(chrome.child);

const failed = results.filter((item) => !item.ok && !item.skipped);
const counted = results.filter((item) => !item.skipped);
console.log(`\n${counted.length - failed.length}/${counted.length} 通过${results.length - counted.length ? `（${results.length - counted.length} 项跳过）` : ''}`);
setTimeout(() => process.exit(failed.length ? 1 : 0), 400);