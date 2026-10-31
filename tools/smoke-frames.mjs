#!/usr/bin/env node
/*
 * frame 级 payload 回归：
 *   1. 父域 localhost 和独立子域 child.localhost 各有一条规则；
 *   2. 父域规则删掉后，子域 iframe 不能被父页 payload 覆盖；
 *   3. 子域规则也删掉后，所有 frame 恢复原生。
 *
 * 这里跑的是烘焙构建（audit 会传 --extension=<persona ext>），所以同时覆盖
 * manifest 静态 content_scripts + 运行时动态注册两条路径。
 *
 * 前置：Chromium 系浏览器（Chrome 155 / Helium 156 都可以），
 *       fixture 跨域地址的端口会跟随当前页面，不依赖 8765。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join, resolve, sep } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep, waitFor } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const extensionPath = String(argv.extension || process.env.VANISHGEO_EXTENSION || 'dist');
if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  })[extname(file)] || 'application/octet-stream';
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/__native') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>native control</title></head><body>
        <script>
          window.__native = {
            language: navigator.language,
            languages: navigator.languages,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            offset: new Date().getTimezoneOffset()
          };
        </script></body></html>`);
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = normalize(join(ROOT, pathname));
    if (!file.startsWith(`${ROOT}${sep}`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': contentType(file) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-frames-')),
  headless: true,
  args: [
    '--lang=en-US',
    '--host-resolver-rules=MAP localhost 127.0.0.1, MAP child.localhost 127.0.0.1, MAP nonmatch.localhost 127.0.0.1'
  ]
});
const cdp = await CDP.connect(chrome.websocketUrl);
const extensionId = await loadExtension(cdp, extensionPath);
if (!extensionId) throw new Error('扩展没有返回 extension id');

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { cdp.close(); } catch { /* already closed */ }
  try { killChrome(chrome.child); } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
}
process.on('exit', cleanup);

const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
await sleep(800);

async function send(message) {
  const response = await sendRuntimeMessage(cdp, options.sessionId, message);
  if (!response || response.status !== 'ok') {
    throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
  }
  return response;
}

