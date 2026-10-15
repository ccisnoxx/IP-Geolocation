// Popup 的当前站点状态投影；有效 payload 由共享解析器唯一生成。
import { isRuntimeInjectionPaused } from './runtime-sync';
import { domainMatches, getEffectiveProfile } from './config-resolver';
import type { EffectivePayload, RuntimeSyncReport, SiteRule, SiteSpoofConfig } from './types';

export function deriveSetupStatus(config: SiteSpoofConfig): { kind: string; message: string } {
  const enabledRules = config.rules.filter((rule) => rule.enabled);
  const hasSetup = config.rules.length || config.exitLocationProfiles.length || config.profile.profiles.length
    || config.globalProfile.language.enabled || config.globalProfile.geolocation.mode === 'manual'
    || config.globalProfile.timezone.mode === 'manual' || config.canvas.enabled || config.webRtc.globalMode !== 'default';
  if (!config.masterEnabled && !hasSetup) return { kind: 'unconfigured', message: '未配置 · 保护关闭。请从首次配置引导开始，或保持关闭。' };
  // 关闭时也检查已选规则的完整性；有效配置始终交给同一个 resolver。
  const preview = { ...config, masterEnabled: true };
  const invalid = enabledRules.filter((rule) => getEffectiveProfile(preview, rule.domain).errors.length);
  if (!enabledRules.length || invalid.length) return { kind: 'partial', message: `部分配置${config.masterEnabled ? ' · 总开关已开启' : ' · 保护关闭'}。${!enabledRules.length ? '尚未选择启用站点。' : `${invalid.length} 条规则缺少有效配置，请检查出口绑定与信号。`}` };
  return config.masterEnabled
    ? { kind: 'enabled', message: '已启用 · 所选站点按已保存配置运行；实际生效请结合下方同步状态。' }
    : { kind: 'ready', message: '已配置 · 保护关闭。只有明确开启总开关后才生效。' };
}

export function renderSetupStatus(element: HTMLElement, config: SiteSpoofConfig, report?: RuntimeSyncReport): void {
  const state = deriveSetupStatus(config);
  element.dataset.setup = state.kind;
  element.dataset.sync = report?.status || 'unknown';
  if (isRuntimeInjectionPaused(report)) {
    element.textContent = '页面伪装已暂停／部分生效。已保存的开关与站点规则保留；请求头规则和 WebRTC 请查看同步详情。已有 hook 与旧 BFCache 文档需关闭并重建。';
    return;
  }
  element.textContent = `${state.message}${report?.status === 'ok' ? '' : ' 同步尚未完成或确认，请查看同步详情并重试。'}`;
}

export type CurrentSiteStatusKind = 'unsupported' | 'global-disabled' | 'not-allowlisted' | 'enabled' | 'paused' | 'error';

export interface CurrentSiteStatusInput {
  domain: string;
  scriptable: boolean;
  config: SiteSpoofConfig;
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
  syncReport?: RuntimeSyncReport;
}

export interface CurrentSiteStatus {
  kind: CurrentSiteStatusKind;
  label: string;
  detail: string;
  canEnable: boolean;
  canDisable: boolean;
  disableDomain: string | null;
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
  if (isRuntimeInjectionPaused(input.syncReport)) return {
    kind: 'paused', label: '页面伪装已暂停',
    detail: `匹配规则：${matchedRule.domain}；规则已保存，页面 API 伪装暂停。请求头与 WebRTC 请查看同步详情。`,
    canEnable: false, canDisable: true, disableDomain: matchedRule.domain
  };
  return {
    kind: 'enabled',
    label: '已启用当前网站',
    detail: `匹配规则：${matchedRule.domain}`,
    canEnable: false,
    canDisable: true,
    disableDomain: matchedRule.domain
  };
}
