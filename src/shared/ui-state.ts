// Popup 的当前站点状态投影；有效 payload 由共享解析器唯一生成。
import { isRuntimeInjectionPaused, pageRuntimeSummary, geolocationRuntimeSummary } from './runtime-sync';
import { findMatchingRule, getPageRuntimeProfile, getGeolocationPayload } from './config-resolver';
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
    ? { kind: 'enabled', message: '总开关已开启（配置）· 所选站点规则已启用；页面语言/时区注册、字体过滤、WebRTC 分别查看同步详情。当前页面实际值尚未验证。' }
    : { kind: 'ready', message: '已配置 · 保护关闭。只有明确开启总开关后才生效。' };
}

export function renderSetupStatus(element: HTMLElement, config: SiteSpoofConfig, report?: RuntimeSyncReport): void {
  const state = deriveSetupStatus(config);
  element.dataset.setup = state.kind;
  element.dataset.sync = report?.status || 'unknown';
  if (isRuntimeInjectionPaused(report)) {
    element.textContent = '历史报告：页面伪装已暂停／部分生效。已保存的开关与站点规则保留；WebRTC 请查看同步详情。已有 hook 与旧 BFCache 文档需关闭并重建。';
    return;
  }
  element.textContent = `${state.message}${report?.status === 'ok' ? '' : ' 同步尚未完成或确认，请查看同步详情并重试。'}`;
}

export type CurrentSiteStatusKind = 'unsupported' | 'global-disabled' | 'not-allowlisted' | 'enabled' | 'disabled' | 'reload-required' | 'runtime-unavailable' | 'unknown' | 'paused' | 'error' | 'partial';

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

export function deriveCurrentSiteStatus(input: CurrentSiteStatusInput): CurrentSiteStatus {
  const domain = input.domain || '';
  const matchedRule = input.rule || (domain ? findMatchingRule(input.config, domain) : null);

  if (!input.scriptable || !domain) {
    return {
      kind: 'unsupported',
      label: '不支持此页面',
      detail: '仅支持普通 HTTP(S) 网页。',
      canEnable: false,
      canDisable: false,
      disableDomain: null
    };
  }
  if (!input.config.masterEnabled) {
    return {
      kind: 'global-disabled',
      label: '总开关已关闭',
      detail: '总开关已保存为关闭，同步状态见上方。',
      canEnable: !matchedRule,
      canDisable: Boolean(matchedRule),
      disableDomain: matchedRule ? domain : null
    };
  }
  if (!input.matched || !matchedRule) {
    return {
      kind: 'not-allowlisted',
      label: '未启用当前网站',
      detail: '当前网站未加入白名单。',
      canEnable: true,
      canDisable: false,
      disableDomain: null
    };
  }
  if (matchedRule.compatibilityPreset === 'native') return {
    kind: 'disabled', label: 'native · 页面与请求头原生',
    detail: `匹配规则：${matchedRule.domain}。不应用语言、时区、定位或字体修改；WebRTC 仍由浏览器全局策略控制。保存同步后需完整重建文档。`,
    canEnable: false, canDisable: true, disableDomain: domain
  };
  if (!input.payload) {
    return {
      kind: 'error',
      label: '配置不完整',
      detail: input.errors.length ? input.errors.join('；') : '当前规则缺少有效的语言/时区配置，请打开完整配置。',
      canEnable: false,
      canDisable: true,
      disableDomain: domain
    };
  }
  if (isRuntimeInjectionPaused(input.syncReport)) return {
    kind: 'paused', label: '语言/时区已暂停',
    detail: `匹配规则：${matchedRule.domain}。请在完整配置查看暂停详情。`,
    canEnable: false, canDisable: true, disableDomain: domain
  };
  const operation = { canEnable: false, canDisable: true, disableDomain: domain };
  const geolocation = getGeolocationPayload(input.config, domain);
  if (!input.payload.languageConfig && !input.payload.timezone && geolocation) {
    const runtime = input.syncReport?.geolocationRuntime;
    return { ...operation, kind: !runtime ? 'unknown' : runtime.state === 'ready' ? runtime.reloadRequired ? 'reload-required' : 'enabled' : 'runtime-unavailable',
      label: !runtime ? '定位同步待确认' : runtime.state === 'ready' ? runtime.reloadRequired ? '请重新加载网页' : '规则已同步' : geolocationRuntimeSummary(input.syncReport),
      detail: `匹配规则：${matchedRule.domain}。${geolocationRuntimeSummary(input.syncReport)}。网页实际效果尚未验证。` };
  }
  if (!input.payload.languageConfig && !input.payload.timezone) return {
    kind: 'disabled', label: '当前规则未启用语言/时区',
    detail: `匹配规则：${matchedRule.domain}。语言/时区均未开启。`,
    ...operation
  };
  const page = input.syncReport?.pageRuntime;
  if (!page) return {
    kind: 'unknown', label: '同步待确认',
    detail: `匹配规则：${matchedRule.domain}。请重试同步。`,
    ...operation
  };
  if (page.state !== 'ready' && page.state !== 'disabled') return {
    kind: 'runtime-unavailable',
    label: ({ 'api-unsupported': '浏览器不支持 userScripts', 'permission-required': '缺少 userScripts 权限', 'switch-required': '请开启 Allow User Scripts', 'sync-failed': '页面语言/时区同步失败' })[page.state],
    detail: `匹配规则：${matchedRule.domain}。${pageRuntimeSummary(input.syncReport)}，详情见完整配置。`,
    ...operation
  };
  // 解析出部分配置不代表页面或请求头已同步；先展示注册失败与重载欠账。
  if (input.errors.length && page.state === 'ready' && !page.reloadRequired) {
    const available = [input.payload.languageConfig ? '语言' : null, input.payload.timezone ? '时区' : null,
      input.payload.geolocation ? '定位' : null].filter(Boolean).join('、') || '无';
    const headers = input.syncReport?.components.headers;
    const headerMessage = !headers ? '请求头同步待确认' : headers.status === 'ok' ? '请求头注册已同步' : '请求头同步未完成，请查看同步详情';
    return { ...operation, kind: 'partial', label: `部分配置可用：${available}`,
      detail: `匹配规则：${matchedRule.domain}。可用配置：${available}；未生效原因：${input.errors.join('；')}。页面注册已同步；${headerMessage}。网页实际效果尚未验证。` };
  }
  return {
    kind: page.state === 'disabled' ? 'disabled' : page.reloadRequired ? 'reload-required' : 'enabled',
    label: page.state === 'disabled' ? '语言/时区未启用' : page.reloadRequired ? '请重新加载网页' : '规则已同步',
    detail: `匹配规则：${matchedRule.domain}。${page.state === 'disabled' ? '语言/时区未注册，同步详情见完整配置。' : page.reloadRequired ? '重新加载后应用最新设置。' : '网页实际效果尚未验证。'}`,
    ...operation
  };
}
