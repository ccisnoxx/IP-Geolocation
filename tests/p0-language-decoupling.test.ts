// P0 回归：语言只取决于语言配置，时区/定位解析失败不得把请求头和页面语言一起停掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveLanguage,
  getLanguageTimezonePayload,
  getPageRuntimeProfile
} from '../src/shared/config-resolver';
import { compileHeaderRules } from '../src/background/header-rules';
import { createRule, getAcceptLanguageValue, normalizeConfig } from '../src/shared/config-model';
import { deriveCurrentSiteStatus } from '../src/shared/ui-state';
import { RUNTIME_INJECTION_PAUSED } from '../src/shared/runtime-sync';
import type { RuntimeSyncReport } from '../src/shared/types';

function config(overrides: Record<string, unknown> = {}) {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: true, mode: 'custom', language: 'en-US', languages: ['en-US', 'en'] },
      // 时区/定位都还是 auto，但不绑任何出口档案 —— 这就是"解析不出来"的场景
      timezone: { enabled: true, mode: 'auto' },
      geolocation: { enabled: true, mode: 'auto' }
    } as any,
    rules: [createRule('example.test')],
    ...overrides
  });
}

test('时区拿不到出口档案时，语言依旧可用（不再被连坐）', () => {
  const value = config();
  const resolved = getPageRuntimeProfile(value, 'example.test');
  // 时区确实没解析出来：payload 里 timezone 为空，errors 说明原因
  assert.equal(resolved.payload?.timezone, null);
  assert.ok(resolved.errors.length > 0);
  assert.ok(resolved.errors.some((item) => item.includes('出口位置档案')));
  // 语言照旧注入
  assert.equal(resolved.payload?.languageConfig?.language, 'en-US');
  assert.deepEqual(getEffectiveLanguage(value, 'example.test')?.languages, ['en-US', 'en']);
});

test('请求头与页面语言来自同一份语言解析，部分生效时仍然一致', () => {
  const value = config();
  const resolved = getPageRuntimeProfile(value, 'example.test');
  const header = compileHeaderRules(value)[0].action.requestHeaders![0];
  const pageLanguages = resolved.payload!.languageConfig!.languages;
  assert.equal(header.header.toLowerCase(), 'accept-language');
  assert.equal(header.value, getAcceptLanguageValue(pageLanguages));
  // 简写 payload 同样带着语言，注入层据此只装语言补丁
  assert.deepEqual(getLanguageTimezonePayload(value, 'example.test'), {
    intlMode: resolved.payload!.intlMode,
    language: { language: 'en-US', languages: ['en-US', 'en'] }
  });
});

test('语言本身关闭时不放行任何东西（部分生效不等于放宽配置）', () => {
  const value = config();
  value.globalProfile.language.enabled = false;
  const resolved = getPageRuntimeProfile(value, 'example.test');
  assert.equal(resolved.payload, null);
  assert.ok(resolved.errors.length > 0);
  assert.deepEqual(compileHeaderRules(value), []);
  assert.equal(getEffectiveLanguage(value, 'example.test'), null);
});

test('native 预设仍然什么都不加，包括请求头', () => {
  const value = config();
  value.rules[0].compatibilityPreset = 'native';
  assert.equal(getEffectiveLanguage(value, 'example.test'), null);
  assert.deepEqual(compileHeaderRules(value), []);
});

test('部分生效在弹窗里必须说清"已应用什么、为什么没生效"，不能笼统报配置不完整', () => {
  const value = config();
  const resolved = getPageRuntimeProfile(value, 'example.test');
  const status = deriveCurrentSiteStatus({
    domain: 'example.test',
    scriptable: true,
    config: value,
    ...resolved,
    syncReport: { configSignature: 'synthetic', status: 'ok', metadataError: null,
      components: { contentScripts: { status: 'ok', errors: [] }, webrtc: { status: 'ok', errors: [] }, tabReload: { status: 'ok', errors: [] } },
      pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false } } as any
  });
  assert.equal(status.kind, 'partial');
  assert.ok(status.label.includes('语言'));
  assert.ok(status.detail.includes('可用配置：语言'));
  assert.ok(status.detail.includes('出口位置档案'));
});

test('部分配置不能遮蔽页面注册故障、暂停或重载欠账，也不能假定请求头已同步', () => {
  const value = config();
  const base = { domain: 'example.test', scriptable: true, config: value, ...getPageRuntimeProfile(value, 'example.test') };
  const ok = { status: 'ok' as const, errors: [] };
  const ready = (): RuntimeSyncReport => ({ configSignature: 'synthetic', status: 'ok', metadataError: null,
    components: { contentScripts: ok, webrtc: ok, tabReload: ok },
    pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false } });
  assert.equal(deriveCurrentSiteStatus(base).kind, 'unknown');
  for (const state of ['api-unsupported', 'permission-required', 'switch-required', 'sync-failed', 'disabled'] as const) {
    const report = ready();
    report.pageRuntime!.state = state;
    const status = deriveCurrentSiteStatus({ ...base, syncReport: report });
    assert.equal(status.kind, state === 'disabled' ? 'disabled' : 'runtime-unavailable', state);
    assert.doesNotMatch(status.detail, /已应用|请求头与页面语言保持一致/);
  }
  const paused = ready();
  delete paused.pageRuntime;
  paused.components.contentScripts = { status: 'partial', errors: [RUNTIME_INJECTION_PAUSED] };
  assert.equal(deriveCurrentSiteStatus({ ...base, syncReport: paused }).kind, 'paused');
  const reload = ready();
  reload.pageRuntime!.reloadRequired = true;
  assert.equal(deriveCurrentSiteStatus({ ...base, syncReport: reload }).kind, 'reload-required');
  const missingHeaders = deriveCurrentSiteStatus({ ...base, syncReport: ready() });
  assert.match(missingHeaders.detail, /请求头同步待确认/);
  const failedHeaders = ready();
  failedHeaders.components.headers = { status: 'failed', errors: [{ code: 'synthetic', message: '合成同步失败' }] };
  const failed = deriveCurrentSiteStatus({ ...base, syncReport: failedHeaders });
  assert.match(failed.detail, /请求头同步未完成/);
  assert.doesNotMatch(failed.detail, /已应用|请求头与页面语言保持一致/);
});
