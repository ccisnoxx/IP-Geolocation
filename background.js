importScripts('config.js');

// Service worker: owns storage migration, DNR rules, WebRTC policy, and runtime injection.
const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];
const ALARM_NAME = 'updateGeoAlarm';
const FALLBACK_LOCATION = {
  latitude: 0.00,
  longitude: 0.00,
  country: '中国 (隐私保护)'
};
const LANGUAGE_RULE_START_ID = 1100;
const LANGUAGE_RULE_END_ID = 2099;
const MAIN_CONTENT_SCRIPT_ID = 'ipgeo-main-spoof';
const BRIDGE_CONTENT_SCRIPT_ID = 'ipgeo-bridge';
const CONTENT_SCRIPT_IDS = [MAIN_CONTENT_SCRIPT_ID, BRIDGE_CONTENT_SCRIPT_ID];
const WEBRTC_POLICY_VALUES = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  off: null
};
const REQUEST_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'xmlhttprequest',
  'script',
  'stylesheet',
  'image',
  'font',
  'other'
];

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (...callbackArgs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
    });
  });
}

async function getStorageSnapshot() {
  return chrome.storage.local.get(null);
}

async function getSiteConfig() {
  const data = await getStorageSnapshot();
  const config = IPGeoConfig.migrateLegacyConfig(data);
  if (!data[IPGeoConfig.SITE_CONFIG_KEY]) {
    await chrome.storage.local.set({ [IPGeoConfig.SITE_CONFIG_KEY]: config });
  }
  return config;
}

async function saveSiteConfig(config) {
  const result = IPGeoConfig.validateConfig(config);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  await chrome.storage.local.set({ [IPGeoConfig.SITE_CONFIG_KEY]: result.config });
  await applyRuntimeSideEffects(result.config);
  await updateAllTabs();
  return result.config;
}

async function getLastLocation() {
  const data = await chrome.storage.local.get(IPGeoConfig.LAST_LOCATION_KEY);
  return data[IPGeoConfig.LAST_LOCATION_KEY] || null;
}

async function getExtensionState() {
  const config = await getSiteConfig();
  return {
    enabled: config.masterEnabled,
    config
  };
}

async function setExtensionEnabled(enabled) {
  const config = await getSiteConfig();
  config.masterEnabled = Boolean(enabled);
  return saveSiteConfig(config);
}

async function unregisterSpoofContentScripts() {
  if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) return;
  try {
    await chromeCall(chrome.scripting.unregisterContentScripts.bind(chrome.scripting), {
      ids: CONTENT_SCRIPT_IDS
    });
  } catch (error) {
    if (!/non[- ]?existent|not found|does not exist/i.test(error.message)) {
      console.warn('Content script unregister failed:', error.message);
    }
  }
}

async function registerSpoofContentScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;

  await unregisterSpoofContentScripts();
  await chromeCall(chrome.scripting.registerContentScripts.bind(chrome.scripting), [
    {
      id: MAIN_CONTENT_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['main_spoof.js'],
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN',
      persistAcrossSessions: true
    },
    {
      id: BRIDGE_CONTENT_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['config.js', 'content.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true
    }
  ]);
}

function parseGeoApiResponse(data) {
  if (!data || typeof data !== 'object') return null;

  if (data.success !== false && data.latitude && data.longitude) {
    const timezoneOffset = data.timezone && Number.isFinite(Number(data.timezone.offset))
      ? -Number(data.timezone.offset) / 60
      : null;
    return {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      country: data.country || data.country_name || data.country_code || 'N/A',
      timezone: data.timezone && data.timezone.id ? data.timezone.id : data.timezone || null,
      timezoneOffset
    };
  }

  if (data.country && data.country.code === 'CN') {
    return FALLBACK_LOCATION;
  }

  if (data.location && data.location.latitude && data.location.longitude) {
    return {
      latitude: Number(data.location.latitude),
      longitude: Number(data.location.longitude),
      country: data.country && data.country.name ? data.country.name : 'N/A',
      timezone: data.timezone || null,
      timezoneOffset: null
    };
  }

  if (typeof data.loc === 'string' && data.loc.includes(',')) {
    const [latitude, longitude] = data.loc.split(',').map(Number);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude,
        longitude,
        country: data.country || data.region || data.city || 'N/A',
        timezone: data.timezone || null,
        timezoneOffset: null
      };
    }
  }

  return null;
}

