import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebRtcLeakSnapshot, classifyWebRtcCandidate } from '../src/shared/diagnostic';
import {
  LOCALE_DATETIME_FORMAT_OPTIONS,
  formatLocaleDateTimeForPage
} from '../src/shared/locale-datetime';

test('WebRTC diagnostics classify local and public IP candidates', () => {
  const local = classifyWebRtcCandidate('candidate:1 1 udp 1 192.168.1.10 5353 typ host');
  const publicCandidate = classifyWebRtcCandidate('candidate:2 1 udp 1 203.0.113.9 443 typ srflx');
  const mdnsCandidate = classifyWebRtcCandidate('candidate:3 1 udp 1 abcd1234.local 5353 typ host');
  const snapshot = buildWebRtcLeakSnapshot({
    candidates: [local.candidate, publicCandidate.candidate, mdnsCandidate.candidate]
  });

  assert.equal(local.risk, 'local');
  assert.equal(publicCandidate.risk, 'public');
  assert.deepEqual(mdnsCandidate.mdnsHosts, ['abcd1234.local']);
  assert.equal(mdnsCandidate.risk, 'none');
  assert.equal(snapshot.exposesLocalIp, true);
  assert.equal(snapshot.exposesPublicIp, true);
  assert.equal('protected' in snapshot, false);
  assert.equal('policyState' in snapshot, false);
});

test('locale 示例使用页面实际 locale 和 timezone，不要求扩展预期值', () => {
  const date = new Date(Date.UTC(2026, 0, 15, 12, 34, 56));
  assert.equal(formatLocaleDateTimeForPage(date), date.toLocaleString(undefined, LOCALE_DATETIME_FORMAT_OPTIONS));
});
