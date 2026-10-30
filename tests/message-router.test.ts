import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBackgroundMessageRouter } from '../src/background/message-router';
import { createFrameRuleResolver } from '../src/background/blob-frames';
import { FRAME_RECEIPT_KEY, type FrameReceipt } from '../src/background/frame-receipts';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const uiSender = (path = '/options/options.html', extra: Record<string, any> = {}): chrome.runtime.MessageSender => ({
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}${path}`,
  origin: `chrome-extension://${EXTENSION_ID}`,
  ...extra
});
const contentSender = (extra: Record<string, any> = {}): chrome.runtime.MessageSender => ({
  id: EXTENSION_ID,
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 2,
  documentId: 'doc-9',
  url: 'https://sender.example/frame',
  ...extra
});

function createServices(overrides: Record<string, any> = {}) {
  const calls: Array<{ name: string; args: any[] }> = [];
  const record = (name: string, value?: any) => (...args: any[]) => {
    calls.push({ name, args });
    return Promise.resolve(value);
  };
  const resolver = createFrameRuleResolver();
  const services: any = {
    resolveFrameRuleUrl: resolver.resolve,
    resolveFrameRuleContext: resolver.resolveForContent,
    webRtcPolicies: { strict: 'disable_non_proxied_udp' },
    updateGeolocation: record('updateGeolocation', { ok: true }),
    getExtensionState: record('getExtensionState', { enabled: true }),
    setExtensionEnabled: record('setExtensionEnabled', { masterEnabled: true }),
    getSiteConfig: record('getSiteConfig', { masterEnabled: true, rules: [] }),
    saveSiteConfig: record('saveSiteConfig', { masterEnabled: true, rules: [] }),
    setWebRtcGlobalMode: record('setWebRtcGlobalMode', { masterEnabled: true }),
    getBakeSnapshot: record('getBakeSnapshot', { config: {} }),
    checkExitIp: record('checkExitIp', { ok: true, changed: false, layers: [], ip: '' }),
    applyExitIpNow: record('applyExitIpNow', {
      ok: true,
      changed: true,
      layers: ['timezone', 'geolocation'],
      ip: '203.0.113.9',
      country: 'United States',
      timezone: 'America/Los_Angeles',
      latitude: 34.0522,
      longitude: -118.2437,
      language: 'en-US'
    }),
    getExitIpSyncState: record('getExitIpSyncState', { storedIp: '', lastLocation: null }),
    getPayloadForUrl: record('getPayloadForUrl', { matched: true, payload: { hostname: 'example.com' }, errors: [] }),
    noteDocumentInjected: record('noteDocumentInjected'),
    reportFontLayers: (...args: any[]) => { calls.push({ name: 'reportFontLayers', args }); },
    reportWorkerFallback: (...args: any[]) => { calls.push({ name: 'reportWorkerFallback', args }); },
    getWorkerFallbacks: (...args: any[]) => { calls.push({ name: 'getWorkerFallbacks', args }); return []; },
    getFontLayers: (...args: any[]) => { calls.push({ name: 'getFontLayers', args }); return ['platform']; },
    getCurrentTabState: record('getCurrentTabState', { matched: true, domain: 'example.com' }),
    addDomainRule: record('addDomainRule', { masterEnabled: true }),
    setDomainRuleEnabled: record('setDomainRuleEnabled', { masterEnabled: true }),
    deleteDomainRule: record('deleteDomainRule', { masterEnabled: true }),
    reloadAffectedTabs: record('reloadAffectedTabs'),
    openDiagnosticPage: record('openDiagnosticPage'),
    ...overrides
  };
  return { services, calls };
}

function createSessionStorage(initial: Record<string, unknown> = {}) {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const values = copy(initial);
  return {
    async get(keys: string | string[] | null) {
      const names = keys === null ? Object.keys(values) : typeof keys === 'string' ? [keys] : keys;
      return copy(Object.fromEntries(names.filter(name => name in values).map(name => [name, values[name]])));
    },
    async set(items: Record<string, unknown>) { Object.assign(values, copy(items)); },
    async remove(keys: string | string[]) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    }
  };
}

const RECEIPT_KEY_BYTES = Array.from({ length: 32 }, (_, index) => index + 1);
function signReceiptBody(body: string): FrameReceipt {
  return { body, mac: createHmac('sha256', Uint8Array.from(RECEIPT_KEY_BYTES)).update(body).digest('hex') };
}

const frameIdentity = (tabId: number, frameId: number, documentId: string) => JSON.stringify([tabId, frameId, documentId]);
let frameEndpoint: { documents: Map<string, unknown>; messages: any[][] };

function installChrome(tab: any = { id: 7, url: 'https://example.com/' }, session = createSessionStorage()) {
  const opened: string[] = [];
  const documents = new Map<string, unknown>();
  const messages: any[][] = [];
  frameEndpoint = { documents, messages };
  (globalThis as any).chrome = {
    storage: { session },
    tabs: {
      get: async (id: number) => ({ id, url: 'https://example.com/' }),
      query: async () => [tab],
      sendMessage: async (tabId: number, message: any, target: { frameId: number; documentId: string }) => {
        if (message.action !== 'readFrameEvidence' && message.action !== 'storeFrameEvidence') throw new Error('Receiving end does not exist');
        messages.push([tabId, message, target]);
        const key = frameIdentity(tabId, target.frameId, target.documentId);
        if (message.action === 'readFrameEvidence') return { frameEvidence: documents.get(key) ?? null };
        documents.set(key, message.frameEvidence);
        return { stored: true };
      }
    },
    runtime: { id: EXTENSION_ID, openOptionsPage: async () => { opened.push('options'); } }
  };
  return opened;
}

test('getPayloadForUrl 仅按浏览器 sender URL 解析并保留同文档记账', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond(
    { action: 'getPayloadForUrl', url: 'https://forged.example/frame', documentId: 'forged' },
    contentSender({ url: 'https://child.example.com/frame' })
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.payload.hostname, 'example.com');
  assert.deepEqual(calls.map((call) => call.name).slice(0, 2), ['noteDocumentInjected', 'getPayloadForUrl']);
  assert.deepEqual(calls[0].args, ['doc-9']);
  assert.deepEqual(calls[1].args, ['https://child.example.com/frame']);
});

test('reportFontLayers 始终按 sender URL 归属，忽略消息自报地址', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'reportFontLayers', layers: ['canvas'] }, contentSender({ url: 'https://sender.example/' }));
  await router.respond({ action: 'reportFontLayers', url: 'https://request.example/', layers: ['platform'] }, contentSender({ url: 'https://sender.example/' }));

  const reports = calls.filter((call) => call.name === 'reportFontLayers');
  assert.deepEqual(reports[0].args, ['https://sender.example/', ['canvas']]);
  assert.deepEqual(reports[1].args, ['https://sender.example/', ['platform']]);
  assert.equal(calls.some((call) => call.name === 'noteDocumentInjected'), false);
});

test('setSiteConfig 把空对象交给保存层，applyProfile 先读再写', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'setSiteConfig' }, uiSender());
  assert.deepEqual(calls.find((call) => call.name === 'saveSiteConfig')?.args, [{}]);

  const before = calls.length;
  await router.respond({ action: 'applyProfile', profileId: 'p1' }, uiSender());
  const names = calls.slice(before).map((call) => call.name);
  assert.deepEqual(names, ['getSiteConfig', 'saveSiteConfig']);
});

