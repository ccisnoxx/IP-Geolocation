import { buildAcceptLanguageRules, updateAcceptLanguageRules } from './dnr';
import { GEO_API_URLS, fetchJson, parseGeoApiResponse } from './geo-api';
import { IP_SYNC_ALARM_NAME, LAST_SYNCED_IP_KEY, ensureIpSyncAlarmFor, isIpSyncEnabled, lookupExitIp, planExitIpApply, runExitIpSync } from './ip-sync';
import type { ExitIpApplyOutcome, ExitIpSyncOutcome, IpSyncAlarmGateway } from './ip-sync';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy } from './webrtc';
import {
  LAST_LOCATION_KEY,
  domainMatches,
  getEffectiveProfile,
  getEnabledRuleDomains,
  getContentScriptRegistration,
  getExcludedRuleDomains,
  migrateLegacyConfig,
  validateConfig
} from '../shared/config-resolver';
import { createRule, normalizeConfig, normalizeDomain, normalizeWebRtc } from '../shared/config-model';
import { describeSiteStatus } from '../shared/site-status';
import { normalizeWorkerFallbackReason } from '../shared/worker-coverage';
import type { WorkerFallbackReport, WorkerFallbackSummary } from '../shared/worker-coverage';
import type { EffectiveProfileResult, LastLocation, SiteSpoofConfig } from '../shared/types';

const ALARM_NAME = 'vanishgeo-update-location';
const MAIN_RUNTIME_SCRIPT_ID = 'vanishgeo-main-runtime';
const BRIDGE_SCRIPT_ID = 'vanishgeo-bridge';
const CONTENT_SCRIPT_IDS = [MAIN_RUNTIME_SCRIPT_ID, BRIDGE_SCRIPT_ID];
const GEO_PERMISSION_KEY = 'geoPermissionDomains';
const GEO_DENIED_KEY = 'geoDeniedDomains';
/** 构建期烘焙进 manifest 的域名（普通构建为空数组） */
function bakedScriptDomains(): string[] {
  if (typeof __VANISHGEO_STATIC_SCRIPT_DOMAINS__ === 'undefined') return [];
  const domains = __VANISHGEO_STATIC_SCRIPT_DOMAINS__;
  return Array.isArray(domains) ? domains : [];
}

/**
 * frozen 烘焙包：`--no-bridge` 且配置真的被烘焙。
 *
 * 这类包没有 ISOLATED 桥，页面里的 runtime 永远拿不到 clear；如果后台还按
 * storage 改 DNR / 权限，就会出现"页面是烘焙值、请求头却是原生值"的撕裂。
 * 所以后台也读烘焙配置，彻底忽略后续保存 —— 想改只能重新构建。
 */
function frozenBakedConfig(): SiteSpoofConfig | null {
  if (typeof __VANISHGEO_BRIDGE__ !== 'boolean' || __VANISHGEO_BRIDGE__) return null;
  const baked = typeof __VANISHGEO_BAKED__ === 'object' && __VANISHGEO_BAKED__
    ? (__VANISHGEO_BAKED__ as { config?: Partial<SiteSpoofConfig> })
    : null;
  if (!baked || !baked.config) return null;
  return migrateLegacyConfig({ siteSpoofConfig: baked.config });
}

const MAIN_RUNTIME_FILES = ['injected/runtime.js'];
const BRIDGE_FILES = ['content/content.js'];

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

// 出口 IP 接口的解析与请求都搬到了 `geo-api`（自动跟随出口 IP 也要用同一份校验）。
// 这里保留同名导出，调用方（smoke 脚本 / 测试 / 其它模块）不受影响。
export { GEO_API_URLS, fetchJson, parseGeoApiResponse } from './geo-api';

