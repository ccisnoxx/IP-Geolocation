// 仅用于 VG-011 编译/序列化验证，不是生产 registry 的替代实现。
export type SpikePayload = { language: string };

export function installLanguage(payload: SpikePayload): void {
  const target = navigator;
  const owner = Object.getPrototypeOf(target);
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'language');
  if (!descriptor?.get || !descriptor.configurable) throw new Error('spike 缺少可配置的语言 getter');
  const getter = new Proxy(descriptor.get, {
    apply(nativeGetter, receiver, args) {
      return receiver === target ? payload.language : Reflect.apply(nativeGetter, receiver, args);
    }
  });
  Object.defineProperty(owner, 'language', { ...descriptor, get: getter });
}
