import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTargetFontKeys,
  CJK_VENDOR_FONTS,
  isTargetFontFamily,
  normalizeFontFamily,
  resolveCanvasTargetFonts
} from '../src/shared/font-aliases';
import type { FontPlatform } from '../src/shared/font-aliases';
import { installCanvasFontPatches, uninstallCanvasFontPatches } from '../src/injected/canvas-patch';
import { createDisguise } from '../src/injected/disguise';
import { defineNativeLike } from '../src/injected/define';
import { CONFIG_SCHEMA_VERSION, normalizeConfig } from '../src/shared/config-model';
import type { CanvasConfig } from '../src/shared/types';

/**
 * Canvas 字体伪装的覆盖面。
 *
 * 这一组测试的来历：用户在检测站上看到「已安装中文字体」仍然命中，排查后发现是
 * 两个独立的问题 ——
 *   1. 目标表只按拉丁名字匹配，检测方用本地化名字（`苹方-简`、`微软雅黑`）量宽度就绕过了；
 *   2. 只补了 `CanvasRenderingContext2D`，一行 `new OffscreenCanvas(...)` 就绕开全部伪装。
 * 所以这里的断言直接对着"检测脚本会怎么写"来写，而不是对着实现细节。
 */

/** 真实检测脚本（fuck-claude.vercel.app）里的三张字表，逐字抄录 */
const DETECTOR_SIMPLIFIED = [
  'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei', 'KaiTi', 'FangSong',
  'DengXian', 'PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong', 'Songti SC',
  'Source Han Sans CN', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Serif CJK SC',
  'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei'
];
const DETECTOR_TRADITIONAL = [
  'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB',
  'PingFang TC', 'PingFang HK', 'Source Han Sans TW', 'Noto Sans CJK TC'
];
const DETECTOR_VENDOR = [
  'MiSans', 'MIUI', 'HarmonyOS Sans SC', 'HarmonyOS Sans', 'HONOR Sans', 'OPPO Sans',
  'vivo Sans', 'Alibaba PuHuiTi', 'Alibaba Sans', 'DingTalk JinBuTi', 'Douyin Sans',
  'HYQiHei', 'FZShuSong-Z01S', 'FZKai-Z03S', 'FZHei-B01S', 'FZFangSong-Z02S'
];

test('归一化：引号、空白、大小写、字重都不影响匹配', () => {
  assert.equal(normalizeFontFamily('PingFang SC'), normalizeFontFamily('PingFangSC'));
  assert.equal(normalizeFontFamily('"PingFang SC"'), normalizeFontFamily("'pingfang sc'"));
  assert.equal(normalizeFontFamily('PingFang SC Light'), normalizeFontFamily('PingFang SC'));
  assert.equal(normalizeFontFamily('Noto Sans CJK SC Medium'), normalizeFontFamily('Noto Sans CJK SC'));
  assert.equal(normalizeFontFamily('Microsoft YaHei Bold'), normalizeFontFamily('Microsoft YaHei'));
});

test('归一化不吞掉有意义的差异', () => {
  assert.notEqual(normalizeFontFamily('Microsoft YaHei'), normalizeFontFamily('Microsoft YaHei UI'));
  assert.notEqual(normalizeFontFamily('PingFang SC'), normalizeFontFamily('PingFang TC'));
  assert.notEqual(normalizeFontFamily('Noto Sans CJK SC'), normalizeFontFamily('Noto Serif CJK SC'));
});

test('本地化名字与拉丁名落到同一把锁', () => {
  const keys = buildTargetFontKeys(['PingFang SC', 'Microsoft YaHei', 'SimSun', 'Source Han Sans SC']);
  for (const alias of ['PingFang SC', '苹方-简', '苹方', 'PingFang SC Light']) {
    assert.equal(isTargetFontFamily(alias, keys), true, `漏掉 ${alias}`);
  }
  assert.equal(isTargetFontFamily('微软雅黑', keys), true);
  assert.equal(isTargetFontFamily('宋体', keys), true);
  assert.equal(isTargetFontFamily('思源黑体', keys), true);
  assert.equal(isTargetFontFamily('思源黑體', keys), true);
});

test('别名展开不会误伤无关字体', () => {
  const keys = buildTargetFontKeys(CJK_VENDOR_FONTS);
  for (const other of ['Helvetica Neue', 'Arial', 'SF Pro Text', 'Segoe UI', 'Noto Sans', 'Roboto', 'Times New Roman', 'Menlo', 'monospace']) {
    assert.equal(isTargetFontFamily(other, keys), false, `${other} 不该被当成目标字体`);
  }
});

