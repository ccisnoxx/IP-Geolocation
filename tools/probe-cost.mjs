#!/usr/bin/env node
/*
 * blob 探测的开销测量（不是断言型冒烟，输出数字）。
 *
 *   node tools/probe-cost.mjs                 # 30 个 iframe
 *   node tools/probe-cost.mjs --frames=60     # 60 个 iframe
 *   node tools/probe-cost.mjs --skip-csp      # 只测每文档探测数 / 首屏影响
 *
 * 三个问题：
 *   1. 每个文档到底开几个探测 Worker？          → CDP 的 worker target 事件计数
 *   2. 探测对首屏有多大影响？                  → 同一构建把探测短路后对比 navigation duration
 *   3. CSP 站点上"Worker 还没被包装"的窗口多长？ → 子页面自己记录全局被替换的时刻
 */
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { openPageStable, sendRuntimeMessage, sleep } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value === undefined ? true : value];
  })
);
const FRAMES = Number(argv.frames || 30);

const farm = `<!doctype html><meta charset="utf-8"><title>farm</title><body><script>
for (let i = 0; i < ${FRAMES}; i += 1) {
  const frame = document.createElement('iframe');
  frame.src = '/child.html?i=' + i;
  document.body.appendChild(frame);
}
</script></body>`;

/** 子页面的 CSP：测"每文档探测数"时必须为空（被拦的探测不产生 worker target） */
let childCsp = '';
const child = `<!doctype html><meta charset="utf-8"><title>child</title><body><script>
window.__ref = window.Worker;
window.__violations = 0;
document.addEventListener('securitypolicyviolation', () => { window.__violations += 1; });
const started = performance.now();
const timer = setInterval(() => {
  if (window.Worker !== window.__ref) {
    window.__swapMs = +(performance.now() - started).toFixed(1);
    clearInterval(timer);
  }
}, 0);
</script></body>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/child.html') {
    const headers = { 'content-type': 'text/html' };
    if (childCsp) headers['content-security-policy'] = childCsp;
    res.writeHead(200, headers);
    res.end(child);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(farm);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://localhost:${server.address().port}`;

/** 复制 dist 并把 blob 探测整段删掉，作为"无探测"对照组 */
function buildNoProbeCopy() {
  const target = mkdtempSync(join(tmpdir(), 'vanishgeo-noprobe-'));
  cpSync(join(ROOT, 'dist'), target, { recursive: true });
  const file = join(target, 'injected/runtime.js');
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('      try {\n        const probeUrl = URL.createObjectURL');
  const marker = '        blobWorkerBlocked = true;\n      }\n';
  const end = source.indexOf(marker, start);
  if (start < 0 || end < 0) throw new Error('找不到探测代码，构建产物结构变了');
  writeFileSync(file, source.slice(0, start) + source.slice(end + marker.length));
  return target;
}

async function measure(mode) {
  const profile = mkdtempSync(join(tmpdir(), `probe-${mode}-`));
  const chrome = await launchChrome({ userDataDir: profile, headless: true });
  const cdp = await CDP.connect(chrome.websocketUrl);
  const workers = new Map();
  let navAt = 0;
  cdp.on((message) => {
    const info = message.method === 'Target.targetCreated'
      ? message.params.targetInfo
      : message.method === 'Target.attachedToTarget' ? message.params.targetInfo : null;
    if (info && info.type === 'worker' && String(info.url).startsWith('blob:') && navAt) {
      workers.set(info.targetId, Date.now() - navAt);
    }
  });
  await cdp.send('Target.setDiscoverTargets', { discover: true });

  if (mode !== 'native') {
    const extensionPath = mode === 'noprobe' ? buildNoProbeCopy() : join(ROOT, 'dist');
    const id = await loadExtension(cdp, extensionPath);
    const options = await openPageStable(cdp, `chrome-extension://${id}/options/options.html`);
    const base = (await sendRuntimeMessage(cdp, options.sessionId, { action: 'getSiteConfig' })).config;
    await sendRuntimeMessage(cdp, options.sessionId, {
      action: 'setSiteConfig',
      config: {
        ...base,
        masterEnabled: true,
        globalProfile: {
          ...base.globalProfile,
          language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' }
        },
        rules: [{ id: 'probe-cost', domain: 'localhost', enabled: true }]
      }
    });
    await sleep(1200);
  }

  const page = await openPageStable(cdp, 'about:blank');
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page.sessionId)
    .catch(() => {});
  await sleep(200);
  workers.clear();
  navAt = Date.now();
  await cdp.send('Page.navigate', { url: `${origin}/farm.html` }, page.sessionId);
  await sleep(2600);

  const raw = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      frames: document.querySelectorAll('iframe').length,
      language: navigator.language,
      loadDuration: Math.round(performance.getEntriesByType('navigation')[0].duration),
      swaps: [...document.querySelectorAll('iframe')].map((frame) => frame.contentWindow.__swapMs).filter((value) => typeof value === 'number'),
      violations: [...document.querySelectorAll('iframe')].map((frame) => frame.contentWindow.__violations)
    })`,
    returnByValue: true
  }, page.sessionId);
  cdp.close();
  killChrome(chrome.child);
  // Chrome 可能还在收尾写 profile，清理失败不影响测量
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 留给系统临时目录 */ }
  if (!raw.result) throw new Error(`评估失败: ${JSON.stringify(raw).slice(0, 200)}`);
  return { ...JSON.parse(raw.result.value), probes: workers.size };
}

// 第一组：不设 CSP —— 数探测、比首屏
const native = await measure('native');
const withProbe = await measure('probe');
const noProbe = await measure('noprobe');

// 第二组：CSP 拒绝 blob —— 量"Worker 还没被包装"的窗口与违规数
const cspRun = process.argv.includes('--skip-csp')
  ? null
  : await (async () => {
    childCsp = "worker-src 'self'; script-src 'self' 'unsafe-inline'";
    return measure('probe');
  })();

const swaps = (cspRun ? cspRun.swaps : []).slice().sort((a, b) => a - b);
const percentile = (list, ratio) => (list.length ? list[Math.min(list.length - 1, Math.floor(list.length * ratio))] : null);
const violationCounts = {};
for (const value of cspRun ? cspRun.violations : []) violationCounts[value] = (violationCounts[value] || 0) + 1;

console.log(`\n${withProbe.frames} 个 iframe（+ 顶层，共 ${withProbe.frames + 1} 个文档）\n`);
console.log('| 模式 | 探测 Worker 数 | navigation duration |');
console.log('| --- | --- | --- |');
console.log(`| 无扩展 | ${native.probes} | ${native.loadDuration}ms |`);
console.log(`| 有扩展（含探测） | ${withProbe.probes} | ${withProbe.loadDuration}ms |`);
console.log(`| 有扩展（探测已短路） | ${noProbe.probes} | ${noProbe.loadDuration}ms |`);
console.log(`\n探测的系统开销: ${withProbe.loadDuration - noProbe.loadDuration}ms / ${withProbe.probes} 个文档`);
if (cspRun) {
  console.log(`CSP 站点上 Worker 包装延迟: p50=${percentile(swaps, 0.5)}ms p95=${percentile(swaps, 0.95)}ms max=${swaps.at(-1) ?? null}ms（n=${swaps.length}）`);
  console.log(`每个文档的 CSP 违规数: ${JSON.stringify(violationCounts)}`);
}

server.close();
const structural = withProbe.probes === withProbe.frames + 1 && noProbe.probes === 0;
if (!structural) {
  console.log('\n✗ 结构性预期不成立：探测必须是每文档 1 个，短路后必须是 0 个');
  process.exitCode = 1;
}
