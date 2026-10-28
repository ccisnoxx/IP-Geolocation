import type { RuntimePayload, RuntimeState } from '../types';
import { createNativeProxyFunction, replaceMethod } from '../registry';
import { fontFamilyKey, getFallbackFont } from '../font-policy';
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
  for (const contextPrototype of new Set([globals.CanvasRenderingContext2D?.prototype, globals.OffscreenCanvasRenderingContext2D?.prototype])) {
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

  }

  // Local Font Access 仍由浏览器完成授权、参数校验和字体枚举；仅过滤返回对象。
  const nativeQueryLocalFonts = globals.queryLocalFonts;
  if (typeof nativeQueryLocalFonts === 'function') {
    replaceMethod(globals, realmState, globals, 'queryLocalFonts', createNativeProxyFunction(globals, nativeQueryLocalFonts,
      (target, thisArg, args) => apply(target, thisArg, args).then((fonts: Array<{ family: string; fullName: string; postscriptName: string }>) =>
        fonts.filter(font => ![font.family, font.fullName, font.postscriptName].some(name =>
          realmState.values.blockedFontFamilyKeys.has(fontFamilyKey(name)))))));
  }
  // FontFaceSet.check 保持原生；它检查加载状态，不能作为已安装系统字体的存在判据。
}
