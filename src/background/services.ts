import { updateAcceptLanguageRules } from './dnr';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy } from './webrtc';
import {
  LAST_LOCATION_KEY,
  domainMatches,
  getEffectiveProfile,
  getEnabledRuleDomains,
  getContentScriptRegistration,
  getExcludedRuleDomains,
  isUrlMatchedByEnabledRule,
  migrateLegacyConfig,
  validateConfig
} from '../shared/config-resolver';
import { createRule, normalizeConfig, normalizeDomain, normalizeWebRtc } from '../shared/config-model';
import { describeSiteStatus } from '../shared/site-status';
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
const GEO_PERMISSION_KEY = 'geoPermissionDomains';
/** 构建期烘焙进 manifest 的域名（普通构建为空数组） */
function bakedScriptDomains(): string[] {
  if (typeof __VANISHGEO_STATIC_SCRIPT_DOMAINS__ === 'undefined') return [];
  const domains = __VANISHGEO_STATIC_SCRIPT_DOMAINS__;
  return Array.isArray(domains) ? domains : [];
}

const MAIN_RUNTIME_FILES = ['injected/runtime.js'];
const BRIDGE_FILES = ['content/content.js'];

const FALLBACK_LOCATION: LastLocation = {
  latitude: 0,
  longitude: 0,
  country: 'Privacy fallback'
};

/**
 * 去重账本的持久化位置与容量上限。账本本身在 `createBackgroundServices` 的闭包里
 * （每个实例独立，测试之间不串），这里只放不会变的常量。
 */
const INJECTED_DOCS_KEY = 'injectedDocumentIds';
const MAX_INJECTED_DOCS = 500;

/**
 * 读当前主框架的 `documentId` 且不执行任何业务脚本（隔离世界里的空函数，
 * 页面上看不见）。拿不到就返回空串 —— 调用方据此跳过注入，
 * 宁可少装一次，也不重复执行。
 */
async function currentDocumentId(tabId: number): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => 0,
      world: 'ISOLATED'
    }) as Array<{ documentId?: string }>;
    return results?.[0]?.documentId || '';
  } catch {
    return '';
  }
}

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

/**
 * 当前配置是否真的需要出口 IP 的坐标。
 *
 * 判定方式：把 `lastLocation` 当成"未知"喂给解析器，只要还有域名因为解析不出
 * 时区/坐标而报错，就说明它在 auto 模式，需要去问 IP 归属地接口。
 * 时区与坐标都手填（persona 烘焙构建的默认形态）时返回 false ——
 * 这种配置下任何一次定位请求都是纯浪费。
 */
