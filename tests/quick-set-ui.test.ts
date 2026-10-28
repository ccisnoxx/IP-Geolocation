// 执行维护源事件与保存路径；DOM/Chrome 消息由 VM 夹具提供，不代表真实 Chrome 验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import * as presets from '../src/shared/environment-presets';
import { validateConfig } from '../src/shared/config-resolver';
import { getConfigInputErrors } from '../src/shared/config-validation';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import type { ExitLocationProfile, SiteSpoofConfig } from '../src/shared/types';

function element() {
  const listeners: Record<string, () => void> = {};
  return {
    value: '', checked: false, hidden: false, disabled: false, textContent: '',
    dataset: {} as Record<string, string>, attributes: {} as Record<string, string>,
    children: [] as Array<{ value: string; textContent: string }>,
    addEventListener(event: string, listener: () => void) { listeners[event] = listener; },
    click() { if (!this.disabled) listeners.click?.(); },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    replaceChildren() { this.children = []; this.value = ''; },
    appendChild(child: { value: string; textContent: string }) { this.children.push(child); }
  };
}

function harness(page: 'popup' | 'options', initialConfig: SiteSpoofConfig) {
  const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`${page}.ts`, source, ts.ScriptTarget.Latest, true);
  const save = page === 'popup' ? 'saveChanges' : 'saveSettings';
  const names = ['sendRuntimeMessage', 'showOperationError', 'runUiTask', 'updateFontExposureMode',
    'populateForm', 'readForm', 'applyQuickSetSignals', 'renderQuickSetExitProfiles', 'loadConfig', save,
    ...(page === 'popup' ? ['updateTimezoneOffset', 'applyQuickSetFromExitProfile'] : ['confirmDetection'])];
  const functions = parsed.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  assert.equal(functions.length, names.length);
  const events = parsed.statements.filter((node) => {
    if (ts.isForOfStatement(node)) return node.expression.getText(parsed) === 'quickSetCards';
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'addEventListener'
      && call.expression.expression.getText(parsed) === (page === 'popup' ? 'applyQuickSetExitEl' : 'applyEnvironmentPresetEl');
  });
  assert.equal(events.length, 2);
  const elements: Record<string, ReturnType<typeof element>> = {};
  for (const match of source.matchAll(/const (\w+(?:El|Btn)|autoSaveToast) = document\.getElementById\(/g)) {
    elements[match[1]] = element();
  }
  const html = readFileSync(new URL(`../src/${page}/${page}.html`, import.meta.url), 'utf8');
  const cards = [...html.matchAll(/data-preset="([^"]+)"/g)].map((match) => {
    const card = element();
    card.dataset.preset = match[1];
    return card;
  });
  const writes: SiteSpoofConfig[] = [];
  const tasks: Promise<unknown>[] = [];
  let rejectSaves = false;
  let serverConfig = configModel.normalizeConfig(initialConfig);
  const context = vm.createContext({
    ...configModel, ...presets, ...elements,
    initialConfig, quickSetCards: cards, tasks, ruleListToText, rulesFromText,
    currentRuleId: null, currentHostname: '', currentTabState: null,
    document: { createElement: element },
    updateGlobalStatus() {}, updateExitLocationProfile() {}, renderCurrentSiteStatus() {},
    renderProfiles() {}, renderExitLocationProfiles() {}, renderSiteRules() {}, renderOnboarding() {},
    loadWebRtcPolicyState() {}, renderSetupStatus() {}, renderFontRuntimeStatus() {},
    renderRuntimeSyncPending(target: ReturnType<typeof element>) { target.dataset.status = 'pending'; },
    renderRuntimeSyncReport(target: ReturnType<typeof element>) { target.dataset.status = 'ok'; },
    showAutoSaveToast() {}, runtimeSyncMessage() { return '已保存'; }, alert() {},
    chrome: { runtime: {
      sendMessage(message: { action: string; config?: SiteSpoofConfig }, callback: (response: unknown) => void) {
        if (message.action === 'setSiteConfig') {
          const config = message.config!;
          assert.deepEqual(getConfigInputErrors(config), []);
          const result = validateConfig(config);
          assert.equal(result.ok, true, result.errors.join(' | '));
          writes.push(structuredClone(config));
          if (rejectSaves) { callback({ status: 'error', message: 'Synthetic save rejection' }); return; }
          serverConfig = result.config;
        }
        callback({ config: serverConfig, state: { config: serverConfig, domain: '', scriptable: false } });
      }
    } }
  });
  const script = ts.transpileModule(`
    let currentConfig = normalizeConfig(initialConfig);
    let pendingConfigSaves = 0;
    let configSaveFailed = false;
    ${functions.map((node) => node.getText(parsed)).join('\n')}
    // 只观察维护源保存 Promise，避免修复前的未处理拒绝干扰 Node 测试进程。
    const originalSave = ${save};
    ${save} = (...args) => {
      const task = originalSave(...args);
      tasks.push(task);
      void task.catch(() => {});
      return task;
    };
    ${events.map((node) => node.getText(parsed)).join('\n')}
    ({ load: loadConfig, save: ${save},
      ${page === 'options' ? 'confirmDetection,' : ''}
      replaceConfig(config) { currentConfig = normalizeConfig(config); populateForm(currentConfig); }
    });
  `, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const api = vm.runInContext(script, context) as {
    load(): Promise<void>;
    save(): Promise<void>;
    confirmDetection(preview: { detectionId: string }, name: string): Promise<void>;
    replaceConfig(config: SiteSpoofConfig): void;
  };
  return {
    ...api, elements, cards, writes,
    rejectSaves() { rejectSaves = true; },
    respondWith(config: SiteSpoofConfig) { serverConfig = configModel.normalizeConfig(config); },
    async flush() { await Promise.allSettled(tasks.splice(0)); },
    clickPreset(id: string) { cards.find((card) => card.dataset.preset === id)!.click(); },
    selectExit(id: string) {
      elements[page === 'popup' ? 'quickSetExitProfileEl' : 'environmentPresetEl'].value = id;
      elements[page === 'popup' ? 'applyQuickSetExitEl' : 'applyEnvironmentPresetEl'].click();
    }
  };
}

