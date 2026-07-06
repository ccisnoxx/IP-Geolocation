// Formats IP-derived location values for UI surfaces without making them manual config values.
import type { LastLocation } from './types';

export function formatCoordinate(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatLastLocationStatus(location: LastLocation | null): string {
  if (!location) return '当前出口 IP 定位：尚未刷新';

  const latitude = formatCoordinate(location.latitude);
  const longitude = formatCoordinate(location.longitude);
  const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : '坐标未知';
  const timezone = location.timezone ? `时区 ${location.timezone}` : '时区未知';
  const country = location.country ? ` · ${location.country}` : '';
  const updatedAt = location.updateTime ? ` · ${location.updateTime}` : '';
  return `当前出口 IP 定位：${coordinates} · ${timezone}${country}${updatedAt}`;
}
