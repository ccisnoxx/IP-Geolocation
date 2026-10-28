import type { RuntimePayload, RuntimeState } from '../types';
import { createNativeProxyFunction, replaceMethod } from '../registry';
import { fontFamilyKey, splitFontFamilies, getFallbackFont } from '../font-policy';
import { createConversionObserver } from './font-conversion';

export { FONT_SIZE_PATTERN, fontFamilyKey, splitFontFamilies, getFallbackFont } from '../font-policy';

export function installFontExposureFilter(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  fontExposure: RuntimePayload['fontExposureConfig']
): void {
  if (!fontExposure?.enabled || !Array.isArray(fontExposure.blockedFamilies)) return;
  realmState.values.blockedFontFamilyKeys = new Set(fontExposure.blockedFamilies.map(fontFamilyKey));
  if (!realmState.values.blockedFontFamilyKeys.size || realmState.installedSurfaces.has('fontExposure')) return;
  realmState.installedSurfaces.add('fontExposure');

  const apply = (target: Function, receiver: unknown, args: unknown[]) => (
    realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, receiver, args)
  );
  const observeConversion = createConversionObserver(globals, apply);
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
        const fallbackFont = getFallbackFont(originalFont, realmState.values.blockedFontFamilyKeys);
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
