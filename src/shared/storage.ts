import {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  SITE_CONFIG_KEY,
  migrateLegacyConfig,
  validateConfig
} from './config-resolver';
import { DEFAULT_CONFIG, clone, normalizeConfig } from './config-model';
import { applyProfileToConfig } from './profile';
import type { LastLocation, SiteSpoofConfig } from './types';

export async function getConfig(): Promise<SiteSpoofConfig> {
  const data = await chrome.storage.local.get(null);
  const config = migrateLegacyConfig(data);
  if (!data[SITE_CONFIG_KEY] || data[LEGACY_VANISHME_CONFIG_KEY]) {
    await chrome.storage.local.set({ [SITE_CONFIG_KEY]: config });
    if (data[LEGACY_VANISHME_CONFIG_KEY]) {
      await chrome.storage.local.remove(LEGACY_VANISHME_CONFIG_KEY);
    }
  }
  return config;
}

export async function setConfig(config: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
  const result = validateConfig(config);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  await chrome.storage.local.set({ [SITE_CONFIG_KEY]: result.config });
  return result.config;
}

export async function updateConfig(updates: Partial<SiteSpoofConfig>): Promise<SiteSpoofConfig> {
  const config = await getConfig();
  return setConfig(normalizeConfig({ ...config, ...updates }));
}

export async function resetConfig(): Promise<SiteSpoofConfig> {
  const config = clone(DEFAULT_CONFIG);
  await chrome.storage.local.set({ [SITE_CONFIG_KEY]: config });
  return config;
}

export async function getLastLocation(): Promise<LastLocation | null> {
  const data = await chrome.storage.local.get(LAST_LOCATION_KEY);
  return data[LAST_LOCATION_KEY] || null;
}

export async function setLastLocation(location: LastLocation): Promise<void> {
  await chrome.storage.local.set({ [LAST_LOCATION_KEY]: location });
}

export async function applyProfile(profileId: string): Promise<SiteSpoofConfig> {
  const config = await getConfig();
  return setConfig(applyProfileToConfig(config, profileId));
}

export { LAST_LOCATION_KEY, SITE_CONFIG_KEY };
