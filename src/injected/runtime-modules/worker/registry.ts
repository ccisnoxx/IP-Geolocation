import type { RuntimeGlobals } from '../types';

export function createWorkerState(root: RuntimeGlobals) {
  return {
    root,
    originalGetOwnPropertyDescriptor: root.Object.getOwnPropertyDescriptor,
    originalSetPrototypeOf: root.Object.setPrototypeOf
  };
}

export type WorkerState = ReturnType<typeof createWorkerState>;
