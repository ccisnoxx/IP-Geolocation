import { buildTargetFontKeys, isTargetFontFamily } from '../shared/font-aliases';
import { rewriteFontString } from './font-mask';

/**
 * 字体伪装的"当前目标集合"。
 *
 * 从 runtime.ts 里拆出来，是因为它有一个很容易写错的生命周期：补丁只安装一次，
 * 但目标集合必须跟着每一份 payload 走。旧实现把 `targetFontKeys` 的赋值塞在
 * `installCanvas()` 里，而 `installCanvas()` 在 canvas 关闭后不会再被调用 ——
 * 结果是关掉字体伪装之后，主线程仍然在按旧字表隐藏字体，Worker 却已经恢复原生，
 * 两边当场对不上。
 *
 * 现在安装与状态分开：`applySpoof` 每次都调 `setTargets()`，安装器只负责"把补丁铺上去"。
 */
export interface CanvasFontState {
  /** 传空数组 / null 表示恢复原生度量 */
  setTargets(fonts: readonly string[] | null): void;
  /** 命中被伪装字体时返回改写后的 font 串，否则 null */
  fallbackFont(font: string): string | null;
  /** 用于 queryLocalFonts 的过滤：这个名字是不是当前要隐藏的 */
  isTarget(family: string): boolean;
}

export function createCanvasFontState(): CanvasFontState {
  let keys = new Set<string>();

  return {
    setTargets(fonts: readonly string[] | null): void {
      keys = buildTargetFontKeys(fonts ? Array.from(fonts) : []);
    },
    fallbackFont(font: string): string | null {
      // 热路径：每个 measureText 都会走这里，没有目标时别做正则
      if (keys.size === 0) return null;
      return rewriteFontString(font, (family) => isTargetFontFamily(family, keys));
    },
    isTarget(family: string): boolean {
      return keys.size > 0 && isTargetFontFamily(family, keys);
    }
  };
}