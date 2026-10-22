declare module 'virtual:vanishgeo-runtime' {
  export const applyVanishGeoRuntime: (payload: import('./injected/runtime-modules/types').RuntimePayload) => import('./injected/runtime-modules/types').RuntimeController;
}

declare module 'virtual:vanishgeo-worker' {
  export const workerBootstrap: (patchConfig: import('./injected/runtime-modules/types').WorkerPatchConfig) => void;
}

declare module 'virtual:vanishgeo-page-runtime-source' {
  export const pageRuntimeSource: string;
}

declare module 'virtual:vanishgeo-geolocation-runtime-source' {
  export const geolocationRuntimeSource: string;
}
declare module 'virtual:vanishgeo-blob-worker' {
  export function applyBlobWorkerRuntime(payload: import('./shared/types').LanguageTimezonePayload): void;
}