test('默认列表覆盖真实检测脚本的全部字表（简体 / 繁体 / 国产厂商）', () => {
  const keys = buildTargetFontKeys(CJK_VENDOR_FONTS);
  const missing = [...DETECTOR_SIMPLIFIED, ...DETECTOR_TRADITIONAL, ...DETECTOR_VENDOR]
    .filter((family) => !isTargetFontFamily(family, keys));
  assert.deepEqual(missing, [], `检测脚本里这些名字没有被覆盖：${missing.join(', ')}`);
});

test('只说了一个拉丁名，同组的本地化名字也一并生效', () => {
  const keys = buildTargetFontKeys(['Microsoft YaHei']);
  assert.equal(isTargetFontFamily('微软雅黑', keys), true);
  assert.equal(isTargetFontFamily('微软雅黑 Light', keys), true);
  // 同组之外的不能顺带扩进来
  assert.equal(isTargetFontFamily('SimSun', keys), false);
});

// ---------- 补丁安装：两种 2D 上下文都要覆盖 ----------

function makeFakeContextClass(nativeWidths: Record<string, number>) {
  class FakeCtx {
    font = '10px monospace';
    /** 模拟原生：字体串里带被伪装的名字时返回真实宽度 */
    measureText(text: string) {
      const width = nativeWidths[this.font] ?? 100;
      return { width: width + text.length };
    }
  }
  return FakeCtx;
}

function makeDeps() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      fallbackFont: (font: string) => (font.includes('SimSun') ? font.replace(/"[^"]*"/, 'monospace') : null),
      disguise: (fn: any) => {
        calls.push('disguise');
        return fn;
      },
      define: (target: any, key: string, value: any) => {
        calls.push('define:' + key);
        defineNativeLike(target, key, value);
      }
    }
  };
}

test('CanvasRenderingContext2D 和 OffscreenCanvasRenderingContext2D 都打上补丁', () => {
  const scope: any = {
    CanvasRenderingContext2D: makeFakeContextClass({}),
    OffscreenCanvasRenderingContext2D: makeFakeContextClass({})
  };
  const { deps } = makeDeps();
  const patched = installCanvasFontPatches(scope, deps);
  assert.deepEqual(patched, ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']);

  for (const name of patched) {
    const proto = scope[name].prototype;
    // 补丁必须落在原型上（实例上不留自有属性）
    assert.equal(Object.prototype.hasOwnProperty.call(proto, 'measureText'), true);
    const ctx = new scope[name]();
    assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'measureText'), false);
  }
});

test('OffscreenCanvas 上下文的度量同样被改写（这一版修掉的绕过）', () => {
  const scope: any = {
    CanvasRenderingContext2D: makeFakeContextClass({ '72px "SimSun", monospace': 999 }),
    OffscreenCanvasRenderingContext2D: makeFakeContextClass({ '72px "SimSun", monospace': 999 })
  };
  installCanvasFontPatches(scope, makeDeps().deps);

  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    const ctx = new scope[name]();
    ctx.font = '72px "SimSun", monospace';
    const spoofed = ctx.measureText('中文').width;
    ctx.font = '72px monospace';
    const baseline = ctx.measureText('中文').width;
    assert.equal(spoofed, baseline, `${name} 上 SimSun 的宽度仍然与 monospace 不同`);
  }
});

test('度量结束后 ctx.font 还原成页面写进去的原串', () => {
  const scope: any = { CanvasRenderingContext2D: makeFakeContextClass({ '72px "SimSun", monospace': 999 }) };
  installCanvasFontPatches(scope, makeDeps().deps);
  const ctx = new scope.CanvasRenderingContext2D();
  const declared = '72px "SimSun", serif';
  ctx.font = declared;
  ctx.measureText('中文');
  assert.equal(ctx.font, declared);
});

test('measureText 保留原生描述符的 enumerable（WebIDL operation 可枚举）', () => {
  const scope: any = { CanvasRenderingContext2D: makeFakeContextClass({}) };
  const proto = scope.CanvasRenderingContext2D.prototype;
  // 把假原生方法改成 WebIDL 的形状：原型上的 operation 是可枚举的
  Object.defineProperty(proto, 'measureText', {
    value: proto.measureText,
    writable: true,
    enumerable: true,
    configurable: true
  });

  installCanvasFontPatches(scope, makeDeps().deps);
  assert.equal(Object.getOwnPropertyDescriptor(proto, 'measureText')!.enumerable, true);
});

