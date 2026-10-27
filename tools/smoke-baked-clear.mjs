#!/usr/bin/env node
/*
 * 烘焙包排除站点 / 关总开关 / frozen 的端到端回归。
 *
 *   bridge 包：配置里禁用规则或关总开关后，页面和请求头都要恢复原生；
 *              刷新后静态脚本会再次注入，桥必须再次 clear。
 *   frozen 包：改配置（排除 / 关总开关）不能让页面或请求头变化；
 *              刷新后仍是烘焙值。
 *
 * 用 fixture.localhost 作为烘焙域名，避免依赖真实站点；构建两个临时包：
 *   bridge  : 默认
 *   frozen  : --no-bridge
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
const configPath = join(ROOT, 'tools', 'fixtures', 'baked-clear-config.json');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'vanishgeo-baked-clear-'));
function buildVariant(name, extra = []) {
  const out = join(tempRoot, name);
  execFileSync(process.execPath, [
    join(ROOT, 'scripts', 'build-persona.mjs'),
    `--config=${configPath}`,
    `--out=${out}`,
    ...extra
  ], { cwd: ROOT, stdio: 'pipe' });
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://fixture.localhost');
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ acceptLanguage: req.headers['accept-language'] || '' }));
    return;
  }
  if (url.pathname === '/__native') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>native</title></head><body>
      <script>
        window.__native = {
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      </script></body></html>`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>baked clear probe</title></head><body>
    <p>fixture.localhost</p>
  </body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const pageUrl = `http://fixture.localhost:${port}/`;

let current = null;
function cleanup() {
  if (current) {
    try { current.cdp.close(); } catch { /* noop */ }
    try { killChrome(current.chrome.child); } catch { /* noop */ }
    current = null;
  }
  try { server.close(); } catch { /* noop */ }
  if (!argv.keep) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
process.on('exit', cleanup);

async function probe() {
  return evaluate(current.cdp, current.page.sessionId, `(async () => {
    const headers = await fetch('/echo').then((response) => response.json());
    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      acceptLanguage: headers.acceptLanguage || ''
    };
  })()`, { awaitPromise: true });
}

const same = (value, expected) => value
  && value.language === expected.language
  && value.timezone === expected.timezone;
const label = (value) => value ? `${value.language}/${value.timezone}/${value.acceptLanguage}` : 'missing';

