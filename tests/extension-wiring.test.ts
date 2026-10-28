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
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('webNavigation'), '按 frame 投递需要 webNavigation.getAllFrames');
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

test('runtime 只有一条注入路径：导航不再由 tabs.onUpdated 注入脚本', () => {
  const worker = read('src/background/service-worker.ts');
  // 注入只发生在 updateAllTabs 的 ensureRuntimeInDocument 里，且按 documentId 去重
  assert.doesNotMatch(worker, /injectScript|syncTab/);
  assert.match(worker, /services\.bootstrap\(\)/);
  assert.match(worker, /services\.applyConfig\(\)/);
  // 配置变化不再走 initializeExtension（那会连带强制拉一次 IP 定位）
  assert.doesNotMatch(read('src/background/services.ts'), /initializeExtension/);
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

test('manifest 版本与 package.json 保持一致', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.notEqual(pkg.version, '1.0.0');
});

test('Worker 补丁在每次创建时按当前状态生成，而不是冻结在装载瞬间', () => {
  const runtime = read('src/injected/runtime.ts');
  const install = runtime.slice(runtime.indexOf('function installWorker'));

  // 补丁源码必须现算：makeWorkerUrl 里调用 currentWorkerPatchSource()
  assert.match(install, /const patchSource = currentWorkerPatchSource\(\)/);
  assert.doesNotMatch(install, /const patchSource = buildWorkerPatch\(/);
  // 没有可补丁目标时要回落到原生构造，不能造一个空补丁的 blob
  assert.match(install, /if \(!patchedUrl\) return new NativeWorker\(scriptURL, options\)/);
  // 自包含的补丁实现已经搬到独立模块，runtime 只负责调用
  assert.match(runtime, /import \{ workerPatch \} from '\.\/worker-patch'/);
  assert.equal(exists('src/injected/worker-patch.ts'), true);
});

test('注入层补丁必须自包含：产物里不能出现打包器注入的模块级 helper', () => {
  if (!exists('dist/injected/runtime.js')) return;
  const bundle = read('dist/injected/runtime.js');

  // workerPatch.toString() 是运行时执行的，任何模块作用域引用都会在 Worker 里
  // 变成 ReferenceError —— 这个 Worker 会直接死掉，页面拿到的是"Worker 加载失败"。
  assert.doesNotMatch(bundle, /\b__name\s*\(/, 'esbuild keepNames 打开的瞬间 Worker 补丁就会失效');
  assert.match(bundle, /importScripts\(/, 'Worker 入口靠 importScripts 加载原脚本');
  assert.doesNotMatch(bundle, /^\s*import\s/m, 'injected/runtime.js 必须是经典脚本');
});

test('payload 通道是私有 MessagePort，不再经 window.postMessage 广播', () => {
  const runtime = read('dist/injected/runtime.js');
  const content = read('dist/content/content.js');
  const services = read('src/background/services.ts');

  // 旧模型：nonce 和 payload 一起 postMessage 出去，页面的 message 监听器能读到两者
  assert.doesNotMatch(runtime, /postMessage\(\s*\{[^}]*__vanishGeo[^}]*payload/s);
  // 广播里只允许出现握手，payload 永远只能走端口
  assert.doesNotMatch(content, /window\.postMessage\(\s*\{[^}]*payload/);
  assert.match(content, /window\.postMessage\(\{ __vanishGeo: "handshake" \}, "\*", \[channel\.port2\]\)/);
  assert.match(content, /new MessageChannel\(\)/);
  assert.match(content, /postMessage\([^)]*\[[^\]]*port2[^\]]*\]/);
  // 握手同步发出：document_start 时页面还没有监听器
  assert.doesNotMatch(content, /setTimeout\(\s*handshake\s*,/);

  // runtime 收下端口后立刻摘掉 window 监听器，之后没有可观测的握手
  assert.match(runtime, /removeEventListener\(["']message["'], onHandshake\)/);
  // 端口消息仍要校验 nonce
  assert.match(runtime, /__vanishGeo !== NONCE/);

  // 后台推 payload 走 tabs.sendMessage → ISOLATED 桥 → 端口
  assert.match(services, /chrome\.tabs\.sendMessage\(tabId, message\)/);
  assert.match(services, /payload === null[\s\S]{0,80}clear: true/);
  // 排除站点 / 关总开关时桥必须收到 clear，否则烘焙值会一直留在页面上
  assert.match(services, /clearUnmatched: true/);
});

test('不透明来源的 iframe 也注入（否则 srcdoc 里能读到原生对象）', () => {
  const services = read('src/background/services.ts');
  assert.equal((services.match(/matchOriginAsFallback: true/g) || []).length, 2);

  const vite = read('vite.config.ts');
  assert.equal((vite.match(/match_about_blank: true/g) || []).length, 2);
});

test('字体伪装三层的开关必须真的接到界面上', () => {
  const popup = read('src/popup/popup.html');
  const popupTs = read('src/popup/popup.ts');

  // 平台层只有 auto / none：手动选另一个平台等于假装成另一台机器，已移除
  assert.match(popup, /id="canvasPlatform"/);
  for (const value of ['auto', 'none']) {
    assert.match(popup, new RegExp(`<option value="${value}"`), `缺少 platform 选项 ${value}`);
  }
  for (const value of ['mac', 'windows', 'linux']) {
    assert.doesNotMatch(popup, new RegExp(`<option value="${value}"`), `不该再有平台声称 ${value}`);
  }
  assert.match(popup, /id="canvasHideCjk"/);

  // 读了、写了、监听了
  assert.match(popupTs, /getElementById\('canvasPlatform'\)/);
  assert.match(popupTs, /getElementById\('canvasHideCjk'\)/);
  assert.match(popupTs, /canvasPlatformEl\.value = config\.canvas\.platform/);
  assert.match(popupTs, /canvasHideCjkEl\.checked = config\.canvas\.hideCjkFonts/);
  assert.match(popupTs, /platform: canvasPlatformEl\.value/);
  assert.match(popupTs, /hideCjkFonts: canvasHideCjkEl\.checked/);
  assert.match(popupTs, /canvasPlatformEl\.addEventListener\('change'/);
  assert.match(popupTs, /canvasHideCjkEl\.addEventListener\('change'/);
});

test('注入层自己解析三层字体：background 不得引用 font-aliases', () => {
  const runtime = read('src/injected/runtime.ts');
  // 解析放在注入层，否则 Rollup 会把 font-aliases 抽成共享 chunk，
  // runtime.js 里出现 import，MAIN world 的经典脚本直接语法错误。
  assert.match(runtime, /resolveCanvasTargetFonts\(/);

  for (const path of ['src/shared/config-model.ts', 'src/shared/config-resolver.ts', 'src/background/services.ts']) {
    if (!exists(path)) continue;
    assert.doesNotMatch(read(path), /from '\.\.?\/[^']*font-aliases'/,
      `${path} 引用 font-aliases 会把注入脚本打成 chunk`);
  }
});

test('首屏零窗口路径可走：选项页有导出按钮，后台有对应消息动作', () => {
  const html = read('src/options/options.html');
  const optionsTs = read('src/options/options.ts');
  const router = read('src/background/message-router.ts');
  const services = read('src/background/services.ts');

  assert.match(html, /id="exportBake"/, '选项页缺少「导出烘焙配置」按钮');
  assert.match(optionsTs, /getBakeSnapshot/, '选项页没有请求烘焙快照');
  assert.match(router, /case 'getBakeSnapshot'/, '后台没有 getBakeSnapshot 动作');
  assert.match(services, /async function getBakeSnapshot/, 'services 没有实现 getBakeSnapshot');
  // 烘焙脚本吃掉的就是这个形状，改了字段名等于让导出文件不可用
  assert.match(services, /config: SiteSpoofConfig; lastLocation: LastLocation \| null/, '快照形状必须与 build-persona --config 对齐');
});

test('「跟随出口 IP」开关从头到尾接得上：配置页控件 → 消息动作 → services 实现', () => {
  const html = read('src/options/options.html');
  const optionsTs = read('src/options/options.ts');
  const router = read('src/background/message-router.ts');
  const services = read('src/background/services.ts');

  for (const id of ['ipSyncEnabled', 'ipSyncLanguage', 'ipSyncInterval', 'ipSyncNow', 'ipSyncStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `配置页缺少 #${id}`);
    assert.match(optionsTs, new RegExp(`getElementById\\('${id}'\\)`), `options.ts 没有接线 #${id}`);
  }
  assert.match(router, /case 'getExitIpSyncState'/, '后台没有 getExitIpSyncState 动作');
  assert.match(router, /case 'checkExitIpSync'/, '后台没有 checkExitIpSync 动作');
  assert.match(services, /async function getExitIpSyncState/, 'services 没有实现 getExitIpSyncState');
  assert.match(services, /async function checkExitIp/, 'services 没有实现 checkExitIp');
  // 开关打开时必须按 auto 提交时区/坐标，否则点一次保存就把 auto 改回手动
  assert.match(optionsTs, /mode: ipSyncOn \? 'auto'/, 'geolocation 模式没有跟随开关');
});

test('配置体检必须真的接到诊断页上，且修法能被点', () => {
  const html = read('src/leak-test/leak-test.html');
  const ts = read('src/leak-test/leak-test.ts');
  const css = read('src/leak-test/leak-test.css');

  assert.match(html, /id="auditList"/, '诊断页缺少体检容器');
  assert.match(ts, /auditConfig\(/, '诊断页没有调用体检逻辑');
  assert.match(ts, /fix\.apply\(/, '修法必须真的被应用');
  assert.match(ts, /chrome\.storage\.local\.set/, '修完要写回存储，否则刷新就丢');
  for (const severity of ['error', 'warn', 'info']) {
    assert.ok(css.includes(`.audit-item.${severity}`), `缺少 ${severity} 档的样式`);
  }
});

test('发布流水线接得上：npm 脚本、校验工具、三道闸都在', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.release, 'node scripts/release.mjs');
  assert.equal(pkg.scripts['verify:release'], 'node tools/verify-release.mjs');

  const release = read('scripts/release.mjs');
  // 三道闸：产物校验、版本一致、静态规则非空，都要在打包之前跑
  assert.match(release, /verifyBakedRuntime\(/, '必须真的校验产物内容');
  assert.match(release, /manifestVersion/, '必须比对 manifest 与 package 版本');
  assert.ok(
    release.indexOf('verifyBuild(target)') < release.indexOf('writeFileSync(zipPath'),
    '校验必须在出包之前'
  );
  // 中间态留下的 persona.config.json 不能泄漏到仓库里
  assert.match(release, /rmSync\(personaFile/, '构建完要清掉 persona.config.json');
  assert.match(read('.gitignore'), /^release\/$/m);

  const verify = read('tools/verify-release.mjs');
  assert.match(verify, /__first/, '首屏校验必须在 document_start 抓快照');
  assert.match(verify, /host-resolver-rules/, '要把包里的域名指到本地');
});

test('不透明框架（about:blank / srcdoc）用 referrer 解析 payload', () => {
  const content = read('src/content/content-bridge.ts');
  assert.match(content, /resolvePayloadUrl\(environment\.window\.location\.href, environment\.document\.referrer\)/);
  assert.match(content, /url: payloadUrl\(\)/);
  assert.doesNotMatch(content, /url: environment\.window\.location\.href/);

  // runtime 与 content 同时 import shared/frame-url 会抽出共享 chunk，
  // 而 MAIN world 的经典脚本不能有 import —— 所以 runtime 保持自包含。
  const runtime = read('src/injected/runtime.ts');
  assert.match(runtime, /new URL\(document\.referrer\)\.hostname/);
  assert.doesNotMatch(runtime, /from '\.\.\/shared\/frame-url'/);
});

test('manifest 声明最低 Chrome 版本（world: MAIN / matchOriginAsFallback 需要 119+）', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.minimum_chrome_version, '119');
});

test('Worker 包装失败必须上报，不是静默回退', () => {
  const runtime = read('dist/injected/runtime.js');
  const bridge = read('dist/content/content.js');

  assert.match(runtime, /kind: "workerFallback"/, 'runtime 没有把回退上报出去');
  assert.match(runtime, /csp-blocked/, 'runtime 没有区分 CSP 拒绝');
  assert.match(bridge, /reportWorkerFallback/, '桥没有把回报转发给后台');

  const router = read('src/background/message-router.ts');
  assert.match(router, /case 'reportWorkerFallback'/);
  const popup = read('src/popup/popup.html');
  assert.match(popup, /id="workerFallback"/, '弹窗缺少可见提示位');

  const leakPage = read('src/leak-test/leak-test.html');
  const leakScript = read('dist/leak-test/leak-test.js');
  assert.match(leakPage, /id="workerCoverage"/, '诊断页缺少 Worker 覆盖行');
  assert.match(leakScript, /getWorkerFallbacks/, '诊断页没有读回退记录');
  assert.match(leakScript, /degraded/, '诊断页没有区分「部分覆盖」');
});

test('SharedWorker 保持原生：声明与 runtime 行为必须一致', () => {
  const runtime = read('dist/injected/runtime.js');

  // 包装 SharedWorker 只能靠 blob 入口，会破坏 (URL, name) 身份；这里守住"没有包装"。
  assert.doesNotMatch(runtime, /SharedWorker/);
  // Worker 仍然被换成包装器 —— 否则这条测试会因为"什么都没做"而假通过
  assert.match(runtime, /replaceGlobal\("Worker", wrapped\)/);

  const coverage = read('src/shared/worker-coverage.ts');
  assert.match(coverage, /sharedWorker:\s*\{[\s\S]{0,80}status: 'unsupported'/);

  const workers = read('tools/smoke-workers.mjs');
  // 回归脚本必须真的能区分"共享一个实例"与"各建一个"
  assert.match(workers, /connections/);
  assert.match(workers, /shared-counter\.js/);
});
