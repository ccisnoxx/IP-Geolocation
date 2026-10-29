import { normalizeLanguage } from '../shared/config-model';
import {
  getCarveOutDomains,
  getEffectiveLanguage,
  getExcludedDomainsFor
} from '../shared/config-resolver';
import type { LanguageConfig, LastLocation, SiteRule, SiteSpoofConfig } from '../shared/types';

export const ACCEPT_LANGUAGE_RULE_ID_START = 1100;
export const ACCEPT_LANGUAGE_RULE_ID_END = 2099;

/** 烘焙构建里由 manifest 声明的静态规则集（配置改过之后就禁用它，交给动态规则） */
export const BAKED_RULESET_ID = 'baked-language';

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

function languageForRule(config: SiteSpoofConfig, rule: SiteRule): LanguageConfig | null {
  const override = rule.overrides.language;
  if (override.mode === 'disable') return null;
  if (override.mode === 'override') return normalizeLanguage(override.value || {});
  return config.globalProfile.language.enabled ? config.globalProfile.language : null;
}

export function managedAcceptLanguageRuleIds(): number[] {
  const ids: number[] = [];
  for (let id = ACCEPT_LANGUAGE_RULE_ID_START; id <= ACCEPT_LANGUAGE_RULE_ID_END; id += 1) {
    ids.push(id);
  }
  return ids;
}

/**
 * 只给「语言真的会生效」的域名发头。
 *
 * 关键：Accept-Language 只取决于语言配置，**不依赖定位**。早先这里用
 * `getEffectiveProfile(...).payload` 当开关，时区解析不出来就把头一起停了，
 * 结果 auto 模式首帧出现「请求头 zh-CN、页面 en-US」（定位在注入前就恢复了，
 * 但请求已经发出去了）。现在语言和时区分开判定，头永远跟 JS 的 navigator.language 一致。
 */
export function buildAcceptLanguageRules(
  config: SiteSpoofConfig,
  lastLocation: LastLocation | null = null
): chrome.declarativeNetRequest.Rule[] {
  void lastLocation;
  if (!config.masterEnabled) return [];
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  // 父规则要挖掉的东西有两类，缺一类都会出现"页面原生、请求头伪装"的撕裂：
  //
  //  1. 被显式禁用的域名（`google.com` 启用 + `!mail.google.com`）：整棵子树挖掉；
  //  2. **启用但语言不生效**的域名（`overrides.language.mode = 'disable'`，或者全局
  //     语言关掉后子孙仍启用）：它自己不会生成头规则，于是父规则会照着父域语言改写
  //     它的请求 —— 而页面 JS 那边 navigator.language 是原生的。
  //
  // 注意这里用的是 carve-out（不做 rescue）：`a.com` / `!b.a.com` / `c.b.a.com`
  // 三者都成立时，父规则挖掉整个 `b.a.com`，`c.b.a.com` 靠自己的规则重新生效。
  // 内容脚本那张带 rescue 的表在这里是错的，它会让父规则重新覆盖中间层。
  const excludedDomains = [
    ...new Set([
      ...getCarveOutDomains(config),
      ...config.rules
        .filter((rule) => rule.enabled && rule.domain && !getEffectiveLanguage(config, rule.domain))
        .map((rule) => rule.domain)
    ])
  ];

  config.rules.filter((rule) => rule.enabled).forEach((rule) => {
    const language = languageForRule(config, rule);
    if (!language) return;
    if (!getEffectiveLanguage(config, rule.domain)) return;
    const nextId = ACCEPT_LANGUAGE_RULE_ID_START + rules.length;
    if (nextId > ACCEPT_LANGUAGE_RULE_ID_END) {
      throw new Error('Too many Accept-Language rules');
    }
    const excludedForRule = getExcludedDomainsFor(rule.domain, excludedDomains);
    rules.push({
      id: nextId,
      priority: Math.max(1, rule.domain.length),
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [{
          header: 'Accept-Language',
          operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
          value: language.acceptLanguage
        }]
      },
      condition: {
        // requestDomains 自动覆盖子域，且不依赖正则 —— Helium（Chromium 156 分支）
        // 上带 regexFilter 的 modifyHeaders 规则会把 main_frame 直接 ERR_ABORTED。
        requestDomains: [rule.domain],
        ...(excludedForRule.length ? { excludedRequestDomains: excludedForRule } : {}),
        resourceTypes: ACCEPT_LANGUAGE_RESOURCE_TYPES
      }
    });
  });

  return rules;
}

