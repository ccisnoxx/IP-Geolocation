import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import { createBackgroundServices, configNeedsLocation, fetchJson, parseGeoApiResponse } from '../src/background/services';
import { IP_SYNC_ALARM_NAME, LAST_SYNCED_IP_KEY } from '../src/background/ip-sync';

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
    /** 假 Chrome 里 contentSettings 的**真实**状态：pattern → setting */
    permissionState: Map<string, string>;
    /** clear() 因参数不合契约而被拒的次数（真 Chrome 会抛 TypeError） */
    permissionClearErrors: number;
    /** clear() 被调用的次数（不管成功还是抛错） */
    permissionClearAttempts: number;
    maxConcurrentSends: number;
    registered: number;
    updated: number;
    unregistered: number;
    tabCreates: number;
    badgeTexts: Array<{ text: string; tabId?: number }>;
    /** 每次 updateDynamicRules 写进去的 addRules，用来断言"最后一次写的是什么" */
    dnrWrites: Array<any[]>;
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
  geoPayload?: any;
  /** 卡住 IP 接口：用来把"接口还没回来"这段时间腾出来做别的事 */
  fetchGate?: Promise<void>;
  /** 让 contentSettings.clear 抛错：验证"清不掉就不许改账本" */
  permissionClearError?: string;
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
    permissionState: new Map<string, string>(),
    permissionClearErrors: 0,
    permissionClearAttempts: 0,
    maxConcurrentSends: 0,
    registered: 0,
    updated: 0,
    unregistered: 0,
    tabCreates: 0,
    badgeTexts: [] as Array<{ text: string; tabId?: number }>,
    dnrWrites: [] as Array<any[]>
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

  const geoPayload = options.geoPayload ?? {
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
    // 与 Chrome 契约**一致**的 contentSettings 替身。
    //
    // ContentSetting.clear() 的签名是 clear({ scope? })：它清掉本扩展该类型的
    // 全部规则，**没有** primaryPattern，也不提供"按域名删一条"。旧 mock 把
    // primaryPattern 收下并记录，等于替真实 API 实现了一个它没有的能力 ——
    // services.ts 里那个 `clear({ scope, primaryPattern })` 因此在测试里永远是绿的。
    // 现在多传一个键就按真机行为抛 TypeError。
    contentSettings: {
      location: {
        set: async (details: any) => {
          stats.permissions.push({ setting: details.setting, pattern: details.primaryPattern });
          stats.permissionState.set(String(details.primaryPattern), String(details.setting));
        },
        clear: async (details?: any) => {
          stats.permissionClearAttempts += 1;
          const keys = details && typeof details === 'object' ? Object.keys(details) : [];
          const unexpected = keys.filter((key) => key !== 'scope');
          if (unexpected.length) {
            stats.permissionClearErrors += 1;
            throw new TypeError(`contentSettings.clear: unexpected argument ${unexpected.join(',')}`);
          }
          if (options.permissionClearError) throw new Error(options.permissionClearError);
          stats.permissionClears.push(details && details.scope ? String(details.scope) : 'all');
          stats.permissionState.clear();
        }
      }
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => [],
      getDynamicRules: async () => [],
      updateDynamicRules: async (arg: any) => { stats.dnrWrites.push(arg?.addRules || []); },
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
    // 闸门在计数之后等：调用方可以"看到了 fetches 增加"再决定放不放行
    if (options.fetchGate) await options.fetchGate;
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

test('慢读返回的旧快照不许写回缓存：失效之后必须读到保存后的配置', async () => {
  const harness = createHarness({ tabs: [] });
  const chrome = (globalThis as any).chrome;
  const originalGet = chrome.storage.local.get;
  // 冷启动那次读：先把空快照读出来，再拖 40ms 才返回（用户就在这段窗口里保存）
  let slowPending = true;
  chrome.storage.local.get = async (keys: any) => {
    if (!slowPending) return originalGet(keys);
    slowPending = false;
    const stale = await originalGet(keys);
    await new Promise((done) => setTimeout(done, 40));
    return stale;
  };

  const slow = harness.services.getSiteConfig();
  await new Promise((done) => setTimeout(done, 10));

  const base = await harness.services.getSiteConfig();
  await chrome.storage.local.set({
    siteSpoofConfig: { ...base, rules: [{ id: 'late', domain: 'late.example', enabled: true }] }
  });
  harness.services.invalidateStorageCache();     // 等价于 storage.onChanged 做的事

  await slow;                                    // 旧快照在这之后才落回
  const later = await harness.services.getSiteConfig();
  assert.deepEqual(later.rules.map((rule: any) => rule.domain), ['late.example'],
    '慢读的旧快照被写进缓存了：后续读会一直停在保存前');
  assert.deepEqual(harness.storage.siteSpoofConfig.rules.map((rule: any) => rule.domain), ['late.example'],
    '种子写入把用户配置盖掉了');
});

test('改语言重载命中的已打开页面（文档请求头要对齐），只改时区不重载', async () => {
  const harness = createHarness({
    tabs: [
      { id: 1, url: 'https://claude.ai/login' },
      { id: 2, url: 'https://mail.google.com/u/0' },
      { id: 3, url: 'https://unrelated.example/' }
    ]
  });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }, { id: 'b', domain: 'google.com', enabled: true }] as any
  });
  harness.stats.reloads.length = 0;

  // 只改时区：请求头没动，页面不该被重载
  const tokyo = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...tokyo,
    globalProfile: { ...tokyo.globalProfile, timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' } } as any
  });
  assert.deepEqual(harness.stats.reloads, [], '时区变化不碰 DNR，重载纯属打扰');

  // 改语言：命中的两个标签页都要重载，未命中的不碰
  const withTz = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...withTz,
    globalProfile: {
      ...withTz.globalProfile,
      language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' }
    } as any
  });
  assert.deepEqual(harness.stats.reloads.slice().sort(), [1, 2]);
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

