/**
 * Canvas 字体度量的补丁安装器。
 *
 * 单独抽出来是为了能被直接测：`runtime.ts` 是 MAIN world 的自执行闭包，没法在
 * Node 里 import；补丁本身只是"把哪个原型上的 measureText 换掉"，跟状态无关。
 *
 * 覆盖范围必须同时包含两种 2D 上下文 —— 这是这一版修掉的真实漏洞：
 *   - `CanvasRenderingContext2D`（`<canvas>`）
 *   - `OffscreenCanvasRenderingContext2D`（`new OffscreenCanvas()`）
 * 只补前者时，检测脚本一行 `new OffscreenCanvas(1, 1).getContext('2d')` 就能量到
 * 真实字体宽度，绕开全部字体伪装。Worker 里的同名原型由 worker-patch 负责。
 */

export interface CanvasPatchDeps {
  /** 命中被伪装字体时返回替换后的 font 串，否则 null */
  fallbackFont: (font: string) => string | null;
  /** 伪装成原生函数（toString → [native code]） */
  disguise: (fn: (...args: any[]) => any, name: string, length: number) => any;
  /** 定义不可枚举方法 */
  define: (target: any, key: string, value: any) => void;
}

/** 给一个 2D 上下文原型打上 measureText 补丁；原型不存在或没有原生实现时返回 false */
export function patchMeasureText(proto: any, deps: CanvasPatchDeps): boolean {
  const nativeMeasureText = proto && proto.measureText;
  if (typeof nativeMeasureText !== 'function') return false;

  deps.define(proto, 'measureText', deps.disguise(function (this: any, text: string) {
    const replacement = deps.fallbackFont(this.font);
    if (!replacement) return nativeMeasureText.call(this, text);
    const original = this.font;
    this.font = replacement;
    try {
      return nativeMeasureText.call(this, text);
    } finally {
      // 必须还原：页面读 `ctx.font` 时看到的仍然是它自己写进去的串，
      // 否则 font 回读本身就成了"被改写"的证据。
      this.font = original;
    }
  }, 'measureText', 1));

  return true;
}

/**
 * 把补丁铺到 scope 上所有已知的 2D 上下文原型。
 * 返回实际打了补丁的原型名，方便调用方（和测试）核对覆盖面。
 */
export function installCanvasFontPatches(scope: any, deps: CanvasPatchDeps): string[] {
  const patched: string[] = [];
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    const proto = scope && scope[name] && scope[name].prototype;
    if (proto && patchMeasureText(proto, deps)) patched.push(name);
  }
  return patched;
}