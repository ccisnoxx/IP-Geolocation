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
import { installCanvasFontPatches } from '../src/injected/canvas-patch';
import { normalizeConfig } from '../src/shared/config-model';
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
        Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: false });
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

test('没有原生 measureText 时安静跳过，不抛错', () => {
  const scope: any = { CanvasRenderingContext2D: class {}, OffscreenCanvasRenderingContext2D: undefined };
  assert.deepEqual(installCanvasFontPatches(scope, makeDeps().deps), []);
});

test('重复安装保持幂等：再装一次仍是同一个函数引用', () => {
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
  assert.equal(migrated.schemaVersion, 4);
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

test('声称 mac：隐藏 Windows / Linux 字体，保留 mac 自带', () => {
  const canvas = canvasOf({ platform: 'mac', hideCjkFonts: false });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true);
  assert.equal(hides(canvas, '微软雅黑', 'mac'), true, '中文别名同样命中');
  assert.equal(hides(canvas, 'Segoe UI', 'mac'), true);
  assert.equal(hides(canvas, 'Ubuntu', 'mac'), true);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false, 'mac 自带的苹方不该被藏');
  assert.equal(hides(canvas, 'Helvetica Neue', 'mac'), false);
});

test('声称 windows：隐藏 mac / Linux 字体，保留 Windows 自带', () => {
  const canvas = canvasOf({ platform: 'windows', hideCjkFonts: false });
  assert.equal(hides(canvas, 'PingFang SC', 'windows'), true);
  assert.equal(hides(canvas, '苹方-简', 'windows'), true);
  assert.equal(hides(canvas, 'Menlo', 'windows'), true);
  assert.equal(hides(canvas, 'Ubuntu', 'windows'), true);
  assert.equal(hides(canvas, 'Microsoft YaHei', 'windows'), false);
  assert.equal(hides(canvas, 'Segoe UI', 'windows'), false);
});

test('声称 linux：mac 与 Windows 字体都隐藏，Linux 自带保留', () => {
  const canvas = canvasOf({ platform: 'linux', hideCjkFonts: false });
  assert.equal(hides(canvas, 'PingFang SC', 'linux'), true);
  assert.equal(hides(canvas, 'Microsoft YaHei', 'linux'), true);
  assert.equal(hides(canvas, 'Ubuntu', 'linux'), false);
  assert.equal(hides(canvas, 'DejaVu Sans', 'linux'), false);
});

test('platform=none：平台层完全关掉，只剩中文层和手动层', () => {
  const canvas = canvasOf({ platform: 'none', hideCjkFonts: false, targetFonts: ['MyCustomFont'] });
  assert.equal(hides(canvas, 'Ubuntu', 'mac'), false);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false);
  assert.equal(hides(canvas, 'MyCustomFont', 'mac'), true);
});

test('platform=auto：按传入的真实平台解析', () => {
  const canvas = canvasOf({ platform: 'auto', hideCjkFonts: false });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), false);
  assert.equal(hides(canvas, 'Microsoft YaHei', 'windows'), false);
  assert.equal(hides(canvas, 'PingFang SC', 'windows'), true);
});

test('中文层与平台层叠加：声称 mac + 隐藏中文 = 连苹方也藏', () => {
  const canvas = canvasOf({ platform: 'mac', hideCjkFonts: true });
  assert.equal(hides(canvas, 'Microsoft YaHei', 'mac'), true);
  assert.equal(hides(canvas, 'PingFang SC', 'mac'), true);
  assert.equal(hides(canvas, '苹方-简', 'mac'), true);
  // 平台层的非中文项仍在
  assert.equal(hides(canvas, 'Segoe UI', 'mac'), true);
  // 两层都不覆盖的仍然保留
  assert.equal(hides(canvas, 'Helvetica Neue', 'mac'), false);
});

test('最终列表去重（同名字体不会重复出现）', () => {
  const canvas = canvasOf({ platform: 'mac', hideCjkFonts: true, targetFonts: ['SimSun', 'simsun', 'Comic Sans MS'] });
  const list = resolveCanvasTargetFonts(canvas, 'mac');
  const lowered = list.map((font) => font.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, `有重复项：${list.join(', ')}`);
  assert.ok(list.includes('Comic Sans MS'));
});
