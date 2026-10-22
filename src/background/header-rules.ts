import { domainMatches, getEnabledRuleDomains, getLanguageTimezonePayload, validateConfig } from '../shared/config-resolver';
import { getAcceptLanguageValue } from '../shared/config-model';
import { RuntimeSyncOperationError } from '../shared/runtime-sync';
import { establishHeaderRuleOwnership, hasHeaderRuleOwnership } from '../shared/storage';
import type { SiteSpoofConfig } from '../shared/types';

type Rule = chrome.declarativeNetRequest.Rule;
export const HEADER_GUARD_RULESET = 'header_migration_guard';
export const HEADER_RULE_ID_START = 40000;
export const HEADER_RULE_ID_END = 49999;
const isLegacy = (rule: Rule) => rule.id === 1001 || rule.id === 1002 || rule.id >= 1100 && rule.id <= 2099;
const isOwned = (rule: Rule) => rule.id >= HEADER_RULE_ID_START && rule.id <= HEADER_RULE_ID_END;
const isPreviousSession = (rule: Rule) => rule.id >= 30000 && rule.id <= 39999;

export function compileHeaderRules(config: SiteSpoofConfig): Rule[] {
  const validated = validateConfig(config);
  if (!validated.ok) throw new Error('请求头配置校验失败');
  const domains = getEnabledRuleDomains(validated.config).sort();
  const rules: Rule[] = [];
  for (const domain of domains) {
    const language = getLanguageTimezonePayload(validated.config, domain)?.language;
    if (!language) continue;
    const children = domains.filter(child => child !== domain && domainMatches(child, domain));
    const common = { regexFilter: '^https?://' };
    const conditions: chrome.declarativeNetRequest.RuleCondition[] = [
      { ...common, requestDomains: [domain], ...(children.length ? { excludedRequestDomains: children } : {}),
        resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[] },
      { ...common, initiatorDomains: [domain], ...(children.length ? { excludedInitiatorDomains: children } : {}),
        excludedResourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[] }
    ];
    for (const condition of conditions) rules.push({ id: HEADER_RULE_ID_START + rules.length,
      priority: domain.length + 1, condition,
      action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [{ header: 'accept-language', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
          value: getAcceptLanguageValue(language.languages) }] } });
  }
  if (rules.length > HEADER_RULE_ID_END - HEADER_RULE_ID_START + 1) throw new Error('请求头站点规则数量超过受管范围');
  return rules;
}

function canonical(value: unknown): string {
  const sort = (item: any): any => Array.isArray(item) ? item.map(sort).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}

async function api(): Promise<typeof chrome.declarativeNetRequest> {
  if (!await chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }) || !chrome.declarativeNetRequest) {
    throw new RuntimeSyncOperationError('header-permission-required', '缺少请求头同步权限，不能确认旧规则清理或语言同步。');
  }
  return chrome.declarativeNetRequest;
}

// 仅由后台配置队列调用；默认静态guard在升级装载时已保护旧动态规则窗口。
export async function quarantineHeaderRules(): Promise<void> {
  const dnr = await api();
  if (!(await dnr.getEnabledRulesets()).includes(HEADER_GUARD_RULESET)) {
    await dnr.updateEnabledRulesets({ enableRulesetIds: [HEADER_GUARD_RULESET] });
  }
  if (!(await dnr.getEnabledRulesets()).includes(HEADER_GUARD_RULESET)) {
    throw new RuntimeSyncOperationError('header-quarantine-unconfirmed', '旧请求头规则隔离未能确认，已停止同步。');
  }
}

export async function migrateLegacyHeaderRules(): Promise<boolean> {
  const dnr = await api();
  const dynamic = (await dnr.getDynamicRules()).filter(isLegacy);
  const session = (await dnr.getSessionRules()).filter(rule => isLegacy(rule) || isPreviousSession(rule));
  if (dynamic.length || session.length) {
    await quarantineHeaderRules();
    if (dynamic.length) await dnr.updateDynamicRules({ removeRuleIds: dynamic.map(rule => rule.id) });
    if (session.length) await dnr.updateSessionRules({ removeRuleIds: session.map(rule => rule.id) });
  }
  if ((await dnr.getDynamicRules()).some(isLegacy) || (await dnr.getSessionRules()).some(rule => isLegacy(rule) || isPreviousSession(rule))) {
    throw new RuntimeSyncOperationError('legacy-header-cleanup-unconfirmed', '历史请求头规则仍有残留，保持隔离并停止同步。');
  }
  const owned = await hasHeaderRuleOwnership();
  const dynamicRules = await dnr.getDynamicRules();
  if (!owned && dynamicRules.some(isOwned)) {
    await quarantineHeaderRules();
    throw new RuntimeSyncOperationError('header-ownership-conflict', '新请求头命名空间已有未知规则，已保留并隔离，不能接管。');
  }
  // dynamic 30000..39999和session 40000..49999从未归本版本所有。
  const foreign = [...dynamicRules.filter(rule => !owned || !isOwned(rule)), ...await dnr.getSessionRules()];
  if (foreign.some(rule => rule.action.requestHeaders?.some(header => header.header.toLowerCase() === 'accept-language'))) {
    await quarantineHeaderRules();
    throw new RuntimeSyncOperationError('header-rule-conflict', '范围外存在未知语言请求头规则，已保留并隔离，请检查迁移冲突。');
  }
  return Boolean(dynamic.length || session.length);
}

