// Popup 的当前站点状态投影；有效 payload 由共享解析器唯一生成。
import { isRuntimeInjectionPaused, pageRuntimeMessage, PAGE_RUNTIME_DOCUMENT_SCOPE, PAGE_RUNTIME_PAUSED_SURFACES } from './runtime-sync';
import { domainMatches, getPageRuntimeProfile } from './config-resolver';
import type { EffectivePayload, RuntimeSyncReport, SiteRule, SiteSpoofConfig } from './types';

export function deriveSetupStatus(config: SiteSpoofConfig): { kind: string; message: string } {
  const enabledRules = config.rules.filter((rule) => rule.enabled);
  const hasSetup = config.rules.length || config.exitLocationProfiles.length || config.profile.profiles.length
    || config.globalProfile.language.enabled || config.globalProfile.geolocation.mode === 'manual'
    || config.globalProfile.timezone.mode === 'manual' || config.fontExposure.enabled || config.webRtc.globalMode !== 'default';
  if (!config.masterEnabled && !hasSetup) return { kind: 'unconfigured', message: '未配置 · 保护关闭。请从首次配置引导开始，或保持关闭。' };
  // 关闭时也检查已选规则的完整性；有效配置始终交给同一个 resolver。
  const preview = { ...config, masterEnabled: true };
  const invalid = enabledRules.filter((rule) => getPageRuntimeProfile(preview, rule.domain).errors.length);
  if (!enabledRules.length || invalid.length) return { kind: 'partial', message: `部分配置${config.masterEnabled ? ' · 总开关已开启' : ' · 保护关闭'}。${!enabledRules.length ? '尚未选择启用站点。' : `${invalid.length} 条规则缺少有效配置，请检查出口绑定与信号。`}` };
  return config.masterEnabled
    ? { kind: 'enabled', message: '总开关已开启（配置）· 所选站点规则已启用；页面语言/时区注册、旧请求头规则清理与 WebRTC 分别查看同步详情。当前页面实际值尚未验证。' }
    : { kind: 'ready', message: '已配置 · 保护关闭。只有明确开启总开关后才生效。' };
}

export function renderSetupStatus(element: HTMLElement, config: SiteSpoofConfig, report?: RuntimeSyncReport): void {
  const state = deriveSetupStatus(config);
  element.dataset.setup = state.kind;
  element.dataset.sync = report?.status || 'unknown';
  if (isRuntimeInjectionPaused(report)) {
    element.textContent = '历史报告：页面伪装已暂停／部分生效。已保存的开关与站点规则保留；旧请求头规则清理和 WebRTC 请查看同步详情。已有 hook 与旧 BFCache 文档需关闭并重建。';
    return;
  }
  element.textContent = `${state.message}${report?.status === 'ok' ? '' : ' 同步尚未完成或确认，请查看同步详情并重试。'}`;
}

export type CurrentSiteStatusKind = 'unsupported' | 'global-disabled' | 'not-allowlisted' | 'enabled' | 'disabled' | 'reload-required' | 'runtime-unavailable' | 'unknown' | 'paused' | 'error';

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
      detail: `仅 HTTP(S) 顶层文档和普通 iframe 属于语言/时区支持范围；此页面为 unsupported / UNKNOWN。${PAGE_RUNTIME_DOCUMENT_SCOPE} ${PAGE_RUNTIME_PAUSED_SURFACES}`,
      canEnable: false,
      canDisable: false,
      disableDomain: null
    };
  }
  if (!input.config.masterEnabled) {
    return {
      kind: 'global-disabled',
      label: '全局总开关已关闭（配置）',
      detail: `总开关已保存为关闭；${pageRuntimeMessage(input.syncReport)} 旧请求头规则清理与 WebRTC 请分别查看同步详情。${PAGE_RUNTIME_PAUSED_SURFACES}`,
      canEnable: !matchedRule,
      canDisable: Boolean(matchedRule),
      disableDomain: matchedRule?.domain || null
    };
  }
  if (!input.matched || !matchedRule) {
    return {
      kind: 'not-allowlisted',
      label: '未启用当前网站',
      detail: `当前网站不在已保存的启用规则中，实际注册结果请查看同步详情。已有文档不会热更新，当前页面实际值为 UNKNOWN。${PAGE_RUNTIME_PAUSED_SURFACES}`,
      canEnable: true,
      canDisable: false,
      disableDomain: null
    };
  }
  if (!input.payload || input.errors.length > 0) {
    return {
      kind: 'error',
      label: '已匹配但语言/时区配置不完整',
      detail: `${input.errors.length ? input.errors.join('；') : '当前规则缺少有效的语言/时区配置。'} 旧请求头规则清理与 WebRTC 请分别查看同步详情。${PAGE_RUNTIME_PAUSED_SURFACES}`,
      canEnable: false,
      canDisable: true,
      disableDomain: matchedRule.domain
    };
  }
  if (isRuntimeInjectionPaused(input.syncReport)) return {
    kind: 'paused', label: '页面伪装已暂停',
    detail: `匹配规则：${matchedRule.domain}；规则已保存，页面 API 伪装暂停。旧请求头规则清理与 WebRTC 请查看同步详情。`,
    canEnable: false, canDisable: true, disableDomain: matchedRule.domain
  };
  const operation = { canEnable: false, canDisable: true, disableDomain: matchedRule.domain };
  if (!input.payload.languageConfig && !input.payload.timezone) return {
    kind: 'disabled', label: '当前规则未启用语言/时区',
    detail: `匹配规则：${matchedRule.domain}；当前规则的语言/时区均已保存为关闭，实际注册结果请查看同步详情。已有文档与 BFCache 不热更新，当前页面实际值为 UNKNOWN。旧请求头规则清理与 WebRTC 请分别查看同步详情。${PAGE_RUNTIME_PAUSED_SURFACES}`,
    ...operation
  };
  const page = input.syncReport?.pageRuntime;
  if (!page) return {
    kind: 'unknown', label: '页面语言/时区状态待确认',
    detail: `匹配规则：${matchedRule.domain}；${pageRuntimeMessage(input.syncReport)} ${PAGE_RUNTIME_PAUSED_SURFACES}`,
    ...operation
  };
  if (page.state !== 'ready' && page.state !== 'disabled') return {
    kind: 'runtime-unavailable',
    label: ({ 'api-unsupported': '浏览器不支持 userScripts', 'permission-required': '缺少 userScripts 权限', 'switch-required': '请开启 Allow User Scripts', 'sync-failed': '页面语言/时区同步失败' })[page.state],
    detail: `匹配规则：${matchedRule.domain}；${pageRuntimeMessage(input.syncReport)} 旧请求头规则清理与 WebRTC 请分别查看同步详情。${PAGE_RUNTIME_PAUSED_SURFACES}`,
    ...operation
  };
  return {
    kind: page.state === 'disabled' ? 'disabled' : page.reloadRequired ? 'reload-required' : 'enabled',
    label: page.state === 'disabled' ? '页面语言/时区未注册' : page.reloadRequired ? '语言/时区待完整重载' : '新文档语言/时区可用',
    detail: `匹配规则：${matchedRule.domain}；${pageRuntimeMessage(input.syncReport)} 旧请求头规则清理与 WebRTC 请分别查看同步详情。${PAGE_RUNTIME_PAUSED_SURFACES} ${PAGE_RUNTIME_DOCUMENT_SCOPE}`,
    ...operation
  };
}
