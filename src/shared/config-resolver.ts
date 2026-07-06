import {
  DEFAULT_CANVAS,
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC,
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  OLD_EXTENSION_ENABLED_KEY,
  OLD_LANGUAGE_KEY,
  OLD_TIMEZONE_KEY,
  OLD_WEBRTC_KEY,
  SITE_CONFIG_KEY,
  clone,
  createRule,
  isValidDomain,
  normalizeCanvas,
  normalizeConfig,
  normalizeDomain,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeString,
  normalizeTimezone,
  normalizeWebRtc,
  parseHostname,
  validateTimezone
} from './config-model';
import type {
  CanvasConfig,
  EffectiveProfileResult,
  GeolocationConfig,
  LanguageConfig,
  LastLocation,
  SignalOverride,
  SiteRule,
  SiteSpoofConfig,
  TimezoneConfig
} from './types';

function validateLanguage(language: LanguageConfig, path: string, errors: string[]): void {
  if (!normalizeString(language.language)) {
    errors.push(`${path}: language is required`);
  }
  if (!Array.isArray(language.languages) || language.languages.length === 0 || language.languages.some((item) => !normalizeString(item))) {
    errors.push(`${path}: navigator.languages must not be empty`);
  }
  if (!normalizeString(language.acceptLanguage)) {
    errors.push(`${path}: Accept-Language is required`);
  }
}

function validateGeolocation(geolocation: GeolocationConfig, path: string, errors: string[]): void {
  if (geolocation.mode !== 'manual') return;
  if (!Number.isFinite(geolocation.latitude) || Number(geolocation.latitude) < -90 || Number(geolocation.latitude) > 90) {
    errors.push(`${path}: latitude must be between -90 and 90`);
  }
  if (!Number.isFinite(geolocation.longitude) || Number(geolocation.longitude) < -180 || Number(geolocation.longitude) > 180) {
    errors.push(`${path}: longitude must be between -180 and 180`);
  }
}

