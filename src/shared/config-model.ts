import { VENDOR_SOFTWARE_FONT_FAMILIES } from './font-families';
export { VENDOR_SOFTWARE_FONT_FAMILIES } from './font-families';
import type {
  FontExposureConfig,
  ExitLocationProfile,
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
export const RULES_INITIALIZED_KEY = 'vanishgeoRulesInitialized';
export const LEGACY_VANISHME_CONFIG_KEY = 'bpg_config';
export const OLD_EXTENSION_ENABLED_KEY = 'extensionEnabled';
export const OLD_LANGUAGE_KEY = 'languageConfig';
export const OLD_TIMEZONE_KEY = 'timezoneConfig';
export const OLD_WEBRTC_KEY = 'webRtcConfig';
export const LEGACY_EXIT_LOCATION_PROFILE_ID = 'legacy-last-location';

export const DEFAULT_LANGUAGE: LanguageConfig = {
  enabled: false,
  mode: 'preset',
  language: 'en-US',
  languages: ['en-US', 'en']
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



export const DEFAULT_FONT_EXPOSURE: FontExposureConfig = {
  enabled: false,
  canvasSpoof: { enabled: false, platform: 'macos' },
  mode: 'layered',
  layers: { platform: 'auto', hideCjkFonts: true },
  blockedFamilies: []
};

// 仅识别 v2 历史默认集合；不随当前内置名单扩展而改变迁移判定。
const LEGACY_DEFAULT_CANVAS_TARGET_FONTS = [
  'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei',
  'KaiTi', 'FangSong', 'DengXian',
  'PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong', 'Songti SC',
  'Source Han Sans CN', 'Source Han Sans SC',
  'Noto Sans CJK SC', 'Noto Serif CJK SC',
  'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei',
  'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB',
  'PingFang TC', 'PingFang HK', 'Source Han Sans TW', 'Noto Sans CJK TC'
];

interface LegacyCanvasConfig {
  enabled?: boolean;
  targetFonts?: string[];
}

type ConfigInput = Omit<Partial<SiteSpoofConfig>, 'schemaVersion'> & {
  schemaVersion?: number;
  canvas?: LegacyCanvasConfig | null;
};

export const DEFAULT_SIGNAL_OVERRIDE: SignalOverride<never> = {
  mode: 'inherit',
  value: null
};

export const DEFAULT_RULE_DOMAINS = [
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'anthropic.com',
  'gemini.google.com',
  'copilot.microsoft.com',
  'google.com',
  'bing.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'reddit.com',
  'linkedin.com'
];

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

// ISO 3166-1 alpha-2；未知/保留代码不转换成推测的国家。
const COUNTRY_CODES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT '
  + 'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ '
  + 'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ '
  + 'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

export function normalizeCountryCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return COUNTRY_CODES.has(code) ? code : null;
}

export function normalizeLanguages(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  return String(value || '').split(',').map((item) => normalizeString(item)).filter(Boolean);
}

export function getDefaultLanguages(language: string): string[] {
  const primary = normalizeString(language) || DEFAULT_LANGUAGE.language;
  return [...new Set([primary, primary.split('-')[0], 'en'])];
}

export function getAcceptLanguageValue(languages: readonly string[]): string {
  // HTTP q 最多三位小数；入口限制1000项，保持每项正权重且严格递减。
  const step = Math.min(100, Math.floor(1000 / languages.length));
  return languages.map((language, index) => index ? `${language};q=${(1000 - index * step) / 1000}` : language).join(',');
}

export function normalizeLanguage(config: Partial<LanguageConfig> | null | undefined): LanguageConfig {
  const input = config || {};
  const languages = normalizeLanguages(input.languages);
  const language = normalizeString(input.language || languages[0] || DEFAULT_LANGUAGE.language);
  const fallbackLanguages = languages.length ? languages : getDefaultLanguages(language);
  const normalizedLanguages = language
    ? [language, ...fallbackLanguages.filter((item) => item !== language)]
    : fallbackLanguages;
  return {
    enabled: input.enabled !== false,
    mode: input.mode === 'custom' ? 'custom' : 'preset',
    language,
    languages: normalizedLanguages
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

export function parseWebRtcMode(value: unknown): WebRtcMode {
  if (value === 'default' || value === 'compatible' || value === 'strict') return value;
  throw new Error('webRtc.globalMode：请选择 default / compatible / strict');
}

// 内部配置只使用领域模式；旧 policy 字段由迁移入口转换。
export function normalizeWebRtc(config: WebRtcConfig): WebRtcConfig {
  return { globalMode: parseWebRtcMode(config.globalMode) };
}

export function migrateLegacyWebRtc(config: { globalMode?: string; policy?: string; enabled?: boolean }): WebRtcConfig {
  const raw = config.globalMode ?? config.policy;
  if (raw !== undefined && !['default', 'off', 'compatible', 'default_public_interface_only', 'strict', 'disable_non_proxied_udp'].includes(raw)) {
    throw new Error('旧 WebRTC 策略无效：请使用 default / compatible / strict');
  }
  if (config.enabled === false || raw === 'off' || raw === 'default') return { globalMode: 'default' };
  if (raw === 'default_public_interface_only') return { globalMode: 'compatible' };
  if (raw === undefined || raw === 'disable_non_proxied_udp') return { globalMode: 'strict' };
  return { globalMode: parseWebRtcMode(raw) };
}

function fontFamilyKey(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '').toLowerCase();
}

function normalizeFontFamilies(value: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).reduce<string[]>((families, item) => {
    if (typeof item !== 'string') return families;
    const family = item.trim();
    const key = fontFamilyKey(family);
    if (key && !seen.has(key)) {
      seen.add(key);
      families.push(family);
    }
    return families;
  }, []);
}

export function normalizeFontExposure(config: Partial<FontExposureConfig> | null | undefined): FontExposureConfig {
  const input = config || {};
  const mode = input.mode === 'custom' || input.mode === 'layered' ? input.mode : 'vendor-software';
  const canvasInput = (input.canvasSpoof || {}) as Partial<FontExposureConfig['canvasSpoof']>;
  return {
    enabled: Boolean(input.enabled),
    mode,
    ...(mode === 'layered' ? { layers: { platform: input.layers?.platform === 'none' ? 'none' as const : 'auto' as const,
      hideCjkFonts: input.layers?.hideCjkFonts !== false } } : {}),
    canvasSpoof: {
      enabled: Boolean(canvasInput.enabled),
      platform: canvasInput.platform === 'windows' ? 'windows' : 'macos'
    },
    blockedFamilies: mode !== 'vendor-software'
      ? normalizeFontFamilies(input.blockedFamilies)
      : [...VENDOR_SOFTWARE_FONT_FAMILIES]
  };
}

function migrateLegacyCanvas(config: LegacyCanvasConfig | null | undefined): FontExposureConfig {
  if (!config?.enabled) return clone(DEFAULT_FONT_EXPOSURE);
  const families = normalizeFontFamilies(config.targetFonts ?? LEGACY_DEFAULT_CANVAS_TARGET_FONTS);
  const keys = new Set(families.map(fontFamilyKey));
  const isLegacyDefault = keys.size === LEGACY_DEFAULT_CANVAS_TARGET_FONTS.length
    && LEGACY_DEFAULT_CANVAS_TARGET_FONTS.every((family) => keys.has(fontFamilyKey(family)));
  return normalizeFontExposure({ enabled: true, mode: isLegacyDefault ? 'vendor-software' : 'custom', blockedFamilies: families });
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

export function isIpv4Address(domain: string): boolean {
  const parts = domain.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255 && String(value) === String(Number(part));
  });
}

