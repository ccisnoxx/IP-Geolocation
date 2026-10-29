import {
  IP_SYNC_MAX_INTERVAL_MINUTES,
  IP_SYNC_MIN_INTERVAL_MINUTES,
  normalizeConfig,
  normalizeIpSync,
  normalizeLanguage
} from '../shared/config-model';
import { GEO_API_URLS, fetchJson, parseGeoApiResponse } from './geo-api';
import type { LanguageConfig, LastLocation, SiteSpoofConfig } from '../shared/types';

/**
 * 跟随出口 IP。
 *
 * 为什么和 `services.updateGeolocation` 不是同一件事：
 * 那个是"定位层"——只把出口坐标写进 `lastLocation`，供 auto 模式消费；
 * 这个是"画像层"——出口 IP 真的换了之后，把时区/坐标一起对齐到新出口，
 * 免得出现「坐标在东京、时区还是 America/New_York」这种一眼可查的矛盾。
 *
 * 三条硬规则：
 * 1. **语言不跟着走**（除非显式打开 `syncLanguage`）。语言是最稳的一层画像，
 *    跟着 IP 换只会在"中途换了代理"时制造自相矛盾。
 * 2. **失败不推进 `lastSyncedExitIp`**。接口挂了就保持现状，下一轮重试；
 *    推进了就会永远停在"已经同步过"的假状态上。
 * 3. **只在 IP 真的变了才动配置**。同一个 IP 每 5 分钟重写一遍配置，
 *    会把 DNR 规则反复重写（Chromium 上每次写入都会驱逐 BFCache）。
 */

export const IP_SYNC_ALARM_NAME = 'vanishgeo-exit-ip';
export const LAST_SYNCED_IP_KEY = 'lastSyncedExitIp';

/** 出口 IP 归属地的解析结果。故意只留改写配置真正要用到的字段。 */
export interface ExitIpInfo {
  ip: string;
  latitude: number;
  longitude: number;
  country: string;
  countryCode: string | null;
  timezone: string;
  timezoneOffset: number | null;
}

/** `syncLanguage` 打开时的国家 → 语言对照，与手动「按 IP 自动配置」一致 */
export const COUNTRY_LANGUAGES: Record<string, string> = {
  US: 'en-US',
  GB: 'en-GB',
  CN: 'zh-CN',
  JP: 'ja-JP',
  KR: 'ko-KR',
  DE: 'de-DE',
  FR: 'fr-FR',
  SG: 'en-SG',
  TW: 'zh-TW',
  HK: 'zh-HK'
};

const timezoneProbes = new Map<string, boolean>();

/** IANA 时区是否真实存在。接口偶尔返回 `Asia/Calcutta` 之外的拼写，别让它进配置。 */
export function isValidTimeZone(value: string): boolean {
  const timezone = String(value || '').trim();
  if (!timezone) return false;
  const cached = timezoneProbes.get(timezone);
  if (cached !== undefined) return cached;
  let valid = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    valid = true;
  } catch {
    valid = false;
  }
  timezoneProbes.set(timezone, valid);
  return valid;
}

/**
 * 国家名归一：`US` / `us` / `United States` 都落到 `United States`。
 *
 * 三家接口对同一个国家给的值不一样（ipapi.co 给 `country_name`、ipinfo 的 `country`
 * 直接是两字母码、ipwho.is 给国名）。只要有一家给码、另一家给名，`geolocation.country`
 * 的相等比较就会来回漂：每轮都判"变了"，白白重写配置、重载页面。
 */
export function canonicalCountry(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw;
  const code = raw.toUpperCase();
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    if (name && name !== code) return name;
  } catch {
    // 老浏览器没有 DisplayNames：退回两字母码，至少同一接口内保持稳定
  }
  return code;
}

/**
 * 解析一次 IP 归属地响应。
 *
 * 只发**一个**请求：响应本身自带 `ip` 字段，所以「查到的 IP」和「这份坐标」
 * 必然是同一次出口，不需要像上游那样先 `?objects=ip` 再回查一遍（两次请求
 * 之间出口可能已经漂移）。
 */
