export type LanguageMode = 'preset' | 'custom';
export type TimezoneMode = 'auto' | 'manual';
export type GeolocationMode = 'auto' | 'manual';
export type OverrideMode = 'inherit' | 'override' | 'disable';
export type WebRtcMode = 'strict' | 'compatible' | 'default';
export type IntlMode = 'strict' | 'compatible';
export type FontExposureMode = 'vendor-software' | 'custom';
export type ExitLocationVerification = 'verified' | 'unverified';

export interface LanguageConfig {
  enabled: boolean;
  mode: LanguageMode;
  language: string;
  languages: string[];
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

export interface FontExposureConfig {
  enabled: boolean;
  mode: FontExposureMode;
  blockedFamilies: string[];
}

export interface SignalOverride<T> {
  mode: OverrideMode;
  value: T | null;
}

export interface SiteRule {
  id: string;
  domain: string;
  enabled: boolean;
  exitLocationProfileId: string | null;
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
  };
  timezone: {
    timezone: string;
  };
}

export interface ProfileConfig {
  activeProfileId: string | null;
  profiles: Profile[];
}

export interface ExitLocationProfile {
  id: string;
  name: string;
  verification: ExitLocationVerification;
  publicIp: string | null;
  latitude: number;
  longitude: number;
  country: string;
  // 旧 schema v3 档案可能没有代码；不得根据国家名称或时区回填。
  countryCode?: string | null;
  timezone: string | null;
  provider: string | null;
  verifiedAt: number | null;
}

export interface DetectedExitLocation {
  publicIp: string;
  latitude: number;
  longitude: number;
  country: string;
  countryCode?: string | null;
  timezone: string;
  provider: string;
  detectedAt: number;
}

export interface ExitLocationDetectionPreview {
  detectionId: string;
  targetProfileId: string | null;
  candidate: DetectedExitLocation;
  previous: ExitLocationProfile | null;
  expiresAt: number;
}

export interface ExitEnvironmentRecommendation {
  profileId: string;
  verifiedAt: number | null;
  countryCode: string | null;
  timezone: { value: string | null; confidence: 'provider-reported' | 'unknown'; reason: string };
  language: { value: LanguageConfig | null; reason: string };
  fontExposure: { value: FontExposureConfig; reason: string };
  webRtc: { value: WebRtcMode; reason: string };
}

// 仅传选择，实际推荐值由后台在当前配置事务内重新派生。
export interface ExitRecommendationSelection {
  expectedVerifiedAt: number;
  language: 'keep' | 'exit';
  timezone: 'keep' | 'exit';
  fontExposure: 'keep' | 'vendor-software';
}

export interface SiteSpoofConfig {
  schemaVersion: 3;
  intlMode: IntlMode;
  masterEnabled: boolean;
  debugMode: boolean;
  globalProfile: {
    language: LanguageConfig;
    timezone: TimezoneConfig;
    geolocation: GeolocationConfig;
  };
  webRtc: WebRtcConfig;
  fontExposure: FontExposureConfig;
  profile: ProfileConfig;
  exitLocationProfiles: ExitLocationProfile[];
  rules: SiteRule[];
}

export interface EffectivePayload {
  extensionEnabled: true;
  intlMode: IntlMode;
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
  timezoneSource: 'manual' | 'exitProfile' | null;
  languageConfig: LanguageConfig | null;
  timezoneConfig: TimezoneConfig;
  fontExposureConfig: FontExposureConfig;
}

export interface EffectiveProfileResult {
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
}

export type RuntimeSyncStatus = 'ok' | 'failed' | 'partial';
// 只有已启用且可解析的页面信号进入注册代码，未启用的字段直接省略。
export interface LanguageTimezonePayload {
  intlMode: IntlMode;
  language?: { language: string; languages: string[] };
  timezone?: string;
}

export interface GeolocationPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  randomize: boolean;
  randomRadiusMeters: number;
  spoofPermission: boolean;
}

export interface PageRuntimeStatus {
  state: 'ready' | 'disabled' | 'api-unsupported' | 'permission-required' | 'switch-required' | 'sync-failed';
  // 只有成功读回后才有数量；失败不能将未知残留注册误报为零。
  registeredRuleCount: number | null;
  reloadRequired: boolean;
}
export interface FontRuntimeStatus {
  state: 'ready' | 'disabled' | 'paused' | 'custom-paused' | 'sync-failed';
  registeredRuleCount: number | null;
  reloadRequired: boolean;
}
export type RuntimeSyncComponent = 'contentScripts' | 'webrtc' | 'tabReload';

export interface RuntimeSyncError {
  code: string;
  message: string;
}

export interface RuntimeSyncComponentReport {
  status: RuntimeSyncStatus;
  errors: RuntimeSyncError[];
}

export interface RuntimeSyncReport {
  configSignature: string;
  status: RuntimeSyncStatus;
  components: Record<RuntimeSyncComponent, RuntimeSyncComponentReport>;
  metadataError: RuntimeSyncError | null;
  warnings?: RuntimeSyncError[];
  pageRuntime?: PageRuntimeStatus;
  fontRuntime?: FontRuntimeStatus;
  geolocationRuntime?: PageRuntimeStatus;
}

export interface ConfigSaveResult {
  config: SiteSpoofConfig;
  syncReport: RuntimeSyncReport;
}

// 只记录会话内刷新欠账；URL 和配置均只保留摘要，不复制期望配置。
export interface RuntimeSyncMetadata {
  version: 1;
  report: RuntimeSyncReport;
  // 旧记录未带 surfaces 时仅代表语言/时区；字体生产当时尚未恢复。
  pendingReloads: Array<{ tabId: number; urlSignature: string; surfaces?: Array<'page' | 'font' | 'geolocation'> }>;
  // 保存到注册同步的非原子窗口：完成后仍须补录其间新建的标签页（含 iframe）。
  pendingFontScopeChange?: boolean;
  pendingGeolocationScopeChange?: boolean;
  // 预写新签名后、local 写入前中断时，仍能恢复旧配置的刷新欠账。
  previous?: { configSignature: string; pendingReloads: RuntimeSyncMetadata['pendingReloads']; pendingFontScopeChange?: boolean; pendingGeolocationScopeChange?: boolean };
  pendingDetectionCleanup?: string;
}
