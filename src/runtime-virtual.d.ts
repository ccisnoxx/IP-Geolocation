declare module 'virtual:vanishgeo-runtime' {
  export const applyVanishGeoRuntime: (payload: import('./injected/runtime-modules/types').RuntimePayload, documentStateKey: string) => void;
}

declare module 'virtual:vanishgeo-worker' {
  export const workerBootstrap: (patchConfig: import('./injected/runtime-modules/types').WorkerPatchConfig) => void;
}