test('Worker 包装失败被记录、聚合，并按 hostname 出现在标签页状态里', async () => {
  const harness = createHarness({ tabs: [{ id: 7, url: TAB_URL }] });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({ ...base, rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any });

  assert.equal(await harness.services.getWorkerFallbacks(TAB_URL), null);

  harness.services.reportWorkerFallback(TAB_URL, {
    reason: 'csp-blocked',
    script: 'https://claude.ai/worker.js',
    message: "Failed to construct 'Worker': Access to the script is denied by CSP"
  });
  harness.services.reportWorkerFallback(TAB_URL, { reason: 'csp-blocked', script: 'https://claude.ai/worker.js' });
  harness.services.reportWorkerFallback(TAB_URL, { reason: 'construct-failed', script: 'https://claude.ai/a.js' });

  const summary = harness.services.getWorkerFallbacks(TAB_URL);
  assert.ok(summary, '记录之后必须能读回来');
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.reasons.slice().sort(), ['construct-failed', 'csp-blocked']);
  assert.equal(summary.lastScript, 'https://claude.ai/a.js', '最近一次脚本要更新');
  assert.equal(summary.hostname, 'claude.ai');

  // 只有 hostname 相同才命中：别的站点不能被这条记录影响
  assert.equal(harness.services.getWorkerFallbacks('https://example.com/'), null);

  const state = await harness.services.getCurrentTabState({ id: 7, url: TAB_URL } as any);
  assert.equal(state.workerFallback?.count, 3);
  assert.equal(state.matched, true, '记录失败不能影响原本的匹配结果');
});

