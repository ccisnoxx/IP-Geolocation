/**
 * 内置 preset 的唯一读取入口。
 *
 * 预设清单只在 `src/shared/config-model.ts` 里写一份（配置来源必须唯一，多写一份
 * JSON 迟早对不上），但发布流水线和浏览器 E2E 又要用它，所以这里从源码文本里把
 * `DEFAULT_PROFILES` 抽出来。
 *
 * 抽取用大括号配对扫描，不按行切分：给 `DEFAULT_PROFILES` 加一个多行嵌套的新 preset
 * 时，按 `\n  {\n` 切会静默漏掉它，报出来的却是下游"数量不对"，排查方向全错。
 *
 * 扫描前先剥掉注释：注释是**文字**不是结构，但它里面照样可以出现 `[` `]` 和撇号。
 * 不剥的话，一句 `// 参考 [1]` 会让大括号扫描提前收尾、一句 `// don't remove` 会让
 * 引号扫描一路吞到下一个引号 —— 两种都是"少一个 preset、不报错"，最难查的那种。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOCK_START = /export const DEFAULT_PROFILES\b/;
// 与 src/shared/config-model.ts 的 DEFAULT_GEOLOCATION.accuracy 必须一致，
// 否则烘焙产物（走这里）与扩展内预设页（走 config-model）会给出不同的精度。
export const DEFAULT_PRESET_ACCURACY = 50;
const SOURCE_PATH = ['src', 'shared', 'config-model.ts'];

function skipString(source, index) {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor;
    cursor += 1;
  }
  return cursor;
}

/**
 * 把注释换成空白/换行，字符串字面量原样保留。
 *
 * 字符串里出现 `//`（例如 URL）不能当注释，所以这里也走一遍 skipString；
 * 块注释未闭合直接抛错 —— 那意味着我们看到的源码本身是坏的，静默截断只会让
 * 下游拿到"少几个 preset"的清单。
 */
function stripComments(source) {
  let out = '';
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "'" || char === '"' || char === '`') {
      const end = skipString(source, cursor);
      out += source.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor + 2);
      if (end < 0) break;
      cursor = end;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end < 0) throw new Error('块注释没有闭合：DEFAULT_PROFILES 所在源码被截断了');
      out += ' ';
      cursor = end + 2;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}

/** 切出 `DEFAULT_PROFILES` 数组里的每个顶层对象文本（含嵌套对象整体）。 */
function splitEntries(source) {
  const found = source.match(BLOCK_START);
  const start = found ? found.index : -1;
  if (start === undefined || start < 0) throw new Error(`没找到 ${BLOCK_START.source}`);
  // 从 `=` 之后找 `[`：声明里的类型标注 `: Profile[]` 也带方括号，先遇到它就会当场收尾。
  const assign = source.indexOf('=', start);
  if (assign < 0) throw new Error('DEFAULT_PROFILES 没有赋值');
  let index = source.indexOf('[', assign);
  if (index < 0) throw new Error('DEFAULT_PROFILES 后面没有数组字面量');
  index += 1;

  const entries = [];
  let depth = 0;
  let entryStart = -1;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipString(source, index);
      continue;
    }
    if (char === '{') {
      if (depth === 0) entryStart = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && entryStart >= 0) {
        entries.push(source.slice(entryStart, index + 1));
        entryStart = -1;
      }
      continue;
    }
    if (char === ']' && depth === 0) break;
  }
  return entries;
}

/**
 * 取字符串字段。值里可以含转义引号（`name: 'Cote d\'Ivoire'`）：不能写成 `[^']*`，
 * 那会在第一个撇号处截断，拿到半截名字还不报错。
 */
function pickString(entry, field) {
  const raw = entry.match(new RegExp(`${field}: '((?:\\\\.|[^'\\\\])*)'`))?.[1];
  return raw === undefined ? undefined : raw.replace(/\\(.)/g, '$1');
}

function pickNumber(entry, field) {
  const raw = entry.match(new RegExp(`${field}: (-?[\\d.]+)`))?.[1];
  return raw === undefined ? undefined : Number(raw);
}

function requireField(value, field, id, entry) {
  if (value === undefined || value === '') {
    throw new Error(`preset${id ? ` "${id}"` : ''} 缺少字段 ${field}：\n${entry}`);
  }
  return value;
}

/**
 * 从 `config-model.ts` 源码里解析出全部内置 preset。
 *
 * 缺必填字段（id / latitude / longitude / language / timezone）直接抛错并附上该条
 * 原文：静默 `continue` 会让下游拿到少一个 preset 的清单，最后在浏览器 E2E 里才炸。
 */
export function parsePresets(source) {
  const entries = splitEntries(stripComments(source));
  if (!entries.length) throw new Error('DEFAULT_PROFILES 解析到 0 个 preset');

  const presets = entries.map((entry) => {
    const id = requireField(pickString(entry, 'id'), 'id', undefined, entry);
    const timezone = requireField(pickString(entry, 'timezone'), 'timezone', id, entry);
    const locale = requireField(pickString(entry, 'language'), 'language', id, entry);
    const latitude = requireField(pickNumber(entry, 'latitude'), 'latitude', id, entry);
    const longitude = requireField(pickNumber(entry, 'longitude'), 'longitude', id, entry);
    const languages = entry.match(/languages: \[([^\]]+)\]/)?.[1];
    return {
      id,
      name: pickString(entry, 'name') || id,
      description: pickString(entry, 'description') || '',
      geolocation: {
        latitude,
        longitude,
        accuracy: pickNumber(entry, 'accuracy') ?? DEFAULT_PRESET_ACCURACY,
        country: pickString(entry, 'country') || ''
      },
      language: {
        language: locale,
        languages: languages
          ? languages.split(',').map((item) => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
          : [locale],
        acceptLanguage: pickString(entry, 'acceptLanguage') || locale
      },
      timezone: { timezone }
    };
  });

  const seen = new Set();
  for (const preset of presets) {
    if (seen.has(preset.id)) throw new Error(`preset id 重复：${preset.id}`);
    seen.add(preset.id);
  }
  return presets;
}

export function readPresets(root) {
  return parsePresets(readFileSync(join(root, ...SOURCE_PATH), 'utf8'));
}