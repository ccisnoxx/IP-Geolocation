export interface Disguise {
  /**
   * @param options.construct `true` = 保留可构造性（`Date`、`Intl.*`、`Worker` 这类构造器）；
   *   默认为方法形状：没有自有 `prototype`、`new` 会抛 TypeError，和 `Date.prototype.getHours`
   *   这类原生原型方法一致。
   */
  (impl: any, name: string, length: number, options?: { construct?: boolean }): any;
  /** 还原 Function.prototype.toString；clear 时调用，之后可以再次 disguise 重新安装 */
  uninstall(): void;
}

/**
 * 方法形状的等价实现。
 *
 * `function foo() {}` 声明自带一个自有 `prototype` 对象，而且能被 `new` 调用；原生原型
 * 方法两样都没有。于是这段代码一行就能分辨出补丁：
 *
 *     Object.getOwnPropertyNames(Date.prototype.getHours)  // 原生 [] / 补丁 ['prototype']
 *
 * 方法简写 `{ [name]() {} }[name]` 恰好两边都不成立：没有自有 prototype，`new` 抛
 * TypeError —— 和 WebIDL operation / ES 方法一致。
 */
function methodShaped(impl: any, name: string): any {
  const holder: any = {
    [name](this: any, ...args: any[]): any {
      return Reflect.apply(impl, this, args);
    }
  };
  return holder[name];
}

/**
 * 把任意实现伪装成原生函数。
 *
 * 这里踩过一次坑：旧实现返回 `new Proxy(impl, {})`。`Function.prototype.toString`
 * 对 Proxy 走的是"未知可调用对象"分支，输出 **`function () { [native code] }`** ——
 * 名字丢了。于是页面只要写一行：
 *
 *     Date.prototype.setHours.toString() === 'function setHours() { [native code] }'
 *
 * 就能确认函数被换过。Proxy 换来的那点"看不见"根本不值。
 *
 * 现在不用 Proxy：直接返回原函数（`name` / `length` 手动对齐），并在本 realm 的
 * `Function.prototype.toString` 上挂一个查表分支，输出和原生同形的签名。
 * 没登记过的函数（页面的、浏览器原生的）一律走原生实现。
 */
export function createDisguise(): Disguise {
  const signatures = new WeakMap<object, string>();
  const nativeToString = Function.prototype.toString;
  const signatureOf = (name: string) => `function ${name}() { [native code] }`;

  let installed = false;

  const install = (): void => {
    if (installed) return;
    installed = true;
    try {
      Object.defineProperty(Function.prototype, 'toString', {
        value: toStringImpl,
        writable: true,
        enumerable: false,
        configurable: true
      });
    } catch { /* ignore */ }
  };

  const toStringImpl = function toString(this: any) {
    if (typeof this === 'function') {
      const signature = signatures.get(this);
      if (signature !== undefined) return signature;
    }
    return nativeToString.call(this);
  };
  // 这个补丁自己的 toString 也要像原生（否则页面拿它一测就露）
  signatures.set(toStringImpl, signatureOf('toString'));

  install();

  const disguise = ((impl: any, name: string, length: number, options?: { construct?: boolean }) => {
    // clear 之后可能已经还原过；再次伪装时把 toString 补回来
    install();
    // 默认按"方法"重建：绝大多数被替换的是原型方法 / getter，原生那两样都不是构造器。
    // 构造器调用点显式传 { construct: true }，保持可 new、保持自有 prototype。
    const shaped = options && options.construct === true ? impl : methodShaped(impl, name);
    try {
      Object.defineProperty(shaped, 'name', { value: name, configurable: true });
    } catch { /* ignore */ }
    try {
      Object.defineProperty(shaped, 'length', { value: length, configurable: true });
    } catch { /* ignore */ }
    try {
      signatures.set(shaped, signatureOf(name));
    } catch { /* ignore */ }
    return shaped;
  }) as Disguise;

  disguise.uninstall = () => {
    if (!installed) return;
    installed = false;
    try {
      Object.defineProperty(Function.prototype, 'toString', {
        value: nativeToString,
        writable: true,
        enumerable: false,
        configurable: true
      });
    } catch { /* ignore */ }
  };

  return disguise;
}