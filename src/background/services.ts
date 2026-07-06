import { updateAcceptLanguageRules } from './dnr';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy } from './webrtc';
import {
  LAST_LOCATION_KEY,
  RULES_INITIALIZED_KEY,
  getEffectiveProfile,
  getContentScriptMatches,
  isUrlMatchedByEnabledRule,
  migrateLegacyConfig,
  validateConfig
} from '../shared/config-resolver';
import { createRule, normalizeConfig, normalizeDomain, normalizeWebRtc } from '../shared/config-model';
import type { EffectiveProfileResult, LastLocation, SiteSpoofConfig } from '../shared/types';

const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];

const ALARM_NAME = 'vanishgeo-update-location';
const MAIN_RUNTIME_SCRIPT_ID = 'vanishgeo-main-runtime';
const BRIDGE_SCRIPT_ID = 'vanishgeo-bridge';
const CONTENT_SCRIPT_IDS = [MAIN_RUNTIME_SCRIPT_ID, BRIDGE_SCRIPT_ID];
const MAIN_RUNTIME_FILES = ['injected/runtime.js'];
const BRIDGE_FILES = ['content/content.js'];

const FALLBACK_LOCATION: LastLocation = {
  latitude: 0,
  longitude: 0,
  country: 'Privacy fallback'
};

function isScriptableUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url || ''));
}