function ruleSignature(rule: chrome.declarativeNetRequest.Rule): string {
  return `${rule.id}#${ruleContentSignature(rule)}`;
}

/** 只比内容、不比 id —— 静态规则集从 1 编号，动态规则从 1100 编号 */
function ruleContentSignature(rule: chrome.declarativeNetRequest.Rule): string {
  const condition = rule.condition || {};
  const headers = (rule.action.requestHeaders || [])
    .map((header) => `${header.header}|${header.operation}|${header.value}`)
    .join(',');
  return [
    rule.priority,
    headers,
    (condition.requestDomains || []).join(','),
    (condition.excludedRequestDomains || []).join(','),
    (condition.resourceTypes || []).slice().sort().join(',')
  ].join('#');
}

function contentSignatures(rules: chrome.declarativeNetRequest.Rule[]): string {
  return rules.map(ruleContentSignature).sort().join('\n');
}

function isManagedRule(rule: chrome.declarativeNetRequest.Rule): boolean {
  return rule.id >= ACCEPT_LANGUAGE_RULE_ID_START && rule.id <= ACCEPT_LANGUAGE_RULE_ID_END;
}

/** 静态规则集里的 id 从 1 开始编号（每个 ruleset 有独立的 id 空间） */
export function buildStaticAcceptLanguageRules(
  config: SiteSpoofConfig,
  lastLocation: LastLocation | null = null
): chrome.declarativeNetRequest.Rule[] {
  return buildAcceptLanguageRules(config, lastLocation).map((rule, index) => ({ ...rule, id: index + 1 }));
}

/** 本次构建烘焙进去的静态规则，没有就是 null（普通构建走动态规则） */
export function bakedStaticRules(): chrome.declarativeNetRequest.Rule[] | null {
  if (typeof __VANISHGEO_STATIC_RULES__ === 'undefined') return null;
  const rules = __VANISHGEO_STATIC_RULES__;
  return Array.isArray(rules) && rules.length > 0 ? rules : null;
}

async function isRulesetEnabled(id: string): Promise<boolean> {
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    return enabled.includes(id);
  } catch {
    return false;
  }
}

/**
 * 每条规则落地一次就够。三个不想踩的坑：
 * - 重写动态规则会让**正在进行的请求**直接 ERR_ABORTED（Chromium 156 实测：启动后第一个页面白屏）
 * - **任何一次真正的 DNR 写入都会把 BFCache 页面驱逐出缓存**（Chromium 实测：remove+add
 *   同内容也会；只改时区不写 DNR 则不会。`updateSessionRules` 首写同样会）。所以下面的
 *   签名去重不只是省一次 IPC —— 它决定了"保存一个跟请求头无关的配置"要不要让用户
 *   已打开的页面重新加载。`tests/dnr.test.ts` 有对应用例盯着这条性质。
 * - 烘焙构建的静态规则在第一条请求之前就生效，SW 根本没启动也不影响
 * 所以：静态规则能覆盖当前配置时完全不动动态规则；配置被改过才禁用静态、改用动态。
 */
export async function updateAcceptLanguageRules(
  config: SiteSpoofConfig,
  lastLocation: LastLocation | null = null
): Promise<void> {
  const api = chrome.declarativeNetRequest;
  if (!api?.updateDynamicRules) return;

  const next = buildAcceptLanguageRules(config, lastLocation);
  const staticRules = bakedStaticRules();

  if (staticRules && await isRulesetEnabled(BAKED_RULESET_ID)) {
    if (contentSignatures(staticRules) === contentSignatures(next)) {
      const leftovers = (await api.getDynamicRules()).filter(isManagedRule);
      if (leftovers.length > 0) {
        await api.updateDynamicRules({ removeRuleIds: managedAcceptLanguageRuleIds() });
      }
      return;
    }
    await api.updateEnabledRulesets({ disableRulesetIds: [BAKED_RULESET_ID] });
  }

  const managed = (await api.getDynamicRules()).filter(isManagedRule);
  if (managed.length === next.length
    && managed.map(ruleSignature).sort().join('\n') === next.map(ruleSignature).sort().join('\n')) {
    return;
  }

  await api.updateDynamicRules({
    removeRuleIds: managedAcceptLanguageRuleIds(),
    addRules: next
  });
}
