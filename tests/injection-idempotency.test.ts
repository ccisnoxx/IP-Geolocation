import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import { createBackgroundServices, configNeedsLocation, fetchJson, parseGeoApiResponse } from '../src/background/services';

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
  stats: {
    fileInjections: number;
    payloadPushes: number;
    clearPushes: number;
    probes: number;
    fetches: number;
    reloads: number[];
    messages: Array<{ tabId: number; frameId?: number; clear: boolean; hostname?: string; language?: string | null }>;
    permissions: Array<{ setting: string; pattern: string }>;
    permissionClears: string[];
    maxConcurrentSends: number;
    registered: number;
    updated: number;
    unregistered: number;
    tabCreates: number;
    badgeTexts: Array<{ text: string; tabId?: number }>;
  };
  setDocumentId(id: string): void;
  storage: Record<string, any>;
}

function createHarness(options: {
  tabs?: Array<{ id: number; url: string }>;
  frames?: Array<{ frameId: number; url: string; parentFrameId?: number }>;
  framesError?: boolean;
  sendDelayMs?: number;
  registeredScripts?: any[];
  registerError?: string;
  sessionError?: boolean;
  mainInjectError?: boolean;
  reloadError?: boolean;
} = {}): Harness {
  const stats = {
    fileInjections: 0,
    payloadPushes: 0,
    clearPushes: 0,
    probes: 0,
    fetches: 0,
    reloads: [] as number[],
    messages: [] as Array<{ tabId: number; frameId?: number; clear: boolean; hostname?: string; language?: string | null }>,
    permissions: [] as Array<{ setting: string; pattern: string }>,
    permissionClears: [] as string[],
    maxConcurrentSends: 0,
    registered: 0,
    updated: 0,
    unregistered: 0,
    tabCreates: 0,
    badgeTexts: [] as Array<{ text: string; tabId?: number }>
  };
  let activeSends = 0;
  const local: Record<string, any> = {};
  const session: Record<string, any> = {};
  let documentId = 'doc-1';
  const tabs = options.tabs || [{ id: 7, url: TAB_URL }];
  const framesForTab = (tabId: number) => {
    if (options.frames) return options.frames;
    const tab = tabs.find((item) => item.id === tabId);
    return [{ frameId: 0, url: tab ? tab.url : TAB_URL, parentFrameId: -1 }];
  };

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
          if (options.sessionError) throw new Error('session unavailable');
          if (typeof keys === 'string') return keys in session ? { [keys]: session[keys] } : {};
          return { ...session };
        },
        set: async (values: Record<string, any>) => { Object.assign(session, values); }
      }
    },
    scripting: {
      getRegisteredContentScripts: async () => options.registeredScripts || [],
      registerContentScripts: async () => {
        stats.registered += 1;
        if (options.registerError) throw new Error(options.registerError);
      },
      updateContentScripts: async () => { stats.updated += 1; },
      unregisterContentScripts: async () => { stats.unregistered += 1; },
      executeScript: async (details: any) => {
        if (details.files) {
          stats.fileInjections += 1;
          if (options.mainInjectError) throw new Error('main inject failed');
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
      reload: async (id: number) => {
        if (options.reloadError) throw new Error('tab gone');
        stats.reloads.push(id);
      },
      create: async () => { stats.tabCreates += 1; return { id: 99 }; },
      // payload 不再走 executeScript + window.postMessage，而是交给 ISOLATED 桥，
      // 由它转进私有 MessagePort
      sendMessage: async (tabId: number, message: any, sendOptions?: { frameId?: number }) => {
        activeSends += 1;
        stats.maxConcurrentSends = Math.max(stats.maxConcurrentSends, activeSends);
        try {
          if (options.sendDelayMs) await new Promise((resolve) => setTimeout(resolve, options.sendDelayMs));
          if (message && message.action === 'applyPayload') {
            if (message.clear) stats.clearPushes += 1;
            else stats.payloadPushes += 1;
            stats.messages.push({
              tabId,
              frameId: sendOptions?.frameId,
              clear: Boolean(message.clear),
              hostname: message.payload && message.payload.hostname,
              language: message.payload && message.payload.languageConfig
                ? message.payload.languageConfig.language
                : null
            });
          }
          return undefined;
        } finally {
          activeSends -= 1;
        }
      }
    },
    action: {
      setBadgeText: async (details: { text: string; tabId?: number }) => { stats.badgeTexts.push(details); },
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async () => undefined
    },
    webNavigation: {
      getAllFrames: async ({ tabId }: { tabId: number }) => {
        if (options.framesError) throw new Error('webNavigation unavailable');
        return framesForTab(tabId).map((frame) => ({
          frameId: frame.frameId,
          url: frame.url,
          parentFrameId: frame.parentFrameId === undefined ? -1 : frame.parentFrameId,
          documentId: `doc-${tabId}-${frame.frameId}`,
          documentLifecycle: 'active',
          frameType: frame.frameId === 0 ? 'outermost_frame' : 'sub_frame',
          processId: 1,
          errorOccurred: false
        }));
      }
    },
    contentSettings: {
      location: {
        set: async (details: any) => { stats.permissions.push({ setting: details.setting, pattern: details.primaryPattern }); },
        clear: async (details: any) => { stats.permissionClears.push(details.primaryPattern); }
      }
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
  assert.equal(harness.stats.clearPushes, 1, '被排除的站点收到 clear，烘焙值才会退回原生');
});

test('关闭总开关会给已开标签页下发 clear，重新打开后恢复 payload', async () => {
  const harness = createHarness({ tabs: [{ id: 1, url: 'https://mail.google.com/u/0' }] });
  await harness.services.getSiteConfig();
  const before = { payloadPushes: harness.stats.payloadPushes, clearPushes: harness.stats.clearPushes };

  await harness.services.setExtensionEnabled(false);
  assert.equal(harness.stats.clearPushes, before.clearPushes + 1, '关闭后页面必须收到 clear');
  assert.equal(harness.stats.payloadPushes, before.payloadPushes, '关闭后不应再投递 payload');

  await harness.services.setExtensionEnabled(true);
  assert.equal(harness.stats.payloadPushes, before.payloadPushes + 1, '重新打开后 payload 要补回来');
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

test('内存快照跟着存储走：保存后立刻读到新值，lastLocation 写入也能看见', async () => {
  const harness = createHarness();
  const initial = await harness.services.getSiteConfig();

  // 第一次读会填充快照，之后必须靠写入路径打掉，不能读到陈旧值
  const saved = await harness.services.saveSiteConfig({
    ...initial,
    canvas: { ...initial.canvas, enabled: true, platform: 'none' }
  });
  assert.equal(saved.canvas.platform, 'none');

  const reread = await harness.services.getSiteConfig();
  assert.equal(reread.canvas.platform, 'none', '保存后必须读到新值，不能命中旧快照');

  // 定位写入同样要反映到缓存（否则首屏 payload 会拿上一次的坐标）
  await harness.services.updateGeolocation(true);
  const location = await harness.services.getLastLocation();
  assert.ok(location, '定位更新后应能读到');
  const afterLocation = await harness.services.getLastLocation();
  assert.deepEqual(afterLocation, location, '第二次读必须与第一次一致（命中缓存）');
});

test('定位未解析时匹配域名置为 block，解析成功后切回 allow', async () => {
  const harness = createHarness();
  const config = await harness.services.getSiteConfig();
  await harness.services.applyConfig(config);

  assert.ok(
    harness.stats.permissions.some((item) => item.setting === 'block'),
    'auto 定位还没解析出来时，权限层必须 fail-closed'
  );

  await harness.services.updateGeolocation(true);
  assert.ok(
    harness.stats.permissions.some((item) => item.setting === 'allow'),
    '坐标解析成功后，权限层要从 block 切回 allow'
  );
});

test('payload 按 frame 精确投递：独立子域规则不会被父页覆盖', async () => {
  const tabUrl = 'https://claude.ai/login';
  const childUrl = 'https://console.claude.ai/frame';
  const harness = createHarness({
    tabs: [{ id: 7, url: tabUrl }],
    frames: [
      { frameId: 0, url: tabUrl, parentFrameId: -1 },
      { frameId: 5, url: childUrl, parentFrameId: 0 }
    ]
  });
  const base = await harness.services.getSiteConfig();
  const rules = [
    { id: 'parent', domain: 'claude.ai', enabled: true },
    {
      id: 'child',
      domain: 'console.claude.ai',
      enabled: true,
      overrides: {
        language: {
          mode: 'override',
          value: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' }
        },
        timezone: { mode: 'override', value: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' } },
        geolocation: { mode: 'disable', value: null }
      }
    }
  ];
  const config = {
    ...base,
    globalProfile: {
      ...base.globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
      geolocation: { ...base.globalProfile.geolocation, enabled: false, mode: 'auto', latitude: null, longitude: null }
    },
    rules
  } as any;

  await harness.services.saveSiteConfig(config);
  const sent = harness.stats.messages.slice(-2);
  assert.deepEqual(sent.map((message) => message.frameId).sort(), [0, 5]);
  assert.equal(sent.find((message) => message.frameId === 0)?.hostname, 'claude.ai');
  assert.equal(sent.find((message) => message.frameId === 5)?.hostname, 'console.claude.ai');
  assert.equal(sent.find((message) => message.frameId === 5)?.language, 'ja-JP');

  // 父页未命中、子域命中：主 frame 收到 clear，子 frame 仍然拿到自己的 payload
  const childOnly = { ...config, rules: [rules[1]] };
  const before = harness.stats.messages.length;
  await harness.services.saveSiteConfig(childOnly);
  const next = harness.stats.messages.slice(before);
  assert.equal(next.find((message) => message.frameId === 0)?.clear, true);
  assert.equal(next.find((message) => message.frameId === 5)?.clear, false);
  assert.equal(next.find((message) => message.frameId === 5)?.hostname, 'console.claude.ai');

  // 规则删掉：子 frame 也必须收到 clear
  const beforeClear = harness.stats.messages.length;
  await harness.services.saveSiteConfig({ ...config, rules: [] });
  const cleared = harness.stats.messages.slice(beforeClear);
  assert.equal(cleared.find((message) => message.frameId === 5)?.clear, true);
});

test('不透明 iframe（about:blank/srcdoc）回退到最近的父 frame URL 解析', async () => {
  const tabUrl = 'https://claude.ai/login';
  const harness = createHarness({
    tabs: [{ id: 7, url: tabUrl }],
    frames: [
      { frameId: 0, url: tabUrl, parentFrameId: -1 },
      { frameId: 3, url: 'about:srcdoc', parentFrameId: 0 },
      { frameId: 4, url: 'about:blank', parentFrameId: 0 }
    ]
  });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    globalProfile: {
      ...base.globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' }
    },
    rules: [{ id: 'parent', domain: 'claude.ai', enabled: true }]
  } as any);

  const sent = harness.stats.messages.filter((message) => !message.clear);
  assert.deepEqual(sent.map((message) => message.frameId).sort(), [0, 3, 4]);
  for (const message of sent) {
    assert.equal(message.hostname, 'claude.ai', '不透明框架按父页规则解析');
  }
});


test('嵌套不透明 frame 沿父链解析，blob/data 也不会越界', async () => {
  const tabUrl = 'https://claude.ai/login';
  const harness = createHarness({
    tabs: [{ id: 7, url: tabUrl }],
    frames: [
      { frameId: 0, url: tabUrl, parentFrameId: -1 },
      { frameId: 3, url: 'about:srcdoc', parentFrameId: 0 },
      { frameId: 4, url: 'about:blank', parentFrameId: 3 },
      { frameId: 5, url: 'blob:https://claude.ai/abc', parentFrameId: 4 },
      { frameId: 6, url: 'data:text/html,hi', parentFrameId: 5 }
    ]
  });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    rules: [{ id: 'parent', domain: 'claude.ai', enabled: true }]
  } as any);

  const sent = harness.stats.messages.filter((message) => !message.clear);
  assert.deepEqual(sent.map((message) => message.frameId).sort((a, b) => Number(a) - Number(b)), [0, 3, 4, 5, 6]);
  for (const message of sent) {
    assert.equal(message.hostname, 'claude.ai', '整条不透明父链都回退到顶层规则');
  }
});

