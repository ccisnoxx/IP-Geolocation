import { getConfigInputErrors, getLegacyConfigErrors, getReleaseConfigErrors } from './config-validation';
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
  isValidIpAddress,
  normalizeFontExposure,
  normalizeConfig,
  normalizeDomain,
  normalizeGeolocation,
  getProfilesValidationErrors,
  normalizeLanguage,
  normalizeString,
  normalizeTimezone,
  migrateLegacyWebRtc,
  parseHostname,
  validateTimezone
} from './config-model';
import type {
  FontExposureConfig,
  EffectiveProfileResult,
  ExitLocationProfile,
  GeolocationConfig,
  GeolocationPayload,
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
  if (language.languages.length > 1000) errors.push(`${path}：语言列表最多1000项，以保持HTTP优先级可区分`);
  for (const locale of [language.language, ...language.languages]) {
    try { Intl.getCanonicalLocales(locale); }
    catch { errors.push(`${path}：语言标签必须是有效的BCP 47 locale`); break; }
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

export type ConfigValidationResult = { ok: true; errors: string[]; config: SiteSpoofConfig }
  | { ok: false; errors: string[]; config?: never };

export function validateConfig(config: unknown): ConfigValidationResult {
  if (config && typeof config === 'object' && 'schemaVersion' in config && config.schemaVersion === 4) {
    const errors = getReleaseConfigErrors(config);
    if (errors.length) return { ok: false, errors };
    const release = config as unknown as Omit<SiteSpoofConfig, 'schemaVersion'> & { canvas: {
      enabled: boolean; spoofFonts: boolean; platform: 'auto' | 'none'; hideCjkFonts: boolean; targetFonts: string[]
    } };
    config = { ...release, schemaVersion: 5, intlMode: 'strict', exitLocationProfiles: [],
      fontExposure: { enabled: release.canvas.enabled && release.canvas.spoofFonts, mode: 'layered',
        blockedFamilies: release.canvas.targetFonts, layers: { platform: release.canvas.platform, hideCjkFonts: release.canvas.hideCjkFonts },
        canvasSpoof: { enabled: false, platform: 'macos' } },
      rules: release.rules.map(rule => ({ ...rule, exitLocationProfileId: null }))
    };
  }
  const errors = getConfigInputErrors(config);
  if (errors.length) return { ok: false, errors };
  const input = config as Parameters<typeof normalizeConfig>[0];
  errors.push(...getProfilesValidationErrors(input?.profile?.profiles));
  const source = config as SiteSpoofConfig;
  validateLanguage(source.globalProfile.language, 'global language', errors);
  source.profile.profiles.forEach((profile, index) => validateLanguage(
    { ...profile.language, enabled: true, mode: 'preset' }, `profile.profiles[${index}].language`, errors));
  const exitIds = new Set<string>();
  for (const [index, profile] of source.exitLocationProfiles.entries()) {
    const path = `exitLocationProfiles[${index}]`;
    if (!profile.id.trim() || exitIds.has(profile.id.trim())) errors.push(`${path}.id：不能为空或重复`);
    exitIds.add(profile.id.trim());
    if (!profile.name.trim()) errors.push(`${path}.name：不能为空`);
    if (profile.verification === 'verified' && (!isValidIpAddress(profile.publicIp) || !profile.country.trim()
      || !profile.timezone || !validateTimezone(profile.timezone) || !profile.provider?.trim() || !profile.verifiedAt)) {
      errors.push(`${path}：verified 档案缺少有效的 IP、国家、时区、来源或验证时间`);
    }
  }
  const ruleIds = new Set<string>();
  source.rules.forEach((rule, index) => {
    if (!rule.id.trim() || ruleIds.has(rule.id.trim())) errors.push(`rules[${index}].id：不能为空或重复`);
    ruleIds.add(rule.id.trim());
  });
  const normalized = normalizeConfig(input);
  const seen = new Set<string>();

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

  return errors.length ? { ok: false, errors } : { ok: true, errors, config: normalized };
}

export function domainMatches(hostname: string, domain: string): boolean {
  const host = parseHostname(hostname);
  return host === domain || host.endsWith(`.${domain}`);
}

export function findMatchingRule(config: Partial<SiteSpoofConfig>, hostname: string): SiteRule | null {
  const normalized = normalizeConfig(config);
  // 最长域名先决定作用域；禁用子规则阻断父规则，不重新回退。
  const rule = normalized.rules
    .filter((rule) => domainMatches(hostname, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
  return rule?.enabled ? rule : null;
}

export function getEnabledRuleDomains(config: Partial<SiteSpoofConfig>): string[] {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return [];

  const seen = new Set<string>();
  return normalized.rules.reduce<string[]>((domains, rule) => {
    if (!rule.enabled || rule.compatibilityPreset === 'native' || !rule.domain || !isValidDomain(rule.domain) || seen.has(rule.domain)) return domains;
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
  if (!isIpv4Address(normalized)) {
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

  return Boolean(findMatchingRule(normalized, hostname));
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

/**
 * 语言是否可用：只取决于语言配置本身。
 *
 * 时区要出口档案、定位要坐标，都可能因为"档案没选/没验证/坐标为空"而不可用；
 * 但语言跟这些无关。历史上这里用整份 payload 当开关，一旦时区解析失败就把
 * Accept-Language 一起停掉，结果是"请求头 zh-CN、页面又说 en-US"这种一眼可查的破绽。
 */
export function getEffectiveLanguage(config: Partial<SiteSpoofConfig>, hostname: string): LanguageConfig | null {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return null;
  const rule = findMatchingRule(normalized, hostname);
  if (!rule) return null;
  const language = resolveEffectiveLanguageForRule(normalized, rule);
  if (!language || !language.enabled || !language.language) return null;
  return language;
}

export function resolveEffectiveLanguageForRule(config: SiteSpoofConfig, rule: SiteRule): LanguageConfig | null {
  if (rule.compatibilityPreset === 'native') return null;
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
  if (rule.compatibilityPreset === 'native') return { matched: true, rule, payload: null, errors: [] };

  const language = resolveEffectiveLanguageForRule(normalized, rule);
  const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
  const geolocationConfig = includeGeolocation && rule.compatibilityPreset !== 'consistency'
    ? resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation) : null;
  const needsExitLocationProfile = geolocationConfig?.mode === 'auto' || timezoneConfig?.mode === 'auto';
  const selectedProfile = rule.exitLocationProfileId
    ? normalized.exitLocationProfiles.find((profile) => profile.id === rule.exitLocationProfileId) || null
    : null;
  const exitLocationProfile = selectedProfile?.verification === 'verified' ? selectedProfile : null;
  const geolocation = resolveGeolocationValue(geolocationConfig, exitLocationProfile);
  const timezone = resolveTimezoneValue(timezoneConfig, exitLocationProfile);
  const fontExposure = normalizeFontExposure(normalized.fontExposure);
  if (rule.compatibilityPreset === 'consistency') fontExposure.enabled = false;
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
    // 部分生效：语言只依赖语言配置，时区/定位失败不该把它一起废掉。
    // 时区、定位在这里显式置空，注入层只装语言补丁；errors 保留原因给 UI 说明。
    const usableLanguage = language && language.enabled && language.language ? language : null;
    if (!usableLanguage && !fontExposure.enabled) return { matched: true, rule, payload: null, errors };
    return {
      matched: true,
      rule,
      errors,
      payload: {
        extensionEnabled: true,
        intlMode: normalized.intlMode,
        debugMode: normalized.debugMode,
        ruleId: rule.id,
        domain: rule.domain,
        geolocation: null,
        latitude: null,
        longitude: null,
        timezone: null,
        timezoneSource: null,
        languageConfig: usableLanguage,
        timezoneConfig: { enabled: false, mode: 'auto', timezone: '' },
        // 字体伪装与语言同属"不依赖出口档案"的那一半，部分生效时继续保留
        fontExposureConfig: fontExposure
      }
    };
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
  if (!payload || (!payload.languageConfig && !payload.timezone
    && !payload.fontExposureConfig.enabled)) return null;
  // Worker 侧字体补丁与主线程 font-exposure 脚本必须同步开关：主线程改了而 Worker 不改，
  // 页面里一句 new Worker(...).measureText 就能把真实字体问出来。
  const font = payload.fontExposureConfig;
  const blockedFonts = font.enabled && font.mode !== 'layered' ? font.blockedFamilies.slice() : null;
  return {
    intlMode: payload.intlMode,
    ...(payload.languageConfig ? { language: { language: payload.languageConfig.language, languages: payload.languageConfig.languages.slice() } } : {}),
    ...(payload.timezone ? { timezone: payload.timezone } : {}),
    ...(blockedFonts && blockedFonts.length ? { blockedFonts } : {}),
    ...(font.enabled && font.mode === 'layered' ? { fontPolicy: {
      enabled: true, mode: font.mode, layers: font.layers, blockedFamilies: font.blockedFamilies.slice()
    } } : {})
  };
}

export function getFontExposurePayload(config: Partial<SiteSpoofConfig>, hostname: string): NonNullable<LanguageTimezonePayload['fontPolicy']> | null {
  const font = getPageRuntimeProfile(config, hostname).payload?.fontExposureConfig;
  if (!font?.enabled) return null;
  return { enabled: true, mode: font.mode, blockedFamilies: font.blockedFamilies.slice(), ...(font.layers ? { layers: { ...font.layers } } : {}),
    ...(font.canvasSpoof.enabled ? { canvasSpoof: { ...font.canvasSpoof } } : {}) };
}

// 定位单独解析，语言/时区配置错误不阻断位置，匹配和verified边界仍复用同一所有者。
export function getGeolocationPayload(config: Partial<SiteSpoofConfig>, hostname: string): GeolocationPayload | null {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return null;
  const rule = findMatchingRule(normalized, hostname);
  if (!rule) return null;
  if (rule.compatibilityPreset === 'native' || rule.compatibilityPreset === 'consistency') return null;
  const geo = resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation);
  const profile = rule.exitLocationProfileId
    ? normalized.exitLocationProfiles.find(item => item.id === rule.exitLocationProfileId && item.verification === 'verified') || null : null;
  const value = resolveGeolocationValue(geo, profile);
  if (!geo) return null;
  if (!value) return { unavailable: true };
  return { latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy,
    randomize: value.randomize, randomRadiusMeters: value.randomRadiusMeters, spoofPermission: value.spoofPermission };
}

export function getGeolocationPermissionSetting(config: SiteSpoofConfig, hostname: string): 'allow' | 'block' | null {
  const payload = getGeolocationPayload(config, hostname);
  return !payload ? null : 'unavailable' in payload ? 'block' : payload.spoofPermission ? 'allow' : null;
}

export function getAutomaticExitRuleIds(config: SiteSpoofConfig): string[] {
  if (!config.masterEnabled) return [];
  return config.rules.filter(rule => {
    if (findMatchingRule(config, rule.domain)?.id !== rule.id || rule.compatibilityPreset === 'native') return false;
    const timezone = resolveSignal(config.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
    const geolocation = rule.compatibilityPreset === 'consistency' ? null
      : resolveSignal(config.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation);
    return timezone?.mode === 'auto' || geolocation?.mode === 'auto';
  }).map(rule => rule.id).sort();
}

function migrateLegacyLastLocation(config: SiteSpoofConfig, storageData: Record<string, any>): SiteSpoofConfig {
  const rawConfig = storageData[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
  if (rawConfig?.schemaVersion === 2 || rawConfig?.schemaVersion === 3 || rawConfig?.schemaVersion === 5
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
    webRtc: migrateLegacyWebRtc(input.webrtc || DEFAULT_WEBRTC),
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
  if (rawConfig?.schemaVersion === 2 || rawConfig?.schemaVersion === 3 || rawConfig?.schemaVersion === 4 || rawConfig?.schemaVersion === 5 || storageData[RULES_INITIALIZED_KEY] === true || !rawConfig || !Array.isArray(rawConfig.rules) || rawConfig.rules.length > 0) {
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

export class StoredConfigError extends Error {
  readonly code = 'invalid-stored-config';
  constructor(errors: string[]) {
    super(`本地配置无效：${errors.join('; ')}。已拒绝使用该配置并保留原数据；请导入有效备份或明确重置配置。已有页面需完整重载。`);
    this.name = 'StoredConfigError';
  }
}

export function migrateLegacyConfig(storageData: Record<string, any>): SiteSpoofConfig {
  const input = storageData || {};
  // 用数据存在性区分升级；关闭开关、空规则或缺少初始化标记均不代表首次安装。
  const hasConfiguration = [SITE_CONFIG_KEY, LEGACY_VANISHME_CONFIG_KEY, RULES_INITIALIZED_KEY,
    LAST_LOCATION_KEY, OLD_EXTENSION_ENABLED_KEY, OLD_LANGUAGE_KEY, OLD_TIMEZONE_KEY, OLD_WEBRTC_KEY]
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!hasConfiguration) return createInitialConfig();
  if (Object.prototype.hasOwnProperty.call(input, SITE_CONFIG_KEY)) {
    const raw = input[SITE_CONFIG_KEY];
    let candidate = raw;
    if (raw?.schemaVersion === 1) {
      const errors = getLegacyConfigErrors(raw, 'v1');
      if (errors.length) throw new StoredConfigError(errors);
      // v1 没有出口绑定和 Intl 模式；先补明确的历史字段，再走同一语义校验。
      candidate = { ...raw, schemaVersion: 2, exitLocationProfiles: raw.exitLocationProfiles ?? [],
        rules: raw.rules.map((rule: SiteRule) => ({ ...rule, exitLocationProfileId: rule.exitLocationProfileId ?? null })) };
    }
    const result = validateConfig(candidate);
    if (!result.ok) throw new StoredConfigError(result.errors);
    const config = result.config;
    const repaired = shouldRepairUninitializedRules(input, config) ? withDefaultRules(config) : config;
    return migrateLegacyLastLocation(repaired, input);
  }
  if (Object.prototype.hasOwnProperty.call(input, LEGACY_VANISHME_CONFIG_KEY)) {
    const raw = input[LEGACY_VANISHME_CONFIG_KEY];
    const errors = getLegacyConfigErrors(raw, 'vanishme');
    if (errors.length) throw new StoredConfigError(errors);
    errors.push(...getProfilesValidationErrors(raw.profile?.profiles));
    if (errors.length) throw new StoredConfigError(errors);
    const result = validateConfig(convertVanishMeConfig(raw));
    if (!result.ok) throw new StoredConfigError(result.errors);
    return migrateLegacyLastLocation(result.config, input);
  }
  const errors = getLegacyConfigErrors(input, 'keys');
  if (errors.length) throw new StoredConfigError(errors);
  if (![LAST_LOCATION_KEY, OLD_EXTENSION_ENABLED_KEY, OLD_LANGUAGE_KEY, OLD_TIMEZONE_KEY, OLD_WEBRTC_KEY]
    .some(key => Object.prototype.hasOwnProperty.call(input, key))) return createInitialConfig();
  const result = validateConfig(normalizeConfig({
    masterEnabled: input[OLD_EXTENSION_ENABLED_KEY] !== false,
    globalProfile: {
      language: normalizeLanguage(input[OLD_LANGUAGE_KEY] || DEFAULT_LANGUAGE),
      timezone: normalizeTimezone(input[OLD_TIMEZONE_KEY] || DEFAULT_TIMEZONE),
      geolocation: clone(DEFAULT_GEOLOCATION)
    },
    webRtc: migrateLegacyWebRtc(input[OLD_WEBRTC_KEY] || DEFAULT_WEBRTC)
  }));
  if (!result.ok) throw new StoredConfigError(result.errors);
  return migrateLegacyLastLocation(result.config, input);
}

export {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY
};

export type { FontExposureConfig, GeolocationConfig, LanguageConfig, SiteSpoofConfig, TimezoneConfig };