const base = (await send({ action: 'getSiteConfig' })).config;
const parentRule = { id: 'e2e-parent', domain: 'localhost', enabled: true };
const childRule = {
  id: 'e2e-child',
  domain: 'child.localhost',
  enabled: true,
  overrides: {
    language: {
      mode: 'override',
      value: {
        enabled: true,
        mode: 'preset',
        language: 'fr-FR',
        languages: ['fr-FR', 'fr'],
        acceptLanguage: 'fr-FR,fr;q=0.9'
      }
    },
    timezone: { mode: 'override', value: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' } },
    geolocation: { mode: 'disable', value: null }
  }
};
const globalProfile = {
  ...base.globalProfile,
  language: {
    enabled: true,
    mode: 'preset',
    language: 'ja-JP',
    languages: ['ja-JP', 'ja'],
    acceptLanguage: 'ja-JP,ja;q=0.9'
  },
  timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
  geolocation: { ...base.globalProfile.geolocation, enabled: false, mode: 'auto', latitude: null, longitude: null }
};

async function setRules(rules) {
  await send({
    action: 'setSiteConfig',
    config: { ...base, masterEnabled: true, globalProfile, rules }
  });
  await sleep(500);
}

const nativePage = await openPageStable(cdp, `http://127.0.0.1:${port}/__native`);
const native = await evaluate(cdp, nativePage.sessionId, 'window.__native');
check('拿到原生 control 基线', Boolean(native && native.language && native.timezone), JSON.stringify(native));

await setRules([parentRule, childRule]);
const topUrl = `http://localhost:${port}/fixtures/iframe/top.html`;
const page = await openPageStable(cdp, topUrl);

async function snapshot() {
  const raw = await evaluate(cdp, page.sessionId, `JSON.stringify({
    top: { language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    frames: window.__frameInfo
  })`);
  return JSON.parse(raw);
}

const same = (frame, expected) => frame
  && frame.language === expected.language
  && frame.timezone === expected.timezone;
const label = (frame) => frame ? `${frame.language}/${frame.timezone}` : 'missing';

function assertFrame(name, frame, expected, why) {
  check(`${name} ${why}`, same(frame, expected), `got=${label(frame)} want=${label(expected)}`);
}

// 首屏的 payload 是异步拉取的：子 frame 可能先上报一次原生值，等桥拿到
// 自己的 payload 后才改。必须等到目标状态，而不是只等“五个 frame 都上报”。
const initial = await waitFor(async () => {
  const snap = await snapshot();
  return Object.keys(snap.frames).length >= 5
    && snap.top.language === 'ja-JP'
    && snap.frames['allowlisted-child']?.language === 'fr-FR'
    // 下面断言的每个继承父页的 frame 都要等到：srcdoc 的首次拉取可能撞上浏览器还没登记
    // 这次导航而被拒、退避重试后才到，只等 about:blank 会在慢机器上抢先取快照
    && ['same-origin-child', 'srcdoc-child', 'aboutblank-child'].every((name) => snap.frames[name]?.language === 'ja-JP') ? snap : null;
}, { label: '首屏 frame payload 全部生效', timeout: 12000 });

assertFrame('顶层', initial.top, { language: 'ja-JP', timezone: 'Asia/Tokyo' }, '使用父域规则');
assertFrame('allowlisted iframe', initial.frames['allowlisted-child'], { language: 'fr-FR', timezone: 'Europe/Paris' }, '使用独立子域规则');
assertFrame('nonmatch iframe', initial.frames['nonmatch-child'], native, '保持原生');
assertFrame('same-origin iframe', initial.frames['same-origin-child'], { language: 'ja-JP', timezone: 'Asia/Tokyo' }, '继承父页');
assertFrame('srcdoc iframe', initial.frames['srcdoc-child'], { language: 'ja-JP', timezone: 'Asia/Tokyo' }, '继承父页');
assertFrame('about:blank iframe', initial.frames['aboutblank-child'], { language: 'ja-JP', timezone: 'Asia/Tokyo' }, '继承父页');

// 只保留子域规则：父页收到 clear，子域 iframe 自己重拉后仍然是 fr-FR。
await setRules([childRule]);
const childOnly = await waitFor(async () => {
  const snap = await snapshot();
  const opaque = ['same-origin-child', 'srcdoc-child', 'aboutblank-child'];
  return same(snap.top, native)
    && same(snap.frames['nonmatch-child'], native)
    && same(snap.frames['allowlisted-child'], { language: 'fr-FR', timezone: 'Europe/Paris' })
    && opaque.every((name) => same(snap.frames[name], native)) ? snap : null;
}, { label: '父页 clear、子域保持', timeout: 12000 });
assertFrame('父页', childOnly.top, native, '父域规则移除后恢复原生');
assertFrame('allowlisted iframe', childOnly.frames['allowlisted-child'], { language: 'fr-FR', timezone: 'Europe/Paris' }, '未被父页 clear 覆盖');
assertFrame('nonmatch iframe', childOnly.frames['nonmatch-child'], native, '保持原生');
assertFrame('same-origin iframe', childOnly.frames['same-origin-child'], native, '继承已恢复原生的父页');
assertFrame('srcdoc iframe', childOnly.frames['srcdoc-child'], native, '继承已恢复原生的父页');
assertFrame('about:blank iframe', childOnly.frames['aboutblank-child'], native, '继承已恢复原生的父页');

// 子域规则也删掉：每个 frame 都应回到原生。
await setRules([]);
const cleared = await waitFor(async () => {
  const snap = await snapshot();
  return Object.keys(snap.frames).length >= 5
    && same(snap.top, native)
    && Object.keys(snap.frames).every((name) => same(snap.frames[name], native)) ? snap : null;
}, { label: '全部 frame 恢复原生', timeout: 12000 });
assertFrame('顶层', cleared.top, native, '规则清空后恢复原生');
assertFrame('allowlisted iframe', cleared.frames['allowlisted-child'], native, '规则清空后恢复原生');
assertFrame('nonmatch iframe', cleared.frames['nonmatch-child'], native, '保持原生');
assertFrame('same-origin iframe', cleared.frames['same-origin-child'], native, '恢复原生');
assertFrame('srcdoc iframe', cleared.frames['srcdoc-child'], native, '恢复原生');
assertFrame('about:blank iframe', cleared.frames['aboutblank-child'], native, '恢复原生');

cleanup();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
