import { buildAcceptLanguageRules, updateAcceptLanguageRules } from './dnr';
import { createFrameRuleResolver, discoverOpaqueDocuments, type FrameRuleResolver, type FrameContextResolver } from './blob-frames';
import { GEO_API_URLS, fetchJson, parseGeoApiResponse } from './geo-api';
import { IP_SYNC_ALARM_NAME, LAST_SYNCED_IP_KEY, ensureIpSyncAlarmFor, isIpSyncEnabled, lookupExitIp, planExitIpApply, runExitIpSync } from './ip-sync';
import type { ExitIpApplyOutcome, ExitIpSyncOutcome, IpSyncAlarmGateway } from './ip-sync';
import { WEBRTC_POLICY_VALUES, applyWebRTCPolicy, readWebRTCPolicy } from './webrtc';
import { bakedContentScriptDomains, registerSpoofContentScripts } from './content-scripts';
import { chromeMajorVersion, removeUserScript, syncUserScript, userScriptToken as userScriptToken_, userScriptsAvailable } from './user-scripts';
import { createDiagnosticReports } from './diagnostic-reports';
import {
  LAST_LOCATION_KEY,
  domainMatches,
  getEffectiveProfile,
  getCarveOutDomains,
  getEnabledRuleDomains,
  migrateLegacyConfig,
  validateConfig
} from '../shared/config-resolver';
import { createRule, normalizeConfig, normalizeDomain, normalizeWebRtc } from '../shared/config-model';
import { describeSiteStatus } from '../shared/site-status';
import type { WorkerFallbackReport, WorkerFallbackSummary } from '../shared/worker-coverage';
import type { EffectiveProfileResult, LastLocation, SiteSpoofConfig } from '../shared/types';

const ALARM_NAME = 'vanishgeo-update-location';
const GEO_PERMISSION_KEY = 'geoPermissionDomains';
const GEO_DENIED_KEY = 'geoDeniedDomains';
const GEO_ASK_KEY = 'geoAskDomains';
/** contentSettings 里 location 允许的三种取值，账本按这个维度记录 */
type GeoPermissionSetting = 'allow' | 'block' | 'ask';

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
  resolveFrameRuleUrl: FrameRuleResolver;
  resolveFrameRuleContext: FrameContextResolver;
  forgetFrameTab(tabId: number): Promise<void>;
  alarmName: string;
  /** 「跟随出口 IP」的 alarm 名（service-worker 按名字分派） */
  ipSyncAlarmName: string;
  webRtcPolicies: typeof WEBRTC_POLICY_VALUES;
  /** 浏览器里 WebRTC 策略的实际值与控制权（写入不一定生效） */
  readWebRtcPolicy(): Promise<{ value: string; levelOfControl: string } | null>;
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
  /** 把 payload 投递给标签页里已由注册内容脚本装好的桥；不注入任何脚本 */
  syncTab(tabId: number, url: string, options?: {
    config?: SiteSpoofConfig;
    lastLocation?: LastLocation | null;
  }): Promise<void>;
  getPayloadForUrl(url: string): Promise<EffectiveProfileResult & { userScriptToken?: string | null }>;
  /** 首屏注入方式（界面提示用）：先按当前开关状态重新对齐一次，再报告 */
  getFirstScreenStatus(): Promise<FirstScreenStatus>;
  /** 按当前开关状态注册 / 更新 / 撤销用户脚本（定时任务调用，不推标签页） */
  refreshFirstScreen(): Promise<void>;
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

/**
 * 首屏注入方式：
 * - baked：烘焙构建，配置编进注入层，本来就首屏生效
 * - userScripts：用户脚本承载配置，首屏生效（见 user-scripts.ts）
 * - contentScripts：「允许用户脚本」没开，配置在页面开始运行后异步送到
 * - unsupported：浏览器低于 Chrome 120，没有 userScripts
 */
export interface FirstScreenStatus {
  mode: 'baked' | 'userScripts' | 'contentScripts' | 'unsupported';
  chromeMajor: number | null;
  extensionId: string;
}

