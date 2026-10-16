// 该自包含函数由后台定向执行到 MAIN world，不通过页面消息接收配置。
export type RuntimePayload = {
  intlMode?: 'strict' | 'compatible';
  extensionEnabled?: boolean;
  enabled?: boolean;
  debugMode?: boolean;
  languageConfig?: {
    enabled: boolean;
    language: string;
    languages: string[];
    acceptLanguage: string;
  } | null;
  timezone?: string | null;
  timezoneConfig?: {
    enabled: boolean;
    mode: 'auto' | 'manual';
    timezone: string;
  };
  geolocation?: {
    enabled?: boolean;
    latitude: number;
    longitude: number;
    accuracy?: number;
    country?: string;
    randomize?: boolean;
    randomRadiusMeters?: number;
    spoofPermission?: boolean;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  canvasConfig?: {
    enabled: boolean;
    spoofFonts: boolean;
    targetFonts: string[];
  };
};

export type RuntimeOriginals = {
  objectDefineProperty: typeof Object.defineProperty;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  objectGetPrototypeOf: typeof Object.getPrototypeOf;
  objectSetPrototypeOf: typeof Object.setPrototypeOf;
  reflectApply: typeof Reflect.apply;
};

export type RuntimeState = {
  runtimeReady: boolean;
  debugMode: boolean;
  originals: RuntimeOriginals;
  installedSurfaces: Set<string>;
  spoofOriginals: Record<string, any>;
  workerPatchSource: string;
  sharedWorkerUrls: Map<string, string>;
  values: {
    language: string | null;
    languages: string[] | null;
    timezone: string | null;
    geolocation: RuntimePayload['geolocation'];
    geolocationCoordinate: { key: string; latitude: number; longitude: number } | null;
    canvasTargetFontKeys: Set<string>;
  };
};


export type RuntimeGlobals = typeof globalThis & Record<string, any>;
export type WorkerPatchConfig = { timezone: string | null; language: string | null; languages: string[] | null; intlMode?: 'strict' | 'compatible' };

// 仅供持有本次安装结果的可信调用方更新未来 Worker；不得发布到页面全局。
export type RuntimeController = { update(payload: RuntimePayload): void };
