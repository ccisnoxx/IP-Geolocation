#!/usr/bin/env node
/*
 * 用户脚本模式（首屏即生效）的浏览器 smoke：普通构建 dist + 「允许用户脚本」。
 *
 *   1. 开关打开后进入用户脚本模式；新打开的页面第一个内联脚本就读到目标时区 / 语言
 *   2. 不刷新改配置：内容脚本那份注入层把配置转发给用户脚本那份，页面热更新；关总开关回到原生
 *   3. srcdoc 子框架（用户脚本注入不到）仍由内容脚本那份负责
 *   4. 开关关掉：状态回到内容脚本模式，新页面照常伪装（首屏有异步窗口），不会裸奔
 *   5. 开关再打开：恢复首屏即生效
 *   6. 页面在 <head> 里伪造认领（开关开 / 关两种情况）：伪造的端口收不到任何配置，页面照常伪装
 *
 * Chrome 120 起才有 chrome.userScripts；更老的引擎只检查"状态为 unsupported 且照常伪装"。
 * 自动化里用 chrome://extensions 自带的 developerPrivate 拨开关，真实用户在扩展详情页手动打开。
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep, waitFor } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const extensionPath = resolve(String(argv.extension || join(ROOT, 'dist')));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script>
window.__early = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language, offset: new Date().getTimezoneOffset() };
window.__frames = {};
window.__forged = null;
if (location.search.includes('forge')) {
  const channel = new MessageChannel();
  window.__forged = 0;
  channel.port1.onmessage = () => { window.__forged++; };
  dispatchEvent(new MessageEvent('vanishgeo:runtime-claim', { data: { token: 'forged-token-0000000000' }, ports: [channel.port2] }));
}
addEventListener('message', (event) => { if (event.data && event.data.kind) window.__frames[event.data.kind] = event.data; });
</script></head><body>
<iframe srcdoc="<script>setInterval(() => parent.postMessage({ kind: 'srcdoc', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language }, '*'), 50)<\/script>"></iframe>
</body></html>`;
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const pageUrl = (query = '') => `http://fixture.localhost:${port}/${query}`;
const READ = `({
  early: window.__early,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  lang: navigator.language,
  offset: new Date().getTimezoneOffset(),
  srcdoc: window.__frames.srcdoc || null,
  forged: window.__forged,
  toStringNative: Function.prototype.toString.call(Date.prototype.getTimezoneOffset) === 'function getTimezoneOffset() { [native code] }'
})`;

if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-userscripts-')),
  headless: true,
  args: ['--lang=en-US', '--host-resolver-rules=MAP fixture.localhost 127.0.0.1']
});
const cdp = await CDP.connect(chrome.websocketUrl);
const cleanup = () => {
  try { cdp.close(); } catch { /* noop */ }
  try { killChrome(chrome.child); } catch { /* noop */ }
  try { server.close(); } catch { /* noop */ }
};