async function setWebRtcPolicyValue(value) {
  const setting = chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy;
  if (!setting) return;

  try {
    if (value) {
      await chromeCall(setting.set.bind(setting), {
        value,
        scope: 'regular'
      });
    } else {
      await chromeCall(setting.clear.bind(setting), { scope: 'regular' });
    }
  } catch (error) {
    console.warn('WebRTC policy update failed:', error.message);
  }
}

async function applyWebRtcSettings(config) {
  if (!config.masterEnabled) {
    await setWebRtcPolicyValue(null);
    return null;
  }
  const policy = WEBRTC_POLICY_VALUES[config.webRtc.globalMode];
  await setWebRtcPolicyValue(policy);
  return policy;
}

function languageForRule(config, rule) {
  const override = rule.overrides.language;
  if (override.mode === 'disable') return null;
  if (override.mode === 'override') {
    return IPGeoConfig.normalizeLanguage(override.value || {});
  }
  return config.globalProfile.language.enabled ? config.globalProfile.language : null;
}

function languageRuleIds() {
  const ids = [];
  for (let id = LANGUAGE_RULE_START_ID; id <= LANGUAGE_RULE_END_ID; id += 1) {
    ids.push(id);
  }
  ids.push(1001);
  return ids;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyLanguageHeaderRules(config) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;

  const addRules = [];
  if (config.masterEnabled) {
    config.rules.filter(rule => rule.enabled).forEach((rule) => {
      const language = languageForRule(config, rule);
      if (!language) return;
      addRules.push({
        id: LANGUAGE_RULE_START_ID + addRules.length,
        priority: Math.max(1, rule.domain.length),
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Accept-Language',
            operation: 'set',
            value: language.acceptLanguage
          }]
        },
        condition: {
          regexFilter: `^https?://([^/]+\\.)?${escapeRegex(rule.domain)}(?::[0-9]+)?/`,
          resourceTypes: REQUEST_RESOURCE_TYPES
        }
      });
    });
  }

  await chromeCall(chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest), {
    removeRuleIds: languageRuleIds(),
    addRules
  });
}

async function applyRuntimeSideEffects(config) {
  await registerSpoofContentScripts();
  await applyLanguageHeaderRules(config);
  await applyWebRtcSettings(config);
}

const spooferFunction = (payload) => {
  window.postMessage({
    source: 'ip-geolocation-extension',
    type: 'apply-spoof',
    payload
  }, '*');
};

async function buildPayloadForUrl(url) {
  const hostname = url ? new URL(url).hostname : '';
  const config = await getSiteConfig();
  const lastLocation = await getLastLocation();
  return IPGeoConfig.getEffectiveProfile(config, hostname, lastLocation);
}

async function injectScript(tabId, url) {
  let resolved;
  try {
    resolved = await buildPayloadForUrl(url);
  } catch (error) {
    console.warn(`无法解析 Tab ${tabId} 配置: ${error.message}`);
    return;
  }
  if (!resolved.matched || !resolved.payload) return;

  chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: spooferFunction,
    args: [resolved.payload],
    injectImmediately: true,
    world: 'MAIN'
  }).catch(error => console.log(`无法注入到 Tab ${tabId}: ${error.message}`));
}

async function updateAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url) {
      injectScript(tab.id, tab.url);
    }
  }
}

