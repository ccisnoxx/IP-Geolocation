// 后台统一持有配置事务、出口检测、标签页刷新和文档级 runtime 注入边界。
import { updateAcceptLanguageRules } from './dnr';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy, getWebRTCPolicyState } from './webrtc';
import {
  getContentScriptMatches,
  getEffectiveProfile,
  isUrlMatchedByEnabledRule,
  repairInvalidRuleDomains,
  validateConfig
} from '../shared/config-resolver';
import {
  DEFAULT_CONFIG,
  OLD_EXTENSION_ENABLED_KEY,
  OLD_LANGUAGE_KEY,
  OLD_TIMEZONE_KEY,
  OLD_WEBRTC_KEY,
  clone,
  createRule,
  isValidIpAddress,
  normalizeConfig,
  normalizeDomain,
  normalizeString,
  normalizeWebRtc,
  validateTimezone
} from '../shared/config-model';
import { GEO_PROVIDER_TIMEOUT_MS } from '../shared/ip-location';
import { formatLocaleDateTimeForProfile } from '../shared/locale-datetime';
import {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  SITE_CONFIG_KEY,
  getConfig as getStoredConfig
} from '../shared/storage';
import { applyVanishGeoRuntime } from '../injected/runtime';
import type {
  DetectedExitLocation,
  EffectivePayload,
  EffectiveProfileResult,
  ExitLocationDetectionPreview,
  ExitLocationProfile,
  SiteSpoofConfig
} from '../shared/types';
import type { WebRtcPolicyState } from './webrtc';

const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];
const CONTENT_SCRIPT_ID = 'vanishgeo-runtime-init';
const CONTENT_SCRIPT_FILES = ['content/content.js'];
const LEAK_TEST_URL = 'https://leak.962850.xyz/leak-test/leak-test.html';
const TAB_RELOAD_CONCURRENCY = 4;
const PENDING_DETECTION_KEY = 'pendingExitLocationDetection';
const PENDING_DETECTION_TTL_MS = 5 * 60 * 1000;

interface PendingExitLocationDetection {
  detectionId: string;
  targetProfileId: string | null;
  candidate: DetectedExitLocation;
  baseVerifiedAt: number | null;
  expiresAt: number;
}

interface ScriptableTabSnapshot {
  id: number;
  url: string;
}

interface RuntimeSideEffectsRequest {
  config: SiteSpoofConfig;
  signature: string;
}

function isScriptableUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url || ''));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeConfigSignature(config: SiteSpoofConfig): string {
  return JSON.stringify(normalizeConfig(config));
}

function runtimePayloadSignature(config: SiteSpoofConfig, url: string): string | null {
  if (!isScriptableUrl(url)) return null;
  const resolved = getEffectiveProfile(config, new URL(url).hostname);
  const payload = resolved.payload;
  if (!payload) return null;
  return JSON.stringify({
    extensionEnabled: payload.extensionEnabled,
    debugMode: payload.debugMode,
    geolocation: payload.geolocation ? {
      latitude: payload.geolocation.latitude,
      longitude: payload.geolocation.longitude,
      accuracy: payload.geolocation.accuracy,
      randomize: payload.geolocation.randomize,
      randomRadiusMeters: payload.geolocation.randomRadiusMeters,
      spoofPermission: payload.geolocation.spoofPermission
    } : null,
    timezone: payload.timezone,
    languageConfig: payload.languageConfig,
    canvasConfig: payload.canvasConfig.enabled && payload.canvasConfig.spoofFonts
      ? {
          enabled: true,
          spoofFonts: true,
          targetFonts: payload.canvasConfig.targetFonts
        }
      : null
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
    if (offset !== null) params.set('expectedTimezoneOffset', String(offset));
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
    if (webRtcPolicyState.actualPolicy) params.set('actualWebRtcPolicy', webRtcPolicyState.actualPolicy);
    if (webRtcPolicyState.levelOfControl) params.set('actualWebRtcPolicyLevelOfControl', webRtcPolicyState.levelOfControl);
    params.set('actualWebRtcPolicyControlledByThisExtension', String(webRtcPolicyState.controlledByThisExtension));
    params.set('actualWebRtcLeakProtectionActive', String(webRtcPolicyState.leakProtectionActive));
  }
  if (webRtcPolicyError) params.set('actualWebRtcPolicyError', webRtcPolicyError);

  if (payload.languageConfig && payload.timezone) {
    params.set('expectedLocaleStringTimestamp', String(localeStringDate.getTime()));
    params.set('expectedLocaleString', formatLocaleDateTimeForProfile(
      localeStringDate,
      payload.languageConfig.language,
      payload.timezone
    ));
  }
}

function normalizeDetectedLocation(value: unknown): DetectedExitLocation | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<DetectedExitLocation>;
  const publicIp = normalizeString(input.publicIp);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const country = normalizeString(input.country);
  const timezone = normalizeString(input.timezone);
  const provider = normalizeString(input.provider);
  const detectedAt = Number(input.detectedAt);
  if (
    !isValidIpAddress(publicIp)
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || !country
    || !validateTimezone(timezone)
    || !provider
    || !Number.isFinite(detectedAt)
    || detectedAt <= 0
  ) {
    return null;
  }
  return { publicIp, latitude, longitude, country, timezone, provider, detectedAt };
}

