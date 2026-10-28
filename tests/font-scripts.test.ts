import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileFontScripts, reconcileFontScripts, syncFontScriptRegistration, FONT_SCRIPT_PREFIX, FONT_WORKER_SCRIPT_PREFIX, FONT_FILTER_PRODUCTION_APPROVED } from '../src/background/font-scripts';
import { compileFontPolicyScripts } from '../src/background/page-scripts';
import { createInitialConfig, createRule, VENDOR_SOFTWARE_FONT_FAMILIES } from '../src/shared/config-model';
import { generateFontFilter, assertSelfContainedFunction } from '../build/self-contained-runtime';

function config() {
  const value = createInitialConfig();
  value.masterEnabled = true;
  value.fontExposure.enabled = true;
  value.fontExposure.mode = 'vendor-software';
  value.fontExposure.blockedFamilies = [...VENDOR_SOFTWARE_FONT_FAMILIES];
  delete value.fontExposure.layers;
  value.rules = [createRule('example.test'), createRule('sub.example.test')];
  return value;
}

test('固定字体候选仅派生启用allowlist，不携带配置；custom/关闭不注册', () => {
  const value = config();
  const scripts = compileFontScripts(value);
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts[0].matches, ['*://example.test/*', '*://*.example.test/*']);
  assert.deepEqual(scripts[0].excludeMatches, ['*://*.sub.example.test/*', '*://sub.example.test/*']);
  for (const script of scripts) {
    assert.deepEqual(script.js, ['font-exposure/filter.js']);
    assert.equal(script.world, 'MAIN'); assert.equal(script.runAt, 'document_start');
    assert.equal(script.allFrames, true); assert.equal(script.matchOriginAsFallback, false);
  }
  value.rules[1].enabled = false;
  assert.equal(compileFontScripts(value).length, 1);
  value.fontExposure.enabled = false; assert.deepEqual(compileFontScripts(value), []);
  value.fontExposure.enabled = true;
  value.fontExposure.mode = 'custom'; assert.deepEqual(compileFontScripts(value), []);
  value.fontExposure.mode = 'vendor-software'; value.masterEnabled = false;
  assert.deepEqual(compileFontScripts(value), []);
});

test('获准固定名单按实际注册报告就绪，custom撤销且不触碰其他组件，失败保持未知', async () => {
  const previous = globalThis.chrome;
  let actual: chrome.scripting.RegisteredContentScript[] = [{ id: FONT_SCRIPT_PREFIX + 'example.test' },
    { id: FONT_WORKER_SCRIPT_PREFIX + 'example.test', js: ['worker-fonts/hook.js'] }, { id: 'other-extension-component' }];
  let writes = 0;
  let policies: chrome.userScripts.RegisteredUserScript[] = [];
  Object.assign(globalThis, { chrome: { permissions: { contains: async () => true }, userScripts: {
    getScripts: async () => structuredClone(policies),
    register: async (scripts: chrome.userScripts.RegisteredUserScript[]) => { policies.push(...structuredClone(scripts)); },
    update: async (scripts: chrome.userScripts.RegisteredUserScript[]) => { policies = policies.map(item => scripts.find(script => script.id === item.id) || item); },
    unregister: async ({ ids }: { ids: string[] }) => { policies = policies.filter(script => !ids.includes(script.id)); }
  }, scripting: {
    getRegisteredContentScripts: async () => structuredClone(actual),
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => { writes++; actual = actual.filter(s => !ids.includes(s.id)); },
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { writes++; actual.push(...structuredClone(scripts)); }
  } } });
  try {
    assert.equal(FONT_FILTER_PRODUCTION_APPROVED, true);
    const report = await reconcileFontScripts(config(), undefined, 'function applyFixedFontFilter() {}');
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.fontRuntime, { state: 'ready', registeredRuleCount: 2, reloadRequired: false });
    // 撤销实验遗留的文件型 Worker 钩子，仅保留生产允许的字体脚本。
    assert.deepEqual(actual, [{ id: 'other-extension-component' }]);
    assert.deepEqual(policies, compileFontPolicyScripts(config(), 'function applyFixedFontFilter() {}'));
    assert.equal((await reconcileFontScripts(config(), undefined, 'function applyFixedFontFilter() {}')).status, 'ok'); assert.equal(writes, 1);
    const custom = config(); custom.fontExposure.mode = 'custom';
    assert.equal((await reconcileFontScripts(custom, undefined, 'function applyFixedFontFilter() {}')).fontRuntime.state, 'ready');
    assert.deepEqual(actual, [{ id: 'other-extension-component' }]);
    custom.masterEnabled = false;
    assert.equal((await reconcileFontScripts(custom)).fontRuntime.state, 'disabled');
    chrome.scripting.getRegisteredContentScripts = async () => { throw new Error('synthetic'); };
    const failed = await reconcileFontScripts(config(), undefined, 'function applyFixedFontFilter() {}');
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.fontRuntime, { state: 'sync-failed', registeredRuleCount: null, reloadRequired: false });
  } finally { globalThis.chrome = previous; }
});

