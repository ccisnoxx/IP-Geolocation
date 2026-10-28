import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialConfig, createRule, normalizeConfig } from '../src/shared/config-model';
import { getEffectiveProfile, getGeolocationPayload, getLanguageTimezonePayload, validateConfig, migrateLegacyConfig } from '../src/shared/config-resolver';
import { compilePageScripts, compileGeolocationScripts } from '../src/background/page-scripts';
import { compileFontScripts } from '../src/background/font-scripts';
import { compileHeaderRules } from '../src/background/header-rules';
import { rulesFromText } from '../src/shared/rule-list';
import type { CompatibilityPreset } from '../src/shared/types';

function config() {
  const value = createInitialConfig();
  value.masterEnabled = true;
  value.globalProfile.language = { enabled: true, mode: 'custom', language: 'fr-FR', languages: ['fr-FR', 'fr'] };
  value.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'UTC' };
  value.globalProfile.geolocation = { ...value.globalProfile.geolocation, enabled: true, mode: 'manual', latitude: 0, longitude: 0 };
  value.fontExposure.enabled = true;
  value.rules = [createRule('example.com'), createRule('child.example.com'), createRule('deep.child.example.com')];
  return value;
}

test('预设裁剪所有派生效果，保留覆盖设置且可切回 full', () => {
  const value = config();
  const advanced = structuredClone(value.rules[0].overrides);
  for (const preset of ['native', 'consistency', 'full'] as CompatibilityPreset[]) {
    value.rules[0].compatibilityPreset = preset;
    assert.equal(Boolean(getLanguageTimezonePayload(value, 'example.com')), preset !== 'native');
    assert.equal(Boolean(getGeolocationPayload(value, 'example.com')), preset === 'full');
    assert.equal(compilePageScripts(value, 'function(){}').some(item => item.id.endsWith('-example.com')), preset !== 'native');
    assert.equal(compileGeolocationScripts(value, 'function(){}').some(item => item.id.endsWith('-example.com')), preset === 'full');
    assert.equal(compileFontScripts(value).some(item => item.id.endsWith('-example.com')), preset === 'full');
    assert.equal(compileHeaderRules(value).some(item => item.condition.requestDomains?.includes('example.com')), preset !== 'native');
    assert.deepEqual(value.rules[0].overrides, advanced);
    if (preset !== 'native') assert.equal(getEffectiveProfile(value, 'example.com').payload?.fontExposureConfig.enabled, preset === 'full');
  }
});

test('native/consistency 子规则排除父脚本及 DNR；更具体 full 和兄弟域仍可启用', () => {
  for (const preset of ['native', 'consistency'] as const) {
    const value = config(); value.rules[1].compatibilityPreset = preset;
    const fonts = compileFontScripts(value);
    assert.equal(fonts.length, 2);
    assert.ok(fonts.find(item => item.id.endsWith('-example.com'))?.excludeMatches?.includes('*://child.example.com/*'));
    const pages = compilePageScripts(value, 'function(){}');
    assert.ok(pages.find(item => item.id.endsWith('-example.com'))?.excludeMatches?.includes('*://child.example.com/*'));
    assert.equal(getGeolocationPayload(value, 'other.child.example.com'), null);
    assert.ok(getGeolocationPayload(value, 'sibling.example.com'));
    assert.ok(getGeolocationPayload(value, 'deep.child.example.com'));
    assert.ok(compileHeaderRules(value).find(item => item.condition.requestDomains?.includes('example.com'))?.condition.excludedRequestDomains?.includes('child.example.com'));
  }
});

test('旧配置缺省 full；严格校验枚举；导入迁移和规则文本往返保留预设', () => {
  const value = config(); delete value.rules[0].compatibilityPreset;
  assert.equal(normalizeConfig(value).rules[0].compatibilityPreset, 'full');
  assert.equal(migrateLegacyConfig({ siteSpoofConfig: value }).rules[0].compatibilityPreset, 'full');
  value.rules[0].compatibilityPreset = 'consistency';
  assert.equal(rulesFromText('example.com', value.rules)[0].compatibilityPreset, 'consistency');
  assert.equal(validateConfig({ ...value, rules: [{ ...value.rules[0], compatibilityPreset: 'invalid' }] }).ok, false);
});

test('预设不启用已关闭信号，全部关闭无注册，不改变浏览器全局 WebRTC', () => {
  const value = config(); value.rules = [value.rules[0]];
  value.rules[0].compatibilityPreset = 'consistency';
  value.globalProfile.language.enabled = false; value.globalProfile.timezone.enabled = false;
  assert.deepEqual(compilePageScripts(value, 'function(){}'), []);
  assert.deepEqual(compileHeaderRules(value), []);
  assert.deepEqual(compileGeolocationScripts(value, 'function(){}'), []);
  assert.deepEqual(compileFontScripts(value), []);
  value.webRtc.globalMode = 'strict'; value.rules[0].compatibilityPreset = 'native';
  assert.equal(normalizeConfig(value).webRtc.globalMode, 'strict');
  value.masterEnabled = false;
  assert.deepEqual(compilePageScripts(value, 'function(){}'), []);
});