export function parseGeoApiResponse(data: any): Omit<LastLocation, 'updateTime'> | null {
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

export interface BackgroundServices {
  alarmName: string;
  webRtcPolicies: typeof WEBRTC_POLICY_VALUES;
  getSiteConfig(): Promise<SiteSpoofConfig>;
  saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig>;
  getLastLocation(): Promise<LastLocation | null>;
  getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }>;
  setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig>;
  updateGeolocation(forceUpdate?: boolean): Promise<{ ok: boolean; location?: LastLocation; unchanged?: boolean; disabled?: boolean; error?: string }>;
  injectScript(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { domain: string; config: SiteSpoofConfig; lastLocation: LastLocation | null }>;
  addDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig>;
  deleteDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig>;
  openDiagnosticPage(): Promise<void>;
  initializeExtension(): Promise<void>;
}

export function createBackgroundServices(): BackgroundServices {
  async function getStorageSnapshot(): Promise<Record<string, any>> {
    return chrome.storage.local.get(null);
  }

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const data = await getStorageSnapshot();
    const config = migrateLegacyConfig(data);
    if (!data.siteSpoofConfig || data[RULES_INITIALIZED_KEY] !== true) {
      await chrome.storage.local.set({ siteSpoofConfig: config, [RULES_INITIALIZED_KEY]: true });
    }
    return config;
  }

  async function getLastLocation(): Promise<LastLocation | null> {
    const data = await chrome.storage.local.get(LAST_LOCATION_KEY);
    return data[LAST_LOCATION_KEY] || null;
  }

  async function unregisterSpoofContentScripts(): Promise<void> {
    if (!chrome.scripting?.unregisterContentScripts) return;
    try {
      await chrome.scripting.unregisterContentScripts({ ids: CONTENT_SCRIPT_IDS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/non[- ]?existent|not found|does not exist/i.test(message)) {
        console.warn('Content script unregister failed:', message);
      }
    }
  }

  async function registerSpoofContentScripts(configOverride?: SiteSpoofConfig): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;
    const config = configOverride || await getSiteConfig();
    const matches = getContentScriptMatches(config);

    await unregisterSpoofContentScripts();
    if (!matches.length) return;

    await chrome.scripting.registerContentScripts([
      {
        id: MAIN_RUNTIME_SCRIPT_ID,
        matches,
        js: MAIN_RUNTIME_FILES,
        runAt: 'document_start',
        allFrames: true,
        world: 'MAIN',
        persistAcrossSessions: true
      },
      {
        id: BRIDGE_SCRIPT_ID,
        matches,
        js: BRIDGE_FILES,
        runAt: 'document_start',
        allFrames: true,
        world: 'ISOLATED',
        persistAcrossSessions: true
      }
    ]);
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    await registerSpoofContentScripts(config);
    await updateAcceptLanguageRules(config);
    await applyWebRTCPolicy(config);
  }

  async function saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    const result = validateConfig(config);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    const lastLocation = await getLastLocation();
    await chrome.storage.local.set({ siteSpoofConfig: result.config });
    await applyRuntimeSideEffects(result.config);
    await updateAllTabs(result.config, lastLocation);
    return result.config;
  }

  async function getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }> {
    const config = await getSiteConfig();
    return { enabled: config.masterEnabled, config };
  }

  async function setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    return saveSiteConfig({ ...config, masterEnabled: Boolean(enabled) });
  }

  async function setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    return saveSiteConfig({ ...config, webRtc: normalizeWebRtc({ globalMode: mode as any }) });
  }

  async function buildPayloadForUrl(url: string, configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<EffectiveProfileResult> {
    const hostname = url ? new URL(url).hostname : '';
    const config = configOverride || await getSiteConfig();
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();
    return getEffectiveProfile(config, hostname, lastLocation);
  }

  async function injectScript(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void> {
    const config = options?.config || await getSiteConfig();
    if (!isScriptableUrl(url) || !isUrlMatchedByEnabledRule(config, url)) return;

    const lastLocation = Object.prototype.hasOwnProperty.call(options || {}, 'lastLocation')
      ? options?.lastLocation || null
      : await getLastLocation();
    const resolved = await buildPayloadForUrl(url, config, lastLocation);
    if (!resolved.matched || !resolved.payload) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: MAIN_RUNTIME_FILES,
        injectImmediately: true,
        world: 'MAIN'
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (payload) => {
          window.postMessage({ source: 'vanishgeo-extension', type: 'apply-spoof', payload }, '*');
        },
        args: [resolved.payload],
        injectImmediately: true,
        world: 'MAIN'
      });
    } catch (error) {
      console.warn(`VanishGeo could not inject tab ${tabId}:`, error instanceof Error ? error.message : String(error));
    }
  }

  async function updateAllTabs(configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<void> {
    const config = configOverride || await getSiteConfig();
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();
    if (!getContentScriptMatches(config).length) return;

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && isScriptableUrl(tab.url) && isUrlMatchedByEnabledRule(config, tab.url)) {
        await injectScript(tab.id, tab.url, { config, lastLocation });
      }
    }
  }

  async function updateGeolocation(forceUpdate = false): Promise<{ ok: boolean; location?: LastLocation; unchanged?: boolean; disabled?: boolean; error?: string }> {
    try {
      const config = await getSiteConfig();
      if (!config.masterEnabled) {
        return { ok: false, disabled: true, error: 'extension disabled' };
      }

      const oldLocation = await getLastLocation();
      let locationToSet: Omit<LastLocation, 'updateTime'> | null = null;
      const errors: string[] = [];

      for (const apiUrl of GEO_API_URLS) {
        try {
          const response = await fetch(apiUrl, { cache: 'no-store' });
          if (!response.ok) {
            errors.push(`${apiUrl} HTTP ${response.status}`);
            continue;
          }
          locationToSet = parseGeoApiResponse(await response.json());
          if (locationToSet) break;
          errors.push(`${apiUrl} no valid location`);
        } catch (error) {
          errors.push(`${apiUrl} ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!locationToSet) {
        const message = `IP geolocation APIs returned no valid coordinates: ${errors.join(' | ')}`;
        await chrome.storage.local.set({ lastGeoError: message });
        return { ok: false, error: message };
      }

      if (!forceUpdate && oldLocation && locationToSet.latitude === oldLocation.latitude && locationToSet.longitude === oldLocation.longitude) {
        return { ok: true, location: oldLocation, unchanged: true };
      }

      const nextLocation: LastLocation = { ...locationToSet, updateTime: new Date().toLocaleString() };
      await chrome.storage.local.set({ [LAST_LOCATION_KEY]: nextLocation, lastGeoError: '' });
      await updateAllTabs(config, nextLocation);
      return { ok: true, location: nextLocation };
    } catch (error) {
      const message = `background geolocation update failed: ${error instanceof Error ? error.message : String(error)}`;
      await chrome.storage.local.set({ lastGeoError: message });
      return { ok: false, error: message };
    }
  }

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult> {
    return buildPayloadForUrl(url);
  }

  async function getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { domain: string; config: SiteSpoofConfig; lastLocation: LastLocation | null }> {
    const config = await getSiteConfig();
    const lastLocation = await getLastLocation();
    const domain = tab?.url ? normalizeDomain(tab.url) : '';
    const resolved = domain
      ? getEffectiveProfile(config, domain, lastLocation)
      : { matched: false, rule: null, payload: null, errors: [] };
    return { domain, config, lastLocation, ...resolved };
  }

  async function addDomainRule(domain: string): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    const normalizedDomain = normalizeDomain(domain);
    const existing = config.rules.find((rule) => rule.domain === normalizedDomain);
    if (existing) {
      existing.enabled = true;
    } else {
      config.rules.push(createRule(normalizedDomain));
    }
    return saveSiteConfig(config);
  }

  async function setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    const normalizedDomain = normalizeDomain(domain);
    const rule = config.rules.find((item) => item.domain === normalizedDomain);
    if (!rule) throw new Error('domain rule not found');
    rule.enabled = Boolean(enabled);
    return saveSiteConfig(config);
  }

  async function deleteDomainRule(domain: string): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    const normalizedDomain = normalizeDomain(domain);
    config.rules = config.rules.filter((rule) => rule.domain !== normalizedDomain);
    return saveSiteConfig(config);
  }

  async function openDiagnosticPage(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('leak-test/leak-test.html') });
  }

  async function initializeExtension(): Promise<void> {
    const config = normalizeConfig(await getSiteConfig());
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
    getPayloadForUrl,
    getCurrentTabState,
    addDomainRule,
    setDomainRuleEnabled,
    deleteDomainRule,
    setWebRtcGlobalMode,
    openDiagnosticPage,
    initializeExtension
  };
}