export function createBackgroundServices(): BackgroundServices {
  const frameRules = createFrameRuleResolver();
  const resolveFrameRuleUrl = frameRules.resolve;

  /**
   * 内存快照。
   *
   * 每次导航、每个 frame 的 payload 都要读一遍配置；`chrome.storage.local.get`
   * 是跨进程 IPC，冷启动时能吃掉几十毫秒 —— 而首屏脚本只等那一下。缓存在 SW 里，
   * 用 `storage.onChanged` 失效，读到的永远和存储一致。
   */
  let snapshotCache: Record<string, any> | null = null;
  /**
   * 缓存代际。冷启动时 `storage.local.get` 很慢，读的过程中用户可能已经保存了新配置
   * 并触发失效 —— 如果慢读返回时无条件写回缓存，接下来的每一次读都会拿到那份旧快照，
   * 表现为"界面上是已保存，实际规则还是旧的"。所以写缓存前必须确认期间没被失效过。
   */
  let cacheGeneration = 0;

  function invalidateStorageCache(): void {
    cacheGeneration += 1;
    snapshotCache = null;
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
      // 与其他写入统一失效；等待期间定位可能已变化，不能回填旧快照。
      invalidateStorageCache();
    }
    return config;
  }

  async function getLastLocation(): Promise<LastLocation | null> {
    const data = await getStorageSnapshot();
    return (data[LAST_LOCATION_KEY] as LastLocation | undefined) || null;
  }

  /** 上一次真正应用过的配置签名：保存路径与 storage 事件都会走到 applyConfig */
  let lastAppliedSignature = '';
  /** 当前是否注册了带配置的用户脚本（见 syncFirstScreen） */
  let userScriptMode = false;

  /** 应用签名：「允许用户脚本」开关的变化由 refreshFirstScreen 单独对齐，不进签名，免得触发整轮应用 */
  function signatureOf(config: SiteSpoofConfig): string {
    return JSON.stringify(config);
  }

  /**
   * 用户脚本里嵌着配置与出口坐标，两者任一变化都要重新注册。失败时撤掉旧脚本：
   * 留着旧快照的脚本会让新打开的页面首屏先用旧配置。内容脚本那份注入层始终在，
   * 撤掉后自动回到普通模式。
   */
  async function syncFirstScreen(config: SiteSpoofConfig, location: LastLocation | null): Promise<void> {
    try {
      userScriptMode = await syncUserScript(config, location, bakedContentScriptDomains());
    } catch (error) {
      userScriptMode = false;
      console.warn('VanishGeo could not register the first-screen user script:', error instanceof Error ? error.message : String(error));
      await removeUserScript().catch(() => undefined);
    }
  }

  /**
   * 「允许用户脚本」开关变化时后台收不到通知：定时任务与弹窗查询时调这里，只按当前配置
   * 注册 / 更新 / 撤销用户脚本，不推标签页、不写 DNR —— 开着时顺便把关着期间改过的配置补进去。
   * 开关关着时什么都做不了（API 不可用），旧脚本保留，打开后的第一次对齐会更新它。
   */
  async function refreshFirstScreen(): Promise<void> {
    if (!userScriptsAvailable()) {
      userScriptMode = false;
      return;
    }
    const config = frozenBakedConfig() || normalizeConfig(await getSiteConfig());
    await syncFirstScreen(config, await getLastLocation());
  }

  /**
   * 认领口令只能用在"即使带不上也不会出错"的地方：总开关关闭的清除必须送达，带不上口令时
   * 内容脚本那份自己处理（没有补丁可清）。payload 下发不用它 —— 那里读不到口令就报错重试，
   * 带着空口令下发会让内容脚本那份误判"没有用户脚本"而与之各打一份补丁。
   */
  async function tokenForPage(): Promise<string | null> {
    try {
      return await userScriptToken_();
    } catch {
      return null;
    }
  }

  /**
   * 上一次应用时的「跟随出口 IP」开关状态。
   *
   * 用途只有一个：识别"关 → 开"的那一次跃变，立刻同步一遍；
   * 不落 storage——它描述的是本进程的内状态，重启后由 bootstrap 负责首同步。
   */
  let lastIpSyncEnabled = false;

  /**
   * 用 contentSettings 把匹配域名的定位权限置为 allow。
   *
   * 这样页面里 navigator.permissions.query({name:'geolocation'}) 拿到的是真实 PermissionStatus，
   * 不需要在 JS 层伪造一个 `[object Object]` —— 伪造对象本身就是最容易被识别的痕迹之一。
   *
   * 写法受限于 Chrome 的 API 契约：`ContentSetting.clear()` 只接受 `{ scope }`，
   * **没有**"按 pattern 删一条"的能力
   * （https://developer.chrome.com/docs/extensions/reference/api/contentSettings）。
   * 所以这里分两条路径：
   *   - 只新增/改值：逐 pattern `set()`，不碰其它条目；
   *   - 有域名必须撤销：`clear({ scope: 'regular' })` 整组清空后按期望状态重建。
   * 早先代码把 `primaryPattern` 传给 `clear()`，Chrome 会拒绝这个参数，而异常被吞掉、
   * 账本却照样更新 —— 结果是"补丁清了、授权还在、账本说已经删了"。
   */
  async function applyGeolocationPermissions(config: SiteSpoofConfig): Promise<void> {
    // 注意是 location 而不是 geolocation（chrome.contentSettings 的类型名）
    const settings = chrome.contentSettings && (chrome.contentSettings as any).location;
    if (!settings) return;

    // 期望状态：域名 → setting。三层各自生成，靠 contentSettings 的
    // "最具体 pattern 优先" 合起来：被挖掉的中间子域是 ask，深层重新启用的域名
    // 有自己的 allow/block，父域的通配规则不会把它盖掉。
    const desired = new Map<string, GeoPermissionSetting>();
    if (config.masterEnabled) {
      const lastLocation = await getLastLocation();
      for (const domain of getEnabledRuleDomains(config)) {
        const resolved = getEffectiveProfile(config, domain, lastLocation);
        if (resolved.payload && resolved.payload.geolocationDenied) {
          // 坐标解析不出来：权限层也置为 block，getCurrentPosition 返回
          // POSITION_UNAVAILABLE，permissions.query 说 denied，三层说的是同一件事。
          desired.set(domain, 'block');
          continue;
        }
        const geolocation = resolved.payload ? resolved.payload.geolocation : null;
        if (!geolocation || geolocation.spoofPermission === false) continue;
        desired.set(domain, 'allow');
      }
      // 被排除的域名退回 ask，让"排除"在权限层也成立 —— 否则页面拿到的是
      // 真实定位（父域授权还在），而不是"没有定位"。
      for (const domain of getCarveOutDomains(config)) {
        if (!desired.has(domain)) desired.set(domain, 'ask');
      }
    }

    const stored = await chrome.storage.local.get([GEO_PERMISSION_KEY, GEO_DENIED_KEY, GEO_ASK_KEY]);
    // 账本快照：上一次**确实写成功**的状态。三个旧 key 都是数组，读的时候合并成一张表。
    const previous = new Map<string, GeoPermissionSetting>();
    const ledgerSources: Array<[string, GeoPermissionSetting]> = [
      [GEO_PERMISSION_KEY, 'allow'],
      [GEO_DENIED_KEY, 'block'],
      [GEO_ASK_KEY, 'ask']
    ];
    for (const [key, setting] of ledgerSources) {
      const list = stored[key];
      if (!Array.isArray(list)) continue;
      for (const domain of list) if (typeof domain === 'string' && domain) previous.set(domain, setting);
    }

    const changed = [...desired.entries()].filter(([domain, setting]) => previous.get(domain) !== setting);
    const removed = [...previous.keys()].filter((domain) => !desired.has(domain));
    if (!changed.length && !removed.length) return;

    const patternsFor = (domain: string): string[] => [`*://${domain}/*`, `*://*.${domain}/*`];

    // 只要有一条要撤销，就只能整组清空重建：API 没有"删一条"的能力。
    // 代价是一次短暂的默认值窗口（页面此刻问权限会拿到默认值），换来的是
    // 绝不会留下"删不掉的旧授权 + 账本说已经删了"这种自欺状态。
    const rebuild = removed.length > 0;
    if (rebuild) {
      try {
        await settings.clear({ scope: 'regular' });
      } catch {
        // 连清空都失败：账本一字节都不动，下次配置变化时重试
        return;
      }
    }

    const written = new Map<string, GeoPermissionSetting>();
    const targets = rebuild ? [...desired.entries()] : changed;
    for (const [domain, setting] of targets) {
      let ok = true;
      for (const pattern of patternsFor(domain)) {
        try {
          await settings.set({ primaryPattern: pattern, setting, scope: 'regular' });
        } catch {
          ok = false;
        }
      }
      // 只把真的写成功的域名记进账本：失败的下次还会被 changed 认出来重试
      if (ok) written.set(domain, setting);
    }

    // rebuild 之后浏览器里只剩 written；增量路径下 previous 里其它条目仍然成立
    const ledger = rebuild ? written : new Map([...previous, ...written]);
    const collect = (setting: GeoPermissionSetting): string[] => [...ledger.entries()]
      .filter(([, value]) => value === setting)
      .map(([domain]) => domain)
      .sort();

    await chrome.storage.local.set({
      [GEO_PERMISSION_KEY]: collect('allow'),
      [GEO_DENIED_KEY]: collect('block'),
      [GEO_ASK_KEY]: collect('ask')
    });
    invalidateStorageCache();
  }

  async function applyRuntimeSideEffects(config: SiteSpoofConfig): Promise<void> {
    await registerSpoofContentScripts(config);
    await syncFirstScreen(config, await getLastLocation());
    // 语言与定位独立，头规则只消费语言配置。
    await updateAcceptLanguageRules(config);
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

  const diagnostics = createDiagnosticReports();

  async function buildPayloadForUrl(url: string, configOverride?: SiteSpoofConfig, lastLocationOverride?: LastLocation | null): Promise<EffectiveProfileResult> {
    const hostname = url ? new URL(url).hostname : '';
    const config = configOverride || await getSiteConfig();
    const lastLocation = lastLocationOverride !== undefined ? lastLocationOverride : await getLastLocation();
    return getEffectiveProfile(config, hostname, lastLocation);
  }

  /**
   * 推 payload 给指定标签页的所有 frame；没有桥的文档静默落空。
   *
   * 走 `tabs.sendMessage` 交给 ISOLATED 桥，由桥转进 document_start 同步握手得到的
   * 私有 MessagePort。runtime 只由注册的内容脚本在 document_start 装上：扩展装载前
   * 已打开的标签页（冷标签页）不再晚注入 —— 晚注入时页面脚本已在运行，同步握手的
   * 前提不成立，实测页面可借晚注入的 runtime 改写或清除伪装。冷标签页刷新后生效。
   */
  async function pushPayload(tabId: number, payload: unknown | null, frameId?: number, documentId?: string): Promise<void> {
    try {
      // 读不到口令就不推：桥会自己拉取，拉取路径读不到口令会报错重试
      const userScriptToken = await userScriptToken_();
      const message = payload === null
        ? { action: 'applyPayload', clear: true, userScriptToken }
        : { action: 'applyPayload', payload, userScriptToken };
      if (frameId === undefined) {
        await chrome.tabs.sendMessage(tabId, message);
      } else {
        await chrome.tabs.sendMessage(tabId, message, { frameId, ...(documentId ? { documentId } : {}) });
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
  async function getFrameTargets(tabId: number, topUrl: string): Promise<Array<{ frameId?: number; documentId?: string; url: string | null }>> {
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

    const discovered = await discoverOpaqueDocuments(tabId).catch((error) => {
      console.warn('VanishGeo could not enumerate opaque documents:', error instanceof Error ? error.message : String(error));
      return [];
    });
    const known = frameRules.knownDocuments(tabId, frames.find((frame) => frame.frameId === 0)?.documentId);
    const documents = [...frames, ...discovered.filter((doc) => !frames.some((frame) => frame.frameId === doc.frameId))];
    for (const doc of known) {
      // 新导航快照优先；快照缺失时保留同 frame 的不同 documentId，不能让旧项遮住新项。
      if (!frames.some((frame) => frame.frameId === doc.frameId)
        && !documents.some((frame) => frame.frameId === doc.frameId && frame.documentId === doc.documentId)) documents.push(doc);
    }
    const targets: Array<{ frameId: number; documentId: string; url: string | null }> = [];
    await runWithConcurrency(documents.map((doc) => async () => {
      let url: string | null = null;
      try { url = await resolveFrameRuleUrl(tabId, doc.frameId, doc.documentId, doc.url, frames); }
      catch (error) { console.warn('VanishGeo could not resolve frame rules:', error instanceof Error ? error.message : String(error)); }
      targets.push({ frameId: doc.frameId, documentId: doc.documentId, url });
    }), FRAME_SEND_CONCURRENCY);
    return targets;
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

  /** 单标签页同步：按 frame 推 payload（幂等），不注入脚本 */
  async function syncTab(tabId: number, url: string, options?: {
    config?: SiteSpoofConfig;
    lastLocation?: LastLocation | null;
  }): Promise<void> {
    // persona 构建：配置已烘焙进 runtime.js，运行时不推 payload
    if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;
    if (!isScriptableUrl(url)) return;
    const config = options?.config || await getSiteConfig();
    const lastLocation = Object.prototype.hasOwnProperty.call(options || {}, 'lastLocation')
      ? options?.lastLocation || null
      : await getLastLocation();

    if (config.masterEnabled === false) {
      // 总关适用于所有文档：119 连脚本枚举也可能漏 blob，不能依赖发现列表清除。
      try { await chrome.tabs.sendMessage(tabId, { action: 'applyPayload', clear: true, globalDisabled: true, userScriptToken: await tokenForPage() }); }
      catch { /* 没有内容脚本的标签页无需清除。 */ }
      return;
    }
    const targets = await getFrameTargets(tabId, url);

    // 多个 frame 的解析结果可以复用（about:blank / srcdoc / 同源 iframe 常常
    // 最终落到同一个父 URL），而 tabs.sendMessage 是逐 frame 的 IPC。串行发
    // 在几十个 iframe 的页面上会把配置生效拖到秒级；这里按 URL 去重解析，
    // 再把投递限制在固定并发内。顺序不再重要：每个 frame 只有一条自己的消息。
    const resolvedByUrl = new Map<string, Promise<EffectiveProfileResult>>();
    const jobs = targets.map((target) => async () => {
      if (target.url === null) {
        try {
          await chrome.tabs.sendMessage(tabId, { action: 'refreshPayload' }, target.documentId
            ? { frameId: target.frameId, documentId: target.documentId } : {});
        } catch { /* 已导航或没有内容脚本的文档不再接收；不重定向给新文档。 */ }
        return;
      }
      let pending = resolvedByUrl.get(target.url);
      if (!pending) {
        pending = buildPayloadForUrl(target.url, config, lastLocation);
        resolvedByUrl.set(target.url, pending);
      }
      const resolved = await pending;
      if (resolved.matched && resolved.payload) {
        await pushPayload(tabId, resolved.payload, target.frameId, target.documentId);
      } else {
        await pushPayload(tabId, null, target.frameId, target.documentId);
      }
    });
    await runWithConcurrency(jobs, FRAME_SEND_CONCURRENCY);
    // 119 和 BFCache 恢复后的枚举可能漏项；提示活动 opaque 自报浏览器 sender 并重拉。
    // 不广播父页 payload，不把发现缓存或 session 中的历史身份当作当前目标清单。
    try { await chrome.tabs.sendMessage(tabId, { action: 'refreshPayload', opaqueOnly: true }); }
    catch { /* 没有活动内容脚本的标签页无需重拉。 */ }
  }

  /** 上一次落地的「域名 → Accept-Language」表；null 表示还没应用过（安装/冷启动首轮不重载） */
  let lastHeaderValues: Map<string, string> | null = null;

  function headerValues(config: SiteSpoofConfig): Map<string, string> {
    const map = new Map<string, string>();
    for (const rule of buildAcceptLanguageRules(config)) {
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
    const next = headerValues(config);
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
    lastLocationOverride?: LastLocation | null
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
        lastLocation
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
      await writeLastLocation(nextLocation);
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
   * 坐标写入的唯一入口：成功时成对清空错误，再让快照失效，不应用副作用。
   *
   * `updateGeolocation` 写完自己重算权限/头/标签页；IP 同步则在坐标和时区
   * **一起换完后统一应用一次**，
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

  async function getPayloadForUrl(url: string): Promise<EffectiveProfileResult & { userScriptToken?: string | null }> {
    return { ...(await buildPayloadForUrl(url)), userScriptToken: await userScriptToken_() };
  }

  async function getFirstScreenStatus(): Promise<FirstScreenStatus> {
    // 后台收不到开关变化的通知：用户回到弹窗时顺手对齐一次
    await refreshFirstScreen();
    const chromeMajor = chromeMajorVersion();
    const baked = bakedContentScriptDomains().length > 0 || (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__);
    const mode: FirstScreenStatus['mode'] = baked
      ? 'baked'
      : chromeMajor !== null && chromeMajor < 120
        ? 'unsupported'
        : userScriptMode ? 'userScripts' : 'contentScripts';
    return { mode, chromeMajor, extensionId: chrome.runtime.id };
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
    const workerFallback = diagnostics.getWorkerFallbacks(tab?.url || '');
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
  async function setDomainRuleEnabled(domain: string, enabled: boolean): Promise<SiteSpoofConfig> {
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
    return setDomainRuleEnabled(domain, true);
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
      await syncFirstScreen(config, location);
      await applyGeolocationPermissions(config);
      await updateAcceptLanguageRules(config);
      await updateAllTabs(config, location);
      // 这一次也算"应用过完整状态"：不同步去重基准，下一次同配置的 applyConfig
      // 会以为还没应用过，白白再写一遍 DNR（写一次就驱逐一次 BFCache）
      lastAppliedSignature = signatureOf(config);
    };
    const next = applyChain.then(run, run);
    applyChain = next.then(() => undefined, () => undefined);
    return next;
  }

  async function applyConfigNow(configOverride?: SiteSpoofConfig): Promise<void> {
    const config = frozenBakedConfig() || normalizeConfig(configOverride || await getSiteConfig());
    const signature = signatureOf(config);
    if (signature === lastAppliedSignature) return;

    await applyRuntimeSideEffects(config);
    // 请求头变了就意味着已打开页面的文档是"旧头"加载的：JS 值已经换新，但文档本身
    // 仍然是旧 Accept-Language 的产物。重载受影响的页面，让文档与值重新对齐。
    // 只改时区/定位不碰头规则，这时重载纯属打扰，所以按内容签名判断。
    await reloadTabsForHeaderChange(config);
    // syncTab 按 frame 决策，排除站点、关总开关都主动清掉页面上的烘焙值。
    await updateAllTabs(config);
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

  return {
    resolveFrameRuleUrl,
    resolveFrameRuleContext: frameRules.resolveForContent,
    forgetFrameTab: frameRules.forgetTab,
    alarmName: ALARM_NAME,
    ipSyncAlarmName: IP_SYNC_ALARM_NAME,
    webRtcPolicies: WEBRTC_POLICY_VALUES,
    readWebRtcPolicy: readWebRTCPolicy,
    getSiteConfig,
    saveSiteConfig,
    invalidateStorageCache,
    getBakeSnapshot,
    ...diagnostics,
    getLastLocation,
    getExtensionState,
    setExtensionEnabled,
    updateGeolocation,
    checkExitIp,
    applyExitIpNow,
    getExitIpSyncState,
    ensureIpSyncAlarm,
    syncTab,
    getPayloadForUrl,
    getFirstScreenStatus,
    refreshFirstScreen,
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
