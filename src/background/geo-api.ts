import type { LastLocation } from '../shared/types';

/**
 * 出口 IP 归属地接口的公共层。
 *
 * 手动「重试定位」（services）和自动跟随出口 IP（ip-sync）问的是同一件事：
 * 我现在从哪里出口、那里是什么时区、什么坐标。两个调用方各自抄一份解析，
 * 迟早会出现"一个接受了 0 坐标、另一个拒绝了"的裂缝 —— 所以校验只写一次。
 */

export const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];

export const GEO_FETCH_TIMEOUT_MS = 5000;

/**
 * 带超时的 JSON 请求。
 *
 * 三个 IP 接口是串行尝试的；任何一个挂住（TCP 半开、CDN 卡住）都会让
 * `updateGeolocation` 永远不返回，alarm 回调堆着、角标也不刷新。
 * 5 秒足够正常响应，失败就换下一家。
 */
export async function fetchJson(url: string, timeoutMs = GEO_FETCH_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把接口里的坐标转成数字。
 *
 * 两个坑：
 * 1. `data.latitude && data.longitude` 会把**合法的 0** 当成缺失（赤道 / 本初子午线）；
 * 2. `Number(null)` / `Number('')` 都是 0，缺字段反而会被当成"坐标在几内亚湾"。
 * 所以只接受数字或非空数字字符串，再校验范围；布尔和数组不能强转成坐标。
 */
function toCoordinate(value: unknown, limit: number): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) return null;
  return numeric;
}

function toCountry(data: any): string | null {
  const value = data && data.country;
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') return value.name || value.code || null;
  return (data && (data.country_name || data.country_code)) || null;
}

function toTimezone(value: any): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

export function parseGeoApiResponse(data: any): Omit<LastLocation, 'updateTime'> | null {
  if (!data || typeof data !== 'object') return null;

  if (data.success !== false) {
    const latitude = toCoordinate(data.latitude, 90);
    const longitude = toCoordinate(data.longitude, 180);
    if (latitude !== null && longitude !== null) {
      const timezoneOffset = data.timezone && Number.isFinite(Number(data.timezone.offset))
        ? -Number(data.timezone.offset) / 60
        : null;
      return {
        latitude,
        longitude,
        country: toCountry(data) || 'N/A',
        timezone: toTimezone(data.timezone),
        timezoneOffset
      };
    }
  }

  if (data.location && typeof data.location === 'object') {
    const latitude = toCoordinate(data.location.latitude, 90);
    const longitude = toCoordinate(data.location.longitude, 180);
    if (latitude !== null && longitude !== null) {
      return {
        latitude,
        longitude,
        country: data.country && data.country.name ? data.country.name : (toCountry(data) || 'N/A'),
        timezone: toTimezone(data.timezone),
        timezoneOffset: null
      };
    }
  }

  if (typeof data.loc === 'string' && data.loc.includes(',')) {
    const [rawLatitude, rawLongitude] = data.loc.split(',');
    const latitude = toCoordinate(rawLatitude, 90);
    const longitude = toCoordinate(rawLongitude, 180);
    if (latitude !== null && longitude !== null) {
      return {
        latitude,
        longitude,
        country: toCountry(data) || data.region || data.city || 'N/A',
        timezone: toTimezone(data.timezone),
        timezoneOffset: null
      };
    }
  }

  // 只有国家、没有坐标的响应（例如 CN 分支）不再伪造 0,0：
  // 那是一个真实存在的地点（几内亚湾），会和任何时区/坐标对不上。
  // 返回 null 让调用方继续试下一个接口，全部失败就按 fail-closed 处理。
  return null;
}
