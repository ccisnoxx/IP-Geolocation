import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundServices, configNeedsLocation } from '../src/background/services';

/**
 * 这两组不变量是重构后必须一直成立的：
 *
 *  A. 同一个文档里 runtime.js 只执行一次（不管保存几次配置、SW 醒了几回）
 *  B. 配置变化不触发 IP 定位（fetch 只由 bootstrap 的首次定位 / 手动重试 / alarm 发起）
 *
 * 用假 chrome 跑真实 services，而不是对源码做文本断言 —— 后者只能证明"代码写着"，
 * 证明不了"行为是这样"。
 */

const TAB_URL = 'https://claude.ai/login';

interface Harness {
  services: ReturnType<typeof createBackgroundServices>;
  stats: { fileInjections: number; payloadPushes: number; probes: number; fetches: number; reloads: number[] };
  setDocumentId(id: string): void;
  storage: Record<string, any>;
}

function createHarness(options: { tabs?: Array<{ id: number; url: string }> } = {}): Harness {
  const stats = { fileInjections: 0, payloadPushes: 0, probes: 0, fetches: 0, reloads: [] as number[] };
  const local: Record<string, any> = {};
  const session: Record<string, any> = {};
  let documentId = 'doc-1';
  const tabs = options.tabs || [{ id: 7, url: TAB_URL }];

  const geoPayload = {
    success: true,
    latitude: 34.0522,
    longitude: -118.2437,
    country: 'United States',
    timezone: { id: 'America/Los_Angeles', offset: -25200 }
  };

  const fake: any = {
    storage: {
      local: {
        get: async (keys: any) => {
          if (keys === null || keys === undefined) return { ...local };
          if (typeof keys === 'string') return keys in local ? { [keys]: local[keys] } : {};
          if (Array.isArray(keys)) {
            const out: Record<string, any> = {};
            keys.forEach((key) => { if (key in local) out[key] = local[key]; });
            return out;
          }
          return { ...local };
        },
        set: async (values: Record<string, any>) => { Object.assign(local, values); }
      },
      session: {
        get: async (keys: any) => {
          if (typeof keys === 'string') return keys in session ? { [keys]: session[keys] } : {};
          return { ...session };
        },
        set: async (values: Record<string, any>) => { Object.assign(session, values); }
      }
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => undefined,
      updateContentScripts: async () => undefined,
      unregisterContentScripts: async () => undefined,
      executeScript: async (details: any) => {
        if (details.files) {
          stats.fileInjections += 1;
          return [{ documentId, frameId: 0 }];
        }
        // 剩下的都是探测 documentId 的注入
        stats.probes += 1;
        return [{ documentId, frameId: 0 }];
      }
    },
    tabs: {
      query: async () => tabs,
      get: async (id: number) => tabs.find((tab) => tab.id === id),
      reload: async (id: number) => { stats.reloads.push(id); },
      // payload 不再走 executeScript + window.postMessage，而是交给 ISOLATED 桥，
      // 由它转进私有 MessagePort
      sendMessage: async (_tabId: number, message: any) => {
        if (message && message.action === 'applyPayload') stats.payloadPushes += 1;
        return undefined;
      }
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async () => undefined
    },
    contentSettings: {
      location: { set: async () => undefined, clear: async () => undefined }
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => [],
      getDynamicRules: async () => [],
      updateDynamicRules: async () => undefined,
      updateEnabledRulesets: async () => undefined
    },
    privacy: {
      network: { webRTCIPHandlingPolicy: { set: async () => undefined, clear: async () => undefined } }
    },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }
  };

  (globalThis as any).chrome = fake;
  (globalThis as any).__VANISHGEO_NONCE__ = 'test-nonce';
  (globalThis as any).fetch = async () => {
    stats.fetches += 1;
    return { ok: true, json: async () => geoPayload } as any;
  };

  return {
    services: createBackgroundServices(),
    stats,
    setDocumentId: (id: string) => { documentId = id; },
    storage: local
  };
}

test('runtime 的脚本注入按 documentId 去重：同一个文档只执行一次', async () => {
  const harness = createHarness();
  const config = await harness.services.getSiteConfig();

  await harness.services.applyConfig(config);
  assert.equal(harness.stats.fileInjections, 1, '第一次应用应该装一次 runtime');

  // 配置改一点再应用两次：签名不同会真的重跑，但文档还是同一个
  await harness.services.applyConfig({ ...config, debugMode: true });
  await harness.services.applyConfig({ ...config, debugMode: false });
  assert.equal(harness.stats.fileInjections, 1, '同一个 documentId 不允许重复执行 runtime.js');
  assert.ok(harness.stats.payloadPushes >= 3, 'payload 仍然每次都要投递');

  // 导航到新文档：documentId 变了，才允许再装一次
  harness.setDocumentId('doc-2');
  await harness.services.applyConfig({ ...config, debugMode: true });
  assert.equal(harness.stats.fileInjections, 2, '新文档应该重新注入');
});

test('内容脚本上报过 documentId 后，冷启动兜底不会再执行脚本', async () => {
  const harness = createHarness();
  const config = await harness.services.getSiteConfig();

  await harness.services.noteDocumentInjected('doc-1');
  await harness.services.applyConfig(config);

  assert.equal(harness.stats.fileInjections, 0, '注册的内容脚本已经装过了，不应再执行一次');
  assert.equal(harness.stats.payloadPushes, 1, 'payload 仍要投递');
});

