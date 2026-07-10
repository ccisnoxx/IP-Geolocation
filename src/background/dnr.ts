import { resolveEffectiveLanguageForRule } from '../shared/config-resolver';
import { isIpv4Address, isValidDomain, normalizeDomain } from '../shared/config-model';
import type { SiteSpoofConfig } from '../shared/types';

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
      throw new Error('Too many Accept-Language rules');
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

export async function updateAcceptLanguageRules(config: SiteSpoofConfig): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: managedAcceptLanguageRuleIds(),
    addRules: buildAcceptLanguageRules(config)
  });
}
