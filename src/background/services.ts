import { updateAcceptLanguageRules } from './dnr';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy, getWebRTCPolicyState } from './webrtc';
import {
  LAST_LOCATION_KEY,
  RULES_INITIALIZED_KEY,
  getEffectiveProfile,
  getContentScriptMatches,
  isUrlMatchedByEnabledRule,
  migrateLegacyConfig,
  repairInvalidRuleDomains,
  validateConfig
} from '../shared/config-resolver';
import { createRule, normalizeConfig, normalizeDomain, normalizeWebRtc } from '../shared/config-model';
import {
  GEO_PROVIDER_BACKOFF_KEY,
  GEO_PROVIDER_TIMEOUT_MS,
  GEO_REFRESH_STATE_KEY,
  LAST_LOCATION_TTL_MS,
  deriveIpLocationStatus,
  getLastLocationFreshness,
  hasValidLastLocation,
  nextGeoProviderBackoffEntry,
  normalizeGeoProviderBackoff,
  normalizeGeoRefreshState,
  withFreshLocationMetadata
} from '../shared/ip-location';
import { formatLocaleDateTimeForProfile } from '../shared/locale-datetime';
import type { EffectivePayload, EffectiveProfileResult, LastLocation, SiteSpoofConfig } from '../shared/types';
import type {
  GeoProviderBackoff,
  GeoRefreshState,
  IpLocationStatusSnapshot
} from '../shared/ip-location';
import type { WebRtcPolicyState } from './webrtc';

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
const LEAK_TEST_URL = 'https://leak.962850.xyz/leak-test/leak-test.html';
const UPDATE_ALL_TABS_CONCURRENCY = 4;

type GeolocationUpdateResult = {
  ok: boolean;
  location?: LastLocation;
  unchanged?: boolean;
  disabled?: boolean;
  stale?: boolean;
  error?: string;
};

type InjectionOutcome = 'applied' | 'skipped' | 'failed';

interface RuntimeSideEffectsRequest {
  config: SiteSpoofConfig;
  signature: string;
}

interface UpdateAllTabsRequest {
  config?: SiteSpoofConfig;
  hasLastLocation: boolean;
  lastLocation: LastLocation | null;
}

interface ScriptableTabTarget {
  id: number;
  url: string;
}

interface TabInjectionRequest {
  tabId: number;
  url: string;
  payload: NonNullable<EffectiveProfileResult['payload']>;
  key: string;
}

interface TabInjectionState {
  running: boolean;
  currentKey: string | null;
  pending: TabInjectionRequest | null;
  promise: Promise<InjectionOutcome>;
}

function isScriptableUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url || ''));
}

function isDuplicateScriptIdError(error: unknown): boolean {
  return /Duplicate script ID/i.test(error instanceof Error ? error.message : String(error));
}

function formatProviderRetryTime(value: number): string {
  return new Date(value).toLocaleString();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeConfigSignature(config: SiteSpoofConfig): string {
  return JSON.stringify(normalizeConfig(config));
}

function injectedLocationSignature(location: LastLocation | null): string {
  if (!location) return 'null';
  return JSON.stringify({
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    country: location.country || '',
    timezone: location.timezone || null,
    timezoneOffset: location.timezoneOffset ?? null
  });
}

function calculateTimezoneOffsetMinutes(timezone: string, date = new Date()): number | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    );
    return Number.isFinite(asUtc) ? Math.round((date.getTime() - asUtc) / 60000) : null;
  } catch {
    return null;
  }
}

