import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/shared/config-resolver';
import { applyWebRTCPolicy, getWebRTCPolicyState } from '../src/background/webrtc';
import { normalizeConfig, normalizeWebRtc, parseWebRtcMode } from '../src/shared/config-model';

function installChromePolicyMock(initialValue = 'default') {
  const originalChrome = (globalThis as any).chrome;
  const calls: Array<{ method: string; value?: string; scope?: string }> = [];
  let value = initialValue;
  let levelOfControl = initialValue === 'default' ? 'controllable_by_this_extension' : 'controlled_by_this_extension';

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

test('ChromeSetting 原生零 length 函数的异步回调不能被提前当作成功', async () => {
  const mock = installChromePolicyMock();
  let completed!: () => void;
  const callbackDone = new Promise<void>((resolve) => { completed = resolve; });
  chrome.privacy.network.webRTCIPHandlingPolicy.get = ((...args: any[]) => {
    setTimeout(() => {
      args[1]({ value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension' });
      completed();
    }, 1);
  }) as any;
  try {
    const state = await getWebRTCPolicyState(normalizeConfig({ webRtc: { globalMode: 'strict' } }));
    await callbackDone;
    assert.equal(state.actualPolicy, 'disable_non_proxied_udp');
    assert.equal(state.controlledByThisExtension, true);
  } finally { mock.restore(); }
});

test('ChromeSetting 异步 lastError 保持显式失败', async () => {
  const mock = installChromePolicyMock();
  chrome.privacy.network.webRTCIPHandlingPolicy.get = ((...args: any[]) => {
    setTimeout(() => {
      (chrome.runtime as any).lastError = { message: '合成权限限制' };
      args[1](undefined);
      delete (chrome.runtime as any).lastError;
    }, 1);
  }) as any;
  try {
    await assert.rejects(getWebRTCPolicyState(normalizeConfig({})), /合成权限限制/);
  } finally { mock.restore(); }
});

test('WebRTC 被其他扩展控制、不支持读取或实际不一致不能当作同步成功', async () => {
  const mock = installChromePolicyMock();
  try {
    const config = normalizeConfig({ webRtc: { globalMode: 'strict' } });
    const setting = chrome.privacy.network.webRTCIPHandlingPolicy;
    const originalGet = setting.get;
    setting.get = ((_details: unknown, cb: any) => cb({ value: 'default', levelOfControl: 'controlled_by_other_extensions' })) as any;
    await assert.rejects(applyWebRTCPolicy(config), /其他扩展控制/);
    assert.deepEqual(mock.calls, []);
    setting.get = ((_details: unknown, cb: any) => cb({ value: 'default', levelOfControl: 'controllable_by_this_extension' })) as any;
    await assert.rejects(applyWebRTCPolicy(config), /未确认生效/);
    delete (setting as any).get;
    await assert.rejects(applyWebRTCPolicy(config), /不支持完整/);
    assert.equal((await getWebRTCPolicyState(config)).leakProtectionActive, false);
    setting.get = originalGet;
    await applyWebRTCPolicy(config);
    const count = mock.calls.length;
    await applyWebRTCPolicy(config);
    assert.equal(mock.calls.length, count);
  } finally { mock.restore(); }
});

test('default/禁用释放被其他控制者遮蔽的 own 策略，clear 失败不得成功', async () => {
  const original = (globalThis as any).chrome;
  let own: string | null = null; let shadow = false; let clearFails = false; let clears = 0;
  (globalThis as any).chrome = { runtime: {}, privacy: { network: { webRTCIPHandlingPolicy: {
    get(_details: unknown, callback: any) {
      callback({ value: shadow ? 'default_public_interface_only' : own || 'default',
        levelOfControl: shadow ? 'controlled_by_other_extensions' : own ? 'controlled_by_this_extension' : 'controllable_by_this_extension' });
    },
    set(details: any, callback: any) { own = details.value; callback(); },
    clear(_details: unknown, callback: any) { clears++; if (clearFails) throw new Error('合成 clear 失败'); own = null; callback(); }
  } } } };
  try {
    for (const desired of [normalizeConfig({ webRtc: { globalMode: 'default' } }), normalizeConfig({ masterEnabled: false, webRtc: { globalMode: 'strict' } })]) {
      shadow = false;
      await applyWebRTCPolicy(normalizeConfig({ webRtc: { globalMode: 'strict' } }));
      shadow = true; clearFails = true;
      await assert.rejects(applyWebRTCPolicy(desired), /clear 失败/);
      assert.equal(own, 'disable_non_proxied_udp');
      clearFails = false;
      await applyWebRTCPolicy(desired);
      assert.equal(own, null);
      const count = clears;
      await applyWebRTCPolicy(desired, true);
      assert.equal(clears, count, '已有 clear 确认时相同签名不重复释放');
      shadow = false;
      assert.equal((await getWebRTCPolicyState(desired)).actualPolicy, 'default');
    }
  } finally { (globalThis as any).chrome = original; }
});

for (const [mode, policy] of [['default', null], ['compatible', 'default_public_interface_only'], ['strict', 'disable_non_proxied_udp']] as const) {
  test(`领域模式 ${mode} 保存、验证与 Chrome 策略完整对应`, async () => {
    const mock = installChromePolicyMock();
    try {
      const validated = validateConfig(JSON.parse(JSON.stringify(normalizeConfig({ masterEnabled: true, webRtc: { globalMode: mode } }))));
      assert.equal(validated.ok, true);
      if (!validated.ok) return;
      const state = await applyWebRTCPolicy(validated.config);
      assert.equal(validated.config.webRtc.globalMode, mode);
      assert.equal(state.requestedPolicy, policy);
      assert.equal(state.actualPolicy, policy ?? 'default');
      assert.deepEqual(mock.calls, policy ? [{ method: 'set', value: policy, scope: 'regular' }] : [{ method: 'clear', scope: 'regular' }]);
    } finally { mock.restore(); }
  });
}

test('未知领域模式和遗留原始值不能进入内部 WebRTC 归一化', () => {
  for (const mode of ['bogus', 'default_public_and_private_interfaces', 'disable_non_proxied_udp', '', null]) {
    assert.throws(() => normalizeWebRtc({ globalMode: parseWebRtcMode(mode) }), /webRtc.globalMode/);
    assert.equal(validateConfig({ ...normalizeConfig({}), webRtc: { globalMode: mode } }).ok, false);
  }
});
