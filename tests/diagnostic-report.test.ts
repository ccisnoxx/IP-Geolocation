import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import { compareDiagnosticEvidence, diagnosticExpectation } from '../src/shared/diagnostic-report';
import type { DiagnosticEvidence } from '../src/shared/diagnostic-report';
import { normalizeConfig, normalizeGeolocation, normalizeRule } from '../src/shared/config-model';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { collectDiagnosticActual } from '../src/background/diagnostic-probe';
import { collectDiagnosticPassThrough, collectDiagnosticRealm, collectInjectionTiming, createDiagnosticFrame, readDiagnosticDocument, removeDiagnosticFrame } from '../src/background/diagnostic-probe';
import { createDiagnosticRuns, DIAGNOSTIC_TTL_MS } from '../src/background/diagnostic-runs';
import { createBackgroundMessageRouter } from '../src/background/message-router';
import { createBackgroundServices } from '../src/background/services';

export function diagnosticConfig() {
  return normalizeConfig({ masterEnabled: true, rules: [normalizeRule({ id: 'test', domain: 'example.test', enabled: true })], globalProfile: {
    language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'] },
    timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
    geolocation: normalizeGeolocation({ enabled: true, mode: 'manual', latitude: 0, longitude: 0, accuracy: 50, randomize: false, spoofPermission: true })
  }, webRtc: { globalMode: 'strict' } });
}
export function diagnosticEvidence(): DiagnosticEvidence {
  const expectation = diagnosticExpectation(getEffectiveProfile(diagnosticConfig(), 'example.test').payload!);
  const value = { language: 'ja-JP', languages: ['ja-JP', 'ja'], locale: 'ja-JP', timezone: 'Asia/Tokyo', offsetMinutes: -540, localeString: new Date(1768478400000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) };
  return { runId: 'synthetic-run', expiresAt: Date.now() + 120000, targetOrigin: 'https://example.test', expectation, requestedPolicy: 'disable_non_proxied_udp',
    actual: { realm: { value, error: null }, header: { value: 'ja-JP,ja;q=0.9', error: null }, position: { value: { latitude: 0, longitude: 0, accuracy: 50 }, error: null }, watch: { value: { latitude: 0, longitude: 0, accuracy: 50 }, error: null }, permission: { value: 'granted', error: null }, ice: { value: { total: 0, ip: 0, mdns: 0, other: 0, complete: true }, error: null }, workers: { classic: { value, error: null }, module: { value, error: null }, shared: { value, error: null } } },
    policy: { value: { supported: true, requestedPolicy: 'disable_non_proxied_udp', actualPolicy: 'disable_non_proxied_udp', controlledByThisExtension: true, levelOfControl: 'controlled_by_this_extension' }, error: null },
    reference: { value: { hardwareConcurrency: 4, webglRenderer: null }, error: null }, passThrough: { value: { hardwareConcurrency: 4, webglRenderer: null }, error: null }, frames: [{ frameId: 1, expectation, actual: { value, error: null }, reason: '' }] };
}

test('报告比较完整信号，缺失观测和无 ICE 不冒充 PASS', () => {
  const rows = compareDiagnosticEvidence(diagnosticEvidence());
  for (const label of ['Top language', 'Top languages', 'Top locale', 'Top timezone', 'Top Date offset', 'Top Date locale', 'getCurrentPosition', 'watchPosition', 'WebRTC policy', 'iframe 1 language', 'Worker module language', 'Pass-through hardwareConcurrency']) assert.equal(rows.find((row) => row.label === label)?.verdict, 'PASS', label);
  assert.equal(rows.find(row => row.label === 'Accept-Language')?.verdict, 'PASS');
  for (const label of ['目标内置字体过滤', '非目标字体原生', '字体探测覆盖']) {
    assert.equal(rows.find(row => row.label === label)?.verdict, 'UNKNOWN', label);
  }
  const nativeHeader = diagnosticEvidence();
  nativeHeader.actual.header.value = 'en-US';
  assert.equal(compareDiagnosticEvidence(nativeHeader).find(row => row.label === 'Accept-Language')?.verdict, 'FAIL');
  assert.equal(rows.find((row) => row.label === 'WebRTC ICE')?.verdict, 'UNKNOWN');
  assert.equal(rows.find((row) => row.label === 'Pass-through webglRenderer')?.verdict, 'UNKNOWN');
  const bad = diagnosticEvidence();
  bad.actual.realm.value!.language = 'en-US';
  bad.actual.header = { value: null, error: 'header_echo_failed' };
  bad.actual.watch.value!.accuracy = 100;
  bad.policy.value!.levelOfControl = 'controlled_by_other_extensions';
  bad.policy.value!.controlledByThisExtension = false;
  bad.actual.ice.value!.ip = 1;
  bad.passThrough.value!.hardwareConcurrency = 8;
  const failures = compareDiagnosticEvidence(bad);
  for (const label of ['Top language', 'watchPosition accuracy', 'WebRTC policy', 'WebRTC ICE', 'Pass-through hardwareConcurrency']) assert.equal(failures.find((row) => row.label === label)?.verdict, 'FAIL', label);
  assert.equal(failures.find((row) => row.label === 'Accept-Language')?.verdict, 'UNKNOWN');
});