test('checkExitIpSync 透传 force，并把新配置与状态一起回给配置页', async () => {
  installChrome();
  const { services, calls } = createServices({
    checkExitIp: (...args: any[]) => {
      calls.push({ name: 'checkExitIp', args });
      return Promise.resolve({ ok: true, changed: true, skipped: undefined, layers: ['timezone', 'geolocation'], ip: '203.0.113.9' });
    },
    getExitIpSyncState: (...args: any[]) => {
      calls.push({ name: 'getExitIpSyncState', args });
      return Promise.resolve({ storedIp: '203.0.113.9', lastLocation: { latitude: 1, longitude: 2 } });
    }
  });
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'checkExitIpSync', force: true }, uiSender());
  assert.equal(response.status, 'ok');
  assert.deepEqual(response.outcome.layers, ['timezone', 'geolocation']);
  assert.equal(response.storedIp, '203.0.113.9');
  assert.ok(response.config, '要把同步后的配置带回去，配置页才不用再多发一轮');
  assert.deepEqual(calls.find((call) => call.name === 'checkExitIp')!.args[0], { force: true });

  // 不带 force 的消息不能偷偷强制刷新
  await router.respond({ action: 'checkExitIpSync' }, uiSender());
  assert.deepEqual(calls.filter((call) => call.name === 'checkExitIp').at(-1)!.args[0], { force: false });

  // 字符串 "false" 经 Boolean() 会变成 true：那样会白打一次接口并无条件重写配置
  await router.respond({ action: 'checkExitIpSync', force: 'false' }, uiSender());
  assert.deepEqual(calls.filter((call) => call.name === 'checkExitIp').at(-1)!.args[0], { force: false });
  await router.respond({ action: 'checkExitIpSync', force: 1 }, uiSender());
  assert.deepEqual(calls.filter((call) => call.name === 'checkExitIp').at(-1)!.args[0], { force: false });
});

test('applyFromExitIp 把结果、配置与定位一起回给界面', async () => {
  installChrome();
  const { services, calls } = createServices({
    getSiteConfig: async () => ({ masterEnabled: true, ipSync: { enabled: false, intervalMinutes: 5, syncLanguage: false } }),
    getExitIpSyncState: async () => ({ storedIp: '', lastLocation: { latitude: 34.0522, longitude: -118.2437, country: 'United States', timezone: 'America/Los_Angeles' } })
  });
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'applyFromExitIp' }, uiSender());

  assert.equal(response.status, 'ok');
  assert.equal(response.outcome.ok, true);
  assert.equal(response.outcome.ip, '203.0.113.9');
  assert.equal(response.outcome.timezone, 'America/Los_Angeles');
  // 界面要靠这几样直接重画表单，省掉再多发一轮 getCurrentTabState
  assert.ok(response.config, '要把新配置带回去');
  assert.equal(response.lastLocation.timezone, 'America/Los_Angeles');
  assert.ok(calls.some((call) => call.name === 'applyExitIpNow'));
});

test('getExitIpSyncState 只读：返回 ipSync 配置与上次同步状态', async () => {
  installChrome();
  const { services } = createServices({
    getSiteConfig: async () => ({ masterEnabled: true, ipSync: { enabled: false, intervalMinutes: 5, syncLanguage: false } }),
    getExitIpSyncState: async () => ({ storedIp: '', lastLocation: null })
  });
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'getExitIpSyncState' }, uiSender());
  assert.equal(response.status, 'ok');
  assert.deepEqual(response.ipSync, { enabled: false, intervalMinutes: 5, syncLanguage: false });
  assert.equal(response.storedIp, '');
  assert.equal(response.lastLocation, null);
});

test('getWebRtcConfig 返回规范化配置和生效策略', async () => {
  installChrome();
  const { services } = createServices({
    getSiteConfig: async () => ({
      masterEnabled: true,
      webRtc: { enabled: true, globalMode: 'strict' }
    })
  });
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'getWebRtcConfig' }, uiSender());
  assert.equal(response.status, 'ok');
  assert.equal(response.state.effectivePolicy, 'disable_non_proxied_udp');
});

test('getCurrentTabState 传 tabId 时按该标签页算，否则取当前活动标签页', async () => {
  const active = { id: 3, url: 'https://active.example/' };
  installChrome(active);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'getCurrentTabState', tabId: 9 }, uiSender());
  await router.respond({ action: 'getCurrentTabState' }, uiSender());

  const states = calls.filter((call) => call.name === 'getCurrentTabState');
  assert.deepEqual(states[0].args[0], { id: 9, url: 'https://example.com/' });
  assert.deepEqual(states[1].args[0], active);
});

test('openOptions 调 chrome.runtime.openOptionsPage', async () => {
  const opened = installChrome();
  const { services } = createServices();
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'openOptions' }, uiSender());
  assert.equal(response.status, 'ok');
  assert.deepEqual(opened, ['options']);
});

test('未知 action 抛错，由 service worker 统一转成 error response', async () => {
  installChrome();
  const { services } = createServices();
  const router = createBackgroundMessageRouter(services);

  await assert.rejects(() => router.respond({ action: 'nope' }, uiSender()), /unknown action/);
  await assert.rejects(() => router.respond(undefined, uiSender()), /unknown action/);
});


test('已知 action 都能路由到对应 service（表驱动，防止新增 action 漏接）', async () => {
  const opened = installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const requests: Array<Record<string, unknown>> = [
    { action: 'manualUpdate' },
    { action: 'applyFromExitIp' },
    { action: 'getExtensionState' },
    { action: 'setExtensionEnabled', enabled: true },
    { action: 'getSiteConfig' },
    { action: 'setSiteConfig', config: { masterEnabled: true } },
    { action: 'resetSiteConfig' },
    { action: 'setWebRtcGlobalMode', mode: 'strict' },
    { action: 'getWebRtcConfig' },
    { action: 'getPayloadForUrl', url: 'https://example.com/' },
    { action: 'reportFontLayers', url: 'https://example.com/', layers: ['platform'] },
    { action: 'reportWorkerFallback', url: 'https://example.com/', reason: 'csp-blocked' },
    { action: 'getWorkerFallbacks', url: 'https://example.com/' },
    { action: 'getFontLayers', url: 'https://example.com/' },
    { action: 'getBakeSnapshot' },
    { action: 'getExitIpSyncState' },
    { action: 'checkExitIpSync', force: true },
    { action: 'getCurrentTabState' },
    { action: 'addDomainRule', domain: 'example.com' },
    { action: 'setDomainRuleEnabled', domain: 'example.com', enabled: false },
    { action: 'deleteDomainRule', domain: 'example.com' },
    { action: 'reloadAffectedTabs', domain: 'example.com' },
    { action: 'applyProfile', profileId: 'p1' },
    { action: 'openDiagnosticPage' },
    { action: 'openLeakTest' },
    { action: 'openOptions' }
  ];

  const expectedServices: Record<string, string[]> = {
    manualUpdate: ['updateGeolocation'],
    applyFromExitIp: ['applyExitIpNow', 'getSiteConfig', 'getExitIpSyncState'],
    getExtensionState: ['getExtensionState'],
    setExtensionEnabled: ['setExtensionEnabled'],
    getSiteConfig: ['getSiteConfig'],
    setSiteConfig: ['saveSiteConfig'],
    resetSiteConfig: ['saveSiteConfig'],
    setWebRtcGlobalMode: ['setWebRtcGlobalMode'],
    getWebRtcConfig: ['getSiteConfig'],
    getPayloadForUrl: ['getPayloadForUrl'],
    reportFontLayers: ['reportFontLayers'],
    reportWorkerFallback: ['reportWorkerFallback'],
    getWorkerFallbacks: ['getWorkerFallbacks'],
    getFontLayers: ['getFontLayers'],
    getBakeSnapshot: ['getBakeSnapshot'],
    getExitIpSyncState: ['getSiteConfig', 'getExitIpSyncState'],
    checkExitIpSync: ['checkExitIp', 'getSiteConfig', 'getExitIpSyncState'],
    getCurrentTabState: ['getCurrentTabState'],
    addDomainRule: ['addDomainRule'],
    setDomainRuleEnabled: ['setDomainRuleEnabled'],
    deleteDomainRule: ['deleteDomainRule'],
    reloadAffectedTabs: ['reloadAffectedTabs'],
    applyProfile: ['getSiteConfig', 'saveSiteConfig'],
    openDiagnosticPage: ['openDiagnosticPage'],
    openLeakTest: ['openDiagnosticPage'],
    openOptions: []
  };
  const expectedArguments: Record<string, unknown[]> = {
    manualUpdate: [true],
    setExtensionEnabled: [true],
    setSiteConfig: [{ masterEnabled: true }],
    resetSiteConfig: [{}],
    setWebRtcGlobalMode: ['strict'],
    addDomainRule: ['example.com'],
    setDomainRuleEnabled: ['example.com', false],
    deleteDomainRule: ['example.com'],
    reloadAffectedTabs: ['example.com']
  };

  for (const request of requests) {
    const before = calls.length;
    const response = await router.respond(request, uiSender());
    const action = String(request.action);
    assert.equal(response.status, 'ok', action);
    const routed = calls.slice(before);
    assert.deepEqual(routed.map((call) => call.name), expectedServices[action], action);
    if (expectedArguments[action]) assert.deepEqual(routed[0].args, expectedArguments[action], action);
  }
  assert.deepEqual(opened, ['options']);
});

