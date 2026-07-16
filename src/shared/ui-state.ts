// Popup 的当前站点状态投影；有效 payload 由共享解析器唯一生成。
import { domainMatches } from './config-resolver';
import type { EffectivePayload, SiteRule, SiteSpoofConfig } from './types';

export type CurrentSiteStatusKind = 'unsupported' | 'global-disabled' | 'not-allowlisted' | 'enabled' | 'error';

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