async function updateGeolocation(forceUpdate = false) {
  try {
    const config = await getSiteConfig();
    if (!config.masterEnabled) {
      return { ok: false, disabled: true, error: 'extension disabled' };
    }

    const oldLocation = await getLastLocation();
    let locationToSet;
    const errors = [];

    for (const apiUrl of GEO_API_URLS) {
      try {
        const response = await fetch(apiUrl, { cache: 'no-store' });
        if (!response.ok) {
          errors.push(`${apiUrl} HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        locationToSet = parseGeoApiResponse(data);
        if (locationToSet) break;
        errors.push(`${apiUrl} no valid location`);
      } catch (error) {
        errors.push(`${apiUrl} ${error.message}`);
      }
    }

    if (!locationToSet) {
      const message = `IP定位接口未返回有效经纬度: ${errors.join(' | ')}`;
      await chrome.storage.local.set({ lastGeoError: message });
      return { ok: false, error: message };
    }

    if (!forceUpdate && oldLocation && locationToSet.latitude === oldLocation.latitude && locationToSet.longitude === oldLocation.longitude) {
      return { ok: true, location: oldLocation, unchanged: true };
    }

    const nextLocation = { ...locationToSet, updateTime: new Date().toLocaleString() };
    await chrome.storage.local.set({
      [IPGeoConfig.LAST_LOCATION_KEY]: nextLocation,
      lastGeoError: ''
    });

    await updateAllTabs();
    return { ok: true, location: nextLocation };
  } catch (error) {
    console.error('后台更新地理位置失败:', error);
    const message = `后台更新地理位置失败: ${error.message}`;
    await chrome.storage.local.set({ lastGeoError: message });
    return { ok: false, error: message };
  }
}

function currentDomainFromUrl(url) {
  try {
    return IPGeoConfig.normalizeDomain(new URL(url).hostname);
  } catch (error) {
    return '';
  }
}

async function getCurrentTabState(tab) {
  const config = await getSiteConfig();
  const lastLocation = await getLastLocation();
  const domain = tab && tab.url ? currentDomainFromUrl(tab.url) : '';
  const resolved = domain ? IPGeoConfig.getEffectiveProfile(config, domain, lastLocation) : { matched: false, rule: null, payload: null, errors: [] };
  return {
    domain,
    config,
    lastLocation,
    matched: resolved.matched,
    rule: resolved.rule,
    payload: resolved.payload,
    errors: resolved.errors
  };
}

async function addDomainRule(domain) {
  const config = await getSiteConfig();
  const normalizedDomain = IPGeoConfig.normalizeDomain(domain);
  const existing = config.rules.find(rule => rule.domain === normalizedDomain);
  if (existing) {
    existing.enabled = true;
  } else {
    config.rules.push(IPGeoConfig.createRule(normalizedDomain));
  }
  return saveSiteConfig(config);
}

async function setDomainRuleEnabled(domain, enabled) {
  const config = await getSiteConfig();
  const normalizedDomain = IPGeoConfig.normalizeDomain(domain);
  const rule = config.rules.find(item => item.domain === normalizedDomain);
  if (!rule) throw new Error('domain rule not found');
  rule.enabled = Boolean(enabled);
  return saveSiteConfig(config);
}

async function deleteDomainRule(domain) {
  const config = await getSiteConfig();
  const normalizedDomain = IPGeoConfig.normalizeDomain(domain);
  config.rules = config.rules.filter(rule => rule.domain !== normalizedDomain);
  return saveSiteConfig(config);
}

async function initializeExtension() {
  const config = await getSiteConfig();
  await applyRuntimeSideEffects(config);
  if (config.masterEnabled) {
    await updateGeolocation(true);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    injectScript(tabId, tab.url);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateGeolocation();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const respond = async () => {
    if (request.action === 'manualUpdate') {
      const geo = await updateGeolocation(true);
      return { status: 'ok', geo };
    }
    if (request.action === 'getExtensionState') {
      const state = await getExtensionState();
      return { status: 'ok', state };
    }
    if (request.action === 'setExtensionEnabled') {
      const config = await setExtensionEnabled(request.enabled);
      return { status: 'ok', config, state: { enabled: config.masterEnabled, config } };
    }
    if (request.action === 'getSiteConfig') {
      const config = await getSiteConfig();
      return { status: 'ok', config };
    }
    if (request.action === 'setSiteConfig') {
      const config = await saveSiteConfig(request.config || {});
      return { status: 'ok', config };
    }
    if (request.action === 'setWebRtcGlobalMode') {
      const config = await getSiteConfig();
      config.webRtc = IPGeoConfig.normalizeWebRtc({ globalMode: request.mode });
      const saved = await saveSiteConfig(config);
      return { status: 'ok', state: { config: saved.webRtc, effectivePolicy: WEBRTC_POLICY_VALUES[saved.webRtc.globalMode] }, config: saved };
    }
    if (request.action === 'getWebRtcConfig') {
      const config = await getSiteConfig();
      return { status: 'ok', state: { config: config.webRtc, effectivePolicy: WEBRTC_POLICY_VALUES[config.webRtc.globalMode] } };
    }
    if (request.action === 'getCurrentTabState') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const state = await getCurrentTabState(tab);
      return { status: 'ok', state };
    }
    if (request.action === 'addDomainRule') {
      const config = await addDomainRule(request.domain);
      return { status: 'ok', config };
    }
    if (request.action === 'setDomainRuleEnabled') {
      const config = await setDomainRuleEnabled(request.domain, request.enabled);
      return { status: 'ok', config };
    }
    if (request.action === 'deleteDomainRule') {
      const config = await deleteDomainRule(request.domain);
      return { status: 'ok', config };
    }
    if (request.action === 'openOptions') {
      await chrome.runtime.openOptionsPage();
      return { status: 'ok' };
    }
    throw new Error(`unknown action: ${request.action}`);
  };

  respond()
    .then(sendResponse)
    .catch(error => sendResponse({ status: 'error', message: error.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  initializeExtension();
});
