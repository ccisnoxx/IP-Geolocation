import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWebRTCPolicy, getWebRTCPolicyState, resetWebRTCPolicy } from '../src/background/webrtc';
import { normalizeConfig } from '../src/shared/config-model';

function installChromePolicyMock(initialValue = 'default') {
  const originalChrome = (globalThis as any).chrome;
  const calls: Array<{ method: string; value?: string; scope?: string }> = [];
  let value = initialValue;
  let levelOfControl = 'controllable_by_this_extension';

  (globalThis as any).chrome = {
    runtime: {},
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set(details: { value: string; scope?: string }, callback?: () => void) {
            calls.push({ method: 'set', value: details.value, scope: details.scope });
            value = details.value;
            levelOfControl = 'controlled_by_this_extension';
            callback?.();
          },
          clear(details: { scope?: string }, callback?: () => void) {
            calls.push({ method: 'clear', scope: details.scope });
            value = 'default';
            levelOfControl = 'controllable_by_this_extension';
            callback?.();
          },
          get(_details: unknown, callback?: (details: { value: string; levelOfControl: string }) => void) {
            callback?.({ value, levelOfControl });
          }
        }
      }
    }
  };

  return {
    calls,
    restore() {
      (globalThis as any).chrome = originalChrome;
    }
  };
}

test('applyWebRTCPolicy maps strict mode to disable_non_proxied_udp and reads actual state', async () => {
  const chromeMock = installChromePolicyMock();
  try {
    const state = await applyWebRTCPolicy(normalizeConfig({
      masterEnabled: true,
      webRtc: { globalMode: 'strict' }
    }));

    assert.deepEqual(chromeMock.calls, [
      { method: 'set', value: 'disable_non_proxied_udp', scope: 'regular' }
    ]);
    assert.equal(state.requestedPolicy, 'disable_non_proxied_udp');
    assert.equal(state.actualPolicy, 'disable_non_proxied_udp');
    assert.equal(state.controlledByThisExtension, true);
    assert.equal(state.leakProtectionActive, true);
  } finally {
    chromeMock.restore();
  }
});

test('applyWebRTCPolicy clears Chrome policy for default or disabled protection', async () => {
  const chromeMock = installChromePolicyMock('disable_non_proxied_udp');
  try {
    const state = await applyWebRTCPolicy(normalizeConfig({
      masterEnabled: false,
      webRtc: { globalMode: 'strict' }
    }));

    assert.deepEqual(chromeMock.calls, [
      { method: 'clear', scope: 'regular' }
    ]);
    assert.equal(state.requestedPolicy, null);
    assert.equal(state.actualPolicy, 'default');
    assert.equal(state.leakProtectionActive, false);

    await resetWebRTCPolicy();
    assert.equal(chromeMock.calls[1].method, 'clear');
  } finally {
    chromeMock.restore();
  }
});

test('getWebRTCPolicyState reports unsupported Chrome privacy API explicitly', async () => {
  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = { runtime: {}, privacy: { network: {} } };
  try {
    const state = await getWebRTCPolicyState(normalizeConfig({
      masterEnabled: true,
      webRtc: { globalMode: 'compatible' }
    }));

    assert.equal(state.supported, false);
    assert.equal(state.requestedPolicy, 'default_public_interface_only');
    assert.equal(state.actualPolicy, null);
    assert.equal(state.leakProtectionActive, false);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});
