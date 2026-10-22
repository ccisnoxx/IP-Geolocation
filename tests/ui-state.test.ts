// 验证 Popup 当前站点状态只依赖共享解析器产生的匹配结果和有效 payload。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageRuntimeProfile } from '../src/shared/config-resolver';
import { normalizeConfig, createInitialConfig } from '../src/shared/config-model';
import { RUNTIME_INJECTION_PAUSED } from '../src/shared/runtime-sync';
import type { RuntimeSyncReport } from '../src/shared/types';
import { deriveCurrentSiteStatus, deriveSetupStatus } from '../src/shared/ui-state';

function readyReport(): RuntimeSyncReport {
  const ok = () => ({ status: 'ok' as const, errors: [] });
  return { configSignature: 'synthetic', status: 'ok', metadataError: null,
    components: { contentScripts: ok(), legacyDnrCleanup: ok(), webrtc: ok(), tabReload: ok() },
    pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false } };
}

test('共享配置状态区分未配置、部分配置、配置完成关闭和已启用，关闭时也识别无效绑定', () => {
  assert.equal(deriveSetupStatus(createInitialConfig()).kind, 'unconfigured');
  const config = createConfig();
  assert.equal(deriveSetupStatus({ ...config, rules: [] }).kind, 'partial');
  assert.equal(deriveSetupStatus({ ...config, masterEnabled: false }).kind, 'ready');
  assert.equal(deriveSetupStatus(config).kind, 'enabled');
  config.rules[0].exitLocationProfileId = null;
  assert.equal(deriveSetupStatus({ ...config, masterEnabled: false }).kind, 'partial');
  assert.equal(deriveSetupStatus(config).kind, 'partial');
});

function createConfig() {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: false },
      timezone: { enabled: true, mode: 'auto' },
      geolocation: { enabled: true, mode: 'auto' }
    } as any,
    exitLocationProfiles: [{
      id: 'exit-home',
      name: '家宽出口',
      verification: 'verified',
      publicIp: '203.0.113.10',
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: 'Asia/Tokyo',
      provider: 'https://ipwho.is/',
      verifiedAt: 1_752_551_200_000
    }],
    rules: [{
      id: 'rule-example',
      domain: 'example.com',
      enabled: true,
      exitLocationProfileId: 'exit-home'
    }] as any
  });
}

test('deriveCurrentSiteStatus differentiates unsupported, disabled, unmatched, enabled, and error states', () => {
  const config = createConfig();
  const resolved = getPageRuntimeProfile(config, 'example.com');
  const base = {
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved,
    syncReport: readyReport()
  };

  assert.equal(deriveCurrentSiteStatus({ ...base, scriptable: false }).kind, 'unsupported');
  assert.equal(deriveCurrentSiteStatus({
    ...base,
    config: normalizeConfig({ ...config, masterEnabled: false })
  }).kind, 'global-disabled');
  assert.equal(deriveCurrentSiteStatus({
    ...base,
    matched: false,
    rule: null,
    payload: null,
    errors: []
  }).kind, 'not-allowlisted');
  assert.equal(deriveCurrentSiteStatus(base).kind, 'enabled');
  assert.equal(deriveCurrentSiteStatus(base).label, '新文档语言/时区可用');
  assert.match(deriveCurrentSiteStatus(base).detail, /当前页面实际值尚未验证/);
  assert.equal(deriveCurrentSiteStatus(base).disableDomain, 'example.com');
});

test('an automatic rule without an explicit exit profile is surfaced as a configuration error', () => {
  const config = createConfig();
  config.rules[0].exitLocationProfileId = null;
  const resolved = getPageRuntimeProfile(config, 'example.com');
  const status = deriveCurrentSiteStatus({
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved
  });

  assert.equal(status.kind, 'error');
  assert.match(status.detail, /未选择出口位置档案/);
  assert.equal(status.canDisable, true);
});

test('an unverified selected profile cannot produce an enabled runtime state', () => {
  const config = createConfig();
  config.exitLocationProfiles[0].verification = 'unverified';
  config.exitLocationProfiles[0].publicIp = null;
  config.exitLocationProfiles[0].provider = null;
  config.exitLocationProfiles[0].verifiedAt = null;
  const resolved = getPageRuntimeProfile(config, 'example.com');
  const status = deriveCurrentSiteStatus({
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved
  });

  assert.equal(status.kind, 'error');
  assert.match(status.detail, /尚未验证/);
});

