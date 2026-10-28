// 字体策略的纯函数部分：页面侧（CanvasRenderingContext2D/document.fonts）与
// Worker 侧（OffscreenCanvas/FontFaceSet）共用同一套解析，避免两边判定不一致。
import { FONT_FAMILY_ALIASES } from '../../shared/font-families';
export const FONT_SIZE_PATTERN =
  /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

export function trimFontWhitespace(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

export function fontFamilyKey(family: string): string {
  const token = trimFontWhitespace(family);
  const quoted = (token[0] === '"' || token[0] === "'") && token[token.length - 1] === token[0];
  // 在解码转义的同一次扫描中折叠分隔空白；转义产生的空格属于字体名称。
  const key = (quoted ? token.slice(1, -1) : token)
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f])|\\(?:\r\n|[\n\r\f])|([\t\n\f\r ]+)/gi, (match, hex: string, escaped: string, whitespace: string) => {
      if (hex) {
        const code = parseInt(hex, 16);
        return String.fromCodePoint(code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
      }
      if (escaped !== undefined) return escaped;
      if (whitespace) return quoted ? match : ' ';
      return '';
    }).toLowerCase();
  return FONT_FAMILY_ALIASES[key] || key;
}

export function splitFontFamilies(familyList: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of familyList) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === ',' && !quote) {
      if (trimFontWhitespace(current)) families.push(trimFontWhitespace(current));
      current = '';
      continue;
    }
    current += char;
  }
  if (trimFontWhitespace(current)) families.push(trimFontWhitespace(current));
  return families;
}

function filterMeasurementFont(font: string, keepFamily: (family: string) => boolean, fallback: string): string | null {
  const sizeMatch = font.match(FONT_SIZE_PATTERN);
  if (!sizeMatch || sizeMatch.index === undefined) return null;
  const familyStart = sizeMatch.index + sizeMatch[0].length;
  const prefix = trimFontWhitespace(font.slice(0, familyStart));
  const families = splitFontFamilies(trimFontWhitespace(font.slice(familyStart)));
  if (!families.length) return null;
  const fallbackFamilies = families.filter(keepFamily);
  if (fallbackFamilies.length === families.length) return null;
  return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : fallback}`;
}

export function getFallbackFont(font: string, blockedFontFamilyKeys: Set<string>): string | null {
  return filterMeasurementFont(font, family => !blockedFontFamilyKeys.has(fontFamilyKey(family)), '"__vg_absent__"');
}