const verified: ExitLocationProfile = {
  id: 'exit-synthetic', name: 'Synthetic Exit', verification: 'verified', publicIp: '192.0.2.1',
  latitude: 0, longitude: 0, country: 'Synthetic Country', countryCode: null,
  timezone: 'UTC', provider: 'synthetic-provider', verifiedAt: 1
};

const initial = () => configModel.normalizeConfig({
  masterEnabled: true, debugMode: true, intlMode: 'compatible',
  rules: [{ ...configModel.createRule('example.com'), enabled: false }],
  exitLocationProfiles: [verified], webRtc: { globalMode: 'strict' },
  fontExposure: { enabled: true, mode: 'custom', blockedFamilies: ['Synthetic Font'], canvasSpoof: { enabled: false, platform: 'macos' } },
  globalProfile: {
    language: { enabled: false, mode: 'custom', language: 'de-DE', languages: ['de-DE', 'de'] },
    timezone: { enabled: false, mode: 'auto', timezone: '' },
    geolocation: { enabled: false, mode: 'auto', latitude: null, longitude: null, accuracy: 75,
      country: 'Old Country', randomize: true, randomRadiusMeters: 25, spoofPermission: true,
      history: [{ latitude: 0, longitude: 0, accuracy: 65, label: 'Synthetic History', createdAt: 1 }] }
  }
});

