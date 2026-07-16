export type LanguageMode = 'preset' | 'custom';
export type TimezoneMode = 'auto' | 'manual';
export type GeolocationMode = 'auto' | 'manual';
export type OverrideMode = 'inherit' | 'override' | 'disable';
export type WebRtcMode = 'strict' | 'compatible' | 'default';
export type ExitLocationVerification = 'verified' | 'unverified';

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

export interface CanvasConfig {
  enabled: boolean;
  spoofFonts: boolean;
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
  schemaVersion: 2;
  masterEnabled: boolean;
  debugMode: boolean;
  globalProfile: {
    language: LanguageConfig;
    timezone: TimezoneConfig;
    geolocation: GeolocationConfig;
  };
  webRtc: WebRtcConfig;
  canvas: CanvasConfig;
  profile: ProfileConfig;
  exitLocationProfiles: ExitLocationProfile[];
  rules: SiteRule[];
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
  timezoneSource: 'manual' | 'exitProfile' | null;
  languageConfig: LanguageConfig | null;
  timezoneConfig: TimezoneConfig;
  canvasConfig: CanvasConfig;
}

export interface EffectiveProfileResult {
  matched: boolean;
  rule: SiteRule | null;
  payload: EffectivePayload | null;
  errors: string[];
}
