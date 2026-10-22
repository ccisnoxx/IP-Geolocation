// 执行管理页维护源的纯表单/事件函数；这是 Node/VM 证据，不是 Chrome 验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import { createCustomProfile } from '../src/shared/profile';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import { validateConfig } from '../src/shared/config-resolver';
import type { SiteSpoofConfig } from '../src/shared/types';

function harness(page: 'popup' | 'options') {
  const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`${page}.ts`, source, ts.ScriptTarget.Latest, true);
  const names = ['updateFontExposureMode', 'populateForm', 'readForm', 'updateTimezoneOffset', 'saveChanges', 'saveSettings',
    'handleSaveAsCustom', 'closeSaveAsCustomModal', 'handleImportFile', 'handleResetFonts', 'exportConfiguration'];
  const functions = parsed.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  const elements: Record<string, { value: string; checked: boolean }> = {};
  for (const match of source.matchAll(/const (\w+El) = document\.getElementById\(/g)) elements[match[1]] = { value: '', checked: false };
  const alerts: string[] = [];
  const writes: SiteSpoofConfig[] = [];
  const downloads: Array<{ filename: string; config: SiteSpoofConfig }> = [];
  let failure = false;
  let waitForSave: Promise<void> | null = null;
  const confirmSaveProfileBtn = { disabled: false };
  const saveBtn = { disabled: false };
  const saveFooterBtn = { disabled: false };
  const resetFontsBtn = { disabled: false };
  const cancelSaveProfileBtn = { disabled: false };
  let modalCloses = 0;
  let now = '2026-01-15T12:00:00Z';
  const initialConfig = configModel.normalizeConfig({ rules: [], globalProfile: {
    language: configModel.normalizeLanguage({ language: 'en-US', languages: ['en-US'] }),
    geolocation: configModel.normalizeGeolocation({ mode: 'manual', latitude: 0, longitude: 0, accuracy: 50 }),
    timezone: configModel.normalizeTimezone({ mode: 'manual', timezone: 'UTC' })
  } });
  const context = vm.createContext({ ...configModel, ...elements, initialConfig, createCustomProfile,
    confirmSaveProfileBtn, saveBtn, saveFooterBtn, resetFontsBtn, cancelSaveProfileBtn,
    ruleListToText, rulesFromText,
    downloadJson: (filename: string, config: SiteSpoofConfig) => downloads.push({ filename, config: structuredClone(config) }),
    getTimezoneOffsetMinutes: (timezone: string) => configModel.getTimezoneOffsetMinutes(timezone, now),
    alert: (message: string) => alerts.push(message),
    updateGlobalStatus() {}, updateExitLocationProfile() {}, renderProfiles() {}, renderExitLocationProfiles() {}, renderSiteRules() {}, renderOnboarding() {},
    showAutoSaveToast() {}, runtimeSyncMessage: () => '配置已保存', webRtcSelectValue: () => 'default',
    saveProfileModal: { classList: { remove() { modalCloses += 1; } } },
    async sendRuntimeMessage(request: { action: string; config: SiteSpoofConfig }) {
      if (failure) throw new Error('合成存储失败');
      if (waitForSave) await waitForSave;
      const result = validateConfig(request.config);
      if (!result.ok) throw new Error(result.errors.join('; '));
      writes.push(structuredClone(result.config));
      return { config: result.config };
    }
  });
  vm.runInContext(ts.transpileModule(`let currentConfig = normalizeConfig(initialConfig);
    ${functions.map((node) => node.getText(parsed)).join('\n')}
    populateForm(currentConfig);`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
  return { elements, alerts, writes, downloads, context, confirmSaveProfileBtn,
    pendingButtons: [confirmSaveProfileBtn, saveBtn, saveFooterBtn, resetFontsBtn, cancelSaveProfileBtn],
    getModalCloses: () => modalCloses,
    call: (expression: string) => vm.runInContext(expression, context),
    setFailure(value: boolean) { failure = value; },
    setWaitForSave(value: Promise<void> | null) { waitForSave = value; },
    setDate(value: string) { now = value; }
  };
}

test('Options 实际另存流程保留中文与同名方案，失败重试不重复添加', async () => {
  const ui = harness('options');
  ui.elements.newProfileNameEl.value = '中文方案';
  await ui.call('handleSaveAsCustom()');
  await ui.call('handleSaveAsCustom()');
  const saved = ui.writes[1].profile.profiles;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].name, '中文方案');
  assert.equal(saved[1].name, '中文方案');
  assert.notEqual(saved[0].id, saved[1].id);
  ui.setFailure(true);
  await assert.rejects(ui.call('handleSaveAsCustom()'), /合成存储失败/);
  assert.equal(ui.call('currentConfig.profile.profiles.length'), 2);
  ui.setFailure(false);
  await ui.call('handleSaveAsCustom()');
  assert.equal(ui.writes.at(-1)!.profile.profiles.length, 3);
  ui.elements.accuracyEl.value = '0';
  await ui.call('handleSaveAsCustom()');
  assert.match(ui.alerts.at(-1)!, /accuracy/);
  assert.equal(ui.writes.length, 3);
  ui.elements.accuracyEl.value = '50';
  ui.elements.latitudeEl.value = '';
  await ui.call('handleSaveAsCustom()');
  assert.match(ui.alerts.at(-1)!, /latitude/);
  assert.equal(ui.writes.length, 3);
});

