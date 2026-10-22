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
  timezone: string | null;
  provider: string | null;
  verifiedAt: number | null;
}

export interface DetectedExitLocation {
  publicIp: string;
  latitude: number;
  longitude: number;
  country: string;
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

export interface PageRuntimeStatus {
  state: 'ready' | 'disabled' | 'api-unsupported' | 'permission-required' | 'switch-required' | 'sync-failed';
  // 只有成功读回后才有数量；失败不能将未知残留注册误报为零。
  registeredRuleCount: number | null;
  reloadRequired: boolean;
}
export type RuntimeSyncComponent = 'contentScripts' | 'legacyDnrCleanup' | 'webrtc' | 'tabReload';

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
}

export interface ConfigSaveResult {
  config: SiteSpoofConfig;
  syncReport: RuntimeSyncReport;
}

// 只记录会话内刷新欠账；URL 和配置均只保留摘要，不复制期望配置。
export interface RuntimeSyncMetadata {
  version: 1;
  report: RuntimeSyncReport;
  pendingReloads: Array<{ tabId: number; urlSignature: string }>;
  // 预写新签名后、local 写入前中断时，仍能恢复旧配置的刷新欠账。
  previous?: { configSignature: string; pendingReloads: RuntimeSyncMetadata['pendingReloads'] };
  pendingDetectionCleanup?: string;
}