const PRIVILEGED_ACTIONS = [
  'manualUpdate', 'applyFromExitIp', 'getExtensionState', 'setExtensionEnabled',
  'getSiteConfig', 'setSiteConfig', 'resetSiteConfig', 'setWebRtcGlobalMode',
  'getWebRtcConfig', 'getExitIpSyncState', 'checkExitIpSync', 'getWorkerFallbacks',
  'getFontLayers', 'getBakeSnapshot', 'getCurrentTabState', 'addDomainRule',
  'setDomainRuleEnabled', 'deleteDomainRule', 'reloadAffectedTabs', 'applyProfile',
  'openDiagnosticPage', 'openLeakTest', 'openOptions'
];

test('同扩展 ID 的网页调用方只能访问三种 content 动作，特权动作零副作用', async () => {
  const opened = installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const action of [...PRIVILEGED_ACTIONS, 'unknown']) {
    await assert.rejects(() => router.respond({ action }, contentSender()), /not allowed/, action);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(opened, []);
});

test('外部或缺失 ID、伪扩展地址、未知扩展页和不兼容 origin 全部拒绝', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const senders = [
    uiSender('/popup/popup.html', { id: 'other-extension' }),
    uiSender('/popup/popup.html', { id: undefined }),
    contentSender({ id: undefined }),
    contentSender({ id: 'other-extension' }),
    uiSender('/unknown.html', { tab: { id: 7 }, frameId: 0, documentId: 'doc-ui' }),
    uiSender('/popup/popup.html', { url: `https://example.com/chrome-extension://${EXTENSION_ID}/popup/popup.html` }),
    uiSender('/popup/popup.html', { url: `chrome-extension://${EXTENSION_ID}.example/popup/popup.html` }),
    uiSender('/popup/popup.html', { url: `chrome-extension://${EXTENSION_ID}/popup/popup.html/extra` }),
    uiSender('/popup/popup.html', { origin: 'null' }),
    uiSender('/popup/popup.html', { origin: 'https://example.com' }),
    uiSender('/popup/popup.html', { origin: 'chrome-extension://other-extension' }),
    uiSender('/popup/popup.html', { url: undefined })
  ];
  for (const sender of senders) {
    await assert.rejects(() => router.respond({ action: 'setSiteConfig', config: {} }, sender));
    await assert.rejects(() => router.respond({ action: 'getPayloadForUrl', url: 'https://forged.example/' }, sender));
  }
  assert.deepEqual(calls, []);
});

test('popup/options/leak-test 含 tab 的可信扩展页保留特权，query/hash 不影响白名单', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const path of ['/popup/popup.html', '/options/options.html?view=rules#ip', '/leak-test/leak-test.html#results']) {
    const sender = uiSender(path, { tab: { id: 7 }, frameId: 0, documentId: 'doc-ui' });
    await router.respond({ action: 'getSiteConfig' }, sender);
    await router.respond({ action: 'getPayloadForUrl', url: 'https://diagnostic.example/' }, sender);
  }
  assert.deepEqual(calls.map((call) => call.name), Array(3).fill(['getSiteConfig', 'getPayloadForUrl']).flat());
  assert.deepEqual(calls.filter((call) => call.name === 'getPayloadForUrl').map((call) => call.args), Array(3).fill(['https://diagnostic.example/']));
  await router.respond({ action: 'getSiteConfig' }, uiSender('/popup/popup.html', { origin: undefined }));
});

test('content 必须具备浏览器 tab/frame/document 身份，消息自报字段不能补齐', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const invalid = [
    { tab: undefined }, { tab: { id: -1 } }, { tab: { id: 1.5 } }, { tab: { id: '7' } },
    { frameId: undefined }, { frameId: -1 }, { frameId: 0.5 }, { frameId: '2' },
    { documentId: undefined }, { documentId: '' }, { documentId: '   ' }, { url: undefined },
    { url: 'file:///tmp/page.html' }, { url: 'chrome://settings/' }, { url: 'about:config' }, { url: 'invalid' }
  ];
  for (const overrides of invalid) {
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, tabId: 7, frameId: 2, documentId: 'forged', url: 'https://forged.example/', referrer: 'https://forged.example/' }, contentSender(overrides)));
    }
  }
  assert.deepEqual(calls, []);
});

test('content 的三种动作只按 sender URL 归属，只有 payload 拉取按 sender documentId 记账', async () => {
  installChrome();
  (chrome as any).webNavigation = { getAllFrames: () => { throw new Error('普通 HTTP 不应查询导航'); } };
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ tab: { id: 0 }, frameId: 0 });
  const response = await router.respond({ action: 'getPayloadForUrl', url: 'https://forged.example/', documentId: 'forged' }, sender);
  assert.equal(response.effectiveUrl, sender.url);
  assert.equal('frameEvidence' in response, false, '普通 HTTP 响应不需要文档父链凭证');
  await router.respond({ action: 'reportFontLayers', url: 'https://forged.example/', layers: ['canvas'] }, sender);
  await router.respond({ action: 'reportWorkerFallback', url: 'https://forged.example/', reason: 'csp-blocked', script: 'worker.js', message: 'blocked' }, sender);
  assert.deepEqual(calls, [
    { name: 'noteDocumentInjected', args: ['doc-9'] },
    { name: 'getPayloadForUrl', args: ['https://sender.example/frame'] },
    { name: 'reportFontLayers', args: ['https://sender.example/frame', ['canvas']] },
    { name: 'reportWorkerFallback', args: ['https://sender.example/frame', { reason: 'csp-blocked', script: 'worker.js', message: 'blocked' }] }
  ]);
  assert.deepEqual(frameEndpoint.messages, [], '普通 HTTP 不访问 receipt 端点');
  assert.deepEqual(await chrome.storage.session.get(null), {}, '普通 HTTP 不创建签名密钥');
});

function installFrames(frames: any[] | null | undefined, error?: Error) {
  const queries: any[] = [];
  (chrome as any).webNavigation = {
    getAllFrames: async (details: any) => {
      queries.push(details);
      if (error) throw error;
      return frames;
    }
  };
  return queries;
}

const OPAQUE_URLS = ['about:blank', 'about:srcdoc', 'blob:https://creator.example/id', 'data:text/html,hello', 'filesystem:https://creator.example/temporary/page.html'];

