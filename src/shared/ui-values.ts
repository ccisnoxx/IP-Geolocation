import { getTimezoneOffsetMinutes } from './config-model';
import type { GeolocationConfig, LastLocation, SiteSpoofConfig, TimezoneConfig } from './types';

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

export interface LocationDisplay {
  latitude: string;
  longitude: string;
  timezone: string;
  /** 这几格显示的是 `lastLocation`（auto 档），不是配置里写死的值 */
  autoGeo: boolean;
  autoTimezone: boolean;
}

/**
 * 表单该显示哪一份坐标/时区。
 *
 * auto 档的配置里坐标通常是 null（跟随出口 IP 解析），直接显示配置值就是两个
 * 空框：用户点「从 IP 自动配置」/「重试定位」之后界面上什么都不变，看起来就是
 * 按钮坏了。所以 auto 时用 `lastLocation`（实际生效的那份）顶上，manual 时才
 * 显示配置里写死的值。
 */
export function locationDisplay(
  geolocation: Pick<GeolocationConfig, 'mode' | 'latitude' | 'longitude'>,
  timezone: Pick<TimezoneConfig, 'mode' | 'timezone'>,
  lastLocation: LastLocation | null | undefined
): LocationDisplay {
  const autoGeo = geolocation.mode === 'auto'
    && Boolean(lastLocation)
    && Number.isFinite(lastLocation!.latitude)
    && Number.isFinite(lastLocation!.longitude);
  const autoTimezone = timezone.mode === 'auto' && Boolean(lastLocation && lastLocation.timezone);

  return {
    latitude: coordinateInputValue(autoGeo ? lastLocation!.latitude : geolocation.latitude),
    longitude: coordinateInputValue(autoGeo ? lastLocation!.longitude : geolocation.longitude),
    timezone: autoTimezone ? String(lastLocation!.timezone) : timezone.timezone,
    autoGeo,
    autoTimezone
  };
}

/**
 * 「从 IP 自动配置」失败时给用户看的一句话。
 *
 * 原始错误是拼起来的三条接口失败原因（`exit IP lookup failed: url no usable exit ip | …`），
 * 塞进弹窗会挤成四行红字，用户只想知道"为什么没配上"。技术细节仍然留在
 * `lastGeoError` 里，排障时看得到。
 */
export function describeIpApplyError(error: string): string {
  if (/no usable exit ip|exit IP lookup failed/i.test(error)) {
    return '查不到出口 IP（归属地接口都没返回可用坐标），稍后再试';
  }
  if (/failed to fetch|networkerror|timed out|timeout|aborted/i.test(error)) {
    return '连不上归属地接口（网络或代理问题），稍后再试';
  }
  return error;
}
