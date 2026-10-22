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
  console.log('\n当前候选人工验收清单（dry-run 不执行浏览器断言）：');
  console.log('- Chrome 138+；在 chrome://extensions 详情页正常开启 Allow User Scripts。API/权限/用户开关不可用或注册失败时 fail closed，无 documentId 回退。');
  console.log('- Popup/Options 确认注册成功，再完整 reload 或关闭重开已有页面；旧文档与 BFCache 保持旧快照，无热更新或自动刷新。');
  console.log('- 普通 HTTP(S) 顶层和 iframe 的首 inline 应读取配置语言/时区；未匹配 origin 保持原生，子域规则优先。');
  console.log('- 固定内置名单字体过滤按已启用HTTP(S)规则独立注册；地理位置按独立userScripts状态报告；自定义名单、Worker / SharedWorker 仍暂停；about:blank/srcdoc/data/blob/特殊 sandbox 为 unsupported / UNKNOWN。');
  console.log('- 当前验收证据索引：docs/stabilization/evidence-index.md；推荐流程、定位、字体与语言头按各自生产 runner 和覆盖范围解释。');
  console.log('- 历史 Linux 最小实验和 VG-023 smoke 只证明当时范围；当前候选需记录 earliest、配置切换/reload、关闭恢复、完整退出重启及未支持边界，不把 dry-run 当真实 Chrome 通过。');
  console.log('- Accept-Language 从有效语言 payload 同步，需核对请求头与新文档语言；可靠关闭入口为插件总开关，等待保存/同步后完整重载，再按需关闭 Allow User Scripts。直接关闭 Chrome 开关不保证首请求原生。WebRTC policy 独立报告，其同步不等于 ICE 网络防护通过。dry-run 不执行网络或浏览器验收。');
  console.log('- 扩展 diagnostic/report.html 可比较实际值；observation mode leak-test 只展示观测 / UNKNOWN，不接收配置。Capture pass-through baseline / Run all checks 是旧完整清单入口，暂停/不支持项不能算配置 PASS。');
  console.log('- pass-through real-device surfaces 保持原生；历史 --injection（chrome-injection-smoke.mjs）、worker/geolocation 全能力 runner 不能作当前候选全通过门禁。');
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
