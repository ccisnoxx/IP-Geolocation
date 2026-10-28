// P2 回归：Worker 里没有 CanvasRenderingContext2D／document.fonts，字体伪装必须单独补到
// OffscreenCanvasRenderingContext2D.measureText 与 FontFaceSet.check 上，否则 Worker 一测就穿帮。
// 名单随 payload 进 Blob Worker（含嵌套），页面运行时 graph 保持不含 worker/ 依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkerFonts } from '../src/injected/runtime-modules/surfaces/offscreen-fonts';
import { buildWorkerPatchSource } from '../src/injected/runtime-modules/surfaces/workers';

const WIDTHS: Record<string, number> = { '"simsun"': 56.45, monospace: 38.53, 'sans-serif': 40.1 };

function widthFor(font: string): number {
  const family = font.slice(font.indexOf('px') + 2).trim().replace(/^"|"$/g, '').toLowerCase();
  return WIDTHS[`"${family}"`] ?? WIDTHS[family] ?? 40;
}

function workerRealm() {
  class OffscreenCanvasRenderingContext2D {
    #font = '10px sans-serif';
    get font() { return this.#font; }
    set font(value: string) { this.#font = `${value}`; }
    measureText(text: string) { return { width: widthFor(this.#font) + text.length * 0 }; }
  }
  class FontFaceSet {
    check(font: string) { return widthFor(font) !== WIDTHS['"simsun"']; }
  }
  const root = { OffscreenCanvasRenderingContext2D, FontFaceSet } as any;
  return { root, fonts: new FontFaceSet(), context: new OffscreenCanvasRenderingContext2D() };
}

test('Worker 的 OffscreenCanvas.measureText 命中屏蔽字体时改用后备字体测量', () => {
  const realm = workerRealm();
  realm.context.font = '16px "SimSun"';
  const native = realm.context.measureText('MMMM').width;
  assert.equal(native, WIDTHS['"simsun"']);

  installWorkerFonts(realm.root, { blockedFonts: ['SimSun'] });

  assert.equal(realm.context.measureText('MMMM').width, WIDTHS.monospace);
  // 测量结束后 font 必须还原，否则页面后续绘制会被改字体
  assert.equal(realm.context.font, '16px "SimSun"');
  // 未命中名单的字体保持原样
  realm.context.font = '16px sans-serif';
  assert.equal(realm.context.measureText('MMMM').width, WIDTHS['sans-serif']);
});

test('Worker 的 FontFaceSet.check 对被屏蔽字体返回 false，其余照旧', () => {
  const realm = workerRealm();
  installWorkerFonts(realm.root, { blockedFonts: ['SimSun'] });
  assert.equal(realm.fonts.check('16px "SimSun"'), false);
  assert.equal(realm.fonts.check('16px sans-serif'), true);
});

test('没有名单时不装补丁（保持原生实现，避免误伤）', () => {
  const realm = workerRealm();
  const before = realm.root.OffscreenCanvasRenderingContext2D.prototype.measureText;
  installWorkerFonts(realm.root, { blockedFonts: [] });
  assert.equal(realm.root.OffscreenCanvasRenderingContext2D.prototype.measureText, before);
  assert.equal(realm.context.measureText('MMMM').width, WIDTHS['sans-serif']);
});

test('字体名单随 worker 补丁一起下发，且只在字体伪装开启时带值', () => {
  const payload = {
    extensionEnabled: true,
    intlMode: 'strict',
    debugMode: false,
    ruleId: 'r1',
    domain: 'example.test',
    geolocation: null,
    latitude: null,
    longitude: null,
    timezone: 'America/Los_Angeles',
    timezoneSource: 'manual',
    languageConfig: { enabled: true, language: 'en-US', languages: ['en-US', 'en'], mode: 'custom' },
    timezoneConfig: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
    fontExposureConfig: { enabled: true, mode: 'vendor-software', blockedFamilies: ['SimSun', 'SimHei'] }
  } as any;
  const source = buildWorkerPatchSource(payload, () => {});
  assert.match(source, /"blockedFonts":\["SimSun","SimHei"\]/);

  payload.fontExposureConfig.enabled = false;
  assert.match(buildWorkerPatchSource(payload, () => {}), /"blockedFonts":\[\]/);
});

test('生产 Blob Worker bootstrap 收到名单后在真 Worker realm 里改掉 OffscreenCanvas 测量', async () => {
  const { generateBlobWorkerRuntime, assertSelfContainedFunction } = await import('../build/self-contained-runtime');
  const vm = (await import('node:vm')).default;
  const generated = await generateBlobWorkerRuntime();
  const bootstrap = assertSelfContainedFunction(generated.code, 'applyBlobWorkerRuntime');
  const context = vm.createContext({ URL, Blob,
    OffscreenCanvasRenderingContext2D: class {
      #font = '10px sans-serif';
      get font() { return this.#font; }
      set font(value: string) { this.#font = `${value}`; }
      measureText() { return { width: widthFor(this.#font) }; }
    },
    FontFaceSet: class { check(font: string) { return widthFor(font) !== WIDTHS['"simsun"']; } },
    addEventListener() {}, navigator: { language: 'zh-CN', languages: ['zh-CN'] } }, { codeGeneration: { strings: false, wasm: false } });
  const payload = { intlMode: 'strict', timezone: 'America/Los_Angeles', blockedFonts: ['SimSun'] };
  vm.runInContext(`globalThis.self = globalThis; (${bootstrap})(${JSON.stringify(payload)})`, context);
  assert.equal(vm.runInContext(`(() => { const c = new OffscreenCanvasRenderingContext2D(); c.font = '16px "SimSun"';
    const width = c.measureText('M').width; return [width, c.font]; })()`, context)[0], WIDTHS.monospace);
  assert.equal(vm.runInContext(`new FontFaceSet().check('16px "SimSun"')`, context), false);
});

test('解析器把字体名单下发到页面 payload，且与 font-scripts 的注册条件一致', async () => {
  const { normalizeConfig, createRule } = await import('../src/shared/config-model');
  const { getLanguageTimezonePayload } = await import('../src/shared/config-resolver');
  const base = () => normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: true, mode: 'custom', language: 'en-US', languages: ['en-US', 'en'] },
      timezone: { enabled: false }, geolocation: { enabled: false }
    } as any,
    fontExposure: { enabled: true, mode: 'vendor-software' } as any,
    rules: [createRule('example.test')]
  });
  const on = base();
  on.rules[0].compatibilityPreset = 'full';
  assert.ok((getLanguageTimezonePayload(on, 'example.test')?.blockedFonts || []).length > 0);

  const off = base();
  off.rules[0].compatibilityPreset = 'full';
  off.fontExposure.enabled = false;
  assert.equal(getLanguageTimezonePayload(off, 'example.test')?.blockedFonts, undefined);

  const custom = base();
  custom.rules[0].compatibilityPreset = 'full';
  custom.fontExposure.mode = 'custom';
  assert.equal(getLanguageTimezonePayload(custom, 'example.test')?.blockedFonts, undefined);
});
