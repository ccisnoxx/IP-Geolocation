import type {
  CanvasConfig,
  CanvasPlatform,
  GeolocationConfig,
  IpSyncConfig,
  LanguageConfig,
  Profile,
  SignalOverride,
  SiteRule,
  SiteSpoofConfig,
  TimezoneConfig,
  WebRtcConfig,
  WebRtcMode
} from './types';

export const SITE_CONFIG_KEY = 'siteSpoofConfig';
export const LAST_LOCATION_KEY = 'lastLocation';
export const LEGACY_VANISHME_CONFIG_KEY = 'bpg_config';
export const OLD_EXTENSION_ENABLED_KEY = 'extensionEnabled';
export const OLD_LANGUAGE_KEY = 'languageConfig';
export const OLD_TIMEZONE_KEY = 'timezoneConfig';
import defaultRuleDomains from './default-domains.json';

export const OLD_WEBRTC_KEY = 'webRtcConfig';

// 默认英文（en-US）：白名单站点基本都走美国出口，语言只要跟出口国家不冲突就行。
// 时区不在这里定 —— DEFAULT_TIMEZONE 是 auto，跟着代理 IP 走。
export const DEFAULT_LANGUAGE: LanguageConfig = {
  enabled: true,
  mode: 'preset',
  language: 'en-US',
  languages: ['en-US', 'en'],
  acceptLanguage: 'en-US,en;q=0.9'
};

export const DEFAULT_TIMEZONE: TimezoneConfig = {
  enabled: true,
  mode: 'auto',
  timezone: ''
};

export const DEFAULT_GEOLOCATION: GeolocationConfig = {
  enabled: true,
  mode: 'auto',
  latitude: null,
  longitude: null,
  accuracy: 50,
  country: '',
  randomize: false,
  randomRadiusMeters: 1000,
  spoofPermission: true,
  noNativeCall: true,
  history: []
};

export const DEFAULT_WEBRTC: WebRtcConfig = {
  globalMode: 'strict'
};

/** 检测周期的上下界：5 分钟是既有定位 alarm 的节奏，再密只会把接口打到限流 */
export const IP_SYNC_MIN_INTERVAL_MINUTES = 5;
export const IP_SYNC_MAX_INTERVAL_MINUTES = 1440;

/**
 * 跟随出口 IP —— 默认关。
 *
 * 默认关的理由和 canvas 一样：它会在后台改写用户的时区/坐标，属于"替你决定"，
 * 必须由用户显式打开。开着的时候语言仍不跟随（见 IpSyncConfig 注释）。
 */
export const DEFAULT_IP_SYNC: IpSyncConfig = {
  enabled: false,
  intervalMinutes: IP_SYNC_MIN_INTERVAL_MINUTES,
  syncLanguage: false
};

export const DEFAULT_CANVAS: CanvasConfig = {
  enabled: false,
  spoofFonts: true,
  // 默认按真实平台：装在哪台机器上，"另外两个平台的字体不存在"这条就成立，
  // 而本平台自带的字体不会被误藏（在 Mac 上藏掉苹方本身就是个矛盾信号）。
  platform: 'auto',
  // 中文/厂商字体是独立的一层：默认开，行为与旧版一致
  hideCjkFonts: true,
  // 手写追加项，默认空；旧版把整张中文表放在这里，升级时会被搬进 hideCjkFonts
  targetFonts: []
};

export const DEFAULT_SIGNAL_OVERRIDE: SignalOverride<never> = {
  mode: 'inherit',
  value: null
};

