import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compilePageScripts, compileGeolocationScripts, reconcileGeolocationScripts, PAGE_SCRIPT_PREFIX, reconcilePageScripts } from '../src/background/page-scripts';
import { createInitialConfig, createRule, normalizeLanguage, normalizeTimezone } from '../src/shared/config-model';
import { getLanguageTimezonePayload } from '../src/shared/config-resolver';
import { generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';

const source = 'function applyLanguageTimezoneRuntime(payload) { globalThis.sample = payload; }';
function config() {
  const value = createInitialConfig();
  value.masterEnabled = true;
  value.globalProfile.language = normalizeLanguage({ enabled: true, language: 'ja-JP', languages: ['ja-JP', 'ja'] });
  value.globalProfile.timezone = normalizeTimezone({ mode: 'manual', timezone: 'Asia/Tokyo' });
  value.rules = [createRule('example.test')];
  return value;
}
function browser(actual: chrome.userScripts.RegisteredUserScript[] = []) {
  const previous = globalThis.chrome;
  const events: string[] = [];
  const api = {
    getScripts: async () => structuredClone(actual),
    unregister: async ({ ids }: { ids: string[] }) => { events.push('unregister'); actual = actual.filter(script => !ids.includes(script.id)); },
    update: async (scripts: chrome.userScripts.RegisteredUserScript[]) => {
      events.push('update'); actual = actual.map(script => scripts.find(next => next.id === script.id) || script);
    },
    register: async (scripts: chrome.userScripts.RegisteredUserScript[]) => { events.push('register'); actual.push(...scripts); }
  };
  Object.assign(globalThis, { chrome: { permissions: { contains: async () => true }, userScripts: api } });
  return { api, events, read: () => actual, restore: () => { globalThis.chrome = previous; } };
}

test('最小payload不受暂停geo影响；关闭信号省略，auto仍要求verified绑定', () => {
  const value = config();
  assert.deepEqual(getLanguageTimezonePayload(value, 'example.test'), { intlMode: 'strict', language: { language: 'ja-JP', languages: ['ja-JP', 'ja'] }, timezone: 'Asia/Tokyo' });
  value.globalProfile.language.enabled = false;
  assert.deepEqual(getLanguageTimezonePayload(value, 'example.test'), { intlMode: 'strict', timezone: 'Asia/Tokyo' });
  value.globalProfile.timezone.mode = 'auto';
  assert.equal(getLanguageTimezonePayload(value, 'example.test'), null);
  value.rules[0].overrides.language = { mode: 'override', value: { enabled: false, language: 'fr-FR', languages: ['fr-FR'] } };
  value.rules[0].overrides.timezone = { mode: 'override', value: { enabled: false, mode: 'manual', timezone: 'UTC' } };
  assert.equal(getLanguageTimezonePayload(value, 'example.test'), null);
  value.masterEnabled = false;
  assert.deepEqual(compilePageScripts(value, source), []);
});

test('父域排除更具体启用域，包括没有有效信号的子规则；代码中的配置只经JSON进入', () => {
  const value = config();
  const child = createRule('sub.example.test');
  child.overrides.language.mode = 'disable'; child.overrides.timezone.mode = 'disable';
  value.rules.push(child);
  const scripts = compilePageScripts(value, source);
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].excludeMatches, ['*://*.sub.example.test/*', '*://sub.example.test/*']);
  assert.equal(scripts[0].world, 'MAIN'); assert.equal(scripts[0].runAt, 'document_start'); assert.equal(scripts[0].allFrames, true);
  const text = "ja-JP');globalThis.unwanted=true;//\u2028<";
  value.globalProfile.language.language = text;
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(compilePageScripts(value, source)[0].js[0].code!, context);
  assert.equal(context.sample.language.language, text);
  assert.equal(context.unwanted, undefined);
  assert.deepEqual(Object.keys(context.sample).sort(), ['intlMode', 'language', 'timezone']);
  assert.deepEqual(Object.keys(context.sample.language).sort(), ['language', 'languages']);
});

test('对账先撤销失效范围，再更新保留注册，最后新增；重复对账无写操作', async () => {
  const value = config();
  value.rules.push(createRule('kept.test'));
  const mock = browser(compilePageScripts(value, source));
  try {
    value.rules.push(createRule('sub.example.test'));
    value.globalProfile.language.language = 'fr-FR';
    const result = await reconcilePageScripts(value, source);
    assert.equal(result.component.status, 'ok');
    assert.deepEqual(mock.events, ['unregister', 'update', 'register']);
    mock.events.length = 0;
    assert.equal((await reconcilePageScripts(value, source)).pageRuntime.state, 'ready');
    assert.deepEqual(mock.events, []);
    value.masterEnabled = false;
    assert.equal((await reconcilePageScripts(value, source)).pageRuntime.state, 'disabled');
    assert.deepEqual(mock.read(), []);
  } finally { mock.restore(); }
});

