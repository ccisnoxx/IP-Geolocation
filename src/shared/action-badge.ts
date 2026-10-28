import { getPageRuntimeProfile } from './config-resolver';
import { deriveCurrentSiteStatus } from './ui-state';
import type { RuntimeSyncReport, SiteSpoofConfig } from './types';

export function deriveActionBadge(config: SiteSpoofConfig, url: string, report?: RuntimeSyncReport) {
  const parsed = new URL(url);
  const domain = /^https?:$/.test(parsed.protocol) ? parsed.hostname : '';
  const status = deriveCurrentSiteStatus({ config, domain, scriptable: Boolean(domain),
    ...getPageRuntimeProfile(config, domain), syncReport: report });
  if (report && report.components.webrtc.status !== 'ok') return {
    text: '!', color: '#b91c1c', title: 'VanishGeo · WebRTC 策略同步未完成'
  };
  if (!domain) return {
    text: '', color: '#64748b', title: `VanishGeo · ${status.label}`
  };
  if (report && report.status !== 'ok') return { text: '!', color: '#b91c1c', title: 'VanishGeo · 运行时同步未完成，请打开扩展查看详情' };
  if (['error', 'partial', 'paused', 'runtime-unavailable'].includes(status.kind)) return {
    text: '!', color: '#b91c1c', title: `VanishGeo · ${status.label}`
  };
  // 顶层未匹配也可能嵌入受影响 iframe；规则移除后的旧文档同样必须提示重载。
  if (report?.pageRuntime?.reloadRequired || report?.fontRuntime?.reloadRequired || report?.geolocationRuntime?.reloadRequired) return {
    text: '↻', color: '#a16207', title: 'VanishGeo · 此标签页需完整重载以应用当前配置'
  };
  if (['not-allowlisted', 'unsupported'].includes(status.kind)) return {
    text: '', color: '#64748b', title: `VanishGeo · ${status.label}`
  };
  if (status.kind === 'unknown') return { text: '?', color: '#64748b', title: 'VanishGeo · 同步状态尚未确认' };
  return { text: '', color: '#64748b', title: `VanishGeo · ${status.label}；网页实际效果尚未验证` };
}
