#!/usr/bin/env node
/*
 * 环境一致性实测：同一台机器上，三种「让时区/语言跟随 IP」的做法，哪种在页面里看起来是原生的。
 *
 *   node tools/verify-env.mjs                 # 跑 baseline / flags / cdp 三组对比
 *   node tools/verify-env.mjs --mode=cdp      # 只跑一组
 *   node tools/verify-env.mjs --extension=dist # 顺带把 VanishGeo 一起载入，A/B 对照
 *
 * baseline  = 系统默认（本机：Asia/Shanghai + zh-CN）
 * flags     = 启动参数 + TZ 环境变量（--lang / --accept-lang），零 JS 补丁
 * cdp       = CDP Emulation.* 覆盖（Blink 层，JS 侧看不到补丁痕迹）
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CDP, evaluate, launchChrome, openPage, sleep, waitForValue } from './lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = join(HERE, 'probe');
const OUT_DIR = join(HERE, 'out');

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const FRAME_HOST = argv.frameHost || '127.0.0.1';

const TARGET = {
  timezone: argv.tz || 'America/Los_Angeles',
  locale: argv.locale || 'en-US',
  acceptLanguage: argv.acceptLanguage || 'en-US,en',
  latitude: 37.7749,
  longitude: -122.4194
};

function startServer(port, frameOrigin) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/log') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ requests }));
      return;
    }
    if (url.pathname === '/api/echo') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const kind = url.pathname === '/' || url.pathname.endsWith('.html') ? 'document' : url.pathname === '/api/echo' ? 'echo' : 'other';
    if (kind !== 'other') {
      requests.push({
        kind,
        path: url.pathname,
        acceptLanguage: req.headers['accept-language'] || null,
        secChUa: req.headers['sec-ch-ua'] || null,
        ua: req.headers['user-agent'] || null
      });
    }
    const rel = url.pathname === '/' ? 'top.html' : url.pathname.slice(1);
    const filePath = normalize(join(PROBE_DIR, rel));
    if (!filePath.startsWith(PROBE_DIR)) {
      res.writeHead(403).end('nope');
      return;
    }
    try {
      let body = await readFile(filePath, 'utf8');
      if (rel.endsWith('.html')) body = body.replace('__FRAME_ORIGIN__', frameOrigin);
      const type = rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.html') ? 'text/html' : 'text/plain';
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('missing');
    }
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done({ server, port, requests }));
  });
}

async function pickPort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

function unpackedExtensionId(absolutePath) {
  const hex = createHash('sha256').update(absolutePath).digest('hex').slice(0, 32);
  return hex.split('').map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('');
}

function seedConfig() {
  return {
    masterEnabled: true,
    debugMode: false,
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: TARGET.locale,
        languages: [TARGET.locale, 'en'],
        acceptLanguage: TARGET.acceptLanguage
      },
      timezone: { enabled: true, mode: 'manual', timezone: TARGET.timezone },
      geolocation: { enabled: false, mode: 'manual', latitude: TARGET.latitude, longitude: TARGET.longitude, accuracy: 30 }
    },
    canvas: { enabled: true, spoofFonts: true, targetFonts: ['PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC'] },
    rules: [{
      id: 'probe-rule',
      domain: '127.0.0.1',
      enabled: true,
      overrides: {
        language: { mode: 'inherit', value: null },
        timezone: { mode: 'inherit', value: null },
        geolocation: { mode: 'inherit', value: null }
      }
    }]
  };
}

async function seedExtension(cdp, extensionPath) {
  let extensionId = null;
  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    extensionId = loaded.id;
  } catch {
    extensionId = unpackedExtensionId(extensionPath);
  }
  await sleep(800);

  const page = await openPage(cdp, `chrome-extension://${extensionId}/options/options.html`);
  await sleep(500);
  const payload = JSON.stringify(seedConfig());
  const stored = await evaluate(cdp, page.sessionId, `(async () => {
    await chrome.storage.local.set({ siteSpoofConfig: ${payload} });
    const state = await chrome.storage.local.get('siteSpoofConfig');
    return Boolean(state && state.siteSpoofConfig);
  })()`, { awaitPromise: true });
  if (!stored) throw new Error('failed to seed siteSpoofConfig');

  // 等后台把内容脚本注册好，避免在 unregister/register 的窗口期里导航
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await evaluate(cdp, page.sessionId, `(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      return scripts.filter((item) => item.world === 'MAIN').length > 0;
    })()`, { awaitPromise: true }).catch(() => false);
    if (ready) break;
    await sleep(150);
  }
  if (!ready) console.warn('内容脚本未在 15s 内注册完成');
  await sleep(400);
  await cdp.send('Target.closeTarget', { targetId: page.targetId });
  return extensionId;
}

async function runMode(mode) {
  const topPort = await pickPort();
  const framePort = await pickPort();
  const top = await startServer(topPort, `http://${FRAME_HOST}:${framePort}`);
  const frame = await startServer(framePort, `http://${FRAME_HOST}:${framePort}`);

  const userDataDir = join(OUT_DIR, 'profiles', mode);
  const launchArgs = [];
  const launchEnv = {};
  if (argv.extension) launchArgs.push(`--load-extension=${resolve(String(argv.extension))}`);

  if (mode === 'flags') {
    launchEnv.TZ = TARGET.timezone;
    launchArgs.push(`--lang=${TARGET.locale}`, `--accept-lang=${TARGET.acceptLanguage}`);
  }

  if (argv['native-env']) {
    launchEnv.TZ = TARGET.timezone;
    launchArgs.push(`--lang=${TARGET.locale}`, `--accept-lang=${TARGET.acceptLanguage}`,
      '-AppleLanguages', `(${TARGET.locale})`);
  }

  if (mode === 'native') {
    // 进程级：TZ 决定所有进程的时区，-AppleLanguages 让 ICU 默认 locale 也跟上，
    // Service Worker 这类没法打补丁的环境因此天然一致。
    launchEnv.TZ = TARGET.timezone;
    launchArgs.push(
      `--lang=${TARGET.locale}`,
      `--accept-lang=${TARGET.acceptLanguage}`,
      '-AppleLanguages',
      `(${TARGET.locale})`
    );
  }

  // native 模式必须带界面：headless 不接受 >1 个位置参数，而 NSUserDefaults 的
  // -AppleLanguages / -AppleLocale 正是以位置参数形式传入的
  const headless = mode === 'native' || argv['native-env'] ? false : !argv.headful;
  const chrome = await launchChrome({ userDataDir, headless, args: launchArgs, env: launchEnv });
  const cdp = await CDP.connect(chrome.websocketUrl);
  let extensionId = null;
  try {
  if (argv.extension && !argv['no-seed']) {
    extensionId = await seedExtension(cdp, resolve(String(argv.extension)));
  } else if (argv.extension) {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: resolve(String(argv.extension)) }).catch(() => null);
    extensionId = loaded ? loaded.id : unpackedExtensionId(resolve(String(argv.extension)));
    await sleep(1200);
  }
  const url = `http://127.0.0.1:${topPort}/?label=${mode}`;

  const applyOverrides = async (session, id, userAgent) => {
    await session.send('Emulation.setTimezoneOverride', { timezoneId: TARGET.timezone }, id);
    await session.send('Emulation.setLocaleOverride', { locale: TARGET.locale }, id);
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      acceptLanguage: TARGET.acceptLanguage,
      platform: 'MacIntel'
    }, id);
    await session.send('Emulation.setGeolocationOverride', {
      latitude: TARGET.latitude,
      longitude: TARGET.longitude,
      accuracy: 30
    }, id);
  };

  const { sessionId } = await openPage(cdp, null, {
    viewport: { width: 1512, height: 900, deviceScaleFactor: 2 },
    beforeNavigate: async (session, id) => {
      if (mode !== 'cdp') return;
      const userAgent = await evaluate(session, id, 'navigator.userAgent');
      await applyOverrides(session, id, userAgent);
      await session.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true
      }, id);
      // OOPIF（跨站 iframe，如 challenges.cloudflare.com）是独立 target，
      // 必须递归下发覆盖，否则 iframe 里仍是真实时区/语言。
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

  // 扩展刚装好时 DNR/内容脚本可能还在落地：Chromium 会把进行中的请求 ERR_ABORTED。
  // 重试一次导航，别把启动竞态当成"扩展没生效"。
  let navError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
    const result = await cdp.send('Page.navigate', { url }, sessionId);
    navError = result && result.errorText ? result.errorText : null;
    await loaded.catch(() => {});
    if (!navError) break;
    await sleep(800);
  }
  if (navError) console.warn(`导航失败：${navError}`);
  // 扩展是异步通道：SW 冷启动要几百毫秒，探针可能先跑完。等它落地再重跑一遍，
  // 这样量到的是"补丁质量"，而不是"和冷启动赛跑的结果"（后者单独看 early.tz）。
  let report;
  if (extensionId) {
    const firstReport = await waitForValue(cdp, sessionId, 'window.__probeResult || null', { timeout: 15000 }).catch(() => null);
    await sleep(1500);
    report = await evaluate(cdp, sessionId, 'window.__runProbe("' + mode + '")', { awaitPromise: true });
    // 重跑时 iframe 早已上报过，跨源那一项沿用第一次的结果
    if (firstReport && (!report.frame || !report.frame.timezone)) report.frame = firstReport.frame;
    if (!report.early && firstReport) report.early = firstReport.early;
  } else {
    report = await waitForValue(cdp, sessionId, 'window.__probeResult || null', { timeout: 15000 });
  }

  report.extensionId = extensionId;
  report.serverLog = top.requests.slice(-6);
  report.frameServerLog = frame.requests.slice(-4);
  return report;
  } finally {
    cdp.close();
    chrome.child.kill('SIGKILL');
    top.server.close();
    frame.server.close();
  }
}

function summarize(report) {
  const tz = report.timezone || {};
  const loc = report.locale || {};
  const f = report.frame || {};
  return {
    mode: report.label,
    tz: tz.claimed,
    'offset(min)': tz.offsetFromDate,
    'offsetAgree': tz.offsetsAgree && tz.wallClockAgrees,
    'intl.locale': loc.intlLocale,
    'nav.language': loc.navLanguage,
    'accept-language': report.headers ? report.headers.documentAcceptLanguage : null,
    'dateLocale == intl': report.verdict && report.verdict.localeConsistent,
    'patchedNatives': (report.natives && report.natives.spoofed || []).map((item) => item.name).join(', ') || '-',
    'identityBroken': (report.identityFailures || []).length,
    'globalsLeaked': (report.globals || []).map((item) => item.key).join(', ') || '-',
    'permissionTag': report.permissions ? report.permissions.tag : null,
    'geoIdentical': report.geolocation ? report.geolocation.sameFn : null,
    'early.tz': report.early ? report.early.tz : null,
    'early.ctorOk': report.early ? report.early.ctorOk : null,
    'frame.tz': f.timezone ? f.timezone.claimed : null,
    'frame.lang': f.locale ? f.locale.navLanguage : null,
    'sw.tz': report.serviceWorker ? report.serviceWorker.tz : null,
    'sw.locale': report.serviceWorker ? report.serviceWorker.locale : null,
    'sw.lang': report.serviceWorker ? report.serviceWorker.lang : null,
    'bridgeExploitable': report.bridge ? report.bridge.magicStringAccepted : null
  };
}

const modes = argv.mode ? [String(argv.mode)] : ['baseline', 'flags', 'cdp'];
mkdirSync(OUT_DIR, { recursive: true });

const results = [];
for (const mode of modes) {
  process.stdout.write(`\n=== ${mode} ===\n`);
  try {
    const report = await runMode(mode);
    writeFileSync(join(OUT_DIR, `${mode}.json`), JSON.stringify(report, null, 2));
    const row = summarize(report);
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  } catch (error) {
    console.error(`${mode} failed: ${error && error.message}`);
  }
}

if (results.length > 1) {
  console.log('\n=== 对比 ===');
  const keys = Object.keys(results[0]);
  const width = Math.max(...keys.map((key) => key.length));
  console.log(`${'field'.padEnd(width)} | ${results.map((row) => String(row.mode).padEnd(22)).join('| ')}`);
  for (const key of keys.slice(1)) {
    console.log(`${key.padEnd(width)} | ${results.map((row) => String(row[key]).padEnd(22)).join('| ')}`);
  }
}