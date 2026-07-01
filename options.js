// Options page controller for editing the allowlist and shared spoofing profile.
const elements = {
  masterEnabled: document.getElementById('master-enabled'),
  webRtcMode: document.getElementById('webrtc-mode'),
  globalLanguageEnabled: document.getElementById('global-language-enabled'),
  globalLanguageMode: document.getElementById('global-language-mode'),
  globalLanguage: document.getElementById('global-language'),
  globalLanguages: document.getElementById('global-languages'),
  globalAcceptLanguage: document.getElementById('global-accept-language'),
  globalTimezoneEnabled: document.getElementById('global-timezone-enabled'),
  globalTimezoneMode: document.getElementById('global-timezone-mode'),
  globalTimezonePreset: document.getElementById('global-timezone-preset'),
  globalTimezone: document.getElementById('global-timezone'),
  globalGeoEnabled: document.getElementById('global-geo-enabled'),
  globalGeoMode: document.getElementById('global-geo-mode'),
  globalLatitude: document.getElementById('global-latitude'),
  globalLongitude: document.getElementById('global-longitude'),
  globalCountry: document.getElementById('global-country'),
  ruleList: document.getElementById('rule-list'),
  ruleEditor: document.getElementById('rule-editor'),
  newDomain: document.getElementById('new-domain'),
  addRuleBtn: document.getElementById('add-rule-btn'),
  importExport: document.getElementById('import-export'),
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
  saveBtn: document.getElementById('save-btn'),
  reloadBtn: document.getElementById('reload-btn'),
  status: document.getElementById('status')
};

let state = IPGeoConfig.clone(IPGeoConfig.DEFAULT_CONFIG);
let selectedRuleId = null;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response && response.message ? response.message : '未知错误'));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', Boolean(isError));
}

function fillSelect(select, options) {
  select.innerHTML = '';
  options.forEach((option) => {
    const item = document.createElement('option');
    if (typeof option === 'string') {
      item.value = option;
      item.textContent = option;
    } else {
      item.value = option.value;
      item.textContent = option.label;
    }
    select.appendChild(item);
  });
}

function setupStaticOptions() {
  fillSelect(elements.globalLanguageMode, [
    { value: 'custom', label: '自定义' },
    ...IPGeoConfig.LANGUAGE_PRESETS.map((preset, index) => ({ value: `preset:${index}`, label: preset.label }))
  ]);
  fillSelect(elements.globalTimezonePreset, IPGeoConfig.TIMEZONE_PRESETS);
}

function setLanguageForm(prefix, language) {
  document.getElementById(`${prefix}-language`).value = language.language || '';
  document.getElementById(`${prefix}-languages`).value = Array.isArray(language.languages) ? language.languages.join(', ') : '';
  document.getElementById(`${prefix}-accept-language`).value = language.acceptLanguage || '';
}

function readLanguageForm(prefix, enabled, modeValue) {
  if (modeValue && modeValue.startsWith('preset:')) {
    const preset = IPGeoConfig.LANGUAGE_PRESETS[Number(modeValue.split(':')[1])] || IPGeoConfig.LANGUAGE_PRESETS[0];
    return {
      enabled,
      mode: 'preset',
      language: preset.language,
      languages: preset.languages,
      acceptLanguage: preset.acceptLanguage
    };
  }
  return IPGeoConfig.normalizeLanguage({
    enabled,
    mode: 'custom',
    language: document.getElementById(`${prefix}-language`).value,
    languages: document.getElementById(`${prefix}-languages`).value,
    acceptLanguage: document.getElementById(`${prefix}-accept-language`).value
  });
}

function presetValueForLanguage(language) {
  const foundIndex = IPGeoConfig.LANGUAGE_PRESETS.findIndex((preset) => (
    preset.language === language.language
    && preset.languages.join(',') === language.languages.join(',')
    && preset.acceptLanguage === language.acceptLanguage
  ));
  return language.mode === 'preset' && foundIndex >= 0 ? `preset:${foundIndex}` : 'custom';
}