/**
 * 内置预设：只留三个常用出口。
 *
 * 选这三个是因为它们对应"真的会去买 VPS 的地区"——美西、新加坡、日本。
 * 德国/东海岸/中国这类预设留在列表里只会让快速配置区变成一排用不上的按钮，
 * 真要用别的地区，手填坐标或存自定义 profile 都行。
 */
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'us-west',
    name: 'United States (West)',
    description: 'US West coast environment',
    geolocation: { latitude: 34.0522, longitude: -118.2437, accuracy: 50, country: 'United States' },
    language: { language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
    timezone: { timezone: 'America/Los_Angeles' }
  },
  {
    id: 'singapore',
    name: 'Singapore',
    description: 'Singapore environment',
    geolocation: { latitude: 1.3521, longitude: 103.8198, accuracy: 50, country: 'Singapore' },
    language: { language: 'en-SG', languages: ['en-SG', 'en-US', 'en'], acceptLanguage: 'en-SG,en-US;q=0.9,en;q=0.8' },
    timezone: { timezone: 'Asia/Singapore' }
  },
  {
    id: 'japan',
    name: 'Japan',
    description: 'Japan environment',
    geolocation: { latitude: 35.6895, longitude: 139.6917, accuracy: 50, country: 'Japan' },
    language: { language: 'ja-JP', languages: ['ja-JP', 'ja', 'en-US', 'en'], acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7' },
    timezone: { timezone: 'Asia/Tokyo' }
  }
];

export const DEFAULT_RULE_DOMAINS: string[] = defaultRuleDomains;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeLanguages(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  return String(value || '').split(',').map((item) => normalizeString(item)).filter(Boolean);
}

export function normalizeLanguage(config: Partial<LanguageConfig> | null | undefined): LanguageConfig {
  const input = config || {};
  const languages = normalizeLanguages(input.languages);
  const language = normalizeString(input.language || languages[0] || DEFAULT_LANGUAGE.language);
  const normalizedLanguages = languages.length ? languages : clone(DEFAULT_LANGUAGE.languages);
  if (language && !normalizedLanguages.includes(language)) {
    normalizedLanguages.unshift(language);
  }
  const acceptLanguage = normalizeString(input.acceptLanguage)
    || normalizedLanguages
      .map((item, index) => (index === 0 ? item : `${item};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`))
      .join(',');

  return {
    enabled: input.enabled !== false,
    mode: input.mode === 'custom' ? 'custom' : 'preset',
    language,
    languages: normalizedLanguages,
    acceptLanguage
  };
}

export function normalizeTimezone(config: Partial<TimezoneConfig> | null | undefined): TimezoneConfig {
  const input = config || {};
  return {
    enabled: input.enabled !== false,
    mode: input.mode === 'manual' ? 'manual' : 'auto',
    timezone: normalizeString(input.timezone)
  };
}

export function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `noNativeCall` 的归一：显式给了就照办（并由此把权限伪装一并打开），
 * 没给就跟随 `spoofPermission` —— 伪装授权等价于"已经不问原生了"，
 * 而"只改坐标、真权限走原生"的人默认需要委派。
 */
export function resolveNoNativeCall(input: {
  noNativeCall?: boolean;
  spoofPermission?: boolean;
}): boolean {
  if (typeof input.noNativeCall === 'boolean') return input.noNativeCall;
  return input.spoofPermission !== false;
}

export function normalizeGeolocation(config: Partial<GeolocationConfig> | null | undefined): GeolocationConfig {
  const input = config || {};
  return {
    enabled: input.enabled !== false,
    mode: input.mode === 'manual' ? 'manual' : 'auto',
    latitude: normalizeNumber(input.latitude),
    longitude: normalizeNumber(input.longitude),
    accuracy: Number.isFinite(Number(input.accuracy)) && Number(input.accuracy) > 0
      ? Number(input.accuracy)
      : DEFAULT_GEOLOCATION.accuracy,
    country: normalizeString(input.country),
    randomize: Boolean(input.randomize),
    randomRadiusMeters: Number.isFinite(Number(input.randomRadiusMeters)) && Number(input.randomRadiusMeters) >= 0
      ? Number(input.randomRadiusMeters)
      : DEFAULT_GEOLOCATION.randomRadiusMeters,
    // noNativeCall 与 spoofPermission 是绑定的：
    //  · 缺省跟随 spoofPermission —— 伪装授权时本来就不问原生，关掉伪装授权的人
    //    要的是真实权限流程，所以缺省允许委派（老配置的语义不会变）；
    //  · 显式打开 noNativeCall 时把它拉回 true —— 否则 permissions.query 会说
    //    prompt、getCurrentPosition 却给坐标，两句话当场打架。
    spoofPermission: resolveNoNativeCall(input) ? true : input.spoofPermission !== false,
    noNativeCall: resolveNoNativeCall(input),
    history: Array.isArray(input.history)
      ? input.history
          .filter((item) => item != null)
          .map((item) => ({
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            accuracy: Number.isFinite(Number(item.accuracy)) ? Number(item.accuracy) : DEFAULT_GEOLOCATION.accuracy,
            label: item.label ? String(item.label) : undefined,
            createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
          }))
          .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      : []
  };
}