test('webNavigation 不可用时退回广播，桥仍会用 hostname 拒绝父页 payload', async () => {
  const harness = createHarness({ framesError: true });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    rules: [{ id: 'parent', domain: 'claude.ai', enabled: true }]
  } as any);

  const sent = harness.stats.messages.filter((message) => !message.clear);
  assert.equal(sent.length, 1, '拿不到 frame 列表时只广播一次');
  assert.equal(sent[0].frameId, undefined, '广播不带 frameId');
  assert.equal(sent[0].hostname, 'claude.ai');
});

test('多 frame 投递有并发上限，且每个 frame 都收到自己的消息', async () => {
  const frames = Array.from({ length: 40 }, (_, index) => ({
    frameId: index + 1,
    url: `https://claude.ai/frame-${index}`,
    parentFrameId: 0
  }));
  frames.unshift({ frameId: 0, url: 'https://claude.ai/login', parentFrameId: -1 });
  const harness = createHarness({ frames, sendDelayMs: 10 });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    rules: [{ id: 'parent', domain: 'claude.ai', enabled: true }]
  } as any);

  const sent = harness.stats.messages.filter((message) => !message.clear);
  assert.equal(sent.length, frames.length);
  assert.equal(new Set(sent.map((message) => message.frameId)).size, frames.length);
  assert.ok(harness.stats.maxConcurrentSends > 1, '应该并发投递');
  assert.ok(harness.stats.maxConcurrentSends <= 8, `并发不得超过 8，实际 ${harness.stats.maxConcurrentSends}`);
});

