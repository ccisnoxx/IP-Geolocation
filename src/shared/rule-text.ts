import { createRule, normalizeDomain } from './config-model';
import type { SiteRule } from './types';

/**
 * 站点规则文本框的唯一实现（popup / options 共用）。
 *
 * 格式：每行一个域名，`!` 前缀表示**显式排除**（规则保留、enabled=false）。
 *
 *     google.com          ← 启用：google.com 及其子域
 *     !mail.google.com    ← 排除：命中更长的这条规则，整站保持原生值
 *
 * 之前两个页面各自写了一遍 `filter(enabled).map(domain)`，于是任何一次保存都会
 * 把所有 disabled 规则整条丢掉，"排除"永远活不过一次编辑。
 */
export const EXCLUDED_PREFIX = '!';

export interface ParsedRuleLine {
  domain: string;
  enabled: boolean;
}

export function parseRuleLines(value: string): ParsedRuleLine[] {
  const seen = new Set<string>();
  const parsed: ParsedRuleLine[] = [];

  for (const raw of String(value || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const excluded = line.startsWith(EXCLUDED_PREFIX);
    const domain = normalizeDomain(excluded ? line.slice(EXCLUDED_PREFIX.length) : line);
    if (!domain || seen.has(domain)) continue;

    seen.add(domain);
    parsed.push({ domain, enabled: !excluded });
  }

  return parsed;
}

/** 规则 → 文本框内容：disabled 的规则带上 `!` 前缀，保证往返不丢信息 */
export function ruleLines(rules: SiteRule[]): string {
  return rules
    .filter((rule) => Boolean(rule.domain))
    .map((rule) => (rule.enabled ? rule.domain : `${EXCLUDED_PREFIX}${rule.domain}`))
    .join('\n');
}

/**
 * 文本框 → 规则数组。
 *
 * 已存在的规则整条复用（保留 id 与 overrides），只改 domain / enabled；
 * 新域名用 `createRule` 建。顺序以文本框为准。
 */
export function rulesFromText(value: string, existingRules: SiteRule[]): SiteRule[] {
  const existingByDomain = new Map(existingRules.map((rule) => [rule.domain, rule]));

  return parseRuleLines(value).map(({ domain, enabled }) => ({
    ...(existingByDomain.get(domain) || createRule(domain)),
    domain,
    enabled
  }));
}