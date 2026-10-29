import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coordinateInputValue,
  describeIpApplyError,
  geolocationModeFromInput,
  parseCoordinateInput,
  utcOffsetInputValue,
  webRtcSelectValue
} from '../src/shared/ui-values';
import { sendRuntimeMessage } from '../src/shared/runtime-message';

test('WebRTC 下拉值映射保持 strict / compatible / default 三态', () => {
  assert.equal(webRtcSelectValue({ webRtc: { globalMode: 'strict' } } as any), 'disable_non_proxied_udp');
  assert.equal(webRtcSelectValue({ webRtc: { globalMode: 'compatible' } } as any), 'default_public_interface_only');
  assert.equal(webRtcSelectValue({ webRtc: { globalMode: 'default' } } as any), 'default');
});

test('UTC 偏移输入：东京 +9、UTC 0、无效时区留空', () => {
  assert.equal(utcOffsetInputValue('Asia/Tokyo'), '9');
  assert.equal(utcOffsetInputValue('UTC'), '0');
  assert.equal(utcOffsetInputValue('Not/AZone'), '');
  assert.equal(utcOffsetInputValue(''), '');
});

test('坐标输入：null / 空串 / 非法值都按未填处理，0 是合法值', () => {
  assert.equal(coordinateInputValue(null), '');
  assert.equal(coordinateInputValue(0), '0');
  assert.equal(parseCoordinateInput(''), null);
  assert.equal(parseCoordinateInput('   '), null);
  assert.equal(parseCoordinateInput('north'), null);
  assert.equal(parseCoordinateInput('Infinity'), null);
  assert.equal(parseCoordinateInput('0'), 0);
  assert.equal(parseCoordinateInput('-33.8688'), -33.8688);
});

test('定位模式只由经纬度是否都填了决定', () => {
  assert.equal(geolocationModeFromInput('', ''), 'auto');
  assert.equal(geolocationModeFromInput('35.6', ''), 'auto');
  assert.equal(geolocationModeFromInput('', '139.6'), 'auto');
  assert.equal(geolocationModeFromInput('35.6', '139.6'), 'manual');
  assert.equal(geolocationModeFromInput('0', '0'), 'manual');
});

function fakeChrome(response: any, lastError?: { message: string }) {
  return {
    runtime: {
      lastError,
      sendMessage: (_message: any, callback: (value: any) => void) => callback(response)
    }
  } as any;
}

test('自动配置失败给用户一句话，不把三条接口报错糊到脸上', () => {
  assert.equal(
    describeIpApplyError('exit IP lookup failed: https://ipwho.is/ no usable exit ip | https://ipapi.co/json/ no usable exit ip'),
    '查不到出口 IP（归属地接口都没返回可用坐标），稍后再试'
  );
  assert.equal(
    describeIpApplyError('Failed to fetch'),
    '连不上归属地接口（网络或代理问题），稍后再试'
  );
  assert.equal(describeIpApplyError('The operation was aborted'), '连不上归属地接口（网络或代理问题），稍后再试');
  // 认不出来的错误照原样露出，别自己编一个更含糊的说法
  assert.equal(describeIpApplyError('当前是烘焙（只读）构建：配置烘焙在构建产物里，改不了'), '当前是烘焙（只读）构建：配置烘焙在构建产物里，改不了');
});

test('sendRuntimeMessage 解包响应，lastError / status:error 走 reject', async () => {
  await assert.doesNotReject(() => sendRuntimeMessage({ action: 'x' }, fakeChrome({ status: 'ok', value: 1 })));

  await assert.rejects(
    () => sendRuntimeMessage({ action: 'x' }, fakeChrome(undefined, { message: 'no receiver' })),
    /no receiver/
  );
  await assert.rejects(
    () => sendRuntimeMessage({ action: 'x' }, fakeChrome({ status: 'error', message: 'bad config' })),
    /bad config/
  );
  await assert.rejects(
    () => sendRuntimeMessage({ action: 'x' }, fakeChrome(null)),
    /Unknown runtime error/
  );
});
