import type { FontRuntimePayload } from '../../shared/types';
export type RuntimeGeolocation = {
  enabled?: boolean;
  latitude: number;
  longitude: number;
  accuracy?: number;
  country?: string;
  randomize?: boolean;
  randomRadiusMeters?: number;
  spoofPermission?: boolean;
};
// 完整隔离 runtime 的输入；生产 userScripts 消费各自最小 payload。
export type RuntimePayload = {
  intlMode?: 'strict' | 'compatible';
  extensionEnabled?: boolean;
  enabled?: boolean;
  debugMode?: boolean;
  languageConfig?: {
    enabled: boolean;
    language: string;
    languages: string[];
  } | null;
  timezone?: string | null;
  timezoneConfig?: {
    enabled: boolean;
    mode: 'auto' | 'manual';
    timezone: string;
  };
  geolocation?: RuntimeGeolocation | { unavailable: true; enabled?: boolean } | null;
  latitude?: number | null;
  longitude?: number | null;
  fontExposureConfig?: FontRuntimePayload;
};

export type RuntimeOriginals = {
  objectDefineProperty: typeof Object.defineProperty;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  objectGetPrototypeOf: typeof Object.getPrototypeOf;
  objectSetPrototypeOf: typeof Object.setPrototypeOf;
  reflectApply: typeof Reflect.apply;
};

export type RuntimeState = {
  active: boolean;
  documentExiting?: boolean;
  workerSourceURL?: string;
  restores: Array<{ owner: object; property: PropertyKey; original: PropertyDescriptor | undefined; installed: PropertyDescriptor }>;
  guardedFunctions: WeakMap<Function, { native: Function; wrapped: Function }>;
  cleanup: Array<() => void>;
  blobWorkerRegistry?: { owned: Map<string, Blob>; pending: WeakMap<Worker, () => void>; createURL?: typeof URL.createObjectURL; revokeURL?: typeof URL.revokeObjectURL };
  runtimeReady: boolean;
  debugMode: boolean;
  originals: RuntimeOriginals;
  installedSurfaces: Set<string>;
  spoofOriginals: Record<string, any>;
  workerPatchSource: string;
  sharedWorkerUrls: Map<string, string>;
  geolocationObjects?: {
    coordinates: WeakMap<object, Record<string, number | null>>;
    positions: WeakMap<object, { coords: GeolocationCoordinates; timestamp: number }>;
  };
  values: {
    language: string | null;
    languages: readonly string[] | null;
    timezone: string | null;
    geolocationCoordinate: { key: string; latitude: number; longitude: number } | null;
    blockedFontFamilyKeys: Set<string>;
  };
};


export type RuntimeGlobals = typeof globalThis & Record<string, any>;
export type WorkerPatchConfig = {
  timezone: string | null;
  language: string | null;
  languages: string[] | null;
  intlMode?: 'strict' | 'compatible';
  /** 被屏蔽字体名单；只在字体伪装开启时带值，Worker 侧据此改写 OffscreenCanvas 测量。 */
  blockedFonts?: string[] | null;
};

// 仅供持有本次安装结果的可信调用方更新未来 Worker；不得发布到页面全局。
export type RuntimeController = { update(payload: RuntimePayload): void };
