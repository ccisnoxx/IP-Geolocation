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

export type SurfaceName =
  | 'navigator'
  | 'intl-date'
  | 'geolocation-permissions'
  | 'canvas'
  | 'worker'
  | 'internal';

export type ReflectionOriginals = {
  objectDefineProperty: typeof Object.defineProperty;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  objectGetOwnPropertyDescriptors: typeof Object.getOwnPropertyDescriptors;
  objectGetOwnPropertyNames: typeof Object.getOwnPropertyNames;
  objectGetOwnPropertySymbols: typeof Object.getOwnPropertySymbols;
  objectGetPrototypeOf: typeof Object.getPrototypeOf;
  objectSetPrototypeOf: typeof Object.setPrototypeOf;
  functionToString: typeof Function.prototype.toString;
  reflectApply: typeof Reflect.apply;
  reflectGetOwnPropertyDescriptor: typeof Reflect.getOwnPropertyDescriptor;
  reflectOwnKeys: typeof Reflect.ownKeys;
};

export type DescriptorEntry = {
  descriptor: PropertyDescriptor;
  surface: SurfaceName;
};

export type AntiDetectionState = {
  anchor: symbol;
  runtimeReady: boolean;
  reflectionInstalled: boolean;
  debugMode: boolean;
  originals: ReflectionOriginals;
  descriptors: WeakMap<object, Map<PropertyKey, DescriptorEntry>>;
  functionSources: WeakMap<Function, string>;
  hiddenProperties: WeakMap<object, Set<PropertyKey>>;
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
export type WorkerPatchConfig = { stateKey: string; timezone: string | null; language: string | null; languages: string[] | null; intlMode?: 'strict' | 'compatible' };
