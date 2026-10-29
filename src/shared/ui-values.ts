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

/**
 * 「上次定位失败」卡片上的人话解释。
 *
 * `lastGeoError` 原文是 `/geolocation` 接口的拼接字符串（三条 API 各报一句，
 * 用 ` | ` 连起来），直接铺在配置页会变成一坨。原文仍然留在 `<details>` 里给排障用，
 * 这里只回答"为什么没定位成功、我现在能做什么"。
 */
export function describeGeoError(message: string): string {
  const text = String(message || '');
  if (!text) return '';
  if (/no valid coordinates/i.test(text)) {
    return '定位接口都返回了，但没有一个给出可用坐标：多半是代理把请求拦成了 HTML，或接口在限流。换网络后再点一次「从 IP 自动配置」。';
  }
  if (/exit IP lookup failed|no usable exit ip/i.test(text)) {
    return '查不到出口 IP：归属地接口没返回可用结果。检查代理是否正常，或换一个出口再试。';
  }
  if (/storage blocked/i.test(text)) {
    return '扩展存储不可用（写入被拒）：配置改动没落库，改完刷新配置页确认还在。';
  }
  if (/failed to fetch|networkerror|timed out|timeout|aborted|econnrefused/i.test(text)) {
    return '连不上定位接口：网络或代理把请求挡掉了。恢复网络后点一次「从 IP 自动配置」重试。';
  }
  return '后台更新定位时出错了，原文见下方技术原因。';
}

/**
 * 「多久之前」的粗粒度说法。只做量级判断 —— 用户要的是"刚才还是很久以前"，
 * 精确到秒既没用又需要每秒重绘一次。
 *
 * `at` 不合法（老版本没写这个字段）时返回空串，调用方据此不显示时间。
 */
export function formatErrorAge(at: string, now: number = Date.now()): string {
  const timestamp = Date.parse(String(at || ''));
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}