function numberOrNull(value) {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function renderGlobalProfile() {
  const profile = state.globalProfile;
  elements.masterEnabled.checked = state.masterEnabled !== false;
  elements.webRtcMode.value = state.webRtc.globalMode || 'strict';
  elements.globalLanguageEnabled.checked = profile.language.enabled !== false;
  elements.globalLanguageMode.value = presetValueForLanguage(profile.language);
  setLanguageForm('global', profile.language);
  elements.globalTimezoneEnabled.checked = profile.timezone.enabled !== false;
  elements.globalTimezoneMode.value = profile.timezone.mode || 'auto';
  elements.globalTimezonePreset.value = profile.timezone.timezone || IPGeoConfig.TIMEZONE_PRESETS[0];
  elements.globalTimezone.value = profile.timezone.timezone || '';
  elements.globalGeoEnabled.checked = profile.geolocation.enabled !== false;
  elements.globalGeoMode.value = profile.geolocation.mode || 'auto';
  elements.globalLatitude.value = profile.geolocation.latitude === null ? '' : profile.geolocation.latitude;
  elements.globalLongitude.value = profile.geolocation.longitude === null ? '' : profile.geolocation.longitude;
  elements.globalCountry.value = profile.geolocation.country || '';
}

function readGlobalProfile() {
  state.masterEnabled = elements.masterEnabled.checked;
  state.webRtc = IPGeoConfig.normalizeWebRtc({ globalMode: elements.webRtcMode.value });
  state.globalProfile.language = readLanguageForm('global', elements.globalLanguageEnabled.checked, elements.globalLanguageMode.value);
  state.globalProfile.timezone = IPGeoConfig.normalizeTimezone({
    enabled: elements.globalTimezoneEnabled.checked,
    mode: elements.globalTimezoneMode.value,
    timezone: elements.globalTimezone.value || elements.globalTimezonePreset.value
  });
  state.globalProfile.geolocation = IPGeoConfig.normalizeGeolocation({
    enabled: elements.globalGeoEnabled.checked,
    mode: elements.globalGeoMode.value,
    latitude: numberOrNull(elements.globalLatitude.value),
    longitude: numberOrNull(elements.globalLongitude.value),
    country: elements.globalCountry.value
  });
}

function selectedRule() {
  return state.rules.find(rule => rule.id === selectedRuleId) || null;
}

function renderRuleList() {
  elements.ruleList.innerHTML = '';
  if (!state.rules.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '还没有白名单域名。';
    elements.ruleList.appendChild(empty);
    return;
  }

  state.rules.forEach((rule) => {
    const item = document.createElement('div');
    item.className = `rule-item${rule.id === selectedRuleId ? ' is-selected' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled !== false;
    checkbox.addEventListener('change', () => {
      rule.enabled = checkbox.checked;
      renderRuleList();
    });

    const label = document.createElement('button');
    label.className = 'secondary';
    label.textContent = rule.domain;
    label.addEventListener('click', () => {
      selectedRuleId = rule.id;
      renderAll();
    });

    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      state.rules = state.rules.filter(itemRule => itemRule.id !== rule.id);
      if (selectedRuleId === rule.id) selectedRuleId = state.rules[0] ? state.rules[0].id : null;
      renderAll();
    });

    item.append(checkbox, label, remove);
    elements.ruleList.appendChild(item);
  });
}

function overrideFieldHtml(signal, title) {
  return `
    <h3>${title}</h3>
    <div class="grid">
      <div class="field">
        <label for="rule-${signal}-mode">模式</label>
        <select id="rule-${signal}-mode">
          <option value="inherit">继承全局</option>
          <option value="override">覆盖</option>
          <option value="disable">禁用</option>
        </select>
      </div>
    </div>
    <div id="rule-${signal}-fields"></div>
  `;
}

function renderRuleEditor() {
  const rule = selectedRule();
  if (!rule) {
    elements.ruleEditor.innerHTML = '<div class="muted">选择一个域名规则后编辑覆盖项。</div>';
    return;
  }

  elements.ruleEditor.innerHTML = `
    <div class="field">
      <label for="rule-domain">域名</label>
      <input id="rule-domain" type="text" spellcheck="false">
    </div>
    ${overrideFieldHtml('language', '语言')}
    ${overrideFieldHtml('timezone', '时区')}
    ${overrideFieldHtml('geolocation', '定位')}
  `;

  document.getElementById('rule-domain').value = rule.domain;
  ['language', 'timezone', 'geolocation'].forEach((signal) => {
    const select = document.getElementById(`rule-${signal}-mode`);
    select.value = rule.overrides[signal].mode;
    select.addEventListener('change', () => {
      rule.overrides[signal].mode = select.value;
      renderRuleEditorFields(rule);
    });
  });
  document.getElementById('rule-domain').addEventListener('input', (event) => {
    rule.domain = IPGeoConfig.normalizeDomain(event.target.value);
    renderRuleList();
  });

  renderRuleEditorFields(rule);
}

function renderRuleEditorFields(rule) {
  renderLanguageOverrideFields(rule);
  renderTimezoneOverrideFields(rule);
  renderGeolocationOverrideFields(rule);
}

function renderLanguageOverrideFields(rule) {
  const container = document.getElementById('rule-language-fields');
  if (rule.overrides.language.mode !== 'override') {
    container.innerHTML = '';
    return;
  }
  const value = IPGeoConfig.normalizeLanguage(rule.overrides.language.value || IPGeoConfig.DEFAULT_LANGUAGE);
  container.innerHTML = `
    <div class="grid">
      <div class="field">
        <label for="rule-language-mode-value">语言模式</label>
        <select id="rule-language-mode-value"></select>
      </div>
      <div class="field">
        <label for="rule-language">navigator.language</label>
        <input id="rule-language" type="text" spellcheck="false">
      </div>
      <div class="field">
        <label for="rule-languages">navigator.languages</label>
        <input id="rule-languages" type="text" spellcheck="false">
      </div>
      <div class="field">
        <label for="rule-accept-language">Accept-Language</label>
        <input id="rule-accept-language" type="text" spellcheck="false">
      </div>
    </div>
  `;
  fillSelect(document.getElementById('rule-language-mode-value'), [
    { value: 'custom', label: '自定义' },
    ...IPGeoConfig.LANGUAGE_PRESETS.map((preset, index) => ({ value: `preset:${index}`, label: preset.label }))
  ]);
  document.getElementById('rule-language-mode-value').value = presetValueForLanguage(value);
  setLanguageForm('rule', value);
}

function renderTimezoneOverrideFields(rule) {
  const container = document.getElementById('rule-timezone-fields');
  if (rule.overrides.timezone.mode !== 'override') {
    container.innerHTML = '';
    return;
  }
  const value = IPGeoConfig.normalizeTimezone(rule.overrides.timezone.value || { mode: 'manual', timezone: 'UTC' });
  container.innerHTML = `
    <div class="grid">
      <div class="field">
        <label for="rule-timezone-mode-value">时区模式</label>
        <select id="rule-timezone-mode-value">
          <option value="auto">跟随 IP</option>
          <option value="manual">手动指定</option>
        </select>
      </div>
      <div class="field">
        <label for="rule-timezone-preset">常用时区</label>
        <select id="rule-timezone-preset"></select>
      </div>
      <div class="field">
        <label for="rule-timezone">自定义 IANA 时区</label>
        <input id="rule-timezone" type="text" spellcheck="false">
      </div>
    </div>
  `;
  fillSelect(document.getElementById('rule-timezone-preset'), IPGeoConfig.TIMEZONE_PRESETS);
  document.getElementById('rule-timezone-mode-value').value = value.mode;
  document.getElementById('rule-timezone-preset').value = value.timezone || IPGeoConfig.TIMEZONE_PRESETS[0];
  document.getElementById('rule-timezone').value = value.timezone || '';
}

function renderGeolocationOverrideFields(rule) {
  const container = document.getElementById('rule-geolocation-fields');
  if (rule.overrides.geolocation.mode !== 'override') {
    container.innerHTML = '';
    return;
  }
  const value = IPGeoConfig.normalizeGeolocation(rule.overrides.geolocation.value || { mode: 'manual' });
  container.innerHTML = `
    <div class="grid">
      <div class="field">
        <label for="rule-geo-mode-value">定位模式</label>
        <select id="rule-geo-mode-value">
          <option value="auto">跟随 IP</option>
          <option value="manual">手动坐标</option>
        </select>
      </div>
      <div class="field">
        <label for="rule-latitude">纬度</label>
        <input id="rule-latitude" type="number" step="any">
      </div>
      <div class="field">
        <label for="rule-longitude">经度</label>
        <input id="rule-longitude" type="number" step="any">
      </div>
      <div class="field">
        <label for="rule-country">国家/地区标签</label>
        <input id="rule-country" type="text">
      </div>
    </div>
  `;
  document.getElementById('rule-geo-mode-value').value = value.mode;
  document.getElementById('rule-latitude').value = value.latitude === null ? '' : value.latitude;
  document.getElementById('rule-longitude').value = value.longitude === null ? '' : value.longitude;
  document.getElementById('rule-country').value = value.country || '';
}

function readRuleEditor() {
  const rule = selectedRule();
  if (!rule) return;
  rule.domain = IPGeoConfig.normalizeDomain(document.getElementById('rule-domain').value);

  ['language', 'timezone', 'geolocation'].forEach((signal) => {
    rule.overrides[signal].mode = document.getElementById(`rule-${signal}-mode`).value;
  });

  if (rule.overrides.language.mode === 'override') {
    rule.overrides.language.value = readLanguageForm('rule', true, document.getElementById('rule-language-mode-value').value);
  }
  if (rule.overrides.timezone.mode === 'override') {
    rule.overrides.timezone.value = IPGeoConfig.normalizeTimezone({
      enabled: true,
      mode: document.getElementById('rule-timezone-mode-value').value,
      timezone: document.getElementById('rule-timezone').value || document.getElementById('rule-timezone-preset').value
    });
  }
  if (rule.overrides.geolocation.mode === 'override') {
    rule.overrides.geolocation.value = IPGeoConfig.normalizeGeolocation({
      enabled: true,
      mode: document.getElementById('rule-geo-mode-value').value,
      latitude: numberOrNull(document.getElementById('rule-latitude').value),
      longitude: numberOrNull(document.getElementById('rule-longitude').value),
      country: document.getElementById('rule-country').value
    });
  }
}

function renderAll() {
  renderGlobalProfile();
  renderRuleList();
  renderRuleEditor();
}

async function loadConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getSiteConfig' });
    state = IPGeoConfig.normalizeConfig(response.config);
    selectedRuleId = state.rules[0] ? state.rules[0].id : null;
    renderAll();
    setStatus('配置已加载。');
  } catch (error) {
    setStatus(`加载失败: ${error.message}`, true);
  }
}

async function saveConfig() {
  try {
    readGlobalProfile();
    readRuleEditor();
    const result = IPGeoConfig.validateConfig(state);
    if (!result.ok) {
      setStatus(result.errors.join('; '), true);
      return;
    }
    const response = await sendRuntimeMessage({ action: 'setSiteConfig', config: result.config });
    state = IPGeoConfig.normalizeConfig(response.config);
    renderAll();
    setStatus('配置已保存。已打开的页面可能需要刷新后完全生效。');
  } catch (error) {
    setStatus(`保存失败: ${error.message}`, true);
  }
}

function addRule() {
  readGlobalProfile();
  readRuleEditor();
  const domain = IPGeoConfig.normalizeDomain(elements.newDomain.value);
  const rule = IPGeoConfig.createRule(domain);
  state.rules.push(rule);
  selectedRuleId = rule.id;
  elements.newDomain.value = '';
  renderAll();
}

function exportConfig() {
  readGlobalProfile();
  readRuleEditor();
  const result = IPGeoConfig.validateConfig(state);
  if (!result.ok) {
    setStatus(result.errors.join('; '), true);
    return;
  }
  elements.importExport.value = JSON.stringify(result.config, null, 2);
  setStatus('JSON 已导出到文本框。');
}

async function importConfig() {
  try {
    const parsed = JSON.parse(elements.importExport.value);
    const result = IPGeoConfig.validateConfig(parsed);
    if (!result.ok) {
      setStatus(`导入失败: ${result.errors.join('; ')}`, true);
      return;
    }
    state = result.config;
    selectedRuleId = state.rules[0] ? state.rules[0].id : null;
    renderAll();
    setStatus('JSON 已载入表单，点击“保存配置”后生效。');
  } catch (error) {
    setStatus(`导入失败: ${error.message}`, true);
  }
}

elements.globalLanguageMode.addEventListener('change', () => {
  if (!elements.globalLanguageMode.value.startsWith('preset:')) return;
  const preset = IPGeoConfig.LANGUAGE_PRESETS[Number(elements.globalLanguageMode.value.split(':')[1])];
  setLanguageForm('global', preset);
});

elements.globalTimezonePreset.addEventListener('change', () => {
  elements.globalTimezone.value = elements.globalTimezonePreset.value;
});

elements.addRuleBtn.addEventListener('click', addRule);
elements.saveBtn.addEventListener('click', saveConfig);
elements.reloadBtn.addEventListener('click', loadConfig);
elements.exportBtn.addEventListener('click', exportConfig);
elements.importBtn.addEventListener('click', importConfig);

document.addEventListener('change', (event) => {
  if (event.target && event.target.id === 'rule-language-mode-value' && event.target.value.startsWith('preset:')) {
    const preset = IPGeoConfig.LANGUAGE_PRESETS[Number(event.target.value.split(':')[1])];
    setLanguageForm('rule', preset);
  }
  if (event.target && event.target.id === 'rule-timezone-preset') {
    document.getElementById('rule-timezone').value = event.target.value;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  setupStaticOptions();
  loadConfig();
});
