/** 观察原生 ToPrimitive 的单次结果，getter receiver 和方法 this 都保持原对象。 */
export function createConversionObserver(
  root: typeof globalThis & Record<string, any>,
  apply: (target: Function, receiver: unknown, args: unknown[]) => any
) {
  const ProxyCtor = root.Proxy || Proxy;
  const reflectGet = (root.Reflect || Reflect).get;
  return (value: object, observe: (primitive: unknown) => void) => new ProxyCtor({}, {
    get(_target, key) {
      const member = reflectGet(value, key, value);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        const primitive = apply(member, value, args);
        if (primitive === null || typeof primitive !== 'object' && typeof primitive !== 'function') observe(primitive);
        return primitive;
      };
    }
  });
}
