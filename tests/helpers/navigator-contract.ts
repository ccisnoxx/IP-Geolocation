// 自包含测试探针，同时在 VM 和真实 Chrome 的页面/Worker 中执行；不供生产引用。
export function captureNavigatorContract() {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const nav = root.navigator;
  const proto = Object.getPrototypeOf(nav);
  const descriptor = Object.getOwnPropertyDescriptor;
  const keys = Reflect.ownKeys;
  const symbols = Object.getOwnPropertySymbols;
  const sources = Function.prototype.toString;
  const initialKeys = keys(root);
  const initialSymbols = symbols(root);
  const properties = ['language', 'languages'];
  const initial = properties.map(key => descriptor(proto, key)!);
  const getterProperties = initial.map(d => keys(d.get!).map(key => ({ key, descriptor: descriptor(d.get!, key)! })));
  const getterPrototypes = initial.map(d => Object.getPrototypeOf(d.get!));
  const reflection = [Object, Reflect, Function.prototype].flatMap(owner =>
    keys(owner).map(key => ({ owner, key, descriptor: descriptor(owner, key)! })));
  const sameDescriptor = (a: PropertyDescriptor | undefined, b: PropertyDescriptor | undefined) =>
    a === undefined || b === undefined ? a === b :
      ['configurable', 'enumerable', 'writable', 'value', 'get', 'set'].every(key =>
        (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
  const outcome = (getter: Function, receiver: unknown) => {
    try { return JSON.stringify({ value: getter.call(receiver) }); }
    catch (error) { return JSON.stringify({ error: (error as Error).name, message: (error as Error).message }); }
  };
  return {
    inspect(extraReceivers: unknown[] = [], foreignKeys = keys) {
      const receivers = [{}, null, undefined, Object.create(proto), new Proxy(nav, {}), ...extraReceivers];
      return {
        prototypeCorrect: proto === (root.WorkerNavigator || root.Navigator).prototype,
        noOwnProperties: properties.every(key => descriptor(nav, key) === undefined),
        flagsPreserved: properties.every((key, i) => {
          const d = descriptor(proto, key)!;
          return d.configurable === initial[i].configurable && d.enumerable === initial[i].enumerable && d.set === initial[i].set;
        }),
        getterShapePreserved: properties.every((key, i) => {
          const getter = descriptor(proto, key)!.get!;
          return getter.name === initial[i].get!.name && getter.length === initial[i].get!.length;
        }),
        getterPropertiesPreserved: properties.every((key, i) => {
          const getter = descriptor(proto, key)!.get!;
          return Object.getPrototypeOf(getter) === getterPrototypes[i]
            && keys(getter).length === getterProperties[i].length
            && getterProperties[i].every(row => sameDescriptor(descriptor(getter, row.key), row.descriptor));
        }),
        receiversPreserved: properties.every((key, i) => receivers.every(receiver =>
          outcome(descriptor(proto, key)!.get!, receiver) === outcome(initial[i].get!, receiver))),
        reflectionUnchanged: reflection.every(row => sameDescriptor(descriptor(row.owner, row.key), row.descriptor)),
        sourceUnchanged: Function.prototype.toString === sources,
        noNewGlobalKeys: [keys(root), keys(new Proxy(root, {})), foreignKeys(root)].every(actual =>
          actual.length === initialKeys.length && actual.every(key => initialKeys.includes(key))),
        noNewGlobalSymbols: symbols(root).length === initialSymbols.length,
        reflectionNotConstructible: (() => {
          try { Reflect.construct(Object.getOwnPropertyDescriptor, [{}, 'x']); return false; }
          catch (error) { return (error as Error).name === 'TypeError'; }
        })(),
        language: nav.language,
        languages: Array.from(nav.languages),
        languagesFrozen: Object.isFrozen(nav.languages)
      };
    },
    mutate() {
      // 替换、ToPropertyKey、删除及不可配置属性都必须由实际对象决定反射结果。
      Object.defineProperty(proto, 'language', { get() { return 'it-IT'; }, enumerable: !initial[0].enumerable });
      const current = descriptor(proto, 'language');
      const changed = nav.language === 'it-IT' && [
        Object.getOwnPropertyDescriptor(proto, 'language'), Reflect.getOwnPropertyDescriptor(proto, 'language'),
        Object.getOwnPropertyDescriptors(proto).language,
        Object.getOwnPropertyDescriptor(proto, { toString() { return 'language'; } } as unknown as string)
      ].every(value => sameDescriptor(value, current));
      const deleted = delete proto.language;
      const absent = deleted && Object.getOwnPropertyDescriptor(proto, 'language') === undefined
        && Reflect.getOwnPropertyDescriptor(proto, 'language') === undefined
        && !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptors(proto), 'language');
      Object.defineProperty(proto, 'languages', { configurable: false, enumerable: false });
      Object.freeze(proto);
      const frozen = descriptor(proto, 'languages');
      const frozenCurrent = [Object.getOwnPropertyDescriptor(proto, 'languages'),
        Reflect.getOwnPropertyDescriptor(proto, 'languages'), Object.getOwnPropertyDescriptors(proto).languages]
        .every(value => sameDescriptor(value, frozen));
      return { changed, absent, frozenCurrent };
    }
  };
}
