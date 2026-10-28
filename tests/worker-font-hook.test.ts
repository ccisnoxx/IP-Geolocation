// 文件型 Worker 字体钩子仅保留维护实验，生产继续暂停 HTTP(S)/SharedWorker 接管。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileFontRelatedScripts, compileFontScripts, FONT_WORKER_SCRIPT_PREFIX } from '../src/background/font-scripts';
import { normalizeConfig, createRule } from '../src/shared/config-model';
import { buildWorkerPatchSourceFromFonts } from '../src/injected/runtime-modules/surfaces/workers';
import { VENDOR_SOFTWARE_FONT_FAMILIES } from '../src/shared/font-families';
import { generateWorkerFontHook, assertSelfContainedFunction } from '../build/self-contained-runtime';

function config() {
  const value = normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: false },
      timezone: { enabled: false },
      geolocation: { enabled: false }
    } as any,
    fontExposure: { enabled: true, mode: 'vendor-software' } as any,
    rules: [createRule('example.com')]
  });
  value.rules[0].compatibilityPreset = 'full';
  return value;
}

test('生产字体注册不派发文件型 Worker 钩子，开启 Canvas 也不恢复接管', () => {
  const value = config();
  const filter = compileFontScripts(value);
  assert.equal(filter.length, 1);
  assert.deepEqual(compileFontRelatedScripts(value), filter);
  value.fontExposure.canvasSpoof.enabled = true;
  const scripts = compileFontRelatedScripts(value);
  assert.equal(scripts.length, 2);
  assert.ok(scripts.every(script => !script.id.startsWith(FONT_WORKER_SCRIPT_PREFIX)
    && !script.js?.includes('worker-fonts/hook.js')));

  const custom = config(); custom.fontExposure.mode = 'custom';
  assert.deepEqual(compileFontRelatedScripts(custom), []);
  const off = config(); off.fontExposure.enabled = false;
  assert.deepEqual(compileFontRelatedScripts(off), []);
  const consistency = config(); consistency.rules[0].compatibilityPreset = 'consistency';
  assert.deepEqual(compileFontRelatedScripts(consistency), []);
});

test('补丁源只带字体名单，不带语言/时区（避免和页面运行时抢 Worker 行为）', () => {
  const source = buildWorkerPatchSourceFromFonts(['SimSun', 'SimHei'], () => {});
  assert.match(source, /"blockedFonts":\["SimSun","SimHei"\]/);
  assert.match(source, /"timezone":null/);
  assert.match(source, /"language":null/);
  assert.match(source, /"languages":null/);
});

test('维护实验生成器自包含且能包装文件型 Worker，不作为生产恢复证据', async () => {
  const generated = await generateWorkerFontHook();
  const hook = assertSelfContainedFunction(generated.code, 'applyWorkerFontHook');
  assert.match(hook, /OffscreenCanvasRenderingContext2D/);
  assert.match(hook, /FontFaceSet/);
  assert.match(hook, new RegExp(VENDOR_SOFTWARE_FONT_FAMILIES[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const blobs = new Map<string, Blob>();
  // Dedicated Worker 构造完成后立刻 revoke，所以另留一份内容引用用于断言
  const created: Blob[] = [];
  const workers: string[] = [];
  let next = 0;
  class URLMock extends URL {
    static createObjectURL(blob: Blob) { const url = `blob:https://example.test/${++next}`; blobs.set(url, blob); created.push(blob); return url; }
    static revokeObjectURL(url: string) { blobs.delete(url); }
  }
  class WorkerMock {
    constructor(readonly url: string) { workers.push(url); }
    terminate() {}
  }
  const context = vm.createContext({ URL: URLMock, Blob, Worker: WorkerMock,
    location: { href: 'https://example.test/app', protocol: 'https:' }, origin: 'https://example.test',
    addEventListener() {}, Reflect, Proxy, Object, Function, JSON, Set, Map, Symbol, TypeError, String, Array, RegExp, Error },
    { codeGeneration: { strings: false, wasm: false } });
  const native = vm.runInContext('Worker', context);
  vm.runInContext(`globalThis.self = globalThis; (${hook})();`, context);
  assert.notEqual(vm.runInContext('Worker', context), native);
  vm.runInContext(`new Worker('/worker.js')`, context);
  assert.equal(workers.length, 1);
  assert.match(workers[0], /^blob:/);
  assert.equal(created.length, 1);
  const body = await created[0].text();
  assert.match(body, /blockedFonts/);
  assert.match(body, /importScripts\("https:\/\/example\.test\/worker\.js"\)/);
});
