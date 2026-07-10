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

function leakTestQuery() {
  return new URLSearchParams({
    expectedLanguage: 'ja-JP',
    expectedLanguages: 'ja-JP,ja',
    expectedAcceptLanguage: 'ja-JP,ja;q=0.9',
    expectedTimezone: 'Asia/Tokyo',
    expectedTimezoneOffset: '-540',
    expectedLatitude: '35.68',
    expectedLongitude: '139.76',
    expectedGeoToleranceMeters: '1000',
    expectedWebRtcMode: 'strict',
    expectedWebRtcPolicy: 'disable_non_proxied_udp',
    stunUrls: 'stun:stun.l.google.com:19302',
    iceTimeoutMs: '5000'
  }).toString();
}

function acceptanceUrls(origin) {
  return [
    { label: 'PASS/FAIL leak-test verifier', url: `${origin}/leak-test/leak-test.html?${leakTestQuery()}` },
    { label: 'Accept-Language header echo', url: `${origin}/headers.json` },
    { label: 'iframe realm fixture', url: `${origin}/fixtures/iframe/top.html` },
    { label: 'Worker and SharedWorker fixture', url: `${origin}/fixtures/workers/top.html` },
    { label: 'Geolocation behavior fixture', url: `${origin}/fixtures/geolocation/top.html` },
    { label: 'Chrome extension manager', url: 'chrome://extensions/' }
  ];
}

function printChecklist(origin, chromePath, launchStatus) {
  const urls = acceptanceUrls(origin);
  console.log('\nVanishGeo Chrome acceptance target');
  console.log(`- Extension build: ${distRoot}`);
  console.log(`- Local origin: ${origin}`);
  console.log(`- Chrome: ${chromePath || 'not found'}`);
  console.log(`- Launch: ${launchStatus}`);
  console.log('\nOpened / target URLs:');
  urls.forEach((entry) => {
    console.log(`- ${entry.label}: ${entry.url}`);
  });
  console.log('\nManual acceptance checklist:');
  console.log('- Before enabling VanishGeo for `localhost`, open the leak-test verifier and click `Capture pass-through baseline`.');
  console.log('- In the temporary Chrome profile, enable VanishGeo for `localhost`, reload the localhost pages, then click `Run all checks` on the leak-test verifier.');
  console.log('- Configure an explicit test profile: language `ja-JP`, languages `ja-JP, ja`, Accept-Language `ja-JP,ja;q=0.9`, timezone `Asia/Tokyo`, geolocation `35.68,139.76`, WebRTC `strict`.');
  console.log('- On the leak-test verifier, confirm Language, Accept-Language, Timezone, Geolocation, WebRTC ICE, iframe/worker realms, and pass-through surfaces show PASS; policy may be UNKNOWN on hosted pages and must be confirmed from extension options if so.');
  console.log('- Open `/headers.json` and confirm `accept-language` matches the configured Accept-Language value after `localhost` is allowlisted.');
  console.log('- Run the WebRTC ICE check and confirm no local/private or public IP candidate exposure is shown; confirm Chrome WebRTC policy is `disable_non_proxied_udp` from extension options if the hosted verifier reports UNKNOWN.');
  console.log('- On the iframe fixture, confirm same-origin, srcdoc, and about:blank frames match the top-level language/timezone values; cross-origin frames are not part of this P0 acceptance.');
  console.log('- On the worker fixture, confirm classic Worker, module Worker, and SharedWorker language/timezone values match the top-level page.');
  console.log('- Compare pass-through real-device surfaces against the captured baseline: WebGL/GPU, Audio sampleRate, screen, hardware, codec, and WebGPU rows must remain PASS or UNKNOWN only when no baseline was captured.');
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

  if (dryRun) {
    printChecklist(origin, chromePath, 'dry-run only');
    return;
  }

  const serverInfo = await startLeakTestServer({ projectRoot, host, port });
  const userDataDir = mkdtempSync(join(tmpdir(), 'vanishgeo-chrome-acceptance-'));
  let launchStatus = `server only; Chrome profile dir ${userDataDir}`;

  if (!noLaunch) {
    if (!chromePath) {
      throw new Error('Chrome binary not found. Set CHROME_BIN or rerun with --no-launch.');
    }
    launchChrome(chromePath, serverInfo.origin, userDataDir);
    launchStatus = `launched with temporary profile ${userDataDir}`;
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
  process.exit(1);
});