export function isValidIpAddress(value: unknown): boolean {
  const input = normalizeString(value);
  if (isIpv4Address(input)) return true;
  if (!input.includes(':')) return false;
  try {
    return new URL(`http://[${input}]/`).hostname.includes(':');
  } catch {
    return false;
  }
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.includes('*') || domain.length > 253) return false;
  if (domain === 'localhost') return true;
  if (isIpv4Address(domain)) return true;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function normalizeRule(rule: Partial<SiteRule> | null | undefined): SiteRule {
  const input = rule || {};
  const language = normalizeOverride(input.overrides?.language);
  if (language.value && typeof language.value === 'object') {
    const { acceptLanguage: _obsolete, ...value } = language.value as Partial<LanguageConfig> & { acceptLanguage?: unknown };
    language.value = value;
  }
  return {
    id: normalizeString(input.id) || `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    domain: normalizeDomain(input.domain),
    enabled: input.enabled !== false,
    compatibilityPreset: input.compatibilityPreset ?? 'full',
    exitLocationProfileId: normalizeString(input.exitLocationProfileId) || null,
    overrides: {
      language,
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

function defaultRules(): SiteRule[] {
  return DEFAULT_RULE_DOMAINS.map((domain) => createRule(domain));
}

export const DEFAULT_CONFIG: SiteSpoofConfig = {
  schemaVersion: 5,
  intlMode: 'strict',
  masterEnabled: true,
  debugMode: false,
  globalProfile: {
    language: DEFAULT_LANGUAGE,
    timezone: DEFAULT_TIMEZONE,
    geolocation: DEFAULT_GEOLOCATION
  },
  webRtc: DEFAULT_WEBRTC,
  fontExposure: DEFAULT_FONT_EXPOSURE,
  profile: {
    activeProfileId: null,
    profiles: []
  },
  exitLocationProfiles: [],
  rules: defaultRules()
};

// 历史缺省值继续用于旧配置归一化；只有首次建档和明确重置使用安全初始值。
export function createInitialConfig(): SiteSpoofConfig {
  return { ...clone(DEFAULT_CONFIG), masterEnabled: false, webRtc: { globalMode: 'default' }, rules: [] };
}

export function getProfileValidationErrors(value: unknown, seenIds: ReadonlySet<string> = new Set()): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Profile：必须是完整的方案对象'];
  const profile = value as Partial<Profile>;
  const errors: string[] = [];
  const id = typeof profile.id === 'string' ? profile.id.trim() : '';
  if (!id) errors.push('id：请填写非空的方案 ID');
  else if (seenIds.has(id)) errors.push('ID：重复，请为每个方案设置不同的 id');
  if (typeof profile.name !== 'string' || !profile.name.trim()) errors.push('name：请填写非空的方案名称');
  const { latitude, longitude, accuracy } = profile.geolocation || {};
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push('latitude：请填写 [-90,90] 范围内的有限数值');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push('longitude：请填写 [-180,180] 范围内的有限数值');
  }
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0) {
    errors.push('accuracy：请填写大于 0 的有限数值');
  }
  if (typeof profile.timezone?.timezone !== 'string' || !validateTimezone(profile.timezone.timezone)) {
    errors.push('timezone：请填写有效的 IANA 时区，例如 UTC 或 Asia/Shanghai');
  }
  const language = profile.language;
  if (!language || typeof language.language !== 'string' || !language.language.trim()
    || !Array.isArray(language.languages) || !language.languages.length
    || language.languages.some((item) => typeof item !== 'string' || !item.trim())) {
    errors.push('language：请填写主语言和非空语言列表');
  }
  return errors;
}

export function validateProfile(value: unknown): value is Profile {
  return getProfileValidationErrors(value).length === 0;
}

export function getProfilesValidationErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['profile.profiles：请提供方案数组'];
  const seen = new Set<string>();
  return value.flatMap((profile, index) => {
    const errors = getProfileValidationErrors(profile, seen).map((error) => `profile.profiles[${index}] ${error}`);
    if (typeof profile?.id === 'string' && profile.id.trim()) seen.add(profile.id.trim());
    return errors;
  });
}

export function normalizeProfiles(value: unknown): Profile[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .filter((profile): profile is Profile => {
      if (getProfileValidationErrors(profile, seen).length) return false;
      seen.add(profile.id.trim());
      return true;
    })
    .map((normalized) => {
      const geolocation = normalized.geolocation;
      const timezone = normalized.timezone;
      return {
        id: normalizeString(normalized.id),
        name: normalizeString(normalized.name),
        description: normalized.description ? normalizeString(normalized.description) : undefined,
        geolocation: {
          latitude: geolocation.latitude,
          longitude: geolocation.longitude,
          accuracy: geolocation.accuracy,
          country: normalizeString(geolocation.country)
        },
        language: normalizeLanguage(normalized.language as Partial<LanguageConfig>),
        timezone: {
          timezone: normalizeString(timezone.timezone)
        }
      };
    });
}

export function normalizeExitLocationProfiles(value: unknown): ExitLocationProfile[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map((value) => {
      const input = value && typeof value === 'object' ? value as Partial<ExitLocationProfile> : {};
      const id = normalizeString(input.id);
      const name = normalizeString(input.name);
      const latitude = normalizeNumber(input.latitude);
      const longitude = normalizeNumber(input.longitude);
      const country = normalizeString(input.country);
      const timezone = validateTimezone(normalizeString(input.timezone)) ? normalizeString(input.timezone) : null;
      const publicIp = isValidIpAddress(input.publicIp) ? normalizeString(input.publicIp) : null;
      const provider = normalizeString(input.provider) || null;
      const verifiedAt = Number.isFinite(Number(input.verifiedAt)) && Number(input.verifiedAt) > 0
        ? Number(input.verifiedAt)
        : null;
      const verified = input.verification === 'verified'
        && publicIp !== null
        && country !== ''
        && timezone !== null
        && provider !== null
        && verifiedAt !== null;

      return {
        id,
        name,
        verification: verified ? 'verified' as const : 'unverified' as const,
        publicIp: verified ? publicIp : null,
        latitude: latitude ?? Number.NaN,
        longitude: longitude ?? Number.NaN,
        country,
        ...(input.countryCode !== undefined ? { countryCode: normalizeCountryCode(input.countryCode) } : {}),
        timezone,
        provider: verified ? provider : null,
        verifiedAt: verified ? verifiedAt : null,
        ...(input.managedBy === 'automatic-exit' ? { managedBy: input.managedBy } : {})
      };
    })
    .filter((profile) => {
      if (!profile.id || !profile.name || seen.has(profile.id)) return false;
      if (!Number.isFinite(profile.latitude) || profile.latitude < -90 || profile.latitude > 90) return false;
      if (!Number.isFinite(profile.longitude) || profile.longitude < -180 || profile.longitude > 180) return false;
      seen.add(profile.id);
      return true;
    });
}

// 可信内部值的规范化／构造工具；外部导入和存储必须先经 validateConfig 或历史迁移入口。
export function normalizeConfig(config: ConfigInput | null | undefined): SiteSpoofConfig {
  const input = config || {};
  const globalProfile = (input.globalProfile || {}) as Partial<SiteSpoofConfig['globalProfile']>;
  const profile = (input.profile || {}) as Partial<SiteSpoofConfig['profile']>;
  const profiles = normalizeProfiles(profile.profiles);
  const activeProfileId = normalizeString(profile.activeProfileId);
  const fontExposure = input.fontExposure ? normalizeFontExposure(input.fontExposure)
    : input.schemaVersion === 3 || input.schemaVersion === 5 ? clone(DEFAULT_FONT_EXPOSURE) : migrateLegacyCanvas(input.canvas);
  if (input.schemaVersion === 2 || input.schemaVersion === 3) {
    fontExposure.mode = 'layered';
    fontExposure.layers = { platform: 'auto', hideCjkFonts: true };
  }
  return {
    schemaVersion: 5,
    intlMode: input.intlMode === 'compatible' ? 'compatible' : 'strict',
    masterEnabled: input.masterEnabled !== false,
    debugMode: Boolean(input.debugMode),
    globalProfile: {
      language: normalizeLanguage(globalProfile.language || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone(globalProfile.timezone || DEFAULT_TIMEZONE),
      geolocation: normalizeGeolocation(globalProfile.geolocation || DEFAULT_GEOLOCATION)
    },
    webRtc: normalizeWebRtc(input.webRtc || DEFAULT_WEBRTC),
    fontExposure,
    profile: {
      activeProfileId: profiles.some((item) => item.id === activeProfileId) ? activeProfileId : null,
      profiles
    },
    exitLocationProfiles: normalizeExitLocationProfiles(input.exitLocationProfiles).map(profile => {
      if (input.schemaVersion !== undefined && input.schemaVersion < 5) {
        const { managedBy: _managedBy, ...legacy } = profile;
        return legacy;
      }
      return profile;
    }),
    rules: Array.isArray(input.rules) ? input.rules.map(normalizeRule) : defaultRules()
  };
}

export function validateTimezone(timezone: string): boolean {
  const value = normalizeString(timezone);
  if (!value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getTimezoneOffsetMinutes(timezone: string, dateInput?: Date | string | number): number | null {
  const value = normalizeString(timezone);
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput ?? Date.now());
  if (!validateTimezone(value) || Number.isNaN(date.getTime())) return null;

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
