#!/usr/bin/env node
/*
 * 每个账号一个「原生」浏览器环境：时区走 TZ 环境变量，语言走 --lang/--accept-lang，
 * 不注入任何 JS、不挂调试端口 —— 页面里看到的就是真环境，navigator.webdriver 为 false。
 *
 *   node tools/chrome-env.mjs --persona=us-la-1                     # 打开浏览器，手动注册
 *   node tools/chrome-env.mjs --persona=us-la-1 --check             # 体检当前环境并退出
 *   node tools/chrome-env.mjs --persona=jp-tokyo-1 --url=https://claude.ai
 *   node tools/chrome-env.mjs --persona=us-la-1 --with-cdp          # 需要 Intl locale 也跟随（会牺牲 webdriver）
 *
 * persona 配置落在 ~/.vanishgeo/personas/<name>.json，浏览器数据落在 ~/.vanishgeo/profiles/<name>。
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_PATH, CDP, evaluate, launchChrome, openPage, sleep } from './lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = join(HERE, 'probe');
const HOME = join(homedir(), '.vanishgeo');

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const persona = String(argv.persona || 'us-la-1');
const personaFile = join(HOME, 'personas', `${persona}.json`);
const profileDir = join(HOME, 'profiles', persona);
// 全新 profile 第一次启动时，扩展要 ~10s 才加载完；这期间的在途导航会被浏览器
// 直接取消（Helium 156 实测 net::ERR_ABORTED）。所以要在 mkdir 之前判断新不新。
const freshProfile = !existsSync(join(profileDir, 'Default', 'Preferences'));
mkdirSync(dirname(personaFile), { recursive: true });
mkdirSync(profileDir, { recursive: true });

const DEFAULTS = {
  timezone: 'America/Los_Angeles',
  locale: 'en-US',
  acceptLanguage: 'en-US,en',
  latitude: 37.7749,
  longitude: -122.4194
};

const config = existsSync(personaFile)
  ? { ...DEFAULTS, ...JSON.parse(readFileSync(personaFile, 'utf8')) }
  : { ...DEFAULTS };
for (const key of ['timezone', 'locale', 'acceptLanguage', 'latitude', 'longitude']) {
  if (argv[key] !== undefined) config[key] = key === 'latitude' || key === 'longitude' ? Number(argv[key]) : String(argv[key]);
}
if (argv.tz) config.timezone = String(argv.tz);
if (argv.al) config.acceptLanguage = String(argv.al);
writeFileSync(personaFile, JSON.stringify(config, null, 2));

function startProbeServer() {
  const state = { beacon: null, requests: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const acceptLanguage = req.headers['accept-language'] || null;
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      state.requests.push({ kind: 'document', path: url.pathname, acceptLanguage });
    } else if (url.pathname === '/api/echo') {
      state.requests.push({ kind: 'echo', path: url.pathname, acceptLanguage });
    }
    if (url.pathname === '/api/beacon' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        state.beacon = JSON.parse(body);
      } catch {
        /* ignore */
      }
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/api/log') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requests: state.requests }));
      return;
    }
    if (url.pathname === '/api/echo') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    const rel = url.pathname === '/' ? 'top.html' : url.pathname.slice(1);
    const filePath = normalize(join(PROBE_DIR, rel));
    if (!filePath.startsWith(PROBE_DIR)) {
      res.writeHead(403).end();
      return;
    }
    try {
      let body = await readFile(filePath, 'utf8');
      if (rel.endsWith('.html')) body = body.replace('__FRAME_ORIGIN__', `http://localhost:${server.address().port}`);
      const type = rel.endsWith('.js') ? 'text/javascript' : 'text/html';
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, state, port: server.address().port }));
  });
}

