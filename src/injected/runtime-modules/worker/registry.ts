import type { WorkerPatchConfig, RuntimeGlobals } from '../types';

export function createWorkerState(patchConfig: WorkerPatchConfig, root: RuntimeGlobals) {
  const stateKey = root.Symbol(patchConfig.stateKey);
  const originalGetOwnPropertySymbols = root.Object.getOwnPropertySymbols;
  const originalGetOwnPropertyDescriptor = root.Object.getOwnPropertyDescriptor;
  const originalOwnKeys = root.Reflect.ownKeys;
  const originalFunctionToString = root.Function.prototype.toString;
  const originalSetPrototypeOf = root.Object.setPrototypeOf;
  const functionSources = new WeakMap<Function, string>();
  if (!(root as Record<PropertyKey, any>)[stateKey]) {
    root.Object.defineProperty(root, stateKey, { value: true, enumerable: false, configurable: false });
  }
  root.Object.getOwnPropertySymbols = function getOwnPropertySymbols(obj: object) {
    return originalGetOwnPropertySymbols.call(Object, obj).filter((key) => !(obj === root && key === stateKey));
  };
  root.Reflect.ownKeys = function ownKeys(obj: object) {
    return originalOwnKeys.call(Reflect, obj).filter((key) => !(obj === root && key === stateKey));
  };
  root.Function.prototype.toString = function toString(this: Function) {
    return functionSources.get(this) || originalFunctionToString.call(this);
  };


  return { root, originalGetOwnPropertyDescriptor, originalFunctionToString, originalSetPrototypeOf, functionSources };
}

export type WorkerState = ReturnType<typeof createWorkerState>;
