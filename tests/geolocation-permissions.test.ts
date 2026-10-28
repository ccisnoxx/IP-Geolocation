import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialConfig, createRule } from '../src/shared/config-model';
import { compileGeolocationPermissions, reconcileGeolocationPermissions, GEOLOCATION_PERMISSION_OWNER_KEY } from '../src/background/geolocation-permissions';
import { createContentSettingsMock } from './helpers/content-settings-mock';

function config() {
  const value = createInitialConfig(); value.masterEnabled = true;
  value.globalProfile.geolocation = { ...value.globalProfile.geolocation, mode: 'manual', latitude: 12, longitude: 23 };
  value.rules = [createRule('example.test'), { ...createRule('sub.example.test'), enabled: false }, createRule('deep.sub.example.test')];
  return value;
}

test('真实定位权限同一解析器派生，禁用/native/定位关闭子域以ask遮盖父授权', () => {
  const value = config();
  assert.deepEqual(compileGeolocationPermissions(value), [
    { domain: 'deep.sub.example.test', setting: 'allow' }, { domain: 'example.test', setting: 'allow' }, { domain: 'sub.example.test', setting: 'ask' }
  ]);
  value.rules[2].compatibilityPreset = 'native';
  assert.equal(compileGeolocationPermissions(value)[0].setting, 'ask');
  value.rules[0].overrides.geolocation = { mode: 'disable', value: null };
  assert.deepEqual(compileGeolocationPermissions(value), []);
  value.rules[0].overrides.geolocation = { mode: 'inherit', value: null };
  value.globalProfile.geolocation.mode = 'auto';
  assert.equal(compileGeolocationPermissions(value).find(rule => rule.domain === 'example.test')?.setting, 'block');
  value.masterEnabled = false;
  assert.deepEqual(compileGeolocationPermissions(value), []);
});

test('先写pending再clear全部本扩展定位规则，重建读回后确认；稳态无变更，关闭撤销', async () => {
  const previous = globalThis.chrome;
  const settings = createContentSettingsMock();
  const data: Record<string, any> = {};
  const events: string[] = [];
  const clear = settings.api.clear;
  settings.api.clear = async details => { assert.deepEqual(details, { scope: 'regular' }); events.push('clear'); await clear(details); };
  Object.assign(globalThis, { chrome: { contentSettings: { location: settings.api }, storage: { local: {
    get: async () => structuredClone(data),
    set: async (items: Record<string, any>) => { events.push(items[GEOLOCATION_PERMISSION_OWNER_KEY].state); Object.assign(data, structuredClone(items)); },
    remove: async (key: string) => { delete data[key]; }
  } } } });
  try {
    const value = config();
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'ok');
    assert.deepEqual(events, ['pending', 'clear', 'confirmed']);
    const calls = structuredClone(settings.calls);
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'ok');
    assert.deepEqual(settings.calls, calls);
    assert.deepEqual(events, ['pending', 'clear', 'confirmed']);
    value.masterEnabled = false;
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'ok');
    assert.equal(settings.rules.size, 0);
    assert.deepEqual(data[GEOLOCATION_PERMISSION_OWNER_KEY], { version: 1, state: 'confirmed', rules: [] });
  } finally { globalThis.chrome = previous; }
});

test('定位授权读回冲突或API失败不报成功，清理后可由同一投影恢复', async () => {
  const previous = globalThis.chrome;
  const settings = createContentSettingsMock();
  const data: Record<string, any> = {};
  Object.assign(globalThis, { chrome: { contentSettings: { location: settings.api }, storage: { local: {
    get: async () => structuredClone(data), set: async (items: Record<string, any>) => { Object.assign(data, structuredClone(items)); },
    remove: async (key: string) => { delete data[key]; }
  } } } });
  const get = settings.api.get;
  try {
    const value = config();
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'ok');
    settings.api.get = async () => ({ setting: 'block' });
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'failed');
    assert.equal(settings.rules.size, 0);
    assert.equal(data[GEOLOCATION_PERMISSION_OWNER_KEY], undefined);
    settings.api.get = get;
    assert.equal((await reconcileGeolocationPermissions(value)).status, 'ok');
    settings.api.clear = async () => { throw new Error('synthetic clear'); };
    value.masterEnabled = false;
    const failed = await reconcileGeolocationPermissions(value);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.errors.some(error => error.code === 'geolocation-permissions-clear-failed'));
  } finally { globalThis.chrome = previous; }
});
