import test from 'node:test';
import assert from 'node:assert/strict';
import { auditConfig, applyConfigAuditFix } from '../src/shared/config-audit';
import { createRule, normalizeConfig, normalizeLanguage, normalizeTimezone, normalizeGeolocation } from '../src/shared/config-model';

test('体检使用现有解析器报告未绑定的自动信号，native 与禁用规则不误报', () => {
  const config = normalizeConfig({ masterEnabled: true, rules: [createRule('example.test')] });
  assert.ok(auditConfig(config).some(finding => finding.id === `rule:${config.rules[0].id}`));
  config.rules[0].compatibilityPreset = 'native';
  assert.equal(auditConfig(config).filter(finding => finding.severity === 'error').length, 0);
  config.rules[0].compatibilityPreset = 'full';
  config.rules[0].enabled = false;
  assert.equal(auditConfig(config).filter(finding => finding.severity === 'error').length, 0);
});

test('体检修复只改指定字段，不修改输入、规则、verified档案或其他选项', () => {
  const config = normalizeConfig({ debugMode: true });
  config.globalProfile.timezone = normalizeTimezone({ enabled: false, mode: 'manual', timezone: 'UTC' });
  const before = structuredClone(config);
  const next = applyConfigAuditFix(config, 'timezone-off');
  assert.equal(next.globalProfile.timezone.enabled, true);
  assert.deepEqual({ ...next, globalProfile: config.globalProfile }, config);
  assert.deepEqual({ ...next.globalProfile, timezone: config.globalProfile.timezone }, config.globalProfile);
  assert.deepEqual(config, before);
  assert.equal(auditConfig(config).find(finding => finding.id === 'timezone-off')?.severity, 'info');
  assert.throws(() => applyConfigAuditFix(next, 'timezone-off'), /已变化/);
});

test('经度体检按24小时环比较，不把日期线附近的相邻时区误报为跨洲', () => {
  const config = normalizeConfig({ masterEnabled: true, rules: [createRule('example.test')],
    globalProfile: { language: normalizeLanguage({ enabled: true, language: 'en-US', languages: ['en-US'] }),
      timezone: normalizeTimezone({ enabled: true, mode: 'manual', timezone: 'Pacific/Kiritimati' }),
      geolocation: normalizeGeolocation({ enabled: true, mode: 'manual', latitude: 0, longitude: -150, accuracy: 50 }) } });
  assert.equal(auditConfig(config).some(finding => finding.id.startsWith('region:')), false);
  config.globalProfile.timezone.timezone = 'Asia/Tokyo';
  config.globalProfile.geolocation.longitude = 0;
  assert.equal(auditConfig(config).find(finding => finding.id.startsWith('region:'))?.severity, 'info');
});