test('非法 url / 空回报不会污染记录表', async () => {
  const harness = createHarness({ tabs: [] });
  harness.services.reportWorkerFallback('', { reason: 'csp-blocked' });
  harness.services.reportWorkerFallback('not-a-url', { reason: 'csp-blocked' });
  harness.services.reportWorkerFallback('https://a.test/x', null as any);
  assert.equal(harness.services.getWorkerFallbacks('https://a.test/x'), null);
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

test('定位回来得晚时用此刻的配置重算，不把用户这几秒里的保存盖回去', async () => {
  // 真实事故形状：updateGeolocation 先读配置、再打 IP 接口（几秒），回来之后
  // 用进函数时抓到的旧配置重算请求头 —— 期间保存的新语言被 DNR 写回旧值。
  // 存储里是新配置、界面显示已保存，浏览器发出去的还是旧 Accept-Language。
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const harness = createHarness({ fetchGate: gate });

  const before = await harness.services.getSiteConfig();
  const pending = harness.services.updateGeolocation(true);
  for (let spin = 0; spin < 200 && harness.stats.fetches === 0; spin += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(harness.stats.fetches > 0, 'updateGeolocation 应该已经进到 IP 接口这一步');

  // 用户在"接口还没回来"这段时间里保存
  const saved = await harness.services.saveSiteConfig({
    ...before,
    rules: [{ id: 'r', domain: 'claude.ai', enabled: true }] as any,
    globalProfile: {
      ...before.globalProfile,
      language: {
        enabled: true,
        mode: 'preset',
        language: 'ja-JP',
        languages: ['ja-JP', 'ja'],
        acceptLanguage: 'ja-JP,ja;q=0.9'
      }
    } as any
  });
  assert.equal(saved.globalProfile.language.language, 'ja-JP');

  release();
  await pending;

  const last = harness.stats.dnrWrites.at(-1) || [];
  const values = [...new Set(last.flatMap((rule: any) => (rule.action?.requestHeaders || []).map((h: any) => h.value)))];
  assert.deepEqual(
    values,
    ['ja-JP,ja;q=0.9'],
    '定位回来后的重算用了旧配置：请求头会被写回默认值，而 storage 里是新配置'
  );
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

// ---------- 配置页的「跟随出口 IP」状态读取 ----------

test('getExitIpSyncState 只读：给出上次同步 IP 与定位，且不发起任何定位请求', async () => {
  const harness = createHarness();
  harness.storage.lastSyncedExitIp = '203.0.113.9';
  harness.storage.lastLocation = {
    latitude: 34.0522,
    longitude: -118.2437,
    accuracy: 50,
    timezone: 'America/Los_Angeles',
    country: 'United States',
    updateTime: 123
  };

  const fetchesBefore = harness.stats.fetches;
  const state = await harness.services.getExitIpSyncState();

  assert.equal(state.storedIp, '203.0.113.9');
  assert.equal(state.lastLocation?.timezone, 'America/Los_Angeles');
  assert.equal(state.lastLocation?.latitude, 34.0522);
  assert.equal(harness.stats.fetches, fetchesBefore, '状态读取不能顺手打地理接口');
});

test('getExitIpSyncState 在没同步过时给出空 IP 与 null 定位', async () => {
  const harness = createHarness();
  const state = await harness.services.getExitIpSyncState();
  assert.equal(state.storedIp, '');
  assert.equal(state.lastLocation, null);
});

test('开着跟随时 bootstrap 只打一轮归属地接口（不再 updateGeolocation + checkExitIp 各打一次）', async () => {
  const harness = createHarness({
    // ip-sync 要的是"同一次出口"的 IP + 归属地，所以响应里必须有 ip 字段
    geoPayload: { ip: '203.0.113.7', success: true, latitude: 34.0522, longitude: -118.2437, country: 'United States', timezone: { id: 'America/Los_Angeles', offset: -25200 } }
  });
  const base = await harness.services.getSiteConfig();
  // 打开开关本身会立刻同步一次（跃变），这是设计行为；先把已记录的 IP 清掉，
  // 让 bootstrap 必须自己查一遍 —— 这才是"冷启动"的形态
  await harness.services.saveSiteConfig({ ...base, ipSync: { enabled: true, syncLanguage: false, intervalMinutes: 5 } });
  // 打开开关那次同步是 fire-and-forget：等它落地再清 IP，否则它会在清掉之后再把 IP 写回来
  for (let i = 0; i < 40 && !(await harness.services.getExitIpSyncState()).storedIp; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  delete harness.storage[LAST_SYNCED_IP_KEY];
  assert.equal((await harness.services.getExitIpSyncState()).storedIp, '', '清干净才能验证冷启动');
  const before = harness.stats.fetches;

  await harness.services.bootstrap();
  assert.equal(harness.stats.fetches - before, 1, '一轮接口：checkExitIp 查到的归属地会自己写进 lastLocation');
  const state = await harness.services.getExitIpSyncState();
  assert.equal(state.storedIp, '203.0.113.7');
  assert.ok(state.lastLocation, '启动同步应该把坐标写下来');
});

test('定位接口全挂：返回 ok:false 并把原因写进 lastGeoError', async () => {
  // 三家都回了但没有坐标：走"没有有效坐标"这条分支，而不是静默成功
  const harness = createHarness({ geoPayload: { success: false } });
  await harness.services.getSiteConfig();
  const result = await harness.services.updateGeolocation(true);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no valid coordinates/);
  assert.match(String(harness.storage.lastGeoError ?? ''), /no valid coordinates/);
});

test('定位结果和存量一致时报 unchanged，不重复写 storage', async () => {
  const harness = createHarness({
    geoPayload: { latitude: 34.0522, longitude: -118.2437, country: 'United States', timezone: { id: 'America/Los_Angeles', offset: -25200 } }
  });
  await harness.services.getSiteConfig();
  const first = await harness.services.updateGeolocation(true);
  assert.equal(first.ok, true);
  const written = harness.storage.lastLocation;
  const second = await harness.services.updateGeolocation(false);
  assert.equal(second.unchanged, true, '坐标没变就不该再写一次');
  assert.deepEqual(harness.storage.lastLocation, written);
});

test('IP 接口给不出 ip 时 bootstrap 回退到常规定位（至少把坐标补上）', async () => {
  // 只有坐标、没有 ip：ip-sync 判不出出口 IP，于是 bootstrap 走 updateGeolocation
  const harness = createHarness({
    geoPayload: { latitude: 34.0522, longitude: -118.2437, country: 'United States', timezone: { id: 'America/Los_Angeles', offset: -25200 } }
  });
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({ ...base, ipSync: { enabled: true, syncLanguage: false, intervalMinutes: 5 } });
  for (let i = 0; i < 40 && (await harness.services.getExitIpSyncState()).lastLocation; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  await harness.services.bootstrap();
  const state = await harness.services.getExitIpSyncState();
  assert.ok(state.lastLocation, 'ip-sync 没写出坐标时应该由 updateGeolocation 补上');
});

test('规则域名为空时明确抛错，不静默建一条空规则', async () => {
  const harness = createHarness();
  await harness.services.getSiteConfig();
  await assert.rejects(() => harness.services.setDomainRuleEnabled('   ', true), /domain is required/);
});

test('关掉跟随开关时把定时器清掉（宿主有 chrome.alarms 的路径）', async () => {
  const harness = createHarness();
  const cleared: string[] = [];
  // 默认 harness 没有 alarms：这条分支只在真有 alarms 的宿主里走到
  (globalThis as any).chrome.alarms = {
    get: async () => undefined,
    create: async () => undefined,
    clear: async (name: string) => { cleared.push(name); return true; },
    getAll: async () => [],
    onAlarm: { addListener() {} }
  };
  try {
    const base = await harness.services.getSiteConfig();
    await harness.services.saveSiteConfig({ ...base, ipSync: { enabled: true, syncLanguage: false, intervalMinutes: 5 } });
    assert.equal(await harness.services.ensureIpSyncAlarm(), true, '开着时应该建出定时器');

    await harness.services.saveSiteConfig({ ...base, ipSync: { enabled: false, syncLanguage: false, intervalMinutes: 5 } });
    await harness.services.ensureIpSyncAlarm();
    assert.ok(cleared.includes(IP_SYNC_ALARM_NAME), `关掉开关要清掉 ${IP_SYNC_ALARM_NAME}`);
  } finally {
    delete (globalThis as any).chrome.alarms;
  }
});

test('applyExitIpNow 真的改写配置（不是只刷 lastLocation）', async () => {
  const harness = createHarness({
    geoPayload: {
      ip: '203.0.113.9',
      success: true,
      country: 'United States',
      country_code: 'US',
      latitude: 34.0522,
      longitude: -118.2437,
      timezone: { id: 'America/Los_Angeles', offset: -25200 }
    }
  });

  const outcome = await harness.services.applyExitIpNow();

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.ip, '203.0.113.9');
  assert.equal(outcome.timezone, 'America/Los_Angeles');

  // 手动路径必须落 manual：auto 档不显示配置里的坐标，点完按钮界面"什么都不变"
  const config = await harness.services.getSiteConfig();
  assert.equal(config.globalProfile.geolocation.mode, 'manual');
  assert.equal(config.globalProfile.geolocation.latitude, 34.0522);
  assert.equal(config.globalProfile.timezone.mode, 'manual');
  assert.equal(config.globalProfile.timezone.timezone, 'America/Los_Angeles');
  assert.equal(config.profile.activeProfileId, null);

  // lastLocation 也写了：auto 档与状态行都读它
  const state = await harness.services.getExitIpSyncState();
  assert.equal(state.lastLocation?.timezone, 'America/Los_Angeles');

  // 手动配置不许改写自动同步的账本，否则下一轮会被判成"出口没变"
  assert.equal(harness.storage[LAST_SYNCED_IP_KEY], undefined);
});

test('applyExitIpNow 查不到出口时返回错误，配置原样不动', async () => {
  const harness = createHarness({ geoPayload: { success: false, country: { code: 'CN' } } });
  const before = await harness.services.getSiteConfig();
  const snapshot = JSON.stringify({
    globalProfile: before.globalProfile,
    activeProfileId: before.profile.activeProfileId
  });

  const outcome = await harness.services.applyExitIpNow();

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /exit IP lookup failed/);
  const after = await harness.services.getSiteConfig();
  assert.equal(JSON.stringify({
    globalProfile: after.globalProfile,
    activeProfileId: after.profile.activeProfileId
  }), snapshot, '查不到出口时必须保持原配置');
});

// ---------- 定位权限：API 契约与账本一致性 ----------
//
// 报告里最优先的一条：旧代码 `settings.clear({ scope, primaryPattern })` 把
// primaryPattern 传给只接受 scope 的 Chrome API，异常被吞掉、账本却照样更新，
// 于是可能出现「补丁清了、授权还在、账本说已经删了」。下面的用例把两条都钉住：
// 调用形状必须符合契约，账本必须等于浏览器里真实存在的规则。

const inheritOverrides = () => ({
  language: { mode: 'inherit' as const, value: null },
  timezone: { mode: 'inherit' as const, value: null },
  geolocation: { mode: 'inherit' as const, value: null }
});

/** 账本快照：Map 直接 JSON.stringify 会变成 `{}`，必须显式转成 entries 数组 */
function ledgerSnapshot(storage: Record<string, any>): string {
  return JSON.stringify([...ledgerEntries(storage).entries()]);
}

/** 账本里三个 key 展开成 "pattern 域名 → setting"，便于和假 Chrome 的真实状态比 */
function ledgerEntries(storage: Record<string, any>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, setting] of [
    ['geoPermissionDomains', 'allow'],
    ['geoDeniedDomains', 'block'],
    ['geoAskDomains', 'ask']
  ] as const) {
    for (const domain of storage[key] || []) out.set(domain, setting);
  }
  return out;
}

test('定位权限的 clear 只传 scope：不再把 primaryPattern 塞给 Chrome API', async () => {
  const harness = createHarness();
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [
      { id: 'keep', domain: 'keep.clear-scope.example', enabled: true, overrides: inheritOverrides() } as any,
      { id: 'drop', domain: 'drop.clear-scope.example', enabled: true, overrides: inheritOverrides() } as any
    ]
  });
  assert.ok(ledgerEntries(harness.storage).has('drop.clear-scope.example'), '两个域名都该进账本');

  // 去掉一个域名 → 必须有"撤销"，于是走 clear + 整组重建这条路径
  await harness.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [{ id: 'keep', domain: 'keep.clear-scope.example', enabled: true, overrides: inheritOverrides() } as any]
  });

  assert.equal(harness.stats.permissionClearErrors, 0, 'clear 不允许带 primaryPattern（真 Chrome 会拒绝）');
  assert.ok(harness.stats.permissionClears.length >= 1, '撤销域名必须真的调 clear');
  assert.ok(harness.stats.permissionClears.every((scope) => scope === 'regular'), 'scope 只能是 regular');

  // 账本 == 浏览器里的真实规则（域名层面），不多也不少
  const ledger = ledgerEntries(harness.storage);
  assert.deepEqual([...ledger.keys()], ['keep.clear-scope.example']);
  const patterns = [...harness.stats.permissionState.keys()].sort();
  assert.deepEqual(patterns, ['*://*.keep.clear-scope.example/*', '*://keep.clear-scope.example/*']);
  assert.equal(
    harness.stats.permissionState.get('*://keep.clear-scope.example/*'),
    ledger.get('keep.clear-scope.example')
  );
});

