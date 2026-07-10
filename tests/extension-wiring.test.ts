import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

test('manifest uses dynamic injection instead of static all-url content scripts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.name, 'VanishGeo');
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources, []);
  assert.deepEqual(manifest.permissions, [
    'storage',
    'alarms',
    'scripting',
    'tabs',
    'contextMenus',
    'privacy',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess'
  ]);
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
});

test('vite builds the single injected runtime entry', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /injected\/runtime/);
  assert.doesNotMatch(vite, /injected\/injected/);
  assert.equal(exists('src/injected/runtime.ts'), true);
  assert.equal(exists('src/injected/injected.ts'), false);
});

test('background registers only dynamic runtime and bridge scripts', () => {
  const services = read('src/background/services.ts');
  assert.match(services, /const MAIN_RUNTIME_FILES = \['injected\/runtime\.js'\]/);
  assert.match(services, /const BRIDGE_FILES = \['content\/content\.js'\]/);
  assert.doesNotMatch(services, /matches: \['<all_urls>'\]/);
});

test('language spoofing uses native-backed Navigator getter proxies', () => {
  const runtime = read('src/injected/runtime.ts');
  assert.doesNotMatch(runtime, /defineOwnProperty\(navigatorTarget,\s*'language'/);
  assert.doesNotMatch(runtime, /defineOwnProperty\(navigatorTarget,\s*'languages'/);
  assert.match(runtime, /createNativeProxyFunction\(globals,\s*realmState,\s*nativeGetter/);
  assert.match(runtime, /defineRegisteredProperty\(globals,\s*realmState,\s*navigatorPrototype,\s*property/);
  assert.match(runtime, /installNativeBackedNavigatorGetter\(globals,\s*realmState,\s*'language'/);
  assert.match(runtime, /installNativeBackedNavigatorGetter\(globals,\s*realmState,\s*'languages'/);
});

test('runtime centralizes hidden markers behind reflection virtualization', () => {
  const runtime = read('src/injected/runtime.ts');
  assert.match(runtime, /function getAntiDetectionState/);
  assert.match(runtime, /registerHiddenProperty\(state,\s*globals,\s*anchor\)/);
  assert.match(runtime, /Object\.getOwnPropertySymbols/);
  assert.match(runtime, /Reflect\.ownKeys/);
  assert.match(runtime, /Function\.prototype\.toString/);
  assert.doesNotMatch(runtime, /__vanishGeo(RuntimeReady|Originals|WorkerHooked|CanvasHooked|GeolocationController|Debug)/);
});

test('legacy VanishMe storage key is confined to migration code', () => {
  const files = [
    'src/shared/config-model.ts',
    'src/shared/config-resolver.ts',
    'src/shared/storage.ts',
    'src/content/content.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
    'src/background/services.ts'
  ];
  const offenders = files
    .filter((file) => !file.includes('config-') && file !== 'src/shared/storage.ts')
    .filter((file) => read(file).includes('bpg_config'));
  assert.deepEqual(offenders, []);
});

test('extension UI does not expose regional preset quick settings', () => {
  const popup = read('src/popup/popup.html');
  const options = read('src/options/options.html');
  const optionsScript = read('src/options/options.ts');

  assert.equal(popup.includes('data-profile='), false);
  assert.equal(options.includes('defaultProfiles'), false);
  assert.equal(options.includes('预设配置'), false);
  assert.equal(optionsScript.includes('DEFAULT_PROFILES'), false);
});

test('leak test has hosted and localhost target workflows for allowlist validation', () => {
  const pkg = JSON.parse(read('package.json'));
  const html = read('src/leak-test/leak-test.html');
  const script = read('src/leak-test/leak-test.ts');
  const server = read('scripts/serve-leak-test.mjs');
  const services = read('src/background/services.ts');

  assert.equal(pkg.scripts['serve:leak-test'], 'node scripts/serve-leak-test.mjs');
  assert.equal(exists('scripts/serve-leak-test.mjs'), true);
  assert.match(html, /id="runtimeOriginNotice"/);
  assert.match(html, /id="overallStatus"/);
  assert.match(html, /id="languageSwitch"/);
  assert.match(html, /id="uiLangZh"/);
  assert.match(html, /id="uiLangEn"/);
  assert.match(html, /id="languageChecks"/);
  assert.match(html, /id="timezoneChecks"/);
  assert.match(html, /id="geolocationChecks"/);
  assert.match(html, /id="webrtcChecks"/);
  assert.match(html, /id="realmChecks"/);
  assert.match(html, /id="passThroughChecks"/);
  assert.match(html, /Capture pass-through baseline/);
  assert.match(html, /observation mode/i);
  assert.match(html, /https:\/\/leak\.962850\.xyz\/leak-test\/leak-test\.html/);
  assert.match(html, /localhost/);
  assert.match(script, /chrome-extension:/);
  assert.match(script, /Launcher\/baseline only/);
  assert.match(script, /VanishGeo 隐私检测/);
  assert.match(script, /PASS 通过/);
  assert.match(script, /uiLanguageKey/);
  assert.match(script, /validationMode:\s*ValidationMode/);
  assert.match(script, /observationModeSummary/);
  assert.match(script, /appendExpectedProfileParams|expectedWebRtcPolicy/);
  assert.match(script, /actualWebRtcPolicy/);
  assert.match(script, /actualWebRtcLeakProtectionActive/);
  assert.match(script, /hosted HTTPS target/);
  assert.match(script, /\/headers\.json/);
  assert.match(script, /PASS/);
  assert.match(script, /FAIL/);
  assert.match(script, /UNKNOWN/);
  assert.match(script, /stun:stun\.l\.google\.com:19302/);
  assert.match(server, /dist\/leak-test\/leak-test\.html/);
  assert.match(server, /headers\.json/);
  assert.match(server, /localhost/);
  assert.match(services, /LEAK_TEST_URL/);
  assert.match(services, /appendExpectedProfileParams/);
  assert.match(services, /expectedLanguage/);
  assert.match(services, /expectedTimezoneOffset/);
  assert.match(services, /expectedLatitude/);
  assert.match(services, /expectedLocaleStringTimestamp/);
  assert.match(services, /expectedLocaleString/);
  assert.match(services, /actualWebRtcPolicy/);
  assert.match(services, /url\.searchParams\.set\('ui', 'zh'\)/);
});

test('Chrome acceptance entry covers P0 live validation surfaces without a heavy framework', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/chrome-acceptance.mjs');

  assert.equal(pkg.scripts['test:e2e:chrome'], 'node scripts/chrome-acceptance.mjs');
  assert.equal(exists('scripts/chrome-acceptance.mjs'), true);
  assert.match(script, /--load-extension/);
  assert.match(script, /\/leak-test\/leak-test\.html/);
  assert.match(script, /\/headers\.json/);
  assert.match(script, /\/fixtures\/iframe\/top\.html/);
  assert.match(script, /\/fixtures\/workers\/top\.html/);
  assert.match(script, /\/fixtures\/geolocation\/top\.html/);
  assert.match(script, /expectedLanguage/);
  assert.match(script, /Capture pass-through baseline/);
  assert.match(script, /Run all checks/);
  assert.match(script, /PASS/);
  assert.match(script, /UNKNOWN/);
  assert.match(script, /Accept-Language/);
  assert.match(script, /WebRTC policy/);
  assert.match(script, /pass-through real-device surfaces/);
  assert.doesNotMatch(script, /playwright|puppeteer/i);
});

test('manifest permission boundary is documented and avoids redundant activeTab', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const permissionsDoc = read('PERMISSIONS.md');

  manifest.permissions.forEach((permission: string) => {
    assert.match(permissionsDoc, new RegExp(`\`${permission}\``));
  });
  assert.match(permissionsDoc, /`<all_urls>`/);
  assert.match(permissionsDoc, /optional per-site host permissions is intentionally deferred/);
  assert.match(permissionsDoc, /`activeTab` is intentionally not requested/);
  assert.equal(manifest.permissions.includes('activeTab'), false);
});

test('configuration UI wires site status, IP freeze, WebRTC, and Canvas controls', () => {
  const popupHtml = read('src/popup/popup.html');
  const popupScript = read('src/popup/popup.ts');
  const optionsHtml = read('src/options/options.html');
  const optionsScript = read('src/options/options.ts');

  [
    'siteStatusBadge',
    'siteStatusDetail',
    'effectiveGeolocationSource',
    'effectiveGeolocationValue',
    'effectiveTimezoneSource',
    'effectiveTimezoneValue',
    'freezeIpProfile'
  ].forEach((id) => assert.match(popupHtml, new RegExp(`id="${id}"`)));
  assert.match(popupScript, /deriveCurrentSiteStatus/);
  assert.match(popupScript, /freezeIpLocationToManualConfig/);

  [
    'effectiveGeolocationSource',
    'effectiveTimezoneSource',
    'freezeIpProfile',
    'webrtcPolicyStatus',
    'canvasEnabled',
    'canvasSpoofFonts',
    'canvasTargetFonts',
    'resetFonts'
  ].forEach((id) => assert.match(optionsHtml, new RegExp(`id="${id}"`)));
  assert.match(optionsHtml, /data-tab="canvas"/);
  assert.match(optionsScript, /getWebRtcConfig/);
  assert.match(optionsScript, /DEFAULT_CANVAS/);
  assert.match(optionsScript, /freezeIpLocationToManualConfig/);
});

test('popup uses extension-safe fixed viewport with internal scrolling', () => {
  const css = read('src/popup/popup.css');

  assert.match(css, /html\s*\{[^}]*width:\s*380px;[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /body\s*\{[^}]*width:\s*380px;[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.container\s*\{[^}]*height:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /footer\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
  assert.doesNotMatch(css, /footer\s*\{[^}]*(position:\s*sticky|position:\s*fixed)/s);
});

test('extension UI uses OLED security green as the primary action color', () => {
  const styles = [
    read('src/popup/popup.css'),
    read('src/options/options.css'),
    read('src/leak-test/leak-test.css')
  ];

  styles.forEach((css) => {
    assert.match(css, /--bg:\s*#020617;/);
    assert.match(css, /--primary:\s*#22c55e;/);
    assert.match(css, /--info:\s*#60a5fa;/);
    assert.doesNotMatch(css, /--primary:\s*#f59e0b;/);
  });
});
