import { fontFamilyKey, splitFontFamilies, trimFontWhitespace, FONT_SIZE_PATTERN } from '../font-policy';
import { createConversionObserver } from './font-conversion';

export type CanvasFontSpoofConfig = {
  /** 声称的平台：macos 时 Windows 专有字体要与 macOS 等价字体量宽，check() 返回 false。 */
  platform: 'windows' | 'macos';
  /** 大小写无关：原字体 key → 替换字体族名。 */
  replacements: Record<string, string>;
};

function splitFontShorthand(font: string): { prefix: string; families: string[] } | null {
  const sizeMatch = font.match(FONT_SIZE_PATTERN);
  if (!sizeMatch || sizeMatch.index === undefined) return null;
  const familyStart = sizeMatch.index + sizeMatch[0].length;
  const prefix = trimFontWhitespace(font.slice(0, familyStart));
  const families = splitFontFamilies(trimFontWhitespace(font.slice(familyStart)));
  return families.length ? { prefix, families } : null;
}

/** 把整串 font 里的目标字体换成对端等价字体；没有命中返回 null。 */
export function mapCanvasFont(font: string, replacements: Record<string, string>): string | null {
  const parsed = splitFontShorthand(font);
  if (!parsed) return null;
  let hit = false;
  const families = parsed.families.map((family) => {
    const replacement = replacements[fontFamilyKey(family)];
    if (!replacement) return family;
    hit = true;
    return /^[\w .-]+$/.test(replacement) ? replacement : `"${replacement}"`;
  });
  return hit ? `${parsed.prefix} ${families.join(', ')}` : null;
}

/**
 * Canvas 字体伪装：让声称平台之外的专有字体量不出系统默认宽度。
 *
 * 与 font-exposure（把名单内字体抹成 monospace）不同，这里**替换成对端平台的等价字体**，
 * 于是 Canvas 指纹与平台自洽：macOS 上没有 Segoe UI，量宽应该等于 Helvetica Neue。
 */
export function installCanvasFontSpoof(
  root: typeof globalThis & Record<string, any>,
  config: CanvasFontSpoofConfig
): void {
  const replacements = config.replacements;
  const keys = Object.keys(replacements);
  if (!keys.length) return;
  const objectCtor = root.Object || Object;
  const apply = (root.Reflect || Reflect).apply;
  const observeConversion = createConversionObserver(root, apply);

  const patchMeasure = (owner: any): void => {
    const descriptor = objectCtor.getOwnPropertyDescriptor(owner, 'measureText');
    const original = descriptor?.value;
    if (typeof original !== 'function') return;
    const fontDescriptor = (() => {
      let cursor = owner;
      while (cursor) {
        const found = objectCtor.getOwnPropertyDescriptor(cursor, 'font');
        if (found?.get) return found;
        cursor = objectCtor.getPrototypeOf(cursor);
      }
      return undefined;
    })();
    const fontGet = fontDescriptor?.get;
    const fontSet = fontDescriptor?.set;
    if (!fontGet || !fontSet) return;
    const measureText = function measureText(this: any, text: unknown) {
      const args = Array.from(arguments);
      let current: string;
      try { current = apply(fontGet, this, []); }
      catch { return apply(original, this, args); }
      if (!args.length) return apply(original, this, args);
      let restoreFont: string | null = null;
      const useMappedFont = () => {
        // 文本转换可改字体或重入；等用户代码返回 primitive 后再选本次字体。
        current = apply(fontGet, this, []);
        const mapped = mapCanvasFont(current, replacements);
        if (mapped) {
          apply(fontSet, this, [mapped]);
          restoreFont = current;
        }
      };
      let forwardedArgs = args;
      if (text !== null && (typeof text === 'object' || typeof text === 'function')) {
        forwardedArgs = [observeConversion(text, useMappedFont), ...args.slice(1)];
      } else useMappedFont();
      try {
        return apply(original, this, forwardedArgs);
      } finally {
        if (restoreFont !== null) apply(fontSet, this, [restoreFont]);
      }
    };
    objectCtor.defineProperty(owner, 'measureText', { ...descriptor, value: measureText, writable: true });
    try {
      objectCtor.defineProperty(measureText, 'toString', {
        value: (root.Function || Function).prototype.toString.bind(original), configurable: true
      });
    } catch {
      // 伪装 toString 失败不影响补丁本身。
    }
  };

  if (root.CanvasRenderingContext2D?.prototype) patchMeasure(root.CanvasRenderingContext2D.prototype);
  if (root.OffscreenCanvasRenderingContext2D?.prototype) patchMeasure(root.OffscreenCanvasRenderingContext2D.prototype);

  // check()：声称平台装不上的字体必须答 false，否则一句话就能问出来
  const fontFaceSetPrototype = root.FontFaceSet?.prototype;
  const originalCheck = fontFaceSetPrototype?.check;
  if (typeof originalCheck === 'function') {
    const check = function check(this: any, font: unknown, _text?: unknown) {
      const args = Array.from(arguments);
      let forwardedArgs = args;
      if (font !== null && (typeof font === 'object' || typeof font === 'function')) {
        forwardedArgs = [observeConversion(font, primitive => { font = primitive; }), ...args.slice(1)];
      }
      // 原生方法先完成品牌、必填参数和两个 DOMString 的校验。
      const result = apply(originalCheck, this, forwardedArgs);
      return typeof font === 'string' && mapCanvasFont(font, replacements) ? false : result;
    };
    const descriptor = objectCtor.getOwnPropertyDescriptor(fontFaceSetPrototype, 'check');
    objectCtor.defineProperty(fontFaceSetPrototype, 'check', { ...descriptor, value: check, writable: true });
  }
}