try {
  const extensionId = await loadExtension(cdp, extensionPath);
  const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
  await sleep(800);
  const send = async (message) => {
    const response = await sendRuntimeMessage(cdp, options.sessionId, message);
    if (!response || response.status !== 'ok') throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
    return response;
  };
  const native = await evaluate(cdp, options.sessionId, `({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language })`);
  const base = (await send({ action: 'getSiteConfig' })).config;
  const configWith = (timezone, masterEnabled = true) => ({
    ...base,
    masterEnabled,
    globalProfile: {
      ...base.globalProfile,
      language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone },
      geolocation: { ...base.globalProfile.geolocation, enabled: false }
    },
    rules: [...base.rules.filter((rule) => rule.domain !== 'fixture.localhost'), { id: 'smoke-us', domain: 'fixture.localhost', enabled: true }]
  });
  await send({ action: 'setSiteConfig', config: configWith('America/Los_Angeles') });
  const status = async () => (await send({ action: 'getFirstScreenStatus' })).state;

  const initial = await status();
  if (initial.mode === 'unsupported') {
    check('Chrome 120 以下报告 unsupported', initial.chromeMajor < 120, JSON.stringify(initial));
    const page = await openPageStable(cdp, pageUrl());
    const state = await waitFor(async () => {
      const value = await evaluate(cdp, page.sessionId, READ);
      return value.tz === 'America/Los_Angeles' ? value : null;
    }, { label: '老引擎照常伪装' });
    check('老引擎照常伪装（内容脚本模式）', state.tz === 'America/Los_Angeles' && state.lang === 'ja-JP', JSON.stringify(state));
  } else {
    check('开关未开时报告内容脚本模式', initial.mode === 'contentScripts', JSON.stringify(initial));

    const extensionsPage = await openPageStable(cdp, 'chrome://extensions/');
    const toggle = (on) => evaluate(cdp, extensionsPage.sessionId, `new Promise((resolve) => chrome.developerPrivate.updateExtensionConfiguration(
      { extensionId: ${JSON.stringify(extensionId)}, userScriptsAccess: ${on} },
      () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok')))`, { awaitPromise: true });

    check('打开「允许用户脚本」', (await toggle(true)) === 'ok');
    const on = await status();
    check('开关打开后进入用户脚本模式', on.mode === 'userScripts', JSON.stringify(on));

    const page = await openPageStable(cdp, pageUrl('?round=1&forge=1'));
    const first = await waitFor(async () => {
      const value = await evaluate(cdp, page.sessionId, READ);
      return value.srcdoc && value.srcdoc.tz === 'America/Los_Angeles' ? value : null;
    }, { label: '用户脚本模式页面就绪' });
    check('首屏：第一个内联脚本就读到目标时区与语言', first.early.tz === 'America/Los_Angeles' && first.early.lang === 'ja-JP', JSON.stringify(first.early));
    check('页面加载后仍是目标值', first.tz === 'America/Los_Angeles' && first.lang === 'ja-JP', `${first.tz} / ${first.lang}`);
    check('补丁函数仍显示为原生（没有被叠两层伪装）', first.toStringNative === true);
    check('srcdoc 子框架由内容脚本那份负责，同样是目标值', first.srcdoc.tz === 'America/Los_Angeles' && first.srcdoc.lang === 'ja-JP', JSON.stringify(first.srcdoc));
    await sleep(300);
    check('开关开：页面伪造的认领拿不到配置', (await evaluate(cdp, page.sessionId, READ)).forged === 0);

    await send({ action: 'setSiteConfig', config: configWith('Asia/Tokyo') });
    const live = await waitFor(async () => {
      const value = await evaluate(cdp, page.sessionId, READ);
      return value.tz === 'Asia/Tokyo' && value.offset === -540 ? value : null;
    }, { label: '热更新到东京', timeout: 10000 }).catch(() => null);
    check('不刷新改配置：经内容脚本那份转发，用户脚本那份热更新', Boolean(live), live ? `${live.tz} / ${live.offset}` : '没有更新');

    await send({ action: 'setSiteConfig', config: configWith('Asia/Tokyo', false) });
    const cleared = await waitFor(async () => {
      const value = await evaluate(cdp, page.sessionId, READ);
      return value.tz === native.tz && value.lang === native.lang ? value : null;
    }, { label: '关总开关回到原生', timeout: 10000 }).catch(() => null);
    check('关总开关：同一页面回到原生值', Boolean(cleared), cleared ? `${cleared.tz} / ${cleared.lang}` : '仍是伪装值');
    await send({ action: 'setSiteConfig', config: configWith('America/Los_Angeles') });

    check('关闭「允许用户脚本」', (await toggle(false)) === 'ok');
    const off = await status();
    check('开关关掉后回到内容脚本模式', off.mode === 'contentScripts', JSON.stringify(off));
    const fallbackPage = await openPageStable(cdp, pageUrl('?round=2&forge=1'));
    const fallback = await waitFor(async () => {
      const value = await evaluate(cdp, fallbackPage.sessionId, READ);
      return value.tz === 'America/Los_Angeles' ? value : null;
    }, { label: '开关关掉后的新页面' }).catch(() => null);
    check('开关关掉后新页面照常伪装（不裸奔）', Boolean(fallback) && fallback.lang === 'ja-JP', fallback ? `${fallback.tz} / ${fallback.lang}` : '没有伪装');
    check('开关关掉后首屏回到异步窗口（与普通模式一致）', Boolean(fallback) && fallback.early.tz === native.tz, fallback ? JSON.stringify(fallback.early) : '');
    check('开关关：页面抢先伪造认领，口令对不上，内容脚本那份自己应用、伪造端口收不到配置', Boolean(fallback) && fallback.forged === 0, fallback ? String(fallback.forged) : '');

    check('重新打开「允许用户脚本」', (await toggle(true)) === 'ok');
    const again = await status();
    check('重新打开后恢复用户脚本模式', again.mode === 'userScripts', JSON.stringify(again));
    const third = await openPageStable(cdp, pageUrl('?round=3'));
    await sleep(500);
    const thirdState = await evaluate(cdp, third.sessionId, READ);
    check('重新打开后新页面首屏即生效', thirdState.early.tz === 'America/Los_Angeles', JSON.stringify(thirdState.early));
  }
} catch (error) {
  check('smoke 运行', false, error instanceof Error ? error.message : String(error));
} finally {
  cleanup();
}

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