test('opaque 文档逐级证明父 documentId 并继承最近 HTTP 父规则，不采用自报或创建者域', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const url of OPAQUE_URLS) {
    const queries = installFrames([
      { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' },
      { frameId: 1, documentId: 'parent', parentFrameId: 0, parentDocumentId: 'top', url: 'https://nearest.example/path' },
      { frameId: 2, documentId: 'middle', parentFrameId: 1, parentDocumentId: 'parent', url: 'about:srcdoc' },
      { frameId: 3, documentId: 'child', parentFrameId: 2, parentDocumentId: 'middle', url }
    ]);
    const sender = contentSender({ frameId: 3, documentId: 'child', url, origin: 'https://creator.example' });
    const before = calls.length;
    const response = await router.respond({ action: 'getPayloadForUrl', url: 'https://forged.example/', tabId: 99, frameId: 0, documentId: 'top', referrer: 'https://forged.example/' }, sender);
    assert.equal(response.effectiveUrl, 'https://nearest.example/path');
    assert.deepEqual(queries, [{ tabId: 7 }]);
    assert.deepEqual(calls.slice(before), [
      { name: 'noteDocumentInjected', args: ['child'] },
      { name: 'getPayloadForUrl', args: ['https://nearest.example/path'] }
    ]);
    await router.respond({ action: 'reportFontLayers', layers: ['canvas'] }, sender);
    await router.respond({ action: 'reportWorkerFallback', reason: 'blob-failed' }, sender);
    assert.deepEqual(calls.slice(before + 2), [
      { name: 'reportFontLayers', args: ['https://nearest.example/path', ['canvas']] },
      { name: 'reportWorkerFallback', args: ['https://nearest.example/path', { reason: 'blob-failed', script: undefined, message: undefined }] }
    ]);
  }
});

test('opaque 链缺失、断链、换文档、无父、循环、未知父 scheme 或 API 失败均抛错且零 service 副作用', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 2, documentId: 'doc-9', parentFrameId: 0, parentDocumentId: 'top', url: 'about:blank' };
  const cases = [
    undefined, null, [], [top], [top, { ...child, documentId: 'navigated' }],
    [top, { ...child, parentDocumentId: 'old-top' }], [top, { ...child, parentDocumentId: undefined }],
    [{ ...child, parentFrameId: -1, parentDocumentId: undefined }],
    [{ ...child, parentFrameId: 2, parentDocumentId: 'doc-9' }],
    [child, { ...top, url: 'about:srcdoc', parentFrameId: 2, parentDocumentId: 'doc-9' }],
    [child, { ...top, url: 'file:///tmp/top.html' }],
    [child, { ...top, url: 'chrome://settings/' }],
    [child, { ...top, url: 'invalid' }],
    [top, { ...child, parentFrameId: 1, parentDocumentId: 'middle' },
      { frameId: 1, documentId: 'middle', parentFrameId: 0, parentDocumentId: 'old-top', url: 'about:srcdoc' }],
    [top, { ...child, parentFrameId: 1, parentDocumentId: 'middle' },
      { frameId: 1, documentId: 'middle', parentFrameId: 9, parentDocumentId: 'missing', url: 'about:srcdoc' }]
  ];
  for (const frames of cases) {
    installFrames(frames);
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, url: 'https://forged.example/', referrer: 'https://top.example/' }, contentSender({ url: 'about:blank' })));
    }
  }
  installFrames([], new Error('navigation unavailable'));
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action }, contentSender({ url: 'about:blank' })), /navigation unavailable/);
  }
  (chrome as any).webNavigation = undefined;
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, contentSender({ url: 'about:blank' })));
  assert.deepEqual(calls, []);
});

function installBlobProbe(results: any[] | Error) {
  const probes: any[] = [];
  (chrome as any).scripting = {
    executeScript: async (details: any) => {
      probes.push(details);
      if (results instanceof Error) throw results;
      return results;
    }
  };
  return probes;
}

test('Chrome 缺失 blob 导航快照时，blob sender 与 data 子文档均按精确父探测继承最近 HTTP 规则', async () => {
  const blobUrl = 'blob:https://creator.example/missing-from-navigation';
  const parentUrl = 'https://nearest.example/nested';
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const parent = { frameId: 1, documentId: 'nearest', parentFrameId: 0, parentDocumentId: 'top', url: parentUrl };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  for (const sender of [
    contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl, origin: 'https://creator.example' }),
    contentSender({ frameId: 6, documentId: 'data-doc', url: data.url, origin: 'null' })
  ]) {
    installChrome();
    const queries = installFrames([top, parent, data]);
    const probes = installBlobProbe([{ frameId: 5, documentId: 'blob-doc', result: { url: blobUrl, parentUrl } }]);
    const { services, calls } = createServices();
    const router = createBackgroundMessageRouter(services);
    const response = await router.respond({ action: 'getPayloadForUrl', url: 'https://forged.example/', referrer: 'https://top.example/' }, sender);
    await router.respond({ action: 'reportFontLayers', url: 'https://forged.example/', layers: ['canvas'] }, sender);
    await router.respond({ action: 'reportWorkerFallback', url: 'https://forged.example/', reason: 'blob-failed' }, sender);

    assert.equal(response.effectiveUrl, parentUrl);
    assert.deepEqual(calls, [
      { name: 'noteDocumentInjected', args: [sender.documentId] },
      { name: 'getPayloadForUrl', args: [parentUrl] },
      { name: 'reportFontLayers', args: [parentUrl, ['canvas']] },
      { name: 'reportWorkerFallback', args: [parentUrl, { reason: 'blob-failed', script: undefined, message: undefined }] }
    ]);
    assert.deepEqual(queries, Array(3).fill({ tabId: 7 }));
    assert.equal(probes.length, 3);
    for (const probe of probes) {
      assert.deepEqual(probe.target, { tabId: 7, documentIds: ['blob-doc'] });
      assert.equal(probe.world, 'ISOLATED');
    }
  }
});

test('缺失 blob 的精确探测为空、身份变化、非 blob、未知父或抛错时，三种 content 动作均零 service 副作用', async () => {
  const blobUrl = 'blob:https://creator.example/missing';
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  const valid = { frameId: 5, documentId: 'blob-doc', result: { url: blobUrl, parentUrl: 'https://nearest.example/' } };
  const failures = [
    [],
    [{ ...valid, frameId: 9 }],
    [{ ...valid, documentId: 'reused-frame-new-doc' }],
    [{ ...valid, result: { ...valid.result, url: 'https://creator.example/navigated' } }],
    [{ ...valid, result: { ...valid.result, parentUrl: null } }],
    [{ ...valid, result: { ...valid.result, parentUrl: 'file:///tmp/unknown.html' } }],
    new Error('Blocked a frame from accessing a cross-origin frame')
  ];
  for (const sender of [
    contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl, origin: 'https://creator.example' }),
    contentSender({ frameId: 6, documentId: 'data-doc', url: data.url, origin: 'https://creator.example' })
  ]) {
    for (const result of failures) {
      installChrome();
      installFrames([top, data]);
      installBlobProbe(result);
      const { services, calls } = createServices();
      const router = createBackgroundMessageRouter(services);
      for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
        await assert.rejects(() => router.respond({ action, url: 'https://top.example/', referrer: 'https://top.example/' }, sender));
      }
      assert.deepEqual(calls, []);
    }
  }

  installChrome();
  installFrames([top]);
  installBlobProbe([{ ...valid, result: { ...valid.result, url: 'blob:https://creator.example/changed' } }]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl })));
  assert.deepEqual(calls, []);
});

