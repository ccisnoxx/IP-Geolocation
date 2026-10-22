// 后台统一持有配置事务、出口检测及新文档语言/时区注册；既有文档保持快照。
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy, getWebRTCPolicyState } from './webrtc';
import {
  getLanguageTimezonePayload,
  getPageRuntimeProfile,
  isUrlMatchedByEnabledRule,
  repairInvalidRuleDomains,
  validateConfig
} from '../shared/config-resolver';
import {
  OLD_EXTENSION_ENABLED_KEY,
  OLD_LANGUAGE_KEY,
  OLD_TIMEZONE_KEY,
  OLD_WEBRTC_KEY,
  createInitialConfig,
  createRule,
  isValidIpAddress,
  normalizeConfig,
  normalizeCountryCode,
  normalizeDomain,
  normalizeRule,
  normalizeString,
  normalizeWebRtc,
  validateTimezone
} from '../shared/config-model';
import { GEO_PROVIDER_TIMEOUT_MS } from '../shared/ip-location';
import {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  SITE_CONFIG_KEY,
  getRuntimeSyncMetadata,
  setRuntimeSyncMetadata,
  getConfig as getStoredConfig
} from '../shared/storage';
import type {
  DetectedExitLocation,
  EffectiveProfileResult,
  ExitLocationDetectionPreview,
  ExitLocationProfile,
  ExitRecommendationSelection,
  SiteSpoofConfig,
  ConfigSaveResult,
  RuntimeSyncComponent,
  RuntimeSyncComponentReport,
  RuntimeSyncMetadata,
  RuntimeSyncReport,
  WebRtcMode
} from '../shared/types';
import { RUNTIME_SYNC_COMPONENT_LABELS, RuntimeSyncOperationError, syncError, syncSignature } from '../shared/runtime-sync';
import type { WebRtcPolicyState } from './webrtc';
import { rulesFromText } from '../shared/rule-list';
import { recommendExitEnvironment } from '../shared/exit-recommendation';
import { reconcilePageScripts, reconcileGeolocationScripts, hasGeolocationScriptsChanged } from './page-scripts';
import { hasFontScriptScopeChanged, reconcileFontScripts, syncFontScriptRegistration } from './font-scripts';
import { createDiagnosticRuns } from './diagnostic-runs';
import type { DiagnosticOwner } from './diagnostic-runs';
import type { DiagnosticEvidence, DiagnosticRunInfo, InjectionTimingEvidence } from '../shared/diagnostic-report';

const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];
const CONTENT_SCRIPT_ID = 'vanishgeo-runtime-init';
const LEAK_TEST_URL = 'https://leak.962850.xyz/leak-test/leak-test.html';
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

function isScriptableUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url || ''));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeConfigSignature(config: SiteSpoofConfig): Promise<string> {
  return syncSignature(JSON.stringify(normalizeConfig(config)));
}

function pendingSyncReport(configSignature: string): RuntimeSyncReport {
  const pending = (): RuntimeSyncComponentReport => ({ status: 'partial', errors: [{ code: 'pending', message: '等待同步确认。' }] });
  return { configSignature, status: 'partial', components: {
    contentScripts: pending(), webrtc: pending(), tabReload: pending()
  }, metadataError: null };
}

function summarizeSyncReport(report: RuntimeSyncReport): RuntimeSyncReport {
  const states = Object.values(report.components).map((component) => component.status);
  return { ...report, status: report.metadataError || report.warnings?.length ? 'partial'
    : states.every((status) => status === 'ok') ? 'ok'
    : states.every((status) => status === 'failed') ? 'failed' : 'partial' };
}

function pendingForSignature(metadata: RuntimeSyncMetadata | null, signature: string): RuntimeSyncMetadata['pendingReloads'] {
  if (metadata?.version !== 1) return [];
  if (metadata.report.configSignature === signature) return structuredClone(metadata.pendingReloads);
  if (metadata.previous?.configSignature === signature) return structuredClone(metadata.previous.pendingReloads);
  return [];
}

function pendingFontWindow(metadata: RuntimeSyncMetadata | null, signature: string): boolean {
  if (metadata?.report.configSignature === signature) return metadata.pendingFontScopeChange === true;
  return metadata?.previous?.configSignature === signature && metadata.previous.pendingFontScopeChange === true;
}

function pendingGeolocationWindow(metadata: RuntimeSyncMetadata | null, signature: string): boolean {
  if (metadata?.report.configSignature === signature) return metadata.pendingGeolocationScopeChange === true;
  return metadata?.previous?.configSignature === signature && metadata.previous.pendingGeolocationScopeChange === true;
}

