#!/usr/bin/env node
/*
 * BFCache 恢复回归。
 *
 *   node tools/smoke-bfcache.mjs                 # 跑 dist
 *   node tools/smoke-bfcache.mjs --extension=... # 跑烘焙包
 *
 * 盯的是一个具体故障：页面进 BFCache 后内容脚本不会重新注入，payload 也不会自己
 * 再来一遍。冻结期间配置变了（改时区、排除站点），恢复后页面仍跑旧值，而弹窗照样
 * 显示"已生效"。桥现在在 `pageshow.persisted === true` 时按本 frame 重拉一次。
 *
 * 用例不会用假的 pageshow 事件充数：真导航 → 真 BFCache 恢复，页面自己记录
 * `event.persisted`，所以"恢复确实来自 BFCache"这件事是页面证实的，不是我们假设的。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join, resolve, sep } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep } from './lib/e2e.mjs';

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
    '.css': 'text/css; charset=utf-8'
  })[extname(file)] || 'application/octet-stream';
}

/** 文档请求实际带的 Accept-Language（用来验证"改语言后页面真的重新请求过"） */
const documentRequests = [];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(`${ROOT}${sep}`)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const body = await readFile(file);
    if (file.endsWith('.html')) {
      documentRequests.push({ path: url.pathname, acceptLanguage: String(req.headers['accept-language'] || '') });
    }
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
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-bfcache-')),
  headless: true,
  args: ['--lang=en-US', '--host-resolver-rules=MAP localhost 127.0.0.1']
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
await sleep(600);

async function send(message) {
  const response = await sendRuntimeMessage(cdp, options.sessionId, message);
  if (!response || response.status !== 'ok') throw new Error(`${message.action} 失败: ${JSON.stringify(response)}`);
  return response;
}

const base = (await send({ action: 'getSiteConfig' })).config;
const TOKYO_PROFILE = {
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
const LA_PROFILE = {
  ...TOKYO_PROFILE,
  language: {
    enabled: true,
    mode: 'preset',
    language: 'en-US',
    languages: ['en-US', 'en'],
    acceptLanguage: 'en-US,en;q=0.9'
  },
  timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' }
};

async function applyConfig({ profile, rules }) {
  await send({
    action: 'setSiteConfig',
    config: { ...base, masterEnabled: true, globalProfile: profile, rules }
  });
  await sleep(500);
}

async function probe(sessionId) {
  const raw = await evaluate(cdp, sessionId, 'JSON.stringify(window.__bfProbe ? window.__bfProbe() : null)', {});
  try { return JSON.parse(raw); } catch { return null; }
}

async function waitProbe(sessionId, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe(sessionId);
    if (last && predicate(last)) return last;
    await sleep(120);
  }
  return last;
}

const A_URL = `http://localhost:${port}/fixtures/bfcache/page.html`;
const B_URL = `http://localhost:${port}/fixtures/bfcache/other.html`;

const RULE_ON = [{ domain: 'localhost', enabled: true }];
const RULE_OFF = [{ domain: 'localhost', enabled: false }];

// 原生基线现场取：本机是 zh-CN / Asia/Shanghai，CI runner 上是 en-US / UTC。
// 把其中一个钉死，换台机器就变成假红。规则只覆盖 localhost，所以 127.0.0.1
// 同一个 fixture 读到的是原生值（Chrome 匹配模式里裸域名不生成 `*.` 通配）。
const nativeTab = await openPageStable(cdp, `http://127.0.0.1:${port}/fixtures/bfcache/page.html`);
const NATIVE = await waitProbe(nativeTab.sessionId, (value) => Boolean(value && value.timezone));

/** 走一遍 A → B → back，返回恢复时的探针值 */
async function cycle(label, mutate) {
  await applyConfig({ profile: TOKYO_PROFILE, rules: RULE_ON });
  const tab = await openPageStable(cdp, A_URL);
  const first = await waitProbe(tab.sessionId, (value) => value.page === 'A' && value.timezone === 'Asia/Tokyo');
  await cdp.send('Page.navigate', { url: B_URL }, tab.sessionId);
  await waitProbe(tab.sessionId, (value) => value.page === 'B' && value.timezone === 'Asia/Tokyo');
  const onB = mutate ? await mutate(tab) : null;
  await evaluate(cdp, tab.sessionId, 'history.back()', {});
  const restored = await waitProbe(tab.sessionId, (value) => value.page === 'A' && value.persisted !== null);
  return { first, onB, restored, sessionId: tab.sessionId };
}

// ---------- 场景 1：什么都不改，BFCache 必须真的生效 ----------
// 这一条同时是"监听器不会让页面失去 BFCache 资格"的证据：如果加了 pageshow 监听
// 或常开端口把页面挡在缓存外，persisted 就会是 false。
const s1 = await cycle('无变更', null);
check(
  '场景1 A 首屏被伪装（否则"恢复后还是旧值"没有意义）',
  Boolean(s1.first) && s1.first.language === 'ja-JP',
  JSON.stringify(s1.first)
);
check(
  '场景1 A 从 BFCache 恢复（页面自记 pageshow.persisted=true）',
  Boolean(s1.restored) && s1.restored.persisted === true && s1.restored.pageshow >= 2,
  JSON.stringify(s1.restored)
);
check(
  '场景1 恢复后值不变（配置没动，不该被重启或清掉）',
  Boolean(s1.restored) && s1.restored.timezone === 'Asia/Tokyo' && s1.restored.language === 'ja-JP',
  `${s1.restored && s1.restored.language}/${s1.restored && s1.restored.timezone}`
);