test('缺失非 blob sender 或缺少 parentDocumentId 的链路不能触发 blob 探测', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const probes = installBlobProbe([{ frameId: 5, documentId: 'blob-doc', result: { url: 'blob:https://creator.example/id', parentUrl: top.url } }]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const url of ['about:blank', 'data:text/html,child', 'filesystem:https://creator.example/temporary/child']) {
    installFrames([top]);
    await assert.rejects(() => router.respond({ action: 'getPayloadForUrl', referrer: top.url }, contentSender({ url })));
  }
  installFrames([top, { frameId: 2, documentId: 'doc-9', parentFrameId: 5, url: 'data:text/html,child' }]);
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, contentSender({ url: 'data:text/html,child' })));
  assert.deepEqual(probes, []);
  assert.deepEqual(calls, []);
});

test('BFCache 仅剩顶层快照时，同 frame/document 的已证实 data 父边可恢复并重新探测 blob', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  const blobUrl = 'blob:https://creator.example/parent';
  installFrames([top, data]);
  installBlobProbe([{ frameId: 5, documentId: 'blob-doc', result: { url: blobUrl, parentUrl: 'https://nearest.example/before' } }]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data-doc', url: data.url });
  assert.equal((await router.respond({ action: 'getPayloadForUrl' }, sender)).effectiveUrl, 'https://nearest.example/before');

  calls.length = 0;
  installFrames([top]);
  const probes = installBlobProbe([{ frameId: 5, documentId: 'blob-doc', result: { url: blobUrl, parentUrl: 'https://nearest.example/restored' } }]);
  const restored = await router.respond({ action: 'getPayloadForUrl', referrer: top.url }, sender);
  assert.equal(restored.effectiveUrl, 'https://nearest.example/restored');
  assert.deepEqual(calls, [
    { name: 'noteDocumentInjected', args: ['data-doc'] },
    { name: 'getPayloadForUrl', args: ['https://nearest.example/restored'] }
  ]);
  assert.equal(probes.length, 1, '缓存父边仍需重新读取 blob 的当前可访问 HTTP 祖先');
  assert.deepEqual(probes[0].target, { tabId: 7, documentIds: ['blob-doc'] });

  calls.length = 0;
  for (const extra of [{ documentId: 'new-data-doc' }, { frameId: 9 }, { tab: { id: 8 } }]) {
    await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, contentSender({ ...sender, ...extra })));
  }
  assert.deepEqual(calls, []);
  assert.equal(probes.length, 1, '新文档、frame 或 tab 不能借旧边触发 blob 探测');

  const restarted = createServices();
  assert.equal((await createBackgroundMessageRouter(restarted.services).respond({ action: 'getPayloadForUrl' }, sender)).effectiveUrl, 'https://nearest.example/restored');
  assert.deepEqual(restarted.calls, [
    { name: 'noteDocumentInjected', args: ['data-doc'] },
    { name: 'getPayloadForUrl', args: ['https://nearest.example/restored'] }
  ]);
  assert.equal(probes.length, 2, '新 services 从目标文档恢复 receipt 后仍需精确重读 blob');

  await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null)));
  const cold = createServices();
  await assert.rejects(() => createBackgroundMessageRouter(cold.services).respond({ action: 'getPayloadForUrl' }, sender));
  assert.deepEqual(cold.calls, [], '会话密钥丢失时，新 services 不能信任文档中的旧 receipt');
  assert.equal(probes.length, 2, '无父边证据不能靠旧 blob 身份猜测祖先');
});

test('新导航快照与同文档已证实父边冲突时拒绝，不沿旧父或新父解析', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const parent = { frameId: 1, documentId: 'nearest', parentFrameId: 0, parentDocumentId: 'top', url: 'https://nearest.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 1, parentDocumentId: 'nearest', url: 'data:text/html,child' };
  installFrames([top, parent, data]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data-doc', url: data.url });
  await router.respond({ action: 'getPayloadForUrl' }, sender);

  calls.length = 0;
  installFrames([
    top,
    { frameId: 9, documentId: 'different-parent', parentFrameId: 0, parentDocumentId: 'top', url: 'https://different.example/' },
    { ...data, parentFrameId: 9, parentDocumentId: 'different-parent' }
  ]);
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action, url: top.url }, sender), /relationship changed/);
  }
  assert.deepEqual(calls, []);
});

test('父链解析失败不留下可供缺失快照复用的 data 父边', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  installFrames([top, data]);
  installBlobProbe([]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data-doc', url: data.url });
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, sender));

  installFrames([top]);
  const probes = installBlobProbe([{ frameId: 5, documentId: 'blob-doc', result: { url: 'blob:https://creator.example/parent', parentUrl: top.url } }]);
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl' }, sender));
  assert.deepEqual(probes, [], '前一次失败不能缓存未证实边，再借它恢复缺失文档');
  assert.deepEqual(calls, []);
});

function installBlobEndpoint(response: any) {
  const queries: any[] = [];
  const sendMessage = chrome.tabs.sendMessage;
  (chrome.tabs as any).sendMessage = async (...args: any[]) => {
    if (args[1]?.action !== 'readBlobParent') return (sendMessage as any)(...args);
    queries.push(args);
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(...args) : response;
  };
  return queries;
}

test('Chrome119 合法 blob 端点为三种 content 动作提供父证据，消息自报身份与父地址无效', async () => {
  const blobUrl = 'blob:https://creator.example/chrome119';
  const parentUrl = 'https://nearest.example/chrome119';
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  for (const sender of [
    contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl, origin: 'https://creator.example' }),
    contentSender({ frameId: 6, documentId: 'data-doc', url: data.url, origin: 'null' })
  ]) {
    installChrome();
    installFrames([top, data]);
    const probes = installBlobProbe(new Error('Chrome119 cannot access blob contents'));
    const queries = installBlobEndpoint({ url: blobUrl, parentUrl });
    const { services, calls } = createServices();
    const router = createBackgroundMessageRouter(services);
    const forged = { tabId: 99, frameId: 0, documentId: 'top', url: top.url, parentUrl: top.url, referrer: top.url, effectiveUrl: top.url };
    const response = await router.respond({ action: 'getPayloadForUrl', ...forged }, sender);
    await router.respond({ action: 'reportFontLayers', ...forged, layers: ['canvas'] }, sender);
    await router.respond({ action: 'reportWorkerFallback', ...forged, reason: 'blob-failed' }, sender);

    assert.equal(response.effectiveUrl, parentUrl);
    assert.deepEqual(calls, [
      { name: 'noteDocumentInjected', args: [sender.documentId] },
      { name: 'getPayloadForUrl', args: [parentUrl] },
      { name: 'reportFontLayers', args: [parentUrl, ['canvas']] },
      { name: 'reportWorkerFallback', args: [parentUrl, { reason: 'blob-failed', script: undefined, message: undefined }] }
    ]);
    assert.equal(probes.length, 3);
    for (const probe of probes) assert.deepEqual(probe.target, { tabId: 7, documentIds: ['blob-doc'] });
    assert.deepEqual(queries, Array.from({ length: 3 }, () => [7, { action: 'readBlobParent' }, { frameId: 5, documentId: 'blob-doc' }]));
  }
});