function installRunMock() {
  const original = (globalThis as any).chrome;
  let config = diagnosticConfig();
  let url = 'https://example.test/leak-test/leak-test.html?ui=zh';
  let documentId = 'top-document';
  let permission = true;
  let fail = false;
  let hold: Promise<void> | null = null;
  let entered: (() => void) | null = null;
  const calls: any[] = [];
  const writes: any[] = [];
  (globalThis as any).chrome = {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}` },
    tabs: { get: async () => ({ id: 1, url }) },
    permissions: { contains: async () => permission },
    storage: { local: { set: async (value: any) => writes.push(value) }, session: { set: async (value: any) => writes.push(value) } },
    privacy: { network: { webRTCIPHandlingPolicy: { get: async () => ({ value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension' }) } } },
    scripting: { executeScript: async (details: any) => {
      calls.push(details);
      if (fail) throw new Error('合成执行错误：不可泄露任意网页文本');
      let result: any;
      if (details.func === readDiagnosticDocument) {
        if (details.target.allFrames) return [
          { frameId: 0, documentId, result: { url } },
          { frameId: 1, documentId: 'same-origin-child', result: { url: 'https://example.test/leak-test/leak-test.html' } },
          { frameId: 2, documentId: 'unmatched-child', result: { url: 'https://other.test/' } },
          { frameId: 3, documentId: 'blank-child', result: { url: 'about:blank' } }
        ];
        result = { url };
      } else if (details.func === collectDiagnosticPassThrough) result = { value: { hardwareConcurrency: 4 }, error: null };
      else if (details.func === collectDiagnosticActual) {
        entered?.();
        if (hold) await hold;
        result = diagnosticEvidence().actual;
      } else if (details.func === collectDiagnosticRealm) result = diagnosticEvidence().actual.realm;
      else if (details.func === createDiagnosticFrame) result = 'synthetic-frame-token';
      else if (details.func === removeDiagnosticFrame) result = null;
      return [{ frameId: details.target.documentIds?.[0] === 'same-origin-child' ? 1 : 0, documentId: details.target.documentIds?.[0] || documentId, result }];
    } }
  };
  const runs = createDiagnosticRuns(async () => structuredClone(config));
  const owner = { tabId: 9, documentId: 'report-document' };
  return { runs, owner, calls, writes, config,
    setUrl: (value: string) => { url = value; }, setDocument: (value: string) => { documentId = value; },
    setPermission: (value: boolean) => { permission = value; }, setFail: (value: boolean) => { fail = value; },
    holdActual: () => {
      let release!: () => void;
      hold = new Promise((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      return { release, started };
    }, restore: () => { runs.invalidateTab(9, true); (globalThis as any).chrome = original; }
  };
}

test('run 一次消费，所有采样定向 documentId 且无预期参数，子帧独立授权', async () => {
  const mock = installRunMock();
  try {
    const info = await mock.runs.prepare(1, mock.owner);
    const evidence = await mock.runs.execute(info.runId, mock.owner);
    assert.equal(evidence.expectation.geolocation?.latitude, 0);
    assert.equal(evidence.frames.length, 3);
    assert.equal(evidence.frames[1].actual.value, null);
    assert.equal(evidence.frames[2].actual.value, null);
    const main = mock.calls.filter((call) => call.world === 'MAIN');
    assert.ok(main.length > 0);
    for (const call of main) {
      assert.ok(call.target.documentIds?.length === 1);
      assert.deepEqual(call.args || [], call.func === removeDiagnosticFrame ? ['synthetic-frame-token'] : []);
    }
    assert.equal(main.some((call) => call.target.documentIds.includes('unmatched-child')), false);
    assert.deepEqual(mock.writes, []);
    await assert.rejects(mock.runs.execute(info.runId, mock.owner), (error: any) => error.code === 'consumed');
    await assert.rejects(createDiagnosticRuns(async () => mock.config).execute(info.runId, mock.owner), (error: any) => error.code === 'missing');
  } finally { mock.restore(); }
});

test('未 allowlist、权限拒绝和不可注入有明确状态，不放宽配置', async () => {
  const mock = installRunMock();
  try {
    mock.setUrl('chrome://extensions/');
    await assert.rejects(mock.runs.prepare(1, mock.owner), (e: any) => e.code === 'invalid_target');
    mock.setUrl('https://other.test/');
    await assert.rejects(mock.runs.prepare(1, mock.owner), (e: any) => e.code === 'not_allowlisted');
    mock.setUrl('https://example.test/');
    mock.setPermission(false);
    await assert.rejects(mock.runs.prepare(1, mock.owner), (e: any) => e.code === 'permission_denied');
    mock.setPermission(true);
    mock.setFail(true);
    await assert.rejects(mock.runs.prepare(1, mock.owner), (e: any) => e.code === 'injection_failed' && !e.message.includes('网页文本'));
    mock.setFail(false);
    mock.config.globalProfile.geolocation.mode = 'auto';
    await assert.rejects(mock.runs.prepare(1, mock.owner), (e: any) => e.code === 'invalid_configuration');
  } finally { mock.restore(); }
});

test('过期、取消、配置改变、同 URL 重载和目标关闭使 run 失效', async () => {
  const mock = installRunMock();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    let run = await mock.runs.prepare(1, mock.owner);
    now += DIAGNOSTIC_TTL_MS;
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'expired');
    run = await mock.runs.prepare(1, mock.owner);
    mock.runs.cancel(run.runId, mock.owner);
    mock.runs.cancel(run.runId, mock.owner);
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'cancelled');
    run = await mock.runs.prepare(1, mock.owner);
    mock.config.globalProfile.language.language = 'en-US';
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'configuration_changed');
    run = await mock.runs.prepare(1, mock.owner);
    mock.setDocument('new-document');
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'navigated');
    run = await mock.runs.prepare(1, mock.owner);
    mock.runs.invalidateTab(1, true);
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'target_closed');
    assert.deepEqual(mock.writes, []);
  } finally { Date.now = realNow; mock.restore(); }
});

test('执行中重复消费拒绝，取消不接受晚到结果；新 run 可恢复', async () => {
  const mock = installRunMock();
  try {
    const run = await mock.runs.prepare(1, mock.owner);
    const gate = mock.holdActual();
    const execution = mock.runs.execute(run.runId, mock.owner);
    await gate.started;
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'running');
    mock.runs.cancel(run.runId, mock.owner);
    gate.release();
    await assert.rejects(execution, (e: any) => e.code === 'cancelled');
    const next = await mock.runs.prepare(1, mock.owner);
    assert.ok(await mock.runs.execute(next.runId, mock.owner));
  } finally { mock.restore(); }
});

test('导航和采集失败中止执行并清理 run，iframe 最终移除', async () => {
  const mock = installRunMock();
  try {
    let run = await mock.runs.prepare(1, mock.owner);
    const gate = mock.holdActual();
    const executing = mock.runs.execute(run.runId, mock.owner);
    await gate.started;
    mock.setUrl('https://example.test/new');
    gate.release();
    await assert.rejects(executing, (e: any) => e.code === 'navigated');
    run = await mock.runs.prepare(1, mock.owner);
    const executeScript = chrome.scripting.executeScript;
    (chrome.scripting as any).executeScript = async (details: any) => {
      if (details.func === readDiagnosticDocument && details.target.allFrames) throw new Error('frame enumeration blocked');
      return executeScript(details);
    };
    const partial = await mock.runs.execute(run.runId, mock.owner);
    assert.equal(partial.frames[0].reason, 'frame_enumeration_failed');
    assert.ok(mock.calls.some((call) => call.func === removeDiagnosticFrame));
    run = await mock.runs.prepare(1, mock.owner);
    mock.setFail(true);
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'injection_failed');
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'injection_failed');
  } finally { mock.restore(); }
});

test('并发 prepare 只保留最新请求，报告关闭时准备阶段也失效', async () => {
  const mock = installRunMock();
  try {
    const first = mock.runs.prepare(1, mock.owner);
    const second = mock.runs.prepare(1, mock.owner);
    await assert.rejects(first, (e: any) => e.code === 'cancelled');
    const next = await second;
    mock.runs.cancel(next.runId, mock.owner);
    const preparing = mock.runs.prepare(1, mock.owner);
    mock.runs.invalidateTab(9, true);
    await assert.rejects(preparing, (e: any) => e.code === 'cancelled');
  } finally { mock.restore(); }
});

test('诊断 actions 只接受扩展报告文档，run 跨报告文档不可读取或取消', async () => {
  const mock = installRunMock();
  try {
    const router = createBackgroundMessageRouter(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}'));
    for (const sender of [
      { id: 'test', url: 'https://example.test/', tab: { id: 9 }, documentId: 'report-document' },
      { id: 'other', url: 'chrome-extension://test/diagnostic/report.html', tab: { id: 9 }, documentId: 'report-document' },
      { id: 'test', url: 'chrome-extension://test/options/options.html', tab: { id: 9 }, documentId: 'report-document' }
    ]) for (const action of ['prepareDiagnosticRun', 'executeDiagnosticRun', 'executeInjectionTimingRun', 'cancelDiagnosticRun', 'getDiagnosticTargets', 'openDiagnosticTarget']) await assert.rejects(router.respond({ action, runId: 'forged', tabId: 1 }, sender as any), /只允许/);
    const run = await mock.runs.prepare(1, mock.owner);
    await assert.rejects(mock.runs.execute(run.runId, { ...mock.owner, documentId: 'new-report-document' }), (e: any) => e.code === 'wrong_owner');
    assert.throws(() => mock.runs.cancel(run.runId, { tabId: 10, documentId: mock.owner.documentId }), (e: any) => e.code === 'wrong_owner');
    mock.runs.cancel(run.runId, mock.owner);
  } finally { mock.restore(); }
});

test('位置按随机半径比较且跨日期线距离正确，禁用信号 UNKNOWN', () => {
  const evidence = diagnosticEvidence();
  evidence.expectation.geolocation!.longitude = 179.9999;
  evidence.expectation.geolocation!.randomRadiusMeters = 100;
  evidence.actual.position.value!.longitude = -179.9999;
  assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === 'getCurrentPosition')?.verdict, 'PASS');
  evidence.expectation.geolocation!.randomRadiusMeters = 1;
  assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === 'getCurrentPosition')?.verdict, 'FAIL');
  evidence.expectation = { language: null, timezone: null, geolocation: null };
  for (const label of ['Top language', 'Top timezone', 'getCurrentPosition', 'Accept-Language']) assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === label)?.verdict, 'UNKNOWN');
});

test('default 策略验证释放控制，不把浏览器实际策略硬编码为 default', () => {
  const evidence = diagnosticEvidence();
  evidence.requestedPolicy = null;
  assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === 'WebRTC policy')?.verdict, 'FAIL');
  evidence.policy.value!.controlledByThisExtension = false;
  evidence.policy.value!.levelOfControl = 'controllable_by_this_extension';
  assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === 'WebRTC policy')?.verdict, 'PASS');
  evidence.policy = { value: null, error: 'privacy_api_failed' };
  assert.equal(compareDiagnosticEvidence(evidence).find((row) => row.label === 'WebRTC policy')?.verdict, 'UNKNOWN');
});

test('时区别名按同一规则比较，原始值保留且不等价时区 FAIL', () => {
  const evidence = diagnosticEvidence();
  evidence.expectation.timezone = 'Etc/UTC';
  evidence.actual.realm.value!.timezone = 'Etc/UTC';
  const row = compareDiagnosticEvidence(evidence).find((item) => item.label === 'Top timezone')!;
  assert.equal(row.verdict, 'PASS');
  assert.equal(row.actual, 'Etc/UTC');
  assert.equal(row.expected, 'Etc/UTC');
  evidence.actual.realm.value!.timezone = 'UTC';
  assert.equal(compareDiagnosticEvidence(evidence).find((item) => item.label === 'Top timezone')?.verdict, 'PASS');
  evidence.actual.realm.value!.timezone = 'Asia/Tokyo';
  assert.equal(compareDiagnosticEvidence(evidence).find((item) => item.label === 'Top timezone')?.verdict, 'FAIL');
});

test('顶层不变时，子帧规则撤销或覆盖变化仍中止 run', async () => {
  for (const stage of ['before-sample', 'after-sample']) for (const change of ['revoke', 'override']) {
    const mock = installRunMock();
    try {
      mock.config.rules.push({ ...mock.config.rules[0], id: 'child', domain: 'child.test', overrides: structuredClone(mock.config.rules[0].overrides) });
      const base = chrome.scripting.executeScript;
      let changed = false;
      (chrome.scripting as any).executeScript = async (details: any) => {
        if (details.func === readDiagnosticDocument && details.target.allFrames) {
          if (stage === 'before-sample' && !changed) {
            changed = true;
            if (change === 'revoke') mock.config.rules[1].enabled = false;
            else mock.config.rules[1].overrides.language = { mode: 'override', value: { language: 'fr-FR', languages: ['fr-FR'] } };
          }
          return [{ frameId: 0, documentId: 'top-document', result: { url: 'https://example.test/leak-test/leak-test.html?ui=zh' } }, { frameId: 1, documentId: 'child-doc', result: { url: 'https://child.test/' } }];
        }
        if (stage === 'after-sample' && details.func === collectDiagnosticRealm && !changed) {
          changed = true;
          if (change === 'revoke') mock.config.rules[1].enabled = false;
          else mock.config.rules[1].overrides.language = { mode: 'override', value: { language: 'fr-FR', languages: ['fr-FR'] } };
        }
        return base(details);
      };
      const run = await mock.runs.prepare(1, mock.owner);
      await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'configuration_changed', `${stage}/${change}`);
      if (stage === 'before-sample') assert.equal(mock.calls.some((call) => call.func === collectDiagnosticRealm), false);
      assert.ok(mock.calls.some((call) => call.func === removeDiagnosticFrame));
    } finally { mock.restore(); }
  }
});

test('执行中 TTL 到期及时返回，不等待尚未完成的目标采集', async (t) => {
  const mock = installRunMock();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const run = await mock.runs.prepare(1, mock.owner);
    const gate = mock.holdActual();
    const executing = mock.runs.execute(run.runId, mock.owner);
    await gate.started;
    t.mock.timers.tick(DIAGNOSTIC_TTL_MS);
    await assert.rejects(executing, (e: any) => e.code === 'expired');
    gate.release();
  } finally { t.mock.timers.reset(); mock.restore(); }
});

test('MAIN 透传采样等待期间取消或撤销规则，不启动下一阶段外部采集', async () => {
  for (const change of ['cancel', 'revoke']) {
    const mock = installRunMock();
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const base = chrome.scripting.executeScript;
    (chrome.scripting as any).executeScript = async (details: any) => {
      if (details.func === collectDiagnosticPassThrough && details.world === 'MAIN') {
        entered();
        await held;
      }
      return base(details);
    };
    try {
      const run = await mock.runs.prepare(1, mock.owner);
      const executing = mock.runs.execute(run.runId, mock.owner);
      await started;
      if (change === 'cancel') mock.runs.cancel(run.runId, mock.owner);
      else mock.config.rules[0].enabled = false;
      release();
      await assert.rejects(executing, (e: any) => change === 'cancel' ? e.code === 'cancelled' : e.code === 'not_allowlisted');
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(mock.calls.some((call) => call.func === collectDiagnosticActual), false);
    } finally { release(); mock.restore(); }
  }
});

test('Chrome 执行失败早于导航事件时，用可信新 documentId 报告 navigated', async () => {
  for (const failing of [collectDiagnosticActual, removeDiagnosticFrame]) {
    const mock = installRunMock();
    const base = chrome.scripting.executeScript;
    (chrome.scripting as any).executeScript = async (details: any) => {
      if (details.func === failing) {
        mock.setDocument('reloaded-document');
        throw new Error('Frame removed');
      }
      return base(details);
    };
    try {
      const run = await mock.runs.prepare(1, mock.owner);
      await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'navigated');
    } finally { mock.restore(); }
  }
});

test('MAIN 采集函数可独立序列化，无预期请求，IPv6 仅返回数量并清理资源', async () => {
  const requests: any[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let closed = 0;
  const cleared: number[] = [];
  const snapshot = { language: 'en-US', languages: ['en-US'], dateTimeFormatLocale: 'en-US', timezone: 'UTC', offsetMinutes: 0 };
  class WorkerMock {
    onmessage: any;
    onerror: any;
    onmessageerror: any;
    constructor(url: string) { requests.push({ worker: url }); queueMicrotask(() => this.onmessage?.({ data: snapshot })); }
    terminate() { closed++; }
  }
  class SharedWorkerMock {
    port = { start: () => queueMicrotask(() => this.port.onmessage?.({ data: snapshot })), close: () => { closed++; }, onmessage: null as any, onmessageerror: null };
    constructor(url: string) { requests.push({ worker: url }); }
  }
  class PeerMock {
    onicecandidate: any;
    onicegatheringstatechange: any;
    constructor(config: any) { requests.push({ peer: config }); }
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      this.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 2001:db8::5 443 typ srflx' } });
      this.onicecandidate?.({ candidate: null });
    }
    close() { closed++; }
  }
  const context = vm.createContext({ URL, AbortController, Intl, Date, Promise, crypto: { randomUUID: () => 'fixture' }, location: { origin: 'https://example.test' },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
    navigator: { language: 'en-US', languages: ['en-US'], permissions: { query: async () => ({ state: 'granted' }) }, geolocation: { getCurrentPosition: (success: any) => success({ coords: { latitude: 0, longitude: 0, accuracy: 50 } }), watchPosition: (success: any) => { success({ coords: { latitude: 0, longitude: 0, accuracy: 50 } }); return 7; }, clearWatch: (id: number) => cleared.push(id) } },
    fetch: async (url: string, init: any) => { requests.push({ url, init }); return { ok: true, url: 'https://example.test/headers.json', json: async () => ({ acceptLanguage: 'en-US' }) }; },
    Worker: WorkerMock, SharedWorker: SharedWorkerMock, RTCPeerConnection: PeerMock });
  // tsx keepNames 会插入 __name；用维护源的普通 TS 编译验证函数序列化。
  const source = fs.readFileSync(new URL('../src/background/diagnostic-probe.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  (context as any).exports = {};
  vm.runInContext(compiled, context);
  const serialized = vm.runInContext('exports.collectDiagnosticActual.toString()', context);
  const actual = await vm.runInContext(`(${serialized})()`, context);
  assert.equal(actual.header.value, 'en-US');
  assert.equal(actual.ice.value.ip, 1);
  assert.doesNotMatch(JSON.stringify(actual), /2001:db8|candidate:1/);
  assert.deepEqual(cleared, [7]);
  assert.equal(closed, 4);
  assert.equal(timers.size, 0);
  assert.equal(requests.find((r) => r.url)?.url, '/headers.json');
  assert.equal(requests.find((r) => r.url)?.init.referrerPolicy, 'no-referrer');
  assert.equal(requests.find((r) => r.url)?.init.credentials, 'omit');
  assert.doesNotMatch(JSON.stringify(requests), /expected|latitude|longitude|siteSpoofConfig/);
});

function injectionObservation() {
  const realm = diagnosticEvidence().actual.realm.value!;
  const snapshot = { language: realm.language, languages: realm.languages, locale: realm.locale, timezone: realm.timezone, offsetMinutes: realm.offsetMinutes,
    readyState: 'loading', scriptIndex: 1, inline: true, capturedAtMs: 1 };
  return { value: { version: 1 as const, earliest: snapshot, load: { ...snapshot, readyState: 'complete', inline: false, capturedAtMs: 2 }, postLoad: { ...snapshot, readyState: 'complete', inline: false, capturedAtMs: 3 } }, error: null };
}

test('VG-009 earliest 与 load 独立判定，缺失场景/禁用信号保持 UNKNOWN', () => {
  const actual = injectionObservation();
  actual.value.earliest = { ...actual.value.earliest, language: 'en-US', languages: ['en-US'], locale: 'en-US', timezone: 'UTC', offsetMinutes: 0 };
  const expectation = diagnosticEvidence().expectation;
  const evidence = { runId: 'timing', expiresAt: 1, targetOrigin: 'https://example.test', timing: [{ frameId: 0, kind: 'top', expectation, actual }] };
  const rows = compareDiagnosticEvidence(evidence);
  for (const field of ['language', 'languages', 'locale', 'timezone', 'Date offset']) {
    assert.equal(rows.find((r) => r.label === `top #0 earliest ${field}`)?.verdict, 'FAIL');
    assert.equal(rows.find((r) => r.label === `top #0 load ${field}`)?.verdict, 'PASS');
  }
  assert.equal(rows.find((r) => r.label === 'srcdoc timing coverage')?.verdict, 'UNKNOWN');
  actual.value.earliest.scriptIndex = 2;
  assert.equal(compareDiagnosticEvidence(evidence).find((r) => r.label === 'top #0 earliest capture')?.verdict, 'FAIL');
  evidence.timing[0].expectation = { language: null, timezone: null, geolocation: null };
  assert.equal(compareDiagnosticEvidence(evidence).find((r) => r.label === 'top #0 load language')?.verdict, 'UNKNOWN');
});

