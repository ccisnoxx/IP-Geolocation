// Formats IP-derived location values for UI surfaces without making them manual config values.
import { deriveIpLocationStatus, getLastLocationExpiresAt } from './ip-location';
import type { LastLocation } from './types';
import type { IpLocationStatusSnapshot } from './ip-location';

export function formatCoordinate(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDateTime(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : '';
}

function formatLocationSummary(location: LastLocation): string {
  const latitude = formatCoordinate(location.latitude);
  const longitude = formatCoordinate(location.longitude);
  const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : '坐标未知';
  const timezone = location.timezone ? `时区 ${location.timezone}` : '时区未知';
  const country = location.country ? ` · ${location.country}` : '';
  const updatedAt = location.updateTime ? ` · 更新 ${location.updateTime}` : '';
  const expiresAt = formatDateTime(getLastLocationExpiresAt(location));
  const expires = expiresAt ? ` · 过期 ${expiresAt}` : '';
  return `${coordinates} · ${timezone}${country}${updatedAt}${expires}`;
}

export function formatLastLocationStatus(
  location: LastLocation | null,
  status?: IpLocationStatusSnapshot | null
): string {
  const effectiveStatus = status || (location ? deriveIpLocationStatus(location, null) : null);

  if (effectiveStatus?.refreshStatus === 'refreshing') {
    return location
      ? `当前出口 IP 定位：Refreshing（刷新中）；继续使用 ${formatLocationSummary(location)}`
      : '当前出口 IP 定位：Refreshing（刷新中）；尚无可用定位';
  }

  if (effectiveStatus?.refreshStatus === 'error') {
    const error = effectiveStatus.error || '刷新失败';
    return location
      ? `当前出口 IP 定位：Error（错误）${error}；继续使用 ${effectiveStatus.stale ? 'Stale（过期）' : 'Fresh（有效）'} ${formatLocationSummary(location)}`
      : `当前出口 IP 定位：Error（错误）${error}；尚无可用定位`;
  }

  if (!location) return '当前出口 IP 定位：Error（错误）；尚未刷新到可用定位';

  const freshness = effectiveStatus?.freshness === 'stale'
    ? 'Stale（过期）'
    : 'Fresh（有效）';
  return `当前出口 IP 定位：${freshness} ${formatLocationSummary(location)}`;
}
