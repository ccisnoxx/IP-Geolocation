/**
 * `window.queryLocalFonts()` 的过滤补丁。
 *
 * 为什么必须有这一层：canvas 那套只伪装"量出来的宽度"，而本地字体清单是
 * **直接枚举**——一次调用拿到本机全部字体（本机实测 667 条 / 248 个族，
 * 其中 24 条 PingFang、8 条宋体/雅黑）。检测方拿它跟我们伪装过的 canvas 一对，
 * 三层的字表全部白做，而且它比 canvas 量测更"硬"：不存在阈值、不存在误差。
 *
 * 注意 API 挂在 **window** 上，不在 `navigator` 上（`navigator.queryLocalFonts`
 * 是 undefined）。早期版本因为这个测错了对象，才得出"当前构建里 absent"的结论。
 *
 * 为什么不干脆删掉这个函数：真 Chromium 有这个 API，删掉本身就是"被改过"的证据，
 * 而且 `'queryLocalFonts' in window` 一行就够验出来。保留 API、只少几个族，
 * 才是真机在"这台机器没装这些字体"时该有的样子。
 *
 * 返回值形态也不能变：必须仍是 `Promise<FontData[]>`，参数校验（非法 options 抛
 * TypeError）也不接管 —— 交给原生实现先跑，我们只在结果上做减法。
 */

// 按 scope 记下安装前的描述符（API 挂在 window 上，测试里会有多个假 scope）。
const originals = new WeakMap<any, PropertyDescriptor>();

export interface LocalFontsFilterDeps {
  /** 命中被伪装字体时返回 true；入参是 FontData 上的三个名字 */
  isHidden: (names: { family?: string; fullName?: string; postscriptName?: string }) => boolean;
  /** 伪装成原生函数（toString → [native code]） */
  disguise: (fn: (...args: any[]) => any, name: string, length: number) => any;
}

/**
 * 给 scope 上的 queryLocalFonts 装上过滤器；API 不存在时返回 false。
 *
 * 不能吞掉这些细节：
 *   - 属性描述符要原样复制。原生的 `enumerable` 是 **true**（`Object.keys(window)`
 *     里能看见它），装补丁时若默认写成 false，页面一行 Object.keys 就验出来了
 *   - `name` / `length` 对齐原生（queryLocalFonts / 0），toString 走 disguise 的查表
 *   - 原生 reject（用户拒权、非安全上下文）要原样透传，不能变成 resolve 空数组
 */
export function installLocalFontsFilter(scope: any, deps: LocalFontsFilterDeps): boolean {
  if (!scope) return false;
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'queryLocalFonts');
  const native = descriptor && descriptor.value;
  if (!descriptor || typeof native !== 'function') return false;

  const patched = deps.disguise(function queryLocalFonts(this: any, options?: any) {
    const result = native.call(scope, options);
    if (!result || typeof result.then !== 'function') return result;
    // FontData 上的三个名字都参与判定：family 是族名，fullName 带字重，
    // postscriptName 是 PostScript 名（"PingFangSC-Regular"），三者任一命中就要藏。
    return result.then((list: any) => (Array.isArray(list)
      ? list.filter((font: any) => !deps.isHidden({
        family: font && font.family,
        fullName: font && font.fullName,
        postscriptName: font && font.postscriptName
      }))
      : list));
  }, 'queryLocalFonts', 0);

  try {
    Object.defineProperty(scope, 'queryLocalFonts', {
      value: patched,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable
    });
    originals.set(scope, descriptor);
    return true;
  } catch {
    return false;
  }
}
/**
 * 还原 queryLocalFonts。关闭字体层或站点被排除时调用；没装过的是 no-op。
 * 之后 `window.queryLocalFonts()` 会重新枚举本机全部字体。
 */
export function uninstallLocalFontsFilter(scope: any): void {
  const descriptor = scope ? originals.get(scope) : undefined;
  if (!scope || !descriptor) return;
  try {
    Object.defineProperty(scope, 'queryLocalFonts', descriptor);
  } catch { /* ignore */ }
  originals.delete(scope);
}
