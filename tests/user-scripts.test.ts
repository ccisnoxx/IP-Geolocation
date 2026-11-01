import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import {
  USER_SCRIPT_ID,
  buildUserScriptCode,
  chromeMajorVersion,
  syncUserScript,
  userScriptToken,
  userScriptsAvailable
} from '../src/background/user-scripts';

/**
 * 用户脚本模式的后台部分：代码拼装、开关检测、注册 / 更新 / 撤销、认领口令。
 * 注入层两份之间的认领与执行顺序只有真浏览器测得出来，见 tools/smoke-userscripts.mjs。
 */

const config = (patch: Record<string, unknown> = {}) => normalizeConfig({
  ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  masterEnabled: true,
  rules: [{ id: 'r', domain: 'example.com', enabled: true }],
  ...patch
} as any);

function installChrome(options: { userScripts?: 'missing' | 'disabled' | 'enabled'; existing?: string[]; duplicateOnRegister?: boolean } = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const store: Record<string, unknown> = {};
  const userScripts = {
    getScripts: (filter?: unknown) => {
      if (options.userScripts === 'disabled') throw new Error("'userScripts.getScripts' is not available in this context.");
      calls.push({ name: 'getScripts', args: [filter] });
      return Promise.resolve((options.existing || []).map((id) => ({ id })));
    },
    register: async (scripts: unknown[]) => {
      calls.push({ name: 'register', args: [scripts] });
      if (options.duplicateOnRegister) throw new Error(`Duplicate script ID '${USER_SCRIPT_ID}'`);
    },
    update: async (scripts: unknown[]) => { calls.push({ name: 'update', args: [scripts] }); },
    unregister: async (filter: unknown) => { calls.push({ name: 'unregister', args: [filter] }); }
  };
  (globalThis as any).chrome = {
    ...(options.userScripts === 'missing' ? {} : { userScripts }),
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: { local: {
      get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
      set: async (values: Record<string, unknown>) => { Object.assign(store, values); }
    } }
  };
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, text: async () => 'globalThis.__seen = typeof __VANISHGEO_DYNAMIC__ === "object" ? __VANISHGEO_DYNAMIC__ : null;' });
  return { calls, store };
}

afterEach(() => {
  delete (globalThis as any).chrome;
});

test('生成的代码把快照作为参数交给注入层，不留全局，并以 sourceURL 结尾', () => {
  const code = buildUserScriptCode('globalThis.__seen = __VANISHGEO_DYNAMIC__;', {
    config: config(),
    lastLocation: null,
    token: 'secret-token-0001'
  });
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const seen = vm.runInContext('__seen', context);
  assert.equal(seen.token, 'secret-token-0001');
  assert.equal(seen.config.rules[0].domain, 'example.com');
  assert.equal(vm.runInContext('typeof __VANISHGEO_DYNAMIC__', context), 'undefined', '快照只存在于包裹函数的参数里');
  assert.match(code, /\n\/\/# sourceURL=<anonymous>$/);
});

test('开关检测：API 不存在、存在但没开（getScripts 同步抛错）、已开', () => {
  installChrome({ userScripts: 'missing' });
  assert.equal(userScriptsAvailable(), false);
  installChrome({ userScripts: 'disabled' });
  assert.equal(userScriptsAvailable(), false);
  installChrome({ userScripts: 'enabled' });
  assert.equal(userScriptsAvailable(), true);
});

test('浏览器主版本号：决定提示去扩展详情页（138+）还是开发者模式', () => {
  assert.equal(chromeMajorVersion('Mozilla/5.0 ... Chrome/156.0.8078.74 Safari/537.36'), 156);
  assert.equal(chromeMajorVersion('Mozilla/5.0 Firefox/130.0'), null);
});

test('开关已开：首次注册、之后更新；脚本在 MAIN world 的 document_start、覆盖所有 frame', async () => {
  const first = installChrome({ userScripts: 'enabled' });
  assert.equal(await syncUserScript(config(), null, []), true);
  const register = first.calls.find((call) => call.name === 'register');
  assert.ok(register, '首次注册');
  const [script] = register!.args[0] as any[];
  assert.equal(script.id, USER_SCRIPT_ID);
  assert.equal(script.world, 'MAIN');
  assert.equal(script.runAt, 'document_start');
  assert.equal(script.allFrames, true);
  assert.ok(script.matches.includes('*://example.com/*'));
  assert.match(script.js[0].code, /__VANISHGEO_DYNAMIC__/);
  // 口令首次生成即持久保存，并与写进脚本里的是同一个值（发给页面的也读这一份）
  const token = first.store.userScriptToken as string;
  assert.ok(typeof token === 'string' && token.length >= 16);
  assert.ok(script.js[0].code.includes(JSON.stringify(token)));

  const second = installChrome({ userScripts: 'enabled', existing: [USER_SCRIPT_ID] });
  assert.equal(await syncUserScript(config({ rules: [{ id: 'r', domain: 'example.org', enabled: true }] }), null, []), true);
  assert.ok(second.calls.some((call) => call.name === 'update'), '已存在时更新而不是重复注册');
});

test('内容没变且脚本还在：只确认存在，不整段重写；脚本不见了就重新注册', async () => {
  installChrome({ userScripts: 'enabled' });
  assert.equal(await syncUserScript(config({ rules: [{ id: 'r', domain: 'same.example', enabled: true }] }), null, []), true);

  const unchanged = installChrome({ userScripts: 'enabled', existing: [USER_SCRIPT_ID] });
  assert.equal(await syncUserScript(config({ rules: [{ id: 'r', domain: 'same.example', enabled: true }] }), null, []), true);
  assert.ok(!unchanged.calls.some((call) => call.name === 'register' || call.name === 'update'), '同样内容不重写');

  const gone = installChrome({ userScripts: 'enabled' });
  assert.equal(await syncUserScript(config({ rules: [{ id: 'r', domain: 'same.example', enabled: true }] }), null, []), true);
  assert.ok(gone.calls.some((call) => call.name === 'register'), '脚本被清掉（如扩展更新）后照常注册');
});

test('查询后被别处抢先注册（Duplicate script ID）：改为更新，不当成失败', async () => {
  const raced = installChrome({ userScripts: 'enabled', duplicateOnRegister: true });
  assert.equal(await syncUserScript(config({ rules: [{ id: 'r', domain: 'race.example', enabled: true }] }), null, []), true);
  assert.deepEqual(raced.calls.filter((call) => call.name !== 'getScripts').map((call) => call.name), ['register', 'update']);
});

test('开关没开、总开关关、烘焙构建、没有命中域名：不处于用户脚本模式', async () => {
  installChrome({ userScripts: 'disabled' });
  assert.equal(await syncUserScript(config(), null, []), false);

  for (const [label, cfg, baked] of [
    ['总开关关闭', config({ masterEnabled: false }), []],
    ['烘焙构建', config(), ['example.com']],
    ['没有命中域名', config({ rules: [] }), []]
  ] as const) {
    const { calls } = installChrome({ userScripts: 'enabled', existing: [USER_SCRIPT_ID] });
    assert.equal(await syncUserScript(cfg, null, [...baked]), false, label);
    assert.ok(calls.some((call) => call.name === 'unregister'), `${label}：撤掉旧脚本，免得首屏用旧快照`);
    assert.ok(!calls.some((call) => call.name === 'register' || call.name === 'update'), label);
  }
});

test('认领口令长期不变：发给页面的口令与已注册脚本里的一致', async () => {
  installChrome({ userScripts: 'enabled' });
  const token = await userScriptToken();
  assert.ok(token.length >= 16);
  assert.equal(await userScriptToken(), token);
});