test('parseGeoApiResponse 覆盖新的 API 形态和空响应', () => {
  assert.deepEqual(parseGeoApiResponse({
    location: { latitude: '1.25', longitude: '-2.5' },
    country: { name: 'Testland' },
    timezone: { id: 'Europe/Paris' }
  }), {
    latitude: 1.25,
    longitude: -2.5,
    country: 'Testland',
    timezone: 'Europe/Paris',
    timezoneOffset: null
  });
  assert.equal(parseGeoApiResponse(null), null);
  assert.equal(parseGeoApiResponse({ location: { latitude: null, longitude: null } }), null);
  assert.equal(parseGeoApiResponse({ loc: '91,0' }), null);
  assert.equal(parseGeoApiResponse({ success: false, latitude: 1, longitude: 2 }), null);
  const countryCode = parseGeoApiResponse({ latitude: 3, longitude: 4, country_code: 'SG' });
  assert.equal(countryCode?.country, 'SG');
  const offset = parseGeoApiResponse({ latitude: 3, longitude: 4, timezone: { id: 'Asia/Singapore', offset: 28800 } });
  assert.equal(offset?.timezoneOffset, -480);
});

test('fetchJson 成功返回 JSON，失败时抛出网络错误', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) } as any);
  assert.deepEqual(await fetchJson('https://example.test', 50), { ok: 1 });
  globalThis.fetch = async () => { throw new Error('network down'); };
  await assert.rejects(() => fetchJson('https://example.test', 50), /network down/);
  globalThis.fetch = original;
});

