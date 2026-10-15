import type { WorkerPatchConfig, RuntimeGlobals } from '../types';
import { createWorkerState } from './registry';
import { installWorkerNavigator } from './navigator';
import { installWorkerDateTime } from './intl-date';
import { installNestedWorker } from './nested-worker';

export function applyWorkerRuntime(patchConfig: WorkerPatchConfig, workerBootstrap: (config: WorkerPatchConfig) => void): void {
  const state = createWorkerState(patchConfig, self as unknown as RuntimeGlobals);
  installWorkerNavigator(state, patchConfig);
  installWorkerDateTime(state, patchConfig);
  installNestedWorker(state, patchConfig, workerBootstrap);
}