export function normalizeIpSync(config: Partial<IpSyncConfig> | null | undefined): IpSyncConfig {
  const input = config || {};
  const rawInterval = Number(input.intervalMinutes);
  const intervalMinutes = Number.isFinite(rawInterval)
    ? Math.min(IP_SYNC_MAX_INTERVAL_MINUTES, Math.max(IP_SYNC_MIN_INTERVAL_MINUTES, Math.round(rawInterval)))
    : DEFAULT_IP_SYNC.intervalMinutes;
  return {
    enabled: input.enabled === true,
    intervalMinutes,
    syncLanguage: input.syncLanguage === true
  };
}

export function normalizeWebRtc(config: Partial<WebRtcConfig> | { policy?: string; enabled?: boolean } | null | undefined): WebRtcConfig {
  const input = (config || {}) as Partial<WebRtcConfig> & { policy?: string; enabled?: boolean };
  const rawMode = 'globalMode' in input ? input.globalMode : ('policy' in input ? input.policy : undefined);
  const globalMode: WebRtcMode = rawMode === 'default' || rawMode === 'off' || input.enabled === false
    ? 'default'
    : rawMode === 'compatible' || rawMode === 'default_public_interface_only'
      ? 'compatible'
      : 'strict';
  return { globalMode };
}

const CANVAS_PLATFORMS: CanvasPlatform[] = ['auto', 'none'];

/**
 * v4 之前的手动值。它们的语义是"按那个平台判定"，跟"按真实平台判定"是两件事；
 * 但按另一个平台判定等于让这台机器假装成另一台（字体藏了，UA 没藏），
 * 那一层已经移除，所以旧值一律回到 auto —— 也就是按真实平台。
 */
const LEGACY_MANUAL_PLATFORMS = new Set(['mac', 'windows', 'linux']);

export function normalizeCanvas(config: Partial<CanvasConfig> | null | undefined): CanvasConfig {
  const input = config || {};
  const rawPlatform = input.platform as string | undefined;
  let platform: CanvasPlatform = DEFAULT_CANVAS.platform;
  if (CANVAS_PLATFORMS.includes(rawPlatform as CanvasPlatform)) {
    platform = rawPlatform as CanvasPlatform;
  } else if (rawPlatform && LEGACY_MANUAL_PLATFORMS.has(rawPlatform)) {
    platform = 'auto';
  }

  const declared = Array.isArray(input.targetFonts)
    ? input.targetFonts.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  // 没有 hideCjkFonts 字段 = 旧结构：那张扁平表就是"中文表"，中文层认定为开，
  // 否则升级会把用户明确开着的字体伪装静默关掉。旧条目原样留在 targetFonts 里
  // （解析时会去重，不会重复隐藏），这样任何一条都不会丢。
  const isLegacyShape = typeof input.hideCjkFonts !== 'boolean';
  const hideCjkFonts = isLegacyShape ? true : Boolean(input.hideCjkFonts);

  // 这里刻意不 import font-aliases：注入脚本（MAIN world）也要用那个模块，
  // 一旦被两边共享，Rollup 会把它抽成独立 chunk，runtime.js 里出现 `import`
  // 就不再是经典脚本 —— 页面直接语法错误，整个注入层消失。
  return {
    enabled: Boolean(input.enabled),
    spoofFonts: input.spoofFonts !== false,
    platform,
    hideCjkFonts,
    targetFonts: declared
  };
}