test('configNeedsLocation 只对 auto 且确实缺定位的配置返回 true', () => {
  assert.equal(configNeedsLocation({ ...normalizeConfig(DEFAULT_CONFIG), masterEnabled: false }), false);
  assert.equal(configNeedsLocation({ ...normalizeConfig(DEFAULT_CONFIG), rules: [] }), false);
  const manual = normalizeConfig({
    ...DEFAULT_CONFIG,
    rules: [{ domain: 'claude.ai', enabled: true }] as any,
    globalProfile: {
      ...DEFAULT_CONFIG.globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: { ...DEFAULT_CONFIG.globalProfile.geolocation, enabled: false }
    }
  });
  assert.equal(configNeedsLocation(manual), false);
});

test('getSiteConfig 首次种子、缓存和 invalidate 行为', async () => {
  const harness = createHarness();
  const seed = await harness.services.getSiteConfig();
  assert.ok(harness.storage.siteSpoofConfig);
  assert.equal(harness.storage.siteSpoofConfig.rules.length, seed.rules.length);
  const cached = await harness.services.getSiteConfig();
  assert.equal(cached.masterEnabled, seed.masterEnabled);
  assert.equal(cached.rules.length, seed.rules.length);

  harness.storage.siteSpoofConfig = { ...seed, debugMode: true };
  assert.equal((await harness.services.getSiteConfig()).debugMode, false, '缓存命中不读 storage');
  harness.services.invalidateStorageCache();
  assert.equal((await harness.services.getSiteConfig()).debugMode, true);
});

