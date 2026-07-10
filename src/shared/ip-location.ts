// Shared IP-location freshness, refresh-state, and provider backoff contracts.
import type { LastLocation } from './types';

export const GEO_PROVIDER_TIMEOUT_MS = 3500;
export const LAST_LOCATION_TTL_MS = 30 * 60 * 1000;
export const GEO_BACKOFF_INITIAL_MS = 60 * 1000;
export const GEO_BACKOFF_MAX_MS = 30 * 60 * 1000;
export const GEO_PROVIDER_BACKOFF_KEY = 'geoProviderBackoff';
export const GEO_REFRESH_STATE_KEY = 'geoRefreshState';

export type IpLocationFreshness = 'fresh' | 'stale' | 'missing';
export type GeoRefreshStatus = 'idle' | 'refreshing' | 'error';

export interface GeoRefreshState {
  status: GeoRefreshStatus;
  startedAt?: number;
  completedAt?: number;
  provider?: string;
  error?: string;
}

export interface GeoProviderBackoffEntry {
  failures: number;
  nextRetryAt: number;
  lastError: string;
}

export type GeoProviderBackoff = Record<string, GeoProviderBackoffEntry>;

export interface IpLocationStatusSnapshot {
  freshness: IpLocationFreshness;
  refreshStatus: GeoRefreshStatus;
  usable: boolean;
  stale: boolean;
  updatedAt: number | null;
  expiresAt: number | null;
  error: string;
}

export function hasValidLastLocation(location: LastLocation | null | undefined): location is LastLocation {
  return Boolean(
    location
    && Number.isFinite(Number(location.latitude))
    && Number(location.latitude) >= -90
    && Number(location.latitude) <= 90
    && Number.isFinite(Number(location.longitude))
    && Number(location.longitude) >= -180
    && Number(location.longitude) <= 180
  );
}

export function getLastLocationUpdatedAt(location: LastLocation | null | undefined): number | null {
  if (!location || !Number.isFinite(Number(location.updatedAt))) return null;
  return Number(location.updatedAt);
}

export function getLastLocationExpiresAt(
  location: LastLocation | null | undefined,
  ttlMs = LAST_LOCATION_TTL_MS
): number | null {
  if (!location) return null;
  if (Number.isFinite(Number(location.expiresAt))) return Number(location.expiresAt);
  const updatedAt = getLastLocationUpdatedAt(location);
  return updatedAt === null ? null : updatedAt + ttlMs;
}

export function getLastLocationFreshness(
  location: LastLocation | null | undefined,
  now = Date.now(),
  ttlMs = LAST_LOCATION_TTL_MS
): IpLocationFreshness {
  if (!hasValidLastLocation(location)) return 'missing';
  const expiresAt = getLastLocationExpiresAt(location, ttlMs);
  return expiresAt !== null && expiresAt > now ? 'fresh' : 'stale';
}

export function withFreshLocationMetadata(
  location: Omit<LastLocation, 'updateTime' | 'updatedAt' | 'expiresAt'>,
  options: { now?: number; provider?: string; ttlMs?: number } = {}
): LastLocation {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? LAST_LOCATION_TTL_MS;
  return {
    ...location,
    provider: options.provider || location.provider,
    updatedAt: now,
    expiresAt: now + ttlMs,
    updateTime: new Date(now).toLocaleString()
  };
}

export function normalizeGeoRefreshState(value: unknown): GeoRefreshState {
  const input = value && typeof value === 'object' ? value as Partial<GeoRefreshState> : {};
  const status: GeoRefreshStatus = input.status === 'refreshing' || input.status === 'error' ? input.status : 'idle';
  return {
    status,
    startedAt: Number.isFinite(Number(input.startedAt)) ? Number(input.startedAt) : undefined,
    completedAt: Number.isFinite(Number(input.completedAt)) ? Number(input.completedAt) : undefined,
    provider: input.provider ? String(input.provider) : undefined,
    error: input.error ? String(input.error) : undefined
  };
}

export function normalizeGeoProviderBackoff(value: unknown): GeoProviderBackoff {
  const input = value && typeof value === 'object' ? value as Record<string, Partial<GeoProviderBackoffEntry>> : {};
  return Object.entries(input).reduce<GeoProviderBackoff>((backoff, [provider, entry]) => {
    const failures = Number(entry?.failures);
    const nextRetryAt = Number(entry?.nextRetryAt);
    if (!provider || !Number.isFinite(failures) || failures < 1 || !Number.isFinite(nextRetryAt)) {
      return backoff;
    }
    backoff[provider] = {
      failures: Math.max(1, Math.floor(failures)),
      nextRetryAt,
      lastError: entry?.lastError ? String(entry.lastError) : ''
    };
    return backoff;
  }, {});
}

export function nextGeoProviderBackoffEntry(
  previous: GeoProviderBackoffEntry | undefined,
  error: string,
  now = Date.now()
): GeoProviderBackoffEntry {
  const failures = Math.max(1, (previous?.failures || 0) + 1);
  const delay = Math.min(GEO_BACKOFF_MAX_MS, GEO_BACKOFF_INITIAL_MS * (2 ** (failures - 1)));
  return {
    failures,
    nextRetryAt: now + delay,
    lastError: error
  };
}

export function deriveIpLocationStatus(
  location: LastLocation | null | undefined,
  refreshState: GeoRefreshState | null | undefined,
  now = Date.now()
): IpLocationStatusSnapshot {
  const normalizedRefresh = normalizeGeoRefreshState(refreshState);
  const freshness = getLastLocationFreshness(location, now);
  return {
    freshness,
    refreshStatus: normalizedRefresh.status,
    usable: freshness !== 'missing',
    stale: freshness === 'stale',
    updatedAt: getLastLocationUpdatedAt(location),
    expiresAt: getLastLocationExpiresAt(location),
    error: normalizedRefresh.error || ''
  };
}
