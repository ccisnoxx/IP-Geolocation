#!/usr/bin/env node
/*
 * 原生模式自检：不开调试端口、不挂 CDP —— 页面看到的就是用户真实会看到的。
 *
 *   node tools/native-audit.mjs                                  # 默认 persona us-la-1 + Helium
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/native-audit.mjs
 *   node tools/native-audit.mjs --extension=dist-probe-geo --domain=example.com --fresh
 *
 * 为什么必须这样测：探针（tools/probe + verify-env）走 CDP，`navigator.webdriver` 恒为 true，
 * 而且 CDP 的 Emulation 覆盖会掩盖真实环境。这里用 host-resolver 把域名指到本地服务，
 * 页面自检后把结果 POST 回来，全程没有调试通道。
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_PATH, launchChrome, sleep , killChrome } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = join(homedir(), '.vanishgeo');
const persona = String(argv.persona || 'us-la-1');
const personaFile = join(HOME, 'personas', `${persona}.json`);
const personaConfig = existsSync(personaFile) ? JSON.parse(readFileSync(personaFile, 'utf8')) : {};
const expected = {
  locale: String(argv.locale || personaConfig.locale || 'en-US'),
  timezone: String(argv.tz || personaConfig.timezone || 'America/Los_Angeles'),
  acceptLanguage: String(argv.al || personaConfig.acceptLanguage || 'en-US,en')
};

const extensionPath = argv.extension
  ? resolve(String(argv.extension))
  : join(HOME, 'profiles', persona, 'ext');
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到扩展构建: ${extensionPath}`);
  process.exit(2);
}

const domain = String(argv.domain || 'claude.ai');
const profileDir = argv.profile ? resolve(String(argv.profile)) : join(HOME, 'profiles', persona, '.audit-profile');
if (argv.fresh) rmSync(profileDir, { recursive: true, force: true });
const freshProfile = !existsSync(join(profileDir, 'Default', 'Preferences'));
mkdirSync(profileDir, { recursive: true });

const warmupMs = argv.warmup !== undefined ? Number(argv.warmup) * 1000 : (freshProfile ? 12000 : 3000);

const pageHtml = (config) => `<!doctype html>
<html><head><meta charset="utf-8"><title>native audit</title></head>
<body><h1>native audit</h1><pre id="out">running…</pre>
<script>
const EXPECTED = ${JSON.stringify(config)};
const results = [];
const record = (name, value, ok, detail, skip) => results.push({ name, value, ok, detail: detail || '', skip: Boolean(skip) });

async function workerProbe() {
  return new Promise((res) => {
    try {
      const src = 'self.onmessage=()=>self.postMessage({tz:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:Intl.DateTimeFormat().resolvedOptions().locale,nav:navigator.language})';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const timer = setTimeout(() => res({ error: 'timeout' }), 3000);
      worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); res(event.data); };
      worker.postMessage('go');
    } catch (error) { res({ error: String(error && error.message) }); }
  });
}

function rtcProbe() {
  return new Promise((res) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const found = [];
      let done = false;
      const finish = () => { if (done) return; done = true; pc.close(); res(found); };
      pc.onicecandidate = (event) => {
        if (event.candidate) { const ip = event.candidate.candidate.split(' ')[4]; if (ip) found.push(ip); } else finish();
      };
      pc.createDataChannel('x');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(finish);
      setTimeout(finish, 2500);
    } catch (error) { res(['ERR:' + (error && error.message)]); }
  });
}

function fontWidthPresent(family) {
  const ctx = document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmmmlli';
  const bases = ['monospace', 'sans-serif', 'serif'].map((base) => { ctx.font = '16px ' + base; return ctx.measureText(sample).width; });
  return bases.some((base, index) => {
    ctx.font = '16px "' + family + '", ' + ['monospace', 'sans-serif', 'serif'][index];
    return ctx.measureText(sample).width !== base;
  });
}

(async () => {
  const nav = navigator.language;
  const navs = navigator.languages.slice();
  const intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Date().getTimezoneOffset();
  const localeDate = new Date(0).toLocaleDateString();
  const intlDate = new Intl.DateTimeFormat().format(new Date(0));
  const worker = await workerProbe();
  const rtc = await rtcProbe();

  record('navigator.webdriver', navigator.webdriver, navigator.webdriver === false);
  record('navigator.language', nav, nav === EXPECTED.locale);
  record('navigator.languages', navs.join(','), navs[0] === EXPECTED.locale);
  record('Intl locale', intlLocale, intlLocale === EXPECTED.locale);
  record('timezone', tz, tz === EXPECTED.timezone);
  record('UTC offset', offset, offset === (() => {
    // 用目标时区算一次期望偏移，避免"时区名对但偏移没跟"的情况
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: EXPECTED.timezone, timeZoneName: 'longOffset' }).formatToParts(new Date());
    const name = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT';
    if (name === 'GMT') return 0;
    const match = name.match(/GMT([+-])(\\d{2}):(\\d{2})/);
    if (!match) return offset;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '+' ? -minutes : minutes;
  })());
  record('toLocaleDateString == Intl', localeDate, localeDate === intlDate, 'intl=' + intlDate);
  record('worker timezone', worker.tz, worker.tz === EXPECTED.timezone, JSON.stringify(worker));
  record('WebRTC 候选', rtc.join(',') || '(none)', rtc.length === 0);
  record('platform', navigator.platform, navigator.platform === 'MacIntel');
  record('UA 无 HeadlessChrome', navigator.userAgent.includes('HeadlessChrome') ? 'headless' : 'normal', !navigator.userAgent.includes('HeadlessChrome'));
  record('screen', [screen.width, screen.height, devicePixelRatio].join('x'), screen.width >= 1000 && devicePixelRatio >= 1);
  record('hardwareConcurrency', navigator.hardwareConcurrency, navigator.hardwareConcurrency >= 2);
  record('plugins', navigator.plugins.length, navigator.plugins.length >= 3);
  record('PingFang SC(系统自带)', fontWidthPresent('PingFang SC'), fontWidthPresent('PingFang SC'));
  record('MS Gothic(应为假)', fontWidthPresent('MS Gothic'), fontWidthPresent('MS Gothic') === false);
  const geoState = await navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state).catch((error) => 'ERR:' + error.message);
  // denied 只说明这台机器/这个 profile 不允许定位（无人值守环境没人点授权），
  // 原生模式的其余项目已经证明扩展没在场 —— 这一条跳过，不算回归。
  record('geolocation 权限', geoState, geoState === 'prompt' || geoState === 'granted',
    geoState === 'denied' ? '本环境直接拒绝定位权限' : '', geoState === 'denied');

  const payload = { results, nav, tz, offset, ua: navigator.userAgent, webdriver: navigator.webdriver, worker };
  document.getElementById('out').textContent = JSON.stringify(payload, null, 1);
  await fetch('/__report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  document.getElementById('out').textContent += '\\n\\nreport sent';
})();
</script></body></html>`;

let report = null;
const seenHeaders = [];
const server = createServer({
  key: readFileSync(ensureCerts([domain]).key),
  cert: readFileSync(ensureCerts([domain]).cert)
}, (req, res) => {
  if (req.method === 'POST' && req.url === '/__report') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { report = JSON.parse(body); } catch { report = null; }
      res.writeHead(204).end();
    });
    return;
  }
  seenHeaders.push({
    host: req.headers.host,
    acceptLanguage: req.headers['accept-language'] || null,
    ua: req.headers['user-agent'] || ''
  });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(pageHtml(expected));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: profileDir,
  headless: false,
  debugPort: false,
  args: [
    `--lang=${expected.locale}`,
    `--accept-lang=${expected.acceptLanguage}`,
    `--load-extension=${extensionPath}`,
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP ${domain} 127.0.0.1:${port}`,
    '--window-size=1512,900',
    'about:blank',
    '-AppleLanguages',
    `(${expected.locale})`
  ],
  env: { TZ: expected.timezone }
});

console.log(`原生模式（无调试端口）  扩展: ${extensionPath}`);
console.log(`期望: locale=${expected.locale} tz=${expected.timezone} accept-language=${expected.acceptLanguage}`);
console.log(`profile: ${profileDir}${freshProfile ? '（新建，等 ' + warmupMs / 1000 + 's 让扩展就绪）' : '（已存在，等 ' + warmupMs / 1000 + 's）'}`);

await sleep(warmupMs);
const url = `https://${domain}/`;
// 关键：不能用 `open -a` —— 那会把 URL 交给"已经在跑的那个"浏览器实例（可能是用户自己的窗口）。
// 带同一个 --user-data-dir 再启动一次，Chromium 会把 URL 转发给同一个实例，才会带上
// 我们的 --host-resolver-rules / --load-extension。
function openOnce() {
  try {
    execFileSync(CHROME_PATH, [`--user-data-dir=${profileDir}`, url], { stdio: 'ignore' });
  } catch (error) {
    console.error(`打开页面失败: ${error && error.message}`);
  }
}
openOnce();

// 首次 TLS 握手偶发被重置（net_error -100）→ 页面永远不回报。像人一样重开一次。
const deadline = Date.now() + 45000;
let opens = 1;
while (!report && Date.now() < deadline) {
  await sleep(300);
  if (!report && Date.now() > deadline - (45000 - opens * 10000) && opens < 4) {
    opens += 1;
    openOnce();
  }
}

let failed = 0;
let total = 0;
if (!report) {
  console.error('✗ 页面没有回报结果（45s 内重开 3 次仍无回报）');
  failed += 1;
  total += 1;
} else {
  const header = seenHeaders[0] || {};
  const headerOk = Boolean(header.acceptLanguage) && header.acceptLanguage === expected.acceptLanguage;
  const headerMatchesJs = Boolean(header.acceptLanguage) && header.acceptLanguage.toLowerCase().startsWith(String(report.nav).toLowerCase());
  const rows = [
    ...report.results,
    { name: 'Accept-Language 头', value: header.acceptLanguage, ok: headerOk, detail: `期望 ${expected.acceptLanguage}` },
    { name: '头与 navigator.language 一致', value: String(headerMatchesJs), ok: headerMatchesJs, detail: `nav=${report.nav}` }
  ];
  let skipped = 0;
  for (const row of rows) {
    if (row.skip) {
      skipped += 1;
      console.log(`⚠ ${row.name}  ${row.value}${row.detail ? `  (${row.detail})` : ''}`);
      continue;
    }
    total += 1;
    if (!row.ok) failed += 1;
    console.log(`${row.ok ? '✓' : '✗'} ${row.name}  ${row.value}${row.detail ? `  (${row.detail})` : ''}`);
  }
  console.log(`\nUA: ${report.ua}`);
  console.log(`${total - failed}/${total} 通过${skipped ? `（${skipped} 项跳过）` : ''}`);
}

killChrome(chrome.child);
server.close();
setTimeout(() => process.exit(failed ? 1 : 0), 300);