import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../src/injected/runtime-modules/registry';
import { installFontExposureFilter } from '../src/injected/runtime-modules/surfaces/font-exposure';

test('queryLocalFonts 过滤原生结果并保留 FontData 对象、调用者和选项', async () => {
  const hidden = { family: '微软雅黑', fullName: 'Microsoft YaHei Regular', postscriptName: 'MicrosoftYaHei', blob() { return 'hidden'; } };
  const visible = { family: 'Arial', fullName: 'Arial', postscriptName: 'ArialMT', blob() { return 'native-blob'; } };
  const originalResult = [hidden, visible];
  const options = { postscriptNames: ['ArialMT'] };
  let calls = 0;
  const root = { queryLocalFonts(this: unknown, ...args: unknown[]) {
    assert.equal(this, root);
    assert.deepEqual(args, [options, 'extra']);
    calls++;
    return Promise.resolve(originalResult);
  } } as any;
  const native = root.queryLocalFonts;
  installFontExposureFilter(root, createRuntimeState(root), { enabled: true, mode: 'vendor-software', blockedFamilies: ['Microsoft YaHei'] });
  assert.equal(root.queryLocalFonts.name, native.name);
  assert.equal(root.queryLocalFonts.length, native.length);
  const result = await root.queryLocalFonts(options, 'extra');
  assert.deepEqual(result, [visible]);
  assert.equal(result[0], visible);
  assert.equal(result[0].blob(), 'native-blob');
  assert.deepEqual(originalResult, [hidden, visible]);
  assert.equal(calls, 1);
});

test('queryLocalFonts 不补建缺失 API，不拦截浏览器授权拒绝及 receiver 异常', async () => {
  const config = { enabled: true, mode: 'custom', blockedFamilies: ['SimSun'] } as const;
  const absent = {} as any;
  installFontExposureFilter(absent, createRuntimeState(absent), { ...config, blockedFamilies: [...config.blockedFamilies] });
  assert.equal(Object.prototype.hasOwnProperty.call(absent, 'queryLocalFonts'), false);
  const denied = new Error('native permission denied');
  const badReceiver = new TypeError('native receiver');
  const root = { queryLocalFonts(this: unknown) {
    if (this !== root) throw badReceiver;
    return Promise.reject(denied);
  } } as any;
  const native = root.queryLocalFonts;
  installFontExposureFilter(root, createRuntimeState(root), { ...config, blockedFamilies: [...config.blockedFamilies] });
  assert.throws(() => root.queryLocalFonts.call({}), error => error === badReceiver);
  await assert.rejects(root.queryLocalFonts(), error => error === denied);
  const off = { queryLocalFonts: native } as any;
  installFontExposureFilter(off, createRuntimeState(off), { enabled: false, mode: 'custom', blockedFamilies: ['SimSun'] });
  assert.equal(off.queryLocalFonts, native);
});