export function validateConfig(config: Partial<SiteSpoofConfig>): { ok: boolean; errors: string[]; config: SiteSpoofConfig } {
  const normalized = normalizeConfig(config);
  const errors: string[] = [];
  const seen = new Set<string>();

  validateLanguage(normalized.globalProfile.language, 'global language', errors);
  if (normalized.globalProfile.timezone.mode === 'manual' && !validateTimezone(normalized.globalProfile.timezone.timezone)) {
    errors.push('global timezone: custom timezone must be a valid IANA timezone');
  }
  validateGeolocation(normalized.globalProfile.geolocation, 'global geolocation', errors);

  normalized.rules.forEach((rule, index) => {
    const path = `rule ${index + 1}`;
    if (!isValidDomain(rule.domain)) {
      errors.push(`${path}: domain is invalid`);
    }
    if (seen.has(rule.domain)) {
      errors.push(`${path}: duplicate domain`);
    }
    seen.add(rule.domain);

    if (rule.overrides.language.mode === 'override') {
      validateLanguage(normalizeLanguage(rule.overrides.language.value || {}), `${path} language`, errors);
    }
    if (rule.overrides.timezone.mode === 'override') {
      const timezone = normalizeTimezone(rule.overrides.timezone.value || {});
      if (timezone.mode === 'manual' && !validateTimezone(timezone.timezone)) {
        errors.push(`${path} timezone: custom timezone must be a valid IANA timezone`);
      }
    }
    if (rule.overrides.geolocation.mode === 'override') {
      validateGeolocation(normalizeGeolocation(rule.overrides.geolocation.value || { mode: 'manual' }), `${path} geolocation`, errors);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    config: normalized
  };
}

export function domainMatches(hostname: string, domain: string): boolean {
  const host = parseHostname(hostname);
  return host === domain || host.endsWith(`.${domain}`);
}

export function findMatchingRule(config: Partial<SiteSpoofConfig>, hostname: string): SiteRule | null {
  const normalized = normalizeConfig(config);
  return normalized.rules
    .filter((rule) => rule.enabled && domainMatches(hostname, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
}

export function getEnabledRuleDomains(config: Partial<SiteSpoofConfig>): string[] {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return [];

  const seen = new Set<string>();
  return normalized.rules.reduce<string[]>((domains, rule) => {
    if (!rule.enabled || !rule.domain || seen.has(rule.domain)) return domains;
    seen.add(rule.domain);
    domains.push(rule.domain);
    return domains;
  }, []);
}

export function buildContentScriptMatchesForDomain(domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];

  const patterns = [`*://${normalized}/*`];
  if (normalized !== 'localhost') {
    patterns.push(`*://*.${normalized}/*`);
  }
  return patterns;
}

export function getContentScriptMatches(config: Partial<SiteSpoofConfig>): string[] {
  return getEnabledRuleDomains(config).reduce<string[]>((matches, domain) => (
    matches.concat(buildContentScriptMatchesForDomain(domain))
  ), []);
}

export function isUrlMatchedByEnabledRule(config: Partial<SiteSpoofConfig>, url: string): boolean {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return false;
  const hostname = parseHostname(url);
  if (!hostname) return false;

  return normalized.rules.some((rule) => rule.enabled && domainMatches(hostname, rule.domain));
}

function resolveSignal<T extends { enabled: boolean }>(
  globalValue: T,
  override: SignalOverride<Partial<T>>,
  normalizer: (value: Partial<T>) => T
): T | null {
  if (!override || override.mode === 'inherit') {
    return globalValue.enabled ? globalValue : null;
  }
  if (override.mode === 'disable') return null;
  return normalizer(override.value || {});
}

function resolveTimezoneValue(
  timezoneConfig: TimezoneConfig | null,
  geolocation: (GeolocationConfig & { timezone?: string | null }) | null,
  lastLocation: LastLocation | null
): { timezone: string | null; source: 'manual' | 'lastLocation' | null } {
  if (!timezoneConfig) return { timezone: null, source: null };
  if (timezoneConfig.mode === 'manual' && timezoneConfig.timezone) {
    return { timezone: timezoneConfig.timezone, source: 'manual' };
  }
  if (geolocation && geolocation.timezone) {
    return { timezone: geolocation.timezone, source: 'lastLocation' };
  }
  return {
    timezone: lastLocation && lastLocation.timezone ? lastLocation.timezone : null,
    source: lastLocation && lastLocation.timezone ? 'lastLocation' : null
  };
}

function resolveManualGeolocation(geolocationConfig: GeolocationConfig): GeolocationConfig | null {
  if (!Number.isFinite(geolocationConfig.latitude) || !Number.isFinite(geolocationConfig.longitude)) {
    return null;
  }
  return {
    ...geolocationConfig,
    latitude: Number(geolocationConfig.latitude),
    longitude: Number(geolocationConfig.longitude)
  };
}

function resolveGeolocationValue(
  geolocationConfig: GeolocationConfig | null,
  lastLocation: LastLocation | null
): (GeolocationConfig & { latitude: number; longitude: number; timezone?: string | null }) | null {
  if (!geolocationConfig) return null;
  if (geolocationConfig.mode === 'manual') {
    const manual = resolveManualGeolocation(geolocationConfig);
    return manual as (GeolocationConfig & { latitude: number; longitude: number }) | null;
  }
  if (!lastLocation || !Number.isFinite(Number(lastLocation.latitude)) || !Number.isFinite(Number(lastLocation.longitude))) {
    return null;
  }
  return {
    ...geolocationConfig,
    latitude: Number(lastLocation.latitude),
    longitude: Number(lastLocation.longitude),
    country: lastLocation.country || '',
    timezone: lastLocation.timezone || null
  };
}

export function getEffectiveProfile(config: Partial<SiteSpoofConfig>, hostname: string, lastLocation: LastLocation | null): EffectiveProfileResult {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }

  const rule = findMatchingRule(normalized, hostname);
  if (!rule) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }

  const language = resolveSignal(normalized.globalProfile.language, rule.overrides.language, normalizeLanguage);
  const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
  const geolocationConfig = resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation);
  const geolocation = resolveGeolocationValue(geolocationConfig, lastLocation);
  const timezone = resolveTimezoneValue(timezoneConfig, geolocation, lastLocation);
  const canvas = normalizeCanvas(normalized.canvas);
  const errors: string[] = [];

  if (geolocationConfig && !geolocation) {
    errors.push('geolocation is enabled but no valid coordinates are available');
  }
  if (timezoneConfig && !timezone.timezone) {
    errors.push('timezone is enabled but no valid timezone is available');
  }

  if (errors.length) {
    return { matched: true, rule, payload: null, errors };
  }

  return {
    matched: true,
    rule,
    payload: {
      extensionEnabled: true,
      debugMode: normalized.debugMode,
      ruleId: rule.id,
      domain: rule.domain,
      geolocation,
      latitude: geolocation ? geolocation.latitude : null,
      longitude: geolocation ? geolocation.longitude : null,
      timezone: timezone.timezone,
      timezoneSource: timezone.source,
      languageConfig: language,
      timezoneConfig: timezoneConfig ? {
        enabled: true,
        mode: timezoneConfig.mode,
        timezone: timezoneConfig.timezone
      } : { enabled: false, mode: 'auto', timezone: '' },
      canvasConfig: canvas
    },
    errors: []
  };
}