test('defineNativeLike：已有成员沿用原 enumerable，新成员保持不可枚举', () => {
  const proto: any = {};
  Object.defineProperty(proto, 'nativeOp', {
    value() { return 1; }, writable: true, enumerable: true, configurable: true
  });
  defineNativeLike(proto, 'nativeOp', () => 2);
  assert.equal(Object.getOwnPropertyDescriptor(proto, 'nativeOp')!.enumerable, true);

  defineNativeLike(proto, 'brandNew', () => 3);
  assert.equal(Object.getOwnPropertyDescriptor(proto, 'brandNew')!.enumerable, false);
});

test('没有原生 measureText 时安静跳过，不抛错', () => {
  const scope: any = { CanvasRenderingContext2D: class {}, OffscreenCanvasRenderingContext2D: undefined };
  assert.deepEqual(installCanvasFontPatches(scope, makeDeps().deps), []);
});

test('底层 installer 再调用会重新包装，重复安装由 runtime 控制', () => {
  const scope: any = { CanvasRenderingContext2D: makeFakeContextClass({}) };
  installCanvasFontPatches(scope, makeDeps().deps);
  const first = scope.CanvasRenderingContext2D.prototype.measureText;
  installCanvasFontPatches(scope, makeDeps().deps);
  const second = scope.CanvasRenderingContext2D.prototype.measureText;
  // 第二次会把第一次的补丁再包一层（runtime 里由 installedCanvas 挡住重复安装）
  assert.equal(typeof second, 'function');
  assert.notEqual(first, second);
});
// ---------- 旧配置迁移：扁平 targetFonts → hideCjkFonts ----------

test('旧配置里那张中文表会被搬进 hideCjkFonts，行为不变', () => {
  const legacy = {
    schemaVersion: 2,
    canvas: {
      enabled: true,
      spoofFonts: true,
      targetFonts: ['Microsoft YaHei', 'PingFang SC', 'SimSun', 'MiSans']
    }
  } as any;

  const migrated = normalizeConfig(legacy);
  assert.equal(migrated.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(migrated.canvas.hideCjkFonts, true, '旧的中文表必须继续生效');
  // 旧条目原样保留在手动层（解析时去重），一条都不能丢
  assert.deepEqual(migrated.canvas.targetFonts, ['Microsoft YaHei', 'PingFang SC', 'SimSun', 'MiSans']);
  // 最终生效的列表里仍然有它们
  const effective = resolveCanvasTargetFonts(migrated.canvas, 'mac');
  assert.ok(effective.includes('SimSun'));
  assert.ok(effective.includes('MiSans'));
});

test('旧配置不会因为迁移丢掉任何条目', () => {
  const legacy = { canvas: { enabled: true, targetFonts: ['SimSun', 'MyCustomFont'] } } as any;
  const migrated = normalizeConfig(legacy);
  assert.equal(migrated.canvas.hideCjkFonts, true);
  const effective = resolveCanvasTargetFonts(migrated.canvas, 'mac');
  assert.ok(effective.includes('SimSun'));
  assert.ok(effective.includes('MyCustomFont'));
  assert.equal(new Set(effective.map((f) => f.toLowerCase())).size, effective.length, '解析后不该有重复项');
});

test('新配置：hideCjkFonts 显式关闭时不会被旧规则拉回开', () => {
  const config = normalizeConfig({ canvas: { enabled: true, hideCjkFonts: false, targetFonts: [] } } as any);
  assert.equal(config.canvas.hideCjkFonts, false);
});

// ---------- 平台层 ----------

const canvasOf = (patch: Partial<CanvasConfig> = {}): CanvasConfig => normalizeConfig({
  canvas: { enabled: true, spoofFonts: true, ...patch }
} as any).canvas;

const hides = (canvas: CanvasConfig, family: string, platform: FontPlatform): boolean => {
  const keys = buildTargetFontKeys(resolveCanvasTargetFonts(canvas, platform));
  return isTargetFontFamily(family, keys);
};

test('auto：按真实平台判定，真 Mac 藏 Windows / Linux 字体、保留 mac 自带', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: false });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true);
  assert.equal(hides(canvas, '微软雅黑', 'mac'), true, '中文别名同样命中');
  assert.equal(hides(canvas, 'Segoe UI', 'mac'), true);
  assert.equal(hides(canvas, 'Ubuntu', 'mac'), true);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false, 'mac 自带的苹方不该被藏');
  assert.equal(hides(canvas, 'Helvetica Neue', 'mac'), false);
});