test('字体候选自包含且只接收最小配置；不支持文档不修改原型', async () => {
  const generated = await generateFontFilter();
  const fn = assertSelfContainedFunction(generated.code, 'applyFixedFontFilter');
  assert.doesNotMatch(fn, /DEFAULT_RULE_DOMAINS|createInitialConfig|createRule|chrome\.|storage|executeScript|installLanguageSpoof|installDateTimeSpoof|installWorkerHooks|installGeolocation/);
  for (const font of VENDOR_SOFTWARE_FONT_FAMILIES) assert.ok(fn.includes(font));
  for (const [protocol, origin] of [['about:', 'http://example.test'], ['https:', 'null']]) {
    const context = vm.createContext({ location: { protocol }, origin }, { codeGeneration: { strings: false, wasm: false } });
    const before = vm.runInContext('Reflect.ownKeys(globalThis)', context);
    vm.runInContext(`(${fn})();`, context);
    assert.deepEqual(vm.runInContext('Reflect.ownKeys(globalThis)', context), before);
  }
});

test('所有字体模式使用同一参数化入口，先撤文件旧入口，撤销失败不新增', async () => {
  const previous = globalThis.chrome;
  const fixed = config(); fixed.rules.pop();
  const layered = structuredClone(fixed);
  layered.fontExposure = { ...fixed.fontExposure, mode: 'layered', layers: { platform: 'none', hideCjkFonts: false }, blockedFamilies: ['Synthetic Custom'] };
  let content = compileFontScripts(fixed);
  let policies: chrome.userScripts.RegisteredUserScript[] = [];
  const calls: string[] = [];
  Object.assign(globalThis, { chrome: { permissions: { contains: async () => true },
    scripting: {
      getRegisteredContentScripts: async () => structuredClone(content),
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => { calls.push('content-remove'); content = content.filter(item => !ids.includes(item.id)); },
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { calls.push('content-add'); content.push(...structuredClone(scripts)); }
    }, userScripts: {
      getScripts: async () => structuredClone(policies), update: async (scripts: chrome.userScripts.RegisteredUserScript[]) => { calls.push('policy-update'); policies = policies.map(item => scripts.find(script => script.id === item.id) || item); },
      unregister: async ({ ids }: { ids: string[] }) => { calls.push('policy-remove'); policies = policies.filter(item => !ids.includes(item.id)); },
      register: async (scripts: chrome.userScripts.RegisteredUserScript[]) => { calls.push('policy-add'); policies.push(...structuredClone(scripts)); }
    }
  } });
  try {
    assert.equal((await reconcileFontScripts(layered, undefined, 'function filter() {}')).status, 'ok');
    assert.deepEqual(calls, ['content-remove', 'policy-add']);
    calls.length = 0;
    assert.equal((await reconcileFontScripts(fixed, undefined, 'function filter() {}')).status, 'ok');
    assert.deepEqual(calls, ['policy-update']);
    await reconcileFontScripts(layered, undefined, 'function filter() {}');
    calls.length = 0;
    chrome.userScripts.unregister = async () => { calls.push('policy-remove'); throw new Error('synthetic failure'); };
    const disabled = { ...fixed, masterEnabled: false };
    const result = await reconcileFontScripts(disabled, undefined, 'function filter() {}');
    assert.equal(result.status, 'failed');
    assert.deepEqual(calls, ['policy-remove']);
    assert.deepEqual(content, []);
    assert.equal(policies.length, 1);
  } finally { globalThis.chrome = previous; }
});


