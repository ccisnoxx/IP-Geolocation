// Shared UI projections for site status and effective environment display.
import {
  formatTimezoneOffsetMinutes,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  normalizeGeolocation,
  normalizeTimezone
} from './config-model';
import { domainMatches } from './config-resolver';
import { formatCoordinate } from './last-location-display';
import { deriveIpLocationStatus, hasValidLastLocation } from './ip-location';
import type { EffectivePayload, LastLocation, SiteRule, SiteSpoofConfig } from './types';
import type { IpLocationStatusSnapshot } from './ip-location';

export type CurrentSiteStatusKind = 'unsupported' | 'global-disabled' | 'not-allowlisted' | 'enabled' | 'error';
export type EffectiveValueSource = 'ip' | 'manual' | 'disabled' | 'unavailable';

export interface CurrentSiteStatusInput {
  domain: string;
  scriptable: boolean;
  config: SiteSpoofConfig;
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
}

export interface CurrentSiteStatus {
  kind: CurrentSiteStatusKind;
  label: string;
  detail: string;
  canEnable: boolean;
  canDisable: boolean;
  disableDomain: string | null;
}

export interface EffectiveValueDisplay {
  source: EffectiveValueSource;
  sourceLabel: string;
  value: string;
  detail: string;
  freshness?: 'fresh' | 'stale' | 'missing';
}

export interface EffectiveEnvironmentDisplay {
  geolocation: EffectiveValueDisplay;
  timezone: EffectiveValueDisplay;
  language: EffectiveValueDisplay;
  webRtc: EffectiveValueDisplay;
  canvas: EffectiveValueDisplay;
  canFreezeIpLocation: boolean;
}

