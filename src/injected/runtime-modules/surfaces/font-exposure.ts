import type { RuntimePayload, RuntimeState } from '../types';
import { createNativeProxyFunction, replaceMethod } from '../registry';

export const FONT_SIZE_PATTERN =
  /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

export function fontFamilyKey(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, '')
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f])/gi, (_match, hex: string, escaped: string) => {
      if (!hex) return escaped;
      const code = parseInt(hex, 16);
      return String.fromCodePoint(code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
    }).replace(/\\(?:\r\n|[\n\r\f])/g, '').replace(/\s+/g, '').toLowerCase();
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
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) families.push(current.trim());
  return families;
}

function filterMeasurementFont(font: string, keepFamily: (family: string) => boolean, fallback: string): string | null {
  const sizeMatch = font.match(FONT_SIZE_PATTERN);
  if (!sizeMatch || sizeMatch.index === undefined) return null;
  const familyStart = sizeMatch.index + sizeMatch[0].length;
  const prefix = font.slice(0, familyStart).trim();
  const families = splitFontFamilies(font.slice(familyStart).trim());
  if (!families.length) return null;
  const fallbackFamilies = families.filter(keepFamily);
  if (fallbackFamilies.length === families.length) return null;
  return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : fallback}`;
}

export function getFallbackFont(font: string, blockedFontFamilyKeys: Set<string>): string | null {
  return filterMeasurementFont(font, family => !blockedFontFamilyKeys.has(fontFamilyKey(family)), 'monospace');
}

export function getAllowedMeasurementFont(font: string, allowedFamilies: ReadonlySet<string>): string | null {
  // 引号包围的同名字体仍是具名字体，不能当作通用字体关键字保留。
  return filterMeasurementFont(font, family => allowedFamilies.has(family.toLowerCase()), 'sans-serif');
}

export function installFontExposureFilter(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  fontExposure: RuntimePayload['fontExposureConfig'],
  measurementAllowedFamilies?: readonly string[]
): void {
  if (!fontExposure?.enabled || !Array.isArray(fontExposure.blockedFamilies)) return;
  realmState.values.blockedFontFamilyKeys = new Set(fontExposure.blockedFamilies.map(fontFamilyKey));
  if (!realmState.values.blockedFontFamilyKeys.size || realmState.installedSurfaces.has('fontExposure')) return;
  realmState.installedSurfaces.add('fontExposure');
  const allowedMeasurementKeys = measurementAllowedFamilies && new Set(measurementAllowedFamilies);

  const apply = (target: Function, receiver: unknown, args: unknown[]) => (
    realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, receiver, args)
  );
  const ProxyCtor = globals.Proxy || Proxy;
  const reflectGet = (globals.Reflect || Reflect).get;
  // 让原方法执行ToPrimitive/DOMString，观察其primitive结果；getter与方法的this仍是原对象。
  const observeConversion = (value: object, observe: (primitive: unknown) => void) => new ProxyCtor({}, {
    get(_target, key) {
      const member = reflectGet(value, key, value);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        const primitive = apply(member, value, args);
        if (primitive === null || typeof primitive !== 'object' && typeof primitive !== 'function') observe(primitive);
        return primitive;
      };
    }
  });
  const contextPrototype = globals.CanvasRenderingContext2D?.prototype;
  const fontDescriptor = contextPrototype && realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, contextPrototype, 'font');
  if (contextPrototype && fontDescriptor?.get && fontDescriptor.set) {
    const originalMeasureText = contextPrototype.measureText;
    const measureText = createNativeProxyFunction(globals, originalMeasureText, (target, thisArg, args) => {
      let originalFont: string;
      try {
        originalFont = apply(fontDescriptor.get!, thisArg, []);
      } catch {
        // 非法 receiver 由原方法抛出自身错误，不读取页面伪造的 font 属性。
        return apply(target, thisArg, args);
      }
      if (!args.length) return apply(target, thisArg, args);
      let restoreFont: string | null = null;
      const useFallback = () => {
        // 转换回调可能更改字体；只在用户代码返回primitive之后选择本次测量字体。
        originalFont = apply(fontDescriptor.get!, thisArg, []);
        const fallbackFont = allowedMeasurementKeys
          ? getAllowedMeasurementFont(originalFont, allowedMeasurementKeys)
          : getFallbackFont(originalFont, realmState.values.blockedFontFamilyKeys);
        if (fallbackFont) {
          apply(fontDescriptor.set!, thisArg, [fallbackFont]);
          restoreFont = originalFont;
        }
      };
      const suppliedText = args[0];
      let forwardedArgs = args;
      if (suppliedText !== null && (typeof suppliedText === 'object' || typeof suppliedText === 'function')) {
        // 由原方法继续执行DOMString转换（含原生Symbol错误），不预先String()或重复用户转换。
        const conversion = observeConversion(suppliedText, useFallback);
        forwardedArgs = [conversion, ...args.slice(1)];
      } else useFallback();
      try {
        return apply(target, thisArg, forwardedArgs);
      } finally {
        if (restoreFont !== null) apply(fontDescriptor.set!, thisArg, [restoreFont]);
      }
    });
    replaceMethod(globals, realmState, contextPrototype, 'measureText', measureText);
  }

  if (globals.document?.fonts && globals.document.fonts.check) {
    const originalCheck = globals.document.fonts.check;
    // 使用浏览器的shorthand解析，不复制calc/行高/样式的CSS语法；元素不连接DOM。
    const fontStyle = globals.document.createElement('span').style;
    const setFontProperty = fontStyle.setProperty;
    const getFontProperty = fontStyle.getPropertyValue;
    const includesBlockedFamily = (font: string): boolean => {
      apply(setFontProperty, fontStyle, ['font', '']);
      apply(setFontProperty, fontStyle, ['font', font]);
      const families = apply(getFontProperty, fontStyle, ['font-family']) as string;
      return splitFontFamilies(families).some(family => realmState.values.blockedFontFamilyKeys.has(fontFamilyKey(family)));
    };
    const fontFaceSetPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, globals.document.fonts);
    const checkOwner = fontFaceSetPrototype || globals.document.fonts;
    const check = createNativeProxyFunction(globals, originalCheck, (target, thisArg, args) => {
      let font = args[0];
      let forwardedArgs = args;
      if (font !== null && (typeof font === 'object' || typeof font === 'function')) {
        const suppliedFont = font;
        // 原生方法仍拥有转换及异常；只观察同一次结果，不重复转换用户对象。
        forwardedArgs = [observeConversion(suppliedFont, primitive => { font = primitive; }), ...args.slice(1)];
      }
      const result = apply(target, thisArg, forwardedArgs);
      return typeof font === 'string' && includesBlockedFamily(font) ? false : result;
    });
    replaceMethod(globals, realmState, checkOwner, 'check', check);
  }
}