function verdict(report) {
  const tz = report.timezone || {};
  const loc = report.locale || {};
  const lines = [];
  const warn = [];
  lines.push(`persona      ${persona}  (${profileDir})`);
  lines.push(`时区         ${tz.claimed}  offset=${tz.offsetFromDate}min  自洽=${tz.offsetsAgree && tz.wallClockAgrees}`);
  lines.push(`Intl locale  ${loc.intlLocale}`);
  lines.push(`navigator    ${loc.navLanguage} [${(loc.navLanguages || []).join(', ')}]`);
  lines.push(`Accept-Lang  ${report.headers ? report.headers.documentAcceptLanguage : '-'}`);
  lines.push(`iframe       tz=${report.frame ? report.frame.timezone.claimed : '-'} lang=${report.frame ? report.frame.locale.navLanguage : '-'}`);
  const swReport = report.serviceWorker || {};
  if (swReport.supported) {
    lines.push(`ServiceWorker tz=${swReport.tz} locale=${swReport.locale}${swReport.error ? ` 错误=${swReport.error}` : ''}`);
  }
  lines.push(`webdriver    ${report.sensors.webdriver}`);
  lines.push(`被改的原生函数 ${(report.natives.spoofed || []).length}`);
  lines.push(`恒等关系破坏   ${(report.identityFailures || []).length}`);
  lines.push(`window 泄漏   ${(report.globals || []).length}`);

  if (report.sensors.webdriver) warn.push('navigator.webdriver=true —— 有调试端口或自动化开关，注册环境会直接被打标');
  if ((report.natives.spoofed || []).length) warn.push(`原生函数被替换：${report.natives.spoofed.map((x) => x.name).join(', ')}`);
  if ((report.identityFailures || []).length) warn.push(`恒等关系被破坏：${report.identityFailures.join('; ')}`);
  if ((report.globals || []).length) warn.push(`window 上残留：${(report.globals || []).map((x) => x.key).join(', ')}`);
  if (report.bridge.magicStringAccepted) warn.push('postMessage 桥可被页面反向改写（固定 magic string）');
  if (!tz.offsetsAgree || !tz.wallClockAgrees) warn.push('Date / Intl 时区互不自洽');
  if (report.frame && report.frame.timezone && report.frame.timezone.claimed !== tz.claimed) {
    warn.push(`跨源 iframe 时区不一致：顶层 ${tz.claimed} / iframe ${report.frame.timezone.claimed}`);
  }
  if (report.frame && report.frame.locale && report.frame.locale.navLanguage !== loc.navLanguage) {
    warn.push(`跨源 iframe 语言不一致：顶层 ${loc.navLanguage} / iframe ${report.frame.locale.navLanguage}`);
  }
  const swWarn = report.serviceWorker || {};
  const sw = swWarn;
  if (sw.tz && sw.tz !== tz.claimed) {
    warn.push(`Service Worker 时区不一致：页面 ${tz.claimed} / SW ${sw.tz}（SW 无法注入补丁，必须靠 TZ 环境变量）`);
  }
  if (sw.locale && loc.intlLocale && sw.locale !== loc.intlLocale) {
    warn.push(`Service Worker locale 不一致：页面 ${loc.intlLocale} / SW ${sw.locale}（靠 -AppleLanguages 解决）`);
  }
  return { text: lines.join('\n'), warnings: warn };
}

// -AppleLanguages 走 NSUserDefaults 参数域：TZ 管时区，它管 ICU 默认 locale。
// 两个都设好之后，渲染进程、Worker、Service Worker 全都是原生正确值 ——
// Service Worker 没有可注入的时机，只能靠这一层解决。
// 默认加载 persona 自己的烘焙构建（scripts/build-persona.mjs 的产出位置）。
// 那是 document_start 同步生效的那一份，注册账号必须用它。
const personaExtension = join(profileDir, 'ext');
const extensionPath = argv['no-extension']
  ? null
  : (argv.extension ? resolve(String(argv.extension))
    : (existsSync(join(personaExtension, 'manifest.json')) ? personaExtension : null));

/** 未打包扩展的 ID 由绝对路径派生（Chrome 的算法：sha256(path) 前 16 字节映射到 a-p） */
function unpackedExtensionId(absolutePath) {
  const hex = createHash('sha256').update(absolutePath).digest('hex').slice(0, 32);
  return hex.split('').map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('');
}

