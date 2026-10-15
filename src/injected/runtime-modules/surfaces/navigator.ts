import type { AntiDetectionState } from '../types';
import { createNativeProxyFunction, defineRegisteredProperty } from '../registry';

export function installNativeBackedNavigatorGetter(
  globals: typeof globalThis & Record<string, any>,
  realmState: AntiDetectionState,
  property: string,
  getSpoofedValue: () => unknown
): void {
  const navigatorTarget = globals.navigator as Navigator & Record<string, unknown>;
  if (!navigatorTarget) return;
  const navigatorPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, navigatorTarget);
  const originalDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, navigatorPrototype, property);

  if (!originalDescriptor || typeof originalDescriptor.get !== 'function' || originalDescriptor.configurable === false) {
    return;
  }

  const nativeGetter = originalDescriptor.get;
  const spoofedGetter = createNativeProxyFunction(globals, realmState, nativeGetter, (target, thisArg, args) => {
    if (thisArg === navigatorTarget) {
      return getSpoofedValue();
    }
    return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
  });

  defineRegisteredProperty(globals, realmState, navigatorPrototype, property, {
    ...originalDescriptor,
    get: spoofedGetter
  }, 'navigator', originalDescriptor);
}

export function installLanguageSpoof(
  globals: typeof globalThis & Record<string, any>,
  realmState: AntiDetectionState,
  language: string | null,
  languages: string[] | null
): void {
  realmState.values.language = language;
  realmState.values.languages = languages && languages.length ? languages.slice() : language ? [language] : null;
  if (!language) return;

  if (!realmState.installedSurfaces.has('navigator-language')) {
    realmState.installedSurfaces.add('navigator-language');
    installNativeBackedNavigatorGetter(globals, realmState, 'language', () => realmState.values.language);
    installNativeBackedNavigatorGetter(globals, realmState, 'languages', () => Object.freeze((realmState.values.languages || []).slice()));
  }
}
