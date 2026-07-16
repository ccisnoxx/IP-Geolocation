// 出口检测只保留单次请求超时；其余键仅用于升级后清理旧状态。
export const GEO_PROVIDER_TIMEOUT_MS = 3500;
export const GEO_PROVIDER_BACKOFF_KEY = 'geoProviderBackoff';
export const GEO_REFRESH_STATE_KEY = 'geoRefreshState';
export const GEO_LAST_ERROR_KEY = 'lastGeoError';
