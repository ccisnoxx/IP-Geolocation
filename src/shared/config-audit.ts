import { getTimezoneOffsetMinutes, normalizeConfig } from './config-model';
import { getEffectiveProfile } from './config-resolver';
import type { SiteSpoofConfig } from './types';

export interface ConfigAuditFinding {
  id: string;
  severity: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  fix?: { label: string; apply(config: SiteSpoofConfig): void };
}

// 仅分析扩展已有配置；站点实际值仍由独立诊断采集。
export function auditConfig(config: SiteSpoofConfig, at = new Date()): ConfigAuditFinding[] {
  const findings: ConfigAuditFinding[] = [];
  const enabled = config.rules.filter(rule => rule.enabled);
  if (config.masterEnabled && !enabled.length) findings.push({ id: 'no-sites', severity: 'warn',
    title: '尚未选择启用站点', detail: '总开关已开启，但没有启用的域名规则。请在完整配置中选择站点。' });
  if (!config.masterEnabled) findings.push({ id: 'master-off', severity: 'info',
    title: '总开关已关闭', detail: '保存的配置保留；当前不请求启用保护。同步与旧文档状态请查看运行时报告。' });
  const preview = { ...config, masterEnabled: true };
  for (const rule of enabled) {
    const resolved = getEffectiveProfile(preview, rule.domain);
    if (resolved.errors.length) findings.push({ id: `rule:${rule.id}`, severity: 'error',
      title: `${rule.domain} 的信号尚未就绪`, detail: resolved.errors.join('；') });
    const payload = resolved.payload;
    if (!payload?.timezone || !payload.geolocation) continue;
    const offset = getTimezoneOffsetMinutes(payload.timezone, at);
    if (offset === null) continue;
    const distance = Math.abs(-offset / 60 - payload.geolocation.longitude / 15) % 24;
    if (Math.min(distance, 24 - distance) > 4) findings.push({ id: `region:${rule.id}`, severity: 'info',
      title: `${rule.domain} 的时区与经度跨度较大`,
      detail: '按经度估算的太阳时与配置时区相差超过四小时。这只是核对提示，行政时区和用途可能不同；不会自动修改坐标或语言。' });
  }
  const { timezone, geolocation } = config.globalProfile;
  if (!timezone.enabled && timezone.mode === 'manual' && timezone.timezone) findings.push({ id: 'timezone-off', severity: 'info',
    title: '已填写的手动时区处于关闭状态', detail: '关闭可以是有意选择；只有点击下面按钮才会启用。',
    fix: { label: '启用已填写的时区', apply(current) { current.globalProfile.timezone.enabled = true; } } });
  if (!geolocation.enabled && geolocation.mode === 'manual' && geolocation.latitude !== null && geolocation.longitude !== null) findings.push({
    id: 'geolocation-off', severity: 'info', title: '已填写的手动定位处于关闭状态',
    detail: '关闭可以是有意选择；启用后按当前定位合同返回配置坐标。',
    fix: { label: '启用已填写的定位', apply(current) { current.globalProfile.geolocation.enabled = true; } } });
  if (config.debugMode) findings.push({ id: 'debug-mode', severity: 'info', title: '调试模式已开启',
    detail: '调试输出可能出现在控制台或录屏中。',
    fix: { label: '关闭调试模式', apply(current) { current.debugMode = false; } } });
  return findings;
}

// 后台在配置事务内重新分析最新配置，避免旧报告修复覆盖并发保存。
export function applyConfigAuditFix(config: SiteSpoofConfig, id: string): SiteSpoofConfig {
  const finding = auditConfig(config).find(item => item.id === id);
  if (!finding?.fix) throw new Error('这项提示已变化或没有自动修复，请刷新配置体检。');
  const next = normalizeConfig(config);
  finding.fix.apply(next);
  return next;
}