function enabledRuleForDomain(config: SiteSpoofConfig, domain: string): SiteRule | null {
  return config.rules
    .filter((rule) => rule.enabled && domainMatches(domain, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
}

export function deriveCurrentSiteStatus(input: CurrentSiteStatusInput): CurrentSiteStatus {
  const domain = input.domain || '';
  const matchedRule = input.rule || (domain ? enabledRuleForDomain(input.config, domain) : null);

  if (!input.scriptable || !domain) {
    return {
      kind: 'unsupported',
      label: '不支持此页面',
      detail: '仅 http/https 页面可应用 VanishGeo 规则。',
      canEnable: false,
      canDisable: false,
      disableDomain: null
    };
  }

  if (!input.config.masterEnabled) {
    return {
      kind: 'global-disabled',
      label: '全局保护已关闭',
      detail: '规则已保存，但全局开关关闭时不会注入。',
      canEnable: !matchedRule,
      canDisable: Boolean(matchedRule),
      disableDomain: matchedRule?.domain || null
    };
  }

  if (!input.matched || !matchedRule) {
    return {
      kind: 'not-allowlisted',
      label: '未启用当前网站',
      detail: '当前网站不在启用规则中。',
      canEnable: true,
      canDisable: false,
      disableDomain: null
    };
  }

  if (!input.payload || input.errors.length > 0) {
    return {
      kind: 'error',
      label: '已匹配但配置不完整',
      detail: input.errors.length ? input.errors.join('；') : '当前规则缺少可注入的有效配置。',
      canEnable: false,
      canDisable: true,
      disableDomain: matchedRule.domain
    };
  }

  return {
    kind: 'enabled',
    label: '已启用当前网站',
    detail: `匹配规则：${matchedRule.domain}`,
    canEnable: false,
    canDisable: true,
    disableDomain: matchedRule.domain
  };
}

function sourceLabel(source: EffectiveValueSource): string {
  switch (source) {
    case 'ip':
      return '跟随 IP';
    case 'manual':
      return '手动';
    case 'disabled':
      return '未启用';
    case 'unavailable':
      return '缺少数据';
  }
}

function timezoneOffsetLabel(timezone: string | null, location: LastLocation | null): string {
  if (!timezone) return '';
  const offset = Number.isFinite(Number(location?.timezoneOffset))
    ? Number(location?.timezoneOffset)
    : getTimezoneOffsetMinutes(timezone);
  return formatTimezoneOffsetMinutes(offset) || '';
}

export function deriveEffectiveEnvironment(
  configInput: Partial<SiteSpoofConfig>,
  lastLocation: LastLocation | null,
  ipLocationStatus?: IpLocationStatusSnapshot | null
): EffectiveEnvironmentDisplay {
  const config = normalizeConfig(configInput);
  const geo = config.globalProfile.geolocation;
  const timezone = config.globalProfile.timezone;
  const language = config.globalProfile.language;
  const hasIpLocation = hasValidLastLocation(lastLocation);
  const locationStatus = ipLocationStatus || deriveIpLocationStatus(lastLocation, null);
  const ipFreshnessLabel = locationStatus.freshness === 'stale' ? 'Stale（过期）' : 'Fresh（有效）';

  const geolocation: EffectiveValueDisplay = !geo.enabled
    ? { source: 'disabled', sourceLabel: sourceLabel('disabled'), value: '地理位置未启用', detail: '' }
    : geo.mode === 'manual' && Number.isFinite(Number(geo.latitude)) && Number.isFinite(Number(geo.longitude))
      ? {
          source: 'manual',
          sourceLabel: sourceLabel('manual'),
          value: `${formatCoordinate(geo.latitude)}, ${formatCoordinate(geo.longitude)}`,
          detail: geo.country || `精度 ${geo.accuracy}m`
        }
      : hasIpLocation
        ? {
            source: 'ip',
            sourceLabel: sourceLabel('ip'),
            value: `${formatCoordinate(lastLocation.latitude)}, ${formatCoordinate(lastLocation.longitude)}`,
            detail: [ipFreshnessLabel, lastLocation.country, lastLocation.updateTime].filter(Boolean).join(' · '),
            freshness: locationStatus.freshness
          }
        : { source: 'unavailable', sourceLabel: sourceLabel('unavailable'), value: '等待出口 IP 定位', detail: '' };

  const timezoneValue = timezone.mode === 'manual' ? timezone.timezone : lastLocation?.timezone || '';
  const timezoneSource: EffectiveValueSource = !timezone.enabled
    ? 'disabled'
    : timezone.mode === 'manual' && timezone.timezone
      ? 'manual'
      : lastLocation?.timezone
        ? 'ip'
        : 'unavailable';
  const timezoneDisplay: EffectiveValueDisplay = {
    source: timezoneSource,
    sourceLabel: sourceLabel(timezoneSource),
    value: timezoneSource === 'disabled'
      ? '时区未启用'
      : timezoneValue || '等待出口 IP 时区',
    detail: timezoneSource === 'disabled'
      ? ''
      : [timezoneOffsetLabel(timezoneValue || null, timezoneSource === 'ip' ? lastLocation : null), timezoneSource === 'ip' ? ipFreshnessLabel : ''].filter(Boolean).join(' · '),
    freshness: timezoneSource === 'ip' ? locationStatus.freshness : undefined
  };

  const languageDisplay: EffectiveValueDisplay = language.enabled
    ? {
        source: 'manual',
        sourceLabel: '显式配置',
        value: language.language,
        detail: `${language.languages.join(', ')} · ${language.acceptLanguage}`
      }
    : { source: 'disabled', sourceLabel: sourceLabel('disabled'), value: '语言未启用', detail: '' };

  const webRtcDisplay: EffectiveValueDisplay = config.webRtc.globalMode === 'default'
    ? { source: 'disabled', sourceLabel: sourceLabel('disabled'), value: 'WebRTC 使用浏览器默认策略', detail: '' }
    : {
        source: 'manual',
        sourceLabel: '全局策略',
        value: config.webRtc.globalMode === 'strict' ? '禁用非代理 UDP' : '仅公网接口',
        detail: config.webRtc.globalMode
      };

  const canvasDisplay: EffectiveValueDisplay = config.canvas.enabled
    ? {
        source: 'manual',
        sourceLabel: '显式配置',
        value: config.canvas.spoofFonts ? 'Canvas 字体保护已启用' : 'Canvas 已启用',
        detail: `${config.canvas.targetFonts.length} 个目标字体`
      }
    : { source: 'disabled', sourceLabel: sourceLabel('disabled'), value: 'Canvas 字体保护未启用', detail: '' };

  return {
    geolocation,
    timezone: timezoneDisplay,
    language: languageDisplay,
    webRtc: webRtcDisplay,
    canvas: canvasDisplay,
    canFreezeIpLocation: Boolean(
      hasIpLocation
      && lastLocation.timezone
      && geo.enabled
      && timezone.enabled
    )
  };
}

export function freezeIpLocationToManualConfig(configInput: Partial<SiteSpoofConfig>, lastLocation: LastLocation | null): SiteSpoofConfig | null {
  if (!hasValidLastLocation(lastLocation) || !lastLocation.timezone) return null;
  const config = normalizeConfig(configInput);
  return normalizeConfig({
    ...config,
    globalProfile: {
      ...config.globalProfile,
      geolocation: normalizeGeolocation({
        ...config.globalProfile.geolocation,
        mode: 'manual',
        latitude: Number(lastLocation.latitude),
        longitude: Number(lastLocation.longitude),
        country: lastLocation.country || config.globalProfile.geolocation.country
      }),
      timezone: normalizeTimezone({
        ...config.globalProfile.timezone,
        mode: 'manual',
        timezone: lastLocation.timezone
      })
    }
  });
}