test('Options 另存 pending 期间双次触发只提交一次，完成后可继续保存同名方案', async () => {
  const ui = harness('options');
  ui.elements.newProfileNameEl.value = '中文同名方案';
  let release!: () => void;
  ui.setWaitForSave(new Promise<void>((done) => { release = done; }));
  const first = ui.call('handleSaveAsCustom()');
  const second = ui.call('handleSaveAsCustom()');
  const disabledWhilePending = ui.confirmSaveProfileBtn.disabled;
  release();
  await Promise.all([first, second]);
  assert.equal(disabledWhilePending, true);
  assert.equal(ui.confirmSaveProfileBtn.disabled, false);
  assert.equal(ui.writes.length, 1);
  ui.setWaitForSave(null);
  await ui.call('handleSaveAsCustom()');
  assert.equal(ui.writes.at(-1)!.profile.profiles.length, 2);
  assert.notEqual(ui.writes.at(-1)!.profile.profiles[0].id, ui.writes.at(-1)!.profile.profiles[1].id);
});

test('Options 另存期间取消、普通保存和重置字体不能提交旧列表，失败恢复原列表', async () => {
  const ui = harness('options');
  ui.elements.newProfileNameEl.value = '保留新方案';
  let release!: () => void;
  ui.setWaitForSave(new Promise<void>((done) => { release = done; }));
  const creating = ui.call('handleSaveAsCustom()');
  const disabled = ui.pendingButtons.every((button) => button.disabled);
  ui.call('closeSaveAsCustomModal()');
  const prematureCloses = ui.getModalCloses();
  const saving = ui.call('saveSettings()');
  const resetting = ui.call('handleResetFonts()');
  release();
  await Promise.all([creating, saving, resetting]);
  assert.equal(disabled, true);
  assert.equal(prematureCloses, 0);
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].profile.profiles.length, 1);
  assert.equal(ui.call('currentConfig.profile.profiles.length'), 1);
  assert.ok(ui.pendingButtons.every((button) => !button.disabled));
  ui.setWaitForSave(null);
  ui.setFailure(true);
  await assert.rejects(ui.call('handleSaveAsCustom()'), /合成存储失败/);
  assert.equal(ui.call('currentConfig.profile.profiles.length'), 1);
  assert.ok(ui.pendingButtons.every((button) => !button.disabled));
  ui.setFailure(false);
  await ui.call('saveSettings()');
  assert.equal(ui.writes.at(-1)!.profile.profiles.length, 1);
});

test('Options 实际导入流程显示条目和字段错误，不显示成功或替换已有方案', async () => {
  const ui = harness('options');
  ui.elements.newProfileNameEl.value = '保留方案';
  await ui.call('handleSaveAsCustom()');
  const config = structuredClone(ui.writes[0]);
  config.profile.profiles[0].timezone.timezone = 'Mars/Base';
  ui.context.importedText = JSON.stringify(config);
  await ui.call('handleImportFile({ target: { files: [{ text: async () => importedText }] } })');
  assert.match(ui.alerts.at(-1)!, /导入配置失败.*profile\.profiles\[0\].*timezone/);
  assert.equal(ui.elements.importFileEl.value, '');
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.call('currentConfig.profile.profiles[0].name'), '保留方案');
});

test('Popup 实际填充和保存按目标时区显示偏移，包含冬夏、半小时和空/非法值', async () => {
  const ui = harness('popup');
  for (const [timezone, date, offset] of [
    ['America/New_York', '2026-01-15T12:00:00Z', '-5'],
    ['America/New_York', '2026-07-15T12:00:00Z', '-4'],
    ['Asia/Shanghai', '2026-01-15T12:00:00Z', '8'],
    ['Asia/Kolkata', '2026-01-15T12:00:00Z', '5.5'],
    ['UTC', '2026-01-15T12:00:00Z', '0']
  ]) {
    ui.setDate(date);
    ui.elements.timezoneEl.value = timezone;
    await ui.call('saveChanges()');
    assert.equal(ui.elements.utcOffsetEl.value, offset);
    ui.call('populateForm(currentConfig)');
    assert.equal(ui.elements.utcOffsetEl.value, offset);
  }
  for (const timezone of ['Mars/Base', '+08:00']) {
    ui.elements.timezoneEl.value = timezone;
    await assert.rejects(ui.call('saveChanges()'), /timezone/);
    assert.equal(ui.elements.utcOffsetEl.value, '');
  }
  for (const timezone of ['', 'Mars/Base', '+08:00']) {
    ui.elements.timezoneEl.value = timezone;
    ui.call('updateTimezoneOffset()');
    assert.equal(ui.elements.utcOffsetEl.value, '');
  }
});

test('Options 字体自定义和内置模式通过实际导入／导出保留 v3 合同', async () => {
  const ui = harness('options');
  for (const mode of ['custom', 'vendor-software'] as const) {
    const config = configModel.normalizeConfig({ fontExposure: { enabled: false, mode, blockedFamilies: ['Synthetic Imported Font'] } });
    ui.context.importedText = JSON.stringify(config);
    await ui.call('handleImportFile({ target: { files: [{ text: async () => importedText }] } })');
    assert.equal(ui.elements.fontExposureModeEl.value, mode);
    assert.equal(ui.elements.fontExposureEnabledEl.checked, false);
    assert.equal(ui.elements.fontExposureBlockedFamiliesEl.value, config.fontExposure.blockedFamilies.join('\n'));
    ui.call('exportConfiguration()');
    const exported = ui.downloads.at(-1)!;
    assert.match(exported.filename, /^vanishgeo-config-.*\.json$/);
    assert.equal(exported.config.schemaVersion, 3);
    assert.deepEqual(exported.config.fontExposure, config.fontExposure);
    assert.doesNotMatch(JSON.stringify(exported.config), /acceptLanguage|"canvas"/);
  }
});
