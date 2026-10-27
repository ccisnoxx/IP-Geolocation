/**
 * 字体伪装的最后一步：把命中的族名从 `ctx.font` 串里摘掉。
 *
 * 关键在"摘掉之后填什么"。
 *
 * 曾经填的是 `monospace`。实测（真 Mac，16px，`MMMM` 宽度）：
 *
 *   monospace            38.53
 *   sans-serif           56.45
 *   随便编一个不存在族名  56.45   ← 真·缺失长这样
 *
 * 也就是说：被隐藏的字体量出 38.53，真正没装的字体量出 56.45。检测方只要额外
 * 量一个对照组（哪怕随口编个 `"NoSuchFontZzz"`），就能把"这台机器没有这个字体"
 * 和"这个字体被藏起来了"分开 —— 十几个字体全都恰好等于等宽字体，本身就是指纹。
 *
 * 所以这里填一个**必然不存在**的族名：它走的就是浏览器处理缺失字体的同一条回落
 * 路径，度量结果与真缺失逐字节一致，两种主流判据（"和基线比""和对照组比"）同时
 * 满足。
 */
export const MISSING_FONT_FAMILY = '"__vg_absent__"';

/** 只认 css font 串里的 size 段，用来切出"前缀 + 族名列表" */
export const FONT_SIZE_PATTERN = /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

/** 按逗号切族名，引号与转义里的逗号不算分隔符 */
export function splitFontFamilies(familyList: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of familyList) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\') { current += char; escaped = true; continue; }
    if ((char === '"' || char === "'") && !quote) { quote = char; current += char; continue; }
    if (quote && char === quote) { quote = null; current += char; continue; }
    if (char === ',' && !quote) {
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) families.push(current.trim());
  return families;
}

/**
 * 命中被伪装字体时返回改写后的 font 串，否则 `null`（调用方走原生度量）。
 *
 * 保留页面自己写的回退族名 —— `"SimSun", sans-serif` 只需要变成 `sans-serif`，
 * 结果正好等于检测方拿来当基线的那次测量，差值 0。只有"一个都不剩"时才需要
 * `MISSING_FONT_FAMILY` 兜底。
 */
export function rewriteFontString(
  font: string,
  isTarget: (family: string) => boolean
): string | null {
  if (!font) return null;
  const sizeMatch = font.match(FONT_SIZE_PATTERN);
  if (!sizeMatch || sizeMatch.index === undefined) return null;
  const familyStart = sizeMatch.index + sizeMatch[0].length;
  const prefix = font.slice(0, familyStart).trim();
  const families = splitFontFamilies(font.slice(familyStart).trim());
  if (!families.length) return null;
  const kept = families.filter((family) => !isTarget(family));
  if (kept.length === families.length) return null;
  return `${prefix} ${kept.length ? kept.join(', ') : MISSING_FONT_FAMILY}`;
}