export function parseExitIpResponse(raw: unknown): ExitIpInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, any>;
  const ip = typeof data.ip === 'string' ? data.ip.trim() : '';
  if (!ip) return null;

  const geo = parseGeoApiResponse(data);
  if (!geo || !geo.timezone || !isValidTimeZone(geo.timezone)) return null;

  const rawCode = typeof data.country_code === 'string'
    ? data.country_code
    : (data.country && typeof data.country === 'object' && typeof data.country.code === 'string' ? data.country.code : '');
  // ipinfo 的 `country` 本身就是两字母国家码，别因为字段名叫 country 就当国名
  const countryCode = rawCode
    ? rawCode.trim().toUpperCase()
    : (/^[A-Za-z]{2}$/.test(geo.country) ? geo.country.toUpperCase() : codeFromCountryName(geo.country));

  return {
    ip,
    latitude: geo.latitude,
    longitude: geo.longitude,
    // 归一后再放进 info：下游的相等比较、写进配置的值都用同一个形状
    country: canonicalCountry(geo.country),
    countryCode,
    timezone: geo.timezone,
    timezoneOffset: geo.timezoneOffset ?? null
  };
}

/**
 * 国名 → 两字母代码。只覆盖 `COUNTRY_LANGUAGES` 里那十个国家。
 *
 * 为什么需要反查：`syncLanguage` 靠 `info.countryCode` 决定要不要改语言，
 * 而有的归属地接口只回国名不回国码（真实接口都给，但请求可能落到裁剪过的
 * 响应上）。缺代码时语言层会**静默不生效**——开关是打开的、界面没有任何提示，
 * 这种"看起来没坏"的失效最难查。所以这里用 Intl 自己生成名称反查，不手写表。
 */
export function codeFromCountryName(country: string | null | undefined): string | null {
  const name = typeof country === 'string' ? country.trim().toLowerCase() : '';
  if (!name) return null;
  for (const code of Object.keys(COUNTRY_LANGUAGES)) {
    try {
      const display = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
      if (display && display.toLowerCase() === name) return code;
    } catch {
      return null;
    }
  }
  return null;
}

export type IpSyncLayer = 'timezone' | 'geolocation' | 'language' | 'profile';

export type IpSyncSkip = 'extension-disabled' | 'sync-disabled' | 'same-ip';

export interface ExitIpSyncPlan {
  changed: boolean;
  ipChanged: boolean;
  skipped?: IpSyncSkip;
  /** 规划后的完整配置（无论是否 changed 都是归一化后的对象） */
  config: SiteSpoofConfig;
  /** 需要写进 `lastLocation` 的新定位；auto 模式靠它解析坐标/时区 */
  location: LastLocation;
  /** 这次动了哪几层，给日志与诊断页用 */
  layers: IpSyncLayer[];
}

/**
 * 语言标签 → 配置补丁。
 *
 * `languages` 带上裸基语言（`ja-JP` → `['ja-JP','ja']`），`acceptLanguage`
 * 交给 normalizeLanguage 推导，避免这里再写一份权重公式。
 */
function languagePatch(tag: string): Pick<LanguageConfig, 'language' | 'languages'> {
  const language = String(tag || '').trim();
  const base = language.split('-')[0];
  return { language, languages: base && base !== language ? [language, base] : [language] };
}

function sameCoords(
  left: { latitude: number | null; longitude: number | null } | null | undefined,
  right: { latitude: number | null; longitude: number | null }
): boolean {
  return Boolean(left)
    && left!.latitude === right.latitude
    && left!.longitude === right.longitude;
}

export function isSameLocation(previous: LastLocation | null | undefined, next: LastLocation): boolean {
  if (!previous) return false;
  return sameCoords(previous, next)
    && (previous.timezone || null) === (next.timezone || null)
    // 老配置里可能存着 `US` 这种码：两边都归一，换接口时不至于每轮都判"位置变了"
    && canonicalCountry(previous.country || '') === canonicalCountry(next.country || '');
}

/**
 * 把"出口 IP 变了"翻译成"配置要怎么改"。
 *
 * 纯函数：不读存储、不发请求、不看时钟（`updateTime` 由 options.now 决定），
 * 所以每条规则都能在测试里单独钉住。
 */