function appendExpectedProfileParams(
  url: URL,
  payload: EffectivePayload,
  config: SiteSpoofConfig,
  webRtcPolicyState: WebRtcPolicyState | null,
  webRtcPolicyError: string | null
): void {
  const params = url.searchParams;
  params.set('validation', 'acceptance');
  const localeStringDate = new Date();

  if (payload.languageConfig) {
    params.set('expectedLanguage', payload.languageConfig.language);
    params.set('expectedLanguages', payload.languageConfig.languages.join(','));
    params.set('expectedAcceptLanguage', payload.languageConfig.acceptLanguage);
  }

  if (payload.timezone) {
    params.set('expectedTimezone', payload.timezone);
    const offset = calculateTimezoneOffsetMinutes(payload.timezone);
    if (offset !== null) {
      params.set('expectedTimezoneOffset', String(offset));
    }
  }

  if (payload.geolocation) {
    params.set('expectedLatitude', String(payload.geolocation.latitude));
    params.set('expectedLongitude', String(payload.geolocation.longitude));
    const tolerance = payload.geolocation.randomize
      ? Math.max(payload.geolocation.randomRadiusMeters, payload.geolocation.accuracy)
      : payload.geolocation.accuracy;
    params.set('expectedGeoToleranceMeters', String(Math.max(1, tolerance)));
  }

  const webRtcMode = normalizeWebRtc(config.webRtc).globalMode;
  params.set('expectedWebRtcMode', webRtcMode);
  params.set('expectedWebRtcPolicy', WEBRTC_POLICY_VALUES[webRtcMode] || 'default');
  if (webRtcPolicyState) {
    params.set('actualWebRtcPolicySupported', String(webRtcPolicyState.supported));
    if (webRtcPolicyState.actualPolicy) {
      params.set('actualWebRtcPolicy', webRtcPolicyState.actualPolicy);
    }
    if (webRtcPolicyState.levelOfControl) {
      params.set('actualWebRtcPolicyLevelOfControl', webRtcPolicyState.levelOfControl);
    }
    params.set('actualWebRtcPolicyControlledByThisExtension', String(webRtcPolicyState.controlledByThisExtension));
    params.set('actualWebRtcLeakProtectionActive', String(webRtcPolicyState.leakProtectionActive));
  }
  if (webRtcPolicyError) {
    params.set('actualWebRtcPolicyError', webRtcPolicyError);
  }

  if (payload.languageConfig && payload.timezone) {
    params.set('expectedLocaleStringTimestamp', String(localeStringDate.getTime()));
    params.set('expectedLocaleString', formatLocaleDateTimeForProfile(
      localeStringDate,
      payload.languageConfig.language,
      payload.timezone
    ));
  }
}

function buildAllTabsSignature(config: SiteSpoofConfig, lastLocation: LastLocation | null, targets: ScriptableTabTarget[]): string {
  const targetSignature = targets
    .map((target) => `${target.id}:${target.url}`)
    .sort()
    .join('|');
  return [
    runtimeConfigSignature(config),
    injectedLocationSignature(lastLocation),
    targetSignature
  ].join('\n');
}

function buildTabInjectionKey(url: string, payload: NonNullable<EffectiveProfileResult['payload']>): string {
  return `${url}\n${JSON.stringify(payload)}`;
}

function toScriptableTabTargets(tabs: chrome.tabs.Tab[], config: SiteSpoofConfig): ScriptableTabTarget[] {
  return tabs.reduce<ScriptableTabTarget[]>((targets, tab) => {
    if (
      typeof tab.id === 'number'
      && tab.url
      && isScriptableUrl(tab.url)
      && isUrlMatchedByEnabledRule(config, tab.url)
    ) {
      targets.push({ id: tab.id, url: tab.url });
    }
    return targets;
  }, []);
}

function validCoordinateLocation(input: {
  latitude: unknown;
  longitude: unknown;
  country?: unknown;
  timezone?: unknown;
  timezoneOffset?: unknown;
}): Omit<LastLocation, 'updateTime' | 'updatedAt' | 'expiresAt' | 'provider'> | null {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (
    !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    country: input.country ? String(input.country) : 'N/A',
    timezone: input.timezone ? String(input.timezone) : null,
    timezoneOffset: Number.isFinite(Number(input.timezoneOffset)) ? Number(input.timezoneOffset) : null
  };
}

