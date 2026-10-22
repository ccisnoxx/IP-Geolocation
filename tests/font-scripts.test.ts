import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compileFontScripts, reconcileFontScripts, syncFontScriptRegistration, FONT_SCRIPT_PREFIX, FONT_FILTER_PRODUCTION_APPROVED } from '../src/background/font-scripts';
import { createInitialConfig, createRule, VENDOR_SOFTWARE_FONT_FAMILIES } from '../src/shared/config-model';
import { generateFontFilter, assertSelfContainedFunction } from '../build/self-contained-runtime';

function config() {
  const value = createInitialConfig();
  value.masterEnabled = true;
  value.fontExposure.enabled = true;
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
  let actual: chrome.scripting.RegisteredContentScript[] = [{ id: FONT_SCRIPT_PREFIX + 'example.test' }, { id: 'other-extension-component' }];
  let writes = 0;
  Object.assign(globalThis, { chrome: { scripting: {
    getRegisteredContentScripts: async () => structuredClone(actual),
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => { writes++; actual = actual.filter(s => !ids.includes(s.id)); },
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { writes++; actual.push(...structuredClone(scripts)); }
  } } });
  try {
    assert.equal(FONT_FILTER_PRODUCTION_APPROVED, true);
    const report = await reconcileFontScripts(config());
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.fontRuntime, { state: 'ready', registeredRuleCount: 2, reloadRequired: false });
    assert.deepEqual(actual, [{ id: 'other-extension-component' }, ...compileFontScripts(config())]);
    assert.equal((await reconcileFontScripts(config())).status, 'ok'); assert.equal(writes, 2);
    const custom = config(); custom.fontExposure.mode = 'custom';
    assert.equal((await reconcileFontScripts(custom)).fontRuntime.state, 'custom-paused');
    assert.deepEqual(actual, [{ id: 'other-extension-component' }]);
    custom.masterEnabled = false;
    assert.equal((await reconcileFontScripts(custom)).fontRuntime.state, 'disabled');
    chrome.scripting.getRegisteredContentScripts = async () => { throw new Error('synthetic'); };
    const failed = await reconcileFontScripts(config());
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.fontRuntime, { state: 'sync-failed', registeredRuleCount: null, reloadRequired: false });
  } finally { globalThis.chrome = previous; }
});

test('固定候选自包含且无动态输入；不支持文档不修改原型', async () => {
  const generated = await generateFontFilter();
  const fn = assertSelfContainedFunction(generated.code, 'applyFixedFontFilter');
  assert.doesNotMatch(fn, /DEFAULT_RULE_DOMAINS|createInitialConfig|createRule|chrome\.|storage|postMessage|executeScript|installLanguageSpoof|installDateTimeSpoof|installWorkerHooks|installGeolocation/);
  for (const font of VENDOR_SOFTWARE_FONT_FAMILIES) assert.ok(fn.includes(font));
  for (const [protocol, origin] of [['about:', 'http://example.test'], ['https:', 'null']]) {
    const context = vm.createContext({ location: { protocol }, origin }, { codeGeneration: { strings: false, wasm: false } });
    const before = vm.runInContext('Reflect.ownKeys(globalThis)', context);
    vm.runInContext(`(${fn})();`, context);
    assert.deepEqual(vm.runInContext('Reflect.ownKeys(globalThis)', context), before);
  }
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
