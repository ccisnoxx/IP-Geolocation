/*
 * "这一层要不要打补丁"的判定。
 *
 * 单独拆出来是因为它已经被两次不同的错误咬过，而且两次都只在真实页面里才看得出来：
 *
 *  1. 只比 `navigator.language`：`en-US` 配 `["en-US","en"]` 时首选语言一模一样、
 *     语言列表却不同，补丁被整个跳过 —— 请求头是目标值、`navigator.languages`
 *     还是原生值，两者一比就对上了号。
 *  2. 只比首选语言和列表长度：`["en-US","fr"]` 和 `["en-US","en"]` 长度相同、
 *     顺序也没变，差异在第二项。必须逐项比。
 *
 * 放在独立模块里才有测试可以盯住 —— runtime.ts 是个大 IIFE，没法在 node 里直接跑。
 */

export interface LanguageSignals {
  language?: string | null;
  languages?: readonly string[] | null;
}

/** 有序语言列表是否不同（长度、逐项都比） */
export function languagesDiffer(
  target: readonly string[] | null | undefined,
  native: readonly string[] | null | undefined
): boolean {
  const left = target || [];
  const right = native || [];
  if (!left.length) return false;
  if (left.length !== right.length) return true;
  return left.some((item, index) => item !== right[index]);
}

/**
 * 是否需要安装语言补丁。
 *
 * 只要首选语言或完整列表有一个不一样就得装 —— 二者任一留在原生值上都是可见的破绽。
 */
export function needsLanguagePatch(target: LanguageSignals, native: LanguageSignals): boolean {
  const wanted = target.language || '';
  if (!wanted) return false;
  if (wanted !== (native.language || '')) return true;
  return languagesDiffer(target.languages, native.languages);
}

/**
 * 是否需要装 toLocaleString / Intl 那一层。
 *
 * 这里比较的是**当前时区下的 locale**，不是配置里的语言：时区已经对、只有语言要改时
 * 同样要装（否则 Date.prototype.toLocaleString 还是原生 locale）。
 */
export function needsLocalePatch(target: LanguageSignals, native: { locale?: string | null }): boolean {
  const wanted = target.language || '';
  if (!wanted) return false;
  return wanted !== (native.locale || '');
}
