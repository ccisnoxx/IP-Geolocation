// Shared options-page form helpers.
(function(root) {
  const configApi = root.IPGeoConfig || (
    typeof module !== 'undefined' && module.exports
      ? require('../config')
      : null
  );

  if (!configApi) {
    throw new Error('IPGeoConfig is required before options-form.js');
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

  function setLanguageForm(doc, prefix, language) {
    doc.getElementById(`${prefix}-language`).value = language.language || '';
    doc.getElementById(`${prefix}-languages`).value = Array.isArray(language.languages) ? language.languages.join(', ') : '';
    doc.getElementById(`${prefix}-accept-language`).value = language.acceptLanguage || '';
  }

  function readLanguageForm(doc, prefix, enabled, modeValue) {
    if (modeValue && modeValue.startsWith('preset:')) {
      const preset = configApi.LANGUAGE_PRESETS[Number(modeValue.split(':')[1])] || configApi.LANGUAGE_PRESETS[0];
      return {
        enabled,
        mode: 'preset',
        language: preset.language,
        languages: preset.languages,
        acceptLanguage: preset.acceptLanguage
      };
    }
    return configApi.normalizeLanguage({
      enabled,
      mode: 'custom',
      language: doc.getElementById(`${prefix}-language`).value,
      languages: doc.getElementById(`${prefix}-languages`).value,
      acceptLanguage: doc.getElementById(`${prefix}-accept-language`).value
    });
  }

  function presetValueForLanguage(language) {
    const foundIndex = configApi.LANGUAGE_PRESETS.findIndex((preset) => (
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

  const api = {
    fillSelect,
    setLanguageForm,
    readLanguageForm,
    presetValueForLanguage,
    numberOrNull,
    overrideFieldHtml
  };

  root.IPGeoOptionsForm = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
