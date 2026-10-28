import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../src/injected/runtime-modules/registry';
import { installFontExposureFilter } from '../src/injected/runtime-modules/surfaces/font-exposure';
import { installWorkerFonts } from '../src/injected/runtime-modules/surfaces/offscreen-fonts';
import { installCanvasFontSpoof } from '../src/injected/runtime-modules/surfaces/canvas-fonts';

const TARGET = '16px "SimSun"';
const ORDINARY = '16px Arial';
const SURFACES = ['page', 'worker', 'canvas'] as const;

// 原生桩显式拥有品牌、必填参数、DOMString 转换和语法异常；目标字体在原生侧可用。
// 这里只验证包装边界，CSS 解析与真实 Chrome 验收沿用项目既有门禁。
function fontRealm(surface: typeof SURFACES[number]) {
  const fontsByContext = new WeakMap<object, string>();
  const fontSets = new WeakSet<object>();
  class Context {
    constructor() { fontsByContext.set(this, ORDINARY); }
    get font() {
      if (!fontsByContext.has(this)) throw new TypeError('font 非法 receiver');
      return fontsByContext.get(this)!;
    }
    set font(value: string) {
      if (!fontsByContext.has(this)) throw new TypeError('font 非法 receiver');
      fontsByContext.set(this, `${value}`);
    }
    measureText(text: unknown) {
      if (!fontsByContext.has(this)) throw new TypeError('measureText 非法 receiver');
      if (!arguments.length) throw new TypeError('measureText 缺少参数');
      const content = `${text}`;
      if (content === 'native-failure') throw new RangeError('原生测量失败');
      return { font: fontsByContext.get(this), text: content };
    }
  }
  class FontFaceSet {
    constructor() { fontSets.add(this); }
    check(font: unknown, text: unknown = '') {
      if (!fontSets.has(this)) throw new TypeError('check 非法 receiver');
      if (!arguments.length) throw new TypeError('check 缺少参数');
      const value = `${font}`;
      const content = `${text}`;
      if (!/^16px /.test(value)) throw new SyntaxError('无效字体 shorthand');
      return !value.includes('Missing') && content !== 'missing-glyph';
    }
  }
  const nativeMeasure = Context.prototype.measureText;
  const nativeCheck = FontFaceSet.prototype.check;
  const context = new Context();
  const fonts = new FontFaceSet();
  const root = {
    CanvasRenderingContext2D: Context,
    OffscreenCanvasRenderingContext2D: Context,
    FontFaceSet,
    document: { fonts, createElement() {
      let font = '';
      return { style: {
        setProperty(_name: string, value: string) { font = value; },
        getPropertyValue() { return font.replace(/^16px /, ''); }
      } };
    } }
  } as any;
  assert.equal(nativeCheck.call(fonts, TARGET), true);
  if (surface === 'page') {
    installFontExposureFilter(root, createRuntimeState(root), {
      enabled: true, mode: 'vendor-software', blockedFamilies: ['SimSun']
    });
  } else if (surface === 'worker') {
    installWorkerFonts(root, { blockedFonts: ['SimSun'] });
  } else {
    // 两个构造器在本桩中共用原型；仅注册 Canvas，避免重复安装同一 owner。
    delete root.OffscreenCanvasRenderingContext2D;
    installCanvasFontSpoof(root, { platform: 'macos', replacements: { simsun: 'Helvetica Neue' } });
  }
  return { context, fonts, nativeCheck, nativeMeasure,
    fallback: surface === 'canvas' ? '16px Helvetica Neue' : '16px "__vg_absent__"' };
}

function outcome(run: () => unknown) {
  try { return { value: run() }; }
  catch (error) { return { error: (error as Error).name, message: (error as Error).message }; }
}