test('clear 被拒时账本一个字节都不动（不许谎称已撤销）', async () => {
  const harness = createHarness();
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [
      { id: 'keep', domain: 'claude.ai', enabled: true, overrides: inheritOverrides() } as any,
      { id: 'drop', domain: 'example.com', enabled: true, overrides: inheritOverrides() } as any
    ]
  });
  const before = ledgerSnapshot(harness.storage);
  assert.ok(before.includes('example.com'), before);

  // 换一个会拒绝 clear 的 harness：浏览器状态与账本必须先保持原样
  const failing = createHarness({ permissionClearError: 'clear denied' });
  await failing.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [
      { id: 'keep', domain: 'keep.clear-denied.example', enabled: true, overrides: inheritOverrides() } as any,
      { id: 'drop', domain: 'drop.clear-denied.example', enabled: true, overrides: inheritOverrides() } as any
    ]
  });
  const failingBefore = ledgerSnapshot(failing.storage);
  assert.ok(failingBefore.includes('drop.clear-denied.example'), failingBefore);
  await failing.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [{ id: 'keep', domain: 'keep.clear-denied.example', enabled: true, overrides: inheritOverrides() } as any]
  });
  assert.ok(failing.stats.permissionClearAttempts >= 1, '这一次必须真的尝试过 clear');

  assert.equal(
    ledgerSnapshot(failing.storage),
    failingBefore,
    'clear 失败后账本必须保持原样，等下次配置变化重试'
  );
});

test('被排除的中间子域在权限层退回 ask，不被父域的 allow 盖住', async () => {
  const harness = createHarness();
  const base = await harness.services.getSiteConfig();
  await harness.services.saveSiteConfig({
    ...base,
    masterEnabled: true,
    rules: [
      { id: 'parent', domain: 'carveout.example', enabled: true, overrides: inheritOverrides() } as any,
      { id: 'child', domain: 'child.carveout.example', enabled: false, overrides: inheritOverrides() } as any,
      { id: 'grand', domain: 'active.child.carveout.example', enabled: true, overrides: inheritOverrides() } as any
    ]
  });

  const ledger = ledgerEntries(harness.storage);
  // contentSettings 里"最具体 pattern 优先"：中间子域自己的 ask 规则会盖住父域通配
  assert.ok(ledger.has('child.carveout.example'), '被排除的子域必须有显式规则');
  assert.notEqual(
    ledger.get('child.carveout.example'),
    ledger.get('carveout.example'),
    '不能和父域同一个 setting'
  );
  assert.ok(ledger.has('active.child.carveout.example'), '深层重新启用的域名仍要生效');
});