test('撤销失败停止更新新增；更新失败撤销旧值，清理失败也明确报告', async () => {
  const value = config();
  const mock = browser(compilePageScripts(value, source));
  try {
    mock.api.unregister = async () => { throw new Error('synthetic'); };
    value.rules = [];
    assert.equal((await reconcilePageScripts(value, source)).component.status, 'failed');
    assert.deepEqual(mock.events, []);
    value.rules = [createRule('example.test')]; value.intlMode = 'compatible';
    mock.api.update = async () => { throw new Error('synthetic'); };
    const result = await reconcilePageScripts(value, source);
    assert.equal(result.component.status, 'failed');
    assert.deepEqual(result.component.errors.map(error => error.code), ['userscripts-update-failed', 'userscripts-cleanup-failed', 'userscripts-sync-incomplete']);
    assert.equal(result.pageRuntime.reloadRequired, false);
  } finally { mock.restore(); }
});

test('缺少权限/API或读取、注册、确认失败均fail closed，不能返回纯成功', async () => {
  const mock = browser();
  try {
    chrome.permissions.contains = async () => false;
    assert.equal((await reconcilePageScripts(config(), source)).pageRuntime.state, 'permission-required');
    chrome.permissions.contains = async () => true;
    await mock.api.register(compilePageScripts(config(), source));
    mock.api.getScripts = async () => { throw new Error('synthetic non-switch service failure'); };
    const unreadable = await reconcilePageScripts(config(), source);
    assert.equal(unreadable.component.status, 'failed');
    assert.equal(unreadable.pageRuntime.state, 'sync-failed');
    assert.equal(unreadable.pageRuntime.registeredRuleCount, null);
    assert.equal(unreadable.pageRuntime.reloadRequired, false);
    assert.equal(mock.read().length, 1); // 读取失败不能声称旧注册已撤销。
    mock.api.getScripts = async () => [];
    mock.api.register = async () => { throw new Error('synthetic'); };
    assert.equal((await reconcilePageScripts(config(), source)).component.status, 'failed');
    mock.api.register = async () => {};
    assert.equal((await reconcilePageScripts(config(), source)).component.errors[0].code, 'userscripts-verification-failed');
  } finally { mock.restore(); }
});

test('首阶段自包含生成函数只安装语言/Intl/Date，其他API引用保持原样', async () => {
  const generated = await generatePageRuntime();
  const fn = assertSelfContainedFunction(generated.code, 'applyLanguageTimezoneRuntime');
  assert.doesNotMatch(fn, /installGeolocationSpoof|installFontExposureFilter|installWorkerHooks|workerBootstrap|new Blob|postMessage|executeScript/);
  const context = vm.createContext({ location: { protocol: 'http:' }, origin: 'http://localhost' }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`class Navigator { get language(){return 'en-US'} get languages(){return ['en-US']} }
    globalThis.navigator = new Navigator(); globalThis.Worker=function Worker(){}; globalThis.SharedWorker=function SharedWorker(){};
    globalThis.savedWorker=Worker;globalThis.savedSharedWorker=SharedWorker;
    globalThis.Temporal={Now:{timeZoneId:()=> 'native'}};`, context);
  vm.runInContext(`(${fn})(${JSON.stringify(getLanguageTimezonePayload(config(), 'example.test'))})`, context);
  assert.equal(vm.runInContext('navigator.language', context), 'ja-JP');
  assert.equal(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context), 'Asia/Tokyo');
  assert.equal(vm.runInContext('new Date(Date.UTC(2024,0,1)).getTimezoneOffset()', context), -540);
  assert.equal(vm.runInContext('Worker===savedWorker && SharedWorker===savedSharedWorker', context), true);
  assert.equal(vm.runInContext('Temporal.Now.timeZoneId()', context), 'native');
  assert.ok(compilePageScripts(config(), fn)[0].id.startsWith(PAGE_SCRIPT_PREFIX));
});


test('定位最小payload、父子域覆盖和语言时区注册相互独立，auto必须verified绑定', async () => {
  const value = config();
  value.globalProfile.geolocation = { ...value.globalProfile.geolocation, enabled: true, mode: 'manual', latitude: 0, longitude: 0 };
  const child = { ...value.rules[0], id: 'child', domain: 'sub.example.test', overrides: { ...value.rules[0].overrides, geolocation: { mode: 'disable' as const, value: null } } };
  value.rules.push(child);
  const scripts = compileGeolocationScripts(value, 'function applyGeolocationRuntime(payload) { globalThis.sample = payload; }');
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].excludeMatches, ['*://*.sub.example.test/*', '*://sub.example.test/*']);
  const context = vm.createContext({}); vm.runInContext(scripts[0].js[0].code!, context);
  assert.deepEqual(Object.keys(context.sample).sort(), ['accuracy', 'latitude', 'longitude', 'randomRadiusMeters', 'randomize', 'spoofPermission']);
  assert.equal(context.sample.latitude, 0); assert.equal(context.sample.longitude, 0);
  const page = compilePageScripts(value, source);
  const mock = browser(structuredClone(page));
  try {
    const result = await reconcileGeolocationScripts(value, 'function applyGeolocationRuntime() {}');
    assert.equal(result.geolocationRuntime.state, 'ready');
    assert.deepEqual(mock.read().filter(script => script.id.startsWith(PAGE_SCRIPT_PREFIX)), page);
    value.globalProfile.geolocation.mode = 'auto';
    assert.deepEqual(compileGeolocationScripts(value, source), []);
    assert.equal(compilePageScripts(value, source).length, 2);
  } finally { mock.restore(); }
});