test('VG-009 fixture 首脚本同步冻结早期值，不在 load 重采替换 earliest', () => {
  for (const file of ['earliest-inline.html', 'child.html']) {
    const source = fs.readFileSync(new URL(`../fixtures/injection/${file}`, import.meta.url), 'utf8');
    const first = source.match(/<head>\s*<script>([\s\S]*?)<\/script>/)![1];
    const handlers: Record<string, () => void> = {};
    const navigator = { language: 'en-US', languages: ['en-US'] };
    let output: any;
    const context = vm.createContext({ navigator, Intl, Date, performance: { now: () => 1 },
      window: { addEventListener: (name: string, fn: () => void) => { handlers[name] = fn; } },
      document: { readyState: 'loading', scripts: [1], currentScript: { src: '' }, createElement: () => ({}), body: { appendChild: (node: any) => { output = node; } }, querySelector: () => ({}) }
    });
    vm.runInContext(first, context);
    assert.equal(output, undefined);
    navigator.language = 'ja-JP';
    navigator.languages = ['ja-JP', 'ja'];
    vm.runInContext("document.readyState = 'complete'; document.currentScript = null", context);
    handlers.load();
    const result = JSON.parse((output as any).textContent);
    assert.equal(result.earliest.language, 'en-US');
    assert.equal(result.load.language, 'ja-JP');
    assert.equal(result.earliest.scriptIndex, 1);
    assert.equal(result.earliest.readyState, 'loading');
    assert.equal(result.load.readyState, 'complete');
    assert.doesNotMatch(first, /addEventListener\(['"]DOMContentLoaded|sendMessage|postMessage|RuntimeReady/);
  }
});

test('VG-009 无参数 MAIN 采集可序列化，拒绝非法数据且不返回额外页面字段', () => {
  const source = fs.readFileSync(new URL('../src/background/diagnostic-probe.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let text: string | null = null;
  const context = vm.createContext({ exports: {}, navigator: { language: 'ja-JP', languages: ['ja-JP', 'ja'] }, Intl, Date, performance: { now: () => 3 }, document: { readyState: 'complete', scripts: [1, 2], getElementById: () => text === null ? null : { textContent: text } } });
  vm.runInContext(compiled, context);
  const serialized = vm.runInContext('exports.collectInjectionTiming.toString()', context);
  const collect = () => JSON.parse(JSON.stringify(vm.runInContext(`(${serialized})()`, context)));
  assert.equal(collect().error, 'timing_fixture_missing_or_not_loaded');
  const observation = injectionObservation().value;
  text = JSON.stringify({ ...observation, forgedExpectation: '不可采信', extra: '不可返回' });
  assert.equal(collect().value.earliest.language, 'ja-JP');
  assert.doesNotMatch(JSON.stringify(collect()), /forgedExpectation|extra|不可/);
  for (const invalid of ['{', 'x'.repeat(16385), JSON.stringify({ ...observation, version: 2 }), JSON.stringify({ ...observation, earliest: { ...observation.earliest, languages: [5] } })]) {
    text = invalid;
    assert.equal(collect().error, 'timing_snapshot_invalid');
  }
});

test('VG-009 时序采样逐文档授权/复核，fallback 有效 origin 与不明来源分开，无外部采集', async () => {
  const mock = installRunMock();
  const base = chrome.scripting.executeScript;
  let changed = false;
  (chrome.scripting as any).executeScript = async (details: any) => {
    if (details.func === readDiagnosticDocument && details.target.allFrames) return [
      { frameId: 0, documentId: 'top-document', result: { url: 'https://example.test/leak-test/leak-test.html?ui=zh', origin: 'https://example.test' } },
      { frameId: 1, documentId: 'srcdoc', result: { url: 'about:srcdoc', origin: 'https://example.test' } },
      { frameId: 2, documentId: 'opaque', result: { url: 'about:blank', origin: 'null' } }
    ];
    const result = await base(details);
    if (details.func === collectInjectionTiming) {
      if (changed && details.target.documentIds[0] === 'srcdoc') mock.config.rules[0].enabled = false;
      return [{ frameId: details.target.documentIds[0] === 'srcdoc' ? 1 : 0, documentId: details.target.documentIds[0], result: injectionObservation() }];
    }
    return result;
  };
  try {
    const run = await mock.runs.prepare(1, mock.owner);
    const evidence = await mock.runs.executeTiming(run.runId, mock.owner);
    assert.equal(evidence.timing.length, 3);
    assert.equal(evidence.timing[1].expectation?.timezone, 'Asia/Tokyo');
    assert.equal(evidence.timing[2].actual.error, 'frame_not_allowlisted_or_origin_unknown');
    assert.equal(mock.calls.some((c) => c.target.documentIds?.includes('opaque')), false);
    assert.ok(mock.calls.filter((c) => c.world === 'MAIN').every((c) => c.func === collectInjectionTiming && !c.args));
    assert.deepEqual(mock.writes, []);
    await assert.rejects(mock.runs.execute(run.runId, mock.owner), (e: any) => e.code === 'consumed');
    const next = await mock.runs.prepare(1, mock.owner);
    changed = true;
    await assert.rejects(mock.runs.executeTiming(next.runId, mock.owner), (e: any) => e.code === 'not_allowlisted' || e.code === 'configuration_changed');
  } finally { mock.restore(); }
});


test('报告按模式分别判断默认与显式调用；显式错误不会被默认 PASS 掩盖', () => {
  for (const intlMode of ['strict', 'compatible'] as const) {
    const evidence = diagnosticEvidence();
    evidence.expectation.intlMode = intlMode;
    const locale = intlMode === 'strict' ? 'ja-JP' : 'en-US';
    const timeZone = intlMode === 'strict' ? 'Asia/Tokyo' : 'UTC';
    const date = new Date(1768478400000);
    evidence.actual.realm.value!.intl = {
      numberLocale: 'ja-JP', explicitLocale: locale, explicitTimezone: timeZone, explicitNumberLocale: locale,
      explicitDateLocale: date.toLocaleString(locale, { timeZone }),
      explicitDateHour: new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date)
    };
    const rows = compareDiagnosticEvidence(evidence);
    for (const label of ['Top locale', 'Top timezone', 'Top NumberFormat default locale', 'Top explicit locale', 'Top explicit timezone', 'Top NumberFormat explicit locale', 'Top Date explicit locale', 'Top DateTimeFormat explicit hour']) {
      assert.equal(rows.find(row => row.label === label)?.verdict, 'PASS', label);
    }
    evidence.actual.realm.value!.intl.explicitTimezone = intlMode === 'strict' ? 'UTC' : 'Asia/Tokyo';
    const bad = compareDiagnosticEvidence(evidence);
    assert.equal(bad.find(row => row.label === 'Top timezone')?.verdict, 'PASS');
    assert.equal(bad.find(row => row.label === 'Top explicit timezone')?.verdict, 'FAIL');
    delete evidence.actual.realm.value!.intl;
    assert.equal(compareDiagnosticEvidence(evidence).find(row => row.label === 'Top explicit timezone')?.verdict, 'UNKNOWN');
  }
});

test('兼容默认 locale 和 NumberFormat 按原生协商比较，strict DTF 保留强制原文', () => {
  for (const intlMode of ['strict', 'compatible'] as const) {
    const evidence = diagnosticEvidence();
    const language = 'fr-fr';
    evidence.expectation.intlMode = intlMode;
    evidence.expectation.language!.language = language;
    const value = evidence.actual.realm.value!;
    value.locale = intlMode === 'compatible' ? new Intl.DateTimeFormat(language).resolvedOptions().locale : language;
    value.intl = {
      numberLocale: new Intl.NumberFormat(language).resolvedOptions().locale,
      explicitLocale: intlMode === 'compatible' ? 'en-US' : language,
      explicitTimezone: intlMode === 'compatible' ? 'UTC' : 'Asia/Tokyo',
      explicitNumberLocale: new Intl.NumberFormat(intlMode === 'compatible' ? 'en-US' : language).resolvedOptions().locale,
      explicitDateLocale: '', explicitDateHour: ''
    };
    const rows = compareDiagnosticEvidence(evidence);
    for (const label of ['Top locale', 'Top NumberFormat default locale', 'Top NumberFormat explicit locale']) {
      assert.equal(rows.find(row => row.label === label)?.verdict, 'PASS', `${intlMode} ${label}`);
    }
  }
});