export function parseGeoApiResponse(data: any): Omit<LastLocation, 'updateTime' | 'updatedAt' | 'expiresAt' | 'provider'> | null {
  if (!data || typeof data !== 'object') return null;

  if (data.success !== false && data.latitude !== undefined && data.longitude !== undefined) {
    const timezoneOffset = data.timezone && Number.isFinite(Number(data.timezone.offset))
      ? -Number(data.timezone.offset) / 60
      : null;
    return validCoordinateLocation({
      latitude: data.latitude,
      longitude: data.longitude,
      country: data.country || data.country_name || data.country_code || 'N/A',
      timezone: data.timezone && data.timezone.id ? data.timezone.id : data.timezone || null,
      timezoneOffset
    });
  }

  if (data.location && data.location.latitude !== undefined && data.location.longitude !== undefined) {
    return validCoordinateLocation({
      latitude: data.location.latitude,
      longitude: data.location.longitude,
      country: data.country && data.country.name ? data.country.name : 'N/A',
      timezone: data.timezone || null,
      timezoneOffset: null
    });
  }

  if (typeof data.loc === 'string' && data.loc.includes(',')) {
    const [latitude, longitude] = data.loc.split(',').map(Number);
    return validCoordinateLocation({
      latitude,
      longitude,
      country: data.country || data.region || data.city || 'N/A',
      timezone: data.timezone || null,
      timezoneOffset: null
    });
  }

  return null;
}