function addReloadDebt(pending: RuntimeSyncMetadata['pendingReloads'], item: { tabId: number; urlSignature: string }, surfaces: Array<'page' | 'font' | 'geolocation'>): void {
  const existing = pending.find(entry => entry.tabId === item.tabId && entry.urlSignature === item.urlSignature);
  if (existing) existing.surfaces = [...new Set([...(existing.surfaces || ['page' as const]), ...surfaces])];
  else pending.push({ ...item, surfaces });
}

function pagePayloadChanged(previous: SiteSpoofConfig, next: SiteSpoofConfig, url: string): boolean {
  const hostname = new URL(url).hostname;
  return JSON.stringify(getLanguageTimezonePayload(previous, hostname)) !== JSON.stringify(getLanguageTimezonePayload(next, hostname));
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
  return { publicIp, latitude, longitude, country, countryCode: normalizeCountryCode(input.countryCode), timezone, provider, detectedAt };
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
      // ipwho/ipapi 的明确代码字段；ipapi 也正式支持 country 代码字段。
      countryCode: input.country_code ?? ((provider === 'ipapi' || provider === 'https://ipapi.co/json/') ? input.country : null),
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
      // ipinfo 的 loc 响应中 country 是 alpha-2，region/city 不能充当代码。
      countryCode: (provider === 'ipinfo' || provider === 'https://ipinfo.io/json') ? input.country : null,
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
  getConfigState(): Promise<ConfigSaveResult>;
  reconcileRuntime(): Promise<ConfigSaveResult>;
  saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<ConfigSaveResult>;
  resetSiteConfig(): Promise<ConfigSaveResult>;
  completeOnboarding(domains: string, profileId: string, webRtcMode: string, recommendation?: ExitRecommendationSelection): Promise<ConfigSaveResult>;
  skipOnboarding(): Promise<ConfigSaveResult>;
  handleInstalled(reason: string): Promise<void>;
  importSiteConfig(config: Partial<SiteSpoofConfig>): Promise<ConfigSaveResult>;
  getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>;
  setExtensionEnabled(enabled: boolean): Promise<ConfigSaveResult>;
  getWebRtcPolicyState(): Promise<WebRtcPolicyState>;
  setWebRtcGlobalMode(mode: string): Promise<ConfigSaveResult>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { url: string; domain: string; scriptable: boolean; config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>;
  detectExitLocation(targetProfileId?: string | null): Promise<ExitLocationDetectionPreview>;
  confirmExitLocationDetection(detectionId: string, name: string): Promise<ConfigSaveResult>;
  cancelExitLocationDetection(detectionId: string): Promise<void>;
  renameExitLocationProfile(profileId: string, name: string): Promise<ConfigSaveResult>;
  deleteExitLocationProfile(profileId: string): Promise<ConfigSaveResult>;
  addDomainRule(domain: string): Promise<ConfigSaveResult>;
  setDomainRuleEnabled(domain: string, enabled: boolean): Promise<ConfigSaveResult>;
  deleteDomainRule(domain: string): Promise<ConfigSaveResult>;
  openDiagnosticPage(): Promise<void>;
  openDiagnosticTarget(target: 'hosted' | 'localhost', port?: number): Promise<number>;
  getDiagnosticTargets(): Promise<Array<{ tabId: number; origin: string }>>;
  prepareDiagnosticRun(tabId: number, owner: DiagnosticOwner): Promise<DiagnosticRunInfo>;
  executeDiagnosticRun(runId: string, owner: DiagnosticOwner): Promise<DiagnosticEvidence>;
  executeInjectionTimingRun(runId: string, owner: DiagnosticOwner): Promise<InjectionTimingEvidence>;
  cancelDiagnosticRun(runId: string, owner: DiagnosticOwner): void;
  invalidateDiagnosticTab(tabId: number, closed?: boolean): void;
  initializeExtension(): Promise<RuntimeSyncReport>;
}

export function createBackgroundServices(pageRuntimeSource: string, geolocationRuntimeSource: string): BackgroundServices {
  const diagnosticRuns = createDiagnosticRuns(getSiteConfig);
  let configMutationQueue: Promise<void> = Promise.resolve();
  let detectionGeneration = 0;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = configMutationQueue.then(work);
    configMutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const stored = await getStoredConfig();
    const { config, repaired } = repairInvalidRuleDomains(stored);
    if (repaired) await chrome.storage.local.set({ siteSpoofConfig: config });
    return config;
  }

  async function unregisterSpoofContentScript(): Promise<void> {
    const api = chrome.scripting;
    if (!api?.getRegisteredContentScripts) throw new RuntimeSyncOperationError('unsupported', '浏览器不支持读取动态页面脚本。');
    const read = () => api.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if ((await read()).length) await api.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if ((await read()).length) {
      throw new RuntimeSyncOperationError('verification-failed', '页面初始化脚本仍未撤销；后台继续拒绝页面伪装派发。');
    }
  }

  async function runRuntimeSideEffect(component: RuntimeSyncComponent, task: () => Promise<unknown>): Promise<RuntimeSyncComponentReport> {
    try {
      await task();
      return { status: 'ok', errors: [] };
    } catch (error) {
      return { status: 'failed', errors: [syncError(error, `${RUNTIME_SYNC_COMPONENT_LABELS[component]}浏览器操作失败，请检查扩展权限后重试。`)] };
    }
  }

  async function queryScriptableTabs(): Promise<ScriptableTabSnapshot[]> {
    return (await chrome.tabs.query({})).flatMap((tab) => (
      typeof tab.id === 'number' && tab.url && isScriptableUrl(tab.url)
        ? [{ id: tab.id, url: tab.url }] : []
    ));
  }

  async function checkpoint(metadata: RuntimeSyncMetadata, previous?: RuntimeSyncMetadata | null): Promise<void> {
    metadata.report = summarizeSyncReport({ ...metadata.report, metadataError: null });
    if (previous && JSON.stringify(previous) === JSON.stringify(metadata)) return;
    try {
      await setRuntimeSyncMetadata(metadata);
    } catch {
      metadata.report = summarizeSyncReport({ ...metadata.report,
        metadataError: { code: 'metadata-write-failed', message: '同步恢复记录未能保存，请重试同步。' }
      });
    }
  }

  async function reconcile(config: SiteSpoofConfig, metadata?: RuntimeSyncMetadata): Promise<RuntimeSyncReport> {
    const signature = await runtimeConfigSignature(config);
    const stored = metadata || await getRuntimeSyncMetadata();
    const state: RuntimeSyncMetadata = {
      version: 1, report: pendingSyncReport(signature),
      pendingReloads: pendingForSignature(stored, signature),
      ...(pendingFontWindow(stored, signature) ? { pendingFontScopeChange: true } : {}),
      ...(pendingGeolocationWindow(stored, signature) ? { pendingGeolocationScopeChange: true } : {}),
      ...(stored?.pendingDetectionCleanup ? { pendingDetectionCleanup: stored.pendingDetectionCleanup } : {})
    };
    const beforeFontChange = async () => {
      state.pendingFontScopeChange = true;
      await setRuntimeSyncMetadata(state);
    };
    const [pageSync, webrtc] = await Promise.all([
      (async () => {
        const legacy = await runRuntimeSideEffect('contentScripts', unregisterSpoofContentScript);
        if (legacy.status !== 'ok') {
          // 旧路径撤销未确认时不新增字体注册，仍尝试清理字体命名空间。
          const font = await reconcileFontScripts({ ...config, masterEnabled: false }, beforeFontChange);
          const geo = await reconcileGeolocationScripts({ ...config, masterEnabled: false }, geolocationRuntimeSource);
          return { component: { status: legacy.status, errors: [...legacy.errors, ...font.errors, ...geo.component.errors] },
            geolocationRuntime: { state: 'sync-failed' as const, registeredRuleCount: geo.geolocationRuntime.registeredRuleCount, reloadRequired: false },
            pageRuntime: { state: 'sync-failed' as const, registeredRuleCount: null, reloadRequired: false },
            fontRuntime: { state: 'sync-failed' as const, registeredRuleCount: font.fontRuntime.registeredRuleCount, reloadRequired: false } };
        }
        const page = await reconcilePageScripts(config, pageRuntimeSource);
        const geo = await reconcileGeolocationScripts(config, geolocationRuntimeSource, async () => {
          // 注册漂移/升级恢复也有旧文档窗口；必须先持久化再改变实际注册。
          state.pendingGeolocationScopeChange = true;
          await setRuntimeSyncMetadata(state);
        });
        const font = await reconcileFontScripts(config, beforeFontChange);
        return { ...page, geolocationRuntime: geo.geolocationRuntime, fontRuntime: font.fontRuntime, component: {
          status: page.component.status !== 'ok' ? page.component.status : geo.component.status !== 'ok' ? geo.component.status : font.status,
          errors: [...page.component.errors, ...geo.component.errors, ...font.errors]
        } };
      })(),
      runRuntimeSideEffect('webrtc', () => applyWebRTCPolicy(config,
        stored?.report.configSignature === signature && stored.report.components.webrtc.status === 'ok'))
    ]);
    state.report.components = { ...state.report.components, contentScripts: pageSync.component, webrtc };
    state.report.pageRuntime = pageSync.pageRuntime;
    state.report.fontRuntime = pageSync.fontRuntime;
    state.report.geolocationRuntime = pageSync.geolocationRuntime;
    if (state.pendingDetectionCleanup) {
      try {
        await removeConfirmedDetection(state.pendingDetectionCleanup);
        delete state.pendingDetectionCleanup;
      } catch {
        state.report.warnings = [{ code: 'candidate-cleanup-failed', message: '出口档案已保存，检测候选清理失败，请重试同步。' }];
      }
    }
    // 不刷新或修改已加载/BFCache文档。只有注册完成后才向管理页提示完整reload。
    state.report.components.tabReload = { status: 'ok', errors: [] };
    if (state.pendingReloads.length || state.pendingFontScopeChange || state.pendingGeolocationScopeChange) {
      try {
        const tabs = await queryScriptableTabs();
        const urls = new Map(await Promise.all(tabs.map(async tab => [tab.id, await syncSignature(tab.url)] as const)));
        state.pendingReloads = state.pendingReloads.filter(item => urls.get(item.tabId) === item.urlSignature);
        if (state.pendingFontScopeChange) {
          // allFrames 注册不能从顶层 URL 排除受影响 iframe；保守记录所有普通 HTTP(S) 标签页。
          for (const [tabId, urlSignature] of urls) addReloadDebt(state.pendingReloads, { tabId, urlSignature }, ['font']);
          if (state.report.fontRuntime.state !== 'sync-failed') delete state.pendingFontScopeChange;
        }
        if (state.pendingGeolocationScopeChange) {
          for (const [tabId, urlSignature] of urls) addReloadDebt(state.pendingReloads, { tabId, urlSignature }, ['geolocation']);
          if (['ready', 'disabled'].includes(state.report.geolocationRuntime.state)) delete state.pendingGeolocationScopeChange;
        }
      } catch {
        state.report.components.tabReload = { status: 'failed', errors: [{ code: 'tab-query-failed', message: '无法确认已有页面状态，请重试同步。' }] };
      }
    }
    const reloadKnown = state.report.components.tabReload.status === 'ok';
    state.report.pageRuntime.reloadRequired = ['ready', 'disabled'].includes(state.report.pageRuntime.state) && reloadKnown
      && state.pendingReloads.some(item => !item.surfaces || item.surfaces.includes('page'));
    state.report.fontRuntime.reloadRequired = state.report.fontRuntime.state !== 'sync-failed' && reloadKnown
      && state.pendingReloads.some(item => item.surfaces?.includes('font'));
    state.report.geolocationRuntime.reloadRequired = ['ready', 'disabled'].includes(state.report.geolocationRuntime.state) && reloadKnown
      && state.pendingReloads.some(item => item.surfaces?.includes('geolocation'));
    await checkpoint(state, stored);
    return state.report;
  }

  async function persistConfig(previous: SiteSpoofConfig, candidate: Partial<SiteSpoofConfig>): Promise<ConfigSaveResult> {
    const result = validateConfig(candidate);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const tabs = await queryScriptableTabs();
    const oldMetadata = await getRuntimeSyncMetadata();
    const previousSignature = await runtimeConfigSignature(previous);
    const nextSignature = await runtimeConfigSignature(result.config);
    if (nextSignature === previousSignature) return { config: result.config, syncReport: await reconcile(result.config) };
    const oldPending = pendingForSignature(oldMetadata, previousSignature);
    const oldFontWindow = pendingFontWindow(oldMetadata, previousSignature);
    const fontScopeChanged = hasFontScriptScopeChanged(previous, result.config);
    const oldGeolocationWindow = pendingGeolocationWindow(oldMetadata, previousSignature);
    const geolocationChanged = hasGeolocationScriptsChanged(previous, result.config);
    const pending = structuredClone(oldPending);
    for (const tab of tabs) {
      const surfaces: Array<'page' | 'font' | 'geolocation'> = [];
      if (pagePayloadChanged(previous, result.config, tab.url)) surfaces.push('page');
      if (fontScopeChanged) surfaces.push('font');
      if (geolocationChanged) surfaces.push('geolocation');
      if (surfaces.length) {
        addReloadDebt(pending, { tabId: tab.id, urlSignature: await syncSignature(tab.url) }, surfaces);
      }
    }
    const metadata: RuntimeSyncMetadata = { version: 1, report: pendingSyncReport(nextSignature), pendingReloads: pending,
      ...(fontScopeChanged || oldFontWindow ? { pendingFontScopeChange: true } : {}),
      ...(geolocationChanged || oldGeolocationWindow ? { pendingGeolocationScopeChange: true } : {}),
      previous: { configSignature: previousSignature, pendingReloads: oldPending,
        ...(oldFontWindow ? { pendingFontScopeChange: true } : {}),
        ...(oldGeolocationWindow ? { pendingGeolocationScopeChange: true } : {}) },
      ...(oldMetadata?.pendingDetectionCleanup ? { pendingDetectionCleanup: oldMetadata.pendingDetectionCleanup } : {})
    };
    // 先准备恢复记录。配置写入失败时恢复旧欠账；成功后不回滚用户期望。
    await setRuntimeSyncMetadata(metadata);
    try { await chrome.storage.local.set({ [SITE_CONFIG_KEY]: result.config }); }
    catch (error) {
      await setRuntimeSyncMetadata(oldMetadata);
      throw error;
    }
    return { config: result.config, syncReport: await reconcile(result.config, metadata) };
  }

  function mutateConfig(
    mutator: (current: SiteSpoofConfig) => Partial<SiteSpoofConfig> | Promise<Partial<SiteSpoofConfig>>,
    afterSave?: (saved: ConfigSaveResult) => Promise<ConfigSaveResult>
  ): Promise<ConfigSaveResult> {
    return enqueue(async () => {
      const current = await getSiteConfig();
      const saved = await persistConfig(current, await mutator(normalizeConfig(current)));
      return afterSave ? afterSave(saved) : saved;
    });
  }

  function getConfigState(): Promise<ConfigSaveResult> {
    return enqueue(async () => {
      const config = await getSiteConfig();
      return { config, syncReport: await reconcile(config) };
    });
  }

  async function saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<ConfigSaveResult> {
    const validated = validateConfig(config);
    if (!validated.ok) throw new Error(validated.errors.join('; '));
    return mutateConfig((current) => ({
      ...validated.config,
      exitLocationProfiles: current.exitLocationProfiles
    }));
  }

  async function resetSiteConfig(): Promise<ConfigSaveResult> {
    return mutateConfig(async () => {
      // 清理失败则不宣称重置成功；重置前在途响应不得重新发布候选。
      detectionGeneration += 1;
      await chrome.storage.session.remove(PENDING_DETECTION_KEY);
      return createInitialConfig();
    });
  }

  function completeOnboarding(domains: string, profileId: string, webRtcMode: string, recommendation?: ExitRecommendationSelection): Promise<ConfigSaveResult> {
    if (typeof domains !== 'string' || !domains.trim()) return Promise.reject(new Error('请先选择至少一个站点'));
    if (!['default', 'compatible', 'strict', ...(recommendation ? ['keep'] : [])].includes(webRtcMode)) return Promise.reject(new Error('请选择有效的 WebRTC 策略'));
    if (recommendation !== undefined && (!recommendation || typeof recommendation !== 'object'
      || !Number.isFinite(recommendation.expectedVerifiedAt) || recommendation.expectedVerifiedAt <= 0
      || !['keep', 'exit'].includes(recommendation.language) || !['keep', 'exit'].includes(recommendation.timezone)
      || !['keep', 'vendor-software'].includes(recommendation.fontExposure))) {
      return Promise.reject(new Error('请选择有效的出口环境推荐选项'));
    }
    return mutateConfig((config) => {
      const profile = config.exitLocationProfiles.find((profile) => profile.id === profileId && profile.verification === 'verified');
      if (!profile) {
        throw new Error('请先主动检测并确认出口位置档案');
      }
      const suggested = recommendExitEnvironment(profile);
      if (recommendation) {
        if (profile.verifiedAt !== recommendation.expectedVerifiedAt) throw new Error('出口位置档案已发生变化，请重新检查推荐');
        if (recommendation.language === 'exit' && !suggested.language.value) throw new Error('当前出口没有可用的地区语言推荐，请保留我的语言');
        if (recommendation.timezone === 'exit' && !suggested.timezone.value) throw new Error('当前出口没有可信时区，请重新检测');
      }
      const selected = rulesFromText(domains, config.rules.map((rule) => ({ ...rule, enabled: false })))
        .filter((rule) => rule.enabled);
      if (!selected.length) throw new Error('请先选择至少一个站点');
      const rules = config.rules.slice();
      selected.forEach((rule) => {
        const index = rules.findIndex((current) => current.domain === rule.domain);
        if (recommendation) {
          const previous = index >= 0 ? rules[index] : rule;
          const next = normalizeRule({ ...previous, enabled: true, exitLocationProfileId: profileId,
            overrides: { ...previous.overrides,
              ...(recommendation.language === 'exit' ? { language: { mode: 'override' as const, value: suggested.language.value } } : {}),
              ...(recommendation.timezone === 'exit' ? { timezone: { mode: 'override' as const, value: { enabled: true, mode: 'auto' as const, timezone: '' } } } : {})
            } });
          if (index >= 0) rules[index] = next;
          else rules.push(next);
          return;
        }
        // 用户选中的站点继承全局信号，其他站点与自定义方案保持原状。
        const next = normalizeRule({ id: rule.id, domain: rule.domain, exitLocationProfileId: profileId });
        if (index >= 0) rules[index] = next;
        else rules.push(next);
      });
      if (recommendation) return { ...config, masterEnabled: true, rules,
        webRtc: webRtcMode === 'keep' ? config.webRtc : normalizeWebRtc({ globalMode: webRtcMode as WebRtcMode }),
        fontExposure: recommendation.fontExposure === 'vendor-software' ? suggested.fontExposure.value : config.fontExposure
      };
      return { ...config, masterEnabled: true, rules, webRtc: normalizeWebRtc({ globalMode: webRtcMode as WebRtcMode }),
        globalProfile: { ...config.globalProfile,
          // 管理页用输入是否为空区分 manual；切 auto 时不能回填旧手工值。
          timezone: { ...config.globalProfile.timezone, enabled: true, mode: 'auto', timezone: '' },
          geolocation: { ...config.globalProfile.geolocation, enabled: true, mode: 'auto', latitude: null, longitude: null, country: '' }
        } };
    });
  }

  function skipOnboarding(): Promise<ConfigSaveResult> {
    return mutateConfig((config) => ({ ...config, masterEnabled: false, webRtc: { globalMode: 'default' } }));
  }

  async function handleInstalled(reason: string): Promise<void> {
    await initializeExtension();
    const config = await getSiteConfig();
    // update/startup/worker 唤醒不打开引导，不用安装事件覆盖存储中的配置。
    if (reason === 'install' && !config.masterEnabled && !config.rules.length
      && !config.exitLocationProfiles.length && !config.profile.profiles.length && config.webRtc.globalMode === 'default') {
      await chrome.runtime.openOptionsPage();
    }
  }

  async function importSiteConfig(config: Partial<SiteSpoofConfig>): Promise<ConfigSaveResult> {
    // 非法输入在读取旧存储前拒绝，不能由失败导入触发迁移写入或旧键清理。
    const validated = validateConfig(config);
    if (!validated.ok) throw new Error(validated.errors.join('; '));
    return mutateConfig(() => {
      const imported = validated.config;
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

  async function getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig; syncReport: RuntimeSyncReport }> {
    const state = await getConfigState();
    return { enabled: state.config.masterEnabled, ...state };
  }

  async function setExtensionEnabled(enabled: boolean): Promise<ConfigSaveResult> {
    return mutateConfig((config) => ({ ...config, masterEnabled: Boolean(enabled) }));
  }

  async function setWebRtcGlobalMode(mode: string): Promise<ConfigSaveResult> {
    return mutateConfig((config) => ({ ...config, webRtc: normalizeWebRtc({ globalMode: mode as any }) }));
  }

  async function getWebRtcPolicyState(): Promise<WebRtcPolicyState> {
    return getWebRTCPolicyState(await getSiteConfig());
  }

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult> {
    if (!isScriptableUrl(url)) return { matched: false, rule: null, payload: null, errors: [] };
    return getPageRuntimeProfile(await getSiteConfig(), new URL(url).hostname);
  }

  async function getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & {
    url: string;
    domain: string;
    scriptable: boolean;
    config: SiteSpoofConfig;
    syncReport: RuntimeSyncReport;
  }> {
    const { config, syncReport } = await getConfigState();
    const url = tab?.url || '';
    const domain = isScriptableUrl(url) ? new URL(url).hostname : '';
    const scriptable = Boolean(domain);
    const resolved = scriptable
      ? getPageRuntimeProfile(config, domain)
      : { matched: false, rule: null, payload: null, errors: [] };
    return { url, domain, scriptable, config, syncReport, ...resolved };
  }

  async function detectExitLocation(targetProfileId?: string | null): Promise<ExitLocationDetectionPreview> {
    const generation = detectionGeneration;
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
    // 网络请求不占配置队列；候选发布与确认/清理串行，避免清理误删新候选。
    await enqueue(async () => {
      if (generation !== detectionGeneration) throw new Error('检测期间配置已重置，请重新检测');
      await chrome.storage.session.set({ [PENDING_DETECTION_KEY]: pending });
    });
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

  async function confirmExitLocationDetection(detectionId: string, name: string): Promise<ConfigSaveResult> {
    const profileName = normalizeString(name);
    if (!profileName) throw new Error('出口位置档案名称不能为空');
    return mutateConfig(async (config) => {
      const pending = await getPendingDetection(detectionId);
      const profiles = config.exitLocationProfiles.slice();
      const targetIndex = pending.targetProfileId
        ? profiles.findIndex((profile) => profile.id === pending.targetProfileId)
        : -1;
      if (pending.targetProfileId && targetIndex < 0) throw new Error('出口位置档案已被删除，请重新检测');
      const confirmedId = pending.targetProfileId || `exit-${pending.detectionId}`;
      const confirmed = profiles.find((profile) => profile.id === confirmedId);
      if (confirmed?.verification === 'verified' && confirmed.verifiedAt === pending.candidate.detectedAt && confirmed.publicIp === pending.candidate.publicIp
        && confirmed.provider === pending.candidate.provider && confirmed.latitude === pending.candidate.latitude
        && confirmed.longitude === pending.candidate.longitude && confirmed.timezone === pending.candidate.timezone
        && confirmed.country === pending.candidate.country
        && (confirmed.countryCode ?? null) === (pending.candidate.countryCode ?? null)) return config;
      if (!pending.targetProfileId && confirmed) {
        throw new Error('检测对应的出口位置档案已发生变化，请重新检测');
      }
      if (targetIndex >= 0 && profiles[targetIndex].verifiedAt !== pending.baseVerifiedAt) {
        throw new Error('出口位置档案已发生变化，请重新检测');
      }

      const profile: ExitLocationProfile = {
        id: confirmedId,
        name: profileName,
        verification: 'verified',
        publicIp: pending.candidate.publicIp,
        latitude: pending.candidate.latitude,
        longitude: pending.candidate.longitude,
        country: pending.candidate.country,
        countryCode: pending.candidate.countryCode ?? null,
        timezone: pending.candidate.timezone,
        provider: pending.candidate.provider,
        verifiedAt: pending.candidate.detectedAt
      };
      if (targetIndex >= 0) profiles[targetIndex] = profile;
      else profiles.push(profile);
      return { ...config, exitLocationProfiles: profiles };
    }, async (saved) => {
      try {
        await removeConfirmedDetection(detectionId);
      } catch {
        // 提交后清理失败不能抹掉 saved 结果；以相同候选 ID 重试不会创建重复档案。
        saved.syncReport = summarizeSyncReport({ ...saved.syncReport,
          warnings: [{ code: 'candidate-cleanup-failed', message: '出口档案已保存，检测候选清理失败，请重试同步。' }]
        });
        try {
          const metadata = await getRuntimeSyncMetadata();
          if (!metadata || metadata.report.configSignature !== saved.syncReport.configSignature) throw new Error('同步记录不匹配');
          metadata.report = saved.syncReport;
          metadata.pendingDetectionCleanup = detectionId;
          await checkpoint(metadata);
          saved.syncReport = metadata.report;
        } catch {
          saved.syncReport.metadataError = { code: 'metadata-write-failed', message: '检测候选清理的恢复记录未能保存，请重新确认或取消候选。' };
        }
      }
      return saved;
    });
  }

  async function removeConfirmedDetection(detectionId: string): Promise<void> {
    const data = await chrome.storage.session.get(PENDING_DETECTION_KEY);
    if (data[PENDING_DETECTION_KEY]?.detectionId === detectionId) await chrome.storage.session.remove(PENDING_DETECTION_KEY);
  }

  async function cancelExitLocationDetection(detectionId: string): Promise<void> {
    await enqueue(() => removeConfirmedDetection(detectionId));
  }

  async function renameExitLocationProfile(profileId: string, name: string): Promise<ConfigSaveResult> {
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

  async function deleteExitLocationProfile(profileId: string): Promise<ConfigSaveResult> {
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

  async function addDomainRule(domain: string): Promise<ConfigSaveResult> {
    return mutateConfig((config) => {
      const normalizedDomain = normalizeDomain(domain);
      const existing = config.rules.find((rule) => rule.domain === normalizedDomain);
      if (existing) existing.enabled = true;
      else config.rules.push(createRule(normalizedDomain));
      return config;
    });
  }

  async function setDomainRuleEnabled(domain: string, enabled: boolean): Promise<ConfigSaveResult> {
    return mutateConfig((config) => {
      const rule = config.rules.find((item) => item.domain === normalizeDomain(domain));
      if (!rule) throw new Error('站点规则不存在');
      rule.enabled = Boolean(enabled);
      return config;
    });
  }

  async function deleteDomainRule(domain: string): Promise<ConfigSaveResult> {
    return mutateConfig((config) => ({
      ...config,
      rules: config.rules.filter((rule) => rule.domain !== normalizeDomain(domain))
    }));
  }

  async function openDiagnosticPage(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('diagnostic/report.html') });
  }

  async function openDiagnosticTarget(target: 'hosted' | 'localhost', port = 8787): Promise<number> {
    if (target !== 'hosted' && target !== 'localhost') throw new Error('未知诊断目标');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('localhost 端口无效');
    const url = new URL(LEAK_TEST_URL);
    if (target === 'localhost') url.href = `http://localhost:${port}/leak-test/leak-test.html`;
    url.searchParams.set('ui', 'zh');
    const tab = await chrome.tabs.create({ url: url.toString() });
    if (typeof tab.id !== 'number') throw new Error('未获得诊断目标标签页 ID');
    return tab.id;
  }

  async function getDiagnosticTargets(): Promise<Array<{ tabId: number; origin: string }>> {
    return (await queryScriptableTabs()).map((tab) => ({ tabId: tab.id, origin: new URL(tab.url).origin }));
  }

  function initializeExtension(): Promise<RuntimeSyncReport> {
    return enqueue(async () => {
      try {
        const before = await chrome.storage.local.get(null);
        const storedConfig = before[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
        const hadLegacyConfig = Boolean(storedConfig && storedConfig.schemaVersion !== 3)
          || Boolean(before[LEGACY_VANISHME_CONFIG_KEY]) || Boolean(before[LAST_LOCATION_KEY])
          || [OLD_EXTENSION_ENABLED_KEY, OLD_LANGUAGE_KEY, OLD_TIMEZONE_KEY, OLD_WEBRTC_KEY]
            .some((key) => Object.prototype.hasOwnProperty.call(before, key));
        const config = await getSiteConfig();
        if (hadLegacyConfig) {
          const signature = await runtimeConfigSignature(config);
          const old = await getRuntimeSyncMetadata();
          const pendingReloads = old?.report.configSignature === signature ? old.pendingReloads.slice() : [];
          for (const tab of await queryScriptableTabs()) {
            if (isUrlMatchedByEnabledRule(config, tab.url)) pendingReloads.push({ tabId: tab.id, urlSignature: await syncSignature(tab.url) });
          }
          await setRuntimeSyncMetadata({ version: 1, report: pendingSyncReport(signature), pendingReloads });
        }
        return await reconcile(config);
      } catch (error) {
        // 启动状态不可确认时，只撤销所属字体注册；清理仍占用配置队列，不猜测或覆盖配置。
        const cleanup = await syncFontScriptRegistration([]);
        const geolocationCleanup = await reconcileGeolocationScripts(createInitialConfig(), geolocationRuntimeSource);
        if (geolocationCleanup.component.status !== 'ok') {
          const reason = error instanceof Error ? error.message : String(error);
          throw Object.assign(new RuntimeSyncOperationError('geolocation-scripts-sync-failed',
            `启动初始化失败：${reason}；旧地理位置注册清理未能确认${cleanup.status !== 'ok' ? '，字体清理亦未确认' : ''}。`), { cause: error });
        }
        if (cleanup.status !== 'ok') {
          const reason = error instanceof Error ? error.message : String(error);
          throw Object.assign(new RuntimeSyncOperationError('font-scripts-sync-failed',
            `启动初始化失败：${reason}；旧字体注册清理未能确认。`), { cause: error });
        }
        throw error;
      }
    });
  }

  return {
    webRtcPolicies: WEBRTC_POLICY_VALUES,
    getSiteConfig,
    getConfigState,
    reconcileRuntime: getConfigState,
    saveSiteConfig,
    resetSiteConfig,
    completeOnboarding,
    skipOnboarding,
    handleInstalled,
    importSiteConfig,
    getExtensionState,
    setExtensionEnabled,
    getWebRtcPolicyState,
    setWebRtcGlobalMode,
    getPayloadForUrl,
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
    openDiagnosticTarget,
    getDiagnosticTargets,
    prepareDiagnosticRun: diagnosticRuns.prepare,
    executeDiagnosticRun: diagnosticRuns.execute,
    executeInjectionTimingRun: diagnosticRuns.executeTiming,
    cancelDiagnosticRun: diagnosticRuns.cancel,
    invalidateDiagnosticTab: diagnosticRuns.invalidateTab,
    initializeExtension
  };
}
