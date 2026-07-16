import {
  LAST_LOCATION_KEY,
  LEGACY_VANISHME_CONFIG_KEY,
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY,
  migrateLegacyConfig
} from './config-resolver';
import {
  OLD_EXTENSION_ENABLED_KEY,
  OLD_LANGUAGE_KEY,
  OLD_TIMEZONE_KEY,
  OLD_WEBRTC_KEY
} from './config-model';
import { GEO_LAST_ERROR_KEY, GEO_PROVIDER_BACKOFF_KEY, GEO_REFRESH_STATE_KEY } from './ip-location';
import type { SiteSpoofConfig } from './types';

export async function getConfig(): Promise<SiteSpoofConfig> {
  const data = await chrome.storage.local.get(null);
  const config = migrateLegacyConfig(data);
  const storedConfig = data[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
  const needsMigration = storedConfig?.schemaVersion !== 2
    || Boolean(data[LEGACY_VANISHME_CONFIG_KEY])
    || data[RULES_INITIALIZED_KEY] !== true;
  if (needsMigration) {
    await chrome.storage.local.set({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true });
  }
  const obsoleteKeys = [
    LEGACY_VANISHME_CONFIG_KEY,
    LAST_LOCATION_KEY,
    GEO_PROVIDER_BACKOFF_KEY,
    GEO_REFRESH_STATE_KEY,
    GEO_LAST_ERROR_KEY,
    OLD_EXTENSION_ENABLED_KEY,
    OLD_LANGUAGE_KEY,
    OLD_TIMEZONE_KEY,
    OLD_WEBRTC_KEY
  ]
    .filter((key) => Object.prototype.hasOwnProperty.call(data, key));
  if (obsoleteKeys.length) {
    await chrome.storage.local.remove(obsoleteKeys);
  }
  return config;
}

export { LAST_LOCATION_KEY, LEGACY_VANISHME_CONFIG_KEY, SITE_CONFIG_KEY };
