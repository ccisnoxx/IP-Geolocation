// 执行 Options 维护源，证明引导的主动性、确认门槛和失败文案；不是 Chrome 验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import * as uiState from '../src/shared/ui-state';
import * as runtimeSync from '../src/shared/runtime-sync';
import { recommendExitEnvironment } from '../src/shared/exit-recommendation';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import type { RuntimeSyncReport } from '../src/shared/types';

function harness() {
  class Element {
    value = ''; checked = false; disabled = false; open = false; textContent = ''; className = ''; placeholder = '';
    dataset: Record<string, string> = {}; children: Element[] = []; classList = { add() {}, remove() {} };
    set innerHTML(_value: string) { this.children = []; }
    addEventListener() {} setAttribute() {}
    append(...children: Element[]) { this.children.push(...children); }
    appendChild(child: Element) { this.children.push(child); }
  }
  class Option extends Element { constructor(text: string, value: string) { super(); this.textContent = text; this.value = value; } }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const requests: any[] = [];
  let config = configModel.createInitialConfig();
  const ok = () => ({ status: 'ok' as const, errors: [] });
  const report: RuntimeSyncReport = { configSignature: 'synthetic', status: 'ok', metadataError: null,
    components: { contentScripts: ok(), webrtc: ok(), tabReload: ok() } };
  let accept = false;
  let failure = false;
  let pending: Promise<void> | null = null;
  const context = vm.createContext({ ...configModel, ...uiState, ...runtimeSync, ruleListToText, rulesFromText, recommendExitEnvironment,
    formatCoordinate: String, Option,
    document: { getElementById: element, createElement: () => new Element(), querySelectorAll: (selector: string) => selector === 'button, input, select, textarea' ? [...elements.values()] : [] },
    confirm: () => accept, prompt: () => '合成出口', alert() {},
    chrome: { runtime: { sendMessage: async (request: any, callback: (result: any) => void) => {
      requests.push(structuredClone(request));
      if (request.action === 'getWebRtcConfig') return callback({ status: 'ok', state: { config: config.webRtc, effectivePolicy: null, policyState: {} } });
      if (request.action === 'detectExitLocation') return callback({ status: 'ok', preview: { detectionId: 'synthetic', candidate: { publicIp: '203.0.113.10', country: 'Synthetic', timezone: 'UTC', latitude: 0, longitude: 0 } } });
      if (request.action === 'cancelExitLocationDetection') return callback({ status: 'ok' });
      if (pending) await pending;
      if (failure) return callback({ status: 'error', message: '合成写入失败' });
      if (request.action === 'confirmExitLocationDetection') config.exitLocationProfiles = [...config.exitLocationProfiles, { id: 'exit-synthetic', name: '合成出口', verification: 'verified',
        publicIp: '203.0.113.10', country: 'Synthetic', countryCode: 'JP', timezone: 'UTC', latitude: 0, longitude: 0, provider: 'synthetic', verifiedAt: 1 }];
      if (request.action === 'completeOnboarding') config = { ...config, masterEnabled: true, rules: [configModel.normalizeRule({ domain: 'example.com', exitLocationProfileId: 'exit-synthetic' })] };
      if (request.action === 'skipOnboarding') config = { ...config, masterEnabled: false, webRtc: { globalMode: 'default' } };
      if (request.action === 'resetSiteConfig') config = configModel.createInitialConfig();
      callback({ status: report.status === 'ok' ? 'ok' : 'partial', config, syncReport: report });
    } } }
  });
  const source = readFileSync(new URL('../src/options/options.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('options.ts', source, ts.ScriptTarget.Latest, true);
  const body = parsed.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(parsed)).join('\n');
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
  return { element, requests, report,
    call: (code: string) => vm.runInContext(code, context),
    addConcurrentProfile() { config.exitLocationProfiles.push({ id: 'exit-other', name: '另一窗口出口', verification: 'verified', publicIp: '203.0.113.20', country: 'Synthetic', countryCode: 'JP', timezone: 'UTC', latitude: 0, longitude: 0, provider: 'synthetic', verifiedAt: 2 }); },
    setAccept(value: boolean) { accept = value; }, setFailure(value: boolean) { failure = value; }, setPending(value: Promise<void> | null) { pending = value; }
  };
}

test('Options打开不检测，取消不确认，未勾选不启用；按用户选择发送引导并区分同步失败/跳过/reset', async () => {
  const ui = harness();
  await new Promise<void>((done) => setImmediate(done));
  assert.deepEqual(ui.requests.map((request) => request.action), ['getSiteConfig', 'getWebRtcConfig']);
  assert.equal(ui.element('setupStatus').dataset.setup, 'unconfigured');
  assert.equal(ui.element('onboardingDetails').open, true);
  assert.equal(ui.element('onboardingLanguage').value, 'keep');
  assert.equal(ui.element('onboardingFontExposure').value, 'keep');
  assert.equal(ui.element('onboardingWebRtc').value, 'keep');
  await ui.call('submitOnboarding()');
  assert.match(ui.element('onboardingStatus').textContent, /勾选明确启用/);
  assert.equal(ui.requests.length, 2);
  await ui.call('detectNewExitLocation()');
  assert.equal(ui.requests.at(-1).action, 'cancelExitLocationDetection');
  assert.equal(ui.requests.some((request) => request.action === 'confirmExitLocationDetection'), false);
  ui.setAccept(true);
  await ui.call('detectNewExitLocation()');
  assert.equal(ui.requests.at(-1).action, 'confirmExitLocationDetection');
  assert.equal(ui.element('onboardingProfile').value, 'exit-synthetic');
  assert.equal(ui.element('onboardingConfirm').checked, false);
  assert.equal(ui.requests.some(request => request.action === 'completeOnboarding'), false);
  ui.element('onboardingDomains').value = 'example.com';
  ui.element('onboardingWebRtc').value = 'default';
  ui.element('onboardingConfirm').checked = true;
  ui.report.status = 'partial';
  ui.report.components.webrtc = { status: 'failed', errors: [{ code: 'synthetic', message: '合成同步失败' }] };
  let release!: () => void;
  ui.setPending(new Promise<void>((done) => { release = done; }));
  const first = ui.call('submitOnboarding()');
  const second = ui.call('submitOnboarding()');
  await ui.call('saveSettings()');
  assert.equal(ui.element('onboardingConfirm').disabled, true);
  release(); await Promise.all([first, second]); ui.setPending(null);
  const submits = ui.requests.filter((request) => request.action === 'completeOnboarding');
  assert.equal(submits.length, 1);
  assert.equal(submits[0].confirmed, true);
  assert.equal(submits[0].profileId, 'exit-synthetic');
  assert.equal(submits[0].domains, 'example.com');
  assert.equal(submits[0].webRtcMode, 'default');
  assert.deepEqual(submits[0].recommendation, { expectedVerifiedAt: 1, language: 'keep', timezone: 'exit', fontExposure: 'keep' });
  assert.equal(ui.element('setupStatus').dataset.setup, 'enabled');
  assert.equal(ui.element('setupStatus').dataset.sync, 'partial');
  assert.match(ui.element('onboardingStatus').textContent, /已保存但未完全生效/);
  assert.equal(ui.element('onboardingConfirm').checked, false);
  ui.report.status = 'ok'; ui.report.components.webrtc = { status: 'ok', errors: [] };
  await ui.call('submitOnboarding(true)');
  assert.match(ui.element('onboardingStatus').textContent, /已跳过，保护关闭/);
  assert.equal(ui.element('onboardingDetails').open, false);
  await ui.call('resetAllData()');
  assert.equal(ui.element('setupStatus').dataset.setup, 'unconfigured');
  assert.equal(ui.element('setupStatus').dataset.sync, 'ok');
  assert.equal(ui.element('onboardingWebRtc').value, 'default');
  // reset 后回到默认站点预置（13 条常用站点），仍需要显式提交才会写入
  assert.equal(ui.element('onboardingDomains').value.split('\n').length, 13);
  assert.match(ui.element('onboardingDomains').value, /^chatgpt\.com/);
  ui.setFailure(true);
  await ui.call('submitOnboarding(true)');
  assert.match(ui.element('onboardingStatus').textContent, /操作未完成.*合成写入失败/);
});

test('查看/修改推荐不写入或检测，变更撤销确认；地区语言及全局选择经明确提交才发送', async () => {
  const ui = harness();
  await new Promise<void>((done) => setImmediate(done));
  ui.setAccept(true);
  await ui.call('detectNewExitLocation()');
  ui.element('onboardingProfile').value = 'exit-synthetic';
  const before = ui.call('JSON.stringify(currentConfig)');
  const count = ui.requests.length;
  ui.element('onboardingConfirm').checked = true;
  ui.call('changeOnboardingChoice()');
  assert.equal(ui.element('onboardingConfirm').checked, false);
  assert.match(ui.element('onboardingRecommendation').textContent, /JP.*UTC.*未交叉验证/);
  assert.match(ui.element('onboardingRecommendation').textContent, /ja-JP/);
  assert.match(ui.element('onboardingRecommendation').textContent, /固定内置名单仅在已启用HTTP\(S\)规则上注册/);
  assert.equal(ui.requests.length, count);
  assert.equal(ui.call('JSON.stringify(currentConfig)'), before);
  ui.element('onboardingConfirm').checked = true;
  ui.call('renderOnboarding()');
  assert.equal(ui.element('onboardingConfirm').checked, false);
  ui.element('onboardingDomains').value = 'example.com';
  ui.element('onboardingLanguage').value = 'exit';
  ui.element('onboardingFontExposure').value = 'vendor-software';
  ui.element('onboardingWebRtc').value = 'compatible';
  await ui.call('submitOnboarding()');
  assert.equal(ui.requests.length, count);
  ui.element('onboardingConfirm').checked = true;
  await ui.call('submitOnboarding()');
  const submits = ui.requests.filter((request) => request.action === 'completeOnboarding');
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0].recommendation, { expectedVerifiedAt: 1, language: 'exit', timezone: 'exit', fontExposure: 'vendor-software' });
  assert.equal(submits[0].webRtcMode, 'compatible');
  assert.equal(ui.requests.filter((request) => request.action === 'detectExitLocation').length, 1);
  ui.call('currentConfig.exitLocationProfiles[0].countryCode = null');
  ui.element('onboardingLanguage').value = 'exit';
  ui.call('changeOnboardingChoice()');
  assert.equal(ui.element('onboardingExitLanguage').disabled, true);
  assert.equal(ui.element('onboardingLanguage').value, 'keep');
  assert.match(ui.element('onboardingRecommendation').textContent, /国家代码：未知（不猜测）/);
});

test('另一个设置窗口新增出口后，本次确认仍精确选中自己的检测结果', async () => {
  const ui = harness();
  await new Promise<void>((done) => setImmediate(done));
  ui.addConcurrentProfile();
  ui.setAccept(true);
  await ui.call('detectNewExitLocation()');
  assert.equal(ui.element('onboardingProfile').value, 'exit-synthetic');
  assert.equal(ui.element('onboardingConfirm').checked, false);
  assert.equal(ui.requests.some(request => request.action === 'completeOnboarding'), false);
});
