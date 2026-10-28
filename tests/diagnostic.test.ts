import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrameProbeSnapshot,
  buildGeolocationBehaviorSnapshot,
  buildRequestHeaderProbe,
  buildWorkerDiagnosticsSnapshot
} from '../src/shared/diagnostic';

test('buildRequestHeaderProbe parses browserleaks header table', () => {
  const result = buildRequestHeaderProbe({
    url: 'https://browserleaks.com/ip',
    html: `
      <table>
        <tbody id="headers">
          <tr><td>Accept-Language</td><td>ja-JP,ja;q=0.9,en;q=0.8</td></tr>
        </tbody>
      </table>
    `
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'browserleaks_ip');
  assert.equal(result.observedAcceptLanguage, 'ja-JP,ja;q=0.9,en;q=0.8');
});

test('buildRequestHeaderProbe parses httpbingo array header json', () => {
  const result = buildRequestHeaderProbe({
    url: 'https://httpbingo.org/headers',
    bodyText: JSON.stringify({ headers: { 'Accept-Language': ['en-US,en;q=0.9'] } })
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'httpbingo_headers');
  assert.equal(result.observedAcceptLanguage, 'en-US,en;q=0.9');
});

test('buildFrameProbeSnapshot separates top frame and child frames', () => {
  const snapshot = buildFrameProbeSnapshot([
    { frameId: 0, result: { url: 'http://localhost/top.html', frameName: '', isTopFrame: true, language: 'en-US' } },
    { frameId: 1, result: { url: 'http://localhost/child.html', frameName: 'child', isTopFrame: false, language: 'ja-JP' } }
  ], [{ name: 'child', scenario: 'same-origin-child' }]);

  assert.equal(snapshot.top.frameId, 0);
  assert.equal(snapshot.frames.length, 1);
  assert.equal(snapshot.frameTargets.length, 1);
});

test('worker and geolocation diagnostics normalize partial fixture output', () => {
  const worker = buildWorkerDiagnosticsSnapshot({
    classicWorker: { status: 'ok', result: { timezone: 'UTC' } }
  });
  const geo = buildGeolocationBehaviorSnapshot({
    status: 'ok',
    successResult: '{"latitude":1}'
  });

  assert.equal(worker.classicWorker.status, 'ok');
  assert.equal(worker.moduleWorker.status, 'not_attempted');
  assert.equal(geo.watchResult, '');
  assert.equal(geo.successResult, '{"latitude":1}');
});

test('SharedWorker 探测成功也要标 UNSUPPORTED（能返回值 ≠ 被覆盖）', () => {
  const worker = buildWorkerDiagnosticsSnapshot({
    sharedWorker: {
      status: 'ok',
      result: { timezone: 'Asia/Shanghai', language: 'zh-CN', connections: 2, workerUrl: 'http://localhost/shared-counter.js' }
    }
  });

  assert.equal(worker.sharedWorker.coverage, 'unsupported');
  assert.equal(worker.sharedWorker.status, 'unsupported', '原生值不能被显示成通过');
  assert.equal(worker.sharedWorker.result.timezone, 'Asia/Shanghai', '观测值仍要保留，供排查用');
  assert.match(worker.sharedWorker.note, /原生值|不在覆盖/);

  // nested / service worker 同理：不覆盖就不能显示成 ok
  const others = buildWorkerDiagnosticsSnapshot({
    nestedWorker: { status: 'ok' },
    serviceWorker: { status: 'ok' }
  });
  assert.equal(others.nestedWorker.status, 'unsupported');
  assert.equal(others.serviceWorker.status, 'unsupported');
});

test('覆盖面声明与诊断条目同源：每个 key 都带 coverage，且与声明一致', async () => {
  const { WORKER_COVERAGE } = await import('../src/shared/worker-coverage');
  const snapshot = buildWorkerDiagnosticsSnapshot({
    classicWorker: { status: 'ok' },
    moduleWorker: { status: 'ok' },
    sharedWorker: { status: 'ok' },
    nestedWorker: { status: 'ok' },
    serviceWorker: { status: 'ok' }
  });

  const keys = Object.keys(WORKER_COVERAGE) as Array<keyof typeof WORKER_COVERAGE>;
  assert.deepEqual(Object.keys(snapshot).sort(), keys.slice().sort(), '诊断条目与覆盖面表必须一一对应');
  for (const key of keys) {
    assert.equal(snapshot[key].coverage, WORKER_COVERAGE[key].status, `${key} 的 coverage 与声明不一致`);
    assert.equal(
      snapshot[key].status,
      WORKER_COVERAGE[key].status === 'unsupported' ? 'unsupported' : 'ok',
      `${key} 的 status 与声明不一致`
    );
  }
  assert.equal(WORKER_COVERAGE.sharedWorker.status, 'unsupported');
});

test('本页观察到 Worker 回退时，classic/module 标 degraded 而不是 ok', () => {
  const snapshot = buildWorkerDiagnosticsSnapshot({
    classicWorker: { status: 'ok' },
    moduleWorker: { status: 'ok' },
    workerFallback: {
      hostname: 'claude.ai',
      count: 2,
      reasons: ['csp-blocked'],
      lastScript: 'https://claude.ai/worker.js',
      lastMessage: "Failed to construct 'Worker': CSP",
      at: Date.now()
    }
  });

  assert.equal(snapshot.classicWorker.coverage, 'supported');
  assert.equal(snapshot.classicWorker.status, 'degraded');
  assert.match(snapshot.classicWorker.detail, /2 个 Worker 回退原生/);
  assert.match(snapshot.classicWorker.detail, /CSP/);
  assert.equal(snapshot.classicWorker.note, "Failed to construct 'Worker': CSP");
  assert.equal(snapshot.moduleWorker.status, 'degraded');
  // SharedWorker 本来就是 unsupported，不因为别人的回退改变说法
  assert.equal(snapshot.sharedWorker.status, 'unsupported');
});

test('没有回退记录时 supported 项仍然是 ok（不能假报警）', () => {
  const snapshot = buildWorkerDiagnosticsSnapshot({
    classicWorker: { status: 'ok' },
    workerFallback: null
  });
  assert.equal(snapshot.classicWorker.status, 'ok');
  assert.equal(snapshot.classicWorker.fallback, null);
});

test('describeSiteStatus 把「没生效」的原因说清楚', async () => {
  const { describeSiteStatus } = await import('../src/shared/site-status');

  const notListed = describeSiteStatus({ matched: false, payload: null, errors: [] });
  assert.equal(notListed.broken, false);
  assert.equal(notListed.reason, 'not-allowlisted');

  const active = describeSiteStatus({ matched: true, payload: {} as any, errors: [] });
  assert.equal(active.active, true);
  assert.equal(active.broken, false);

  const tzBroken = describeSiteStatus({
    matched: true,
    payload: null,
    errors: ['timezone is enabled but no valid timezone is available']
  });
  assert.equal(tzBroken.broken, true);
  assert.equal(tzBroken.reason, 'timezone-unresolved');
  assert.match(tzBroken.text, /时区/);
  assert.ok(tzBroken.hint.length > 0);

  const geoBroken = describeSiteStatus({
    matched: true,
    payload: null,
    errors: ['geolocation is enabled but no valid coordinates are available']
  });
  assert.equal(geoBroken.reason, 'geolocation-unresolved');

  const unknown = describeSiteStatus({ matched: true, payload: null, errors: [] });
  assert.equal(unknown.reason, 'payload-missing');
});