for (const surface of SURFACES) {
  test(`${surface} check 只转换一次对象字体，保留 getter receiver、this 和 string hint`, () => {
    const { fonts, nativeCheck } = fontRealm(surface);
    assert.equal(fonts.check, nativeCheck);
    let reads = 0, calls = 0;
    const font = {
      get [Symbol.toPrimitive]() {
        assert.equal(this, font);
        reads++;
        return function(this: unknown, hint: string) {
          assert.equal(this, font);
          assert.equal(hint, 'string');
          calls++;
          return TARGET;
        };
      }
    };
    assert.equal(fonts.check(font), true);
    assert.equal(reads, 1);
    assert.equal(calls, 1);
    assert.equal(fonts.check({ toString() { return TARGET; } }), true);
    assert.equal(fonts.check('16px Missing'), false);
    assert.equal(fonts.check(ORDINARY), true);
  });

  test(`${surface} check 保留原生品牌、缺参、Symbol 及第二 text 参数异常`, () => {
    const { fonts, nativeCheck } = fontRealm(surface);
    const receivers = [{}, null, undefined, Object.create(Object.getPrototypeOf(fonts)), new Proxy(fonts, {})];
    for (const receiver of receivers) {
      assert.deepEqual(outcome(() => Reflect.apply(fonts.check, receiver, [TARGET])),
        outcome(() => Reflect.apply(nativeCheck, receiver, [TARGET])));
    }
    for (const args of [[], [Symbol('font')], [TARGET, Symbol('text')], ['invalid font']] as unknown[][]) {
      assert.deepEqual(outcome(() => Reflect.apply(fonts.check, fonts, args)),
        outcome(() => Reflect.apply(nativeCheck, fonts, args)));
    }
    const marker = new RangeError('text 转换失败');
    let conversions = 0;
    assert.throws(() => fonts.check(TARGET, { toString() { conversions++; throw marker; } }), error => error === marker);
    assert.equal(conversions, 1);
    let invalidReceiverConversions = 0;
    assert.throws(() => fonts.check.call({}, { toString() { invalidReceiverConversions++; return TARGET; } }), TypeError);
    assert.equal(invalidReceiverConversions, 0);
  });

  test(`${surface} measureText 的对象转换能更改字体，本次测量过滤且保留新字体`, () => {
    const { context, fallback } = fontRealm(surface);
    let conversions = 0;
    const text = {
      [Symbol.toPrimitive](hint: string) {
        assert.equal(this, text);
        assert.equal(hint, 'string');
        assert.equal(context.font, ORDINARY);
        conversions++;
        context.font = TARGET;
        return '字A';
      }
    };
    assert.deepEqual(context.measureText(text), { font: fallback, text: '字A' });
    assert.equal(conversions, 1);
    assert.equal(context.font, TARGET);
  });

  test(`${surface} measureText 转换重入不暴露临时字体，离开目标后保持转换设置的字体`, () => {
    const { context, fallback } = fontRealm(surface);
    context.font = TARGET;
    let conversions = 0;
    const text = { toString() {
      assert.equal(this, text);
      assert.equal(context.font, TARGET);
      conversions++;
      assert.equal(context.measureText('nested').font, fallback);
      assert.equal(context.font, TARGET);
      context.font = ORDINARY;
      return 'outer';
    } };
    assert.deepEqual(context.measureText(text), { font: ORDINARY, text: 'outer' });
    assert.equal(conversions, 1);
    assert.equal(context.font, ORDINARY);
  });

  test(`${surface} measureText 保留原生品牌与缺参，转换和测量异常后恢复字体`, () => {
    const { context, nativeMeasure } = fontRealm(surface);
    context.font = TARGET;
    const fakeReceiver = { get font() { throw new Error('不能读取页面自己的属性'); } };
    for (const receiver of [{}, null, undefined, new Proxy(context, {}), fakeReceiver]) {
      assert.deepEqual(outcome(() => Reflect.apply(context.measureText, receiver, ['text'])),
        outcome(() => Reflect.apply(nativeMeasure, receiver, ['text'])));
    }
    assert.deepEqual(outcome(() => Reflect.apply(context.measureText, context, [])),
      outcome(() => Reflect.apply(nativeMeasure, context, [])));
    assert.deepEqual(outcome(() => context.measureText(Symbol('text'))),
      outcome(() => nativeMeasure.call(context, Symbol('text'))));
    assert.equal(context.font, TARGET);
    const marker = new SyntaxError('转换失败');
    let conversions = 0;
    assert.throws(() => context.measureText({ toString() {
      conversions++;
      assert.equal(context.font, TARGET);
      context.font = ORDINARY;
      throw marker;
    } }), error => error === marker);
    assert.equal(conversions, 1);
    assert.equal(context.font, ORDINARY);
    context.font = TARGET;
    assert.throws(() => context.measureText({ toString() { return 'native-failure'; } }), /原生测量失败/);
    assert.equal(context.font, TARGET);
  });
}
