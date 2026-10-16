import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvidence, decideAcceptance, networkChecks, phases, scenarioDefinitions } from './acceptance.mjs';

// 构造完整、合成的通过报告，只用于验证验收门禁；不作为浏览器证据。
function completeReport() {
  const evidence = createEvidence();
  Object.assign(evidence.environment, { realChrome: true, chromeVersion: '138.0.0.0', apiAvailable: true, allowUserScripts: true });
  evidence.environment.chromeSandbox = { status: 'PASS', layerOne: true, pidNamespaces: true, networkNamespaces: true, seccompBpf: true, adequate: true };
  evidence.environment.allowUserScriptsUiState = 'ENABLED';
  evidence.environment.userScriptsSwitch = { method: 'Chrome-extension-details-trusted-pointer', before: false, apiBefore: false, after: true };
  for (const key of ['register', 'update', 'narrowUpdate', 'unregister']) evidence.mechanism[key] = 'PASS';
  evidence.network = { status: 'PASS', policyApplied: true, checks: Object.fromEntries(networkChecks.map(key => [key, 'PASS'])) };
  evidence.production = { status: 'PASS', unchanged: 'PASS', pauseGate: 'PASS' };
  evidence.cleanup.status = 'PASS';
  for (const row of evidence.scenarios) {
    row.status = 'PASS';
    row.phases = Object.fromEntries(phases.map(phase => [phase, 'PASS']));
    const native = '<native-control>';
    const values = row.id === 'F-history-back' || ['C-reload-B', 'C-new-tab-B', 'E-narrow-inside', 'D-existing-B'].includes(row.id)
      ? ['x-vg-b', 'x-vg-b'] : ['B-register-A', 'B-broad-subpath', 'C-existing-A'].includes(row.id)
        ? ['x-vg-a', 'x-vg-a'] : ['E-narrow-outside', 'E-narrow-near-miss'].includes(row.id)
          ? [native, 'x-vg-b'] : [native, native];
    row.actual = { independentDocuments: true, sameDocuments: true, newDocuments: true, sameURL: true,
      restoredOriginalDocument: false, childRestoredOriginalDocument: false,
      pageshowPersisted: false, childPageshowPersisted: false, bfcacheObserved: false,
      frames: ['top', 'same-origin-http-iframe'].map((frame, index) => ({ frame,
        ...Object.fromEntries(phases.map(phase => [phase, { value: values[index], readyState: 'loading', scriptIndex: 1, inline: true }])),
        pageshow: [{ persisted: false, sample: { value: values[index] } }] })) };
  }
  return evidence;
}

test('只有完整报告且所有必需项 PASS 才退出 0；collector 的自报 GO 无效', () => {
  assert.equal(decideAcceptance(completeReport()).exitCode, 0);
  const pending = createEvidence();
  pending.conclusion = 'GO'; pending.exitCode = 0;
  assert.equal(decideAcceptance(pending).exitCode, 2);
});

test('任何必需场景/阶段缺失或 UNKNOWN 都禁止 GO', () => {
  for (const [id] of scenarioDefinitions) {
    const missing = completeReport();
    missing.scenarios = missing.scenarios.filter(row => row.id !== id);
    assert.equal(decideAcceptance(missing).exitCode, 2, id);
    for (const phase of phases) {
      const unknown = completeReport();
      unknown.scenarios.find(row => row.id === id).phases[phase] = 'UNKNOWN';
      assert.equal(decideAcceptance(unknown).exitCode, 2, `${id}:${phase}`);
    }
  }
});

test('仅场景 PASS 不够：网络约束、继承检查、生产暂停及 API 均为强制项', () => {
  for (const key of networkChecks) {
    const report = completeReport();
    report.network.checks[key] = 'UNKNOWN';
    assert.equal(decideAcceptance(report).exitCode, 2, key);
  }
  const missingNetwork = completeReport(); delete missingNetwork.network;
  assert.equal(decideAcceptance(missingNetwork).exitCode, 2);
  const noPolicy = completeReport(); noPolicy.network.policyApplied = false;
  assert.equal(decideAcceptance(noPolicy).exitCode, 2);
  const missingProduction = completeReport(); delete missingProduction.production;
  assert.equal(decideAcceptance(missingProduction).exitCode, 2);
  const api = completeReport(); api.environment.apiAvailable = 'UNKNOWN';
  assert.equal(decideAcceptance(api).exitCode, 2);
  const registration = completeReport(); registration.mechanism.unregister = 'UNKNOWN';
  assert.equal(decideAcceptance(registration).exitCode, 2);
  const paused = completeReport(); paused.production.pauseGate = 'FAIL';
  assert.equal(decideAcceptance(paused).exitCode, 1);
});

