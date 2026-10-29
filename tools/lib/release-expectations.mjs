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
 * 期望值的最终来源：发布清单优先（那是发布时的意图），其次包内烘焙值，
 * 最后是静态请求头。三者都取不到时**不做断言**，由调用方判失败 ——
 * 早先这里退化成 `|| true`，于是"验证通过"什么都没证明。
 *
 * @param {{ summary?: any, source?: string, rules?: any[] }} input
 * @returns {{ expectTz: string | null, expectLocale: string | null, bakedLocale: string | null, headerLocale: string | null }}
 */
export function resolveExpectations({ summary, source, rules } = {}) {
  const baked = inferBakedFields(source);
  const headerLocale = headerLocaleFromRules(rules);
  const summaryTz = summary?.timezone ?? null;
  const summaryLocale = summary?.locale ?? null;
  return {
    expectTz: summaryTz || baked.timezone || null,
    expectLocale: summaryLocale || baked.locale || headerLocale || null,
    bakedLocale: baked.locale,
    headerLocale
  };
}