test('getLastLocation 缓存 null 与对象，并在失效后重读', async () => {
  const harness = createHarness();
  assert.equal(await harness.services.getLastLocation(), null);
  harness.storage.lastLocation = {
    latitude: 1, longitude: 2, country: 'X', timezone: 'Asia/Tokyo', updateTime: 'now'
  };
  assert.equal(await harness.services.getLastLocation(), null, 'null 也会缓存');
  harness.services.invalidateStorageCache();
  assert.equal((await harness.services.getLastLocation())?.timezone, 'Asia/Tokyo');
});

test('reportFontLayers / getFontLayers 处理非法输入、平台值与容量上限', async () => {
  const harness = createHarness();
  harness.services.reportFontLayers('not a url', { count: 1 });
  assert.equal(harness.services.getFontLayers('not a url'), null);
  harness.services.reportFontLayers('https://claude.ai/x', { count: 'bad' });
  assert.equal(harness.services.getFontLayers('https://claude.ai/x'), null);
  harness.services.reportFontLayers('https://claude.ai/x', { count: 3, platform: 'none', hideCjkFonts: true });
  assert.deepEqual(harness.services.getFontLayers('https://claude.ai/x'), {
    count: 3, platform: 'none', hideCjkFonts: true, at: harness.services.getFontLayers('https://claude.ai/x')!.at
  });

  for (let index = 0; index < 55; index += 1) {
    harness.services.reportFontLayers(`https://d${index}.example/`, { count: index, platform: 'auto', hideCjkFonts: false });
  }
  assert.equal(harness.services.getFontLayers('https://d0.example/'), null, '最旧的记录应被淘汰');
  assert.equal(harness.services.getFontLayers('https://d54.example/')?.count, 54);
});

test('getExtensionState / setWebRtcGlobalMode / 非法保存', async () => {
  const harness = createHarness();
  const base = await harness.services.getSiteConfig();
  const state = await harness.services.getExtensionState();
  assert.equal(state.enabled, base.masterEnabled);
  const strict = await harness.services.setWebRtcGlobalMode('strict');
  assert.equal(strict.webRtc.globalMode, 'strict');
  await assert.rejects(() => harness.services.saveSiteConfig({
    ...base,
    rules: [{ domain: 'bad host', enabled: true } as any]
  }), /domain is invalid/);
});

test('getCurrentTabState 无 URL / 有 URL，getPayloadForUrl 覆盖空 URL', async () => {
  const harness = createHarness({ tabs: [{ id: 7, url: TAB_URL }] });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any
  });
  const noUrl = await harness.services.getCurrentTabState({ id: 1, url: '' } as any);
  assert.equal(noUrl.domain, '');
  assert.equal(noUrl.matched, false);
  const state = await harness.services.getCurrentTabState({ id: 7, url: TAB_URL } as any);
  assert.equal(state.domain, 'claude.ai');
  assert.equal(state.matched, true);
  assert.equal((await harness.services.getPayloadForUrl('')).matched, false);
});

test('refreshActionBadge 覆盖 broken / active / 非白名单标签页', async () => {
  const harness = createHarness({ tabs: [
    { id: 1, url: 'https://claude.ai/login' },
    { id: 2, url: 'https://unknown.example/' },
    { id: 3, url: '' }
  ] });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    globalProfile: {
      ...base.globalProfile,
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { ...base.globalProfile.geolocation, enabled: true, mode: 'auto' }
    },
    rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any
  });
  await harness.services.refreshActionBadge();
  assert.ok(harness.stats.badgeTexts.some((item) => item.text === '!'));
});

