import {
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC,
  LAST_LOCATION_KEY,
  LEGACY_EXIT_LOCATION_PROFILE_ID,
  LEGACY_VANISHME_CONFIG_KEY,
  OLD_EXTENSION_ENABLED_KEY,
  OLD_LANGUAGE_KEY,
  OLD_TIMEZONE_KEY,
  OLD_WEBRTC_KEY,
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY,
  clone,
  createInitialConfig,
  createRule,
  isIpv4Address,
  isValidDomain,
  normalizeFontExposure,
  normalizeConfig,
  normalizeDomain,
  normalizeGeolocation,
  getProfilesValidationErrors,
  normalizeLanguage,
  normalizeString,
  normalizeTimezone,
  normalizeWebRtc,
  parseHostname,
  validateTimezone
} from './config-model';
import type {
  FontExposureConfig,
  EffectiveProfileResult,
  ExitLocationProfile,
  GeolocationConfig,
  LanguageConfig,
  LanguageTimezonePayload,
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

export function validateConfig(config: unknown): { ok: boolean; errors: string[]; config: SiteSpoofConfig } {
  const isConfigObject = config !== null && typeof config === 'object' && !Array.isArray(config);
  const input = isConfigObject ? config as Record<string, any> : {};
  // 保留原始方案的错误；归一化后的过滤结果不能证明导入成功。
  const errors = getProfilesValidationErrors(input.profile?.profiles);
  if (!isConfigObject) errors.push('配置：请提供配置对象');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 2 && input.schemaVersion !== 3) {
    errors.push('schemaVersion：仅支持 v2 或 v3 配置');
  }
  if (input.intlMode !== undefined && input.intlMode !== 'strict' && input.intlMode !== 'compatible') {
    errors.push('intlMode：请选择 strict 或 compatible');
  }
  for (const [path, familiesKey] of [['fontExposure', 'blockedFamilies'], ['canvas', 'targetFonts']] as const) {
    const fontConfig = input[path];
    if (fontConfig === undefined) continue;
    if (!fontConfig || typeof fontConfig !== 'object' || Array.isArray(fontConfig)) {
      errors.push(`${path}：请提供字体配置对象`);
      continue;
    }
    if (fontConfig.enabled !== undefined && typeof fontConfig.enabled !== 'boolean') {
      errors.push(`${path}.enabled：请提供布尔值`);
    }
    if (path === 'fontExposure' && fontConfig.mode !== undefined
      && fontConfig.mode !== 'vendor-software' && fontConfig.mode !== 'custom') {
      errors.push('fontExposure.mode：请选择 vendor-software 或 custom');
    }
    const families = fontConfig[familiesKey];
    if (families !== undefined && (!Array.isArray(families) || families.some((family) => typeof family !== 'string'))) {
      errors.push(`${path}.${familiesKey}：请提供字体名称字符串数组`);
    }
  }
  const normalized = normalizeConfig(input);
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
    if (!rule.enabled || !rule.domain || !isValidDomain(rule.domain) || seen.has(rule.domain)) return domains;
    seen.add(rule.domain);
    domains.push(rule.domain);
    return domains;
  }, []);
}

export function repairInvalidRuleDomains(config: Partial<SiteSpoofConfig>): { config: SiteSpoofConfig; repaired: boolean } {
  const normalized = normalizeConfig(config);
  const validRules = normalized.rules.filter((rule) => isValidDomain(rule.domain));
  if (validRules.length === normalized.rules.length) {
    return { config: normalized, repaired: false };
  }
  return {
    config: normalizeConfig({ ...normalized, rules: validRules }),
    repaired: true
  };
}

export function buildContentScriptMatchesForDomain(domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized || !isValidDomain(normalized)) return [];

  const patterns = [`*://${normalized}/*`];
  if (normalized !== 'localhost' && !isIpv4Address(normalized)) {
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
  const resolved = normalizer(override.value || {});
  return resolved.enabled ? resolved : null;
}

export function resolveEffectiveLanguageForRule(config: SiteSpoofConfig, rule: SiteRule): LanguageConfig | null {
  return resolveSignal(config.globalProfile.language, rule.overrides.language, normalizeLanguage);
}

