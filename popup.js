// Popup controller for current-site allowlist actions and active profile summary.
const masterEnableBtn = document.getElementById('master-enable-btn');
const masterDisableBtn = document.getElementById('master-disable-btn');
const masterStatusEl = document.getElementById('master-status');
const currentDomainEl = document.getElementById('current-domain');
const currentStatusEl = document.getElementById('current-status');
const matchedRuleEl = document.getElementById('matched-rule');
const addDomainBtn = document.getElementById('add-domain-btn');
const toggleDomainBtn = document.getElementById('toggle-domain-btn');
const deleteDomainBtn = document.getElementById('delete-domain-btn');
const domainStatusEl = document.getElementById('domain-status');
const summaryLanguageEl = document.getElementById('summary-language');
const summaryTimezoneEl = document.getElementById('summary-timezone');
const summaryGeolocationEl = document.getElementById('summary-geolocation');
const summaryStatusEl = document.getElementById('summary-status');
const webRtcStrictBtn = document.getElementById('webrtc-strict-btn');
const webRtcCompatibleBtn = document.getElementById('webrtc-compatible-btn');
const webRtcOffBtn = document.getElementById('webrtc-off-btn');
const lastCountryEl = document.getElementById('last-country');
const lastCoordinatesEl = document.getElementById('last-coordinates');
const lastTimezoneEl = document.getElementById('last-timezone');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const optionsBtn = document.getElementById('options-btn');
const refreshStatusEl = document.getElementById('refresh-status');

let currentState = null;

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

function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle('error', Boolean(isError));
}

function formatEnabled(value) {
  return value ? '启用' : '关闭';
}

function formatLanguage(payload) {
  const language = payload && payload.languageConfig;
  if (!language) return '未启用';
  return `${language.language} / ${language.acceptLanguage}`;
}

function formatTimezone(payload) {
  if (!payload || !payload.timezone) return '未启用';
  return payload.timezone;
}

function formatGeolocation(payload) {
  const geolocation = payload && payload.geolocation;
  if (!geolocation) return '未启用';
  const country = geolocation.country ? ` ${geolocation.country}` : '';
  return `${geolocation.latitude}, ${geolocation.longitude}${country}`;
}

function renderMaster(config) {
  const enabled = config.masterEnabled !== false;
  masterEnableBtn.classList.toggle('is-active', enabled);
  masterDisableBtn.classList.toggle('is-active', !enabled);
  setStatus(
    masterStatusEl,
    enabled
      ? '总开关已启用；页面级伪装只对白名单域名生效。'
      : '总开关已关闭；页面级伪装和 WebRTC 全局策略已停止。'
  );
}

function renderWebRtc(config) {
  const mode = config.webRtc && config.webRtc.globalMode ? config.webRtc.globalMode : 'strict';
  webRtcStrictBtn.classList.toggle('is-active', mode === 'strict');
  webRtcCompatibleBtn.classList.toggle('is-active', mode === 'compatible');
  webRtcOffBtn.classList.toggle('is-active', mode === 'off');
}

function renderCurrentSite(state) {
  const { domain, matched, rule, payload, errors } = state;
  currentDomainEl.textContent = domain || '非网页标签页';
  matchedRuleEl.textContent = rule ? rule.domain : '-';
  addDomainBtn.disabled = !domain || Boolean(rule);
  toggleDomainBtn.disabled = !rule;
  deleteDomainBtn.disabled = !rule;

  if (!domain) {
    currentStatusEl.textContent = '不可配置';
    setStatus(domainStatusEl, '当前标签页没有可配置域名。');
    return;
  }

  if (!rule) {
    currentStatusEl.textContent = '未加入白名单';
    toggleDomainBtn.textContent = '停用';
    setStatus(domainStatusEl, '点击“加入”后，该域名及其子域名会应用全局默认配置。');
    return;
  }

  currentStatusEl.textContent = rule.enabled ? (matched ? '已启用' : '规则未生效') : '已停用';
  toggleDomainBtn.textContent = rule.enabled ? '停用' : '启用';
  if (errors && errors.length) {
    setStatus(domainStatusEl, errors.join('; '), true);
  } else if (payload) {
    setStatus(domainStatusEl, '当前网站会应用下方生效配置。');
  } else {
    setStatus(domainStatusEl, '规则已保存，但当前不会注入页面级配置。');
  }
}