async function runVariant(extensionPath, { frozen }) {
  if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
  const chrome = await launchChrome({
    userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-baked-clear-browser-')),
    headless: true,
    args: [
      '--lang=en-US',
      `--host-resolver-rules=MAP fixture.localhost 127.0.0.1`
    ]
  });
  const cdp = await CDP.connect(chrome.websocketUrl);
  current = { cdp, chrome, page: null };
  const extensionId = await loadExtension(cdp, extensionPath);
    if (!extensionId) throw new Error('扩展没有返回 extension id');

  const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
  await sleep(600);
  async function send(message) {
    const response = await sendRuntimeMessage(cdp, options.sessionId, message);
    if (!response || response.status !== 'ok') throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
    return response;
  }
  const nativePage = await openPageStable(cdp, `http://127.0.0.1:${port}/__native`);
  const native = await evaluate(cdp, nativePage.sessionId, 'window.__native');
  const nativeHeader = await evaluate(cdp, nativePage.sessionId, `fetch('/echo').then((response) => response.json()).then((value) => value.acceptLanguage || '')`, { awaitPromise: true });
  check(`${frozen ? 'frozen' : 'bridge'} 拿到原生基线`, Boolean(native), `${native.language}/${native.timezone}/${nativeHeader}`);

  const base = (await send({ action: 'getSiteConfig' })).config;
  async function setConfig(mutator) {
    const next = mutator(structuredClone(base));
    await send({ action: 'setSiteConfig', config: next });
    await sleep(700);
  }
  const setRuleEnabled = (config, enabled) => ({
    ...config,
    rules: config.rules.map((rule) => ({ ...rule, enabled }))
  });

  const page = await openPageStable(cdp, pageUrl);
  current.page = page;
  const initial = await waitFor(async () => {
    const value = await probe();
    return value.language === 'ja-JP' && value.timezone === 'Asia/Tokyo' ? value : null;
  }, { label: '烘焙值首屏生效', timeout: 10000 });
  check(`${frozen ? 'frozen' : 'bridge'} 初始页面是烘焙值`, same(initial, { language: 'ja-JP', timezone: 'Asia/Tokyo' }), label(initial));
  check(`${frozen ? 'frozen' : 'bridge'} 初始请求头是烘焙语言`, initial.acceptLanguage.startsWith('ja-JP'), initial.acceptLanguage);

  await setConfig((config) => setRuleEnabled(config, false));
  if (frozen) {
    await sleep(1200);
    const value = await probe();
    check('frozen 排除站点后页面仍是烘焙值', same(value, { language: 'ja-JP', timezone: 'Asia/Tokyo' }), label(value));
    check('frozen 排除站点后请求头仍是烘焙语言', value.acceptLanguage.startsWith('ja-JP'), value.acceptLanguage);
  } else {
    const value = await waitFor(async () => {
      const candidate = await probe();
      return same(candidate, native) ? candidate : null;
    }, { label: '排除站点后恢复原生', timeout: 10000 });
    check('bridge 排除站点后页面恢复原生', same(value, native), label(value));
    check('bridge 排除站点后请求头恢复原生', value.acceptLanguage === nativeHeader || value.acceptLanguage.startsWith(native.language), `${value.acceptLanguage} vs ${nativeHeader}`);
  }

  await setConfig((config) => setRuleEnabled(config, true));
  if (frozen) {
    await sleep(1000);
    const value = await probe();
    check('frozen 恢复规则后仍是烘焙值', same(value, { language: 'ja-JP', timezone: 'Asia/Tokyo' }), label(value));
  } else {
    const value = await waitFor(async () => {
      const candidate = await probe();
      return same(candidate, { language: 'ja-JP', timezone: 'Asia/Tokyo' }) && candidate.acceptLanguage.startsWith('ja-JP') ? candidate : null;
    }, { label: '恢复规则后重新伪装', timeout: 10000 });
    check('bridge 恢复规则后重新伪装', same(value, { language: 'ja-JP', timezone: 'Asia/Tokyo' }), label(value));
    check('bridge 恢复规则后请求头恢复烘焙语言', value.acceptLanguage.startsWith('ja-JP'), value.acceptLanguage);
  }

  await setConfig((config) => ({ ...config, masterEnabled: false }));
  if (frozen) {
    await sleep(1200);
    const value = await probe();
    check('frozen 关总开关后页面仍是烘焙值', same(value, { language: 'ja-JP', timezone: 'Asia/Tokyo' }), label(value));
    check('frozen 关总开关后请求头仍是烘焙语言', value.acceptLanguage.startsWith('ja-JP'), value.acceptLanguage);
  } else {
    const value = await waitFor(async () => {
      const candidate = await probe();
      return same(candidate, native) ? candidate : null;
    }, { label: '关总开关后恢复原生', timeout: 10000 });
    check('bridge 关总开关后页面恢复原生', same(value, native), label(value));
    check('bridge 关总开关后请求头恢复原生', value.acceptLanguage === nativeHeader || value.acceptLanguage.startsWith(native.language), `${value.acceptLanguage} vs ${nativeHeader}`);
  }

  // 刷新：bridge 必须再次 clear；frozen 必须再次拿到静态烘焙值。
  await cdp.send('Page.reload', {}, page.sessionId);
  await sleep(1200);
  const reloaded = await waitFor(async () => {
    const value = await probe();
    if (frozen) return same(value, { language: 'ja-JP', timezone: 'Asia/Tokyo' }) ? value : null;
    return same(value, native) ? value : null;
  }, { label: frozen ? 'frozen 刷新后仍是烘焙值' : 'bridge 刷新后仍恢复原生', timeout: 12000 });
  check(`${frozen ? 'frozen' : 'bridge'} 刷新后状态正确`, frozen ? same(reloaded, { language: 'ja-JP', timezone: 'Asia/Tokyo' }) : same(reloaded, native), label(reloaded));
  check(`${frozen ? 'frozen' : 'bridge'} 刷新后请求头一致`, frozen ? reloaded.acceptLanguage.startsWith('ja-JP') : (reloaded.acceptLanguage === nativeHeader || reloaded.acceptLanguage.startsWith(native.language)), `${reloaded.acceptLanguage} vs ${frozen ? 'ja-JP' : nativeHeader}`);

  cdp.close();
  killChrome(chrome.child);
  current = null;
}

const bridgeExtension = argv['bridge-extension'] ? String(argv['bridge-extension']) : buildVariant('bridge');
const frozenExtension = argv['frozen-extension'] ? String(argv['frozen-extension']) : buildVariant('frozen', ['--no-bridge']);
await runVariant(bridgeExtension, { frozen: false });
await runVariant(frozenExtension, { frozen: true });

cleanup();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