function isScriptableUrl(url: string | undefined): boolean {
  return /^https?:\/\//i.test(String(url || ''));
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
  /** 「跟随出口 IP」的 alarm 名（service-worker 按名字分派） */
  ipSyncAlarmName: string;
  webRtcPolicies: typeof WEBRTC_POLICY_VALUES;
  getSiteConfig(): Promise<SiteSpoofConfig>;
  saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig>;
  /** 让内存快照失效（storage.onChanged 里调用） */
  invalidateStorageCache(): void;
  /** 注入层回报的实际生效字体层（诊断页读取） */
  reportFontLayers(url: string, layers: unknown): void;
  getFontLayers(url: string): { count: number; platform: string; hideCjkFonts: boolean; at: number } | null;
  /** 注入层回报"某个 Worker 没能被包装"（通常是 CSP 拒绝 blob 入口） */
  reportWorkerFallback(url: string, report: Partial<WorkerFallbackReport> | null | undefined): void;
  getWorkerFallbacks(url: string): WorkerFallbackSummary | null;
  /** 导出当前配置，给烘焙构建用 */
  getBakeSnapshot(): Promise<{ config: SiteSpoofConfig; lastLocation: LastLocation | null }>;
  getLastLocation(): Promise<LastLocation | null>;
  getExtensionState(): Promise<{ enabled: boolean; config: SiteSpoofConfig }>;
  setExtensionEnabled(enabled: boolean): Promise<SiteSpoofConfig>;
  updateGeolocation(forceUpdate?: boolean): Promise<{ ok: boolean; location?: LastLocation; unchanged?: boolean; disabled?: boolean; error?: string }>;
  /** 走一遍"跟随出口 IP"：查出口 → 改时区/坐标 → 应用。单飞，重复调用复用同一趟 */
  checkExitIp(options?: { force?: boolean }): Promise<ExitIpSyncOutcome>;
  /** 手动「从 IP 自动配置」：查一次出口，把坐标/时区/语言写进当前配置并应用 */
  applyExitIpNow(): Promise<ExitIpApplyOutcome>;
  /** 配置页只读：上次同步记下的出口 IP 与当前生效定位 */
  getExitIpSyncState(): Promise<{ storedIp: string; lastLocation: LastLocation | null }>;
  /** 让「跟随出口 IP」的 alarm 与当前配置对齐；返回对齐后是否应在运行 */
  ensureIpSyncAlarm(): Promise<boolean>;
  /** 单条注入路径：确保文档里有 runtime，然后投递 payload（两者都幂等） */
  syncTab(tabId: number, url: string, options?: {
    config?: SiteSpoofConfig;
    lastLocation?: LastLocation | null;
    /** 兼容字段；现在按 frame 决策，未命中的 frame 一律 clear（清掉烘焙残留） */
    clearUnmatched?: boolean;
  }): Promise<void>;
  /** 内容脚本上报自己的 documentId：说明该文档已经由注册的内容脚本装过 runtime */
  noteDocumentInjected(documentId?: string): Promise<void>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult>;
  getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & {
    domain: string;
    config: SiteSpoofConfig;
    lastLocation: LastLocation | null;
    workerFallback: WorkerFallbackSummary | null;
  }>;
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

  /**
   * 内存快照。
   *
   * 每次导航、每个 frame 的 payload 都要读一遍配置；`chrome.storage.local.get`
   * 是跨进程 IPC，冷启动时能吃掉几十毫秒 —— 而首屏脚本只等那一下。缓存在 SW 里，
   * 用 `storage.onChanged` 失效，读到的永远和存储一致。
   */
  let snapshotCache: Record<string, any> | null = null;
  let lastLocationCache: { value: LastLocation | null } | null = null;
  /**
   * 缓存代际。冷启动时 `storage.local.get` 很慢，读的过程中用户可能已经保存了新配置
   * 并触发失效 —— 如果慢读返回时无条件写回缓存，接下来的每一次读都会拿到那份旧快照，
   * 表现为"界面上是已保存，实际规则还是旧的"。所以写缓存前必须确认期间没被失效过。
   */
  let cacheGeneration = 0;

  function invalidateStorageCache(): void {
    cacheGeneration += 1;
    snapshotCache = null;
    lastLocationCache = null;
  }

  async function getStorageSnapshot(): Promise<Record<string, any>> {
    if (snapshotCache) return snapshotCache;
    const generation = cacheGeneration;
    const snapshot = await chrome.storage.local.get(null);
    if (generation === cacheGeneration && !snapshotCache) snapshotCache = snapshot;
    return snapshot;
  }

  async function getSiteConfig(): Promise<SiteSpoofConfig> {
    const frozen = frozenBakedConfig();
    if (frozen) return frozen;

    const generation = cacheGeneration;
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

    // 只在"读到的确实是当前存储"时落种子：读的过程中用户已经保存的话，
    // 这次种子写入会把用户配置直接盖掉（丢的不只是 DNR，是整个配置）。
    if (generation === cacheGeneration) {
      await chrome.storage.local.set({ siteSpoofConfig: config });
      // 种子的这次写入也要反映到缓存里，否则接下来每次读都会重新走种子分支
      snapshotCache = { ...data, siteSpoofConfig: config };
    }
    return config;
  }

  async function getLastLocation(): Promise<LastLocation | null> {
    if (lastLocationCache) return lastLocationCache.value;
    const generation = cacheGeneration;
    const data = await chrome.storage.local.get(LAST_LOCATION_KEY);
    const value = (data[LAST_LOCATION_KEY] as LastLocation | undefined) || null;
    if (generation === cacheGeneration) lastLocationCache = { value };
    return value;
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

  /**
   * 上一次应用时的「跟随出口 IP」开关状态。
   *
   * 用途只有一个：识别"关 → 开"的那一次跃变，立刻同步一遍；
   * 不落 storage——它描述的是本进程的内状态，重启后由 bootstrap 负责首同步。
   */
  let lastIpSyncEnabled = false;

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
    const denied: string[] = [];
    for (const domain of getEnabledRuleDomains(config)) {
      const resolved = getEffectiveProfile(config, domain, lastLocation);
      if (resolved.payload && resolved.payload.geolocationDenied) {
        // 坐标解析不出来：权限层也置为 block，getCurrentPosition 返回
        // POSITION_UNAVAILABLE，permissions.query 说 denied，三层说的是同一件事。
        denied.push(domain);
        continue;
      }
      const geolocation = resolved.payload ? resolved.payload.geolocation : null;
      if (!geolocation || geolocation.spoofPermission === false) continue;
      wanted.push(domain);
    }

    const stored = await chrome.storage.local.get([GEO_PERMISSION_KEY, GEO_DENIED_KEY]);
    const previous: string[] = Array.isArray(stored[GEO_PERMISSION_KEY]) ? stored[GEO_PERMISSION_KEY] : [];
    const previousDenied: string[] = Array.isArray(stored[GEO_DENIED_KEY]) ? stored[GEO_DENIED_KEY] : [];

    // 从 allow / block 两个集合里退出、且不再属于任何一侧的域名：清掉设置
    const stale = [...new Set([...previous, ...previousDenied])]
      .filter((domain) => wanted.indexOf(domain) === -1 && denied.indexOf(domain) === -1);
    for (const domain of stale) {
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

    for (const domain of denied) {
      for (const pattern of [`*://${domain}/*`, `*://*.${domain}/*`]) {
        try {
          await settings.set({ primaryPattern: pattern, setting: 'block', scope: 'regular' });
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

    if (previous.join(',') !== wanted.join(',') || previousDenied.join(',') !== denied.join(',')) {
      await chrome.storage.local.set({ [GEO_PERMISSION_KEY]: wanted, [GEO_DENIED_KEY]: denied });
      invalidateStorageCache();
    }
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    await registerSpoofContentScripts(config);
    // 头规则要跟着「当前能不能真的注入」走：定位拿不到时注入侧 fail-closed，
    // 头也不能继续宣告 en-US，否则请求头和页面 JS 自相矛盾。
    await updateAcceptLanguageRules(config, await getLastLocation());
    await applyWebRTCPolicy(config);
    await applyGeolocationPermissions(config);
    // alarm 的存在状态从配置派生：关掉「跟随出口 IP」必须真的 clear，
    // 否则下一轮它还会把刚被关掉的功能跑一遍（而且照样打接口）。
    await ensureIpSyncAlarmFor(config, ipSyncAlarms);
    await refreshActionBadge();
  }

  async function saveSiteConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
    // frozen 包没有桥；写 storage 只会让后台和页面各说各话，直接忽略保存。
    const frozen = frozenBakedConfig();
    if (frozen) return frozen;

    const result = validateConfig(config);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    await chrome.storage.local.set({ siteSpoofConfig: result.config });
    invalidateStorageCache();
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

  /**
   * 烘焙配置快照：给 scripts/build-persona.mjs --config=<file> 用。
   *
   * 非烘焙构建的 payload 走一次异步 IPC 才落地，页面首个内联脚本可能读到原生值；
   * 烘焙构建把它变成 document_start 的同步常量，这个窗口就没有了。
   */
  async function getBakeSnapshot(): Promise<{ config: SiteSpoofConfig; lastLocation: LastLocation | null }> {
    return { config: await getSiteConfig(), lastLocation: await getLastLocation() };
  }

  /**
   * 注入层报上来的"实际生效字体层"。字表只编在注入脚本里，后台算不出来，
   * 所以诊断页的数字必须从这里取。只放内存：重启后页面会重新报一次。
   */
  const fontLayerReports = new Map<string, { count: number; platform: string; hideCjkFonts: boolean; at: number }>();

  function reportFontLayers(url: string, layers: unknown): void {
    const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    if (!hostname || !layers || typeof layers !== 'object') return;
    const value = layers as { count?: unknown; platform?: unknown; hideCjkFonts?: unknown };
    const count = Number(value.count);
    if (!Number.isFinite(count) || count < 0) return;
    fontLayerReports.set(hostname, {
      count,
      platform: value.platform === 'none' ? 'none' : 'auto',
      hideCjkFonts: Boolean(value.hideCjkFonts),
      at: Date.now()
    });
    // 只保留最近 50 个域名，别让这张表无限长
    if (fontLayerReports.size > 50) {
      const oldest = [...fontLayerReports.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) fontLayerReports.delete(oldest[0]);
    }
  }

  function getFontLayers(url: string): { count: number; platform: string; hideCjkFonts: boolean; at: number } | null {
    const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    if (!hostname) return null;
    return fontLayerReports.get(hostname) || null;
  }

  /**
   * Worker 包装失败：按 hostname 聚合，只放内存。
   *
   * 为什么要记：包装只能靠 blob 入口，页面 CSP 的 worker-src / script-src 有权拒绝。
   * 拒绝时 runtime 回退原生，页面照常跑，但那个 Worker 里读到的是原生值 ——
   * 这是"部分覆盖"，不能和"已生效"显示成同一件事。
   *
   * 内存而不是 storage：页面刷新后 runtime 会重新报；Service Worker 重启丢掉旧记录
   * 也无所谓，下一次构造会补上。真正要求的是**别把旧状态当现状**。
   */
  const workerFallbacks = new Map<string, WorkerFallbackSummary>();

  function hostnameOf(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function reportWorkerFallback(url: string, report: Partial<WorkerFallbackReport> | null | undefined): void {
    const hostname = hostnameOf(url);
    if (!hostname || !report || typeof report !== 'object') return;
    const reason = normalizeWorkerFallbackReason(report.reason);
    const entry: WorkerFallbackSummary = workerFallbacks.get(hostname)
      || { hostname, count: 0, reasons: [], lastScript: '', lastMessage: '', at: 0 };
    entry.count += 1;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    if (typeof report.script === 'string' && report.script) entry.lastScript = report.script.slice(0, 300);
    if (typeof report.message === 'string' && report.message) entry.lastMessage = report.message.slice(0, 300);
    entry.at = Date.now();
    workerFallbacks.set(hostname, entry);
    if (workerFallbacks.size > 50) {
      const oldest = [...workerFallbacks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) workerFallbacks.delete(oldest[0]);
    }
  }

  function getWorkerFallbacks(url: string): WorkerFallbackSummary | null {
    const hostname = hostnameOf(url);
    return hostname ? workerFallbacks.get(hostname) || null : null;
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
  async function pushPayload(tabId: number, payload: unknown | null, frameId?: number): Promise<void> {
    try {
      const message = payload === null
        ? { action: 'applyPayload', clear: true }
        : { action: 'applyPayload', payload };
      if (frameId === undefined) {
        await chrome.tabs.sendMessage(tabId, message);
      } else {
        await chrome.tabs.sendMessage(tabId, message, { frameId });
      }
    } catch (error) {
      // 清除指令是广播式的（配置一变就发给所有标签页），没有桥的页面收不到是常态，
      // 不要为它刷一条 warning；真正该关心的 payload 投递失败照旧记录。
      if (payload !== null) {
        console.warn(`VanishGeo could not deliver payload to tab ${tabId}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * 每个 frame 用自己的 URL 解析 payload。
   *
   * about:blank / srcdoc / blob: 没有 hostname，用最近的 http(s) 父 frame 的 URL；
   * 跨域子域用自己的 URL。返回的 frameId 直接交给 tabs.sendMessage，避免父页
   * payload 被广播到独立规则的 iframe。
   */
  async function getFrameTargets(tabId: number, topUrl: string): Promise<Array<{ frameId?: number; url: string }>> {
    const webNavigation = (chrome as any).webNavigation;
    if (!webNavigation || typeof webNavigation.getAllFrames !== 'function') {
      // 没有 webNavigation 权限（或测试替身）时退回不带 frameId 的广播；
      // 桥的 hostname 校验仍会拒绝父页 payload，并自己重拉正确的那一份。
      return [{ url: topUrl }];
    }
    const frames: chrome.webNavigation.GetAllFrameResultDetails[] = (await webNavigation
      .getAllFrames({ tabId })
      .catch(() => [] as chrome.webNavigation.GetAllFrameResultDetails[])) || [];
    if (!frames.length) return [{ url: topUrl }];

    const byId = new Map<number, chrome.webNavigation.GetAllFrameResultDetails>();
    for (const frame of frames) byId.set(frame.frameId, frame);

    const resolveUrl = (frame: chrome.webNavigation.GetAllFrameResultDetails, depth = 0): string => {
      if (isScriptableUrl(frame.url)) return frame.url;
      if (depth < 10 && frame.parentFrameId >= 0) {
        const parent = byId.get(frame.parentFrameId);
        if (parent) return resolveUrl(parent, depth + 1);
      }
      return topUrl;
    };

    return frames.map((frame) => ({ frameId: frame.frameId, url: resolveUrl(frame) }));
  }

  /** 每个标签页最多同时发多少个 frame 消息；IPC 并发太高反而会拖慢浏览器。 */
  const FRAME_SEND_CONCURRENCY = 8;

  async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
    if (!tasks.length) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= tasks.length) return;
        await tasks[index]();
      }
    });
    await Promise.all(workers);
  }

  /** 单标签页同步：装（幂等）+ 按 frame 推 payload（幂等） */
  async function syncTab(tabId: number, url: string, options?: {
    config?: SiteSpoofConfig;
    lastLocation?: LastLocation | null;
    clearUnmatched?: boolean;
  }): Promise<void> {
    // persona 构建：配置已烘焙进 runtime.js，运行时不推 payload
    if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;
    if (!isScriptableUrl(url)) return;
    const config = options?.config || await getSiteConfig();
    const lastLocation = Object.prototype.hasOwnProperty.call(options || {}, 'lastLocation')
      ? options?.lastLocation || null
      : await getLastLocation();

    await ensureRuntimeInDocument(tabId, url);
    const targets = await getFrameTargets(tabId, url);

    // 多个 frame 的解析结果可以复用（about:blank / srcdoc / 同源 iframe 常常
    // 最终落到同一个父 URL），而 tabs.sendMessage 是逐 frame 的 IPC。串行发
    // 在几十个 iframe 的页面上会把配置生效拖到秒级；这里按 URL 去重解析，
    // 再把投递限制在固定并发内。顺序不再重要：每个 frame 只有一条自己的消息。
    const resolvedByUrl = new Map<string, Promise<EffectiveProfileResult>>();
    const jobs = targets.map((target) => async () => {
      let pending = resolvedByUrl.get(target.url);
      if (!pending) {
        pending = buildPayloadForUrl(target.url, config, lastLocation);
        resolvedByUrl.set(target.url, pending);
      }
      const resolved = await pending;
      if (resolved.matched && resolved.payload) {
        await pushPayload(tabId, resolved.payload, target.frameId);
      } else {
        await pushPayload(tabId, null, target.frameId);
      }
    });
    await runWithConcurrency(jobs, FRAME_SEND_CONCURRENCY);
  }

  /** 上一次落地的「域名 → Accept-Language」表；null 表示还没应用过（安装/冷启动首轮不重载） */
  let lastHeaderValues: Map<string, string> | null = null;

  function headerValues(config: SiteSpoofConfig, lastLocation: LastLocation | null): Map<string, string> {
    const map = new Map<string, string>();
    for (const rule of buildAcceptLanguageRules(config, lastLocation)) {
      const value = (rule.action.requestHeaders || [])
        .find((header) => header.header === 'Accept-Language')?.value || '';
      for (const domain of rule.condition.requestDomains || []) map.set(domain, value);
    }
    return map;
  }

  /**
   * 请求头值变化后重载受影响的页面。
   *
   * 背景：改语言必须写 DNR（`updateDynamicRules`），而 Chromium 实测任何一次写入都会把
   * BFCache 页面驱逐出缓存 —— 但那只是"回退时不再命中缓存"，前台页面并不会自己重载：
   * 它的文档仍是用旧 Accept-Language 请求来的，而页面里的 JS 值已经换新，两者当场不一致。
   *
   * 只处理**值变了**的域名（同一个域名前后都在、只是 Accept-Language 变了）。域名的增删
   * 由 `reloadAffectedTabs` 负责，这里再插一手会让同一个标签页被重载两次。
   * 首轮应用（安装 / Service Worker 冷启动）不重载，避免一开浏览器就整片刷新。
   */
  async function reloadTabsForHeaderChange(config: SiteSpoofConfig): Promise<void> {
    const lastLocation = await getLastLocation();
    const next = headerValues(config, lastLocation);
    const previous = lastHeaderValues;
    lastHeaderValues = next;
    if (!previous) return;
    if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;

    const changed = new Set<string>();
    for (const [domain, value] of next) {
      if (previous.has(domain) && previous.get(domain) !== value) changed.add(domain);
    }
    if (changed.size === 0) return;

    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !isScriptableUrl(tab.url)) continue;
      let hostname = '';
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        continue;
      }
      if (![...changed].some((domain) => domainMatches(hostname, domain))) continue;
      try {
        await chrome.tabs.reload(tab.id);
      } catch {
        /* 标签页可能刚被关掉 */
      }
    }
  }

  async function updateAllTabs(
    configOverride?: SiteSpoofConfig,
    lastLocationOverride?: LastLocation | null,
    options?: { clearUnmatched?: boolean }
  ): Promise<void> {
    const config = configOverride || await getSiteConfig();
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !isScriptableUrl(tab.url)) continue;
      // 顶层 URL 未命中也要走 syncTab：它会给所有 frame 发 clear，子域 iframe
      // 的桥再按自己的 URL 重拉。否则「父页不在规则里、iframe 在规则里」的
      // 标签页在定位刷新 / 配置变更时永远收不到更新。
      await syncTab(tab.id, tab.url, {
        config,
        lastLocation,
        clearUnmatched: options?.clearUnmatched
      });
    }
  }

  /**
   * 记一次定位失败：原文进 `lastGeoError`，时间进 `lastGeoErrorAt`。
   *
   * 两个 key 必须**一起**写：配置页要显示"多久之前失败的"，只有原文的字符串
   * 没法回答"这是刚才还是三天前"，用户看到一条陈年错误只会以为又坏了。
   * 故意保持字符串形态（不改成对象）：`tests/injection-idempotency.test.ts` 与
   * 弹窗角标都在读这个值，升级时不该让老配置读出 undefined。
   */
  async function recordGeoError(message: string): Promise<void> {
    await chrome.storage.local.set({ lastGeoError: message, lastGeoErrorAt: new Date().toISOString() });
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
          locationToSet = parseGeoApiResponse(await fetchJson(apiUrl));
          if (locationToSet) break;
          errors.push(`${apiUrl} no valid location`);
        } catch (error) {
          errors.push(`${apiUrl} ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!locationToSet) {
        const message = `IP geolocation APIs returned no valid coordinates: ${errors.join(' | ')}`;
        await recordGeoError(message);
        return { ok: false, error: message };
      }

      if (!forceUpdate && oldLocation && locationToSet.latitude === oldLocation.latitude && locationToSet.longitude === oldLocation.longitude) {
        return { ok: true, location: oldLocation, unchanged: true };
      }

      const nextLocation: LastLocation = { ...locationToSet, updateTime: new Date().toLocaleString() };
      await chrome.storage.local.set({ [LAST_LOCATION_KEY]: nextLocation, lastGeoError: '', lastGeoErrorAt: '' });
      invalidateStorageCache();
      // 坐标从"未解析"变成"已解析"时，权限层要从 block 切回 allow；
      // auto 时区也可能跟着变，请求头一起重算。只调 updateAllTabs 会漏掉这两层。
      // 用 applyLocationEffects 而不是就地重算：它现读配置且排进 applyChain，
      // 不会用进函数时抓到的旧配置盖掉用户在这几秒里的保存。
      await applyLocationEffects();
      return { ok: true, location: nextLocation };
    } catch (error) {
      const message = `background geolocation update failed: ${error instanceof Error ? error.message : String(error)}`;
      await recordGeoError(message);
      return { ok: false, error: message };
    } finally {
      // 定位成功或失败都要重算角标：否则「!」会一直挂到下一次标签事件
      await refreshActionBadge();
    }
  }

  // ---------- 跟随出口 IP ----------

  /**
   * 写 `lastLocation` 但**不**应用副作用。
   *
   * 和 `updateGeolocation` 的分工：那个是"定位层自己更新"，写完自己重算权限/头/标签页；
   * 这里是 IP 同步流水线里的一步 —— 坐标和时区必须**一起换完再统一应用一次**，
   * 否则中间态（新坐标 + 旧时区）会被当成有效配置写进 DNR。
   */
  async function writeLastLocation(location: LastLocation): Promise<void> {
    await chrome.storage.local.set({ [LAST_LOCATION_KEY]: location, lastGeoError: '', lastGeoErrorAt: '' });
    invalidateStorageCache();
  }

  /** 只写配置，不应用（应用由 `checkExitIp` 在两步都写完之后做一次） */
  async function writeSiteConfigOnly(config: SiteSpoofConfig): Promise<void> {
    if (frozenBakedConfig()) return;
    await chrome.storage.local.set({ siteSpoofConfig: config });
    invalidateStorageCache();
  }

  async function readStoredExitIp(): Promise<string> {
    const data = await chrome.storage.local.get(LAST_SYNCED_IP_KEY);
    const value = data[LAST_SYNCED_IP_KEY];
    return typeof value === 'string' ? value : '';
  }

  async function getExitIpSyncState(): Promise<{ storedIp: string; lastLocation: LastLocation | null }> {
    return { storedIp: await readStoredExitIp(), lastLocation: await getLastLocation() };
  }

  async function checkExitIp(options: { force?: boolean } = {}): Promise<ExitIpSyncOutcome> {
    const outcome = await runExitIpSync({
      getConfig: getSiteConfig,
      saveConfig: writeSiteConfigOnly,
      saveLocation: writeLastLocation,
      getLastLocation,
      getStoredIp: readStoredExitIp,
      saveStoredIp: async (ip: string) => {
        await chrome.storage.local.set({ [LAST_SYNCED_IP_KEY]: ip });
      },
      applyNow: () => applyConfig(),
      force: options.force
    });
    // 角标上的「!」取决于"配置是否自洽"；IP 同步可能刚把矛盾修掉
    await refreshActionBadge();
    return outcome;
  }

  /**
   * 手动「从 IP 自动配置」：查出口 → 把坐标/时区/语言**写进当前配置** → 应用。
   *
   * 为什么不再复用 `updateGeolocation`：那个只写 `lastLocation`，配置是 manual
   * 时解析层根本不看它，点完按钮界面上一个数字都不会变（这就是"按钮没反应"）。
   * 这里直接落配置，点完表单立刻是新值，无需理解 auto/manual 的区别。
   *
   * 与 `checkExitIp` 的边界：不清 `lastSyncedExitIp` —— 那是自动同步的账本，
   * 手点一次不该让自动同步误判成"出口没变"。
   */
  async function applyExitIpNow(): Promise<ExitIpApplyOutcome> {
    if (frozenBakedConfig()) {
      return { ok: false, frozen: true, error: '当前是烘焙（只读）构建：配置烘焙在构建产物里，改不了' };
    }
    try {
      // 先查出口再读配置：查 IP 要几秒，期间用户可能刚保存过，用查之前的快照
      // 去 plan 会把那次保存直接覆盖掉（写回旧的语言/时区/白名单）
      const looked = await lookupExitIp();
      if ('error' in looked) {
        await recordGeoError(looked.error);
        return { ok: false, error: looked.error };
      }
      const config = await getSiteConfig();
      const plan = planExitIpApply(config, looked.info);
      await writeLastLocation(plan.location);
      await writeSiteConfigOnly(plan.config);
      await applyConfig(plan.config);
      await refreshActionBadge();
      return {
        ok: true,
        changed: plan.layers.length > 0,
        layers: plan.layers,
        ip: looked.info.ip,
        country: plan.config.globalProfile.geolocation.country,
        timezone: plan.config.globalProfile.timezone.timezone,
        latitude: plan.config.globalProfile.geolocation.latitude as number,
        longitude: plan.config.globalProfile.geolocation.longitude as number,
        language: plan.config.globalProfile.language.language
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordGeoError(message).catch(() => undefined);
      return { ok: false, error: message };
    }
  }

  // 测试与部分受限构建里可能没有 `chrome.alarms`：这种情况下把「对齐 alarm」
  // 退化成空操作，而不是让整条 applyConfig 链在副作用阶段炸掉。
  const alarmsApi = () => (typeof chrome !== 'undefined' ? chrome.alarms : undefined);

  const ipSyncAlarms: IpSyncAlarmGateway = {
    get: async (name: string) => {
      const api = alarmsApi();
      return api ? api.get(name) : undefined;
    },
    create: async (name: string, info: { periodInMinutes: number }) => {
      const api = alarmsApi();
      if (api) await api.create(name, info);
    },
    clear: async (name: string) => {
      const api = alarmsApi();
      if (api) await api.clear(name);
    }
  };

  async function ensureIpSyncAlarm(): Promise<boolean> {
    return ensureIpSyncAlarmFor(await getSiteConfig(), ipSyncAlarms);
  }

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult> {
    return buildPayloadForUrl(url);
  }

  async function getCurrentTabState(tab?: chrome.tabs.Tab): Promise<EffectiveProfileResult & {
    domain: string;
    config: SiteSpoofConfig;
    lastLocation: LastLocation | null;
    workerFallback: WorkerFallbackSummary | null;
  }> {
    const config = await getSiteConfig();
    const lastLocation = await getLastLocation();
    const domain = tab?.url ? normalizeDomain(tab.url) : '';
    const resolved = domain
      ? getEffectiveProfile(config, domain, lastLocation)
      : { matched: false, rule: null, payload: null, errors: [] };
    // 按标签页 hostname 取，不按规则 domain：子域和父域是两份独立记录
    const workerFallback = getWorkerFallbacks(tab?.url || '');
    return { domain, config, lastLocation, workerFallback, ...resolved };
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
    // frozen 包没有桥，也没有可写的运行时配置；改规则只会白重载页面。
    const frozen = frozenBakedConfig();
    if (frozen) return frozen;
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
    const frozen = frozenBakedConfig();
    if (frozen) return frozen;
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
    // 不传快照：让 applyConfig 在执行时自己读 storage。
    // 冷启动读出配置到真正应用之间可能隔了几十毫秒，用户完全可能在这段时间里保存 ——
    // 实测 2/3 次会把用户配置盖回默认值（DNR 与 payload 全是旧的，界面却显示已保存）。
    // 走 applyConfig 而不是直接调副作用：SW 重启后要顺手把 payload 补推给
    // 会话恢复出来的标签页（这些文档可能是在注册生效之前就存在的）。
    await applyConfig();
    // 「跟随出口 IP」要在启动时就对齐一次：alarm 的首次触发可能还在几分钟之后，
    // 期间用户看到的会是上一次会话留下的旧出口画像。
    //
    // 跟随时只打一轮接口：`checkExitIp` 自己就会查归属地并写 lastLocation（与
    // `updateGeolocation` 用的是同一组接口）。两边各查一次的话，离线时启动要顺序
    // 等两轮超时（2 × 3 家 × 5s），而第二轮注定拿不到新东西。
    if (isIpSyncEnabled(await getSiteConfig())) {
      await checkExitIp();
      if (!(await getLastLocation())) {
        // IP 接口全挂时 ip-sync 不会写 lastLocation：退回常规定位，至少别让坐标空着
        await updateGeolocation(false);
      }
    } else {
      await updateGeolocation(false);
    }
  }

  /**
   * 配置变化：只重算副作用（内容脚本 / 头规则 / WebRTC / 定位授权 / 角标 / 已开标签页），
   * **不触发 IP 定位**。出口坐标的变化只由 alarm 与手动「重试定位」驱动。
   *
   * 保存路径 (`saveSiteConfig`) 和 `storage.onChanged` 都会调到这里，
   * 靠签名去重保证一次写入只应用一次。
   */
  /**
   * 应用链：同一时刻只跑一次应用。
   *
   * 并发应用会各写一半副作用（DNR、内容脚本、payload），而且 `lastAppliedSignature`
   * 记录的是"最后完成的那个"，可能和 storage 里的配置不是同一份。
   */
  let applyChain: Promise<void> = Promise.resolve();

  function applyConfig(configOverride?: SiteSpoofConfig): Promise<void> {
    const run = () => applyConfigNow(configOverride);
    const next = applyChain.then(run, run);
    // 链本身不携带失败：一次应用失败不能把后面的应用永久挡住
    applyChain = next.then(() => undefined, () => undefined);
    return next;
  }

  /**
   * 定位写完之后的重算：权限层 / 请求头 / 已开标签页。
   *
   * 必须用**此刻**的配置，而且排进 applyChain。`updateGeolocation` 读配置是在打
   * IP 接口**之前**，那一步可能花掉几秒，用户完全可能在这段时间里保存 —— 拿进函数
   * 时抓到的旧配置重算，等于把 DNR 规则和页内 payload 一起写回旧值：存储里是新配置、
   * 界面显示"已保存"，而浏览器实际发出的请求头还是旧的。
   *
   * 这条竞态是 CI 上的 cold-save 冒烟逮到的（3 轮里 2 轮 DNR 停在默认值），本机
   * 一次都不复现 —— 本机 IP 接口回得快，重算总是发生在保存之前。
   */
  function applyLocationEffects(): Promise<void> {
    const run = async () => {
      const config = frozenBakedConfig() || normalizeConfig(await getSiteConfig());
      const location = await getLastLocation();
      await applyGeolocationPermissions(config);
      await updateAcceptLanguageRules(config, location);
      await updateAllTabs(config, location);
      // 这一次也算"应用过完整状态"：不同步去重基准，下一次同配置的 applyConfig
      // 会以为还没应用过，白白再写一遍 DNR（写一次就驱逐一次 BFCache）
      lastAppliedSignature = JSON.stringify(config);
    };
    const next = applyChain.then(run, run);
    applyChain = next.then(() => undefined, () => undefined);
    return next;
  }

  async function applyConfigNow(configOverride?: SiteSpoofConfig): Promise<void> {
    const config = frozenBakedConfig() || normalizeConfig(configOverride || await getSiteConfig());
    const signature = JSON.stringify(config);
    if (signature === lastAppliedSignature) return;

    await applyRuntimeSideEffects(config);
    // 请求头变了就意味着已打开页面的文档是"旧头"加载的：JS 值已经换新，但文档本身
    // 仍然是旧 Accept-Language 的产物。重载受影响的页面，让文档与值重新对齐。
    // 只改时区/定位不碰头规则，这时重载纯属打扰，所以按内容签名判断。
    await reloadTabsForHeaderChange(config);
    // clearUnmatched：排除站点、关总开关都要主动清掉已开页面上的烘焙值
    await updateAllTabs(config, undefined, { clearUnmatched: true });
    // 只在成功之后记账：中途失败（DNR / 权限被策略锁住）时下一次还能重试，
    // 不会因为"记成已应用"而永久停在半应用状态。
    lastAppliedSignature = signature;
    // 开关从关到开：不等下一个 alarm 周期，立刻对齐一次出口画像。
    const ipSyncEnabled = isIpSyncEnabled(config);
    if (ipSyncEnabled && !lastIpSyncEnabled) {
      lastIpSyncEnabled = true;
      // 不 await：这里在保存路径上，用户点完开关就该拿到响应；
      // 单飞保证它和 alarm / bootstrap 撞上时只打一次接口。
      void checkExitIp().catch(() => undefined);
    } else if (!ipSyncEnabled) {
      lastIpSyncEnabled = false;
    }
  }

  async function noteDocumentInjected(documentId?: string): Promise<void> {
    if (!documentId) return;
    await markDocumentInjected(documentId);
  }

  return {
    alarmName: ALARM_NAME,
    ipSyncAlarmName: IP_SYNC_ALARM_NAME,
    webRtcPolicies: WEBRTC_POLICY_VALUES,
    getSiteConfig,
    saveSiteConfig,
    invalidateStorageCache,
    getBakeSnapshot,
    reportFontLayers,
    getFontLayers,
    reportWorkerFallback,
    getWorkerFallbacks,
    getLastLocation,
    getExtensionState,
    setExtensionEnabled,
    updateGeolocation,
    checkExitIp,
    applyExitIpNow,
    getExitIpSyncState,
    ensureIpSyncAlarm,
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
