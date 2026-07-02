// Background services split out from the service-worker entrypoint.
(function(root) {
  const runtime = root.IPGeoRuntime;
  const diagnostic = root.IPGeoDiagnostic;

  if (!runtime || !diagnostic || !root.IPGeoConfig) {
    throw new Error('background/services.js requires config, runtime, and diagnostic globals');
  }

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
    const MAIN_WORLD_SCRIPT_FILES = [
      'spoof/date-time.js',
      'spoof/worker-hooks.js',
      'spoof/geolocation.js',
      'spoof/apply.js',
      'main_spoof.js'
    ];
  const BRIDGE_SCRIPT_FILES = [
    'shared/config-base.js',
    'shared/config-profile.js',
    'config.js',
    'content.js'
  ];
  const WEBRTC_POLICY_VALUES = {
    strict: 'disable_non_proxied_udp',
    compatible: 'default_public_interface_only',
    default: null
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

  function createBackgroundServices(chromeApi) {
    async function getStorageSnapshot() {
      return chromeApi.storage.local.get(null);
    }

    async function getSiteConfig() {
      const data = await getStorageSnapshot();
      const config = IPGeoConfig.migrateLegacyConfig(data);
      if (!data[IPGeoConfig.SITE_CONFIG_KEY]) {
        await chromeApi.storage.local.set({ [IPGeoConfig.SITE_CONFIG_KEY]: config });
      }
      return config;
    }

    async function getLastLocation() {
      const data = await chromeApi.storage.local.get(IPGeoConfig.LAST_LOCATION_KEY);
      return data[IPGeoConfig.LAST_LOCATION_KEY] || null;
    }

    async function applyRuntimeSideEffects(config) {
      await registerSpoofContentScripts(config);
      await applyLanguageHeaderRules(config);
      await applyWebRtcSettings(config);
    }

    async function saveSiteConfig(config) {
      const result = IPGeoConfig.validateConfig(config);
      if (!result.ok) {
        throw new Error(result.errors.join('; '));
      }
      const lastLocation = await getLastLocation();
      await chromeApi.storage.local.set({ [IPGeoConfig.SITE_CONFIG_KEY]: result.config });
      await applyRuntimeSideEffects(result.config);
      await updateAllTabs(result.config, lastLocation);
      return result.config;
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
      if (!chromeApi.scripting || !chromeApi.scripting.unregisterContentScripts) return;
      try {
        await runtime.chromeCall(
          chromeApi.scripting.unregisterContentScripts.bind(chromeApi.scripting),
          { ids: CONTENT_SCRIPT_IDS }
        );
      } catch (error) {
        if (!/non[- ]?existent|not found|does not exist/i.test(error.message)) {
          console.warn('Content script unregister failed:', error.message);
        }
      }
    }

    async function registerSpoofContentScripts(configOverride) {
      if (!chromeApi.scripting || !chromeApi.scripting.registerContentScripts) return;

      const config = configOverride || await getSiteConfig();
      const matches = IPGeoConfig.getContentScriptMatches(config);

      await unregisterSpoofContentScripts();
      if (!matches.length) return;

      await runtime.chromeCall(chromeApi.scripting.registerContentScripts.bind(chromeApi.scripting), [
        {
          id: MAIN_CONTENT_SCRIPT_ID,
          matches,
          js: MAIN_WORLD_SCRIPT_FILES,
          runAt: 'document_start',
          allFrames: true,
          world: 'MAIN',
          persistAcrossSessions: true
        },
        {
          id: BRIDGE_CONTENT_SCRIPT_ID,
          matches,
          js: BRIDGE_SCRIPT_FILES,
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
      const setting = chromeApi.privacy
        && chromeApi.privacy.network
        && chromeApi.privacy.network.webRTCIPHandlingPolicy;
      if (!setting) return;

      try {
        if (value) {
          await runtime.chromeCall(setting.set.bind(setting), {
            value,
            scope: 'regular'
          });
        } else {
          await runtime.chromeCall(setting.clear.bind(setting), { scope: 'regular' });
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
      if (!chromeApi.declarativeNetRequest || !chromeApi.declarativeNetRequest.updateDynamicRules) return;

      const addRules = [];
      if (config.masterEnabled) {
        config.rules.filter((rule) => rule.enabled).forEach((rule) => {
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

      await runtime.chromeCall(
        chromeApi.declarativeNetRequest.updateDynamicRules.bind(chromeApi.declarativeNetRequest),
        {
          removeRuleIds: languageRuleIds(),
          addRules
        }
      );
    }

    const spooferFunction = (payload) => {
      window.postMessage({
        source: 'ip-geolocation-extension',
        type: 'apply-spoof',
        payload
      }, '*');
    };

    async function buildPayloadForUrl(url, configOverride, lastLocationOverride) {
      const hostname = url ? new URL(url).hostname : '';
      const config = configOverride || await getSiteConfig();
      const lastLocation = lastLocationOverride !== undefined
        ? lastLocationOverride
        : await getLastLocation();
      return IPGeoConfig.getEffectiveProfile(config, hostname, lastLocation);
    }

    async function ensureMainWorldScripts(tabId) {
      await chromeApi.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: MAIN_WORLD_SCRIPT_FILES,
        injectImmediately: true,
        world: 'MAIN'
      });
    }

    async function injectScript(tabId, url, options) {
      const config = options && options.config ? options.config : await getSiteConfig();
      if (!diagnostic.isScriptableTabUrl(url) || !IPGeoConfig.isUrlMatchedByEnabledRule(config, url)) {
        return;
      }

      const lastLocation = options && Object.prototype.hasOwnProperty.call(options, 'lastLocation')
        ? options.lastLocation
        : await getLastLocation();
      let resolved;
      try {
        resolved = await buildPayloadForUrl(url, config, lastLocation);
      } catch (error) {
        console.warn(`无法解析 Tab ${tabId} 配置: ${error.message}`);
        return;
      }
      if (!resolved.matched || !resolved.payload) return;

      try {
        await ensureMainWorldScripts(tabId);
        await chromeApi.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: spooferFunction,
          args: [resolved.payload],
          injectImmediately: true,
          world: 'MAIN'
        });
      } catch (error) {
        console.log(`无法注入到 Tab ${tabId}: ${error.message}`);
      }
    }

    async function updateAllTabs(configOverride, lastLocationOverride) {
      const config = configOverride || await getSiteConfig();
      const lastLocation = lastLocationOverride !== undefined
        ? lastLocationOverride
        : await getLastLocation();
      if (!IPGeoConfig.getContentScriptMatches(config).length) return;

      const tabs = await chromeApi.tabs.query({});
      for (const tab of tabs) {
        if (
          tab.id
          && tab.url
          && diagnostic.isScriptableTabUrl(tab.url)
          && IPGeoConfig.isUrlMatchedByEnabledRule(config, tab.url)
        ) {
          await injectScript(tab.id, tab.url, { config, lastLocation });
        }
      }
    }

    async function updateGeolocation(forceUpdate) {
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
          await chromeApi.storage.local.set({ lastGeoError: message });
          return { ok: false, error: message };
        }

        if (
          !forceUpdate
          && oldLocation
          && locationToSet.latitude === oldLocation.latitude
          && locationToSet.longitude === oldLocation.longitude
        ) {
          return { ok: true, location: oldLocation, unchanged: true };
        }

        const nextLocation = { ...locationToSet, updateTime: new Date().toLocaleString() };
        await chromeApi.storage.local.set({
          [IPGeoConfig.LAST_LOCATION_KEY]: nextLocation,
          lastGeoError: ''
        });

        await updateAllTabs();
        return { ok: true, location: nextLocation };
      } catch (error) {
        console.error('后台更新地理位置失败:', error);
        const message = `后台更新地理位置失败: ${error.message}`;
        await chromeApi.storage.local.set({ lastGeoError: message });
        return { ok: false, error: message };
      }
    }

    async function getCurrentTabState(tab) {
      const config = await getSiteConfig();
      const lastLocation = await getLastLocation();
      const domain = tab && tab.url ? diagnostic.currentDomainFromUrl(tab.url) : '';
      const resolved = domain
        ? IPGeoConfig.getEffectiveProfile(config, domain, lastLocation)
        : { matched: false, rule: null, payload: null, errors: [] };
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

    function diagnosticStorageArea() {
      return chromeApi.storage.session || chromeApi.storage.local;
    }

    async function saveDiagnosticTarget(tab) {
      if (!tab || !Number.isInteger(tab.id)) return;
      await runtime.storageSet(diagnosticStorageArea(), {
        [diagnostic.LAST_DIAGNOSTIC_TARGET_KEY]: {
          tabId: tab.id,
          url: tab.url || '',
          title: tab.title || '',
          savedAt: Date.now()
        }
      });
    }

    async function getSavedDiagnosticTarget() {
      const items = await runtime.storageGet(
        diagnosticStorageArea(),
        [diagnostic.LAST_DIAGNOSTIC_TARGET_KEY]
      );
      return items[diagnostic.LAST_DIAGNOSTIC_TARGET_KEY] || null;
    }

    async function getDiagnosticState(tabId) {
      const saved = await getSavedDiagnosticTarget();
      const tab = await diagnostic.resolveDiagnosticTab(chromeApi, tabId, saved);
      if (!tab || !Number.isInteger(tab.id)) {
        return {
          capturedAt: new Date().toLocaleString(),
          tabId: null,
          error: '缺少目标标签页。请从 popup 重新打开诊断页。'
        };
      }

      const state = await getCurrentTabState(tab);
      const effective = diagnostic.buildEffectiveDiagnosticPayload(state);

      return {
        capturedAt: new Date().toLocaleString(),
        tabId: tab.id,
        tabUrl: tab.url || '',
        tabTitle: tab.title || '',
        domain: state.domain,
        matched: state.matched,
        masterEnabled: state.config.masterEnabled !== false,
        rule: state.rule ? {
          domain: state.rule.domain,
          enabled: state.rule.enabled
        } : null,
        errors: state.errors,
        effective,
        lastLocation: diagnostic.buildLastLocationSnapshot(state.lastLocation),
        timezoneDiagnostic: diagnostic.buildTimezoneDiagnostic(effective),
        livePage: await diagnostic.probeLivePageState(chromeApi, tab)
      };
    }

    async function openDiagnosticPage(sourceTab) {
      const tab = sourceTab && Number.isInteger(sourceTab.id)
        ? sourceTab
        : (await chromeApi.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab || !Number.isInteger(tab.id)) {
        throw new Error('缺少目标标签页。请从网页标签页重新打开诊断页。');
      }
      await saveDiagnosticTarget(tab);
      const query = `?tabId=${tab.id}`;
      await chromeApi.tabs.create({
        url: chromeApi.runtime.getURL(`test.html${query}`)
      });
      return { tabId: tab.id };
    }

    async function addDomainRule(domain) {
      const config = await getSiteConfig();
      const normalizedDomain = IPGeoConfig.normalizeDomain(domain);
      const existing = config.rules.find((rule) => rule.domain === normalizedDomain);
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
      const rule = config.rules.find((item) => item.domain === normalizedDomain);
      if (!rule) throw new Error('domain rule not found');
      rule.enabled = Boolean(enabled);
      return saveSiteConfig(config);
    }

    async function deleteDomainRule(domain) {
      const config = await getSiteConfig();
      const normalizedDomain = IPGeoConfig.normalizeDomain(domain);
      config.rules = config.rules.filter((rule) => rule.domain !== normalizedDomain);
      return saveSiteConfig(config);
    }

    async function initializeExtension() {
      const config = await getSiteConfig();
      await applyRuntimeSideEffects(config);
      if (config.masterEnabled) {
        await updateGeolocation(true);
      }
    }

    return {
      alarmName: ALARM_NAME,
      webRtcPolicies: WEBRTC_POLICY_VALUES,
      getSiteConfig,
      saveSiteConfig,
      getLastLocation,
      getExtensionState,
      setExtensionEnabled,
      updateGeolocation,
      injectScript,
      getCurrentTabState,
      getDiagnosticState,
      openDiagnosticPage,
      addDomainRule,
      setDomainRuleEnabled,
      deleteDomainRule,
      initializeExtension
    };
  }

  const api = {
    create: createBackgroundServices
  };

  root.IPGeoBackgroundServices = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
