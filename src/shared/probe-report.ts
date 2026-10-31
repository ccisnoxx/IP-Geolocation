import { getEffectiveProfile } from './config-resolver';
import type { LastLocation, SiteSpoofConfig } from './types';

/**
 * 诊断页「站点实测」的判定逻辑：期望值从配置按站点解析，实际值由页面探针采集，
 * 这里只做对比，给出每一项“对 / 不对 / 没法测”。
 *
 * 纯函数：不碰 chrome API、不读 DOM，诊断页负责采集与渲染。
 */

/** 页面探针在目标标签页 MAIN world 里采集的原始值 */
export interface ProbeSnapshot {
  timezone: string;
  offsetMinutes: number;
  /** Temporal 不存在时为 null（Chrome 119 等老版本） */
  temporalTimeZone: string | null;
  locale: string;
  language: string;
  languages: string[];
  geolocation: {
    permission: string;
    /** 只在权限已授予时读取，未授权时不读，避免在目标页面弹出授权框 */
    coords: { latitude: number; longitude: number; accuracy: number } | null;
    error: string | null;
  };
  /**
   * 网页里收集到的 ICE 候选地址（未配置 STUN，只有本机候选）。
   * 必须在网页里测：扩展页面既不受 WebRTC 策略约束、也没有 mDNS 匿名化，会看到真实局域网 IP。
   */
  webrtc: { candidates: string[]; error: string | null } | null;
  /** 反检测与字体等“自带对错”的检查项 */
  checks: Array<{ group: string; label: string; value: string; ok: boolean | null }>;
}

/** 本页（扩展源，不被注入）读到的浏览器原生值：不在规则里的站点应当和它一致 */
export interface NativeBaseline {
  timezone: string;
  language: string;
  languages: string[];
}

export type RowStatus = 'ok' | 'bad' | 'skip';

export interface ReportRow {
  group: string;
  label: string;
  expected: string;
  actual: string;
  status: RowStatus;
}

export interface ProbeReport {
  hostname: string;
  /** 站点在规则里且未被排除、总开关开着 */
  spoofed: boolean;
  /** 一句话说明这个站点按什么规则判定 */
  scope: string;
  rows: ReportRow[];
  passed: number;
  failed: number;
}

/** 某个时区此刻的 getTimezoneOffset 语义值（UTC − 本地，分钟） */
export function offsetMinutesAt(timeZone: string, at: Date = new Date()): number | null {
  try {
    const parts: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(at)) {
      parts[part.type] = part.value;
    }
    const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return Math.round((Math.floor(at.getTime() / 1000) * 1000 - asUTC) / 60000);
  } catch {
    return null;
  }
}

function distanceMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const formatOffset = (minutes: number): string => {
  const hours = -minutes / 60;
  return `UTC${hours >= 0 ? '+' : ''}${Number.isInteger(hours) ? hours : hours.toFixed(2)}`;
};

