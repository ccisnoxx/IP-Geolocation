/**
 * Canvas 字体度量与绘制的补丁安装器。
 *
 * 单独抽出来是为了能被直接测：`runtime.ts` 是 MAIN world 的自执行闭包，没法在
 * Node 里 import；补丁本身只是"把哪个原型上的方法换掉"，跟状态无关。
 *
 * 覆盖范围必须同时包含两种 2D 上下文 —— 这是这一版修掉的真实漏洞：
 *   - `CanvasRenderingContext2D`（`<canvas>`）
 *   - `OffscreenCanvasRenderingContext2D`（`new OffscreenCanvas()`）
 * 只补前者时，检测脚本一行 `new OffscreenCanvas(1, 1).getContext('2d')` 就能量到
 * 真实字体宽度，绕开全部字体伪装。Worker 里的同名原型由 worker-patch 负责。
 *
 * 度量（measureText）和绘制（fillText / strokeText）必须一起改写，否则两者互相
 * 印证出矛盾：只改度量时 `measureText` 报的是"字体缺失"的宽度，`fillText` 却仍然
 * 用本机真实字形落像素。检测方不需要任何阈值 —— 同一句话用候选族和一个必然不存在
 * 的族各画一遍比像素，只要不同就说明候选族在。这条路径比 `document.fonts.check`
 * 更硬，也比 `queryLocalFonts`（已被 local-fonts.ts 过滤）更直接。
 */

const CONTEXT_PROTOTYPES = ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D'];

/** WebIDL 里这三个 operation 的 length 都是 4（text, x, y, maxWidth） */
const TEXT_DRAW_METHODS = ['fillText', 'strokeText'] as const;

// 安装前记下原描述符；原型是全局单例，用 WeakMap 按原型存，uninstall 时只还原
// 我们真正动过的那些（测试里会同时造多个假 scope）。
const originals = new WeakMap<any, Map<string, PropertyDescriptor | undefined>>();

function recordOriginal(proto: any, key: string): void {
  let recorded = originals.get(proto);
  if (!recorded) {
    recorded = new Map();
    originals.set(proto, recorded);
  }
  // 重复安装时保留**最早**那份原生描述符：第二层包装的"原生"已经是第一层补丁，
  // 拿它当原始值会让 uninstall 还原成补丁本身。
  if (recorded.has(key)) return;
  try {
    recorded.set(key, Object.getOwnPropertyDescriptor(proto, key));
  } catch {
    recorded.set(key, undefined);
  }
}

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
  recordOriginal(proto, 'measureText');

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
 * 给 `fillText` / `strokeText` 打上与 measureText 完全一致的改写。
 *
 * 同样的临时换字 + finally 还原：像素和度量走同一条回落路径，页面侧唯一能观察到的
 * 差别是"这个字体没装"，而不是"这个字体被改过"。
 *
 * `maxWidth` 的转发按**实参个数**判断，不是按 `undefined` 判断：原生里
 * `fillText(t, x, y)` 和 `fillText(t, x, y, undefined)` 等价（ToNumber(undefined) 是
 * NaN，同样被忽略），但保持实参个数不变可以少一处可观察差异。
 *
 * 返回真正打上的方法名，调用方（和测试）据此核对覆盖面。
 */
export function patchTextDraw(proto: any, deps: CanvasPatchDeps): string[] {
  const patched: string[] = [];
  for (const key of TEXT_DRAW_METHODS) {
    const nativeDraw = proto && proto[key];
    if (typeof nativeDraw !== 'function') continue;
    recordOriginal(proto, key);

    deps.define(proto, key, deps.disguise(function (this: any, text: any, x: any, y: any, maxWidth?: any) {
      const replacement = deps.fallbackFont(this.font);
      if (!replacement) {
        return arguments.length > 3
          ? nativeDraw.call(this, text, x, y, maxWidth)
          : nativeDraw.call(this, text, x, y);
      }
      const original = this.font;
      this.font = replacement;
      try {
        return arguments.length > 3
          ? nativeDraw.call(this, text, x, y, maxWidth)
          : nativeDraw.call(this, text, x, y);
      } finally {
        this.font = original;
      }
    }, key, 4));
    patched.push(key);
  }
  return patched;
}

/**
 * 把补丁铺到 scope 上所有已知的 2D 上下文原型。
 * 返回**度量**实际打上的原型名，方便调用方（和测试）核对覆盖面。
 */
export function installCanvasFontPatches(scope: any, deps: CanvasPatchDeps): string[] {
  const patched: string[] = [];
  for (const name of CONTEXT_PROTOTYPES) {
    const proto = scope && scope[name] && scope[name].prototype;
    if (!proto) continue;
    if (patchMeasureText(proto, deps)) patched.push(name);
    // 绘制方法独立判断：某些环境里 measureText 被别的扩展换过也不能连带跳过绘制，
    // 否则"量得出、画得真"这种组合正好是最容易被像素比对抓住的状态。
    patchTextDraw(proto, deps);
  }
  return patched;
}

/**
 * 还原 measureText / fillText / strokeText。只还原 `installCanvasFontPatches` 动过的
 * 原型；没装过的是 no-op。关闭 canvas 伪装或站点被排除时调用，之后页面量到的和画出的
 * 都是原生结果。
 */
export function uninstallCanvasFontPatches(scope: any): void {
  for (const name of CONTEXT_PROTOTYPES) {
    const proto = scope && scope[name] && scope[name].prototype;
    const recorded = proto ? originals.get(proto) : undefined;
    if (!proto || !recorded) continue;
    for (const [key, descriptor] of recorded) {
      try {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete proto[key];
      } catch { /* ignore */ }
    }
    originals.delete(proto);
  }
}