import type {
  CanvasConfig,
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
  targetFonts: [
    'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei',
    'KaiTi', 'FangSong', 'DengXian',
    'PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong', 'Songti SC',
    'Source Han Sans CN', 'Source Han Sans SC',
    'Noto Sans CJK SC', 'Noto Serif CJK SC',
    'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei',
    'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB',
    'PingFang TC', 'PingFang HK', 'Source Han Sans TW', 'Noto Sans CJK TC'
  ]
};

export const DEFAULT_SIGNAL_OVERRIDE: SignalOverride<never> = {
  mode: 'inherit',
  value: null
};

export const LANGUAGE_PRESETS = [
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

const DEFAULT_RULE_DOMAINS = [
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

export function normalizeCanvas(config: Partial<CanvasConfig> | null | undefined): CanvasConfig {
  const input = config || {};
  return {
    enabled: Boolean(input.enabled),
    spoofFonts: input.spoofFonts !== false,
    targetFonts: Array.isArray(input.targetFonts)
      ? input.targetFonts.map((item) => normalizeString(item)).filter(Boolean)
      : clone(DEFAULT_CANVAS.targetFonts)
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
  return {
    id: normalizeString(input.id) || `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    domain: normalizeDomain(input.domain),
    enabled: input.enabled !== false,
    exitLocationProfileId: normalizeString(input.exitLocationProfileId) || null,
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

function defaultRules(): SiteRule[] {
  return DEFAULT_RULE_DOMAINS.map((domain) => createRule(domain));
}

export const DEFAULT_CONFIG: SiteSpoofConfig = {
  schemaVersion: 2,
  intlMode: 'strict',
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
    || language.languages.some((item) => typeof item !== 'string' || !item.trim())
    || typeof language.acceptLanguage !== 'string' || !language.acceptLanguage.trim()) {
    errors.push('language：请填写主语言、非空语言列表和 Accept-Language');
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
        timezone,
        provider: verified ? provider : null,
        verifiedAt: verified ? verifiedAt : null
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

export function normalizeConfig(config: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  const input = config || {};
  const globalProfile = (input.globalProfile || {}) as Partial<SiteSpoofConfig['globalProfile']>;
  const profile = (input.profile || {}) as Partial<SiteSpoofConfig['profile']>;
  const profiles = normalizeProfiles(profile.profiles);
  const activeProfileId = normalizeString(profile.activeProfileId);
  return {
    schemaVersion: 2,
    intlMode: input.intlMode === 'compatible' ? 'compatible' : 'strict',
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
      activeProfileId: profiles.some((item) => item.id === activeProfileId) ? activeProfileId : null,
      profiles
    },
    exitLocationProfiles: normalizeExitLocationProfiles(input.exitLocationProfiles),
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

export function formatTimezoneOffsetMinutes(offset: number | null): string | null {
  if (!Number.isFinite(Number(offset))) return null;
  const normalized = Number(offset);
  const sign = normalized <= 0 ? '+' : '-';
  const abs = Math.abs(normalized);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