export function normalizeOverride<T>(override: Partial<SignalOverride<T>> | null | undefined): SignalOverride<T> {
  const input = override || {};
  const mode = input.mode === 'override'
    ? 'override'
    : input.mode === 'disable'
      ? 'disable'
      : 'inherit';
  return {
    mode,
    value: input.value === undefined ? null : input.value as T | null
  };
}

export function parseHostname(input: unknown): string {
  const raw = normalizeString(input).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^\.+|\.+$/g, '');
  } catch {
    return raw.split('/')[0].split(':')[0].replace(/^\.+|\.+$/g, '');
  }
}

export function normalizeDomain(input: unknown): string {
  return parseHostname(input);
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.includes('*') || domain.length > 253) return false;
  if (domain === 'localhost') return true;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function normalizeRule(rule: Partial<SiteRule> | null | undefined): SiteRule {
  const input = rule || {};
  return {
    id: normalizeString(input.id) || `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    domain: normalizeDomain(input.domain),
    enabled: input.enabled !== false,
    overrides: {
      language: normalizeOverride(input.overrides?.language),
      timezone: normalizeOverride(input.overrides?.timezone),
      geolocation: normalizeOverride(input.overrides?.geolocation)
    }
  };
}

export function createRule(domain: string): SiteRule {
  return normalizeRule({
    id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    domain,
    enabled: true,
    overrides: {
      language: DEFAULT_SIGNAL_OVERRIDE,
      timezone: DEFAULT_SIGNAL_OVERRIDE,
      geolocation: DEFAULT_SIGNAL_OVERRIDE
    }
  });
}

export function defaultRules(): SiteRule[] {
  return DEFAULT_RULE_DOMAINS.map((domain) => createRule(domain));
}

/**
 * v5 新增的内置站点规则：7 个"装完就能自测"的隐私检测站。
 *
 * 只写 apex 域 —— `domainMatches` 已经是后缀匹配（`host === domain ||
 * host.endsWith('.' + domain)`），`*.browserleaks.com` 这种通配条目在
 * `normalizeDomain` 里会被剥成裸域，写两遍只会变成重复规则。
 */
export const BUILTIN_DOMAINS_V5: string[] = [
  'browserleaks.com',
  'ipleak.net',
  'browserscan.net',
  'deviceinfo.me',
  'whoer.net',
  'ipinfo.io',
  'iprisk.top'
];

/** v5 新增的内置预设。以后只加白名单、不加预设时留空数组。 */
export const BUILTIN_PROFILE_IDS_V5: string[] = ['us-west'];

/**
 * 配置结构版本。升版只做一件事：把**新增的内置项**补进存量配置
 * （见 `backfillV5Rules` / `backfillV5Profiles`，入口是 `migrateStoredConfig`）。
 *
 * 2：`canvas.targetFonts` 增加国产厂商字体（已并入 CJK_VENDOR_FONTS）。
 * 3：字体伪装拆成三层（平台 / 中文 / 手动）。旧配置把中文表直接放在
 *    `targetFonts` 里，升级时由 `normalizeCanvas` 搬进 `hideCjkFonts` ——
 *    所以这里不需要额外的升级代码，版本号只用来标记"结构变过"。
 * 4：字体层的平台维度收窄成 auto / none（移除了"假装另一个平台"的手动值）。
 * 5：默认白名单补 7 个隐私检测站、内置预设补 `us-west`。**存量配置也要拿到** ——
 *    之前 `normalizeConfig` 是"存量非空就整段以存量为准"，于是升级后老用户
 *    的白名单里永远没有检测站，成了只有新装用户才有的功能。
 */
export const CONFIG_SCHEMA_VERSION = 5;

export const DEFAULT_CONFIG: SiteSpoofConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  masterEnabled: true,
  debugMode: false,
  globalProfile: {
    language: DEFAULT_LANGUAGE,
    timezone: DEFAULT_TIMEZONE,
    geolocation: DEFAULT_GEOLOCATION
  },
  webRtc: DEFAULT_WEBRTC,
  canvas: DEFAULT_CANVAS,
  ipSync: DEFAULT_IP_SYNC,
  profile: {
    activeProfileId: 'us-west',
    profiles: clone(DEFAULT_PROFILES)
  },
  rules: defaultRules()
};

export function normalizeProfiles(value: unknown): Profile[] {
  const input = Array.isArray(value) ? value : [];
  return input
    .map((profile) => {
      const normalized = profile as Partial<Profile>;
      const geolocation = (normalized.geolocation || {}) as Partial<Profile['geolocation']>;
      const timezone = (normalized.timezone || {}) as Partial<Profile['timezone']>;
      return {
        id: normalizeString(normalized.id),
        name: normalizeString(normalized.name),
        description: normalized.description ? normalizeString(normalized.description) : undefined,
        geolocation: {
          latitude: Number(geolocation.latitude),
          longitude: Number(geolocation.longitude),
          accuracy: Number.isFinite(Number(geolocation.accuracy))
            ? Number(geolocation.accuracy)
            : DEFAULT_GEOLOCATION.accuracy,
          country: normalizeString(geolocation.country)
        },
        language: normalizeLanguage(normalized.language as Partial<LanguageConfig>),
        timezone: {
          timezone: normalizeString(timezone.timezone)
        }
      };
    })
    .filter((profile) => (
      profile.id
      && profile.name
      && Number.isFinite(profile.geolocation.latitude)
      && Number.isFinite(profile.geolocation.longitude)
      && profile.timezone.timezone
    ));
}

/**
 * 把 v5 新增的内置站点规则补进存量配置。
 *
 * 三条约束：
 * 1. **只补 `BUILTIN_DOMAINS_V5`**，不重放整份 `defaultRules()`。存量配置里缺的
 *    老站点是用户自己删掉的，补回去等于把删除操作吞了。
 * 2. 判定"已存在"按 `domain` 而不是 `id`：内置规则的 id 是随机生成的，
 *    每次 `defaultRules()` 都不一样，按 id 比会以为永远缺。
 * 3. `enabled: false` 的规则（`!browserleaks.com` 这种显式排除）同样算"已存在" ——
 *    用户是想排除它，不是想要它。
 */
function backfillV5Rules(stored: SiteRule[]): SiteRule[] {
  const seen = new Set(stored.map((rule) => rule.domain).filter(Boolean));
  const missing = BUILTIN_DOMAINS_V5.filter((domain) => !seen.has(domain));
  // 存量顺序原样保留，也**不在这里去重**：重复域名是 `validateConfig` 要报给用户的
  // 配置错误，回填顺手抹掉它就等于把校验静默关了一半。
  //
  // id 用域名推导，不用 `createRule` 的时间戳+随机串：迁移结果不写回存储（迁移发生在
  // 每次读取上），随机 id 会让同一份存量配置每读一次就换一批 id，`applyConfig` 那边的
  // `JSON.stringify` 签名去重从此永不命中 —— 一次保存会应用两遍（DNR 与 payload 各两份）。
  return missing.length
    ? [...stored, ...missing.map((domain) => ({ ...createRule(domain), id: `v5-${domain}` }))]
    : stored;
}

/** 同上，补 v5 新增的内置预设（按 id 判重）。 */
function backfillV5Profiles(stored: Profile[]): Profile[] {
  const seen = new Set(stored.map((profile) => profile.id));
  const missing = DEFAULT_PROFILES.filter((preset) => (
    BUILTIN_PROFILE_IDS_V5.includes(preset.id) && !seen.has(preset.id)
  ));
  return missing.length ? [...stored, ...clone(missing)] : stored;
}

/**
 * 存量配置的版本号。老配置没有这个字段（或写得不像数字）时按 1 处理：
 * 宁可让它走一遍补丁，也不要跳过 —— 补丁本身是幂等的。
 */
function storedSchemaVersion(value: unknown): number {
  const version = Number(value);
  return Number.isFinite(version) ? version : 1;
}

export function normalizeConfig(config: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  const input = config || {};
  const globalProfile = (input.globalProfile || {}) as Partial<SiteSpoofConfig['globalProfile']>;
  const profile = (input.profile || {}) as Partial<SiteSpoofConfig['profile']>;
  const profiles = normalizeProfiles(profile.profiles);
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    masterEnabled: input.masterEnabled !== false,
    debugMode: Boolean(input.debugMode),
    globalProfile: {
      language: normalizeLanguage(globalProfile.language || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone(globalProfile.timezone || DEFAULT_TIMEZONE),
      geolocation: normalizeGeolocation(globalProfile.geolocation || DEFAULT_GEOLOCATION)
    },
    webRtc: normalizeWebRtc(input.webRtc || DEFAULT_WEBRTC),
    canvas: normalizeCanvas(input.canvas || DEFAULT_CANVAS),
    // 老配置里没有这个字段：normalizeIpSync 直接给默认值（关）。
    // 这条路径每个字段都自带默认值，所以不需要为新字段再升 schemaVersion。
    ipSync: normalizeIpSync(input.ipSync),
    profile: {
      // `null` 是合法状态（"没选预设"）：options 删除当前预设时就是写 null。
      // 之前这里用 `|| DEFAULT` 兜底，会把 null 复活成 'united-states'，
      // 于是"取消选择"静默失败，界面又跳回 United States。
      activeProfileId: profile.activeProfileId === null
        ? null
        : normalizeString(profile.activeProfileId) || DEFAULT_CONFIG.profile.activeProfileId,
      profiles: profiles.length ? profiles : clone(DEFAULT_PROFILES)
    },
    rules: Array.isArray(input.rules) ? input.rules.map(normalizeRule) : defaultRules()
  };
}

/**
 * 存储层入口：从 chrome.storage 读出来的配置走这里，也只有这里做版本升级。
 *
 * 为什么迁移不放 `normalizeConfig`：那个函数在匹配规则、算 DNR 规则、渲染
 * 卸载页的路径上被调无数次，还经常收到调用方临时拼出来的局部配置。迁移一旦
 * 跟着它跑，"我手上这份 rules 到底该不该被补默认项"就取决于它有没有版本号，
 * 行为会散到所有调用点。放在这里则只有一句话：**存进去的老配置读出来时补一次**。
 *
 * 幂等性靠版本号：`normalizeConfig` 的输出恒为当前版本，所以同一份配置第二次
 * 进来就跳过补丁 —— 用户在升级后删掉的内置规则不会被下一次读取复活。
 */
export function migrateStoredConfig(raw: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  const normalized = normalizeConfig(raw);
  const from = storedSchemaVersion(raw?.schemaVersion);
  if (from >= CONFIG_SCHEMA_VERSION) return normalized;
  return {
    ...normalized,
    rules: backfillV5Rules(normalized.rules),
    profile: {
      ...normalized.profile,
      profiles: backfillV5Profiles(normalized.profile.profiles)
    }
  };
}

export function validateTimezone(timezone: string): boolean {
  const value = normalizeString(timezone);
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getTimezoneOffsetMinutes(timezone: string, dateInput?: Date | string | number): number | null {
  const value = normalizeString(timezone);
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput || Date.now());
  if (!value || Number.isNaN(date.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts: Record<string, string> = {};
    formatter.formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((date.getTime() - asUTC) / 60000);
  } catch {
    return null;
  }
}