test('Chrome119 端点缺失、错误、SOP 或无效父证据时三个 content 动作均拒绝且零副作用', async () => {
  const blobUrl = 'blob:https://creator.example/chrome119';
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  const valid = { url: blobUrl, parentUrl: 'https://nearest.example/' };
  const failures = [
    { label: '缺少端点', install: false, response: undefined },
    { label: '端点没有响应', install: true, response: undefined },
    { label: '端点连接失败', install: true, response: new Error('Receiving end does not exist') },
    { label: '端点 SOP 拒绝', install: true, response: new DOMException('Blocked cross-origin Location', 'SecurityError') },
    { label: '仅有自报字段', install: true, response: { referrer: top.url, effectiveUrl: top.url } },
    ...['https://creator.example/navigated', 'data:text/html,child', 'about:blank'].map((url) => ({ label: url, install: true, response: { ...valid, url } })),
    ...[null, 'blob:https://creator.example/parent', 'data:text/html,parent', 'file:///tmp/parent.html', 'invalid']
      .map((parentUrl) => ({ label: String(parentUrl), install: true, response: { ...valid, parentUrl } }))
  ];
  for (const sender of [
    contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl }),
    contentSender({ frameId: 6, documentId: 'data-doc', url: data.url })
  ]) {
    const cases = sender.url === blobUrl
      ? [...failures, { label: 'blob URL 已变化', install: true, response: { ...valid, url: 'blob:https://creator.example/changed' } }]
      : failures;
    for (const failure of cases) {
      const opened = installChrome();
      installFrames([top, data]);
      const probes = installBlobProbe(new Error('Chrome119 cannot access blob contents'));
      const queries = failure.install ? installBlobEndpoint(failure.response) : [];
      const { services, calls } = createServices();
      const router = createBackgroundMessageRouter(services);
      for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
        await assert.rejects(() => router.respond({
          action, url: top.url, parentUrl: top.url, referrer: top.url, effectiveUrl: top.url,
          tabId: 7, frameId: 0, documentId: 'top', layers: ['canvas'], reason: 'forged'
        }, sender), failure.label);
      }
      assert.equal(probes.length, 3, failure.label);
      assert.equal(queries.length, failure.install ? 3 : 0, failure.label);
      assert.deepEqual(calls, [], failure.label);
      assert.deepEqual(opened, [], failure.label);
    }
  }
});

test('Chrome119 回退不会挽救成功但无效的 executeScript 结果，router 三动作仍零副作用', async () => {
  const blobUrl = 'blob:https://creator.example/chrome119';
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const valid = { frameId: 5, documentId: 'blob-doc', result: { url: blobUrl, parentUrl: 'https://nearest.example/' } };
  for (const results of [
    [], [{ ...valid, frameId: 9 }], [{ ...valid, documentId: 'new-doc' }],
    [{ ...valid, result: { ...valid.result, url: 'blob:https://creator.example/changed' } }]
  ]) {
    installChrome();
    installFrames([top]);
    const probes = installBlobProbe(results);
    const queries = installBlobEndpoint(valid.result);
    const { services, calls } = createServices();
    const router = createBackgroundMessageRouter(services);
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, url: top.url, parentUrl: top.url }, contentSender({ frameId: 5, documentId: 'blob-doc', url: blobUrl })));
    }
    assert.equal(probes.length, 3);
    assert.deepEqual(queries, []);
    assert.deepEqual(calls, []);
  }
});

test('readBlobParent 不新增背景权限，未认证或自报身份调用方不能触发 Chrome119 父查询', async () => {
  const opened = installChrome();
  installFrames([{ frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' }]);
  const probes = installBlobProbe(new Error('Chrome119 cannot access blob contents'));
  const queries = installBlobEndpoint({ url: 'blob:https://creator.example/id', parentUrl: 'https://nearest.example/' });
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const sender of [
    contentSender({ url: 'blob:https://creator.example/id', id: 'another-extension' }),
    contentSender({ url: 'blob:https://creator.example/id', documentId: undefined }),
    contentSender({ url: 'blob:https://creator.example/id', frameId: undefined }),
    contentSender({ url: 'blob:https://creator.example/id', tab: undefined })
  ]) {
    await assert.rejects(() => router.respond({ action: 'getPayloadForUrl', tabId: 7, frameId: 5, documentId: 'blob-doc', parentUrl: 'https://nearest.example/' }, sender));
  }
  for (const sender of [contentSender({ url: 'blob:https://creator.example/id' }), uiSender()]) {
    await assert.rejects(() => router.respond({ action: 'readBlobParent', parentUrl: 'https://nearest.example/' }, sender));
  }
  assert.deepEqual(probes, []);
  assert.deepEqual(queries, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(opened, []);
});

test('Chrome119 已证实 data 父边可在快照缺失后恢复，但每次重读 blob 且端点失败零副作用', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  const blobUrl = 'blob:https://creator.example/chrome119';
  installFrames([top, data]);
  installBlobProbe(new Error('Chrome119 cannot access blob contents'));
  let response: any = { url: blobUrl, parentUrl: 'https://nearest.example/before' };
  const queries = installBlobEndpoint(() => {
    if (response instanceof Error) throw response;
    return response;
  });
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data-doc', url: data.url });
  assert.equal((await router.respond({ action: 'getPayloadForUrl' }, sender)).effectiveUrl, response.parentUrl);

  calls.length = 0;
  installFrames([top]);
  response = { url: blobUrl, parentUrl: 'https://nearest.example/restored' };
  assert.equal((await router.respond({ action: 'getPayloadForUrl', parentUrl: top.url }, sender)).effectiveUrl, response.parentUrl);
  assert.deepEqual(calls, [
    { name: 'noteDocumentInjected', args: ['data-doc'] },
    { name: 'getPayloadForUrl', args: ['https://nearest.example/restored'] }
  ]);
  calls.length = 0;
  response = new Error('restored endpoint closed');
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action, parentUrl: 'https://nearest.example/restored' }, sender), /restored endpoint closed/);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(queries, Array.from({ length: 5 }, () => [7, { action: 'readBlobParent' }, { frameId: 5, documentId: 'blob-doc' }]));

  response = { url: blobUrl, parentUrl: 'https://nearest.example/restarted' };
  const restarted = createServices();
  assert.equal((await createBackgroundMessageRouter(restarted.services).respond({ action: 'getPayloadForUrl' }, sender)).effectiveUrl, response.parentUrl);
  assert.deepEqual(restarted.calls, [
    { name: 'noteDocumentInjected', args: ['data-doc'] },
    { name: 'getPayloadForUrl', args: ['https://nearest.example/restarted'] }
  ]);
  assert.equal(queries.length, 6, '重启后从目标文档 receipt 恢复 data 父边也必须重读 blob');

  await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null)));
  const beforeCold = queries.length;
  const cold = createServices();
  await assert.rejects(() => createBackgroundMessageRouter(cold.services).respond({ action: 'getPayloadForUrl', parentUrl: top.url }, sender));
  assert.equal(queries.length, beforeCold, '冷实例无 data 父边，不能靠成功过的 blob 身份猜父关系');
  assert.deepEqual(cold.calls, []);
});

test('Chrome119 端点失败不缓存未经证明的 data 父边或 blob 发现身份', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 5, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  installFrames([top, data]);
  installBlobProbe(new Error('Chrome119 cannot access blob contents'));
  installBlobEndpoint({ url: 'blob:https://creator.example/id', parentUrl: null });
  const resolver = createFrameRuleResolver();
  const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data-doc', url: data.url });
  await assert.rejects(() => router.respond({ action: 'getPayloadForUrl', parentUrl: top.url }, sender));
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);

  installFrames([top]);
  const queries = installBlobEndpoint({ url: 'blob:https://creator.example/id', parentUrl: 'https://nearest.example/' });
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action, referrer: top.url }, sender));
  }
  assert.deepEqual(queries, []);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(calls, []);
});