function resolveTimezoneValue(
  timezoneConfig: TimezoneConfig | null,
  exitLocationProfile: ExitLocationProfile | null
): { timezone: string | null; source: 'manual' | 'exitProfile' | null } {
  if (!timezoneConfig) return { timezone: null, source: null };
  if (timezoneConfig.mode === 'manual' && timezoneConfig.timezone) {
    return { timezone: timezoneConfig.timezone, source: 'manual' };
  }
  return {
    timezone: exitLocationProfile?.timezone || null,
    source: exitLocationProfile?.timezone ? 'exitProfile' : null
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
  exitLocationProfile: ExitLocationProfile | null
): (GeolocationConfig & { latitude: number; longitude: number; timezone?: string | null }) | null {
  if (!geolocationConfig) return null;
  if (geolocationConfig.mode === 'manual') {
    const manual = resolveManualGeolocation(geolocationConfig);
    return manual as (GeolocationConfig & { latitude: number; longitude: number }) | null;
  }
  if (!exitLocationProfile) {
    return null;
  }
  return {
    ...geolocationConfig,
    latitude: exitLocationProfile.latitude,
    longitude: exitLocationProfile.longitude,
    country: exitLocationProfile.country,
    timezone: exitLocationProfile.timezone
  };
}

function resolveProfile(config: Partial<SiteSpoofConfig>, hostname: string, includeGeolocation: boolean): EffectiveProfileResult {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }

  const rule = findMatchingRule(normalized, hostname);
  if (!rule) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }

  const language = resolveEffectiveLanguageForRule(normalized, rule);
  const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
  const geolocationConfig = includeGeolocation ? resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation) : null;
  const needsExitLocationProfile = geolocationConfig?.mode === 'auto' || timezoneConfig?.mode === 'auto';
  const selectedProfile = rule.exitLocationProfileId
    ? normalized.exitLocationProfiles.find((profile) => profile.id === rule.exitLocationProfileId) || null
    : null;
  const exitLocationProfile = selectedProfile?.verification === 'verified' ? selectedProfile : null;
  const geolocation = resolveGeolocationValue(geolocationConfig, exitLocationProfile);
  const timezone = resolveTimezoneValue(timezoneConfig, exitLocationProfile);
  const fontExposure = normalizeFontExposure(normalized.fontExposure);
  const errors: string[] = [];

  if (needsExitLocationProfile && !rule.exitLocationProfileId) {
    errors.push('当前规则未选择出口位置档案');
  } else if (needsExitLocationProfile && !selectedProfile) {
    errors.push('当前规则引用的出口位置档案不存在');
  } else if (needsExitLocationProfile && !exitLocationProfile) {
    errors.push('当前规则选择的出口位置档案尚未验证');
  }
  if (geolocationConfig?.mode === 'manual' && !geolocation) {
    errors.push('地理位置已启用，但没有可用坐标');
  }
  if (timezoneConfig?.mode === 'manual' && !timezone.timezone) {
    errors.push('时区已启用，但没有可用时区');
  }

  if (errors.length) {
    return { matched: true, rule, payload: null, errors };
  }

  return {
    matched: true,
    rule,
    payload: {
      extensionEnabled: true,
      intlMode: normalized.intlMode,
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
      fontExposureConfig: fontExposure
    },
    errors: []
  };
}

export function getEffectiveProfile(config: Partial<SiteSpoofConfig>, hostname: string): EffectiveProfileResult {
  return resolveProfile(config, hostname, true);
}

// 首阶段只排除暂停的 geolocation；匹配、auto/verified 与语言时区解析仍由同一所有者执行。
export function getPageRuntimeProfile(config: Partial<SiteSpoofConfig>, hostname: string): EffectiveProfileResult {
  return resolveProfile(config, hostname, false);
}

export function getLanguageTimezonePayload(config: Partial<SiteSpoofConfig>, hostname: string): LanguageTimezonePayload | null {
  const payload = getPageRuntimeProfile(config, hostname).payload;
  if (!payload || (!payload.languageConfig && !payload.timezone)) return null;
  return {
    intlMode: payload.intlMode,
    ...(payload.languageConfig ? { language: { language: payload.languageConfig.language, languages: payload.languageConfig.languages.slice() } } : {}),
    ...(payload.timezone ? { timezone: payload.timezone } : {})
  };
}

