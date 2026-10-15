#!/usr/bin/env node
/**
 * Starts a local acceptance target and optionally launches a real Chrome profile
 * with the built VanishGeo extension loaded.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LEAK_TEST_HOST,
  DEFAULT_LEAK_TEST_PORT,
  assertLeakTestDist,
  startLeakTestServer
} from './serve-leak-test.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const distRoot = join(projectRoot, 'dist');

const args = process.argv.slice(2);
const argSet = new Set(args);

function optionValue(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

function normalizePort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return port;
}

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function acceptanceUrls(origin) {
  return [
    { label: 'Observation mode leak-test', url: `${origin}/leak-test/leak-test.html?ui=zh` },
    { label: 'Accept-Language header echo', url: `${origin}/headers.json` },
    { label: 'iframe realm fixture', url: `${origin}/fixtures/iframe/top.html` },
    { label: 'Worker and SharedWorker fixture', url: `${origin}/fixtures/workers/top.html` },
    { label: 'Geolocation behavior fixture', url: `${origin}/fixtures/geolocation/top.html` },
    { label: 'VG-009 earliest inline script fixture', url: `${origin}/fixtures/injection/earliest-inline.html` },
    { label: 'Chrome extension manager', url: 'chrome://extensions/' }
  ];
}

function printChecklist(origin, chromePath, launchStatus) {
  const urls = acceptanceUrls(origin);
  console.log('\nVanishGeo Chrome acceptance target');
  console.log('- Extension build: dist/');
  console.log(`- Local origin: ${origin}`);
  console.log(`- Chrome: ${chromePath ? 'detected' : 'not found'}`);
  console.log(`- Launch: ${launchStatus}`);
  console.log('\nOpened / target URLs:');
  urls.forEach((entry) => {
    console.log(`- ${entry.label}: ${entry.url}`);
  });
  console.log('\nVG-011 当前安全暂停验收：');
  console.log('- MAIN 页面伪装已暂停，语言/时区/位置/Canvas/worker 保持原生；总开关和站点规则只表示配置。DNR 与 WebRTC 按各自实际状态验收。');
  console.log('- 重建旧页面及 BFCache 文档；新闸门不能撤销已有 hook。保存、重试同步和后台重启均不得恢复注入。');
  console.log('- node scripts/runtime-modularization/chrome-safety-gate.mjs 验证真实 Chrome BFCache、跨 origin、同 URL 重载的零生产派发；dry-run 不执行。');
  console.log('- node scripts/runtime-modularization/document-targeting-investigation.mjs --native-only 保留浏览器错投对照，退出 0 仅表示采集完成，安全判定可仍为 FAIL。');
  console.log('\n历史功能清单（页面伪装项仅作恢复后的目标，暂停候选不要求其匹配配置；--injection/旧 smoke 不能作为当前安全暂停通过证据）：');
  console.log('- VG-003: open VanishGeo diagnostic from Popup/Options; it opens the extension `diagnostic/report.html`. Select the localhost or hosted tab and run one diagnostic.');
  console.log('- The extension report compares language/languages, header echo, timezone/locale, position/watch, WebRTC policy, independently sampled iframe documents, workers and MAIN/ISOLATED pass-through observations. Empty ICE stays UNKNOWN; IP candidates FAIL independently of policy.');
  console.log('- During a diagnostic reload/navigate/close the target, cancel, or let the 2-minute TTL expire. Confirm an explicit failure/cleared report; reopen the report to confirm there is no persisted snapshot.');
  console.log('- Verify target page URL/DOM and `/headers.json` requests contain no expected configuration. Report HTML/JS/CSS must not be web accessible resources.');
  console.log('- Before enabling VanishGeo for `localhost`, open the leak-test observation page and click `Capture pass-through baseline`.');
  console.log('- In the temporary Chrome profile, enable VanishGeo for `localhost`, reload the localhost pages, then click `Run all checks` on the leak-test observation page.');
  console.log('- Configure explicit manual fixture values: language `ja-JP`, languages `ja-JP, ja`, Accept-Language `ja-JP,ja;q=0.9`, timezone `Asia/Tokyo`, geolocation with synthetic coordinates, WebRTC `strict`.');
  console.log('- Separately detect a verified exit profile in Options, bind it to `localhost`, and confirm its IP, country, timezone, and coordinates match the single detection preview.');
  console.log('- The leak-test page stays in observation mode / UNKNOWN and receives no extension expected values. Manually compare Language, Accept-Language, Timezone, Geolocation and iframe/worker observations with the synthetic configuration; the page issues no profile PASS/FAIL verdict.');
  console.log('- Open `/headers.json` and confirm `accept-language` matches the configured Accept-Language value after `localhost` is allowlisted.');
  console.log('- Run the WebRTC ICE check and confirm no local/private or public IP candidate exposure is shown; confirm Chrome WebRTC policy is `disable_non_proxied_udp` from extension options in a separate policy check.');
  console.log('- On the iframe fixture, confirm same-origin, srcdoc, and about:blank frames match the top-level language/timezone values; cross-origin frames are not part of this P0 acceptance.');
  console.log('- On the worker fixture, confirm classic Worker, module Worker, and SharedWorker language/timezone values match the top-level page.');
  console.log('- VG-007：检查 classic/module SharedWorker 同 key 共享 scope、连接计数为 1/2，不同 name 独立；模块依赖顶层 language/timezone 已打补丁。运行 node scripts/chrome-worker-smoke.mjs 可验证定向真实 Chrome 构造、URL 回收和 fallback；这不替代人工验收。');
  console.log('- VG-009：打开 earliest-inline fixture，在扩展报告选择该 tab，点击“验收最早 inline script”。分别检查 top、same-origin iframe、srcdoc、about:blank 的 earliest/load/postLoad；load PASS 不补足 earliest FAIL。生产页面无新增 marker。');
  console.log('- VG-009 自动真实 Chrome：npm run test:e2e:chrome -- --injection --runs=3；使用 Node 22+ 原生 WebSocket、临时 profile 和合成配置。退出码 0=全 PASS，1=观测 FAIL/UNKNOWN，2=自动化失败；--output 可保存脱敏 JSON。dry-run 不执行此项。');
  console.log('- VG-010：fresh install 总开关关闭、空站点、WebRTC browser default；检查配置引导主动检测/确认、选站点、明确启用、跳过和重置。升级已有 v2 保留设置，不自动打开引导。node scripts/chrome-onboarding-smoke.mjs 可在真实临时 Chrome profile 验证，provider 请求在发出前拦截并返回合成数据，不调用真实 provider；dry-run 不执行。');
  console.log('- Compare pass-through real-device surfaces against the captured baseline: manually inspect WebGL/GPU, Audio sampleRate, screen, hardware, codec, and WebGPU observations; this page does not validate pass-through behavior.');
  console.log('- Reload the unpacked extension in `chrome://extensions/`, revisit BrowserInsight, and confirm no prototype tampering warning appears.');
  console.log('\nPress Ctrl+C here when manual validation is complete.');
}

function launchChrome(chromePath, origin, userDataDir) {
  const urls = acceptanceUrls(origin).map((entry) => entry.url);
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    `--disable-extensions-except=${distRoot}`,
    `--load-extension=${distRoot}`,
    '--new-window',
    ...urls
  ];
  const child = spawn(chromePath, chromeArgs, {
    stdio: 'ignore',
    detached: true
  });
  child.unref();
  return child;
}

async function main() {
  const dryRun = argSet.has('--dry-run');
  const noLaunch = argSet.has('--no-launch');
  const host = optionValue('--host', process.env.VANISHGEO_LEAK_TEST_HOST || DEFAULT_LEAK_TEST_HOST);
  const port = normalizePort(optionValue('--port', process.env.VANISHGEO_LEAK_TEST_PORT || String(DEFAULT_LEAK_TEST_PORT)));
  const origin = `http://${host}:${port}`;
  const chromePath = findChromeBinary();

  assertLeakTestDist(projectRoot);
  for (const file of ['diagnostic/report.html', 'diagnostic/report.js', 'diagnostic/report.css', 'fixtures/injection/earliest-inline.html', 'fixtures/injection/child.html']) {
    if (!existsSync(join(distRoot, file))) throw new Error(`Missing diagnostic build entry: ${file}`);
  }

  if (dryRun) {
    printChecklist(origin, chromePath, 'dry-run only');
    return;
  }

  if (argSet.has('--injection')) {
    const { runInjectionAcceptance } = await import('./chrome-injection-smoke.mjs');
    process.exitCode = await runInjectionAcceptance({ runs: Number(optionValue('--runs', '3')), output: optionValue('--output', null) });
    return;
  }

  const serverInfo = await startLeakTestServer({ projectRoot, host, port });
  const userDataDir = mkdtempSync(join(tmpdir(), 'vanishgeo-chrome-acceptance-'));
  let launchStatus = 'server only; temporary profile';

  if (!noLaunch) {
    if (!chromePath) {
      throw new Error('Chrome binary not found. Set CHROME_BIN or rerun with --no-launch.');
    }
    launchChrome(chromePath, serverInfo.origin, userDataDir);
    launchStatus = 'launched with temporary profile';
  }

  printChecklist(serverInfo.origin, chromePath, launchStatus);

  const shutdown = () => {
    serverInfo.server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = argSet.has('--injection') ? 2 : 1;
});