test('auto：同一个配置在真 Windows 上结论相反（不是写死的表）', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: false });
  assert.equal(hides(canvas, 'PingFang SC', 'windows'), true);
  assert.equal(hides(canvas, '苹方-简', 'windows'), true);
  assert.equal(hides(canvas, 'Menlo', 'windows'), true);
  assert.equal(hides(canvas, 'Microsoft YaHei', 'windows'), false);
  assert.equal(hides(canvas, 'Segoe UI', 'windows'), false);
});

test('auto：真实平台是 Linux 时，mac 与 Windows 字体都藏', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: false });
  assert.equal(hides(canvas, 'PingFang SC', 'linux'), true);
  assert.equal(hides(canvas, 'Microsoft YaHei', 'linux'), true);
  assert.equal(hides(canvas, 'Ubuntu', 'linux'), false);
  assert.equal(hides(canvas, 'DejaVu Sans', 'linux'), false);
});

test('旧配置里的手动平台值收敛成 auto（不再假装另一个平台）', () => {
  for (const legacy of ['mac', 'windows', 'linux']) {
    assert.equal(canvasOf({ platform: legacy as any }).platform, 'auto', `${legacy} 应该收敛成 auto`);
  }
  // 收敛后按真实平台判定，而不是按旧值
  const canvas = canvasOf({ platform: 'windows' as any, hideCjkFonts: false });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true, '真 Mac 上照样藏 Windows 字体');
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false);
});

test('platform=none：平台层完全关掉，只剩中文层和手动层', () => {
  const canvas = canvasOf({ platform: 'none', hideCjkFonts: false, targetFonts: ['MyCustomFont'] });
  assert.equal(hides(canvas, 'Ubuntu', 'mac'), false);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false);
  assert.equal(hides(canvas, 'MyCustomFont', 'mac'), true);
});

test('中文层与平台层叠加：真 Mac + 隐藏中文 = 连苹方也藏', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: true });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), true);
  assert.equal(hides(canvas, '苹方-简', 'mac'), true);
  // 平台层的非中文项仍在
  assert.equal(hides(canvas, 'Segoe UI', 'mac'), true);
  // 两层都不覆盖的仍然保留
  assert.equal(hides(canvas, 'Helvetica Neue', 'mac'), false);
});

test('最终列表去重（同名字体不会重复出现）', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: true, targetFonts: ['SimSun', 'simsun', 'Comic Sans MS'] });
  const list = resolveCanvasTargetFonts(canvas, 'mac');
  const lowered = list.map((font) => font.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, `有重复项：${list.join(', ')}`);
  assert.ok(list.includes('Comic Sans MS'));
});

// ---------- 绘制面：fillText / strokeText 必须和度量走同一条回落路径 ----------

/**
 * 这一组测试的来历：只改 measureText 时，`measureText` 报"字体缺失"的宽度，
 * `fillText` 却仍用本机真实字形落像素。检测方不用阈值 —— 同一句话用候选族和
 * 一个必然不存在的族各画一遍比像素，不同就说明候选族在。
 */

function makeDrawingContextClass(nativeWidths: Record<string, number> = {}) {
  class DrawingCtx {
    font = '10px monospace';
    draws: Array<{ kind: string; font: string; argc: number; maxWidth?: number }> = [];

    measureText(text: string) {
      return { width: (nativeWidths[this.font] ?? 100) + text.length };
    }

    fillText(text: string, x: number, y: number, maxWidth?: number) {
      this.draws.push({ kind: 'fillText', font: this.font, argc: arguments.length, maxWidth });
      void text; void x; void y;
    }

    strokeText(text: string, x: number, y: number, maxWidth?: number) {
      this.draws.push({ kind: 'strokeText', font: this.font, argc: arguments.length, maxWidth });
      void text; void x; void y;
    }
  }
  return DrawingCtx;
}

const DECLARED = '72px "SimSun", monospace';