for (const page of ['popup', 'options'] as const) {
  test(`${page} 真实预设卡片保存三信号和国家，保留其他配置并可校验往返`, async () => {
    for (const id of ['japan-tokyo', 'us-los-angeles']) {
      const config = initial();
      const snapshot = structuredClone(config);
      const ui = harness(page, config);
      await ui.load();
      ui.clickPreset(id);
      await ui.flush();
      assert.equal(ui.writes.length, 1);
      const saved = ui.writes[0];
      const preset = presets.findEnvironmentPreset(id)!;
      assert.deepEqual(saved.globalProfile.language, { enabled: true, mode: 'custom', language: preset.language, languages: preset.languages });
      assert.deepEqual(saved.globalProfile.timezone, { enabled: true, mode: 'manual', timezone: preset.timezone });
      assert.deepEqual(saved.globalProfile.geolocation, { ...config.globalProfile.geolocation,
        enabled: true, mode: 'manual', latitude: preset.latitude, longitude: preset.longitude, country: preset.country });
      assert.deepEqual({ ...saved, globalProfile: config.globalProfile }, config);
      assert.deepEqual(config, snapshot);
      const reloaded = configModel.normalizeConfig(JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(reloaded.globalProfile, saved.globalProfile);
      const reloadedUi = harness(page, reloaded);
      await reloadedUi.load();
      await reloadedUi.save();
      assert.deepEqual(reloadedUi.writes[0], saved);
    }
  });

  test(`${page} 真实出口按钮保存同批坐标与国家，未知语言保留当前值`, async () => {
    const ui = harness(page, initial());
    await ui.load();
    ui.selectExit(verified.id);
    await ui.flush();
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.writes[0].globalProfile.geolocation.country, verified.country);
    assert.deepEqual([ui.writes[0].globalProfile.geolocation.latitude, ui.writes[0].globalProfile.geolocation.longitude], [0, 0]);
    assert.equal(ui.writes[0].globalProfile.timezone.timezone, 'UTC');
    assert.equal(ui.writes[0].globalProfile.language.language, 'de-DE');
    assert.deepEqual(ui.writes[0].globalProfile.language.languages, ['de-DE', 'de']);
  });

  test(`${page} 快速设置保存被后台拒绝时显示失败及错误消息`, async () => {
    const ui = harness(page, initial());
    await ui.load();
    ui.rejectSaves();
    ui.clickPreset('japan-tokyo');
    await ui.flush();
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.elements.runtimeSyncStatusEl.dataset.status, 'failed');
    assert.match(ui.elements.runtimeSyncStatusEl.textContent, /Synthetic save rejection/);
    if (page === 'popup') {
      assert.equal(ui.elements.autoSaveToast.dataset.status, 'failed');
      assert.match(ui.elements.autoSaveToast.textContent, /重新保存/);
    }
  });

  test(`${page} 未知卡片与未确认出口均不提交配置`, async () => {
    const config = initial();
    config.exitLocationProfiles.push({ ...verified, id: 'unverified-exit', verification: 'unverified' });
    const ui = harness(page, config);
    await ui.load();
    ui.cards[0].dataset.preset = 'unknown';
    ui.cards[0].click();
    ui.selectExit('unverified-exit');
    await ui.flush();
    assert.equal(ui.writes.length, 0);
    assert.match(ui.elements.quickSetExitHintEl.textContent, /尚未确认/);
  });
}

test('options 检测确认后立即启用出口快速设置，移除最后档案后重新禁用', async () => {
  const empty = configModel.normalizeConfig({ ...initial(), exitLocationProfiles: [] });
  const ui = harness('options', empty);
  await ui.load();
  assert.equal(ui.elements.environmentPresetEl.disabled, true);
  assert.equal(ui.elements.applyEnvironmentPresetEl.disabled, true);
  ui.respondWith(initial());
  await ui.confirmDetection({ detectionId: 'synthetic-detection' }, 'Synthetic Exit');
  assert.equal(ui.elements.environmentPresetEl.disabled, false);
  assert.equal(ui.elements.applyEnvironmentPresetEl.disabled, false);
  assert.equal(ui.elements.environmentPresetEl.children[1].value, verified.id);
  ui.replaceConfig(empty);
  assert.equal(ui.elements.environmentPresetEl.disabled, true);
  assert.equal(ui.elements.applyEnvironmentPresetEl.disabled, true);
  assert.equal(ui.elements.environmentPresetEl.children.length, 1);
});
