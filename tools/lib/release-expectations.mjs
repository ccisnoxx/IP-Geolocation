/*
 * 从发布包里推断"应该读到什么"。
 *
 * 抽成纯函数是为了能直接测：verify-release.mjs 整个跑起来要开真 Chrome、开 https
 * 服务器、装扩展，而"期望值取对了没有"这件事完全可以离线断言 —— 恰恰是这一步出过
 * 恒真断言（`x !== y || true`）的毛病，必须让它可以被测试盯住。
 */

/**
 * 从注入层的烘焙字面量里抠字段。
 *
 * 产物里的形状是 `{ config: { ..., timezone: { enabled: true, mode: "manual",
 * timezone: "Asia/Tokyo" }, language: { enabled: true, ..., language: "ja-JP",
 * languages: [...] } } }` —— 键名不带引号，值是字符串。规则里的
 * `overrides: { timezone: { mode: "inherit", value: null } }` 没有内层同名字符串，
 * 不会被误匹配。
 *
 * @param {string} source
 * @returns {{ timezone: string | null, locale: string | null }}
 */
export function inferBakedFields(source) {
  const text = String(source || '');
  const pick = (name) => {
    const match = new RegExp(`${name}:\\s*\\{[^}]*?\\b${name}:\\s*"([^"]+)"`).exec(text);
    return match ? match[1] : null;
  };
  return { timezone: pick('timezone'), locale: pick('language') };
}

/**
 * 静态 DNR 规则里 Accept-Language 的首段就是目标 locale。
 *
 * @param {any[]} rules
 * @returns {string | null}
 */
export function headerLocaleFromRules(rules) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    for (const header of rule?.action?.requestHeaders || []) {
      if (String(header.header).toLowerCase() !== 'accept-language') continue;
      const first = String(header.value || '').split(',')[0].trim();
      if (first) return first;
    }
  }
  return null;
}

/**
 * 静态 DNR 规则里 Accept-Language 的**完整**取值。
 *
 * 首段只说明"首选语言"，但真实请求头还带着 q 权重和后续项 —— 发布验收要断言页面
 * 主文档实际发出的整串头，就得拿到整串期望值。
 *
 * @param {any[]} rules
 * @returns {string | null}
 */
export function headerValueFromRules(rules) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    for (const header of rule?.action?.requestHeaders || []) {
      if (String(header.header).toLowerCase() !== 'accept-language') continue;
      const value = String(header.value || '').trim();
      if (value) return value;
    }
  }
  return null;
}

/**
 * 静态规则覆盖的域名（去重、保序）。
 *
 * @param {any[]} rules
 * @returns {string[]}
 */
export function ruleDomains(rules) {
  const seen = new Set();
  for (const rule of Array.isArray(rules) ? rules : []) {
    for (const domain of rule?.condition?.requestDomains || []) {
      const value = String(domain || '').trim().toLowerCase();
      if (value) seen.add(value);
    }
  }
  return [...seen];
}

/**
 * 从烘焙字面量里取完整语言列表。
 *
 * `navigator.languages` 是 FrozenArray，逐项都能被页面读到；只对 `navigator.language`
 * 会漏掉"首选一致、后续项不同"的那类破绽。
 *
 * @param {string} source
 * @returns {string[] | null}
 */
export function inferBakedLanguages(source) {
  const text = String(source || '');
  // 取**第一个非空**的 `languages: [...]`，不是第一个 match：
  // 注入层里先出现的是 `languages: []`（默认配置的空列表），拿它当答案会让
  // "navigator.languages 与烘焙列表一致"这条断言永远验证不到东西。
  for (const match of text.matchAll(/languages:\s*\[([^\]]*)\]/g)) {
    const items = [...match[1].matchAll(/"([^"]*)"/g)].map((item) => item[1]).filter(Boolean);
    if (items.length) return items;
  }
  return null;
}

/**
 * 期望值的最终来源：发布清单优先（那是发布时的意图），其次包内烘焙值，
 * 最后是静态请求头。三者都取不到时**不做断言**，由调用方判失败 ——
 * 早先这里退化成 `|| true`，于是"验证通过"什么都没证明。
 *
 * @param {{ summary?: any, source?: string, rules?: any[] }} input
 * @returns {{ expectTz: string | null, expectLocale: string | null, bakedLocale: string | null, headerLocale: string | null, bakedLanguages: string[] | null, headerValue: string | null, domains: string[] }}
 */
export function resolveExpectations({ summary, source, rules } = {}) {
  const baked = inferBakedFields(source);
  const headerLocale = headerLocaleFromRules(rules);
  const summaryTz = summary?.timezone ?? null;
  const summaryLocale = summary?.locale ?? null;
  const summaryLanguages = Array.isArray(summary?.languages) && summary.languages.length ? summary.languages : null;
  const domains = [...(Array.isArray(summary?.domains) ? summary.domains : []), ...ruleDomains(rules)];
  return {
    expectTz: summaryTz || baked.timezone || null,
    expectLocale: summaryLocale || baked.locale || headerLocale || null,
    bakedLocale: baked.locale,
    headerLocale,
    bakedLanguages: summaryLanguages || inferBakedLanguages(source),
    headerValue: headerValueFromRules(rules),
    domains: [...new Set(domains)]
  };
}