test('openDiagnosticPage 和 reloadAffectedTabs 的边界', async () => {
  const harness = createHarness({ tabs: [
    { id: 1, url: 'https://claude.ai/x' },
    { id: 2, url: 'https://other.example/' },
    { id: 3, url: 'bad url' },
    { id: 4, url: 'https://sub.claude.ai/x' }
  ] });
  await harness.services.openDiagnosticPage();
  assert.equal(harness.stats.tabCreates, 1);

  await harness.services.reloadAffectedTabs('');
  assert.deepEqual(harness.stats.reloads, []);
  await harness.services.reloadAffectedTabs('claude.ai');
  assert.deepEqual(harness.stats.reloads.sort(), [1, 4]);
});

test('loadInjectedDocuments 会话不可用 / 历史 documentId 去重', async () => {
  const harness = createHarness({ sessionError: true });
  const config = await harness.services.getSiteConfig();
  await harness.services.applyConfig(config);
  assert.equal(harness.stats.fileInjections, 1, 'session 失败也要能装');

  const harness2 = createHarness();
  harness2.storage.injectedDocumentIds = ['doc-1', '', 42];
  await harness2.services.noteDocumentInjected('doc-1');
  await harness2.services.applyConfig(await harness2.services.getSiteConfig());
  assert.equal(harness2.stats.fileInjections, 0, '历史 session 已记录文档');
});

test('reportFontLayers / getFontLayers 的空 URL、非法层和自动平台分支', () => {
  const harness = createHarness();
  harness.services.reportFontLayers('', { count: 1 });
  harness.services.reportFontLayers('https://claude.ai/x', null);
  harness.services.reportFontLayers('https://claude.ai/x', { count: -1 });
  harness.services.reportFontLayers('https://claude.ai/x', { count: 2, platform: 'auto', hideCjkFonts: false });
  assert.equal(harness.services.getFontLayers(''), null);
  assert.equal(harness.services.getFontLayers('https://claude.ai/x')?.platform, 'auto');
  assert.equal(harness.services.getFontLayers('https://claude.ai/x')?.count, 2);
});

test('syncTab 跳过非 http、无 webNavigation、frames 报错和不可脚本 frame', async () => {
  const harness = createHarness({ framesError: true });
  await harness.services.syncTab(7, 'chrome://settings');
  assert.equal(harness.stats.fileInjections, 0);

  await harness.services.syncTab(7, TAB_URL);
  assert.ok(harness.stats.payloadPushes > 0, 'frames 报错时退回顶层 URL');

  (globalThis as any).chrome.webNavigation = undefined;
  await harness.services.applyConfig(await harness.services.getSiteConfig());
  assert.ok(harness.stats.payloadPushes > 0, '没有 webNavigation 时退回广播');

  const harness2 = createHarness({ frames: [
    { frameId: 0, url: 'about:blank', parentFrameId: -1 },
    { frameId: 2, url: 'https://claude.ai/frame' }
  ] });
  await harness2.services.applyConfig(await harness2.services.getSiteConfig());
  assert.ok(harness2.stats.payloadPushes > 0);
});

test('runtime 注入失败只记录 warning，不阻断 payload 投递', async () => {
  const harness = createHarness({ mainInjectError: true });
  await harness.services.syncTab(7, TAB_URL);
  assert.ok(harness.stats.payloadPushes > 0);
});

test('pushPayload 投递失败不抛出，clear 失败也不抛出', async () => {
  const harness = createHarness();
  (globalThis as any).chrome.tabs.sendMessage = async () => { throw new Error('no receiver'); };
  const config = await harness.services.getSiteConfig();
  await assert.doesNotReject(() => harness.services.applyConfig(config));
});

test('updateGeolocation 覆盖 disabled / 非强制不需要 / API 全失败', async () => {
  const disabled = createHarness();
  await disabled.services.saveSiteConfig({ ...(await disabled.services.getSiteConfig()), masterEnabled: false });
  assert.equal((await disabled.services.updateGeolocation()).disabled, true);

  const manual = createHarness();
  const manualConfig = await manual.services.getSiteConfig();
  await manual.services.saveSiteConfig({
    ...manualConfig,
    rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any,
    globalProfile: {
      ...manualConfig.globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: { ...manualConfig.globalProfile.geolocation, enabled: false }
    }
  });
  assert.equal((await manual.services.updateGeolocation()).unchanged, true);

  const failed = createHarness();
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ success: false }) } as any);
  const result = await failed.services.updateGeolocation(true);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /no valid coordinates/);
});

