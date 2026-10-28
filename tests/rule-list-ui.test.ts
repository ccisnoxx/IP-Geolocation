import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import { validateConfig } from '../src/shared/config-resolver';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import type { SiteSpoofConfig } from '../src/shared/types';

interface FormElement {
  value: string;
  checked: boolean;
  hidden: boolean;
}

// 执行维护源的表单填充和保存函数，观察真正发送的配置；不模拟 Chrome 验收。
function createFormHarness(page: 'popup' | 'options', initialConfig: SiteSpoofConfig) {
  const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`${page}.ts`, source, ts.ScriptTarget.Latest, true);
  const saveFunction = page === 'popup' ? 'saveChanges' : 'saveSettings';
  const names = ['updateFontExposureMode', 'populateForm', 'readForm', saveFunction, ...(page === 'popup' ? ['updateTimezoneOffset'] : [])];
  const functions = parsed.statements
    .filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  assert.equal(functions.length, names.length);

  const elements: Record<string, FormElement> = {};
  for (const match of source.matchAll(/const (\w+El) = document\.getElementById\(/g)) {
    elements[match[1]] = { value: '', checked: false, hidden: false };
  }
  const writes: SiteSpoofConfig[] = [];
  const context = vm.createContext({
    pendingConfigSaves: 0,
    ...configModel,
    ...elements,
    initialConfig,
    ruleListToText,
    rulesFromText,
    updateGlobalStatus() {},
    updateExitLocationProfile() {},
    renderProfiles() {},
    renderExitLocationProfiles() {},
    renderSiteRules() {},
    renderOnboarding() {},
    showAutoSaveToast() {},
    runtimeSyncMessage() { return '配置已保存，运行时已同步。'; },
    alert() {},
    confirmSaveProfileBtn: { disabled: false },
    webRtcSelectValue: () => 'disable_non_proxied_udp',
    async sendRuntimeMessage(message: { action: string; config: SiteSpoofConfig }) {
      assert.equal(message.action, 'setSiteConfig');
      const result = validateConfig(message.config);
      assert.equal(result.ok, true, result.errors.join(' | '));
      writes.push(structuredClone(message.config));
      return { config: result.config };
    }
  });
  const script = ts.transpileModule(`
    let currentConfig = normalizeConfig(initialConfig);
    ${functions.map((node) => node.getText(parsed)).join('\n')}
    populateForm(currentConfig);
    ({ save: ${saveFunction}, updateFontExposureMode });
  `, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const api = vm.runInContext(script, context) as { save(): Promise<void>; updateFontExposureMode(): void };
  return { ...api, elements, writes };
}

const rules = configModel.normalizeConfig({
  rules: [
    { id: 'disabled-id', domain: 'disabled.example', enabled: false, exitLocationProfileId: 'saved-exit' },
    { id: 'enabled-id', domain: 'enabled.example', enabled: true },
    { id: 'disabled-other', domain: 'other.example', enabled: false }
  ] as any
}).rules;

for (const page of ['popup', 'options'] as const) {
  test(`${page} 保存非规则设置时完整保留规则，并可再次保存`, async () => {
    const changes: Array<{ element: string; field: 'value' | 'checked'; value: string | boolean; verify(config: SiteSpoofConfig): void }> = [
      { element: 'globalEnabledEl', field: 'checked', value: false, verify: (config) => assert.equal(config.masterEnabled, false) },
      { element: 'debugModeEl', field: 'checked', value: true, verify: (config) => assert.equal(config.debugMode, true) },
      { element: 'languageEl', field: 'value', value: 'de-DE', verify: (config) => assert.equal(config.globalProfile.language.language, 'de-DE') },
      { element: 'intlModeEl', field: 'value', value: 'compatible', verify: (config) => assert.equal(config.intlMode, 'compatible') },
      { element: 'timezoneEl', field: 'value', value: 'UTC', verify: (config) => assert.equal(config.globalProfile.timezone.timezone, 'UTC') },
      { element: 'fontExposureEnabledEl', field: 'checked', value: true, verify: (config) => assert.equal(config.fontExposure.enabled, true) },
      { element: 'accuracyEl', field: 'value', value: '80', verify: (config) => assert.equal(config.globalProfile.geolocation.accuracy, 80) }
    ];
    for (const change of changes) {
      const harness = createFormHarness(page, configModel.normalizeConfig({ rules }));
      assert.equal(harness.elements.ruleListEl.value, 'enabled.example');
      Object.assign(harness.elements[change.element], { [change.field]: change.value });
      await harness.save();
      await harness.save();
      assert.equal(harness.writes.length, 2);
      for (const saved of harness.writes) {
        assert.deepEqual(saved.rules, rules, change.element);
        change.verify(saved);
      }
    }
  });

  test(`${page} 保存坐标、重新启用及移除规则时保留原配置和其他禁用规则`, async () => {
    const harness = createFormHarness(page, configModel.normalizeConfig({ rules }));
    harness.elements.latitudeEl.value = '1';
    harness.elements.longitudeEl.value = '2';
    await harness.save();
    assert.deepEqual(harness.writes[0].rules, rules);
    assert.equal(harness.writes[0].globalProfile.geolocation.latitude, 1);
    assert.equal(harness.writes[0].globalProfile.geolocation.longitude, 2);

    harness.elements.ruleListEl.value = 'enabled.example\nhttps://DISABLED.EXAMPLE/path';
    await harness.save();
    assert.deepEqual(harness.writes[1].rules, [{ ...rules[0], enabled: true }, rules[1], rules[2]]);

    harness.elements.ruleListEl.value = 'disabled.example';
    await harness.save();
    assert.deepEqual(harness.writes[2].rules, [{ ...rules[0], enabled: true }, rules[2]]);
  });
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} 字体模式加载和保存遵循内置名单，自定义编辑切换前后保留`, async () => {
    const customFamilies = ['Synthetic Vendor Font', 'Synthetic Editor Font'];
    const initial = configModel.normalizeConfig({ fontExposure: {
      enabled: true, mode: 'custom', blockedFamilies: customFamilies, canvasSpoof: { enabled: false, platform: 'macos' } } });
    const ui = createFormHarness(page, initial);
    assert.equal(ui.elements.fontExposureEnabledEl.checked, true);
    assert.equal(ui.elements.fontExposureModeEl.value, 'custom');
    assert.equal(ui.elements.fontExposureBlockedFamiliesEl.value, customFamilies.join('\n'));
    assert.equal(ui.elements.fontExposureVendorGroupEl.hidden, true);
    assert.equal(ui.elements.fontExposureCustomGroupEl.hidden, false);
    assert.equal(ui.elements.fontExposureVendorFamiliesEl.value, configModel.VENDOR_SOFTWARE_FONT_FAMILIES.join('\n'));
    ui.elements.fontExposureBlockedFamiliesEl.value += '\nSynthetic Draft Font';
    ui.elements.fontExposureModeEl.value = 'vendor-software';
    ui.updateFontExposureMode();
    assert.equal(ui.elements.fontExposureVendorGroupEl.hidden, false);
    assert.equal(ui.elements.fontExposureCustomGroupEl.hidden, true);
    ui.elements.fontExposureModeEl.value = 'custom';
    ui.updateFontExposureMode();
    assert.match(ui.elements.fontExposureBlockedFamiliesEl.value, /Synthetic Draft Font/);
    await ui.save();
    assert.deepEqual(ui.writes[0].fontExposure, { enabled: true, mode: 'custom', blockedFamilies: [...customFamilies, 'Synthetic Draft Font'], canvasSpoof: { enabled: false, platform: 'macos' } });
    ui.elements.fontExposureModeEl.value = 'vendor-software';
    ui.updateFontExposureMode();
    await ui.save();
    assert.equal(ui.writes[1].fontExposure.mode, 'vendor-software');
    assert.deepEqual(ui.writes[1].fontExposure.blockedFamilies, [...configModel.VENDOR_SOFTWARE_FONT_FAMILIES]);
    const reloaded = createFormHarness(page, ui.writes[1]);
    assert.equal(reloaded.elements.fontExposureModeEl.value, 'vendor-software');
    assert.equal(reloaded.elements.fontExposureVendorGroupEl.hidden, false);
    assert.equal(reloaded.elements.fontExposureCustomGroupEl.hidden, true);
    assert.equal(ui.writes[1].schemaVersion, 5);
    assert.doesNotMatch(JSON.stringify(ui.writes[1]), /acceptLanguage|"canvas"/);
  });
}
