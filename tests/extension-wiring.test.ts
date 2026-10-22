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

test('manifest uses dynamic injection without background alarms or static all-url content scripts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.name, 'VanishGeo');
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources, []);
  assert.deepEqual(manifest.permissions, [
    'storage',
    'scripting',
    'tabs',
    'contextMenus',
    'privacy',
    'userScripts',
    'declarativeNetRequestWithHostAccess'
  ]);
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.equal(manifest.permissions.includes('alarms'), false);
  assert.equal(manifest.minimum_chrome_version, '138');
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
});

test('保留 runtime 维护源且不作为独立页面文件公开', () => {
  const vite = read('vite.config.ts');
  assert.doesNotMatch(vite, /['"]injected\/runtime['"]\s*:/);
  assert.doesNotMatch(vite, /injected\/injected/);
  assert.equal(exists('src/injected/runtime.ts'), true);
  assert.equal(exists('src/injected/injected.ts'), false);
});

test('生产页面由 userScripts 提前注册，仅清理旧初始化脚本', () => {
  const services = read('src/background/services.ts');
  assert.match(services, /unregisterContentScripts/);
  assert.doesNotMatch(services, /applyVanishGeoRuntime|executeScript|\.registerContentScripts\(/);
  assert.doesNotMatch(services, /matches: \['<all_urls>'\]/);
});

test('content initialization exposes no page-controlled postMessage bridge or payload input', () => {
  const content = read('src/content/content.ts');
  const runtime = read('src/injected/runtime.ts');
  const router = read('src/background/message-router.ts');

  assert.doesNotMatch(content + router + read('src/background/services.ts'), /initializeRuntimeForSender|documentIds|executeScript/);
  const scripts = read('src/background/page-scripts.ts');
  assert.match(scripts, /world: 'MAIN'/);
  assert.match(scripts, /runAt: 'document_start'/);
  assert.match(scripts, /allFrames: true/);
  assert.match(scripts, /excludeMatches/);
  assert.doesNotMatch(scripts, /eval\(|new Function|postMessage|import\(/);
  assert.doesNotMatch(content, /window\.(postMessage|addEventListener)/);
  assert.doesNotMatch(content, /payload|location\.href/);
  assert.doesNotMatch(runtime, /apply-spoof|vanishgeo-extension|window\.postMessage/);
  assert.match(router, /requireExtensionPage/);
  assert.match(router, /sender\.id !== chrome\.runtime\.id/);
  assert.match(router, /sender\.url\?\.startsWith\(extensionRoot\)/);
});

test('language spoofing uses native-backed Navigator getter proxies', () => {
  const runtime = read('src/injected/runtime-modules/surfaces/navigator.ts');
  assert.doesNotMatch(runtime, /defineOwnProperty\(navigatorTarget,\s*'language'/);
  assert.doesNotMatch(runtime, /defineOwnProperty\(navigatorTarget,\s*'languages'/);
  assert.match(runtime, /createNativeProxyFunction\(globals,\s*nativeGetter/);
  assert.match(runtime, /defineRuntimeProperty\(globals,\s*realmState,\s*navigatorPrototype,\s*property/);
  assert.match(runtime, /installNativeBackedNavigatorGetter\(globals,\s*realmState,\s*'language'/);
  assert.match(runtime, /installNativeBackedNavigatorGetter\(globals,\s*realmState,\s*'languages'/);
});

test('页面与 Worker 维护源不写入全局 marker 或替换全局反射 API', () => {
  for (const file of ['src/injected/runtime-modules/registry.ts', 'src/injected/runtime-modules/worker/registry.ts']) {
    const runtime = read(file);
    assert.doesNotMatch(runtime, /hiddenProperties|functionSources|Symbol\.for|reflectionInstalled/);
    assert.doesNotMatch(runtime, /(?:Object|Reflect|prototype)\.(?:toString|getOwnPropertyDescriptor|getOwnPropertyDescriptors|getOwnPropertyNames|getOwnPropertySymbols|ownKeys)\s*=/);
  }
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
  assert.match(script, /observationModeSummary/);
  assert.doesNotMatch(script, /readExpectedProfile|expected[A-Z]|actualWebRtc|compareDiagnostic|summarizeDiagnostic/);
  assert.doesNotMatch(script, /chrome\.runtime|sendRuntimeMessage|window\.postMessage/);
  assert.match(script, /hosted HTTPS target/);
  assert.match(script, /\/headers\.json/);
  assert.match(script, /UNKNOWN/);
  assert.match(script, /stun:stun\.l\.google\.com:19302/);
  assert.match(server, /dist\/leak-test\/leak-test\.html/);
  assert.match(server, /headers\.json/);
  assert.match(server, /localhost/);
  assert.match(services, /LEAK_TEST_URL/);
  assert.doesNotMatch(services, /appendExpectedProfileParams|expected(?:Profile|Language|Timezone|Latitude|Longitude)|actualWebRtc/);
  assert.doesNotMatch(html, /expected[A-Z]|validation=acceptance/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(script, /referrerPolicy:\s*'no-referrer'/);
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
  assert.doesNotMatch(script, /expected[A-Z]|leakTestQuery/);
  assert.match(script, /observation mode/);
  assert.match(script, /Capture pass-through baseline/);
  assert.match(script, /Run all checks/);
  assert.match(script, /PASS/);
  assert.match(script, /UNKNOWN/);
  assert.match(script, /Accept-Language/);
  assert.match(script, /WebRTC policy/);
  assert.match(script, /pass-through real-device surfaces/);
  assert.doesNotMatch(script, /playwright|puppeteer/i);
});

test('扩展报告入口不可供网页访问，诊断生命周期和采样边界接线完整', () => {
  const vite = read('vite.config.ts');
  const router = read('src/background/message-router.ts');
  const worker = read('src/background/service-worker.ts');
  const runs = read('src/background/diagnostic-runs.ts');
  const probe = read('src/background/diagnostic-probe.ts');
  const report = read('src/diagnostic/report.ts');
  assert.match(vite, /'diagnostic\/report':/);
  assert.match(vite, /src\/diagnostic\/report\.html/);
  assert.match(read('src/diagnostic/report.html'), /type="module" src="report.js"/);
  assert.deepEqual(JSON.parse(read('manifest.json')).web_accessible_resources, []);
  assert.match(router, /requireDiagnosticReport/);
  for (const action of ['prepareDiagnosticRun', 'executeDiagnosticRun', 'cancelDiagnosticRun', 'openDiagnosticTarget', 'getDiagnosticTargets']) assert.match(router, new RegExp(`case '${action}'`));
  assert.match(worker, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(worker, /chrome\.tabs\.onRemoved\.addListener/);
  assert.doesNotMatch(runs + probe + report, /storage\.(local|session)|localStorage|sessionStorage|window\.postMessage/);
  assert.doesNotMatch(probe, /expected|expectation|siteSpoofConfig|EffectivePayload/);
  assert.match(report, /compareDiagnosticEvidence/);
  assert.match(report, /expiresAt - Date\.now/);
  assert.doesNotMatch(report, /\.innerHTML/);
});

test('manifest permission boundary documents active detection and avoids redundant permissions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const permissionsDoc = read('PERMISSIONS.md');

  manifest.permissions.forEach((permission: string) => {
    assert.match(permissionsDoc, new RegExp(`\`${permission}\``));
  });
  assert.match(permissionsDoc, /`<all_urls>`/);
  assert.match(permissionsDoc, /optional host permissions 暂不处理/);
  assert.match(permissionsDoc, /`activeTab` 不申请/);
  assert.match(permissionsDoc, /`alarms` 已移除/);
  assert.equal(manifest.permissions.includes('activeTab'), false);
});

test('configuration UI wires explicit exit-profile selection, active detection, WebRTC, and selective font exposure controls', () => {
  const popupHtml = read('src/popup/popup.html');
  const popupScript = read('src/popup/popup.ts');
  const optionsHtml = read('src/options/options.html');
  const optionsScript = read('src/options/options.ts');

  [
    'siteStatusBadge',
    'siteStatusDetail',
    'currentExitProfile',
    'currentExitProfileSelect',
    'manageExitProfiles'
  ].forEach((id) => assert.match(popupHtml, new RegExp(`id="${id}"`)));
  assert.match(popupScript, /deriveCurrentSiteStatus/);
  assert.match(popupScript, /exitLocationProfileId/);
  assert.doesNotMatch(popupScript, /freezeIpLocationToManualConfig/);

  [
    'detectExitLocation',
    'exitLocationProfiles',
    'webrtcPolicyStatus',
    'fontExposureEnabled',
    'fontExposureMode',
    'fontExposureVendorFamilies',
    'fontExposureBlockedFamilies',
    'resetFonts'
  ].forEach((id) => assert.match(optionsHtml, new RegExp(`id="${id}"`)));
  assert.match(optionsHtml, /data-tab="font-exposure"/);
  assert.match(optionsScript, /getWebRtcConfig/);
  assert.match(optionsScript, /DEFAULT_FONT_EXPOSURE/);
  assert.match(optionsScript, /confirmExitLocationDetection/);
  assert.match(optionsScript, /renameExitLocationProfile/);
  assert.match(optionsScript, /deleteExitLocationProfile/);
  assert.doesNotMatch(optionsScript, /freezeIpLocationToManualConfig/);
});

test('popup uses extension-safe fixed viewport with internal scrolling', () => {
  const css = read('src/popup/popup.css');

  assert.match(css, /html\s*\{[^}]*width:\s*380px;[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /body\s*\{[^}]*width:\s*380px;[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.container\s*\{[^}]*height:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /footer\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
  assert.doesNotMatch(css, /footer\s*\{[^}]*(position:\s*sticky|position:\s*fixed)/s);
});

test('Popup 与 Options 共用规则文本显示及合并实现', () => {
  for (const file of ['src/popup/popup.ts', 'src/options/options.ts']) {
    const script = read(file);
    assert.match(script, /import\s*\{\s*ruleListToText,\s*rulesFromText\s*\}\s*from\s*'\.\.\/shared\/rule-list'/);
    assert.match(script, /rulesFromText\(ruleListEl\.value,\s*currentConfig\.rules\)/);
    assert.match(script, /ruleListEl\.value\s*=\s*ruleListToText\(config\.rules\)/);
    assert.doesNotMatch(script, /function\s+rulesFromText|existingByDomain|normalizeDomain|createRule/);
  }
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

test('运行时对账在 worker 启动及生命周期事件接线，管理页有常驻状态和受保护重试', () => {
  const worker = read('src/background/service-worker.ts');
  assert.match(worker, /onInstalled\.addListener/);
  assert.match(worker, /onStartup\.addListener/);
  assert.match(worker, /runBackgroundTask\('运行时对账', services\.initializeExtension\(\)\)/);
  const router = read('src/background/message-router.ts');
  assert.ok(router.indexOf('requireExtensionPage(sender);') < router.indexOf("case 'reconcileRuntime'"));
  assert.match(router, /saved: true/);
  assert.match(router, /syncReport\.status === 'ok' \? 'ok' : 'partial'/);
  for (const page of ['popup', 'options']) {
    const html = read(`src/${page}/${page}.html`);
    const script = read(`src/${page}/${page}.ts`);
    assert.match(html, /id="runtimeSyncStatus" role="status" aria-live="polite"/);
    assert.match(html, /id="retryRuntimeSync"/);
    assert.match(script, /renderRuntimeSyncReport/);
    assert.match(script, /action: 'reconcileRuntime'/);
  }
});

test('VG-009 Chrome入口和扩展时序报告接线，fixture没有预期桥或runtime marker', () => {
  const script = read('scripts/chrome-acceptance.mjs');
  assert.match(script, /fixtures\/injection\/earliest-inline\.html/);
  assert.match(script, /--injection/);
  assert.match(script, /chrome-injection-smoke\.mjs/);
  assert.match(read('src/background/message-router.ts'), /executeInjectionTimingRun[\s\S]*requireDiagnosticReport\(sender\)/);
  assert.match(read('src/diagnostic/report.ts'), /executeInjectionTimingRun/);
  const fixture = read('fixtures/injection/earliest-inline.html');
  assert.match(fixture, /<head>\s*<script>/);
  assert.match(fixture, /srcdoc\.srcdoc = html/);
  assert.match(fixture, /blank\.contentDocument\.write\(html\)/);
  assert.doesNotMatch(fixture, /chrome\.runtime|postMessage|localStorage|expected|__vanish/);
  assert.doesNotMatch(read('scripts/chrome-injection-smoke.mjs'), /playwright|puppeteer|stun:|https:\/\//i);
});

test('字体 UI 无请求头编辑或 Canvas 伪装，内置名单只读且独立报告运行状态', () => {
  for (const page of ['popup', 'options']) {
    const html = read(`src/${page}/${page}.html`);
    const script = read(`src/${page}/${page}.ts`);
    assert.doesNotMatch(html + script, /acceptLanguage|Canvas spoof|Canvas 指纹伪装|Canvas 字体伪装|DNR 请求头规则|DNR Accept-Language/);
    assert.match(html, /字体暴露过滤/);
    assert.match(html, /id="fontExposureStatus".*aria-live="polite"/);
    assert.match(script, /renderFontRuntimeStatus\(fontExposureStatusEl, report(?:, 'compact')?\)/);
    if (page === 'options') {
      assert.match(html, /不影响语言\/时区注册状态/);
      assert.match(html, /顶层.*measureText\(\).*monospace.*sans-serif.*serif/);
      assert.match(html, /FontFaceSet.check\(\).*iframe.*内置厂商／软件及简繁中文字体/);
      assert.match(html, /不覆盖 DOM 尺寸.*local\(\).*像素比对.*OffscreenCanvas.*Worker/);
      assert.match(html, /不会随机化 Canvas 图像，也不会修改 WebGL、GPU 或硬件信息/);
      assert.match(html, /兼容性/);
    } else {
      assert.match(html, /自定义名单暂不应用。覆盖范围见完整配置/);
    }
    assert.match(html, /value="vendor-software"/);
    assert.match(html, /value="custom"/);
    assert.match(html, /id="fontExposureVendorFamilies"[^>]*readonly/);
    assert.match(html, /id="fontExposureBlockedFamilies"[^>]*><\/textarea>/);
    assert.match(script, /VENDOR_SOFTWARE_FONT_FAMILIES/);
    assert.match(read(`src/${page}/${page}.css`), /\.input-group\[hidden\]\s*\{\s*display:\s*none;/);
  }
});

test('DNR仅恢复host约束权限，随包默认隔离覆盖全部HTTP资源并先迁移再同步', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.permissions.filter((permission: string) => permission.startsWith('declarativeNetRequest')), ['declarativeNetRequestWithHostAccess']);
  const [resource] = manifest.declarative_net_request.rule_resources;
  assert.equal(resource.enabled, true);
  const [guard] = JSON.parse(read(resource.path));
  assert.equal(guard.priority, 2147483647);
  assert.equal(guard.action.type, 'allow');
  for (const type of ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'webtransport', 'webbundle']) assert.ok(guard.condition.resourceTypes.includes(type));
  assert.match(read('src/background/header-rules.ts'), /rule.id === 1001 \|\| rule.id === 1002/);
  assert.match(read('vite.config.ts'), /src: 'rules'/);
  const permissions = read('PERMISSIONS.md');
  assert.match(permissions, /declarativeNetRequestWithHostAccess/);
  assert.match(permissions, /磁盘|残留/);
  assert.match(permissions, /1001/);
});