test('固定候选原生对账先撤范围变化再注册，幂等且不碰其他注册', async () => {
  const previous = globalThis.chrome;
  const value = config();value.rules.pop();
  let actual: chrome.scripting.RegisteredContentScript[] = [...compileFontScripts(value), {id:'other-component',js:['other.js']}];
  const events: string[] = [];
  Object.assign(globalThis, {chrome:{scripting:{
    getRegisteredContentScripts: async () => structuredClone(actual),
    unregisterContentScripts: async ({ids}: {ids:string[]}) => {events.push('unregister');actual=actual.filter(script=>!ids.includes(script.id));},
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {events.push('register');actual.push(...structuredClone(scripts));}
  }}});
  try {
    value.rules.push(createRule('sub.example.test'));
    assert.equal((await syncFontScriptRegistration(compileFontScripts(value))).status,'ok');
    assert.deepEqual(events,['unregister','register']);
    events.length=0;
    assert.equal((await syncFontScriptRegistration(compileFontScripts(value))).status,'ok');
    assert.deepEqual(events,[]);
    chrome.scripting.unregisterContentScripts=async()=>{throw new Error('synthetic revoke failure')};
    assert.equal((await syncFontScriptRegistration([])).status,'failed');
    assert.deepEqual(events,[]);assert.equal(actual.length,3);
  } finally {globalThis.chrome=previous;}
});

test('字体实际注册变化先预写，预写失败零变更，幂等对账不预写', async () => {
  const previous = globalThis.chrome;
  const value = config(); value.rules.pop();
  const foreign = { id: 'other-component', js: ['other.js'] };
  let actual = [...compileFontScripts(value), foreign];
  const events: string[] = [];
  Object.assign(globalThis, { chrome: { scripting: {
    getRegisteredContentScripts: async () => structuredClone(actual),
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
      events.push('unregister'); actual = actual.filter(script => !ids.includes(script.id));
    },
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
      events.push('register'); actual.push(...structuredClone(scripts));
    }
  } } });
  try {
    const before = structuredClone(actual);
    value.rules.push(createRule('sub.example.test'));
    const failPrewrite = async () => { events.push('prewrite-failed'); throw new Error('合成预写失败'); };
    assert.equal((await syncFontScriptRegistration(compileFontScripts(value), failPrewrite)).status, 'failed');
    assert.deepEqual(events, ['prewrite-failed']);
    assert.deepEqual(actual, before);
    events.length = 0;
    const prewrite = async () => { events.push('prewrite'); };
    assert.equal((await syncFontScriptRegistration(compileFontScripts(value), prewrite)).status, 'ok');
    assert.deepEqual(events, ['prewrite', 'unregister', 'register']);
    events.length = 0;
    assert.equal((await syncFontScriptRegistration(compileFontScripts(value), prewrite)).status, 'ok');
    assert.deepEqual(events, []);
    assert.equal((await syncFontScriptRegistration([], failPrewrite)).status, 'failed');
    assert.deepEqual(events, ['prewrite-failed']);
    events.length = 0;
    assert.equal((await syncFontScriptRegistration([], prewrite)).status, 'ok');
    assert.deepEqual(events, ['prewrite', 'unregister']);
    assert.deepEqual(actual, [foreign]);
  } finally { globalThis.chrome = previous; }
});

test('生产固定入口在顶层及iframe仅过滤43项，其他显式字体测量和font属性保持原生', async () => {
  const fn = assertSelfContainedFunction((await generateFontFilter()).code, 'applyFixedFontFilter');
  for (const isTop of [true, false]) {
    const context = vm.createContext({ location: { protocol: 'https:' }, origin: 'https://example.test' },
      { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(`globalThis.window = globalThis; globalThis.top = ${isTop ? 'globalThis' : '{}'};
      const fonts = new WeakMap();
      globalThis.CanvasRenderingContext2D = class {
        constructor() { fonts.set(this, '10px sans-serif'); }
        get font() { return fonts.get(this); }
        set font(value) { fonts.set(this, value); }
        measureText(text) { return { font: this.font, text: String(text) }; }
      };
      globalThis.ctx = new CanvasRenderingContext2D();`, context);
    vm.runInContext(`(${fn})();`, context);
    for (const font of VENDOR_SOFTWARE_FONT_FAMILIES) {
      context.sampleFont = `20px "${font}", Arial, serif`;
      assert.equal(vm.runInContext('ctx.font = sampleFont; ctx.measureText("字A").font', context), '20px Arial, serif');
      assert.equal(vm.runInContext('ctx.font', context), context.sampleFont);
    }
    for (const font of ['20px Arial', '20px "Mi Sans"', '20px PingFangSC', '20px PingFang\\a0 SC', '20px PingFang\\20\\20SC', '20px PingFang\u00a0SC', '20px MiSans\u00a0', '20px "PingFang  SC"', '20px "Future Font"', '20px "测试字体"', '20px "serif"', '20px monospace, sans-serif']) {
      context.sampleFont = font;
      assert.equal(vm.runInContext('ctx.font = sampleFont; ctx.measureText("字A").font', context), font);
    }
  }
});
