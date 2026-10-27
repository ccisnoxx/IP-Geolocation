/**
 * 替换一个已经存在的原生成员，并**保留它原来的属性形状**。
 *
 * 为什么不能一律 `enumerable: false`：
 *
 *   Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'measureText')
 *     → 原生 { enumerable: true }
 *
 * WebIDL 的 operation 定义在接口原型上是可枚举的，而 ES class 的方法不是。补丁如果把
 * `measureText` 定义成不可枚举，页面一行描述符比对就能把「被换过」和「原生」分开 ——
 * 这比函数内容本身好查得多。
 *
 * `window.Worker` 这类全局属性同理：原生是可枚举的，替换时也必须保持。
 */
export function defineNativeLike(target: any, key: string, value: any): void {
  let enumerable = false;
  try {
    const existing = target ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    if (existing && typeof existing.enumerable === 'boolean') enumerable = existing.enumerable;
  } catch { /* ignore */ }

  try {
    Object.defineProperty(target, key, { value, writable: true, enumerable, configurable: true });
  } catch {
    try {
      target[key] = value;
    } catch { /* ignore */ }
  }
}