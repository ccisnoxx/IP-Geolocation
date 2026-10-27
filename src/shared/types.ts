export type LanguageMode = 'preset' | 'custom';
export type TimezoneMode = 'auto' | 'manual';
export type GeolocationMode = 'auto' | 'manual';
export type OverrideMode = 'inherit' | 'override' | 'disable';
export type WebRtcMode = 'strict' | 'compatible' | 'default';

export interface LanguageConfig {
  enabled: boolean;
  mode: LanguageMode;
  language: string;
  languages: string[];
  acceptLanguage: string;
}

export interface TimezoneConfig {
  enabled: boolean;
  mode: TimezoneMode;
  timezone: string;
}

export interface GeolocationHistory {
  latitude: number;
  longitude: number;
  accuracy: number;
  label?: string;
  createdAt: number;
}

export interface GeolocationConfig {
  enabled: boolean;
  mode: GeolocationMode;
  latitude: number | null;
  longitude: number | null;
  accuracy: number;
  country: string;
  randomize: boolean;
  randomRadiusMeters: number;
  spoofPermission: boolean;
  history: GeolocationHistory[];
}

export interface WebRtcConfig {
  globalMode: WebRtcMode;
}

/** 声称的平台：决定隐藏"不属于这个平台"的字体。none = 不按平台隐藏 */
export type CanvasPlatform = 'auto' | 'mac' | 'windows' | 'linux' | 'none';

/** 声称的平台：`auto` 表示不声称、跟随真实平台 */
export type PlatformClaim = 'auto' | 'mac' | 'windows' | 'linux';

/**
 * 平台层：**一套声称，两个消费者**。
 *
 * 打开之后同时改写 navigator.userAgent / navigator.platform / navigator.userAgentData
 * 与 Sec-CH-UA-* 请求头，并让字体层按同一个平台判定 —— 否则 UA 说 macOS、字体却说
 * 这台机器没有 mac 字体，任何做交叉校验的指纹库都会把它标成矛盾，比不伪装更显眼。
 */
export interface PlatformConfig {
  enabled: boolean;
  claimed: PlatformClaim;
  /** Sec-CH-UA-Platform-Version；空串 = 按平台取默认值 */
  version: string;
  /** Sec-CH-UA-Arch；空串 = 按平台取默认值（mac 默认 arm，windows/linux 默认 x86） */
  architecture: string;
}

export interface CanvasConfig {
  enabled: boolean;
  spoofFonts: boolean;
  /**
   * 平台层。`auto` = 按浏览器真实平台（`navigator.userAgentData.platform`），
   * 隐藏另外两个平台的字体；`none` 关掉这一层。
   */
  platform: CanvasPlatform;
  /** 中文 / 国产厂商层：与平台正交，控制的是"这台机器有没有中文环境" */
  hideCjkFonts: boolean;
  /** 手动追加要隐藏的字体（在上面两层之上叠加） */
  targetFonts: string[];
}

export interface SignalOverride<T> {
  mode: OverrideMode;
  value: T | null;
}

export interface SiteRule {
  id: string;
  domain: string;
  enabled: boolean;
  overrides: {
    language: SignalOverride<Partial<LanguageConfig>>;
    timezone: SignalOverride<Partial<TimezoneConfig>>;
    geolocation: SignalOverride<Partial<GeolocationConfig>>;
  };
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  geolocation: {
    latitude: number;
    longitude: number;
    accuracy: number;
    country?: string;
  };
  language: {
    language: string;
    languages: string[];
    acceptLanguage: string;
  };
  timezone: {
    timezone: string;
  };
}

export interface ProfileConfig {
  activeProfileId: string | null;
  profiles: Profile[];
}

export interface SiteSpoofConfig {
  /** 配置结构版本；升级时按它决定要不要补默认值（见 CONFIG_SCHEMA_VERSION） */
  schemaVersion: number;
  masterEnabled: boolean;
  debugMode: boolean;
  globalProfile: {
    language: LanguageConfig;
    timezone: TimezoneConfig;
    geolocation: GeolocationConfig;
  };
  webRtc: WebRtcConfig;
  platform: PlatformConfig;
  canvas: CanvasConfig;
  profile: ProfileConfig;
  rules: SiteRule[];
}

export interface LastLocation {
  latitude: number;
  longitude: number;
  country: string;
  timezone?: string | null;
  timezoneOffset?: number | null;
  updateTime?: string;
}

export interface EffectivePayload {
  extensionEnabled: true;
  debugMode: boolean;
  ruleId: string;
  domain: string;
  geolocation: (GeolocationConfig & {
    latitude: number;
    longitude: number;
    timezone?: string | null;
  }) | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  timezoneSource: 'manual' | 'lastLocation' | null;
  languageConfig: LanguageConfig | null;
  timezoneConfig: TimezoneConfig;
  canvasConfig: CanvasConfig;
  /**
   * 平台声称。字体层已经按同一个声称解析过了（`canvasConfig.platform`），
   * 这里给出的是要写进 UA / UA-CH / Sec-CH-UA-* 的值；null = 不声称。
   */
  platform: { claimed: PlatformClaim; version: string; architecture: string } | null;
}

export interface EffectiveProfileResult {
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
  /** 命中了显式排除（disabled 规则）：该站点及其子域不做任何改写 */
  excluded?: boolean;
}
