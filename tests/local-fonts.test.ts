import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalFontsFilter } from '../src/injected/local-fonts';

/**
 * `window.queryLocalFonts()` 过滤器。
 *
 * 这一层补的是 canvas 之外的第二条路：清单是**直接枚举**，没有阈值也没有误差，
 * 所以补丁的行为必须逐项钉死 —— 少藏一个族，三层字表就白做；多藏一个族，
 * 就等于给页面造出一个真机不会有的取值。
 */

type FontLike = { family: string; fullName?: string; postscriptName?: string };

const HIDDEN = new Set(['pingfangsc', 'pingfangmo', 'simsun', 'songtisc']);
// 与 font-aliases.ts 的归一化同形：去空白、小写、去掉尾随字重
// （`PingFang SC Regular` → `pingfangsc`）。fullName 一定带字重，不剥就永远比不上。
const norm = (value?: string) => String(value || '')
  .toLowerCase()
  .replace(/[\s-]/g, '')
  .replace(/regular$|bold$|light$|medium$|semibold$|heavy$|black$|thin$/, '');

function makeScope(fonts: FontLike[], options: { enumerable?: boolean; reject?: any } = {}) {
  const native = function queryLocalFonts(this: any, passed?: any) {
    if (options.reject) return Promise.reject(options.reject);
    return Promise.resolve(fonts.map((font) => ({ ...font })));
  };
  const scope: any = {};
  Object.defineProperty(scope, 'queryLocalFonts', {
    value: native,
    writable: true,
    // 原生 Chromium 里这个是 true：Object.keys(window) 能看见它
    enumerable: options.enumerable !== false,
    configurable: true
  });
  return { scope, native };
}

function install(scope: any, calls: Array<{ name: string; length: number }> = []) {
  return installLocalFontsFilter(scope, {
    isHidden: ({ family, fullName, postscriptName }) => [family, fullName, postscriptName].some((name) => HIDDEN.has(norm(name))),
    disguise: (fn, name, length) => {
      calls.push({ name, length });
      return fn;
    }
  });
}

const FONTS: FontLike[] = [
  { family: 'Helvetica', fullName: 'Helvetica', postscriptName: 'Helvetica' },
  { family: 'PingFang SC', fullName: 'PingFang SC Regular', postscriptName: 'PingFangSC-Regular' },
  { family: 'Menlo', fullName: 'Menlo Regular', postscriptName: 'Menlo-Regular' },
  { family: 'SimSun', fullName: 'SimSun', postscriptName: 'SimSun' },
  { family: 'Songti SC', fullName: 'Songti SC Regular', postscriptName: 'STSongti-SC-Regular' }
];

test('API 不存在时不动手，返回 false', () => {
  assert.equal(install({}), false);
  assert.equal(install({ queryLocalFonts: 'not a function' }), false);
});

test('按族名藏掉被伪装的字体，其余原样保留、顺序不变', async () => {
  const { scope } = makeScope(FONTS);
  assert.equal(install(scope), true);
  const list = await scope.queryLocalFonts();
  assert.deepEqual(list.map((font: FontLike) => font.family), ['Helvetica', 'Menlo']);
});

test('fullName / postscriptName 命中也要藏（页面不必只用 family 比对）', async () => {
  const fonts: FontLike[] = [
    { family: 'Helvetica', fullName: 'PingFang SC Regular', postscriptName: 'Helvetica' },
    { family: 'Helvetica', fullName: 'Helvetica', postscriptName: 'PingFangSC-Regular' }
  ];
  const { scope } = makeScope(fonts);
  install(scope);
  assert.deepEqual(await scope.queryLocalFonts(), []);
});

test('原生 reject（用户拒权）要原样透传，不能变成空数组', async () => {
  const { scope } = makeScope(FONTS, { reject: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) });
  install(scope);
  await assert.rejects(() => scope.queryLocalFonts(), (error: any) => error.name === 'NotAllowedError');
});

test('参数与返回形态不变：options 转给原生，非数组的结果不碰', async () => {
  let received: any = null;
  const scope: any = {};
  Object.defineProperty(scope, 'queryLocalFonts', {
    value: function queryLocalFonts(this: any, passed: any) { received = passed; return Promise.resolve('weird'); },
    writable: true, enumerable: true, configurable: true
  });
  install(scope);
  assert.equal(await scope.queryLocalFonts({ postscriptNames: ['PingFangSC-Regular'] }), 'weird');
  assert.deepEqual(received, { postscriptNames: ['PingFangSC-Regular'] });
});

test('属性描述符原样复制：enumerable 仍是 true（否则 Object.keys 一行就验出来）', () => {
  const { scope } = makeScope(FONTS);
  install(scope);
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'queryLocalFonts')!;
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.ok(Object.keys(scope).includes('queryLocalFonts'));
});

test('伪造签名对齐原生：name=queryLocalFonts、length=0', () => {
  const calls: Array<{ name: string; length: number }> = [];
  const { scope } = makeScope(FONTS);
  install(scope, calls);
  assert.deepEqual(calls, [{ name: 'queryLocalFonts', length: 0 }]);
});

test('藏完之后再看清单，被伪装的族一个都不剩（与 canvas 视图一致）', async () => {
  const { scope } = makeScope([
    ...FONTS,
    { family: 'PingFang MO', fullName: 'PingFang MO Regular', postscriptName: 'PingFangMO-Regular' }
  ]);
  install(scope);
  const families = (await scope.queryLocalFonts()).map((font: FontLike) => font.family);
  for (const hidden of ['PingFang SC', 'PingFang MO', 'SimSun', 'Songti SC']) {
    assert.equal(families.includes(hidden), false, `${hidden} 还留在清单里`);
  }
  assert.deepEqual(families, ['Helvetica', 'Menlo'], '不该顺手多藏别的族');
});