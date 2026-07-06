import type {
  CanvasConfig,
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

function defaultRules(): SiteRule[] {
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
    activeProfileId: null,
    profiles: []
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

export function normalizeConfig(config: Partial<SiteSpoofConfig> | null | undefined): SiteSpoofConfig {
  const input = config || {};
  const globalProfile = (input.globalProfile || {}) as Partial<SiteSpoofConfig['globalProfile']>;
  const profile = (input.profile || {}) as Partial<SiteSpoofConfig['profile']>;
  return {
    schemaVersion: 1,
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
      activeProfileId: normalizeString(profile.activeProfileId) || null,
      profiles: normalizeProfiles(profile.profiles)
    },
    rules: Array.isArray(input.rules) ? input.rules.map(normalizeRule) : defaultRules()
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

export function formatTimezoneOffsetMinutes(offset: number | null): string | null {
  if (!Number.isFinite(Number(offset))) return null;
  const normalized = Number(offset);
  const sign = normalized <= 0 ? '+' : '-';
  const abs = Math.abs(normalized);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
