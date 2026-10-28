// 执行管理页维护源的纯表单/事件函数；这是 Node/VM 证据，不是 Chrome 验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import { createCustomProfile } from '../src/shared/profile';
import { formatCoordinate } from '../src/shared/last-location-display';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import { validateConfig } from '../src/shared/config-resolver';
import type { SiteSpoofConfig } from '../src/shared/types';

test('出口档案缺失坐标保持空白，合法零坐标与小数按实际值显示', () => {
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(formatCoordinate(value), '');
  assert.equal(formatCoordinate(0), '0');
  assert.equal(formatCoordinate(-30.125), '-30.125');
  assert.equal(formatCoordinate(1.23456789), '1.234568');
});

function harness(page: 'popup' | 'options') {
  const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`${page}.ts`, source, ts.ScriptTarget.Latest, true);
  const names = ['updateFontExposureMode', 'populateForm', 'readForm', 'updateTimezoneOffset', 'saveChanges', 'saveSettings',
    'handleSaveAsCustom', 'closeSaveAsCustomModal', 'handleImportFile', 'handleResetFonts', 'exportConfiguration', 'updateLanguageList'];
  const functions = parsed.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  const listeners: Record<string, () => void> = {};
  const elements: Record<string, { value: string; checked: boolean; addEventListener: (event: string, listener: () => void) => void }> = {};
  for (const match of source.matchAll(/const (\w+El) = document\.getElementById\(/g)) {
    const name = match[1];
    elements[name] = { value: '', checked: false, addEventListener(event, listener) { listeners[`${name}:${event}`] = listener; } };
  }
  const formChangeListeners = parsed.statements.filter((node) => {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    return ts.isPropertyAccessExpression(call.expression) && ['languageEl', 'webrtcEnabledEl', 'webrtcPolicyEl'].includes(call.expression.expression.getText(parsed))
      && call.expression.name.text === 'addEventListener'
      && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'change';
  });
  const uiTasks: Promise<unknown>[] = [];
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
  const exportConfigBtn = { disabled: false };
  const requests: string[] = [];
  let modalCloses = 0;
  let now = '2026-01-15T12:00:00Z';
  const initialConfig = configModel.normalizeConfig({ rules: [], globalProfile: {
    language: configModel.normalizeLanguage({ language: 'en-US', languages: ['en-US'] }),
    geolocation: configModel.normalizeGeolocation({ mode: 'manual', latitude: 0, longitude: 0, accuracy: 50 }),
    timezone: configModel.normalizeTimezone({ mode: 'manual', timezone: 'UTC' })
  } });
  let savedConfig = structuredClone(initialConfig);
  const context = vm.createContext({ ...configModel, ...elements, initialConfig, createCustomProfile, pendingConfigSaves: 0,
    confirmSaveProfileBtn, saveBtn, saveFooterBtn, resetFontsBtn, cancelSaveProfileBtn, exportConfigBtn,
    ruleListToText, rulesFromText,
    downloadJson: (filename: string, config: SiteSpoofConfig) => downloads.push({ filename, config: structuredClone(config) }),
    runUiTask: (task: Promise<unknown>) => { uiTasks.push(task); },
    getTimezoneOffsetMinutes: (timezone: string) => configModel.getTimezoneOffsetMinutes(timezone, now),
    alert: (message: string) => alerts.push(message),
    updateGlobalStatus() {}, updateExitLocationProfile() {}, renderProfiles() {}, renderExitLocationProfiles() {}, renderSiteRules() {}, renderOnboarding() {},
    showAutoSaveToast() {}, runtimeSyncMessage: () => '配置已保存',
    saveProfileModal: { classList: { remove() { modalCloses += 1; } } },
    async sendRuntimeMessage(request: { action: string; config?: SiteSpoofConfig }) {
      requests.push(request.action);
      if (failure) throw new Error('合成存储失败');
      if (waitForSave) await waitForSave;
      if (request.action === 'getSiteConfig') return { config: structuredClone(savedConfig) };
      const result = validateConfig(request.config);
      if (!result.ok) throw new Error(result.errors.join('; '));
      writes.push(structuredClone(result.config));
      savedConfig = structuredClone(result.config);
      return { config: result.config };
    }
  });
  vm.runInContext(ts.transpileModule(`let currentConfig = normalizeConfig(initialConfig);
    ${functions.map((node) => node.getText(parsed)).join('\n')}
    ${formChangeListeners.map((node) => node.getText(parsed)).join('\n')}
    populateForm(currentConfig);`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
  return { elements, alerts, writes, downloads, context, confirmSaveProfileBtn, exportConfigBtn, requests,
    pendingButtons: [confirmSaveProfileBtn, saveBtn, saveFooterBtn, resetFontsBtn, cancelSaveProfileBtn],
    getModalCloses: () => modalCloses,
    call: (expression: string) => vm.runInContext(expression, context),
    changeLanguage: () => listeners['languageEl:change'](),
    changeWebRtc: async (control: 'webrtcEnabledEl' | 'webrtcPolicyEl') => {
      listeners[`${control}:change`]();
      await Promise.all(uiTasks.splice(0));
    },
    setFailure(value: boolean) { failure = value; },
    setWaitForSave(value: Promise<void> | null) { waitForSave = value; },
    setDate(value: string) { now = value; },
    setSavedConfig(value: SiteSpoofConfig) { savedConfig = structuredClone(value); }
  };
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} 主语言change事件重建列表，保存和重读不残留旧中文`, async () => {
    const ui = harness(page);
    ui.elements.languageEnabledEl.checked = true;
    for (const [language, expected] of [
      ['ja-JP', ['ja-JP', 'ja', 'en']],
      ['en-US', ['en-US', 'en']],
      ['es-MX', ['es-MX', 'es', 'en']],
      ['en', ['en']]
    ] as const) {
      ui.elements.languageEl.value = 'zh-CN';
      ui.elements.languagesEl.value = 'zh-CN, zh, en-US';
      ui.elements.languageEl.value = language;
      ui.changeLanguage();
      assert.equal(ui.elements.languagesEl.value, expected.join(', '));
      await ui.call(page === 'popup' ? 'saveChanges()' : 'saveSettings()');
      const saved = ui.writes.at(-1)!.globalProfile.language;
      assert.equal(saved.language, language);
      assert.deepEqual(saved.languages, expected);
      ui.call('populateForm(currentConfig)');
      assert.equal(ui.elements.languagesEl.value, expected.join(', '));
    }
  });

  test(`${page} 普通保存保留显式备用语言并保证主语言首位`, async () => {
    const ui = harness(page);
    ui.elements.languageEl.value = 'ja-JP';
    ui.changeLanguage();
    ui.elements.languagesEl.value = 'ko, ja-JP, en, ja-JP';
    await ui.call(page === 'popup' ? 'saveChanges()' : 'saveSettings()');
    assert.deepEqual(ui.writes.at(-1)!.globalProfile.language.languages, ['ja-JP', 'ko', 'en']);
    ui.call('populateForm(currentConfig)');
    assert.equal(ui.elements.languagesEl.value, 'ja-JP, ko, en');
  });
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
    const config = configModel.normalizeConfig({ fontExposure: {
      enabled: false, mode, blockedFamilies: ['Synthetic Imported Font'], canvasSpoof: { enabled: false, platform: 'macos' } } });
    ui.context.importedText = JSON.stringify(config);
    await ui.call('handleImportFile({ target: { files: [{ text: async () => importedText }] } })');
    assert.equal(ui.elements.fontExposureModeEl.value, mode);
    assert.equal(ui.elements.fontExposureEnabledEl.checked, false);
    assert.equal(ui.elements.fontExposureBlockedFamiliesEl.value, config.fontExposure.blockedFamilies.join('\n'));
    await ui.call('exportConfiguration()');
    const exported = ui.downloads.at(-1)!;
    assert.match(exported.filename, /^vanishgeo-config-.*\.json$/);
    assert.equal(exported.config.schemaVersion, 5);
    assert.deepEqual(exported.config.fontExposure, config.fontExposure);
    assert.doesNotMatch(JSON.stringify(exported.config), /acceptLanguage|"canvas"/);
  }
});

test('Options 原始导出完整保留后台 preset/auto、verified 档案及规则绑定，不提交未保存表单', async () => {
  const ui = harness('options');
  const saved = configModel.normalizeConfig({
    globalProfile: {
      language: configModel.normalizeLanguage({ mode: 'preset', language: 'en-US', languages: ['en-US', 'en'] }),
      timezone: configModel.normalizeTimezone({ mode: 'auto', timezone: 'America/Los_Angeles' }),
      geolocation: configModel.normalizeGeolocation({ mode: 'auto', latitude: 0, longitude: 0,
        history: [{ latitude: 1, longitude: 2, accuracy: 50, label: '合成历史', createdAt: 1 }] })
    },
    exitLocationProfiles: [{ id: 'synthetic-exit', name: '合成档案', verification: 'verified', publicIp: '203.0.113.10',
      latitude: 0, longitude: 0, country: 'Synthetic', countryCode: 'JP', timezone: 'UTC', provider: 'synthetic', verifiedAt: 1 }],
    rules: [
      configModel.normalizeRule({ id: 'synthetic-enabled', domain: 'example.com', exitLocationProfileId: 'synthetic-exit' }),
      configModel.normalizeRule({ id: 'synthetic-disabled', domain: 'child.example.com', enabled: false, exitLocationProfileId: 'synthetic-exit' })
    ]
  });
  ui.setSavedConfig(saved);
  const previous = ui.call('JSON.stringify(currentConfig)');
  ui.elements.languageEl.value = 'ja-JP';
  ui.elements.timezoneEl.value = 'UTC';
  await ui.call('exportConfiguration()');
  assert.deepEqual(ui.downloads[0].config, saved);
  assert.equal(ui.downloads[0].config.globalProfile.language.mode, 'preset');
  assert.equal(ui.downloads[0].config.globalProfile.timezone.mode, 'auto');
  assert.equal(ui.downloads[0].config.exitLocationProfiles[0].verification, 'verified');
  assert.equal(ui.downloads[0].config.rules[0].exitLocationProfileId, 'synthetic-exit');
  assert.equal(ui.elements.languageEl.value, 'ja-JP');
  assert.equal(ui.elements.timezoneEl.value, 'UTC');
  assert.equal(ui.call('JSON.stringify(currentConfig)'), previous);
  assert.deepEqual(ui.requests, ['getSiteConfig']);
  assert.equal(ui.writes.length, 0);
});

test('Options 原始导出在途不重复读取，失败不下载且可重试；保存未完成时不启动导出', async () => {
  const ui = harness('options');
  let release!: () => void;
  ui.setWaitForSave(new Promise<void>(done => { release = done; }));
  const exporting = ui.call('exportConfiguration()');
  assert.equal(ui.exportConfigBtn.disabled, true);
  await ui.call('exportConfiguration()');
  assert.equal(ui.requests.length, 1);
  release();
  await exporting;
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.exportConfigBtn.disabled, false);
  ui.setWaitForSave(null);
  ui.setFailure(true);
  await assert.rejects(ui.call('exportConfiguration()'), /合成存储失败/);
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.exportConfigBtn.disabled, false);
  ui.setFailure(false);
  ui.call('pendingConfigSaves = 1');
  await ui.call('exportConfiguration()');
  assert.equal(ui.requests.length, 2);
  ui.call('pendingConfigSaves = 0');
  await ui.call('exportConfiguration()');
  assert.equal(ui.downloads.length, 2);
  assert.equal(ui.writes.length, 0);
});

for (const page of ['popup', 'options'] as const) {
  test(`${page} WebRTC可见选项仅使用领域模式且表单保存回显一致`, async () => {
    const html = readFileSync(`src/${page}/${page}.html`, 'utf8');
    const select = html.match(/<select id="webrtcPolicy"[^>]*>([\s\S]*?)<\/select>/)![1];
    const modes = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(modes, ['default', 'compatible', 'strict']);
    const ui = harness(page);
    for (const mode of modes) {
      ui.elements.webrtcPolicyEl.value = mode;
      await ui.changeWebRtc('webrtcPolicyEl');
      if (page === 'options') await ui.call('saveSettings()');
      assert.equal(ui.writes.at(-1)!.webRtc.globalMode, mode);
      ui.call('populateForm(currentConfig)');
      assert.equal(ui.elements.webrtcPolicyEl.value, mode);
      assert.equal(ui.elements.webrtcEnabledEl.checked, mode !== 'default');
    }
  });
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} WebRTC开关从default启用选择strict，关闭后保存default`, async () => {
    const ui = harness(page);
    ui.elements.webrtcPolicyEl.value = 'default';
    for (const enabled of [true, false]) {
      ui.elements.webrtcEnabledEl.checked = enabled;
      await ui.changeWebRtc('webrtcEnabledEl');
      if (page === 'options') await ui.call('saveSettings()');
      assert.equal(ui.writes.at(-1)!.webRtc.globalMode, enabled ? 'strict' : 'default');
      assert.equal(ui.elements.webrtcPolicyEl.value, enabled ? 'strict' : 'default');
    }
  });
}