/** 扩展是否已经装进这个 profile（在 chrome://extensions 里加载过一次之后就会持久化） */
function isExtensionInstalled(dir, id) {
  for (const file of ['Default/Preferences', 'Default/Secure Preferences']) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    try {
      if (readFileSync(full, 'utf8').includes(id)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

const extensionId = extensionPath ? unpackedExtensionId(extensionPath) : null;
// --extension= 是临时指定的产物，不算"装进 profile"，也就没有持久化可言
const extensionPinned = Boolean(argv.extension);
const extensionInstalled = extensionPath ? (extensionPinned || isExtensionInstalled(profileDir, extensionId)) : false;

const launchArgs = [
  `--lang=${config.locale}`,
  `--accept-lang=${config.acceptLanguage}`,
  '--window-size=1512,900'
];
if (extensionPath) launchArgs.push(`--load-extension=${extensionPath}`);

/**
 * ICU 默认 locale 只能靠 NSUserDefaults 参数域改：`-AppleLanguages (en-US)`。
 * 副作用是 `(en-US)` 会被 Chromium 当成位置参数开成标签页，所以这两项必须排在
 * URL 之后 —— 这样真实页面在前景，多出来的是个后台空标签，可以直接关掉。
 * `-AppleLocale` 是多余的（实测只加 -AppleLanguages 就已经把 ICU 拉到 en-US）。
 */
const appleArgs = argv['apple-locale'] === 'off'
  ? []
  : ['-AppleLanguages', `(${config.locale})`];

// headless 只接受一个位置参数，而 (en-US) 就是一个位置参数 —— 两者不能共存
const effectiveAppleArgs = argv.headless ? [] : appleArgs;
const launchEnv = { TZ: config.timezone };
const useCdp = Boolean(argv['with-cdp']);

/** 打开扩展页之前先把"开发者模式"写进 profile，省掉一次点击 */
function ensureDeveloperMode(dir) {
  const file = join(dir, 'Default', 'Preferences');
  try {
    mkdirSync(join(dir, 'Default'), { recursive: true });
    const prefs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.ui = { ...(prefs.extensions.ui || {}), developer_mode: true };
    writeFileSync(file, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

// chrome://extensions 里加载一次即可持久化。Chrome 155 已经彻底忽略 --load-extension，
// 所以这一步只能手动点一次（我们只负责把路径放进剪贴板、把开发者模式打开）。
if (argv['setup-extension']) {
  if (!extensionPath) {
    console.error(`没有烘焙产物。先跑：npm run build:persona -- --persona=${persona}`);
    process.exit(1);
  }
  ensureDeveloperMode(profileDir);
  try {
    execFileSync('pbcopy', { input: extensionPath });
  } catch { /* ignore */ }
  console.log(`profile : ${profileDir}`);
  console.log(`扩展目录: ${extensionPath}   ← 已复制到剪贴板`);
  console.log(`扩展 ID : ${extensionId}`);
  console.log('');
  console.log('打开的页面里：右上角「开发者模式」已预先打开 → 点「加载已解压的扩展程序」→ 粘贴路径');
  console.log('装完后这个 profile 就记住了，之后 --persona=... 直接启动即可，不再需要任何参数。');
  const chrome = await launchChrome({
    userDataDir: profileDir,
    headless: false,
    debugPort: false,
    args: [...launchArgs, 'chrome://extensions'],
    env: launchEnv
  });
  chrome.child.on('exit', () => process.exit(0));
  await new Promise(() => {}); // 停在这里，等浏览器退出
}


if (argv.check) {
  const probe = await startProbeServer();
  const chrome = await launchChrome({
    userDataDir: profileDir,
    headless: Boolean(argv.headless),
    debugPort: false,
    args: [...launchArgs, `http://127.0.0.1:${probe.port}/?label=${encodeURIComponent(persona)}&beacon=1`, ...effectiveAppleArgs],
    env: launchEnv
  });
  const deadline = Date.now() + 30000;
  while (!probe.state.beacon && Date.now() < deadline) await sleep(200);
  if (!probe.state.beacon) {
    console.error('探针没有回传结果（页面被拦？扩展没注入？）');
    process.exitCode = 1;
  } else {
    console.log(`extension    ${extensionPath
      ? `${extensionPinned ? `临时指定 ${extensionPath}` : (extensionInstalled ? `已安装 ${extensionId}` : `未安装 → node tools/chrome-env.mjs --persona=${persona} --setup-extension`)}`
      : '无烘焙构建（npm run build:persona）'}`);
    const { text, warnings } = verdict(probe.state.beacon);
    if (extensionPath && !extensionInstalled && !extensionPinned) {
      warnings.push('扩展还没装进这个 profile：页面侧只有 TZ/-AppleLanguages，per-domain 规则（含跨源 iframe）不生效');
    }
    writeFileSync(join(HOME, `check-${persona}.json`), JSON.stringify(probe.state.beacon, null, 2));
    console.log(text);
    if (warnings.length) {
      console.log('\n风险项：');
      for (const item of warnings) console.log(`  - ${item}`);
    } else {
      console.log('\n没有发现可被页面观察到的伪装痕迹。');
    }
  }
  probe.server.close();
  chrome.child.kill('SIGTERM');
  process.exit(process.exitCode || 0);
}

const url = argv.url ? String(argv.url) : 'about:blank';

if (!useCdp) {
  // 原生模式：不开调试端口，页面里 navigator.webdriver 为 false
  // 冷启动保护：新 profile 先开空白页，等扩展加载完再打开目标 URL
  // 实测（headful 原生模式，Helium 156）：全新 profile 启动后 1s 打开页面就已经注入正常，
  // 之前看到的 ~10s“白屏窗口”只在 headless + CDP 的测试环境里出现。这里给 4s 余量。
  const warmupSeconds = argv['warmup'] !== undefined
    ? Number(argv['warmup'])
    : (freshProfile && !argv.headless && url !== 'about:blank' ? 4 : 0);
  const firstUrl = warmupSeconds > 0 ? 'about:blank' : url;
  const chrome = await launchChrome({
    userDataDir: profileDir,
    headless: Boolean(argv.headless),
    debugPort: false,
    args: [...launchArgs, firstUrl, ...effectiveAppleArgs],
    env: launchEnv
  });
  if (warmupSeconds > 0) {
    console.log(`冷启动保护：新 profile + 扩展，先等 ${warmupSeconds}s 再打开 ${url}`);
    console.log('（headless 测试环境里扩展首次加载要 ~10s，headful 实测 1s 就绪，这里留余量）');
    setTimeout(() => {
      try {
        // 带同一个 --user-data-dir 再启动一次：URL 会被转发给刚起的那个实例，
        // 而不是交给系统里已经在跑的浏览器窗口。
        execFileSync(CHROME_PATH, [`--user-data-dir=${profileDir}`, url], { stdio: 'ignore' });
      } catch (error) {
        console.log(`自动打开失败：${error && error.message}；请手动打开 ${url}`);
      }
    }, warmupSeconds * 1000).unref();
  }
  console.log(`profile: ${profileDir}`);
  console.log(`extension: ${extensionPath ? `${extensionPath}  ${argv.extension ? '临时指定' : (extensionInstalled ? '已安装' : '未安装 → 先跑一次 --setup-extension')}` : '（无烘焙构建，先跑 npm run build:persona -- --persona=' + persona + '）'}`);
  console.log(`TZ=${config.timezone}  --lang=${config.locale}  --accept-lang=${config.acceptLanguage}`);
  console.log('已按原生环境启动（无调试端口；页面/Worker/Service Worker 全部走原生值）。关闭浏览器即退出。');
  if (!extensionPath) {
    console.log('提示：没有烘焙构建时，页面侧完全依赖 TZ/-AppleLanguages；跑一次 build:persona 可让扩展补上 per-domain 规则。');
  }
  chrome.child.on('exit', () => process.exit(0));
} else {
  const chrome = await launchChrome({
    userDataDir: profileDir,
    headless: Boolean(argv.headless),
    args: [...launchArgs, 'about:blank', ...effectiveAppleArgs],
    env: launchEnv
  });
  console.log(`profile: ${profileDir}`);
  console.log(`TZ=${config.timezone}  --lang=${config.locale}  --accept-lang=${config.acceptLanguage}`);
  const cdp = await CDP.connect(chrome.websocketUrl);
  const applyOverrides = async (session, id, userAgent) => {
    await session.send('Emulation.setLocaleOverride', { locale: config.locale }, id);
    await session.send('Emulation.setTimezoneOverride', { timezoneId: config.timezone }, id);
    await session.send('Emulation.setUserAgentOverride', {
      userAgent,
      acceptLanguage: config.acceptLanguage,
      platform: 'MacIntel'
    }, id);
    await session.send('Emulation.setGeolocationOverride', {
      latitude: config.latitude,
      longitude: config.longitude,
      accuracy: 30
    }, id);
  };
  const { sessionId } = await openPage(cdp, null, {
    viewport: { width: 1512, height: 900, deviceScaleFactor: 2 },
    beforeNavigate: async (session, id) => {
      const userAgent = await evaluate(session, id, 'navigator.userAgent');
      await applyOverrides(session, id, userAgent);
      await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, id);
      cdp.on(async (message) => {
        if (message.method !== 'Target.attachedToTarget') return;
        const childId = message.params.sessionId;
        try {
          await applyOverrides(cdp, childId, userAgent);
        } catch {
          /* ignore */
        }
        try {
          await cdp.send('Runtime.runIfWaitingForDebugger', {}, childId);
        } catch {
          /* ignore */
        }
      });
    }
  });
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  console.log('CDP 覆盖已下发（调试端口会让 navigator.webdriver=true，仅在你确认能接受时使用）');
  chrome.child.on('exit', () => process.exit(0));
}