function renderSummary(state) {
  summaryLanguageEl.textContent = formatLanguage(state.payload);
  summaryTimezoneEl.textContent = formatTimezone(state.payload);
  summaryGeolocationEl.textContent = formatGeolocation(state.payload);
  if (!state.matched) {
    setStatus(summaryStatusEl, '未命中白名单，不注入页面级配置。');
  } else if (state.errors && state.errors.length) {
    setStatus(summaryStatusEl, state.errors.join('; '), true);
  } else {
    setStatus(summaryStatusEl, '语言、时区、定位按当前生效 profile 应用。');
  }
}

function renderLastLocation(location) {
  if (!location) {
    lastCountryEl.textContent = '-';
    lastCoordinatesEl.textContent = '-';
    lastTimezoneEl.textContent = '-';
    lastUpdatedEl.textContent = '-';
    return;
  }
  lastCountryEl.textContent = location.country || '-';
  lastCoordinatesEl.textContent = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
    ? `${location.latitude}, ${location.longitude}`
    : '-';
  lastTimezoneEl.textContent = location.timezone || '-';
  lastUpdatedEl.textContent = location.updateTime || '-';
}

function renderState(state) {
  currentState = state;
  renderMaster(state.config);
  renderWebRtc(state.config);
  renderCurrentSite(state);
  renderSummary(state);
  renderLastLocation(state.lastLocation);
}

async function loadState() {
  try {
    const response = await sendRuntimeMessage({ action: 'getCurrentTabState' });
    renderState(response.state);
  } catch (error) {
    setStatus(domainStatusEl, `读取状态失败: ${error.message}`, true);
  }
}

async function setMaster(enabled) {
  await sendRuntimeMessage({ action: 'setExtensionEnabled', enabled });
  await loadState();
}

async function setWebRtcMode(mode) {
  await sendRuntimeMessage({ action: 'setWebRtcGlobalMode', mode });
  await loadState();
}

masterEnableBtn.addEventListener('click', () => setMaster(true));
masterDisableBtn.addEventListener('click', () => setMaster(false));

addDomainBtn.addEventListener('click', async () => {
  if (!currentState || !currentState.domain) return;
  try {
    await sendRuntimeMessage({ action: 'addDomainRule', domain: currentState.domain });
    await loadState();
  } catch (error) {
    setStatus(domainStatusEl, `加入失败: ${error.message}`, true);
  }
});

toggleDomainBtn.addEventListener('click', async () => {
  if (!currentState || !currentState.rule) return;
  try {
    await sendRuntimeMessage({
      action: 'setDomainRuleEnabled',
      domain: currentState.rule.domain,
      enabled: !currentState.rule.enabled
    });
    await loadState();
  } catch (error) {
    setStatus(domainStatusEl, `切换失败: ${error.message}`, true);
  }
});

deleteDomainBtn.addEventListener('click', async () => {
  if (!currentState || !currentState.rule) return;
  try {
    await sendRuntimeMessage({ action: 'deleteDomainRule', domain: currentState.rule.domain });
    await loadState();
  } catch (error) {
    setStatus(domainStatusEl, `删除失败: ${error.message}`, true);
  }
});

webRtcStrictBtn.addEventListener('click', () => setWebRtcMode('strict'));
webRtcCompatibleBtn.addEventListener('click', () => setWebRtcMode('compatible'));
webRtcOffBtn.addEventListener('click', () => setWebRtcMode('off'));

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  setStatus(refreshStatusEl, '正在刷新出口 IP 定位...');
  try {
    const response = await sendRuntimeMessage({ action: 'manualUpdate' });
    if (!response.geo || !response.geo.ok) {
      setStatus(refreshStatusEl, response.geo && response.geo.error ? response.geo.error : '刷新失败', true);
    } else {
      setStatus(refreshStatusEl, '出口 IP 定位已刷新。');
    }
    await loadState();
  } catch (error) {
    setStatus(refreshStatusEl, `刷新失败: ${error.message}`, true);
  } finally {
    refreshBtn.disabled = false;
  }
});

optionsBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'openOptions' });
});

document.addEventListener('DOMContentLoaded', loadState);
