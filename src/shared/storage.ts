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
import type { RuntimeSyncMetadata, SiteSpoofConfig } from './types';
import { RuntimeSyncOperationError } from './runtime-sync';

export const RUNTIME_SYNC_METADATA_KEY = 'runtimeSyncMetadata';
export const HEADER_RULE_OWNERSHIP_KEY = 'headerRulesDynamicOwnerV1';

// 仅记录已接管的DNR命名空间版本，不保存语言或规则副本。
export async function hasHeaderRuleOwnership(): Promise<boolean> {
  try {
    return (await chrome.storage.local.get(HEADER_RULE_OWNERSHIP_KEY))[HEADER_RULE_OWNERSHIP_KEY] === 1;
  } catch (error) {
    throw Object.assign(new RuntimeSyncOperationError('header-ownership-read-failed', '请求头规则所有权读取失败，保持隔离；请检查扩展存储后重试。'), { cause: error });
  }
}

export async function establishHeaderRuleOwnership(): Promise<void> {
  try { await chrome.storage.local.set({ [HEADER_RULE_OWNERSHIP_KEY]: 1 }); }
  catch (error) {
    throw Object.assign(new RuntimeSyncOperationError('header-ownership-write-failed', '请求头规则所有权写入失败，保持隔离；请检查扩展存储后重试。'), { cause: error });
  }
}

export async function getRuntimeSyncMetadata(): Promise<RuntimeSyncMetadata | null> {
  const data = await chrome.storage.session.get(RUNTIME_SYNC_METADATA_KEY);
  return data[RUNTIME_SYNC_METADATA_KEY] || null;
}

export async function setRuntimeSyncMetadata(metadata: RuntimeSyncMetadata | null): Promise<void> {
  if (metadata) await chrome.storage.session.set({ [RUNTIME_SYNC_METADATA_KEY]: metadata });
  else await chrome.storage.session.remove(RUNTIME_SYNC_METADATA_KEY);
}

export async function getConfig(beforeConfigWrite: () => Promise<void>): Promise<SiteSpoofConfig> {
  const data = await chrome.storage.local.get(null);
  const config = migrateLegacyConfig(data);
  const storedConfig = data[SITE_CONFIG_KEY] as { schemaVersion?: number } | undefined;
  const needsMigration = storedConfig?.schemaVersion !== 5;
  if (needsMigration) {
    await beforeConfigWrite();
    await chrome.storage.local.set({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true });
  } else if (data[RULES_INITIALIZED_KEY] !== true) {
    // v3 稳态只补标记，不用归一化结果覆盖用户已保存的规则和档案。
    await chrome.storage.local.set({ [RULES_INITIALIZED_KEY]: true });
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