test('新 services 从文档私有 receipt 恢复 root 与嵌套 data 后，三种 content 动作仍只采用浏览器父规则', async () => {
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/rule' };
  const root = { frameId: 2, documentId: 'root-data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,private-root' };
  const blank = { frameId: 4, documentId: 'blank', parentFrameId: 2, parentDocumentId: 'root-data', url: 'about:blank' };
  const nested = { frameId: 6, documentId: 'nested-data', parentFrameId: 4, parentDocumentId: 'blank', url: 'data:text/html,private-nested' };
  for (const frame of [root, nested]) {
    installChrome();
    installFrames([top, root, blank, nested]);
    const sender = contentSender({ frameId: frame.frameId, documentId: frame.documentId, url: frame.url });
    const original = createServices();
    const originalResponse = await createBackgroundMessageRouter(original.services).respond({ action: 'getPayloadForUrl' }, sender);
    assert.deepEqual(frameEndpoint.documents.get(frameIdentity(7, frame.frameId, frame.documentId)), originalResponse.frameEvidence);

    installFrames([top]);
    const probes = installBlobProbe([]);
    const restarted = createServices();
    const router = createBackgroundMessageRouter(restarted.services);
    const forged = { url: 'https://forged.example/', parentUrl: 'https://forged.example/', effectiveUrl: 'https://forged.example/', payload: { secret: true } };
    assert.equal((await router.respond({ action: 'getPayloadForUrl', ...forged }, sender)).effectiveUrl, top.url);
    await router.respond({ action: 'reportFontLayers', ...forged, layers: ['canvas'] }, sender);
    await router.respond({ action: 'reportWorkerFallback', ...forged, reason: 'worker-failed' }, sender);
    assert.deepEqual(restarted.calls, [
      { name: 'noteDocumentInjected', args: [frame.documentId] },
      { name: 'getPayloadForUrl', args: [top.url] },
      { name: 'reportFontLayers', args: [top.url, ['canvas']] },
      { name: 'reportWorkerFallback', args: [top.url, { reason: 'worker-failed', script: undefined, message: undefined }] }
    ]);
    const stored = JSON.stringify(await chrome.storage.session.get(null));
    for (const forbidden of ['private-root', 'private-nested', 'forged.example', 'payload', 'effectiveUrl', 'parentUrl']) {
      assert.equal(stored.includes(forbidden), false, forbidden);
    }
    assert.deepEqual(Object.keys(await chrome.storage.session.get(null)), [FRAME_RECEIPT_KEY], '后台只保存会话密钥');
    const restoredReceipt = frameEndpoint.documents.get(frameIdentity(7, frame.frameId, frame.documentId)) as FrameReceipt;
    for (const privateContent of ['private-root', 'private-nested']) assert.equal(restoredReceipt.body.includes(privateContent), false);
    assert.deepEqual(Object.keys(restoredReceipt).sort(), ['body', 'mac']);
    assert.deepEqual(JSON.parse(restoredReceipt.body).frames,
      frame === root ? [{ ...root, url: 'data:' }, top] : [{ ...nested, url: 'data:' }, blank, { ...root, url: 'data:' }, top]);
    assert.deepEqual(probes, [], '完整浏览器父边可恢复 data，不猜测缺失 blob');
  }
});

test('文档 receipt 损坏、身份不符或协议未知时，三个 content 动作拒绝且零业务副作用', async () => {
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
  const body = { purpose: 'vanishgeo/frame-evidence/v1', tabId: 7, frameId: 6, documentId: 'data', frames: [data, top] };
  const sign = (value: unknown) => signReceiptBody(JSON.stringify(value));
  const invalid = [
    null, [], 'data:', {},
    signReceiptBody('{'), { ...sign(body), mac: '00'.repeat(32) },
    ...[{ tabId: 8 }, { frameId: 9 }, { documentId: 'other' }, { purpose: 'another-purpose' }].map(identity => sign({ ...body, ...identity })),
    ...[
      { ...data, frameId: 9 }, { ...data, documentId: 'other' },
      { ...data, parentDocumentId: undefined }, { ...data, parentFrameId: -2 },
      ...['invalid', 'file:///tmp/child', 'chrome://settings/', 'about:config', 'javascript:alert(1)'].map(url => ({ ...data, url }))
    ].map(frame => sign({ ...body, frames: [frame, top] }))
  ];
  for (const value of invalid) {
    const session = createSessionStorage({ [FRAME_RECEIPT_KEY]: RECEIPT_KEY_BYTES });
    const before = await session.get(null);
    const opened = installChrome(undefined, session);
    frameEndpoint.documents.set(frameIdentity(7, 6, 'data'), value);
    installFrames([top]);
    const probes = installBlobProbe([]);
    const resolver = createFrameRuleResolver();
    const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
    const router = createBackgroundMessageRouter(services);
    const sender = contentSender({ frameId: 6, documentId: 'data', url: 'data:text/html,child' });
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, parentUrl: top.url, url: top.url, layers: ['canvas'], reason: 'forged' }, sender), JSON.stringify(value));
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(opened, []);
    assert.deepEqual(probes, []);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.deepEqual(await session.get(null), before);
  }
});

test('session 密钥 read、set 或 quota 失败使三个 content 动作明确失败，不能发布内存父边或执行业务', async () => {
  for (const mode of ['read', 'set', 'quota']) {
    const session = createSessionStorage();
    const originalGet = session.get;
    const originalSet = session.set;
    const failure = new Error(mode === 'quota' ? 'QUOTA_BYTES quota exceeded' : `session ${mode} failed`);
    if (mode === 'read') session.get = async () => { throw failure; };
    else session.set = async () => { throw failure; };
    const opened = installChrome(undefined, session);
    const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
    const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
    installFrames([top, data]);
    const probes = installBlobProbe([]);
    const resolver = createFrameRuleResolver();
    const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
    const router = createBackgroundMessageRouter(services);
    const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, url: top.url, parentUrl: top.url }, sender), error => error === failure);
    }
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.equal(frameEndpoint.messages.some(([, message]) => message.action === 'storeFrameEvidence'), false);
    session.get = originalGet;
    session.set = originalSet;
    assert.deepEqual(await session.get(null), {});
    installFrames([top]);
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, parentUrl: top.url }, sender), /absent from browser frame snapshot/);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(opened, []);
    assert.deepEqual(probes, []);
  }
});

test('新 services 也拒绝文档 receipt 父边与当前导航父文档冲突，三个 content 动作零业务副作用', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  installFrames([top, data]);
  const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
  await createBackgroundMessageRouter(createServices().services).respond({ action: 'getPayloadForUrl' }, sender);
  const before = await chrome.storage.session.get(null);
  installFrames([
    top,
    { frameId: 9, documentId: 'new-parent', parentFrameId: 0, parentDocumentId: 'top', url: 'https://new-parent.example/' },
    { ...data, parentFrameId: 9, parentDocumentId: 'new-parent' }
  ]);
  const probes = installBlobProbe([]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action, parentUrl: top.url }, sender), /relationship changed/);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(probes, []);
  assert.deepEqual(await chrome.storage.session.get(null), before);
});

test('关 tab 时尚未完成的 session 密钥提交不能发布 receipt、记账或投递 payload', async () => {
  const session = createSessionStorage();
  const originalSet = session.set;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  const pendingWrite = new Promise<void>(done => { release = done; });
  session.set = async items => { entered(); await pendingWrite; await originalSet(items); };
  installChrome(undefined, session);
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  installFrames([top, data]);
  const resolver = createFrameRuleResolver();
  const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
  const request = router.respond({ action: 'getPayloadForUrl' }, sender);
  const rejected = assert.rejects(request, /tab has closed/);
  await started;
  assert.deepEqual(calls, []);
  const closing = resolver.forgetTab(7);
  release();
  await Promise.all([rejected, closing]);
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action, parentUrl: top.url }, sender), /tab has closed/);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.equal(frameEndpoint.messages.some(([, message]) => message.action === 'storeFrameEvidence'), false);
  assert.deepEqual(Object.keys(await session.get(null)), [FRAME_RECEIPT_KEY], '关闭 tab 不删除其他文档共用的会话密钥');
});