export function configNeedsLocation(config: Partial<SiteSpoofConfig>): boolean {
  if (!config || config.masterEnabled === false) return false;
  return getEnabledRuleDomains(config).some((domain) => {
    const resolved = getEffectiveProfile(config, domain, null);
    return resolved.matched && resolved.errors.length > 0;
  });
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
  /** 单条注入路径：确保文档里有 runtime，然后投递 payload（两者都幂等） */
  syncTab(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void>;
  /** 内容脚本上报自己的 documentId：说明该文档已经由注册的内容脚本装过 runtime */
  noteDocumentInjected(documentId?: string): Promise<void>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & { domain: string; config: SiteSpoofConfig; lastLocation: LastLocation | null }>;
  addDomainRule(domain: string): Promise<SiteSpoofConfig>;
  setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig>;
  deleteDomainRule(domain: string): Promise<SiteSpoofConfig>;
  /** 规则改动后重载该域及其子域的标签页 */
  reloadAffectedTabs(domain: string): Promise<void>;
  setWebRtcGlobalMode(mode: string): Promise<SiteSpoofConfig>;
  openDiagnosticPage(): Promise<void>;
  /** 安装 / 浏览器启动时跑一次：对齐持久状态，需要定位时按需拉一次 */
  bootstrap(): Promise<void>;
  /** 配置变化：只重算副作用，不触发 IP 定位 */
  applyConfig(config?: SiteSpoofConfig): Promise<void>;
  refreshActionBadge(): Promise<void>;
}

export function createBackgroundServices(): BackgroundServices {
  /**
   * 已经装过 runtime.js 的文档（`documentId`）。
   *
   * 只存在于扩展侧（内存 + `chrome.storage.session`），页面上没有任何痕迹 ——
   * 这比在 window 上挂一个 marker 更安全：后者 `Object.getOwnPropertySymbols(window)`
   * 能枚举到，等于主动告诉页面"这里被动过"。
   *
   * 放进工厂闭包而不是模块作用域：一是每个实例独立（测试之间不会互相污染），
   * 二是模块级可变状态在 SW 重启后本来就和内存一起消失，语义上就该属于实例。
   */
  const injectedDocuments = new Set<string>();
  let injectedDocumentsReady: Promise<void> | null = null;

  /** 从 `chrome.storage.session` 捞回上一次 SW 生命周期里的账本 */
  function loadInjectedDocuments(): Promise<void> {
    if (!injectedDocumentsReady) {
      injectedDocumentsReady = (async () => {
        try {
          const stored = await chrome.storage.session.get(INJECTED_DOCS_KEY);
          const ids = stored[INJECTED_DOCS_KEY];
          if (Array.isArray(ids)) {
            ids.forEach((id: unknown) => {
              if (typeof id === 'string' && id) injectedDocuments.add(id);
            });
          }
        } catch {
          /* 没有 session 区（或测试替身没实现）时退化成纯内存去重 */
        }
      })();
    }
    return injectedDocumentsReady;
  }

  async function markDocumentInjected(documentId: string): Promise<void> {
    if (!documentId) return;
    await loadInjectedDocuments();
    if (injectedDocuments.has(documentId)) return;
    injectedDocuments.add(documentId);

    let ids = Array.from(injectedDocuments);
    if (ids.length > MAX_INJECTED_DOCS) {
      ids = ids.slice(ids.length - MAX_INJECTED_DOCS);
      injectedDocuments.clear();
      ids.forEach((id) => injectedDocuments.add(id));
    }
    try {
      await chrome.storage.session.set({ [INJECTED_DOCS_KEY]: ids });
    } catch {
      /* 同上：内存去重已经生效，持久化失败不影响正确性 */
    }
  }

  async function getStorageSnapshot(): Promise<Record<string, any>> {
    return chrome.storage.local.get(null);
  }

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const data = await getStorageSnapshot();
    if (data.siteSpoofConfig) return migrateLegacyConfig(data);

    // 首次运行：persona 构建用烘焙配置做种子，保证后台（DNR 头、定位权限、内容脚本
    // 匹配规则）和注入层说的是同一套参数；之后的改动以 storage 为准。
    const baked = typeof __VANISHGEO_BAKED__ === 'object' && __VANISHGEO_BAKED__
      ? (__VANISHGEO_BAKED__ as { config?: Partial<SiteSpoofConfig> })
      : null;
    const config = baked && baked.config
      ? migrateLegacyConfig({ siteSpoofConfig: baked.config })
      : migrateLegacyConfig(data);

    await chrome.storage.local.set({ siteSpoofConfig: config });
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

  // 单飞：重载扩展时 onInstalled / onStartup / popup 可能同时走到这里，
  // 两条并发路径都读到"还没注册"，后到的 register 就会抛 Duplicate script ID。
  let registerInFlight: Promise<void> = Promise.resolve();

  /** 上一次真正应用过的配置签名：保存路径与 storage 事件都会走到 applyConfig */
  let lastAppliedSignature = '';

  function registerSpoofContentScripts(configOverride?: SiteSpoofConfig): Promise<void> {
    const run = () => doRegisterSpoofContentScripts(configOverride);
    const next = registerInFlight.then(run, run);
    registerInFlight = next.catch(() => undefined);
    return next;
  }

  async function doRegisterSpoofContentScripts(configOverride?: SiteSpoofConfig): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;
    const config = configOverride || await getSiteConfig();
    // 烘焙构建把域名写进了 manifest 的静态 content_scripts：这些域名由浏览器在
    // 渲染进程创建时就注入，比动态注册早一个身位（Chromium 156 上动态注册会漏掉
    // 会话里的第一次导航）。这里只补注册不在烘焙清单里的域名。
    const { matches, excludeMatches } = getContentScriptRegistration(config, bakedScriptDomains());

    if (!matches.length) {
      await unregisterSpoofContentScripts();
      return;
    }

    // 已存在时走 updateContentScripts：unregister + register 之间有一个窗口期，
    // 这期间加载的页面不会有任何脚本注入，等于裸奔一次。
    const definitions: chrome.scripting.RegisteredContentScript[] = [
      {
        id: MAIN_RUNTIME_SCRIPT_ID,
        matches,
        ...(excludeMatches.length ? { excludeMatches } : {}),
        js: MAIN_RUNTIME_FILES,
        runAt: 'document_start',
        allFrames: true,
        // 不透明来源的 iframe（about:blank / srcdoc / blob:）默认不注入。页面只要建一个
        // <iframe srcdoc> 进去读 contentWindow.Date，拿到的就是没打补丁的原生对象 ——
        // 主框架和子框架说法不一致，这一条比任何原型检测都硬。
        // matchOriginAsFallback 让这类 frame 按其**创建者**的来源参与匹配。
        matchOriginAsFallback: true,
        world: 'MAIN',
        persistAcrossSessions: true
      },
      {
        id: BRIDGE_SCRIPT_ID,
        matches,
        ...(excludeMatches.length ? { excludeMatches } : {}),
        js: BRIDGE_FILES,
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
        world: 'ISOLATED',
        persistAcrossSessions: true
      }
    ];

    const existing = await chrome.scripting
      .getRegisteredContentScripts({ ids: CONTENT_SCRIPT_IDS })
      .catch(() => [] as chrome.scripting.RegisteredContentScript[]);
    const existingIds = new Set(existing.map((script) => script.id));
    const toUpdate = definitions.filter((script) => existingIds.has(script.id));
    const toRegister = definitions.filter((script) => !existingIds.has(script.id));

    if (toRegister.length) {
      try {
        await chrome.scripting.registerContentScripts(toRegister);
      } catch (error) {
        // 浏览器重载后旧注册仍挂在配置里，但 getRegisteredContentScripts 可能暂时读不到，
        // 此时 register 会抛 Duplicate script ID；改走 update 即可，不必让重载报错。
        if (!/Duplicate script ID/i.test(String((error as Error)?.message ?? error))) throw error;
        await chrome.scripting.updateContentScripts(toRegister);
      }
    }
    if (toUpdate.length) {
      await chrome.scripting.updateContentScripts(toUpdate);
    }
  }

  /**
   * 用 contentSettings 把匹配域名的定位权限置为 allow。
   *
   * 这样页面里 navigator.permissions.query({name:'geolocation'}) 拿到的是真实 PermissionStatus，
   * 不需要在 JS 层伪造一个 `[object Object]` —— 伪造对象本身就是最容易被识别的痕迹之一。
   */
  async function applyGeolocationPermissions(config: SiteSpoofConfig): Promise<void> {
    // 注意是 location 而不是 geolocation（chrome.contentSettings 的类型名）
    const settings = chrome.contentSettings && (chrome.contentSettings as any).location;
    if (!settings) return;

    const lastLocation = await getLastLocation();
    const wanted: string[] = [];
    for (const domain of getEnabledRuleDomains(config)) {
      const resolved = getEffectiveProfile(config, domain, lastLocation);
      const geolocation = resolved.payload ? resolved.payload.geolocation : null;
      if (!geolocation || geolocation.spoofPermission === false) continue;
      wanted.push(domain);
    }

    const stored = await chrome.storage.local.get(GEO_PERMISSION_KEY);
    const previous: string[] = Array.isArray(stored[GEO_PERMISSION_KEY]) ? stored[GEO_PERMISSION_KEY] : [];

    for (const domain of previous) {
      if (wanted.indexOf(domain) !== -1) continue;
      for (const pattern of [`*://${domain}/*`, `*://*.${domain}/*`]) {
        try {
          await settings.clear({ scope: 'regular', primaryPattern: pattern });
        } catch { /* ignore */ }
      }
    }

    for (const domain of wanted) {
      for (const pattern of [`*://${domain}/*`, `*://*.${domain}/*`]) {
        try {
          await settings.set({ primaryPattern: pattern, setting: 'allow', scope: 'regular' });
        } catch { /* ignore */ }
      }
    }

    // 被显式排除的子域会被父域的 `*://*.parent/*` 通配授权覆盖到。退回 ask，
    // 让"排除"在权限层面也成立 —— 否则站点拿到的是真实定位而不是没有定位。
    for (const domain of getExcludedRuleDomains(config)) {
      for (const pattern of [`*://${domain}/*`, `*://*.${domain}/*`]) {
        try {
          await settings.set({ primaryPattern: pattern, setting: 'ask', scope: 'regular' });
        } catch { /* ignore */ }
      }
    }

    if (previous.join(',') !== wanted.join(',')) {
      await chrome.storage.local.set({ [GEO_PERMISSION_KEY]: wanted });
    }
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    await registerSpoofContentScripts(config);
    // 头规则要跟着「当前能不能真的注入」走：定位拿不到时注入侧 fail-closed，
    // 头也不能继续宣告 en-US，否则请求头和页面 JS 自相矛盾。
    await updateAcceptLanguageRules(config, await getLastLocation());
    await applyWebRTCPolicy(config);
    await applyGeolocationPermissions(config);
    await refreshActionBadge();
  }

  async function saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    const result = validateConfig(config);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    await chrome.storage.local.set({ siteSpoofConfig: result.config });
    // 写入之后立刻应用一次；随后 storage.onChanged 会带着同一份签名再进来一趟，
    // 被 applyConfig 的签名去重挡掉，不会重复注册脚本 / 重写 DNR 规则。
    await applyConfig(result.config);
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

  /**
   * 确保当前文档里有 runtime —— **唯一的脚本注入入口**。
   *
   * 正常导航由注册的内容脚本在 `document_start` 装上，这里只兜住"文档比注册更早
   * 存在"的冷标签页（先开页面再加白名单、或刚启用扩展）。是否装过用 `documentId`
   * 判定，状态只留在扩展侧，页面上没有 marker。
   */
  async function ensureRuntimeInDocument(tabId: number, url: string): Promise<void> {
    if (!isScriptableUrl(url)) return;
    await loadInjectedDocuments();

    const documentId = await currentDocumentId(tabId);
    // 拿不到 documentId 就跳过：宁可这一次少装，也不要重复执行一遍 runtime.js
    if (!documentId || injectedDocuments.has(documentId)) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: MAIN_RUNTIME_FILES,
        injectImmediately: true,
        world: 'MAIN'
      });
      await markDocumentInjected(documentId);
    } catch (error) {
      console.warn(`VanishGeo could not install runtime in tab ${tabId}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /** 只负责投递 payload：runtime 不在就静默落空，绝不重复执行脚本 */
  /**
   * 推 payload 给指定标签页的所有 frame。
   *
   * 走 `tabs.sendMessage` 交给 ISOLATED 桥，由桥转进私有 MessagePort —— 不再用
   * `executeScript` 往页面里 `window.postMessage`：那条消息页面的监听器也收得到，
   * nonce 和 payload 一起泄露。
   */
  async function pushPayload(tabId: number, payload: unknown): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'applyPayload', payload });
    } catch (error) {
      console.warn(`VanishGeo could not deliver payload to tab ${tabId}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /** 单标签页同步：装（幂等）+ 推 payload（幂等） */
  async function syncTab(tabId: number, url: string, options?: { config?: SiteSpoofConfig; lastLocation?: LastLocation | null }): Promise<void> {
    // persona 构建：配置已烘焙进 runtime.js，运行时不推 payload
    if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;
    const config = options?.config || await getSiteConfig();
    if (!isScriptableUrl(url) || !isUrlMatchedByEnabledRule(config, url)) return;

    const lastLocation = Object.prototype.hasOwnProperty.call(options || {}, 'lastLocation')
      ? options?.lastLocation || null
      : await getLastLocation();
    const resolved = await buildPayloadForUrl(url, config, lastLocation);
    if (!resolved.matched || !resolved.payload) return;

    await ensureRuntimeInDocument(tabId, url);
    await pushPayload(tabId, resolved.payload);
  }

  async function updateAllTabs(configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<void> {
    const config = configOverride || await getSiteConfig();
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();
    if (!getContentScriptRegistration(config).matches.length) return;

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && isScriptableUrl(tab.url) && isUrlMatchedByEnabledRule(config, tab.url)) {
        await syncTab(tab.id, tab.url, { config, lastLocation });
      }
    }
  }

  async function updateGeolocation(forceUpdate = false): Promise<{ ok: boolean; location?: LastLocation; unchanged?: boolean; disabled?: boolean; error?: string }> {
    try {
      const config = await getSiteConfig();
      if (!config.masterEnabled) {
        return { ok: false, disabled: true, error: 'extension disabled' };
      }

      // 非强制调用（alarm / bootstrap）只在 current config 真的需要出口坐标时才打接口。
      // 时区与坐标都手填的 persona 配置，不应该每分钟去问一次 IP 归属地。
      if (!forceUpdate && !configNeedsLocation(config)) {
        return { ok: true, unchanged: true };
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
    } finally {
      // 定位成功或失败都要重算角标：否则「!」会一直挂到下一次标签事件
      await refreshActionBadge();
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

  /**
   * 图标上挂一个「!」：白名单里但没生效（定位拿不到 → fail-closed）时必须可见，
   * 否则用户以为自己在受保护状态下操作。
   */
  async function refreshActionBadge(): Promise<void> {
    const action = chrome.action;
    if (!action || !action.setBadgeText) return;
    try {
      // 覆盖所有标签页，而不是只覆盖"当前活动标签"：配置或定位变化之后，
      // 后台开着的那些页面上的角标同样会过期。
      const config = await getSiteConfig();
      const lastLocation = await getLastLocation();
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (typeof tab.id !== 'number' || !tab.url) continue;
        const domain = normalizeDomain(tab.url);
        const status = describeSiteStatus(domain
          ? getEffectiveProfile(config, domain, lastLocation)
          : { matched: false, rule: null, payload: null, errors: [] });
        const tabId = tab.id;
        if (status.broken) {
          await action.setBadgeBackgroundColor({ color: '#d93025', tabId });
          await action.setBadgeText({ text: '!', tabId });
          await action.setTitle({ title: `VanishGeo：${status.text}`, tabId });
        } else {
          await action.setBadgeText({ text: '', tabId });
          await action.setTitle({ title: status.active ? 'VanishGeo：已生效' : 'VanishGeo', tabId });
        }
      }
    } catch {
      /* 没有 tabs 权限或被浏览器限制时静默跳过 */
    }
  }

  /**
   * 规则动了之后，把**这个域自己**的标签页重载一遍。
   *
   * 只重载该域及其子域，不动其它标签页：启用/禁用/删除都只影响这一个范围。
   * 重载放在保存之后，保证页面拿到的是新配置（否则会先加载旧状态再被推一次 payload）。
   */
  async function reloadAffectedTabs(domain: string): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) return;

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !isScriptableUrl(tab.url)) continue;
      let hostname = '';
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        continue;
      }
      if (!domainMatches(hostname, normalizedDomain)) continue;
      try {
        await chrome.tabs.reload(tab.id);
      } catch {
        /* 标签页可能刚被关掉 */
      }
    }
  }

  /**
   * 写入一条规则的启用状态。规则不存在时**新建**（而不是报错）：
   * 站点的"启用/排除"两个动作都必须能在任意域名上直接生效，
   * 排除还得能凭空建出"google.com 底下排除 mail.google.com"这种规则。
   */
  async function upsertDomainRule(domain: string, enabled: boolean): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error('domain is required');

    const existing = config.rules.find((rule) => rule.domain === normalizedDomain);
    if (existing) {
      existing.enabled = Boolean(enabled);
    } else {
      const rule = createRule(normalizedDomain);
      rule.enabled = Boolean(enabled);
      config.rules.push(rule);
    }
    const saved = await saveSiteConfig(config);
    await reloadAffectedTabs(normalizedDomain);
    return saved;
  }

  async function addDomainRule(domain: string): Promise<SiteSpoofConfig> {
    return upsertDomainRule(domain, true);
  }

  async function setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig> {
    return upsertDomainRule(domain, enabled);
  }

  async function deleteDomainRule(domain: string): Promise<SiteSpoofConfig> {
    const config = await getSiteConfig();
    const normalizedDomain = normalizeDomain(domain);
    config.rules = config.rules.filter((rule) => rule.domain !== normalizedDomain);
    const saved = await saveSiteConfig(config);
    await reloadAffectedTabs(normalizedDomain);
    return saved;
  }

  async function openDiagnosticPage(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('leak-test/leak-test.html') });
  }

  /**
   * 安装 / 浏览器启动：把持久状态对齐到当前配置，需要定位时按需拉一次。
   *
   * 用非强制的 `updateGeolocation()`：首次安装没有存量坐标会照常写入，
   * 已经有坐标且没变则直接返回，不会每次都白打一遍 IP 接口。
   */
  async function bootstrap(): Promise<void> {
    const config = normalizeConfig(await getSiteConfig());
    // 走 applyConfig 而不是直接调副作用：SW 重启后要顺手把 payload 补推给
    // 会话恢复出来的标签页（这些文档可能是在注册生效之前就存在的）。
    await applyConfig(config);
    await updateGeolocation(false);
  }

  /**
   * 配置变化：只重算副作用（内容脚本 / 头规则 / WebRTC / 定位授权 / 角标 / 已开标签页），
   * **不触发 IP 定位**。出口坐标的变化只由 alarm 与手动「重试定位」驱动。
   *
   * 保存路径 (`saveSiteConfig`) 和 `storage.onChanged` 都会调到这里，
   * 靠签名去重保证一次写入只应用一次。
   */
  async function applyConfig(configOverride?: SiteSpoofConfig): Promise<void> {
    const config = normalizeConfig(configOverride || await getSiteConfig());
    const signature = JSON.stringify(config);
    if (signature === lastAppliedSignature) return;

    await applyRuntimeSideEffects(config);
    await updateAllTabs(config);
    // 只在成功之后记账：中途失败（DNR / 权限被策略锁住）时下一次还能重试，
    // 不会因为"记成已应用"而永久停在半应用状态。
    lastAppliedSignature = signature;
  }

  async function noteDocumentInjected(documentId?: string): Promise<void> {
    if (!documentId) return;
    await markDocumentInjected(documentId);
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
    syncTab,
    noteDocumentInjected,
    getPayloadForUrl,
    getCurrentTabState,
    addDomainRule,
    setDomainRuleEnabled,
    deleteDomainRule,
    reloadAffectedTabs,
    setWebRtcGlobalMode,
    openDiagnosticPage,
    bootstrap,
    applyConfig,
    refreshActionBadge
  };
}
