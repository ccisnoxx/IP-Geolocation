import { HEADER_GUARD_RULESET } from '../../src/background/header-rules';
type Rule = chrome.declarativeNetRequest.Rule;

export function createDnrMock(dynamic: Rule[] = [], session: Rule[] = []) {
  let enabled = [HEADER_GUARD_RULESET];
  const events: string[] = [];
  const update = (rules: Rule[], input: { removeRuleIds?: number[]; addRules?: Rule[] }) =>
    rules.filter(rule => !input.removeRuleIds?.includes(rule.id)).concat(structuredClone(input.addRules || []));
  const api = {
    getDynamicRules: async () => structuredClone(dynamic),
    getSessionRules: async () => structuredClone(session),
    getEnabledRulesets: async () => enabled.slice(),
    updateDynamicRules: async (input: { removeRuleIds?: number[]; addRules?: Rule[] }) => { events.push('dynamic'); dynamic = update(dynamic, input); },
    updateSessionRules: async (input: { removeRuleIds?: number[]; addRules?: Rule[] }) => { events.push('session'); session = update(session, input); },
    updateEnabledRulesets: async (input: { enableRulesetIds?: string[]; disableRulesetIds?: string[] }) => {
      events.push(input.enableRulesetIds?.length ? 'quarantine' : 'release');
      enabled = [...new Set(enabled.filter(id => !input.disableRulesetIds?.includes(id)).concat(input.enableRulesetIds || []))];
    }
  };
  return { api, events };
}