test('getPayloadForUrl 必须等待目标文档确认 receipt，响应只带相同凭证而不暴露会话密钥', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/rule' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,private-content' };
  installFrames([top, data]);
  const sendMessage = chrome.tabs.sendMessage;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  const acknowledgement = new Promise<void>(done => { release = done; });
  (chrome.tabs as any).sendMessage = async (...args: any[]) => {
    if (args[1].action === 'storeFrameEvidence') { entered(); await acknowledgement; }
    return (sendMessage as any)(...args);
  };
  const resolver = createFrameRuleResolver();
  const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
  const pending = createBackgroundMessageRouter(services).respond({ action: 'getPayloadForUrl' }, contentSender({ frameId: 6, documentId: 'data', url: data.url }));
  await started;
  assert.deepEqual(calls, [], 'ACK 之前不得记账或读取业务 payload');
  assert.deepEqual(resolver.knownDocuments(7, 'top'), [], 'ACK 之前不得发布发现身份');
  assert.equal(frameEndpoint.documents.size, 0);
  release();
  const response = await pending;
  const receipt = response.frameEvidence as FrameReceipt;
  assert.equal(response.effectiveUrl, top.url);
  assert.deepEqual(frameEndpoint.messages, [
    [7, { action: 'readFrameEvidence' }, { frameId: 6, documentId: 'data' }],
    [7, { action: 'storeFrameEvidence', frameEvidence: receipt }, { frameId: 6, documentId: 'data' }]
  ]);
  assert.deepEqual(frameEndpoint.documents.get(frameIdentity(7, 6, 'data')), receipt);
  assert.deepEqual(Object.keys(receipt).sort(), ['body', 'mac']);
  assert.deepEqual(JSON.parse(receipt.body), {
    purpose: 'vanishgeo/frame-evidence/v1', tabId: 7, frameId: 6, documentId: 'data',
    frames: [{ ...data, url: 'data:' }, top]
  });
  const stored = await chrome.storage.session.get(null);
  assert.deepEqual(Object.keys(stored), [FRAME_RECEIPT_KEY]);
  assert.equal(stored[FRAME_RECEIPT_KEY].length, 32);
  assert.equal(stored[FRAME_RECEIPT_KEY].every((byte: number) => Number.isInteger(byte) && byte >= 0 && byte <= 255), true);
  for (const forbidden of [FRAME_RECEIPT_KEY, JSON.stringify(stored[FRAME_RECEIPT_KEY]), 'private-content']) {
    assert.equal(JSON.stringify(response).includes(forbidden), false, forbidden);
  }
  assert.deepEqual(calls, [
    { name: 'noteDocumentInjected', args: ['data'] },
    { name: 'getPayloadForUrl', args: [top.url] }
  ]);
});

test('请求体即使携带真实签名 receipt，也不能替代精确目标文档的私有证明', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  installFrames([top, data]);
  const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
  const issued = await createBackgroundMessageRouter(createServices().services).respond({ action: 'getPayloadForUrl' }, sender);
  assert.ok(issued.frameEvidence);
  frameEndpoint.documents.clear();
  frameEndpoint.messages.length = 0;
  installFrames([top]);
  const probes = installBlobProbe([]);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({
      action, frameEvidence: issued.frameEvidence, parentUrl: top.url, effectiveUrl: top.url, url: top.url,
      tabId: 7, frameId: 6, documentId: 'data', layers: ['canvas'], reason: 'forged'
    }, sender), /absent from browser frame snapshot/);
  }
  assert.deepEqual(frameEndpoint.messages, Array.from({ length: 3 }, () => [7, { action: 'readFrameEvidence' }, { frameId: 6, documentId: 'data' }]));
  assert.deepEqual(calls, []);
  assert.deepEqual(probes, []);
});

test('receipt 写入确认缺失、无效或拒绝时，三种 content 动作零业务副作用且不留下可恢复父边', async () => {
  const outcomes = [undefined, null, false, { stored: false }, { stored: 'true' }, new Error('receipt endpoint closed')];
  for (const outcome of outcomes) {
    const opened = installChrome();
    const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
    const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
    installFrames([top, data]);
    const probes = installBlobProbe([]);
    const sendMessage = chrome.tabs.sendMessage;
    let writes = 0;
    (chrome.tabs as any).sendMessage = async (...args: any[]) => {
      if (args[1].action !== 'storeFrameEvidence') return (sendMessage as any)(...args);
      writes++;
      assert.deepEqual([args[0], args[2]], [7, { frameId: 6, documentId: 'data' }]);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
    const resolver = createFrameRuleResolver();
    const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
    const router = createBackgroundMessageRouter(services);
    const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, parentUrl: top.url, layers: ['canvas'], reason: 'forged' }, sender),
        outcome instanceof Error ? error => error === outcome : /not stored/);
    }
    assert.equal(writes, 3);
    assert.equal(frameEndpoint.documents.size, 0);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    (chrome.tabs as any).sendMessage = sendMessage;
    installFrames([top]);
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action, parentUrl: top.url }, sender), /absent from browser frame snapshot/);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(opened, []);
    assert.deepEqual(probes, []);
    assert.deepEqual(Object.keys(await chrome.storage.session.get(null)), [FRAME_RECEIPT_KEY]);
  }
});

test('已有会话密钥损坏时不能重置密钥或签发 receipt，三个 content 动作零业务副作用', async () => {
  for (const value of [null, [], 'not-a-key', Array(31).fill(1), Array(33).fill(1), [...RECEIPT_KEY_BYTES.slice(1), -1], [...RECEIPT_KEY_BYTES.slice(1), 256], [...RECEIPT_KEY_BYTES.slice(1), 1.5], [...RECEIPT_KEY_BYTES.slice(1), '1']]) {
    const session = createSessionStorage({ [FRAME_RECEIPT_KEY]: value });
    const before = await session.get(null);
    const opened = installChrome(undefined, session);
    const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
    const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
    installFrames([top, data]);
    const resolver = createFrameRuleResolver();
    const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
    const router = createBackgroundMessageRouter(services);
    for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
      await assert.rejects(() => router.respond({ action }, contentSender({ frameId: 6, documentId: 'data', url: data.url })), /session key unavailable or invalid/);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(opened, []);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.equal(frameEndpoint.messages.some(([, message]) => message.action === 'storeFrameEvidence'), false);
    assert.deepEqual(await session.get(null), before);
  }
});

test('关 tab 时尚未返回的 receipt ACK 不能发布父边、记账或投递 payload', async () => {
  installChrome();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const data = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  installFrames([top, data]);
  const sendMessage = chrome.tabs.sendMessage;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  const pendingAck = new Promise<void>(done => { release = done; });
  (chrome.tabs as any).sendMessage = async (...args: any[]) => {
    if (args[1].action === 'storeFrameEvidence') { entered(); await pendingAck; }
    return (sendMessage as any)(...args);
  };
  const resolver = createFrameRuleResolver();
  const { services, calls } = createServices({ resolveFrameRuleUrl: resolver.resolve, resolveFrameRuleContext: resolver.resolveForContent });
  const router = createBackgroundMessageRouter(services);
  const sender = contentSender({ frameId: 6, documentId: 'data', url: data.url });
  const rejected = assert.rejects(router.respond({ action: 'getPayloadForUrl' }, sender), /tab has closed/);
  await started;
  assert.deepEqual(calls, []);
  await resolver.forgetTab(7);
  release();
  await rejected;
  for (const action of ['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']) {
    await assert.rejects(() => router.respond({ action }, sender), /tab has closed/);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(Object.keys(await chrome.storage.session.get(null)), [FRAME_RECEIPT_KEY]);
});
