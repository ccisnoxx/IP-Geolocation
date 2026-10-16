import type { WorkerPatchConfig } from '../types';
import type { WorkerState } from './registry';

export function installWorkerNavigator(state: WorkerState, patchConfig: WorkerPatchConfig) {
  const { root } = state;
  const language = patchConfig.language;
  const languages = patchConfig.languages && patchConfig.languages.length ? patchConfig.languages.slice() : language ? [language] : null;
  const nav = root.navigator;
  if (nav && language) {
    const navProto = root.Object.getPrototypeOf(nav);
    ['language', 'languages'].forEach((property) => {
      const descriptor = root.Object.getOwnPropertyDescriptor(navProto, property);
      if (descriptor && typeof descriptor.get === 'function' && descriptor.configurable !== false) {
        const nativeGetter = descriptor.get;
        const getter = new root.Proxy(nativeGetter, {
          apply(target: Function, thisArg: unknown, args: unknown[]) {
            if (thisArg === nav) return property === 'language' ? language : root.Object.freeze((languages || []).slice());
            return root.Reflect.apply(target, thisArg, args);
          }
        });
        root.Object.defineProperty(navProto, property, { ...descriptor, get: getter as () => unknown });
      }
    });
  }


}
