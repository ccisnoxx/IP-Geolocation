import type { CanvasPlatform } from '../shared/types';
import type { LastLocation, SiteSpoofConfig } from '../shared/types';

/**
 * 注入脚本用的最小解析器：从构建期烘焙的配置里，算出当前域名该用哪套参数。
 *
 * 之所以不直接 import `shared/config-resolver`：runtime.js 是 MAIN world 的
 * 经典脚本，一旦和 background 共享模块，Vite/Rollup 会把它拆成独立 chunk 并生成
 * `import` 语句，注入到页面里会直接语法错误。所以这里保持零依赖，逻辑与
 * `getEffectiveProfile` 对齐 —— tests/baked-resolver.test.ts 会逐条比对两者输出。
 */
export interface BakedRuntimePayload {
  extensionEnabled: boolean;
  debugMode: boolean;
  ruleId?: string;
  domain?: string;
  timezone: string | null;
  timezoneConfig: { enabled: boolean; mode: 'auto' | 'manual'; timezone: string };
  languageConfig: { enabled: boolean; language: string; languages: string[]; acceptLanguage: string } | null;
  geolocation: {
    latitude: number;
    longitude: number;
    accuracy: number;
    country?: string;
    randomize: boolean;
    randomRadiusMeters: number;
    spoofPermission: boolean;
  } | null;
  canvasConfig: { enabled: boolean; spoofFonts: boolean; platform?: CanvasPlatform; hideCjkFonts?: boolean; targetFonts: string[] };
}

type Override = { mode?: string; value?: any } | null | undefined;

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pickRule(config: any, host: string): any | null {
  const rules: any[] = Array.isArray(config?.rules) ? config.rules : [];
  // 与 shared/config-resolver 的 findMatchingRule 保持一致：最长匹配优先，
  // disabled 规则同样参与匹配（它代表"显式排除"），排除判定在调用方做。
  return rules
    .filter((rule) => rule && typeof rule.domain === 'string' && rule.domain)
    .filter((rule) => matches(host, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
}

function resolveLanguage(globalProfile: any, override: Override) {
  const mode = override?.mode || 'inherit';
  if (mode === 'disable') return null;
  if (mode === 'override') {
    const value = override?.value || {};
    const language = String(value.language || '');
    if (!language) return null;
    const languages = Array.isArray(value.languages) && value.languages.length ? value.languages.slice() : [language];
    return {
      enabled: true,
      language,
      languages,
      acceptLanguage: String(value.acceptLanguage || `${language},${language.split('-')[0]};q=0.9`)
    };
  }
  const language = globalProfile?.language;
  if (!language || language.enabled === false || !language.language) return null;
  return {
    enabled: true,
    language: String(language.language),
    languages: Array.isArray(language.languages) && language.languages.length
      ? language.languages.slice()
      : [String(language.language)],
    acceptLanguage: String(language.acceptLanguage || '')
  };
}

function resolveTimezoneConfig(globalProfile: any, override: Override) {
  const mode = override?.mode || 'inherit';
  if (mode === 'disable') return null;
  if (mode === 'override') {
    const value = override?.value || {};
    return {
      enabled: true,
      mode: value.mode === 'manual' ? 'manual' as const : 'auto' as const,
      timezone: String(value.timezone || '')
    };
  }
  const timezone = globalProfile?.timezone;
  if (!timezone || timezone.enabled === false) return null;
  return {
    enabled: true,
    mode: timezone.mode === 'manual' ? 'manual' as const : 'auto' as const,
    timezone: String(timezone.timezone || '')
  };
}

function resolveGeolocation(globalProfile: any, override: Override, lastLocation: LastLocation | null) {
  const mode = override?.mode || 'inherit';
  if (mode === 'disable') return null;
  const source = mode === 'override' ? (override?.value || {}) : (globalProfile?.geolocation || {});
  if (source.enabled === false) return null;

  const manual = source.mode === 'manual';
  const latitude = manual ? Number(source.latitude) : Number(lastLocation?.latitude);
  const longitude = manual ? Number(source.longitude) : Number(lastLocation?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(source.accuracy)) && Number(source.accuracy) > 0 ? Number(source.accuracy) : 50,
    country: String(source.country || (manual ? '' : lastLocation?.country || '')),
    randomize: Boolean(source.randomize),
    randomRadiusMeters: Number.isFinite(Number(source.randomRadiusMeters)) ? Number(source.randomRadiusMeters) : 1000,
    spoofPermission: source.spoofPermission !== false,
    timezone: manual ? null : (lastLocation?.timezone || null)
  };
}

export function resolveBakedPayload(
  config: SiteSpoofConfig | null | undefined,
  hostname: string,
  lastLocation: LastLocation | null
): BakedRuntimePayload | null {
  if (!config || config.masterEnabled === false) return null;
  const host = String(hostname || '').toLowerCase();
  if (!host) return null;

  const rule = pickRule(config, host);
  if (!rule) return null;
  // 显式排除：命中的规则被禁用 → 整站保持原生值，不再回落到父域配置
  if (rule.enabled === false) return null;

  const globalProfile: any = (config as any).globalProfile || {};
  const overrides = rule.overrides || {};

  const language = resolveLanguage(globalProfile, overrides.language);
  const timezoneConfig = resolveTimezoneConfig(globalProfile, overrides.timezone);
  const geolocation = resolveGeolocation(globalProfile, overrides.geolocation, lastLocation);

  let timezone: string | null = null;
  if (timezoneConfig) {
    if (timezoneConfig.mode === 'manual' && timezoneConfig.timezone) {
      timezone = timezoneConfig.timezone;
    } else {
      timezone = (geolocation && (geolocation as any).timezone) || lastLocation?.timezone || null;
    }
  }

  if (geolocation === null && globalProfile?.geolocation && globalProfile.geolocation.enabled !== false && overrides.geolocation?.mode !== 'disable') {
    // 地理定位开启但拿不到坐标：退回只做语言/时区，避免整页不生效
  }
  if (timezoneConfig && !timezone) {
    // 时区开启但没有可用值时，不阻断语言伪装
  }

  const canvas = (config as any).canvas || {};
  // 与 normalizeCanvas 的默认值保持一致（这里不 import config-model：注入脚本要零依赖）
  const platform: CanvasPlatform = ['auto', 'mac', 'windows', 'linux', 'none'].includes(canvas.platform)
    ? canvas.platform
    : 'auto';
  const hideCjkFonts = canvas.hideCjkFonts !== false;
  const extras: string[] = Array.isArray(canvas.targetFonts) ? canvas.targetFonts.filter(Boolean) : [];

  return {
    extensionEnabled: true,
    debugMode: Boolean((config as any).debugMode),
    ruleId: rule.id,
    domain: rule.domain,
    timezone,
    timezoneConfig: timezoneConfig || { enabled: false, mode: 'auto', timezone: '' },
    languageConfig: language,
    geolocation: geolocation
      ? {
        latitude: geolocation.latitude,
        longitude: geolocation.longitude,
        accuracy: geolocation.accuracy,
        country: geolocation.country,
        randomize: geolocation.randomize,
        randomRadiusMeters: geolocation.randomRadiusMeters,
        spoofPermission: geolocation.spoofPermission
      }
      : null,
    canvasConfig: {
      enabled: canvas.enabled === true,
      spoofFonts: canvas.spoofFonts !== false,
      platform,
      hideCjkFonts,
      targetFonts: extras
    }
  };
}