export function parseGeoApiResponse(data: unknown, provider = 'unknown', detectedAt = Date.now()): DetectedExitLocation | null {
  if (!data || typeof data !== 'object') return null;
  const input = data as Record<string, any>;

  if (input.success !== false && input.latitude !== undefined && input.longitude !== undefined) {
    return normalizeDetectedLocation({
      publicIp: input.ip,
      latitude: input.latitude,
      longitude: input.longitude,
      country: input.country || input.country_name || input.country_code,
      timezone: input.timezone?.id || input.timezone,
      provider,
      detectedAt
    });
  }

  if (typeof input.loc === 'string' && input.loc.includes(',')) {
    const [latitude, longitude] = input.loc.split(',').map(Number);
    return normalizeDetectedLocation({
      publicIp: input.ip,
      latitude,
      longitude,
      country: input.country || input.region || input.city,
      timezone: input.timezone,
      provider,
      detectedAt
    });
  }

  return null;
}

export async function fetchGeoApiLocation(
  apiUrl: string,
  timeoutMs = GEO_PROVIDER_TIMEOUT_MS
): Promise<DetectedExitLocation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseGeoApiResponse(await response.json(), apiUrl);
    if (!parsed) throw new Error('响应缺少同一次检测所需的完整出口位置字段');
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求在 ${timeoutMs}ms 后超时`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface BackgroundServices {
  webRtcPolicies: typeof WEBRTC_POLICY_VALUES;
  getSiteConfig(): Promise<SiteSpoofConfig>;
  saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig>;
  resetSiteConfig(): Promise<SiteSpoofConfig>;
  importSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig>;
  getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }>;
  setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig>;
  getWebRtcPolicyState(): Promise<WebRtcPolicyState>;
  setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  initializeRuntimeForSender(sender: chrome.runtime.MessageSender): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { url: string; domain: string; scriptable: boolean; config: SiteSpoofConfig }>;
  detectExitLocation(targetProfileId?: string | null): Promise<ExitLocationDetectionPreview>;
  confirmExitLocationDetection(detectionId: string, name: string): Promise<SiteSpoofConfig>;
  cancelExitLocationDetection(detectionId: string): Promise<void>;
  renameExitLocationProfile(profileId: string, name: string): Promise<SiteSpoofConfig>;
  deleteExitLocationProfile(profileId: string): Promise<SiteSpoofConfig>;
  addDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig>;
  deleteDomainRule(domain: string): Promise<SiteSpoofConfig>;
  openDiagnosticPage(): Promise<void>;
  initializeExtension(): Promise<void>;
}

export function createBackgroundServices(): BackgroundServices {
  let contentScriptRegistrationQueue: Promise<void> = Promise.resolve();
  let pendingRuntimeSideEffects: RuntimeSideEffectsRequest | null = null;
  let runtimeSideEffectsQueue: Promise<void> | null = null;
  let lastSuccessfulRuntimeSideEffectsSignature = '';
  let configMutationQueue: Promise<void> = Promise.resolve();

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const stored = await getStoredConfig();
    const { config, repaired } = repairInvalidRuleDomains(stored);
    if (repaired) await chrome.storage.local.set({ siteSpoofConfig: config });
    return config;
  }

  async function unregisterSpoofContentScript(): Promise<void> {
    if (!chrome.scripting?.unregisterContentScripts) return;
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch (error) {
      if (!/non[- ]?existent|not found|does not exist/i.test(formatError(error))) throw error;
    }
  }

  async function replaceSpoofContentScript(config: SiteSpoofConfig): Promise<void> {
    const matches = getContentScriptMatches(config);
    await unregisterSpoofContentScript();
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches,
      js: CONTENT_SCRIPT_FILES,
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'ISOLATED',
      persistAcrossSessions: true
    }]);
  }

  async function registerSpoofContentScript(config: SiteSpoofConfig): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;
    const next = contentScriptRegistrationQueue.then(
      () => replaceSpoofContentScript(config),
      () => replaceSpoofContentScript(config)
    );
    contentScriptRegistrationQueue = next.catch(() => undefined);
    return next;
  }

  async function runRuntimeSideEffect(label: string, task: () => Promise<unknown>): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      console.warn(`VanishGeo ${label}失败：`, formatError(error));
      return false;
    }
  }

  async function runRuntimeSideEffects(config: SiteSpoofConfig): Promise<boolean> {
    const results = await Promise.all([
      runRuntimeSideEffect('content script 注册', () => registerSpoofContentScript(config)),
      runRuntimeSideEffect('Accept-Language 规则更新', () => updateAcceptLanguageRules(config)),
      runRuntimeSideEffect('WebRTC 策略更新', () => applyWebRTCPolicy(config))
    ]);
    return results.every(Boolean);
  }

  async function drainRuntimeSideEffectsQueue(): Promise<void> {
    while (pendingRuntimeSideEffects) {
      const request = pendingRuntimeSideEffects;
      pendingRuntimeSideEffects = null;
      if (request.signature === lastSuccessfulRuntimeSideEffectsSignature) continue;
      if (await runRuntimeSideEffects(request.config)) {
        lastSuccessfulRuntimeSideEffectsSignature = request.signature;
      }
    }
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    const normalized = normalizeConfig(config);
    const signature = runtimeConfigSignature(normalized);
    if (!runtimeSideEffectsQueue && signature === lastSuccessfulRuntimeSideEffectsSignature) return;
    pendingRuntimeSideEffects = { config: normalized, signature };
    if (!runtimeSideEffectsQueue) {
      runtimeSideEffectsQueue = Promise.resolve()
        .then(drainRuntimeSideEffectsQueue)
        .finally(() => {
          runtimeSideEffectsQueue = null;
        });
    }
    await runtimeSideEffectsQueue;
  }

  async function queryScriptableTabs(): Promise<ScriptableTabSnapshot[]> {
    try {
      return (await chrome.tabs.query({})).flatMap((tab) => (
        typeof tab.id === 'number' && tab.url && isScriptableUrl(tab.url)
          ? [{ id: tab.id, url: tab.url }]
          : []
      ));
    } catch (error) {
      console.warn('VanishGeo 读取待刷新标签页失败：', formatError(error));
      return [];
    }
  }

  async function reloadChangedTabs(
    tabs: ScriptableTabSnapshot[],
    previous: SiteSpoofConfig,
    next: SiteSpoofConfig
  ): Promise<void> {
    const changed = tabs.filter((tab) => runtimePayloadSignature(previous, tab.url) !== runtimePayloadSignature(next, tab.url));
    for (let index = 0; index < changed.length; index += TAB_RELOAD_CONCURRENCY) {
      await Promise.all(changed.slice(index, index + TAB_RELOAD_CONCURRENCY).map(async (snapshot) => {
        try {
          const current = await chrome.tabs.get(snapshot.id);
          if (current.url !== snapshot.url) return;
          if (runtimePayloadSignature(previous, current.url) === runtimePayloadSignature(next, current.url)) return;
          await chrome.tabs.reload(snapshot.id);
        } catch (error) {
          console.warn(`VanishGeo 刷新标签页 ${snapshot.id} 失败：`, formatError(error));
        }
      }));
    }
  }

  async function persistConfig(previous: SiteSpoofConfig, candidate: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    const result = validateConfig(candidate);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const tabs = await queryScriptableTabs();
    await chrome.storage.local.set({ siteSpoofConfig: result.config });
    await applyRuntimeSideEffects(result.config);
    await reloadChangedTabs(tabs, previous, result.config);
    return result.config;
  }

  function mutateConfig(mutator: (current: SiteSpoofConfig) => Partial<SiteSpoofConfig> | Promise<Partial<SiteSpoofConfig>>): Promise<SiteSpoofConfig> {
    const mutation = configMutationQueue.then(async () => {
      const current = await getSiteConfig();
      return persistConfig(current, await mutator(normalizeConfig(current)));
    });
    configMutationQueue = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  async function saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    return mutateConfig((current) => ({
      ...normalizeConfig(config),
      exitLocationProfiles: current.exitLocationProfiles
    }));
  }

  async function resetSiteConfig(): Promise<SiteSpoofConfig> {
    return mutateConfig(() => clone(DEFAULT_CONFIG));
  }

  async function importSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    return mutateConfig(() => {
      const imported = normalizeConfig(config);
      return {
        ...imported,
        exitLocationProfiles: imported.exitLocationProfiles.map((profile) => ({
          ...profile,
          verification: 'unverified' as const,
          publicIp: null,
          provider: null,
          verifiedAt: null
        })),
        rules: imported.rules.map((rule) => ({ ...rule, exitLocationProfileId: null }))
      };
    });
  }

  async function getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }> {
    const config = await getSiteConfig();
    return { enabled: config.masterEnabled, config };
  }

  async function setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => ({ ...config, masterEnabled: Boolean(enabled) }));
  }

  async function setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => ({ ...config, webRtc: normalizeWebRtc({ globalMode: mode as any }) }));
  }

  async function getWebRtcPolicyState(): Promise<WebRtcPolicyState> {
    return getWebRTCPolicyState(await getSiteConfig());
  }

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult> {
    if (!isScriptableUrl(url)) return { matched: false, rule: null, payload: null, errors: [] };
    return getEffectiveProfile(await getSiteConfig(), new URL(url).hostname);
  }

  async function initializeRuntimeForSender(sender: chrome.runtime.MessageSender): Promise<EffectiveProfileResult> {
    if (sender.id !== chrome.runtime.id) throw new Error('拒绝非本扩展的初始化请求');
    if (typeof sender.tab?.id !== 'number' || !sender.documentId) throw new Error('初始化请求缺少目标文档');
    const url = [sender.url, sender.origin, sender.tab.url].find(isScriptableUrl) || '';
    const resolved = await getPayloadForUrl(url);
    if (!resolved.payload) return resolved;
    await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      func: applyVanishGeoRuntime,
      args: [resolved.payload, sender.documentId],
      injectImmediately: true,
      world: 'MAIN'
    });
    return resolved;
  }

  async function getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & {
    url: string;
    domain: string;
    scriptable: boolean;
    config: SiteSpoofConfig;
  }> {
    const config = await getSiteConfig();
    const url = tab?.url || '';
    const domain = isScriptableUrl(url) ? new URL(url).hostname : '';
    const scriptable = Boolean(domain);
    const resolved = scriptable
      ? getEffectiveProfile(config, domain)
      : { matched: false, rule: null, payload: null, errors: [] };
    return { url, domain, scriptable, config, ...resolved };
  }

  async function detectExitLocation(targetProfileId?: string | null): Promise<ExitLocationDetectionPreview> {
    const config = await getSiteConfig();
    const previous = targetProfileId
      ? config.exitLocationProfiles.find((profile) => profile.id === targetProfileId) || null
      : null;
    if (targetProfileId && !previous) throw new Error('要重新检测的出口位置档案不存在');

    const errors: string[] = [];
    let candidate: DetectedExitLocation | null = null;
    for (const apiUrl of GEO_API_URLS) {
      try {
        candidate = await fetchGeoApiLocation(apiUrl);
        break;
      } catch (error) {
        errors.push(`${apiUrl} ${formatError(error)}`);
      }
    }
    if (!candidate) throw new Error(`所有 IP 定位服务均检测失败：${errors.join(' | ')}`);

    const pending: PendingExitLocationDetection = {
      detectionId: crypto.randomUUID(),
      targetProfileId: targetProfileId || null,
      candidate,
      baseVerifiedAt: previous?.verifiedAt || null,
      expiresAt: Date.now() + PENDING_DETECTION_TTL_MS
    };
    await chrome.storage.session.set({ [PENDING_DETECTION_KEY]: pending });
    return { ...pending, previous };
  }

  async function getPendingDetection(detectionId: string): Promise<PendingExitLocationDetection> {
    const data = await chrome.storage.session.get(PENDING_DETECTION_KEY);
    const pending = data[PENDING_DETECTION_KEY] as PendingExitLocationDetection | undefined;
    if (!pending || pending.detectionId !== detectionId) throw new Error('检测结果已失效，请重新检测');
    if (pending.expiresAt <= Date.now()) {
      await chrome.storage.session.remove(PENDING_DETECTION_KEY);
      throw new Error('检测结果已过期，请重新检测');
    }
    const candidate = normalizeDetectedLocation(pending.candidate);
    if (!candidate) throw new Error('检测结果不完整，请重新检测');
    return { ...pending, candidate };
  }

  async function confirmExitLocationDetection(detectionId: string, name: string): Promise<SiteSpoofConfig> {
    const profileName = normalizeString(name);
    if (!profileName) throw new Error('出口位置档案名称不能为空');
    const pending = await getPendingDetection(detectionId);
    const saved = await mutateConfig((config) => {
      const profiles = config.exitLocationProfiles.slice();
      const targetIndex = pending.targetProfileId
        ? profiles.findIndex((profile) => profile.id === pending.targetProfileId)
        : -1;
      if (pending.targetProfileId && targetIndex < 0) throw new Error('出口位置档案已被删除，请重新检测');
      if (targetIndex >= 0 && profiles[targetIndex].verifiedAt !== pending.baseVerifiedAt) {
        throw new Error('出口位置档案已发生变化，请重新检测');
      }

      const profile: ExitLocationProfile = {
        id: targetIndex >= 0 ? profiles[targetIndex].id : `exit-${crypto.randomUUID()}`,
        name: profileName,
        verification: 'verified',
        publicIp: pending.candidate.publicIp,
        latitude: pending.candidate.latitude,
        longitude: pending.candidate.longitude,
        country: pending.candidate.country,
        timezone: pending.candidate.timezone,
        provider: pending.candidate.provider,
        verifiedAt: pending.candidate.detectedAt
      };
      if (targetIndex >= 0) profiles[targetIndex] = profile;
      else profiles.push(profile);
      return { ...config, exitLocationProfiles: profiles };
    });
    await chrome.storage.session.remove(PENDING_DETECTION_KEY);
    return saved;
  }

  async function cancelExitLocationDetection(detectionId: string): Promise<void> {
    const data = await chrome.storage.session.get(PENDING_DETECTION_KEY);
    if ((data[PENDING_DETECTION_KEY] as PendingExitLocationDetection | undefined)?.detectionId === detectionId) {
      await chrome.storage.session.remove(PENDING_DETECTION_KEY);
    }
  }

  async function renameExitLocationProfile(profileId: string, name: string): Promise<SiteSpoofConfig> {
    const profileName = normalizeString(name);
    if (!profileName) throw new Error('出口位置档案名称不能为空');
    return mutateConfig((config) => {
      const index = config.exitLocationProfiles.findIndex((profile) => profile.id === profileId);
      if (index < 0) throw new Error('出口位置档案不存在');
      const profiles = config.exitLocationProfiles.slice();
      profiles[index] = { ...profiles[index], name: profileName };
      return { ...config, exitLocationProfiles: profiles };
    });
  }

  async function deleteExitLocationProfile(profileId: string): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => {
      if (!config.exitLocationProfiles.some((profile) => profile.id === profileId)) throw new Error('出口位置档案不存在');
      const domains = config.rules.filter((rule) => rule.exitLocationProfileId === profileId).map((rule) => rule.domain);
      if (domains.length) throw new Error(`出口位置档案仍被以下域名引用：${domains.join('、')}`);
      return {
        ...config,
        exitLocationProfiles: config.exitLocationProfiles.filter((profile) => profile.id !== profileId)
      };
    });
  }

  async function addDomainRule(domain: string): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => {
      const normalizedDomain = normalizeDomain(domain);
      const existing = config.rules.find((rule) => rule.domain === normalizedDomain);
      if (existing) existing.enabled = true;
      else config.rules.push(createRule(normalizedDomain));
      return config;
    });
  }

  async function setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => {
      const rule = config.rules.find((item) => item.domain === normalizeDomain(domain));
      if (!rule) throw new Error('站点规则不存在');
      rule.enabled = Boolean(enabled);
      return config;
    });
  }

  async function deleteDomainRule(domain: string): Promise<SiteSpoofConfig> {
    return mutateConfig((config) => ({
      ...config,
      rules: config.rules.filter((rule) => rule.domain !== normalizeDomain(domain))
    }));
  }

  async function openDiagnosticPage(): Promise<void> {
    const url = new URL(LEAK_TEST_URL);
    url.searchParams.set('ui', 'zh');
    const config = await getSiteConfig();
    const resolved = getEffectiveProfile(config, url.hostname);
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

  async function reloadLegacyMatchedTabs(config: SiteSpoofConfig): Promise<void> {
    const tabs = (await queryScriptableTabs()).filter((tab) => isUrlMatchedByEnabledRule(config, tab.url));
    for (let index = 0; index < tabs.length; index += TAB_RELOAD_CONCURRENCY) {
      await Promise.all(tabs.slice(index, index + TAB_RELOAD_CONCURRENCY).map(async (tab) => {
        try {
          await chrome.tabs.reload(tab.id);
        } catch (error) {
          console.warn(`VanishGeo 清理旧页面环境时刷新标签页 ${tab.id} 失败：`, formatError(error));
        }
      }));
    }
  }

  async function initializeExtension(): Promise<void> {
    const before = await chrome.storage.local.get(null);
    const storedConfig = before[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
    const hadLegacyConfig = Boolean(storedConfig && storedConfig.schemaVersion !== 2)
      || Boolean(before[LEGACY_VANISHME_CONFIG_KEY])
      || Boolean(before[LAST_LOCATION_KEY])
      || [OLD_EXTENSION_ENABLED_KEY, OLD_LANGUAGE_KEY, OLD_TIMEZONE_KEY, OLD_WEBRTC_KEY]
        .some((key) => Object.prototype.hasOwnProperty.call(before, key));
    const config = await getSiteConfig();
    await applyRuntimeSideEffects(config);
    if (hadLegacyConfig) await reloadLegacyMatchedTabs(config);
  }

  return {
    webRtcPolicies: WEBRTC_POLICY_VALUES,
    getSiteConfig,
    saveSiteConfig,
    resetSiteConfig,
    importSiteConfig,
    getExtensionState,
    setExtensionEnabled,
    getWebRtcPolicyState,
    setWebRtcGlobalMode,
    getPayloadForUrl,
    initializeRuntimeForSender,
    getCurrentTabState,
    detectExitLocation,
    confirmExitLocationDetection,
    cancelExitLocationDetection,
    renameExitLocationProfile,
    deleteExitLocationProfile,
    addDomainRule,
    setDomainRuleEnabled,
    deleteDomainRule,
    openDiagnosticPage,
    initializeExtension
  };
}