test('fillText / strokeText 用的 font 与 measureText 相同（像素和度量不打架）', () => {
  const scope: any = { CanvasRenderingContext2D: makeDrawingContextClass({ [DECLARED]: 999 }) };
  const { deps } = makeDeps();
  installCanvasFontPatches(scope, deps);
  const expected = deps.fallbackFont(DECLARED);
  assert.ok(expected, '测试替身应该命中 SimSun');
  const ctx = new scope.CanvasRenderingContext2D();

  ctx.font = DECLARED;
  const width = ctx.measureText('中文').width;
  ctx.fillText('中文', 3, 4);
  ctx.strokeText('中文', 3, 4);

  // 度量走的是改写后的串（999 的原生宽度不该出现）
  assert.equal(width, 100 + 2);
  assert.equal(ctx.draws.length, 2);
  for (const draw of ctx.draws) {
    assert.equal(draw.font, expected, `${draw.kind} 仍在用被隐藏的字体绘制`);
  }
  // 绘制结束后页面读回的仍是自己写进去的串
  assert.equal(ctx.font, DECLARED);
});

test('maxWidth 按实参个数转发：给了才传第四个参数', () => {
  const scope: any = { CanvasRenderingContext2D: makeDrawingContextClass() };
  installCanvasFontPatches(scope, makeDeps().deps);
  const ctx = new scope.CanvasRenderingContext2D();
  ctx.font = DECLARED;

  ctx.fillText('中文', 1, 2);
  ctx.fillText('中文', 1, 2, 30);
  ctx.strokeText('中文', 1, 2);
  ctx.strokeText('中文', 1, 2, 30);

  assert.deepEqual(ctx.draws.map((draw: any) => draw.argc), [3, 4, 3, 4]);
  assert.equal(ctx.draws[1].maxWidth, 30);
  assert.equal(ctx.draws[3].maxWidth, 30);
});

test('没有命中目标字体时绘制路径原样透传，不改 font', () => {
  const scope: any = { CanvasRenderingContext2D: makeDrawingContextClass() };
  installCanvasFontPatches(scope, makeDeps().deps);
  const ctx = new scope.CanvasRenderingContext2D();
  ctx.font = '16px Arial';
  ctx.fillText('hello', 0, 0);
  assert.equal(ctx.draws[0].font, '16px Arial');
});

test('OffscreenCanvas 上下文的绘制同样被改写', () => {
  const scope: any = {
    CanvasRenderingContext2D: makeDrawingContextClass(),
    OffscreenCanvasRenderingContext2D: makeDrawingContextClass()
  };
  const { deps } = makeDeps();
  const expected = deps.fallbackFont(DECLARED);
  installCanvasFontPatches(scope, deps);
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    const ctx = new scope[name]();
    ctx.font = DECLARED;
    ctx.fillText('中文', 0, 0);
    assert.equal(ctx.draws[0].font, expected, `${name} 的 fillText 没有跟着改写`);
  }
});

test('绘制方法的 name / length / toString 与原生同形，enumerable 保持可枚举', () => {
  const disguise = createDisguise();
  const scope: any = { CanvasRenderingContext2D: makeDrawingContextClass() };
  const proto = scope.CanvasRenderingContext2D.prototype;
  Object.defineProperty(proto, 'fillText', {
    value: proto.fillText, writable: true, enumerable: true, configurable: true
  });
  Object.defineProperty(proto, 'strokeText', {
    value: proto.strokeText, writable: true, enumerable: true, configurable: true
  });

  installCanvasFontPatches(scope, {
    fallbackFont: (font: string) => (font.includes('SimSun') ? '72px monospace' : null),
    disguise,
    define: defineNativeLike
  });
  try {
    for (const key of ['fillText', 'strokeText']) {
      assert.equal(proto[key].name, key);
      assert.equal(proto[key].length, 4, `${key}.length 与 WebIDL 不一致`);
      assert.equal(String(proto[key]), `function ${key}() { [native code] }`);
      assert.equal(Object.getOwnPropertyDescriptor(proto, key)!.enumerable, true);
    }
  } finally {
    // 这个文件里其余测试还要用原生 toString，断言完再还原
    disguise.uninstall();
  }
});

test('uninstall 把 fillText / strokeText 还原成安装前的原生引用', () => {
  const scope: any = { CanvasRenderingContext2D: makeDrawingContextClass() };
  const proto = scope.CanvasRenderingContext2D.prototype;
  const nativeFill = proto.fillText;
  const nativeStroke = proto.strokeText;
  const nativeMeasure = proto.measureText;

  installCanvasFontPatches(scope, makeDeps().deps);
  assert.notEqual(proto.fillText, nativeFill);

  uninstallCanvasFontPatches(scope);
  assert.equal(proto.fillText, nativeFill);
  assert.equal(proto.strokeText, nativeStroke);
  assert.equal(proto.measureText, nativeMeasure);
});