export function planExitIpSync(
  config: Partial<SiteSpoofConfig> | null | undefined,
  info: ExitIpInfo,
  storedIp: string,
  options: { force?: boolean; now?: number } = {}
): ExitIpSyncPlan {
  const normalized = normalizeConfig(config);
  const ipChanged = String(storedIp || '') !== info.ip;
  const location: LastLocation = {
    latitude: info.latitude,
    longitude: info.longitude,
    country: info.country,
    timezone: info.timezone,
    timezoneOffset: info.timezoneOffset,
    updateTime: new Date(options.now === undefined ? Date.now() : options.now).toLocaleString()
  };
  const base: ExitIpSyncPlan = {
    changed: false,
    ipChanged,
    config: normalized,
    location,
    layers: []
  };

  if (!normalized.masterEnabled) return { ...base, skipped: 'extension-disabled' };

  const sync = normalizeIpSync(normalized.ipSync);
  if (!sync.enabled) return { ...base, skipped: 'sync-disabled' };
  if (!ipChanged && !options.force) return { ...base, skipped: 'same-ip' };

  const layers: IpSyncLayer[] = [];

  const timezone = normalized.globalProfile.timezone;
  const timezoneChanged = timezone.mode !== 'auto' || timezone.timezone !== info.timezone;
  if (timezoneChanged) layers.push('timezone');

  const geolocation = normalized.globalProfile.geolocation;
  const geolocationChanged = geolocation.mode !== 'auto'
    || geolocation.latitude !== info.latitude
    || geolocation.longitude !== info.longitude
    || canonicalCountry(geolocation.country) !== info.country;
  if (geolocationChanged) layers.push('geolocation');

  let language = normalized.globalProfile.language;
  if (sync.syncLanguage && info.countryCode && COUNTRY_LANGUAGES[info.countryCode]) {
    const next = normalizeLanguage({
      ...language,
      mode: 'preset',
      // acceptLanguage 必须清空后重算：normalizeLanguage 只在缺省时推导，
      // 沿用旧值就会出现"language=ja-JP、请求头还是 en-US,en;q=0.9"。
      acceptLanguage: '',
      ...languagePatch(COUNTRY_LANGUAGES[info.countryCode])
    });
    if (next.language !== language.language
      || next.acceptLanguage !== language.acceptLanguage
      || next.languages.join(',') !== language.languages.join(',')) {
      language = next;
      layers.push('language');
    }
  }

  // 用户手选的预设（Singapore / Japan / …）在「跟随出口 IP」下就名不副实了：
  // 清成 null，界面才不会一边显示"美国"、一边给出东京坐标。
  const activeProfileId = normalized.profile.activeProfileId;
  if (activeProfileId !== null) layers.push('profile');

  const next = normalizeConfig({
    ...normalized,
    globalProfile: {
      language,
      timezone: { ...timezone, mode: 'auto', timezone: info.timezone },
      geolocation: {
        ...geolocation,
        mode: 'auto',
        latitude: info.latitude,
        longitude: info.longitude,
        country: info.country
      }
    },
    profile: { ...normalized.profile, activeProfileId: null }
  });

  return { ...base, changed: layers.length > 0, config: next, layers };
}

// ---------- 与 chrome.* 解耦的执行层 ----------

export interface ExitIpSyncDeps {
  getConfig(): Promise<SiteSpoofConfig>;
  /** 只写存储（不应用副作用）；应用由 applyNow 统一做一次 */
  saveConfig(config: SiteSpoofConfig): Promise<void>;
  saveLocation(location: LastLocation): Promise<void>;
  getLastLocation(): Promise<LastLocation | null>;
  getStoredIp(): Promise<string>;
  saveStoredIp(ip: string): Promise<void>;
  /** 配置或定位写完之后应用一次（DNR / 权限 / payload） */
  applyNow(): Promise<void>;
  /** 测试注入用；默认打真实接口 */
  lookup?(url: string): Promise<unknown>;
  force?: boolean;
  now?(): number;
  log?(message: string, error?: unknown): void;
}

export type ExitIpSyncOutcome =
  | { ok: true; changed: boolean; skipped?: IpSyncSkip; layers: IpSyncLayer[]; ip: string }
  | { ok: false; error: string };

let inFlight: Promise<ExitIpSyncOutcome> | null = null;

/** 单飞：alarm、开关切换、启动初始化可能同时进来，只想打一次接口。 */
export function runExitIpSync(deps: ExitIpSyncDeps): Promise<ExitIpSyncOutcome> {
  if (inFlight) {
    // 带 force 的调用不能直接复用别人那一趟：那一趟可能在 `execute` 里因为"IP 没变"
    // 提前返回，用户点「立即同步一次」就会拿到一句"这次跳过"，看起来像按钮坏了。
    // 排到当前这一趟之后再跑一次，才是"立刻同步"该有的语义。
    if (!deps.force) return inFlight;
    const rerun = () => runExitIpSync(deps);
    return inFlight.then(rerun, rerun);
  }
  // finally 里要判断"清空的是不是自己这一趟"，所以回调必须能引用到 task 本身；
  // 引用发生在异步回调里（赋值早已完成），不会踩 TDZ。
  const task = execute(deps).finally(() => {
    if (inFlight === task) inFlight = null;
  });
  inFlight = task;
  return task;
}

