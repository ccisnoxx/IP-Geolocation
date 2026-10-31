import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, createRule, normalizeConfig } from '../src/shared/config-model';
import { registerSpoofContentScripts } from '../src/background/content-scripts';

/**
 * 动态内容脚本注册：烘焙清单已静态注入的域名不再动态注册；注销时
 * "脚本本来就不存在"静默，其它失败要留下告警而不是被吞掉。
 */

function configFor(domain: string) {
  return normalizeConfig({ ...DEFAULT_CONFIG, rules: [createRule(domain)] });
}

function installChrome(unregister: () => Promise<void>) {
  const calls: string[] = [];
  (globalThis as any).chrome = {
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => { calls.push('register'); },
      updateContentScripts: async () => { calls.push('update'); },
      unregisterContentScripts: async () => { calls.push('unregister'); await unregister(); }
    }
  };
  return calls;
}

const originalWarn = console.warn;
afterEach(() => {
  delete (globalThis as any).__VANISHGEO_STATIC_SCRIPT_DOMAINS__;
  delete (globalThis as any).chrome;
  console.warn = originalWarn;
});

test('烘焙清单已覆盖的域名不再动态注册，改为注销残留的动态脚本', async () => {
  (globalThis as any).__VANISHGEO_STATIC_SCRIPT_DOMAINS__ = ['example.com'];
  const calls = installChrome(async () => undefined);
  await registerSpoofContentScripts(configFor('example.com'));
  assert.deepEqual(calls, ['unregister']);
});

test('烘焙清单不是数组时按空清单处理，照常动态注册', async () => {
  (globalThis as any).__VANISHGEO_STATIC_SCRIPT_DOMAINS__ = 'example.com';
  const calls = installChrome(async () => undefined);
  await registerSpoofContentScripts(configFor('example.com'));
  assert.deepEqual(calls, ['register']);
});

test('注销时"脚本不存在"静默，其它失败留下告警', async () => {
  (globalThis as any).__VANISHGEO_STATIC_SCRIPT_DOMAINS__ = ['example.com'];
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

  installChrome(async () => { throw new Error('Nonexistent script ID'); });
  await registerSpoofContentScripts(configFor('example.com'));
  assert.deepEqual(warnings, []);

  installChrome(async () => { throw 'scripting service unavailable'; });
  await registerSpoofContentScripts(configFor('example.com'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /scripting service unavailable/);
});
