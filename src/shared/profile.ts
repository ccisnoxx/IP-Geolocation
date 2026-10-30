import {
  DEFAULT_PROFILES,
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeString,
  normalizeTimezone,
  validateTimezone
} from './config-model';
import type { Profile, SiteSpoofConfig } from './types';

export function validateProfile(profile: Partial<Profile>): boolean {
  if (!normalizeString(profile.id) || !normalizeString(profile.name)) return false;
  if (!profile.geolocation) return false;
  const { latitude, longitude, accuracy } = profile.geolocation;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  if (!Number.isFinite(accuracy) || accuracy <= 0) return false;
  if (!profile.language || !profile.language.language || !Array.isArray(profile.language.languages)) return false;
  if (!profile.timezone || !validateTimezone(profile.timezone.timezone)) return false;
  return true;
}

export function applyProfileToConfig(config: SiteSpoofConfig, profileId: string): SiteSpoofConfig {
  const normalized = normalizeConfig(config);
  const profile = normalized.profile.profiles.find((item) => item.id === profileId)
    || DEFAULT_PROFILES.find((item) => item.id === profileId);

  if (!profile) return normalized;

  return normalizeConfig({
    ...normalized,
    globalProfile: {
      language: normalizeLanguage({
        ...profile.language,
        enabled: normalized.globalProfile.language.enabled,
        mode: 'preset'
      }),
      timezone: normalizeTimezone({
        enabled: normalized.globalProfile.timezone.enabled,
        mode: 'manual',
        timezone: profile.timezone.timezone
      }),
      geolocation: normalizeGeolocation({
        ...normalized.globalProfile.geolocation,
        enabled: normalized.globalProfile.geolocation.enabled,
        mode: 'manual',
        latitude: profile.geolocation.latitude,
        longitude: profile.geolocation.longitude,
        accuracy: profile.geolocation.accuracy,
        country: profile.geolocation.country || profile.name
      })
    },
    profile: {
      ...normalized.profile,
      activeProfileId: profileId
    }
  });
}

export { DEFAULT_PROFILES };
