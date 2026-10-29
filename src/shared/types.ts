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
  /**
   * 完全不调用系统定位：不触发系统授权框、不在系统的定位记录里留痕。
   *
   * 打开它时必须同时伪装权限 —— 背景侧把 contentSettings 置为 allow，页面问
   * `permissions.query` 得到的回答与拿到的坐标才是同一件事。归一化里做了这个绑定
   * （见 normalizeGeolocation），所以"不碰原生 + 权限仍按 prompt 走"这种自相矛盾的
   * 组合存不进去。缺省值跟随 spoofPermission。
   */
  noNativeCall: boolean;
  history: GeolocationHistory[];
}

export interface WebRtcConfig {
  globalMode: WebRtcMode;
}

/**
 * 跟随出口 IP。
 *
 * 语义只有一句：**出口 IP 变了，就把时区与坐标换成新出口所在地区的**。
 * 语言故意不跟着走 —— 语言是用户画像里最稳的一层（用英语的人在东京出口
 * 也很正常），跟着 IP 换语言只会制造"Accept-Language 说日语、页面里
 * 却写英文"这类自相矛盾。真要跟，`syncLanguage` 显式打开。
 */
export interface IpSyncConfig {
  enabled: boolean;
  /** 检测周期（分钟）；钳制在 IP_SYNC_MIN_INTERVAL_MINUTES..IP_SYNC_MAX_INTERVAL_MINUTES */
  intervalMinutes: number;
  /** 语言是否也跟随出口国家。默认 false */
  syncLanguage: boolean;
}

/** 平台维度：决定隐藏"不属于本机这个平台"的字体。none = 不按平台隐藏 */
/**
 * 字体层的平台维度：只决定"按哪个平台的字表去判定"，不对外声称任何东西。
 *
 * 曾经有 mac / windows / linux 三个手动值，语义是"让这台机器看起来像另一个平台"。
 * 那件事在 JS 层做不到（WebGL 渲染器、GPU、色深仍是真硬件），做了反而制造矛盾，
 * 所以在 4 里收窄成：auto = 按本机真实平台，none = 这一层不参与。
 */
export type CanvasPlatform = 'auto' | 'none';

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
  canvas: CanvasConfig;
  ipSync: IpSyncConfig;
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
  /** 这份 payload 是按哪个 hostname 解析出来的；桥用它拒绝父页 payload 串到独立子域 iframe */
  hostname: string;
  geolocation: (GeolocationConfig & {
    latitude: number;
    longitude: number;
    timezone?: string | null;
  }) | null;
  /**
   * 定位已启用但坐标解析不出来：页面必须 fail-closed（POSITION_UNAVAILABLE），
   * 而不是落回原生定位。此时 `geolocation` 为 null。
   */
  geolocationDenied: boolean;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  timezoneSource: 'manual' | 'lastLocation' | null;
  languageConfig: LanguageConfig | null;
  timezoneConfig: TimezoneConfig;
  canvasConfig: CanvasConfig;
}

export interface EffectiveProfileResult {
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
  /** 命中了显式排除（disabled 规则）：该站点及其子域不做任何改写 */
  excluded?: boolean;
}
