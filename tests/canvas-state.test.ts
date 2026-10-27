import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasFontState } from '../src/injected/canvas-state';

/**
 * 目标集合必须在每份 payload 上更新，而不是只在安装补丁时赋值一次。
 * 旧实现把赋值塞在 installCanvas() 里：canvas 关闭后该函数不再被调用，
 * 主线程继续按旧字表隐藏字体，Worker 已经恢复原生 —— 两边对不上。
 */

test('设置目标后按别名命中，清空后立即恢复原生', () => {
  const state = createCanvasFontState();

  state.setTargets(['PingFang SC']);
  assert.equal(state.isTarget('PingFang SC'), true);
  assert.equal(state.isTarget('苹方-简'), true, '本地化名字也要命中');
  assert.match(state.fallbackFont('16px "PingFang SC"') || '', /__vg_absent__/);

  state.setTargets([]);
  assert.equal(state.isTarget('PingFang SC'), false);
  assert.equal(state.fallbackFont('16px "PingFang SC"'), null, '关闭后必须走原生度量');

  state.setTargets(null);
  assert.equal(state.fallbackFont('16px "PingFang SC"'), null);
});

test('换一组目标时旧目标不再命中', () => {
  const state = createCanvasFontState();
  state.setTargets(['Menlo']);
  assert.equal(state.isTarget('Menlo'), true);
  state.setTargets(['SimSun']);
  assert.equal(state.isTarget('Menlo'), false);
  assert.equal(state.isTarget('宋体'), true);
});

test('保留页面自己的回退族名', () => {
  const state = createCanvasFontState();
  state.setTargets(['SimSun']);
  assert.equal(state.fallbackFont('16px "SimSun", monospace'), '16px monospace');
});