test('frozen 烘焙配置让保存完全无效', async () => {
  const baked = normalizeConfig({
    masterEnabled: true,
    rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any
  });
  (globalThis as any).__VANISHGEO_BRIDGE__ = false;
  (globalThis as any).__VANISHGEO_BAKED__ = { config: baked };
  try {
    const harness = createHarness();
    const config = await harness.services.getSiteConfig();
    assert.equal(config.rules.length, 1);
    const saved = await harness.services.saveSiteConfig({ ...config, masterEnabled: false });
    assert.equal(saved.masterEnabled, true);
    assert.equal(harness.storage.siteSpoofConfig, undefined);
    assert.equal((await harness.services.setDomainRuleEnabled('claude.ai', false)).masterEnabled, true);
  } finally {
    delete (globalThis as any).__VANISHGEO_BRIDGE__;
    delete (globalThis as any).__VANISHGEO_BAKED__;
  }
});

test('注册内容脚本：无匹配时注销、Duplicate 回退 update、已存在时 update', async () => {
  const empty = createHarness();
  const base = await empty.services.getSiteConfig();
  await empty.services.saveSiteConfig({ ...base, rules: [] });
  assert.equal(empty.stats.unregistered, 1);

  const duplicate = createHarness({ registerError: 'Duplicate script ID: vanishgeo-main-runtime' });
  await duplicate.services.applyConfig(await duplicate.services.getSiteConfig());
  assert.ok(duplicate.stats.updated > 0);

  const existing = createHarness({ registeredScripts: [
    { id: 'vanishgeo-main-runtime' },
    { id: 'vanishgeo-bridge' },
    { id: 'other' }
  ] });
  await existing.services.applyConfig(await existing.services.getSiteConfig());
  assert.ok(existing.stats.updated > 0);
});

test('没有内容脚本 API 时注册直接跳过', async () => {
  const harness = createHarness();
  (globalThis as any).chrome.scripting.registerContentScripts = undefined;
  await harness.services.applyConfig(await harness.services.getSiteConfig());
  assert.equal(harness.stats.registered, 0);
});

test('updateGeolocation 读取配置抛错时记录错误并返回失败', async () => {
  const harness = createHarness();
  const original = (globalThis as any).chrome.storage.local.get;
  (globalThis as any).chrome.storage.local.get = async () => { throw new Error('storage blocked'); };
  try {
    const result = await harness.services.updateGeolocation(true);
    assert.equal(result.ok, false);
    assert.match(result.error || '', /background geolocation update failed/);
    assert.match(harness.storage.lastGeoError || '', /storage blocked/);
  } finally {
    (globalThis as any).chrome.storage.local.get = original;
  }
});

test('refreshActionBadge 在 tabs.query 失败时静默跳过', async () => {
  const harness = createHarness();
  const original = (globalThis as any).chrome.tabs.query;
  (globalThis as any).chrome.tabs.query = async () => { throw new Error('tabs blocked'); };
  try {
    await assert.doesNotReject(() => harness.services.refreshActionBadge());
  } finally {
    (globalThis as any).chrome.tabs.query = original;
  }
});

test('reloadAffectedTabs 跳过非法 URL，reload 抛错也不传播', async () => {
  const harness = createHarness({ tabs: [
    { id: 1, url: 'https://claude.ai/x' },
    { id: 2, url: 'http://[bad' }
  ], reloadError: true });
  await assert.doesNotReject(() => harness.services.reloadAffectedTabs('claude.ai'));
  assert.deepEqual(harness.stats.reloads, []);
});

test('addDomainRule 走新建规则分支', async () => {
  const harness = createHarness();
  const saved = await harness.services.addDomainRule('new.example');
  assert.ok(saved.rules.some((rule) => rule.domain === 'new.example' && rule.enabled));
});
