// Canvas 字体伪装：按声称平台把对端专有字体换成等价字体，量宽与 check() 都要跟着变。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { canvasFontReplacementMap, WINDOWS_TO_MACOS } from '../src/shared/canvas-fonts';
import { installCanvasFontSpoof, mapCanvasFont } from '../src/injected/runtime-modules/surfaces/canvas-fonts';
import { compileCanvasFontScripts, compileFontRelatedScripts } from '../src/background/font-scripts';
import { createRule, normalizeConfig } from '../src/shared/config-model';
import { generateCanvasFontSpoof, assertSelfContainedFunction } from '../build/self-contained-runtime';

const WIDTHS: Record<string, number> = { 'segoe ui': 56.45, 'helvetica neue': 44.1, 'pingfang sc': 46.2, 'microsoft yahei': 58.7 };

function realm() {
  function widthFor(font: string) {
    const name = font.slice(font.indexOf('px') + 2).trim().replace(/^"|"$/g, '').toLowerCase();
    return WIDTHS[name] ?? 40;
  }
  class CanvasRenderingContext2D {
    #font = '10px sans-serif';
    get font() { return this.#font; }
    set font(value: string) { this.#font = `${value}`; }
    measureText(text: string) { return { width: widthFor(this.#font) + text.length * 0 }; }
  }
  class FontFaceSet { check(font: string) { return (WIDTHS[font.slice(font.indexOf('px') + 2).trim().replace(/^"|"$/g, '').toLowerCase()] ?? 0) > 0; } }
  const root = { CanvasRenderingContext2D, FontFaceSet } as any;
  return { root, ctx: new CanvasRenderingContext2D(), fonts: new FontFaceSet() };
}

test('macOS 平台下 Windows 专有字体按 mac 等价字体重写，未命中保持原样', () => {
  const plain = realm();
  const ctx = plain.ctx;
  ctx.font = '16px "Segoe UI"';
  assert.equal(ctx.measureText('MMMM').width, WIDTHS['segoe ui']);
  const patched = realm();
  installCanvasFontSpoof(patched.root, { platform: 'macos', replacements: canvasFontReplacementMap('macos') });
  patched.ctx.font = '16px "Segoe UI"';
  assert.equal(patched.ctx.measureText('MMMM').width, WIDTHS['helvetica neue']);
  // 测量后 font 必须还原，否则后续绘制被改字体
  assert.equal(patched.ctx.font, '16px "Segoe UI"');
  // mac 自己的字体不受影响
  patched.ctx.font = '16px "Helvetica Neue"';
  assert.equal(patched.ctx.measureText('MMMM').width, WIDTHS['helvetica neue']);
});

test('FontFaceSet.check 对声称平台装不上的字体一律 false', () => {
  const patched = realm();
  installCanvasFontSpoof(patched.root, { platform: 'macos', replacements: canvasFontReplacementMap('macos') });
  assert.equal(patched.fonts.check('16px "Microsoft YaHei"'), false);
  assert.equal(patched.fonts.check('16px "PingFang SC"'), true);
});

test('font 简写解析保留 size/weight，只替换族名；无命中返回 null', () => {
  assert.equal(mapCanvasFont('italic 700 16px "Segoe UI", sans-serif', { 'segoe ui': 'Helvetica Neue' }), 'italic 700 16px Helvetica Neue, sans-serif');
  assert.equal(mapCanvasFont('16px sans-serif', { 'segoe ui': 'Helvetica Neue' }), null);
  assert.equal(WINDOWS_TO_MACOS['microsoft yahei'], 'PingFang SC');
});

test('注册门禁：字体过滤 + canvas 开关 + full 规则，按平台选产物', () => {
  const build = (patch: (config: any) => void = () => {}) => {
    const value = normalizeConfig({
      masterEnabled: true,
      globalProfile: { language: { enabled: false }, timezone: { enabled: false }, geolocation: { enabled: false } } as any,
      fontExposure: { enabled: true, mode: 'vendor-software', canvasSpoof: { enabled: true, platform: 'macos' } } as any,
      rules: [createRule('example.com')]
    });
    value.rules[0].compatibilityPreset = 'full';
    patch(value);
    return value;
  };
  const mac = compileCanvasFontScripts(build());
  assert.equal(mac.length, 1);
  assert.deepEqual(mac[0].js, ['canvas-fonts/macos.js']);
  assert.equal(mac[0].world, 'MAIN');
  assert.equal(mac[0].runAt, 'document_start');
  assert.deepEqual(compileCanvasFontScripts(build(c => { c.fontExposure.canvasSpoof.platform = 'windows'; }))[0].js, ['canvas-fonts/windows.js']);
  assert.deepEqual(compileCanvasFontScripts(build(c => { c.fontExposure.canvasSpoof.enabled = false; })), []);
  assert.deepEqual(compileCanvasFontScripts(build(c => { c.fontExposure.enabled = false; })), []);
  assert.deepEqual(compileCanvasFontScripts(build(c => { c.rules[0].compatibilityPreset = 'consistency'; })), []);
  // 页面过滤与 Canvas 脚本；不派发文件型 Worker 钩子。
  assert.equal(compileFontRelatedScripts(build()).length, 2);
});

test('生成的 canvas 产物自包含，并在真 realm 内完成替换', async () => {
  const generated = await generateCanvasFontSpoof();
  const fn = assertSelfContainedFunction(generated.code, 'applyCanvasFontSpoof');
  const context = vm.createContext({
    location: { protocol: 'https:', href: 'https://example.test/' }, origin: 'https://example.test',
    CanvasRenderingContext2D: class {
      #font = '10px sans-serif';
      get font() { return this.#font; }
      set font(value: string) { this.#font = `${value}`; }
      measureText() { return { width: WIDTHS[this.#font.slice(this.#font.indexOf('px') + 2).trim().replace(/^"|"$/g, '').toLowerCase()] ?? 40 }; }
    },
    FontFaceSet: class { check() { return true; } },
    Object, Function, JSON, RegExp, String, Array, TypeError
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`globalThis.self = globalThis; (${fn})('macos');`, context);
  const width = vm.runInContext(`(() => { const c = new CanvasRenderingContext2D(); c.font = '16px "Segoe UI"'; return c.measureText('M').width; })()`, context);
  assert.equal(width, WIDTHS['helvetica neue']);
});
