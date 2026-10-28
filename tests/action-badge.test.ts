import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveActionBadge } from '../src/shared/action-badge';
import { createRule, normalizeConfig, normalizeLanguage, normalizeTimezone, normalizeGeolocation } from '../src/shared/config-model';
import type { RuntimeSyncReport } from '../src/shared/types';

const config = () => normalizeConfig({ masterEnabled: true, rules: [createRule('example.test')],
  globalProfile: { language: normalizeLanguage({ enabled: true, language: 'en-US', languages: ['en-US'] }),
    timezone: normalizeTimezone({ enabled: false }), geolocation: normalizeGeolocation({ enabled: false }) } });
const report = (): RuntimeSyncReport => ({ configSignature: 'synthetic', status: 'ok', metadataError: null,
  components: { contentScripts: { status: 'ok', errors: [] }, webrtc: { status: 'ok', errors: [] },
    headers: { status: 'ok', errors: [] }, tabReload: { status: 'ok', errors: [] } },
  pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false } });

test('故障角标区分失败、需重载和未知，注册成功不宣称网页已生效', () => {
  const value = config();
  assert.equal(deriveActionBadge(value, 'https://example.test/').text, '?');
  const ready = report();
  assert.equal(deriveActionBadge(value, 'https://example.test/', ready).text, '');
  assert.match(deriveActionBadge(value, 'https://example.test/', ready).title, /实际效果尚未验证/);
  ready.pageRuntime!.reloadRequired = true;
  assert.equal(deriveActionBadge(value, 'https://example.test/', ready).text, '↻');
  ready.pageRuntime!.state = 'switch-required';
  ready.pageRuntime!.reloadRequired = false;
  assert.equal(deriveActionBadge(value, 'https://example.test/', ready).text, '!');
  assert.equal(deriveActionBadge(value, 'https://unmatched.test/', ready).text, '');
  ready.fontRuntime = { state: 'ready', registeredRuleCount: 1, reloadRequired: true };
  assert.equal(deriveActionBadge(value, 'https://unmatched.test/', ready).text, '↻');
  value.globalProfile.language.enabled = false;
  value.globalProfile.timezone.enabled = true;
  value.globalProfile.timezone.mode = 'auto';
  assert.equal(deriveActionBadge(value, 'https://example.test/', ready).text, '!');
});

test('总开关关闭但策略未释放仍显示故障；WebRTC全局失败也不被未匹配站点遮蔽', () => {
  const value = config(); value.masterEnabled = false;
  const failed = report(); failed.status = 'failed';
  failed.components.webrtc = { status: 'failed', errors: [{ code: 'synthetic', message: '合成失败' }] };
  assert.equal(deriveActionBadge(value, 'https://example.test/', failed).text, '!');
  assert.equal(deriveActionBadge(value, 'chrome://extensions/', failed).text, '!');
  assert.equal(deriveActionBadge(value, 'https://example.test/', report()).text, '');
});
