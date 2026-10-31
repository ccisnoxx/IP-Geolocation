import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readWebRTCPolicy } from '../src/background/webrtc';

/**
 * WebRTC 策略读回：写入成功不代表生效（别的扩展接管、企业策略锁定），
 * 诊断页靠这里读到的实际值和控制权判断档位是不是真的落地。
 */

afterEach(() => {
  delete (globalThis as any).chrome;
});

function installSetting(get: (details: object, callback: (value: any) => void) => void, lastError?: { message: string }) {
  (globalThis as any).chrome = {
    runtime: { lastError },
    privacy: { network: { webRTCIPHandlingPolicy: { get } } }
  };
}

test('读回实际值与控制权', async () => {
  installSetting((_details, callback) => callback({ value: 'default', levelOfControl: 'controlled_by_other_extensions' }));
  assert.deepEqual(await readWebRTCPolicy(), { value: 'default', levelOfControl: 'controlled_by_other_extensions' });
});

test('浏览器报错时明确失败，不伪装成读到了默认值', async () => {
  installSetting((_details, callback) => callback(undefined), { message: 'privacy is not allowed' });
  await assert.rejects(readWebRTCPolicy(), /privacy is not allowed/);
});

test('没有 privacy API 时返回 null', async () => {
  (globalThis as any).chrome = {};
  assert.equal(await readWebRTCPolicy(), null);
});
