import { getTimezoneOffsetMinutes } from './config-model';
import type { SiteSpoofConfig } from './types';

/** options / popup 共用的表单值转换，独立出来是为了能在 Node 里单测。 */
export function webRtcSelectValue(config: Pick<SiteSpoofConfig, 'webRtc'>): string {
  if (config.webRtc.globalMode === 'strict') return 'disable_non_proxied_udp';
  if (config.webRtc.globalMode === 'compatible') return 'default_public_interface_only';
  return 'default';
}

export function utcOffsetInputValue(timezone: string): string {
  if (!timezone) return '';
  const offset = getTimezoneOffsetMinutes(timezone);
  return offset === null ? '' : String(-offset / 60);
}

export function coordinateInputValue(value: number | null): string {
  return value === null ? '' : String(value);
}

/** 空串 = 未填；非法数字也按未填处理，避免把 NaN 写进配置 */
export function parseCoordinateInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function geolocationModeFromInput(latitude: string, longitude: string): 'manual' | 'auto' {
  return latitude.trim() && longitude.trim() ? 'manual' : 'auto';
}
