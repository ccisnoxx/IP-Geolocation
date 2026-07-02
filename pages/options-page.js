// Options page controller.
(function(root) {
  const optionsForm = root.IPGeoOptionsForm;

  function init(doc) {
    const elements = {
      masterEnabled: doc.getElementById('master-enabled'),
      webRtcMode: doc.getElementById('webrtc-mode'),
      globalLanguageEnabled: doc.getElementById('global-language-enabled'),
      globalLanguageMode: doc.getElementById('global-language-mode'),
      globalLanguage: doc.getElementById('global-language'),
      globalLanguages: doc.getElementById('global-languages'),
      globalAcceptLanguage: doc.getElementById('global-accept-language'),
      globalTimezoneEnabled: doc.getElementById('global-timezone-enabled'),
      globalTimezoneMode: doc.getElementById('global-timezone-mode'),
      globalTimezonePreset: doc.getElementById('global-timezone-preset'),
      globalTimezone: doc.getElementById('global-timezone'),
      globalGeoEnabled: doc.getElementById('global-geo-enabled'),
      globalGeoMode: doc.getElementById('global-geo-mode'),
      globalLatitude: doc.getElementById('global-latitude'),
      globalLongitude: doc.getElementById('global-longitude'),
      globalCountry: doc.getElementById('global-country'),
      ruleList: doc.getElementById('rule-list'),
      ruleEditor: doc.getElementById('rule-editor'),
      newDomain: doc.getElementById('new-domain'),
      addRuleBtn: doc.getElementById('add-rule-btn'),
      importExport: doc.getElementById('import-export'),
      exportBtn: doc.getElementById('export-btn'),
      importBtn: doc.getElementById('import-btn'),
      saveBtn: doc.getElementById('save-btn'),
      reloadBtn: doc.getElementById('reload-btn'),
      status: doc.getElementById('status')
    };

    const sendRuntimeMessage = root.IPGeoRuntime.createRuntimeMessageSender(chrome);
    let state = IPGeoConfig.clone(IPGeoConfig.DEFAULT_CONFIG);
    let selectedRuleId = null;

    function setStatus(text, isError) {
      elements.status.textContent = text;
      elements.status.classList.toggle('error', Boolean(isError));
    }

    function setupStaticOptions() {
      optionsForm.fillSelect(elements.globalLanguageMode, [
        { value: 'custom', label: '自定义' },
        ...IPGeoConfig.LANGUAGE_PRESETS.map((preset, index) => ({
          value: `preset:${index}`,
          label: preset.label
        }))
      ]);
      optionsForm.fillSelect(elements.globalTimezonePreset, IPGeoConfig.TIMEZONE_PRESETS);
    }

    function renderGlobalProfile() {
      const profile = state.globalProfile;
      elements.masterEnabled.checked = state.masterEnabled !== false;
      elements.webRtcMode.value = state.webRtc.globalMode || 'strict';
      elements.globalLanguageEnabled.checked = profile.language.enabled !== false;
      elements.globalLanguageMode.value = optionsForm.presetValueForLanguage(profile.language);
      optionsForm.setLanguageForm(doc, 'global', profile.language);
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
      state.globalProfile.language = optionsForm.readLanguageForm(
        doc,
        'global',
        elements.globalLanguageEnabled.checked,
        elements.globalLanguageMode.value
      );
      state.globalProfile.timezone = IPGeoConfig.normalizeTimezone({
        enabled: elements.globalTimezoneEnabled.checked,
        mode: elements.globalTimezoneMode.value,
        timezone: elements.globalTimezone.value || elements.globalTimezonePreset.value
      });
      state.globalProfile.geolocation = IPGeoConfig.normalizeGeolocation({
        enabled: elements.globalGeoEnabled.checked,
        mode: elements.globalGeoMode.value,
        latitude: optionsForm.numberOrNull(elements.globalLatitude.value),
        longitude: optionsForm.numberOrNull(elements.globalLongitude.value),
        country: elements.globalCountry.value
      });
    }

    function selectedRule() {
      return state.rules.find((rule) => rule.id === selectedRuleId) || null;
    }

    function renderRuleList() {
      elements.ruleList.innerHTML = '';
      if (!state.rules.length) {
        const empty = doc.createElement('div');
        empty.className = 'muted';
        empty.textContent = '还没有白名单域名。';
        elements.ruleList.appendChild(empty);
        return;
      }

      state.rules.forEach((rule) => {
        const item = doc.createElement('div');
        item.className = `rule-item${rule.id === selectedRuleId ? ' is-selected' : ''}`;

        const checkbox = doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rule.enabled !== false;
        checkbox.addEventListener('change', () => {
          rule.enabled = checkbox.checked;
          renderRuleList();
        });

        const label = doc.createElement('button');
        label.className = 'secondary';
        label.textContent = rule.domain;
        label.addEventListener('click', () => {
          selectedRuleId = rule.id;
          renderAll();
        });

        const remove = doc.createElement('button');
        remove.className = 'danger';
        remove.textContent = '删除';
        remove.addEventListener('click', () => {
          state.rules = state.rules.filter((itemRule) => itemRule.id !== rule.id);
          if (selectedRuleId === rule.id) {
            selectedRuleId = state.rules[0] ? state.rules[0].id : null;
          }
          renderAll();
        });

        item.append(checkbox, label, remove);
        elements.ruleList.appendChild(item);
      });
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
        ${optionsForm.overrideFieldHtml('language', '语言')}
        ${optionsForm.overrideFieldHtml('timezone', '时区')}
        ${optionsForm.overrideFieldHtml('geolocation', '定位')}
      `;

      doc.getElementById('rule-domain').value = rule.domain;
      ['language', 'timezone', 'geolocation'].forEach((signal) => {
        const select = doc.getElementById(`rule-${signal}-mode`);
        select.value = rule.overrides[signal].mode;
        select.addEventListener('change', () => {
          rule.overrides[signal].mode = select.value;
          renderRuleEditorFields(rule);
        });
      });
      doc.getElementById('rule-domain').addEventListener('input', (event) => {
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
      const container = doc.getElementById('rule-language-fields');
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
      optionsForm.fillSelect(doc.getElementById('rule-language-mode-value'), [
        { value: 'custom', label: '自定义' },
        ...IPGeoConfig.LANGUAGE_PRESETS.map((preset, index) => ({
          value: `preset:${index}`,
          label: preset.label
        }))
      ]);
      doc.getElementById('rule-language-mode-value').value = optionsForm.presetValueForLanguage(value);
      optionsForm.setLanguageForm(doc, 'rule', value);
    }

    function renderTimezoneOverrideFields(rule) {
      const container = doc.getElementById('rule-timezone-fields');
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
      optionsForm.fillSelect(doc.getElementById('rule-timezone-preset'), IPGeoConfig.TIMEZONE_PRESETS);
      doc.getElementById('rule-timezone-mode-value').value = value.mode;
      doc.getElementById('rule-timezone-preset').value = value.timezone || IPGeoConfig.TIMEZONE_PRESETS[0];
      doc.getElementById('rule-timezone').value = value.timezone || '';
    }

    function renderGeolocationOverrideFields(rule) {
      const container = doc.getElementById('rule-geolocation-fields');
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
      doc.getElementById('rule-geo-mode-value').value = value.mode;
      doc.getElementById('rule-latitude').value = value.latitude === null ? '' : value.latitude;
      doc.getElementById('rule-longitude').value = value.longitude === null ? '' : value.longitude;
      doc.getElementById('rule-country').value = value.country || '';
    }

    function readRuleEditor() {
      const rule = selectedRule();
      if (!rule) return;
      rule.domain = IPGeoConfig.normalizeDomain(doc.getElementById('rule-domain').value);

      ['language', 'timezone', 'geolocation'].forEach((signal) => {
        rule.overrides[signal].mode = doc.getElementById(`rule-${signal}-mode`).value;
      });

      if (rule.overrides.language.mode === 'override') {
        rule.overrides.language.value = optionsForm.readLanguageForm(
          doc,
          'rule',
          true,
          doc.getElementById('rule-language-mode-value').value
        );
      }
      if (rule.overrides.timezone.mode === 'override') {
        rule.overrides.timezone.value = IPGeoConfig.normalizeTimezone({
          enabled: true,
          mode: doc.getElementById('rule-timezone-mode-value').value,
          timezone: doc.getElementById('rule-timezone').value || doc.getElementById('rule-timezone-preset').value
        });
      }
      if (rule.overrides.geolocation.mode === 'override') {
        rule.overrides.geolocation.value = IPGeoConfig.normalizeGeolocation({
          enabled: true,
          mode: doc.getElementById('rule-geo-mode-value').value,
          latitude: optionsForm.numberOrNull(doc.getElementById('rule-latitude').value),
          longitude: optionsForm.numberOrNull(doc.getElementById('rule-longitude').value),
          country: doc.getElementById('rule-country').value
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
      optionsForm.setLanguageForm(doc, 'global', preset);
    });

    elements.globalTimezonePreset.addEventListener('change', () => {
      elements.globalTimezone.value = elements.globalTimezonePreset.value;
    });

    elements.addRuleBtn.addEventListener('click', addRule);
    elements.saveBtn.addEventListener('click', saveConfig);
    elements.reloadBtn.addEventListener('click', loadConfig);
    elements.exportBtn.addEventListener('click', exportConfig);
    elements.importBtn.addEventListener('click', importConfig);

    doc.addEventListener('change', (event) => {
      if (event.target && event.target.id === 'rule-language-mode-value' && event.target.value.startsWith('preset:')) {
        const preset = IPGeoConfig.LANGUAGE_PRESETS[Number(event.target.value.split(':')[1])];
        optionsForm.setLanguageForm(doc, 'rule', preset);
      }
      if (event.target && event.target.id === 'rule-timezone-preset') {
        doc.getElementById('rule-timezone').value = event.target.value;
      }
    });

    setupStaticOptions();
    loadConfig();
  }

  root.IPGeoOptionsPage = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
