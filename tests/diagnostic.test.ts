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
