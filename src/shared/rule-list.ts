import { normalizeDomain, normalizeRule } from './config-model';
import type { SiteRule } from './types';

export function ruleListToText(rules: readonly SiteRule[]): string {
  return rules.filter((rule) => rule.enabled).map((rule) => rule.domain).join('\n');
}

export function rulesFromText(value: string, existingRules: readonly SiteRule[]): SiteRule[] {
  const domains = new Set(value.split('\n').map(normalizeDomain).filter(Boolean));
  // 文本只管理启用集合；原位保留禁用规则，避免无关保存改变规则及顺序。
  const rules = existingRules.flatMap((rule) => {
    if (domains.delete(rule.domain)) return [{ ...rule, enabled: true }];
    return rule.enabled ? [] : [rule];
  });
  const usedIds = new Set(existingRules.map((rule) => rule.id));
  for (const domain of domains) {
    // 显式 ID 让编辑结果确定且幂等；规则默认值仍由配置模型拥有。
    const baseId = `rule-${domain}`;
    let id = baseId;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}-${suffix}`;
    usedIds.add(id);
    rules.push(normalizeRule({ id, domain }));
  }
  return rules;
}
