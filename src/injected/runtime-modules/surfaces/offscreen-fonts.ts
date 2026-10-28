import type { WorkerPatchConfig } from '../types';
import { fontFamilyKey, getFallbackFont } from '../font-policy';
import { createConversionObserver } from './font-conversion';

/**
 * Worker 侧的字体补丁（OffscreenCanvas / FontFaceSet）。
 *
 * 主线程的字体伪装挂在 CanvasRenderingContext2D 与 document.fonts 上，Worker 里这两个
 * 都不存在，于是 OffscreenCanvas 的 measureText 和 FontFaceSet.check 会直接暴露真实字体。
 * 这里按同一份名单做同样的替换：命中被屏蔽字体时改用后备字体测量、check 返回 false。
 * 刻意不放进 runtime-modules/worker/：Blob Worker 的引导也用它，页面运行时 graph
 * 不允许出现 worker/ 依赖。
 */
export function installWorkerFonts(
  root: typeof globalThis & Record<string, any>,
  patchConfig: Pick<WorkerPatchConfig, 'blockedFonts'>
): void {
  const blocked = Array.isArray(patchConfig.blockedFonts) ? patchConfig.blockedFonts : [];
  if (!blocked.length || !root) return;
  const blockedKeys = new Set<string>(blocked.map((family) => fontFamilyKey(family)));
  const blockedFamily = (font: string): string | null => getFallbackFont(font, blockedKeys);
  const objectCtor = root.Object || Object;
  const apply = (root.Reflect || Reflect).apply;
  const observeConversion = createConversionObserver(root, apply);

  const contextPrototype = root.OffscreenCanvasRenderingContext2D?.prototype;
  if (contextPrototype) {
    const originalMeasureText = contextPrototype.measureText;
    let fontOwner = contextPrototype;
    let fontDescriptor: PropertyDescriptor | undefined;
    while (fontOwner) {
      fontDescriptor = objectCtor.getOwnPropertyDescriptor(fontOwner, 'font');
      if (fontDescriptor?.get) break;
      fontOwner = objectCtor.getPrototypeOf(fontOwner);
    }
    const fontGet = fontDescriptor?.get;
    const fontSet = fontDescriptor?.set;
    if (typeof originalMeasureText === 'function' && fontGet && fontSet) {
      const measureText = function measureText(this: any, text: unknown) {
        const args = Array.from(arguments);
        let current: string;
        try { current = apply(fontGet, this, []); }
        catch { return apply(originalMeasureText, this, args); }
        if (!args.length) return apply(originalMeasureText, this, args);
        let restoreFont: string | null = null;
        const useFallback = () => {
          // 与页面合同相同：转换副作用和重入完成后才临时替换字体。
          current = apply(fontGet, this, []);
          const fallback = blockedFamily(current);
          if (fallback) {
            apply(fontSet, this, [fallback]);
            restoreFont = current;
          }
        };
        let forwardedArgs = args;
        if (text !== null && (typeof text === 'object' || typeof text === 'function')) {
          forwardedArgs = [observeConversion(text, useFallback), ...args.slice(1)];
        } else useFallback();
        try {
          return apply(originalMeasureText, this, forwardedArgs);
        } finally {
          if (restoreFont !== null) apply(fontSet, this, [restoreFont]);
        }
      };
      definePatchedMethod(root, contextPrototype, 'measureText', measureText);
    }
  }

  const fontFaceSetPrototype = root.FontFaceSet?.prototype;
  const originalCheck = fontFaceSetPrototype?.check;
  if (typeof originalCheck === 'function') {
    const check = function check(this: any, font: unknown, _text?: unknown) {
      const args = Array.from(arguments);
      let forwardedArgs = args;
      if (font !== null && (typeof font === 'object' || typeof font === 'function')) {
        forwardedArgs = [observeConversion(font, primitive => { font = primitive; }), ...args.slice(1)];
      }
      const result = apply(originalCheck, this, forwardedArgs);
      return typeof font === 'string' && blockedFamily(font) ? false : result;
    };
    definePatchedMethod(root, fontFaceSetPrototype, 'check', check);
  }
}

function definePatchedMethod(root: typeof globalThis & Record<string, any>, owner: any, name: string, value: Function): void {
  const objectCtor = root.Object || Object;
  const descriptor = objectCtor.getOwnPropertyDescriptor(owner, name);
  Object.defineProperty(owner, name, {
    ...(descriptor || { configurable: true, enumerable: true }),
    value,
    writable: descriptor ? descriptor.writable : true
  });
  try {
    // 伪装成原生方法：toString 仍返回原生源码，避免一行 toString() 就露馅
    objectCtor.defineProperty(value, 'toString', {
      value: (root.Function || Function).prototype.toString.bind(descriptor?.value || value), configurable: true
    });
  } catch {
    // defineProperty 在极端受限的真机上可能失败；补丁本身仍然生效。
  }
}
