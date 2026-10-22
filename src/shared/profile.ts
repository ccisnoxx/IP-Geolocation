import {
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeString,
  normalizeTimezone,
  getProfileValidationErrors
} from './config-model';
import type { Profile, SiteSpoofConfig } from './types';

export { validateProfile } from './config-model';

export function createCustomProfile(config: SiteSpoofConfig, name: string, description?: string): Profile {
  const profile = {
    id: crypto.randomUUID(),
    name: normalizeString(name),
    description: normalizeString(description) || undefined,
    geolocation: {
      latitude: config.globalProfile.geolocation.latitude,
      longitude: config.globalProfile.geolocation.longitude,
      accuracy: config.globalProfile.geolocation.accuracy,
      country: config.globalProfile.geolocation.country
    },
    language: {
      language: config.globalProfile.language.language,
      languages: config.globalProfile.language.languages.slice()
    },
    timezone: { timezone: config.globalProfile.timezone.timezone }
  };
  const errors = getProfileValidationErrors(profile);
  if (errors.length) throw new Error(`无法保存自定义方案：${errors.join('；')}`);
  return profile as Profile;
}

export function applyProfileToConfig(config: SiteSpoofConfig, profileId: string): SiteSpoofConfig {
  const normalized = normalizeConfig(config);
  const profile = normalized.profile.profiles.find((item) => item.id === profileId);

  if (!profile) return normalized;

  return normalizeConfig({
    ...normalized,
    globalProfile: {
      language: normalizeLanguage({
        enabled: normalized.globalProfile.language.enabled,
        mode: 'preset',
        ...profile.language
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