test('后阶段不能覆盖 earliest 失败，实际数据缺失不能仅凭 PASS 通过', () => {
  const late = completeReport(); late.scenarios[1].actual.frames[0].earliest.scriptIndex = 2;
  assert.equal(decideAcceptance(late).exitCode, 1);
  const noActual = completeReport(); noActual.scenarios[1].actual = null;
  assert.equal(decideAcceptance(noActual).exitCode, 2);
  const sameDocumentMissing = completeReport(); delete sameDocumentMissing.scenarios.find(row => row.id === 'C-existing-A').actual.sameDocuments;
  assert.equal(decideAcceptance(sameDocumentMissing).exitCode, 2);
  const interrupted = completeReport(); interrupted.stopReason = 'AUTOMATION_TIMEOUT';
  assert.equal(decideAcceptance(interrupted).exitCode, 2);
});

test('机制 FAIL 为 1，环境/清理阻断为 2', () => {
  const failed = createEvidence(); failed.scenarios[1].status = 'FAIL';
  assert.equal(decideAcceptance(failed).exitCode, 1);
  const cleanup = completeReport(); cleanup.cleanup.status = 'FAIL';
  assert.equal(decideAcceptance(cleanup).exitCode, 2);
});

test('Chrome 自身 sandbox 和 Linux namespace 拓扑必须有独立实际字段，状态标签不能替代', () => {
  const report = completeReport();
  report.environment.chromeSandbox.seccompBpf = false;
  assert.equal(decideAcceptance(report).exitCode, 2);
  const topology = completeReport();
  topology.network.backend = 'linux-network-namespace';
  assert.equal(decideAcceptance(topology).exitCode, 2);
  topology.network.topology = { onlyLoopbackInterface: true, ipv4ProhibitDefault: true, ipv6ProhibitDefault: true, noExternalRoutes: true, nonRootCollector: true };
  Object.assign(topology.cleanup, { coordinator: 'PASS', staging: 'PASS' });
  assert.equal(decideAcceptance(topology).exitCode, 0);
  topology.network.topology.onlyLoopbackInterface = false;
  assert.equal(decideAcceptance(topology).exitCode, 2);
});

test('Linux 的 coordinator 和 staging 清理缺失、UNKNOWN 或失败均禁止 GO', () => {
  for (const key of ['coordinator', 'staging']) {
    for (const state of [undefined, 'UNKNOWN', 'FAIL']) {
      const report = completeReport();
      report.network.backend = 'linux-network-namespace';
      report.network.topology = { onlyLoopbackInterface: true, ipv4ProhibitDefault: true, ipv6ProhibitDefault: true, noExternalRoutes: true, nonRootCollector: true };
      Object.assign(report.cleanup, { coordinator: 'PASS', staging: 'PASS' });
      if (state === undefined) delete report.cleanup[key]; else report.cleanup[key] = state;
      assert.notEqual(decideAcceptance(report).exitCode, 0, `${key}:${state}`);
    }
  }
});

// 这些用例重现独立复核找到的缺口：PASS 标签不能掩盖实际值或生命周期证据缺失。
test('逐场景重算实际值，native/B 场景误报 A 不得 GO', () => {
  for (const [id] of scenarioDefinitions.filter(([id]) => !['B-register-A', 'B-broad-subpath', 'C-existing-A'].includes(id))) {
    const report = completeReport();
    report.scenarios.find(row => row.id === id).actual.frames[0].earliest.value = 'x-vg-a';
    assert.equal(decideAcceptance(report).exitCode, 1, id);
  }
});
test('back/forward 要有完整且一致的文档连续性、persisted 和 pageshow 实际值', () => {
  for (const id of ['F-history-back', 'F-history-forward']) {
    for (const key of ['restoredOriginalDocument', 'childRestoredOriginalDocument', 'pageshowPersisted', 'childPageshowPersisted']) {
      const missing = completeReport(); delete missing.scenarios.find(row => row.id === id).actual[key];
      assert.equal(decideAcceptance(missing).exitCode, 2, `${id}:${key}`);
    }
    const noSample = completeReport(); delete noSample.scenarios.find(row => row.id === id).actual.frames[1].pageshow[0].sample;
    assert.equal(decideAcceptance(noSample).exitCode, 2);
    const wrong = completeReport(); wrong.scenarios.find(row => row.id === id).actual.frames[0].pageshow[0].sample.value = 'x-vg-a';
    assert.equal(decideAcceptance(wrong).exitCode, 1);
    const inconsistent = completeReport(); inconsistent.scenarios.find(row => row.id === id).actual.restoredOriginalDocument = true;
    assert.equal(decideAcceptance(inconsistent).exitCode, 1);
  }
  const retained = completeReport(); const row = retained.scenarios.find(row => row.id === 'F-history-back');
  Object.assign(row.actual, { restoredOriginalDocument: true, childRestoredOriginalDocument: true, pageshowPersisted: true, childPageshowPersisted: true, bfcacheObserved: true });
  for (const frame of row.actual.frames) {
    for (const phase of phases) frame[phase].value = 'x-vg-a';
    frame.pageshow = [{ persisted: true, sample: { value: 'x-vg-a' } }];
  }
  assert.equal(decideAcceptance(retained).exitCode, 0);
});