test('暂停报告不会把已匹配站点显示为页面伪装生效，规则操作仍可用', () => {
  const config = createConfig();
  const ok = { status: 'ok' as const, errors: [] };
  const syncReport: RuntimeSyncReport = { configSignature: 'synthetic', status: 'partial', metadataError: null,
    components: { contentScripts: { status: 'partial', errors: [RUNTIME_INJECTION_PAUSED] }, legacyDnrCleanup: ok, webrtc: ok, tabReload: ok } };
  const state = deriveCurrentSiteStatus({ domain: 'example.com', scriptable: true, config,
    ...getPageRuntimeProfile(config, 'example.com'), syncReport });
  assert.equal(state.kind, 'paused');
  assert.equal(state.label, '页面伪装已暂停');
  assert.equal(state.canEnable, false);
  assert.equal(state.canDisable, true);
  assert.match(state.detail, /旧请求头规则清理与 WebRTC 请查看同步详情/);
});

test('暂停的 auto 地理位置不阻断语言/手工时区配置，旧报告也不能覆盖新注册状态', () => {
  const config = createConfig();
  config.rules[0].exitLocationProfileId = null;
  config.globalProfile.timezone = { enabled: true, mode: 'manual', timezone: 'UTC' };
  config.globalProfile.language.enabled = true;
  assert.equal(deriveSetupStatus(config).kind, 'enabled');
  const syncReport = readyReport();
  syncReport.components.contentScripts.errors = [RUNTIME_INJECTION_PAUSED];
  const state = deriveCurrentSiteStatus({ domain: 'example.com', scriptable: true, config,
    ...getPageRuntimeProfile(config, 'example.com'), syncReport });
  assert.equal(state.kind, 'enabled');
  assert.doesNotMatch(state.detail, /页面伪装已暂停/);
  assert.match(state.detail, /Geolocation \/ Permissions geolocation、字体暴露过滤、Worker \/ SharedWorker 仍暂停/);
});

test('当前站点分别显示 API、权限、Allow User Scripts、同步失败与完整重载状态', () => {
  const config = createConfig();
  const base = { domain: 'example.com', scriptable: true, config, ...getPageRuntimeProfile(config, 'example.com') };
  assert.equal(deriveCurrentSiteStatus(base).kind, 'unknown');
  for (const [state, label] of [
    ['api-unsupported', '浏览器不支持 userScripts'],
    ['permission-required', '缺少 userScripts 权限'],
    ['switch-required', '请开启 Allow User Scripts'],
    ['sync-failed', '页面语言/时区同步失败']
  ] as const) {
    const syncReport = readyReport();
    syncReport.pageRuntime!.state = state;
    const status = deriveCurrentSiteStatus({ ...base, syncReport });
    assert.equal(status.kind, 'runtime-unavailable');
    assert.equal(status.label, label);
    assert.match(status.detail, /当前页面实际值为 UNKNOWN/);
    assert.equal(status.canDisable, true);
    const disabled = deriveCurrentSiteStatus({ ...base, config: { ...config, masterEnabled: false }, syncReport });
    assert.match(disabled.detail, /当前页面实际值为 UNKNOWN/);
    assert.doesNotMatch(disabled.detail, /完整重载（reload）或关闭后重新打开/);
    if (state === 'switch-required') assert.match(status.detail, /chrome:\/\/extensions.*详情页.*重试同步/);
  }
  const syncReport = readyReport();
  syncReport.pageRuntime!.reloadRequired = true;
  const reload = deriveCurrentSiteStatus({ ...base, syncReport });
  assert.equal(reload.kind, 'reload-required');
  assert.match(reload.detail, /完整重载（reload）或关闭后重新打开/);
  assert.match(reload.detail, /BFCache 恢复文档保留原快照/);
  const unsupported = deriveCurrentSiteStatus({ ...base, scriptable: false, syncReport });
  assert.equal(unsupported.kind, 'unsupported');
  assert.match(unsupported.detail, /about:blank、srcdoc、data:、blob:.*sandbox.*unsupported \/ UNKNOWN/);
});

test('仅保存暂停表面或关闭语言/时区时，不把匹配规则显示为新文档语言/时区可用', () => {
  const config = createConfig();
  config.globalProfile.timezone.enabled = false;
  const status = deriveCurrentSiteStatus({ domain: 'example.com', scriptable: true, config,
    ...getPageRuntimeProfile(config, 'example.com'), syncReport: readyReport() });
  assert.equal(status.kind, 'disabled');
  assert.equal(status.label, '当前规则未启用语言/时区');
});