export async function fetchGeoApiLocation(
  apiUrl: string,
  timeoutMs = GEO_PROVIDER_TIMEOUT_MS
): Promise<Omit<LastLocation, 'updateTime' | 'updatedAt' | 'expiresAt' | 'provider'>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = parseGeoApiResponse(await response.json());
    if (!parsed) {
      throw new Error('no valid location');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface BackgroundServices {
  alarmName: string;
  webRtcPolicies: typeof WEBRTC_POLICY_VALUES;
  getSiteConfig(): Promise<SiteSpoofConfig>;
  saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig>;
  getLastLocation(): Promise<LastLocation | null>;
  getIpLocationStatus(): Promise<IpLocationStatusSnapshot>;
  getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }>;
  setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig>;
  getWebRtcPolicyState(): Promise<WebRtcPolicyState>;
  updateGeolocation(forceUpdate?: boolean): Promise<GeolocationUpdateResult>;
  injectScript(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { url: string; domain: string; scriptable: boolean; config: SiteSpoofConfig; lastLocation: LastLocation | null; ipLocationStatus: IpLocationStatusSnapshot }>;
  addDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig>;
  deleteDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig>;
  openDiagnosticPage(): Promise<void>;
  initializeExtension(): Promise<void>;
}

export function createBackgroundServices(): BackgroundServices {
  let contentScriptRegistrationQueue: Promise<void> = Promise.resolve();
  let pendingRuntimeSideEffects: RuntimeSideEffectsRequest | null = null;
  let runtimeSideEffectsQueue: Promise<void> | null = null;
  let lastSuccessfulRuntimeSideEffectsSignature = '';
  let pendingAllTabsUpdate: UpdateAllTabsRequest | null = null;
  let updateAllTabsQueue: Promise<void> | null = null;
  let lastSuccessfulAllTabsSignature = '';
  const tabInjectionStates = new Map<number, TabInjectionState>();
  let activeGeolocationUpdate: { forceUpdate: boolean; promise: Promise<GeolocationUpdateResult> } | null = null;

  async function getStorageSnapshot(): Promise<Record<string, any>> {
    return chrome.storage.local.get(null);
  }

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const data = await getStorageSnapshot();
    const migratedConfig = migrateLegacyConfig(data);
    const { config, repaired } = repairInvalidRuleDomains(migratedConfig);
    if (!data.siteSpoofConfig || data[RULES_INITIALIZED_KEY] !== true || repaired) {
      await chrome.storage.local.set({ siteSpoofConfig: config, [RULES_INITIALIZED_KEY]: true });
    }
    return config;
  }

  async function getLastLocation(): Promise<LastLocation | null> {
    const data = await chrome.storage.local.get(LAST_LOCATION_KEY);
    const location = data[LAST_LOCATION_KEY] || null;
    return hasValidLastLocation(location) ? location : null;
  }

  async function getGeoRefreshState(): Promise<GeoRefreshState> {
    const data = await chrome.storage.local.get(GEO_REFRESH_STATE_KEY);
    return normalizeGeoRefreshState(data[GEO_REFRESH_STATE_KEY]);
  }

  async function setGeoRefreshState(state: GeoRefreshState): Promise<void> {
    await chrome.storage.local.set({ [GEO_REFRESH_STATE_KEY]: normalizeGeoRefreshState(state) });
  }

  async function getGeoProviderBackoff(): Promise<GeoProviderBackoff> {
    const data = await chrome.storage.local.get(GEO_PROVIDER_BACKOFF_KEY);
    return normalizeGeoProviderBackoff(data[GEO_PROVIDER_BACKOFF_KEY]);
  }

  async function setGeoProviderBackoff(backoff: GeoProviderBackoff): Promise<void> {
    await chrome.storage.local.set({ [GEO_PROVIDER_BACKOFF_KEY]: normalizeGeoProviderBackoff(backoff) });
  }

  async function getIpLocationStatus(): Promise<IpLocationStatusSnapshot> {
    const [lastLocation, refreshState] = await Promise.all([
      getLastLocation(),
      getGeoRefreshState()
    ]);
    return deriveIpLocationStatus(lastLocation, refreshState);
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

  async function replaceSpoofContentScripts(configOverride?: SiteSpoofConfig): Promise<void> {
    const config = configOverride || await getSiteConfig();
    const matches = getContentScriptMatches(config);

    await unregisterSpoofContentScripts();
    if (!matches.length) return;

    const scripts: chrome.scripting.RegisteredContentScript[] = [
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
    ];

    try {
      await chrome.scripting.registerContentScripts(scripts);
    } catch (error) {
      if (!isDuplicateScriptIdError(error)) throw error;
      await unregisterSpoofContentScripts();
      await chrome.scripting.registerContentScripts(scripts);
    }
  }

  async function registerSpoofContentScripts(configOverride?: SiteSpoofConfig): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;

    const nextRegistration = contentScriptRegistrationQueue.then(
      () => replaceSpoofContentScripts(configOverride),
      () => replaceSpoofContentScripts(configOverride)
    );
    contentScriptRegistrationQueue = nextRegistration.catch(() => undefined);
    return nextRegistration;
  }

  async function runRuntimeSideEffect(label: string, task: () => Promise<unknown>): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      console.warn(`VanishGeo ${label} failed:`, formatError(error));
      return false;
    }
  }

  async function runRuntimeSideEffects(config: SiteSpoofConfig): Promise<boolean> {
    const results = await Promise.all([
      runRuntimeSideEffect('content script registration', () => registerSpoofContentScripts(config)),
      runRuntimeSideEffect('Accept-Language rules update', () => updateAcceptLanguageRules(config)),
      runRuntimeSideEffect('WebRTC policy update', () => applyWebRTCPolicy(config))
    ]);
    return results.every(Boolean);
  }

  async function drainRuntimeSideEffectsQueue(): Promise<void> {
    while (pendingRuntimeSideEffects) {
      const request = pendingRuntimeSideEffects;
      pendingRuntimeSideEffects = null;
      if (request.signature === lastSuccessfulRuntimeSideEffectsSignature) continue;

      const applied = await runRuntimeSideEffects(request.config);
      if (applied) {
        lastSuccessfulRuntimeSideEffectsSignature = request.signature;
      }
    }
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    const normalizedConfig = normalizeConfig(config);
    const signature = runtimeConfigSignature(normalizedConfig);
    if (!runtimeSideEffectsQueue && signature === lastSuccessfulRuntimeSideEffectsSignature) return;

    pendingRuntimeSideEffects = { config: normalizedConfig, signature };
    if (!runtimeSideEffectsQueue) {
      runtimeSideEffectsQueue = Promise.resolve()
        .then(drainRuntimeSideEffectsQueue)
        .finally(() => {
          runtimeSideEffectsQueue = null;
        });
    }
    await runtimeSideEffectsQueue;
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

  async function getWebRtcPolicyState(): Promise<WebRtcPolicyState> {
    return getWebRTCPolicyState(await getSiteConfig());
  }

  async function buildPayloadForUrl(url: string, configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<EffectiveProfileResult> {
    const hostname = url ? new URL(url).hostname : '';
    const config = configOverride || await getSiteConfig();
    // Stale locations remain the explicit last-known-good input for IP-following
    // injection; freshness and provider errors are surfaced separately in the UI.
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();
    return getEffectiveProfile(config, hostname, lastLocation);
  }

  async function executeTabInjection(request: TabInjectionRequest): Promise<InjectionOutcome> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: request.tabId, allFrames: true },
        files: MAIN_RUNTIME_FILES,
        injectImmediately: true,
        world: 'MAIN'
      });
      await chrome.scripting.executeScript({
        target: { tabId: request.tabId, allFrames: true },
        func: (payload) => {
          window.postMessage({ source: 'vanishgeo-extension', type: 'apply-spoof', payload }, '*');
        },
        args: [request.payload],
        injectImmediately: true,
        world: 'MAIN'
      });
      return 'applied';
    } catch (error) {
      console.warn(`VanishGeo could not inject tab ${request.tabId}:`, formatError(error));
      return 'failed';
    }
  }

  async function runTabInjectionQueue(state: TabInjectionState, firstRequest: TabInjectionRequest): Promise<InjectionOutcome> {
    state.running = true;
    let request: TabInjectionRequest | null = firstRequest;
    let outcome: InjectionOutcome = 'skipped';

    while (request) {
      state.currentKey = request.key;
      state.pending = null;
      outcome = await executeTabInjection(request);
      request = state.pending;
    }

    state.running = false;
    state.currentKey = null;
    return outcome;
  }

  async function queueTabInjection(request: TabInjectionRequest): Promise<InjectionOutcome> {
    let state = tabInjectionStates.get(request.tabId);
    if (!state) {
      state = {
        running: false,
        currentKey: null,
        pending: null,
        promise: Promise.resolve('skipped')
      };
      tabInjectionStates.set(request.tabId, state);
    }

    if (state.running) {
      if (state.currentKey !== request.key && state.pending?.key !== request.key) {
        state.pending = request;
      }
      return state.promise;
    }

    const currentState = state;
    state.promise = runTabInjectionQueue(currentState, request).finally(() => {
      if (!currentState.running && !currentState.pending) {
        tabInjectionStates.delete(request.tabId);
      }
    });
    return state.promise;
  }

  async function prepareTabInjection(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<InjectionOutcome> {
    const config = options?.config || await getSiteConfig();
    if (!isScriptableUrl(url) || !isUrlMatchedByEnabledRule(config, url)) return 'skipped';

    const lastLocation = Object.prototype.hasOwnProperty.call(options || {}, 'lastLocation')
      ? options?.lastLocation || null
      : await getLastLocation();
    const resolved = await buildPayloadForUrl(url, config, lastLocation);
    if (!resolved.matched || !resolved.payload) return 'skipped';

    return queueTabInjection({
      tabId,
      url,
      payload: resolved.payload,
      key: buildTabInjectionKey(url, resolved.payload)
    });
  }

  async function injectScript(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void> {
    await prepareTabInjection(tabId, url, options);
  }

  async function injectTargetsWithLimit(
    targets: ScriptableTabTarget[],
    config: SiteSpoofConfig,
    lastLocation: LastLocation | null
  ): Promise<InjectionOutcome[]> {
    const outcomes: InjectionOutcome[][] = [];
    let nextIndex = 0;
    const workerCount = Math.min(UPDATE_ALL_TABS_CONCURRENCY, targets.length);
    const workers = Array.from({ length: workerCount }, async (_unused, workerIndex) => {
      const workerOutcomes: InjectionOutcome[] = [];
      outcomes[workerIndex] = workerOutcomes;
      while (nextIndex < targets.length) {
        const target = targets[nextIndex];
        nextIndex += 1;
        workerOutcomes.push(await prepareTabInjection(target.id, target.url, { config, lastLocation }));
      }
    });

    await Promise.all(workers);
    return outcomes.flat();
  }

  async function runUpdateAllTabs(request: UpdateAllTabsRequest): Promise<void> {
    const config = request.config ? normalizeConfig(request.config) : await getSiteConfig();
    const lastLocation = request.hasLastLocation ? request.lastLocation : await getLastLocation();
    if (!getContentScriptMatches(config).length) return;

    const tabs = await chrome.tabs.query({});
    const targets = toScriptableTabTargets(tabs, config);
    const signature = buildAllTabsSignature(config, lastLocation, targets);
    if (signature === lastSuccessfulAllTabsSignature) return;

    const outcomes = await injectTargetsWithLimit(targets, config, lastLocation);
    if (!outcomes.includes('failed')) {
      lastSuccessfulAllTabsSignature = signature;
    }
  }

  async function drainUpdateAllTabsQueue(): Promise<void> {
    while (pendingAllTabsUpdate) {
      const request = pendingAllTabsUpdate;
      pendingAllTabsUpdate = null;
      await runUpdateAllTabs(request);
    }
  }

  async function updateAllTabs(configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<void> {
    pendingAllTabsUpdate = {
      config: configOverride,
      hasLastLocation: lastLocationOverride !== undefined,
      lastLocation: lastLocationOverride || null
    };
    if (!updateAllTabsQueue) {
      updateAllTabsQueue = Promise.resolve()
        .then(drainUpdateAllTabsQueue)
        .finally(() => {
          updateAllTabsQueue = null;
        });
    }
    await updateAllTabsQueue;
  }

  function sameInjectedLocation(previous: LastLocation | null, next: LastLocation): boolean {
    return Boolean(
      previous
      && Number(previous.latitude) === Number(next.latitude)
      && Number(previous.longitude) === Number(next.longitude)
      && String(previous.timezone || '') === String(next.timezone || '')
      && String(previous.timezoneOffset ?? '') === String(next.timezoneOffset ?? '')
    );
  }

  function providerBackoffActive(backoff: GeoProviderBackoff, apiUrl: string, now: number): boolean {
    const entry = backoff[apiUrl];
    return Boolean(entry && entry.nextRetryAt > now);
  }

  async function resolveGeoProviderLocation(
    forceUpdate: boolean,
    now: number
  ): Promise<{
    location: Omit<LastLocation, 'updateTime' | 'updatedAt' | 'expiresAt'> | null;
    errors: string[];
    skipped: string[];
  }> {
    const backoff = await getGeoProviderBackoff();
    const errors: string[] = [];
    const skipped: string[] = [];

    for (const apiUrl of GEO_API_URLS) {
      if (!forceUpdate && providerBackoffActive(backoff, apiUrl, now)) {
        skipped.push(`${apiUrl} cooling down until ${formatProviderRetryTime(backoff[apiUrl].nextRetryAt)}`);
        continue;
      }

      try {
        const location = await fetchGeoApiLocation(apiUrl);
        delete backoff[apiUrl];
        await setGeoProviderBackoff(backoff);
        return { location: { ...location, provider: apiUrl }, errors, skipped };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${apiUrl} ${message}`);
        backoff[apiUrl] = nextGeoProviderBackoffEntry(backoff[apiUrl], message, Date.now());
        await setGeoProviderBackoff(backoff);
      }
    }

    return { location: null, errors, skipped };
  }

  async function runGeolocationUpdate(forceUpdate: boolean): Promise<GeolocationUpdateResult> {
    try {
      const config = await getSiteConfig();
      const oldLocation = await getLastLocation();
      const oldFreshness = getLastLocationFreshness(oldLocation);
      if (!config.masterEnabled) {
        await setGeoRefreshState({ status: 'idle', completedAt: Date.now() });
        return { ok: false, disabled: true, location: oldLocation || undefined, stale: oldFreshness === 'stale', error: 'extension disabled' };
      }

      if (!forceUpdate && oldFreshness === 'fresh') {
        await setGeoRefreshState({ status: 'idle', completedAt: Date.now(), provider: oldLocation?.provider });
        return { ok: true, location: oldLocation || undefined, unchanged: true };
      }

      const startedAt = Date.now();
      await setGeoRefreshState({ status: 'refreshing', startedAt });
      const result = await resolveGeoProviderLocation(forceUpdate, startedAt);

      if (!result.location) {
        const details = [...result.errors, ...result.skipped].filter(Boolean).join(' | ');
        const message = details
          ? `IP geolocation APIs returned no valid coordinates: ${details}`
          : 'IP geolocation providers are unavailable';
        await chrome.storage.local.set({
          lastGeoError: message,
          [GEO_REFRESH_STATE_KEY]: {
            status: 'error',
            startedAt,
            completedAt: Date.now(),
            error: message
          } satisfies GeoRefreshState
        });
        return { ok: false, location: oldLocation || undefined, stale: oldFreshness === 'stale', error: message };
      }

      const nextLocation = withFreshLocationMetadata(result.location, {
        provider: result.location.provider,
        ttlMs: LAST_LOCATION_TTL_MS
      });
      const unchanged = sameInjectedLocation(oldLocation, nextLocation);
      await chrome.storage.local.set({
        [LAST_LOCATION_KEY]: nextLocation,
        lastGeoError: '',
        [GEO_REFRESH_STATE_KEY]: {
          status: 'idle',
          startedAt,
          completedAt: Date.now(),
          provider: nextLocation.provider
        } satisfies GeoRefreshState
      });
      if (!unchanged) {
        await updateAllTabs(config, nextLocation);
      }
      return { ok: true, location: nextLocation, unchanged };
    } catch (error) {
      const message = `background geolocation update failed: ${error instanceof Error ? error.message : String(error)}`;
      const oldLocation = await getLastLocation();
      await chrome.storage.local.set({
        lastGeoError: message,
        [GEO_REFRESH_STATE_KEY]: {
          status: 'error',
          completedAt: Date.now(),
          error: message
        } satisfies GeoRefreshState
      });
      return {
        ok: false,
        location: oldLocation || undefined,
        stale: getLastLocationFreshness(oldLocation) === 'stale',
        error: message
      };
    }
  }

  async function updateGeolocation(forceUpdate = false): Promise<GeolocationUpdateResult> {
    if (activeGeolocationUpdate) {
      if (!forceUpdate || activeGeolocationUpdate.forceUpdate) {
        return activeGeolocationUpdate.promise;
      }
      return activeGeolocationUpdate.promise.then(() => updateGeolocation(true));
    }

    const state: { forceUpdate: boolean; promise: Promise<GeolocationUpdateResult> } = {
      forceUpdate,
      promise: Promise.resolve({ ok: false, error: 'geolocation update not started' })
    };
    state.promise = runGeolocationUpdate(forceUpdate).finally(() => {
      if (activeGeolocationUpdate === state) {
        activeGeolocationUpdate = null;
      }
    });
    activeGeolocationUpdate = state;
    return state.promise;
  }

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult> {
    return buildPayloadForUrl(url);
  }

  async function getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { url: string; domain: string; scriptable: boolean; config: SiteSpoofConfig; lastLocation: LastLocation | null; ipLocationStatus: IpLocationStatusSnapshot }> {
    const config = await getSiteConfig();
    const [lastLocation, ipLocationStatus] = await Promise.all([
      getLastLocation(),
      getIpLocationStatus()
    ]);
    const url = tab?.url || '';
    const domain = url ? normalizeDomain(url) : '';
    const scriptable = isScriptableUrl(url);
    const resolved = domain && scriptable
      ? getEffectiveProfile(config, domain, lastLocation)
      : { matched: false, rule: null, payload: null, errors: [] };
    return { url, domain, scriptable, config, lastLocation, ipLocationStatus, ...resolved };
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
    const url = new URL(LEAK_TEST_URL);
    url.searchParams.set('ui', 'zh');
    const config = await getSiteConfig();
    const lastLocation = await getLastLocation();
    const resolved = getEffectiveProfile(config, url.hostname, lastLocation);
    if (resolved.payload) {
      let webRtcPolicyState: WebRtcPolicyState | null = null;
      let webRtcPolicyError: string | null = null;
      try {
        webRtcPolicyState = await getWebRTCPolicyState(config);
      } catch (error) {
        webRtcPolicyError = formatError(error);
      }
      appendExpectedProfileParams(url, resolved.payload, config, webRtcPolicyState, webRtcPolicyError);
    }
    await chrome.tabs.create({ url: url.toString() });
  }

  async function initializeExtension(): Promise<void> {
    const config = normalizeConfig(await getSiteConfig());
    await applyRuntimeSideEffects(config);
    if (config.masterEnabled) {
      await updateGeolocation(false);
    }
  }

  return {
    alarmName: ALARM_NAME,
    webRtcPolicies: WEBRTC_POLICY_VALUES,
    getSiteConfig,
    saveSiteConfig,
    getLastLocation,
    getIpLocationStatus,
    getExtensionState,
    setExtensionEnabled,
    getWebRtcPolicyState,
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