async function claimHeaderRuleOwnership(): Promise<void> {
  if (await hasHeaderRuleOwnership()) return;
  await quarantineHeaderRules();
  if ((await (await api()).getDynamicRules()).some(isOwned)) {
    throw new RuntimeSyncOperationError('header-ownership-conflict', '新请求头命名空间已有未知规则，不能接管。');
  }
  await establishHeaderRuleOwnership();
  if (!await hasHeaderRuleOwnership()) {
    throw new RuntimeSyncOperationError('header-ownership-unconfirmed', '请求头规则所有权写入未确认，保持隔离。');
  }
}

// guard跨会话持久；必须先确认隔离再持久化会改变请求头投影的配置。
export async function quarantineBeforeHeaderConfigWrite(previous: SiteSpoofConfig, next: SiteSpoofConfig): Promise<void> {
  const validatedPrevious = validateConfig(previous);
  if (validatedPrevious.ok && canonical(compileHeaderRules(validatedPrevious.config)) === canonical(compileHeaderRules(next))) return;
  await quarantineHeaderRules();
}

export async function prepareHeaderRules(config: SiteSpoofConfig, beforeChange?: () => Promise<void>): Promise<Rule[]> {
  const migrated = await migrateLegacyHeaderRules();
  const desired = compileHeaderRules(config);
  const current = (await (await api()).getDynamicRules()).filter(isOwned);
  if (migrated || canonical(current) !== canonical(desired)
    || desired.length && (await (await api()).getEnabledRulesets()).includes(HEADER_GUARD_RULESET)) {
    if (beforeChange) await beforeChange();
    await quarantineHeaderRules();
  }
  return desired;
}

export async function clearHeaderRules(): Promise<void> {
  await quarantineHeaderRules();
  const dnr = await api();
  const owned = await hasHeaderRuleOwnership();
  const current = owned ? (await dnr.getDynamicRules()).filter(isOwned) : [];
  if (current.length) await dnr.updateDynamicRules({ removeRuleIds: current.map(rule => rule.id) });
  const previous = (await dnr.getSessionRules()).filter(isPreviousSession);
  if (previous.length) await dnr.updateSessionRules({ removeRuleIds: previous.map(rule => rule.id) });
  if (owned && (await dnr.getDynamicRules()).some(isOwned) || (await dnr.getSessionRules()).some(isPreviousSession)) {
    throw new RuntimeSyncOperationError('header-removal-unconfirmed', '请求头规则撤销未能确认，保持隔离。');
  }
}

export async function finishHeaderRules(desired: Rule[], pageReady: boolean): Promise<void> {
  if (!pageReady && desired.length) {
    await clearHeaderRules();
    throw new RuntimeSyncOperationError('header-page-not-ready', '页面语言尚未就绪，请求头同步保持隔离。');
  }
  const dnr = await api();
  if (desired.length) await claimHeaderRuleOwnership();
  const current = (await dnr.getDynamicRules()).filter(isOwned);
  if (canonical(current) !== canonical(desired)) {
    await quarantineHeaderRules();
    await dnr.updateDynamicRules({ removeRuleIds: current.map(rule => rule.id), addRules: desired });
  }
  if (canonical((await dnr.getDynamicRules()).filter(isOwned)) !== canonical(desired)) {
    throw new RuntimeSyncOperationError('header-verification-failed', '请求头规则读回与配置不一致，保持隔离。');
  }
  // 解除前再次确认迁移结果，不能仅凭上次成功或持久化标记放行。
  await migrateLegacyHeaderRules();
  if ((await dnr.getEnabledRulesets()).includes(HEADER_GUARD_RULESET)) {
    await dnr.updateEnabledRulesets({ disableRulesetIds: [HEADER_GUARD_RULESET] });
  }
  if ((await dnr.getEnabledRulesets()).includes(HEADER_GUARD_RULESET)) {
    throw new RuntimeSyncOperationError('header-quarantine-release-failed', '请求头规则已准备，但隔离尚未解除，实际请求头未确认。');
  }
}