function migrateLegacyLastLocation(config: SiteSpoofConfig, storageData: Record<string, any>): SiteSpoofConfig {
  const rawConfig = storageData[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
  if (rawConfig?.schemaVersion === 2 || rawConfig?.schemaVersion === 3
    || config.exitLocationProfiles.some((profile) => profile.id === LEGACY_EXIT_LOCATION_PROFILE_ID)) {
    return config;
  }

  const location = storageData[LAST_LOCATION_KEY] as {
    latitude?: unknown;
    longitude?: unknown;
    country?: unknown;
    timezone?: unknown;
  } | undefined;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return config;
  }

  const timezone = validateTimezone(normalizeString(location?.timezone)) ? normalizeString(location?.timezone) : null;
  return normalizeConfig({
    ...config,
    exitLocationProfiles: [
      ...config.exitLocationProfiles,
      {
        id: LEGACY_EXIT_LOCATION_PROFILE_ID,
        name: '待确认旧位置',
        verification: 'unverified',
        publicIp: null,
        latitude,
        longitude,
        country: normalizeString(location?.country),
        timezone,
        provider: null,
        verifiedAt: null
      }
    ]
  });
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
        mode: Number.isFinite(input.geolocation?.latitude) && Number.isFinite(input.geolocation?.longitude) ? 'manual' : 'auto'
      })
    },
    webRtc: normalizeWebRtc(input.webrtc || DEFAULT_WEBRTC),
    canvas: input.canvas,
    profile: {
      activeProfileId: input.profile?.activeProfileId || null,
      profiles: input.profile?.profiles || []
    },
    rules: rules.length ? rules : undefined
  });
}

function withDefaultRules(config: SiteSpoofConfig): SiteSpoofConfig {
  return normalizeConfig({ ...config, rules: undefined });
}

function shouldRepairUninitializedRules(storageData: Record<string, any>, config: SiteSpoofConfig): boolean {
  const rawConfig = storageData[SITE_CONFIG_KEY] as { schemaVersion?: number; rules?: SiteRule[] } | undefined;
  if (rawConfig?.schemaVersion === 2 || rawConfig?.schemaVersion === 3 || storageData[RULES_INITIALIZED_KEY] === true || !rawConfig || !Array.isArray(rawConfig.rules) || rawConfig.rules.length > 0) {
    return false;
  }

  return config.masterEnabled
    && config.globalProfile.geolocation.enabled
    && config.globalProfile.geolocation.mode === 'auto'
    && config.globalProfile.geolocation.latitude === null
    && config.globalProfile.geolocation.longitude === null
    && config.globalProfile.timezone.enabled
    && config.globalProfile.timezone.mode === 'auto'
    && config.globalProfile.timezone.timezone === ''
    && config.profile.activeProfileId === null
    && config.profile.profiles.length === 0;
}

export function migrateLegacyConfig(storageData: Record<string, any>): SiteSpoofConfig {
  const input = storageData || {};
  // 用数据存在性区分升级；关闭开关、空规则或缺少初始化标记均不代表首次安装。
  const hasConfiguration = [SITE_CONFIG_KEY, LEGACY_VANISHME_CONFIG_KEY, RULES_INITIALIZED_KEY,
    LAST_LOCATION_KEY, OLD_EXTENSION_ENABLED_KEY, OLD_LANGUAGE_KEY, OLD_TIMEZONE_KEY, OLD_WEBRTC_KEY]
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!hasConfiguration) return createInitialConfig();
  if (input[SITE_CONFIG_KEY]) {
    const config = normalizeConfig(input[SITE_CONFIG_KEY]);
    const repaired = shouldRepairUninitializedRules(input, config) ? withDefaultRules(config) : config;
    return migrateLegacyLastLocation(repaired, input);
  }
  if (input[LEGACY_VANISHME_CONFIG_KEY]) {
    return migrateLegacyLastLocation(convertVanishMeConfig(input[LEGACY_VANISHME_CONFIG_KEY]), input);
  }
  return migrateLegacyLastLocation(normalizeConfig({
    masterEnabled: input[OLD_EXTENSION_ENABLED_KEY] !== false,
    globalProfile: {
      language: normalizeLanguage(input[OLD_LANGUAGE_KEY] || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone(input[OLD_TIMEZONE_KEY] || DEFAULT_TIMEZONE),
      geolocation: clone(DEFAULT_GEOLOCATION)
    },
    webRtc: normalizeWebRtc(input[OLD_WEBRTC_KEY] || DEFAULT_WEBRTC)
  }), input);
}

export {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY
};

export type { FontExposureConfig, GeolocationConfig, LanguageConfig, SiteSpoofConfig, TimezoneConfig };
