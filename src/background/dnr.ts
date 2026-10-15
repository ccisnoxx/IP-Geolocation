import { resolveEffectiveLanguageForRule } from '../shared/config-resolver';
import { isIpv4Address, isValidDomain, normalizeDomain } from '../shared/config-model';
import type { SiteSpoofConfig } from '../shared/types';
import { RuntimeSyncOperationError } from '../shared/runtime-sync';

export const ACCEPT_LANGUAGE_RULE_ID_START = 1100;
export const ACCEPT_LANGUAGE_RULE_ID_END = 2099;

const ACCEPT_LANGUAGE_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'xmlhttprequest',
  'script',
  'stylesheet',
  'image',
  'font',
  'other'
] as chrome.declarativeNetRequest.ResourceType[];

function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDomainUrlRegex(domain: string): string {
  const escapedDomain = escapeRegex(domain);
  const hostPattern = domain === 'localhost' || isIpv4Address(domain)
    ? escapedDomain
    : `([^/]+\\.)?${escapedDomain}`;
  return `^https?://${hostPattern}(?::[0-9]+)?/`;
}

export function managedAcceptLanguageRuleIds(): number[] {
  const ids: number[] = [];
  for (let id = ACCEPT_LANGUAGE_RULE_ID_START; id <= ACCEPT_LANGUAGE_RULE_ID_END; id += 1) {
    ids.push(id);
  }
  return ids;
}

export function buildAcceptLanguageRules(config: SiteSpoofConfig): chrome.declarativeNetRequest.Rule[] {
  if (!config.masterEnabled) return [];
  const rules: chrome.declarativeNetRequest.Rule[] = [];

  config.rules.filter((rule) => rule.enabled).forEach((rule) => {
    const domain = normalizeDomain(rule.domain);
    if (!isValidDomain(domain)) return;
    const language = resolveEffectiveLanguageForRule(config, rule);
    if (!language) return;
    const nextId = ACCEPT_LANGUAGE_RULE_ID_START + rules.length;
    if (nextId > ACCEPT_LANGUAGE_RULE_ID_END) {
      throw new Error('Accept-Language 规则超过可管理上限（1000）');
    }
    rules.push({
      id: nextId,
      priority: Math.max(1, domain.length),
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [{
          header: 'Accept-Language',
          operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
          value: language.acceptLanguage
        }]
      },
      condition: {
        regexFilter: buildDomainUrlRegex(domain),
        resourceTypes: ACCEPT_LANGUAGE_RESOURCE_TYPES
      }
    });
  });

  return rules;
}

function isManagedRule(rule: chrome.declarativeNetRequest.Rule): boolean {
  return rule.id >= ACCEPT_LANGUAGE_RULE_ID_START && rule.id <= ACCEPT_LANGUAGE_RULE_ID_END;
}

// 新配额常量晚于当前 @types/chrome；只读取当前浏览器实际提供的值。
function dnrApi() {
  const api = chrome.declarativeNetRequest as typeof chrome.declarativeNetRequest & {
    MAX_NUMBER_OF_DYNAMIC_RULES?: number;
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES?: number;
  };
  if (!api?.getDynamicRules || !api.updateDynamicRules) {
    throw new RuntimeSyncOperationError('unsupported', '浏览器不支持动态请求头规则。');
  }
  return api;
}

export async function validateAcceptLanguageCapacity(config: SiteSpoofConfig): Promise<void> {
  const desired = buildAcceptLanguageRules(config);
  const api = dnrApi();
  const other = (await api.getDynamicRules()).filter((rule) => !isManagedRule(rule));
  const regexLimit = api.MAX_NUMBER_OF_REGEX_RULES;
  if (other.filter((rule) => rule.condition.regexFilter).length + desired.length > regexLimit) {
    throw new Error(`DNR 正则规则超过浏览器上限（${regexLimit}）`);
  }
  if (typeof api.MAX_NUMBER_OF_DYNAMIC_RULES === 'number') {
    if (other.length + desired.length > api.MAX_NUMBER_OF_DYNAMIC_RULES) throw new Error('DNR 动态规则超过浏览器容量');
    const unsafeLimit = api.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES ?? api.MAX_NUMBER_OF_DYNAMIC_RULES;
    const unsafe = other.filter((rule) => !['block', 'allow', 'allowAllRequests', 'upgradeScheme'].includes(rule.action.type));
    if (unsafe.length + desired.length > unsafeLimit) throw new Error('DNR 请求头规则超过浏览器容量');
  } else {
    const sessions = await api.getSessionRules();
    if (other.length + desired.length + sessions.length > api.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES) {
      throw new Error('DNR 动态及会话规则超过浏览器容量');
    }
  }
}

function rulesSignature(rules: chrome.declarativeNetRequest.Rule[]): string {
  const canonical = (value: any): any => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  return JSON.stringify(canonical(rules.slice().sort((a, b) => a.id - b.id).map((rule) => ({
    ...rule,
    priority: rule.priority ?? 1,
    condition: {
      ...rule.condition,
      isUrlFilterCaseSensitive: rule.condition.isUrlFilterCaseSensitive ?? false,
      resourceTypes: rule.condition.resourceTypes?.slice().sort()
    }
  }))));
}

export async function updateAcceptLanguageRules(config: SiteSpoofConfig): Promise<void> {
  const api = dnrApi();
  const desired = buildAcceptLanguageRules(config);
  const current = (await api.getDynamicRules()).filter(isManagedRule);
  if (rulesSignature(current) === rulesSignature(desired)) return;
  await validateAcceptLanguageCapacity(config);
  await api.updateDynamicRules({ removeRuleIds: current.map((rule) => rule.id), addRules: desired });
  if (rulesSignature((await api.getDynamicRules()).filter(isManagedRule)) !== rulesSignature(desired)) {
    throw new RuntimeSyncOperationError('verification-failed', '请求头规则更新后仍与配置不一致。');
  }
}