test('拿不到 documentId 时宁可少装一次，也不重复执行', async () => {
  const harness = createHarness();
  const config = await harness.services.getSiteConfig();
  harness.setDocumentId('');

  await harness.services.applyConfig(config);
  assert.equal(harness.stats.fileInjections, 0);
});

test('保存配置不触发 IP 定位，重复保存也不重复应用副作用', async () => {
  const harness = createHarness();
  const config = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig(config);

  const afterFirst = { ...harness.stats };
  assert.equal(harness.stats.fetches, 0, '保存配置不应该打定位接口');

  await harness.services.saveSiteConfig(config);
  assert.equal(harness.stats.fetches, 0);
  assert.equal(harness.stats.fileInjections, afterFirst.fileInjections, '同一份配置重复保存不应重新注册/注入');

  // storage.onChanged 会在同一次写入后再来一趟（无参数版本），必须被签名去重挡掉
  const beforeEvent = { ...harness.stats };
  await harness.services.applyConfig();
  assert.equal(harness.stats.fileInjections, beforeEvent.fileInjections, 'storage 事件不应重复注入');
  assert.equal(harness.stats.payloadPushes, beforeEvent.payloadPushes, 'storage 事件不应重复投递');
  assert.equal(harness.stats.fetches, 0, 'storage 事件不应触发 IP 定位');
});

test('bootstrap 只在配置真的需要出口坐标时才发定位请求', async () => {
  const harness = createHarness();

  // 默认配置是 auto 时区 + auto 坐标 → 需要出口 IP
  await harness.services.getSiteConfig();
  await harness.services.bootstrap();
  assert.equal(harness.stats.fetches, 1, 'auto 模式应该拉一次定位');

  // 手填时区 + 手填坐标（persona 构建的形态）→ 一次都不该打接口
  const manual = createHarness();
  const base = await manual.services.getSiteConfig();
  await manual.services.saveSiteConfig({
    ...base,
    globalProfile: {
      ...base.globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
      geolocation: { ...base.globalProfile.geolocation, enabled: true, mode: 'manual', latitude: 34.0522, longitude: -118.2437 }
    }
  });
  const fetchesAfterSave = manual.stats.fetches;
  await manual.services.bootstrap();
  assert.equal(manual.stats.fetches, fetchesAfterSave, '手填配置不该打定位接口');
});

test('configNeedsLocation 能区分 auto 与手填', async () => {
  const harness = createHarness();
  const base = await harness.services.getSiteConfig();
  assert.equal(configNeedsLocation(base), true, '默认 auto 配置需要定位');

  const manual = {
    ...base,
    globalProfile: {
      ...base.globalProfile,
      timezone: { enabled: true, mode: 'manual' as const, timezone: 'America/Los_Angeles' },
      geolocation: { ...base.globalProfile.geolocation, enabled: true, mode: 'manual' as const, latitude: 34.0522, longitude: -118.2437 }
    }
  };
  assert.equal(configNeedsLocation(manual), false, '时区与坐标都手填时不需要定位');
  assert.equal(configNeedsLocation({ ...manual, masterEnabled: false }), false, '全局关闭时不需要定位');
});
test('禁用一条规则会保留它，并且只重载该域下的标签页', async () => {
  const harness = createHarness({
    tabs: [
      { id: 1, url: 'https://mail.google.com/u/0' },
      { id: 2, url: 'https://drive.google.com/' },
      { id: 3, url: 'https://claude.ai/login' }
    ]
  });
  await harness.services.getSiteConfig();

  const config = await harness.services.setDomainRuleEnabled('mail.google.com', false);
  const rule = config.rules.find((item) => item.domain === 'mail.google.com');
  assert.ok(rule, '规则要保留下来（旧实现是直接删掉）');
  assert.equal(rule.enabled, false);
  assert.deepEqual(harness.stats.reloads, [1], '只重载该域及其子域，不碰其它标签页');
});

test('排除之后该站点不再收到 payload，相邻子域照常', async () => {
  const harness = createHarness({
    tabs: [
      { id: 1, url: 'https://mail.google.com/u/0' },
      { id: 2, url: 'https://drive.google.com/' }
    ]
  });
  await harness.services.getSiteConfig();
  const before = harness.stats.payloadPushes;

  await harness.services.setDomainRuleEnabled('mail.google.com', false);
  assert.equal(harness.stats.payloadPushes, before + 1, '只有 drive.google.com 收到 payload');
});

test('删除规则同样重载受影响标签页，规则真的消失', async () => {
  const harness = createHarness({
    tabs: [
      { id: 1, url: 'https://mail.google.com/u/0' },
      { id: 3, url: 'https://claude.ai/login' }
    ]
  });
  await harness.services.getSiteConfig();
  await harness.services.setDomainRuleEnabled('mail.google.com', false);
  harness.stats.reloads.length = 0;

  const config = await harness.services.deleteDomainRule('mail.google.com');
  assert.equal(config.rules.some((rule) => rule.domain === 'mail.google.com'), false);
  assert.deepEqual(harness.stats.reloads, [1]);
});
