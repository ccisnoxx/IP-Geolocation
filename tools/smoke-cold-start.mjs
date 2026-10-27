#!/usr/bin/env node
/*
 * 冷启动 + clear 浏览器 smoke。
 *
 * 全新 profile 加载扩展后立刻打开第一个页面，验证：
 *   1. 首个导航就能拿到烘焙值（不依赖 SW 预热）
 *   2. 从选项页关总开关后，冷启动页面能收到 clear 并恢复原生
 *   3. 重新开启后恢复烘焙值，刷新后仍正确
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'vanishgeo-cold-start-'));
const extensionPath = join(tempRoot, 'ext');
execFileSync(process.execPath, [
  join(ROOT, 'scripts', 'build-persona.mjs'),
  `--config=${join(ROOT, 'tools', 'fixtures', 'baked-clear-config.json')}`,
  `--out=${extensionPath}`
], { cwd: ROOT, stdio: 'pipe' });

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://fixture.localhost');
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ acceptLanguage: req.headers['accept-language'] || '' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta charset="utf-8"><title>cold start</title></head><body>cold start</body></html>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-cold-start-browser-')),
  headless: true,
  args: [
    '--lang=en-US',
    `--host-resolver-rules=MAP fixture.localhost 127.0.0.1, MAP native.localhost 127.0.0.1`
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp.close(); } catch { /* noop */ }
  try { killChrome(chrome.child); } catch { /* noop */ }
  await new Promise((done) => server.close(done));
  if (!argv.keep) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
process.on('exit', () => { try { killChrome(chrome.child); } catch { /* noop */ } });

try {
  const extensionId = await loadExtension(cdp, extensionPath);
  if (!extensionId) throw new Error('扩展没有返回 extension id');

  // 先取原生基线（host 不在规则里，不会注入烘焙脚本）
  const nativePage = await openPageStable(cdp, `http://native.localhost:${port}/`);
  const native = await evaluate(cdp, nativePage.sessionId, `(async () => {
    const headers = await fetch('/echo').then((response) => response.json());
    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      acceptLanguage: headers.acceptLanguage || ''
    };
  })()`, { awaitPromise: true });

  // 冷启动后的第一个规则内导航：不预热 SW，直接打开目标页
  const page = await openPageStable(cdp, `http://fixture.localhost:${port}/`);
  const baked = await evaluate(cdp, page.sessionId, `(async () => {
    const headers = await fetch('/echo').then((response) => response.json());
    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      acceptLanguage: headers.acceptLanguage || ''
    };
  })()`, { awaitPromise: true });
  check('冷启动首屏拿到烘焙语言', baked.language === 'ja-JP', baked.language);
  check('冷启动首屏拿到烘焙时区', baked.timezone === 'Asia/Tokyo', baked.timezone);
  check('冷启动首屏请求头一致', baked.acceptLanguage.startsWith('ja-JP'), baked.acceptLanguage);

  const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
  const config = (await sendRuntimeMessage(cdp, options.sessionId, { action: 'getSiteConfig' })).config;
  await sendRuntimeMessage(cdp, options.sessionId, { action: 'setSiteConfig', config: { ...config, masterEnabled: false } });
  await sleep(300);
  const cleared = await evaluate(cdp, page.sessionId, `({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`);
  check('关总开关后冷启动页面恢复原生', cleared.language === native.language && cleared.timezone === native.timezone, `${cleared.language}/${cleared.timezone} vs ${native.language}/${native.timezone}`);

  await sendRuntimeMessage(cdp, options.sessionId, { action: 'setSiteConfig', config: { ...config, masterEnabled: true } });
  await sleep(300);
  const restored = await evaluate(cdp, page.sessionId, `({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`);
  check('重新开启后恢复烘焙值', restored.language === 'ja-JP' && restored.timezone === 'Asia/Tokyo', `${restored.language}/${restored.timezone}`);

  await cdp.send('Page.reload', {}, page.sessionId);
  await sleep(500);
  const reloaded = await evaluate(cdp, page.sessionId, `({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`);
  check('刷新后仍保持烘焙值', reloaded.language === 'ja-JP' && reloaded.timezone === 'Asia/Tokyo', `${reloaded.language}/${reloaded.timezone}`);
} catch (error) {
  check('冷启动 / clear 流程', false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed ? 1 : 0;
