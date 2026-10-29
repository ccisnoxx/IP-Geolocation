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
  defaultRules,
  isValidDomain,
  normalizeCanvas,
  migrateStoredConfig,
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

/**
 * 最长匹配优先。
 *
 * 关键：`enabled === false` 的规则**同样参与匹配** —— 它的含义是"显式排除"。
 * 这正是「google.com 启用 + mail.google.com 排除」能成立的原因：两条都命中时
 * 取更长的 mail.google.com，读到 disabled 就整站不做改写，而不是回落到父域配置。
 *
 * 早先的实现先按 enabled 过滤再匹配，于是排除项永远匹配不到，等于删除。
 */
export function findMatchingRule(config: Partial<SiteSpoofConfig>, hostname: string): SiteRule | null {
  const normalized = normalizeConfig(config);
  return normalized.rules
    .filter((rule) => Boolean(rule.domain) && domainMatches(hostname, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
}

export interface RuleMatch {
  /** 命中的规则；没命中任何规则时为 null */
  rule: SiteRule | null;
  /** 命中的规则被显式禁用：该站点及其子域都不做任何改写 */
  excluded: boolean;
}

export function resolveRuleMatch(config: Partial<SiteSpoofConfig>, hostname: string): RuleMatch {
  const rule = findMatchingRule(config, hostname);
  return { rule, excluded: Boolean(rule && !rule.enabled) };
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

/**
 * 内容脚本层用的排除域名：被禁用，且**没有更深的启用规则把它救回来**。
 *
 * `enabled: false` 的 a.com 配上一个启用的 b.a.com 时，不能把整个 a.com 从
 * 内容脚本里排除掉 —— 那会连带挡掉 b.a.com。内容脚本的 `excludeMatches` 只能
 * 表达"整棵子树都不注入"，表达不了"排除里再放行"，所以这里只能把这类域名移出
 * 排除表，让孙域仍然被注入，再由 payload 层（`resolveRuleMatch`）在运行时判定
 * 中间那层其实是排除的。
 *
 * 也就是说：**这张表只对内容脚本合法**。DNR 和 contentSettings 有自己的表达方式
 * （父规则挖掉子树 + 子域自带规则），必须用 `getCarveOutDomains()`。
 */
export function getExcludedRuleDomains(config: Partial<SiteSpoofConfig>): string[] {
  const normalized = normalizeConfig(config);
  const enabledDomains = normalized.rules.filter((rule) => rule.enabled && rule.domain).map((rule) => rule.domain);

  const seen = new Set<string>();
  return normalized.rules.reduce<string[]>((domains, rule) => {
    if (rule.enabled || !rule.domain || seen.has(rule.domain)) return domains;
    const rescued = enabledDomains.some((domain) => domain !== rule.domain && domain.endsWith(`.${rule.domain}`));
    if (rescued) return domains;
    seen.add(rule.domain);
    domains.push(rule.domain);
    return domains;
  }, []);
}

/**
 * 父规则必须挖掉的域名：被禁用，且确实落在某条启用规则的子树里。
 *
 * 与 `getExcludedRuleDomains` 的唯一区别是**不做 rescue**：
 *
 *   example.com            启用
 *   !child.example.com     禁用
 *   active.child.example.com 启用
 *
 * 对 DNR 和 contentSettings 来说，正确做法是把 `child.example.com` 整棵子树从父
 * 规则里挖掉，再让 `active.child.example.com` 用自己的规则/自己的 contentSettings
 * 覆盖回来 —— 两边都支持"更具体的规则优先"，所以三层语义可以一致，不需要牺牲中间层。
 *
 * 早先 DNR 直接复用内容脚本那张（带 rescue 的）表，结果父规则的 requestDomains
 * 重新覆盖了被禁用的中间子域：页面是原生的，请求头却被改写。
 */
export function getCarveOutDomains(config: Partial<SiteSpoofConfig>): string[] {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return [];
  const enabledDomains = normalized.rules.filter((rule) => rule.enabled && rule.domain).map((rule) => rule.domain);

  const seen = new Set<string>();
  return normalized.rules.reduce<string[]>((domains, rule) => {
    if (rule.enabled || !rule.domain || seen.has(rule.domain)) return domains;
    // 没有启用祖先时，本来也没有哪条父规则会覆盖到它，挖掉毫无意义
    const covered = enabledDomains.some((domain) => domain !== rule.domain && rule.domain.endsWith(`.${domain}`));
    if (!covered) return domains;
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

export function getContentScriptMatches(config: Partial<SiteSpoofConfig>, excludeDomains: string[] = []): string[] {
  const excluded = new Set(excludeDomains.map((domain) => normalizeDomain(domain)).filter(Boolean));
  return getEnabledRuleDomains(config)
    .filter((domain) => !excluded.has(domain))
    .reduce<string[]>((matches, domain) => (
      matches.concat(buildContentScriptMatchesForDomain(domain))
    ), []);
}

export interface ContentScriptRegistration {
  matches: string[];
  /** 需要从 matches 里挖掉的范围（对应 disabled 规则） */
  excludeMatches: string[];
}

/**
 * 内容脚本注册用的完整定义：匹配范围 + 排除范围。
 *
 * 排除项交给 `registeredContentScripts.excludeMatches`，而不是"干脆不注册父域" ——
 * 后者会让 google.com 的其它子域一起失去保护。
 */
export function getContentScriptRegistration(
  config: Partial<SiteSpoofConfig>,
  bakedDomains: string[] = []
): ContentScriptRegistration {
  const matches = getContentScriptMatches(config, bakedDomains);
  const baked = new Set(bakedDomains.map((domain) => normalizeDomain(domain)).filter(Boolean));
  const excludeMatches = getExcludedRuleDomains(config)
    .filter((domain) => !baked.has(domain))
    .reduce<string[]>((patterns, domain) => patterns.concat(buildContentScriptMatchesForDomain(domain)), []);

  return { matches, excludeMatches };
}

/** 某个启用规则要挖掉的子域（只取它自己的下游禁用项） */
export function getExcludedDomainsFor(domain: string, excludedDomains: string[]): string[] {
  return excludedDomains.filter((excluded) => excluded !== domain && excluded.endsWith(`.${domain}`));
}

export function isUrlMatchedByEnabledRule(config: Partial<SiteSpoofConfig>, url: string): boolean {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return false;
  const hostname = parseHostname(url);
  if (!hostname) return false;

  const { rule, excluded } = resolveRuleMatch(normalized, hostname);
  return Boolean(rule) && !excluded;
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

function lastCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
  // Number(null) === 0：旧缓存里缺字段时不能把它当成几内亚湾的合法坐标。
  const latitude = lastCoordinate(lastLocation?.latitude);
  const longitude = lastCoordinate(lastLocation?.longitude);
  if (!lastLocation || latitude === null || longitude === null) {
    return null;
  }
  return {
    ...geolocationConfig,
    latitude,
    longitude,
    country: lastLocation.country || '',
    timezone: lastLocation.timezone || null
  };
}

/**
 * 语言与时区解耦：Accept-Language 只依赖语言配置，不需要定位。
 * 之前把两者捆在一个 payload 里，auto 模式首帧定位没回来就导致
 * 「请求头 zh-CN、页面 en-US」这种一眼可查的矛盾。
 */
export function getEffectiveLanguage(config: Partial<SiteSpoofConfig>, hostname: string): LanguageConfig | null {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) return null;
  const { rule, excluded } = resolveRuleMatch(normalized, hostname);
  if (!rule || excluded) return null;
  const language = resolveSignal(normalized.globalProfile.language, rule.overrides.language, normalizeLanguage);
  if (!language || !language.enabled || !language.language) return null;
  return language;
}

export function getEffectiveProfile(
  config: Partial<SiteSpoofConfig>,
  hostname: string,
  lastLocation: LastLocation | null
): EffectiveProfileResult {
  const normalized = normalizeConfig(config);
  if (!normalized.masterEnabled) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }

  const { rule, excluded } = resolveRuleMatch(normalized, hostname);
  if (!rule) {
    return { matched: false, rule: null, payload: null, errors: [] };
  }
  // 显式排除：命中了一条 disabled 规则，整站（含子域）保持原生值
  if (excluded) {
    return { matched: false, rule, payload: null, errors: [], excluded: true };
  }

  const language = resolveSignal(normalized.globalProfile.language, rule.overrides.language, normalizeLanguage);
  const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
  const geolocationConfig = resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation);
  // override 的 custom 值可能带 enabled:false；先按开关收口，再解析坐标。
  const geolocationEnabled = Boolean(geolocationConfig && geolocationConfig.enabled !== false);
  const geolocation = geolocationEnabled ? resolveGeolocationValue(geolocationConfig, lastLocation) : null;
  // 启用但解析不出来 → deny，而不是退回原生。后者会把真实位置交给站点。
  const geolocationDenied = geolocationEnabled && !geolocation;
  const timezone = resolveTimezoneValue(timezoneConfig, geolocation, lastLocation);
  const canvas = normalizeCanvas(normalized.canvas);
  // payload 携带三层原始字段，**不在这里展开**成字体列表。
  //
  // 展开逻辑要用到 shared/font-aliases，而那个模块同时被注入脚本引用；background
  // 再引用一次就会让 Rollup 抽出共享 chunk，runtime.js 里出现 `import` —— MAIN world
  // 的经典脚本会直接语法错误。所以解析放在注入层（runtime / baked-resolver），
  // 它们本来就是同一个 bundle。
  const canvasConfig = canvas;
  const errors: string[] = [];

  if (geolocationEnabled && !geolocation) {
    errors.push('geolocation is enabled but no valid coordinates are available');
  }
  if (timezoneConfig && !timezone.timezone) {
    errors.push('timezone is enabled but no valid timezone is available');
  }

  // 语言能生效就注入语言，只把解析不出来的时区/定位留空。
  // 这样「请求头 en-US + 页面 navigation.language=en-US + 时区仍是原生」是一个
  // 完全合理的用户画像（英语用户在海外），比"头说中文、页面说英文"安全得多。
  const languageUsable = Boolean(language && language.enabled && language.language);
  const timezoneUsable = Boolean(timezone.timezone);
  // 定位和 canvas 同样是独立的改写层，必须各自能把 payload 拉起来。
  // 旧实现只认语言/时区，于是 geo-only、canvas-only 的配置拿到 payload=null：
  // 扩展装上了、站点也在白名单里，页面却什么都没变。
  const geolocationUsable = Boolean(geolocation) || geolocationDenied;
  const canvasUsable = Boolean(canvas.enabled);
  if (!languageUsable && !timezoneUsable && !geolocationUsable && !canvasUsable) {
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
      hostname: normalizeDomain(hostname),
      geolocation,
      geolocationDenied,
      latitude: geolocation ? geolocation.latitude : null,
      longitude: geolocation ? geolocation.longitude : null,
      timezone: timezone.timezone || null,
      timezoneSource: timezone.source,
      languageConfig: language,
      timezoneConfig: timezoneConfig ? {
        enabled: true,
        mode: timezoneConfig.mode,
        timezone: timezoneConfig.timezone
      } : { enabled: false, mode: 'auto', timezone: '' },
      canvasConfig
    },
    // 部分生效时 errors 里保留原因：UI 要能说清"语言已生效、时区没生效"
    errors
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
    // 用 migrateStoredConfig 而不是 normalizeConfig：老版本存下来的配置要补上
    // 新默认值（厂商字体），新配置原样保留用户写的列表
    return migrateStoredConfig(input[SITE_CONFIG_KEY]);
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
    // 首次安装（以及从老版本迁移）就把默认白名单种进去：装上即生效，
    // 登录页/注册页不用手动加域名。
    rules: defaultRules()
  });
}

export {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  SITE_CONFIG_KEY
};

export type { CanvasConfig, GeolocationConfig, LanguageConfig, LastLocation, SiteSpoofConfig, TimezoneConfig };