function legacyDomainToRule(input: string): SiteRule | null {
  const withoutWildcard = normalizeString(input).replace(/^\*\./, '').replace(/\*/g, '');
  const domain = normalizeDomain(withoutWildcard);
  return isValidDomain(domain) ? createRule(domain) : null;
}

function convertVanishMeConfig(input: Record<string, any>): SiteSpoofConfig {
  const siteRules = input.siteRules && typeof input.siteRules === 'object' ? input.siteRules : {};
  const rules = [
    ...((input.matchMode === 'whitelist' || !input.matchMode) && Array.isArray(input.domainList)
      ? input.domainList.map(legacyDomainToRule).filter(Boolean) as SiteRule[]
      : []),
    ...Object.entries(siteRules)
      .filter(([, value]) => value && typeof value === 'object' && (value as { enabled?: boolean }).enabled)
      .map(([domain]) => legacyDomainToRule(domain))
      .filter(Boolean) as SiteRule[]
  ];

  return normalizeConfig({
    masterEnabled: input.globalEnabled !== false,
    debugMode: Boolean(input.debugMode),
    globalProfile: {
      language: normalizeLanguage(input.language || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone({
        enabled: input.timezone?.enabled !== false,
        mode: input.timezone?.timezone ? 'manual' : 'auto',
        timezone: input.timezone?.timezone || ''
      }),
      geolocation: normalizeGeolocation({
        ...(input.geolocation || DEFAULT_GEOLOCATION),
        mode: input.geolocation?.latitude && input.geolocation?.longitude ? 'manual' : 'auto'
      })
    },
    webRtc: normalizeWebRtc(input.webrtc || DEFAULT_WEBRTC),
    canvas: normalizeCanvas(input.canvas || DEFAULT_CANVAS),
    profile: {
      activeProfileId: input.profile?.activeProfileId || null,
      profiles: input.profile?.profiles || []
    },
    rules: rules.length ? rules : undefined
  });
}

export function migrateLegacyConfig(storageData: Record<string, any>): SiteSpoofConfig {
  const input = storageData || {};
  if (input[SITE_CONFIG_KEY]) {
    return normalizeConfig(input[SITE_CONFIG_KEY]);
  }
  if (input[LEGACY_VANISHME_CONFIG_KEY]) {
    return convertVanishMeConfig(input[LEGACY_VANISHME_CONFIG_KEY]);
  }
  return normalizeConfig({
    masterEnabled: input[OLD_EXTENSION_ENABLED_KEY] !== false,
    globalProfile: {
      language: normalizeLanguage(input[OLD_LANGUAGE_KEY] || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone(input[OLD_TIMEZONE_KEY] || DEFAULT_TIMEZONE),
      geolocation: clone(DEFAULT_GEOLOCATION)
    },
    webRtc: normalizeWebRtc(input[OLD_WEBRTC_KEY] || DEFAULT_WEBRTC),
    rules: []
  });
}

export {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  SITE_CONFIG_KEY
};

export type { CanvasConfig, GeolocationConfig, LanguageConfig, LastLocation, SiteSpoofConfig, TimezoneConfig };