export function isExitIpSyncRunning(): boolean {
  return inFlight !== null;
}

/** 测试之间复位单飞状态 */
export function resetExitIpSyncState(): void {
  inFlight = null;
}

async function execute(deps: ExitIpSyncDeps): Promise<ExitIpSyncOutcome> {
  const log = deps.log || ((message: string, error?: unknown) => console.warn(message, error));
  try {
    const config = await deps.getConfig();
    if (!config.masterEnabled) return { ok: true, changed: false, skipped: 'extension-disabled', layers: [], ip: '' };
    if (!normalizeIpSync(config.ipSync).enabled) {
      return { ok: true, changed: false, skipped: 'sync-disabled', layers: [], ip: '' };
    }

    const lookup = deps.lookup || ((url: string) => fetchJson(url));
    const errors: string[] = [];
    let info: ExitIpInfo | null = null;
    for (const url of GEO_API_URLS) {
      try {
        info = parseExitIpResponse(await lookup(url));
        if (info) break;
        errors.push(`${url} no usable exit ip`);
      } catch (error) {
        errors.push(`${url} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!info) {
      const message = `exit IP lookup failed: ${errors.join(' | ')}`;
      log('automatic exit IP sync failed; keeping existing config', message);
      return { ok: false, error: message };
    }

    const storedIp = await deps.getStoredIp();
    // 网络请求完成后再读一次配置：这期间用户可能已经关掉开关或改了周期
    const latest = await deps.getConfig();
    const plan = planExitIpSync(latest, info, storedIp, { force: deps.force, now: deps.now?.() });
    if (plan.skipped) {
      return { ok: true, changed: false, skipped: plan.skipped, layers: [], ip: info.ip };
    }

    const previousLocation = await deps.getLastLocation();
    const locationChanged = !isSameLocation(previousLocation, plan.location);
    if (locationChanged) await deps.saveLocation(plan.location);
    if (plan.changed) await deps.saveConfig(plan.config);
    if (plan.changed || locationChanged) await deps.applyNow();
    await deps.saveStoredIp(info.ip);

    return { ok: true, changed: plan.changed, layers: plan.layers, ip: info.ip };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('automatic exit IP sync failed; keeping existing config:', error);
    return { ok: false, error: message };
  }
}

// ---------- alarm 对齐 ----------

export interface IpSyncAlarmGateway {
  get(name: string): Promise<{ periodInMinutes?: number } | undefined | null>;
  create(name: string, info: { periodInMinutes: number }): Promise<void>;
  clear(name: string): Promise<void>;
}

export function ipSyncIntervalMinutes(config: Partial<SiteSpoofConfig> | null | undefined): number {
  const sync = normalizeIpSync(config ? config.ipSync : null);
  return Math.min(
    IP_SYNC_MAX_INTERVAL_MINUTES,
    Math.max(IP_SYNC_MIN_INTERVAL_MINUTES, sync.intervalMinutes)
  );
}

export function isIpSyncEnabled(config: Partial<SiteSpoofConfig> | null | undefined): boolean {
  if (!config || config.masterEnabled === false) return false;
  return normalizeIpSync(config.ipSync).enabled;
}

/**
 * 让 alarm 的存在状态与配置一致；返回对齐后是否应该在运行。
 *
 * 关掉的时候必须真的 clear：留着的 alarm 会在下一轮把用户刚关掉的功能
 * 再跑一遍（而且会打接口）。
 */
export async function ensureIpSyncAlarmFor(
  config: Partial<SiteSpoofConfig> | null | undefined,
  alarms: IpSyncAlarmGateway
): Promise<boolean> {
  if (!isIpSyncEnabled(config)) {
    await alarms.clear(IP_SYNC_ALARM_NAME);
    return false;
  }
  const interval = ipSyncIntervalMinutes(config);
  const existing = await alarms.get(IP_SYNC_ALARM_NAME);
  if (!existing || existing.periodInMinutes !== interval) {
    await alarms.create(IP_SYNC_ALARM_NAME, { periodInMinutes: interval });
  }
  return true;
}