export function buildProbeReport(
  config: SiteSpoofConfig,
  url: string,
  lastLocation: LastLocation | null,
  native: NativeBaseline,
  probe: ProbeSnapshot,
  now: Date = new Date()
): ProbeReport {
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* 非法地址按未命中处理 */ }
  const profile = getEffectiveProfile(config, hostname, lastLocation);
  const payload = profile.matched ? profile.payload : null;
  const spoofed = Boolean(payload);

  const scope = !config.masterEnabled
    ? '总开关已关闭：所有站点都应显示浏览器原生值'
    : profile.excluded
      ? `${hostname} 被排除规则命中：应显示浏览器原生值`
      : !profile.matched
        ? `${hostname} 不在规则里：应显示浏览器原生值`
        : !payload
          ? `${hostname} 命中规则 ${profile.rule?.domain}，但没有可生效的伪装项：应显示原生值`
          : `${hostname} 命中规则 ${profile.rule?.domain}`;

  const rows: ReportRow[] = [];
  const compare = (group: string, label: string, expected: string, actual: string, equal: (a: string, b: string) => boolean = (a, b) => a === b) => {
    rows.push({ group, label, expected, actual, status: equal(expected, actual) ? 'ok' : 'bad' });
  };
  const sameLanguage = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  // ---- 时区：解析不出来（auto 还没拿到出口位置）时页面保持原生 ----
  const timezone = (payload && payload.timezone) || native.timezone;
  const timezoneNote = payload && !payload.timezone ? '（未取得目标时区，保持原生）' : '';
  compare('时区', 'Intl 时区', timezone + timezoneNote, probe.timezone, (a, b) => a.replace(timezoneNote, '') === b);
  const offset = offsetMinutesAt(timezone, now);
  if (offset !== null) {
    rows.push({
      group: '时区',
      label: 'Date 偏移（getTimezoneOffset）',
      expected: `${offset}（${formatOffset(offset)}）`,
      actual: `${probe.offsetMinutes}（${formatOffset(probe.offsetMinutes)}）`,
      status: offset === probe.offsetMinutes ? 'ok' : 'bad'
    });
  }
  if (probe.temporalTimeZone !== null) {
    compare('时区', 'Temporal.Now.timeZoneId()', timezone, probe.temporalTimeZone);
  }

  // ---- 语言：语言层没开时页面保持原生 ----
  const languageConfig = payload && payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
  const language = languageConfig ? languageConfig.language : native.language;
  const languages = languageConfig
    ? (languageConfig.languages.length ? languageConfig.languages : [languageConfig.language])
    : native.languages;
  compare('语言', 'navigator.language', language, probe.language, sameLanguage);
  compare('语言', 'navigator.languages', languages.join(', '), probe.languages.join(', '), sameLanguage);
  compare('语言', 'Intl 默认 locale', language, probe.locale, sameLanguage);

  // ---- 定位 ----
  const geo = probe.geolocation;
  if (payload && payload.geolocationDenied) {
    rows.push({
      group: '定位',
      label: 'getCurrentPosition',
      expected: '拒绝（坐标解析不出来，fail-closed）',
      actual: geo.coords ? `${geo.coords.latitude}, ${geo.coords.longitude}` : (geo.error || `未读取（权限 ${geo.permission}）`),
      status: geo.coords ? 'bad' : 'ok'
    });
  } else if (payload && payload.geolocation) {
    const target = payload.geolocation;
    if (!geo.coords) {
      rows.push({
        group: '定位',
        label: '坐标',
        expected: `${target.latitude}, ${target.longitude}`,
        actual: geo.error || `未读取：页面权限为 ${geo.permission}（不弹授权框，故跳过）`,
        status: 'skip'
      });
    } else {
      // 随机偏移是 Rayleigh 分布、没有硬边界：容差取半径的 4 倍；不随机时只容许浮点误差
      const tolerance = target.randomize ? Math.max(1000, target.randomRadiusMeters * 4) : 50;
      const distance = distanceMeters(target.latitude, target.longitude, geo.coords.latitude, geo.coords.longitude);
      rows.push({
        group: '定位',
        label: '坐标',
        expected: `${target.latitude}, ${target.longitude}${target.randomize ? `（随机偏移 ~${target.randomRadiusMeters}m）` : ''}`,
        actual: `${geo.coords.latitude.toFixed(5)}, ${geo.coords.longitude.toFixed(5)}（相距 ${Math.round(distance)}m）`,
        status: distance <= tolerance ? 'ok' : 'bad'
      });
    }
  } else {
    rows.push({
      group: '定位',
      label: '坐标',
      expected: '原生（不接管定位）',
      actual: geo.coords ? `${geo.coords.latitude.toFixed(5)}, ${geo.coords.longitude.toFixed(5)}` : (geo.error || `未读取（权限 ${geo.permission}）`),
      status: 'skip'
    });
  }

  // ---- WebRTC：网页能否看到本机真实 IP ----
  if (probe.webrtc) {
    // 字面 IP（IPv4 / IPv6）即暴露；`xxx.local` 是 Chrome 的 mDNS 匿名名，不算
    const exposed = probe.webrtc.candidates.filter((address) => /^[\d.]+$|:/.test(address));
    rows.push({
      group: 'WebRTC',
      label: 'ICE 候选（网页可见的本机地址）',
      expected: '不暴露本机 IP（无候选，或仅 .local 匿名地址）',
      actual: probe.webrtc.error
        ? probe.webrtc.error
        : (probe.webrtc.candidates.length ? [...new Set(probe.webrtc.candidates)].join(', ') : '无候选'),
      status: probe.webrtc.error ? 'skip' : (exposed.length ? 'bad' : 'ok')
    });
  }

  // ---- 自带对错的检查（反检测、字体） ----
  // 字体伪装没开时，页面能量出本机字体本来就是正常现象，这一组不参与判定
  const canvasOn = Boolean(payload && payload.canvasConfig && payload.canvasConfig.enabled);
  for (const check of probe.checks) {
    if (check.group === '字体' && !canvasOn) continue;
    rows.push({
      group: check.group,
      label: check.label,
      expected: check.ok === null ? '-' : '通过',
      actual: check.value,
      status: check.ok === null ? 'skip' : (check.ok ? 'ok' : 'bad')
    });
  }

  return {
    hostname,
    spoofed,
    scope,
    rows,
    passed: rows.filter((row) => row.status === 'ok').length,
    failed: rows.filter((row) => row.status === 'bad').length
  };
}
