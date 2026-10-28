import type { WorkerPatchConfig } from '../types';
import { fontFamilyKey, getFallbackFont } from '../font-policy';

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

  const contextPrototype = root.OffscreenCanvasRenderingContext2D?.prototype;
  if (contextPrototype) {
    const originalMeasureText = contextPrototype.measureText;
    if (typeof originalMeasureText === 'function') {
      const measureText = function measureText(this: any, text: string) {
        const applied = applyFallbackFont(this, blockedFamily);
        try {
          return originalMeasureText.call(this, text);
        } finally {
          if (applied) restoreFont(this, applied);
        }
      };
      definePatchedMethod(root, contextPrototype, 'measureText', measureText);
    }
  }

  const fontFaceSetPrototype = root.FontFaceSet?.prototype;
  const originalCheck = fontFaceSetPrototype?.check;
  if (typeof originalCheck === 'function') {
    const check = function check(this: any, font: unknown, text?: unknown) {
      const result = originalCheck.call(this, font as string, text as string);
      if (typeof font !== 'string') return result;
      return blockedFamily(font) ? false : result;
    };
    definePatchedMethod(root, fontFaceSetPrototype, 'check', check);
  }
}

// 读取 font 描述符（访问器在原型链上），命中屏蔽字体时临时改成后备字体，并返回原值供还原。
function applyFallbackFont(target: any, replacement: (font: string) => string | null): string | null {
  if (!target) return null;
  const descriptor = findFontDescriptor(target);
  if (!descriptor?.get || !descriptor.set) return null;
  let current: string;
  try {
    current = descriptor.get.call(target);
  } catch {
    return null;
  }
  if (typeof current !== 'string') return null;
  const next = replacement(current);
  if (!next || next === current) return null;
  descriptor.set.call(target, next);
  return current;
}

function restoreFont(target: any, original: string): void {
  const descriptor = findFontDescriptor(target);
  if (descriptor?.set) {
    try { descriptor.set.call(target, original); } catch { /* 还原失败不影响测量结果 */ }
  }
}

function findFontDescriptor(target: any): PropertyDescriptor | undefined {
  let current = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'font');
    if (descriptor?.get) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
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
