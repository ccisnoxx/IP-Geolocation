import type {
  CanvasConfig,
  CanvasPlatform,
  GeolocationConfig,
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
  history: []
};

export const DEFAULT_WEBRTC: WebRtcConfig = {
  globalMode: 'strict'
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

export const LANGUAGE_PRESETS = [
  { label: 'English (Singapore)', language: 'en-SG', languages: ['en-SG', 'en-US', 'en'], acceptLanguage: 'en-SG,en-US;q=0.9,en;q=0.8' },
  { label: 'English (US)', language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
  { label: 'English (UK)', language: 'en-GB', languages: ['en-GB', 'en'], acceptLanguage: 'en-GB,en;q=0.9' },
  { label: 'Chinese (Simplified)', language: 'zh-CN', languages: ['zh-CN', 'zh', 'en'], acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' },
  { label: 'Chinese (Traditional)', language: 'zh-TW', languages: ['zh-TW', 'zh', 'en'], acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8' },
  { label: 'Japanese', language: 'ja-JP', languages: ['ja-JP', 'ja', 'en'], acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' },
  { label: 'Korean', language: 'ko-KR', languages: ['ko-KR', 'ko', 'en'], acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' },
  { label: 'German', language: 'de-DE', languages: ['de-DE', 'de', 'en'], acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' },
  { label: 'French', language: 'fr-FR', languages: ['fr-FR', 'fr', 'en'], acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' }
] as const;

export const TIMEZONE_PRESETS = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney'
];

export const DEFAULT_PROFILES: Profile[] = [
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
  },
  {
    id: 'germany',
    name: 'Germany',
    description: 'Germany environment',
    geolocation: { latitude: 52.52, longitude: 13.405, accuracy: 50, country: 'Germany' },
    language: { language: 'de-DE', languages: ['de-DE', 'de', 'en-US', 'en'], acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' },
    timezone: { timezone: 'Europe/Berlin' }
  },
  {
    id: 'united-states',
    name: 'United States',
    description: 'United States environment',
    geolocation: { latitude: 40.7128, longitude: -74.006, accuracy: 50, country: 'United States' },
    language: { language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
    timezone: { timezone: 'America/New_York' }
  },
  {
    id: 'china',
    name: 'China',
    description: 'China environment',
    geolocation: { latitude: 31.2304, longitude: 121.4737, accuracy: 50, country: 'China' },
    language: { language: 'zh-CN', languages: ['zh-CN', 'zh', 'en-US', 'en'], acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7' },
    timezone: { timezone: 'Asia/Shanghai' }
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
    spoofPermission: input.spoofPermission !== false,
    history: Array.isArray(input.history)
      ? input.history
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

const CANVAS_PLATFORMS: CanvasPlatform[] = ['auto', 'mac', 'windows', 'linux', 'none'];

export function normalizeCanvas(config: Partial<CanvasConfig> | null | undefined): CanvasConfig {
  const input = config || {};
  const platform = CANVAS_PLATFORMS.includes(input.platform as CanvasPlatform)
    ? (input.platform as CanvasPlatform)
    : DEFAULT_CANVAS.platform;

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

export const DEFAULT_CONFIG: SiteSpoofConfig = {
  schemaVersion: 1,
  masterEnabled: true,
  debugMode: false,
  globalProfile: {
    language: DEFAULT_LANGUAGE,
    timezone: DEFAULT_TIMEZONE,
    geolocation: DEFAULT_GEOLOCATION
  },
  webRtc: DEFAULT_WEBRTC,
  canvas: DEFAULT_CANVAS,
  profile: {
    activeProfileId: 'united-states',
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
 * 配置结构版本。
 *
 * 3：字体伪装拆成三层（平台 / 中文 / 手动）。旧配置把中文表直接放在
 *    `targetFonts` 里，升级时由 `normalizeCanvas` 搬进 `hideCjkFonts` ——
 *    所以这里不需要额外的升级代码，版本号只用来标记"结构变过"。
 * 2：`canvas.targetFonts` 增加国产厂商字体（已并入 CJK_VENDOR_FONTS）。
 */
export const CONFIG_SCHEMA_VERSION = 3;

export function normalizeConfig(config: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  const input = config || {};
  const globalProfile = (input.globalProfile || {}) as Partial<SiteSpoofConfig['globalProfile']>;
  const profile = (input.profile || {}) as Partial<SiteSpoofConfig['profile']>;
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
    profile: {
      activeProfileId: normalizeString(profile.activeProfileId) || DEFAULT_CONFIG.profile.activeProfileId,
      profiles: normalizeProfiles(profile.profiles).length ? normalizeProfiles(profile.profiles) : clone(DEFAULT_PROFILES)
    },
    rules: Array.isArray(input.rules) ? input.rules.map(normalizeRule) : defaultRules()
  };
}

/**
 * 存储层入口：从 chrome.storage 读出来的配置走这里。
 *
 * 现在结构迁移全部收敛在 `normalizeCanvas`（把旧的扁平 `targetFonts` 拆成
 * `hideCjkFonts` + 手动追加项），所以它只是 `normalizeConfig` 的语义别名 ——
 * 保留这个函数是为了让"存储层"和"任意部分配置"两个入口在类型和意图上分开，
 * 以后再加存储专属迁移时不用回头改调用方。
 */
export function migrateStoredConfig(raw: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  return normalizeConfig(raw);
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

export function formatTimezoneOffsetMinutes(offset: number | null): string | null {
  if (!Number.isFinite(Number(offset))) return null;
  const normalized = Number(offset);
  const sign = normalized <= 0 ? '+' : '-';
  const abs = Math.abs(normalized);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