// ---------- 场景 2：冻结期间只改时区 → 恢复后必须是新值 ----------
const s2 = await cycle('只改时区', async (tab) => {
  await applyConfig({
    profile: { ...TOKYO_PROFILE, timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' } },
    rules: RULE_ON
  });
  return waitProbe(tab.sessionId, (value) => value.page === 'B' && value.timezone === 'America/Los_Angeles');
});

check(
  '场景2 前台页面 B 立刻拿到新时区（广播链路正常）',
  Boolean(s2.onB) && s2.onB.timezone === 'America/Los_Angeles',
  `${s2.onB && s2.onB.language}/${s2.onB && s2.onB.timezone}`
);
check(
  '场景2 A 仍然从 BFCache 恢复（改时区不把页面踢出缓存）',
  Boolean(s2.restored) && s2.restored.persisted === true,
  JSON.stringify(s2.restored)
);
const s2Values = await waitProbe(s2.sessionId,
  (value) => value.page === 'A' && value.timezone === 'America/Los_Angeles');
check(
  '场景2 恢复后读到新时区（不是冻结前的旧值）',
  Boolean(s2Values) && s2Values.timezone === 'America/Los_Angeles',
  `${s2Values && s2Values.language}/${s2Values && s2Values.timezone}`
);

// ---------- 场景 3：冻结期间排除站点 → 终态必须是原生值 ----------
await applyConfig({ profile: TOKYO_PROFILE, rules: RULE_ON });
const tab3 = await openPageStable(cdp, A_URL);
await waitProbe(tab3.sessionId, (value) => value.page === 'A' && value.timezone === 'Asia/Tokyo');
await cdp.send('Page.navigate', { url: B_URL }, tab3.sessionId);
await waitProbe(tab3.sessionId, (value) => value.page === 'B' && value.timezone === 'Asia/Tokyo');
await applyConfig({ profile: TOKYO_PROFILE, rules: RULE_OFF });
await sleep(400);
await evaluate(cdp, tab3.sessionId, 'history.back()', {});
const s3 = await waitProbe(tab3.sessionId,
  (value) => value.page === 'A' && value.timezone === NATIVE.timezone && value.language === NATIVE.language);
check(
  '场景3 冻结期间排除站点：回到 A 是原生值（clear 不被旧 payload 挡住）',
  Boolean(s3) && s3.timezone === NATIVE.timezone,
  `${s3 && s3.language}/${s3 && s3.timezone} persisted=${s3 && s3.persisted}`
);

// ---------- 场景4：改语言后前台页面必须真的重新加载 ----------
await applyConfig({ profile: TOKYO_PROFILE, rules: RULE_ON });
const tab5 = await openPageStable(cdp, A_URL);
await waitProbe(tab5.sessionId, (value) => value.page === 'A' && value.timezone === 'Asia/Tokyo');
await evaluate(cdp, tab5.sessionId, 'window.__marker = "alive"; "ok"', {});
const documentRequestsBefore = documentRequests.length;

// 只改时区：不该重载（请求头没动）
await applyConfig({
  profile: { ...TOKYO_PROFILE, timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' } },
  rules: RULE_ON
});
await sleep(600);
const markerAfterTimezone = await evaluate(cdp, tab5.sessionId, 'String(window.__marker)', {});
check(
  '场景4 只改时区：前台页面不被重载（请求头没变）',
  markerAfterTimezone === 'alive',
  markerAfterTimezone
);

// 改语言：页面必须重载，文档请求要带新的 Accept-Language
await applyConfig({ profile: LA_PROFILE, rules: RULE_ON });
let markerAfterLanguage = 'alive';
for (let attempt = 0; attempt < 40; attempt += 1) {
  markerAfterLanguage = await evaluate(cdp, tab5.sessionId, 'String(window.__marker)', {});
  if (markerAfterLanguage === 'undefined') break;
  await sleep(150);
}
check(
  '场景4 改语言：前台页面被重载（文档与 JS 值重新对齐）',
  markerAfterLanguage === 'undefined',
  markerAfterLanguage
);
const reloaded = await waitProbe(tab5.sessionId, (value) => value.page === 'A' && value.language === 'en-US');
check(
  '场景4 重载后页面读到新语言',
  Boolean(reloaded) && reloaded.language === 'en-US',
  `${reloaded && reloaded.language}`
);
check(
  '场景4 重新加载的文档请求带新 Accept-Language',
  documentRequests.length > documentRequestsBefore
    && documentRequests.at(-1).acceptLanguage.startsWith('en-US'),
  JSON.stringify(documentRequests.at(-1))
);

// 观察值（不作为断言）：改语言要重写 DNR 的 Accept-Language 头规则，而实测**任何一次
// 真正的 DNR 写入都会驱逐 BFCache 页面**（remove+add 同内容也算；updateSessionRules
// 首写同样）。终态仍然正确，但页面状态会丢。写进输出是为了下次有人动 header 规则时
// 一眼看到代价；完整矩阵见 tools/README.md 的 BFCache 一节。
await applyConfig({ profile: TOKYO_PROFILE, rules: RULE_ON });
const tab4 = await openPageStable(cdp, A_URL);
await waitProbe(tab4.sessionId, (value) => value.page === 'A' && value.timezone === 'Asia/Tokyo');
await cdp.send('Page.navigate', { url: B_URL }, tab4.sessionId);
await waitProbe(tab4.sessionId, (value) => value.page === 'B');
await applyConfig({ profile: LA_PROFILE, rules: RULE_ON });
await sleep(400);
await evaluate(cdp, tab4.sessionId, 'history.back()', {});
const observed = await waitProbe(tab4.sessionId, (value) => value.page === 'A' && value.persisted !== null);
console.log(`· 观察（不是断言）：冻结期间改语言（Accept-Language 头规则）→ 恢复时 persisted=${observed && observed.persisted}`);

cleanup();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exitCode = failed.length ? 1 : 0;
