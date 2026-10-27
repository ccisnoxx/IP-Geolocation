import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundMessageRouter } from '../src/background/message-router';

function createServices(overrides: Record<string, any> = {}) {
  const calls: Array<{ name: string; args: any[] }> = [];
  const record = (name: string, value?: any) => (...args: any[]) => {
    calls.push({ name, args });
    return Promise.resolve(value);
  };
  const services: any = {
    webRtcPolicies: { strict: 'disable_non_proxied_udp' },
    updateGeolocation: record('updateGeolocation', { ok: true }),
    getExtensionState: record('getExtensionState', { enabled: true }),
    setExtensionEnabled: record('setExtensionEnabled', { masterEnabled: true }),
    getSiteConfig: record('getSiteConfig', { masterEnabled: true, rules: [] }),
    saveSiteConfig: record('saveSiteConfig', { masterEnabled: true, rules: [] }),
    setWebRtcGlobalMode: record('setWebRtcGlobalMode', { masterEnabled: true }),
    getBakeSnapshot: record('getBakeSnapshot', { config: {} }),
    getPayloadForUrl: record('getPayloadForUrl', { matched: true, payload: { hostname: 'example.com' }, errors: [] }),
    noteDocumentInjected: record('noteDocumentInjected'),
    reportFontLayers: (...args: any[]) => { calls.push({ name: 'reportFontLayers', args }); },
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

function installChrome(tab: any = { id: 7, url: 'https://example.com/' }) {
  const opened: string[] = [];
  (globalThis as any).chrome = {
    tabs: { get: async (id: number) => ({ id, url: 'https://example.com/' }), query: async () => [tab] },
    runtime: { openOptionsPage: async () => { opened.push('options'); } }
  };
  return opened;
}

test('getPayloadForUrl 先记 documentId，再按请求 URL 解析', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond(
    { action: 'getPayloadForUrl', url: 'https://child.example.com/frame' },
    { documentId: 'doc-9', url: 'https://child.example.com/frame' } as any
  );

  assert.equal(response.status, 'ok');
  assert.equal(response.payload.hostname, 'example.com');
  assert.deepEqual(calls.map((call) => call.name).slice(0, 2), ['noteDocumentInjected', 'getPayloadForUrl']);
  assert.deepEqual(calls[0].args, ['doc-9']);
  assert.deepEqual(calls[1].args, ['https://child.example.com/frame']);
});

test('reportFontLayers 优先用请求 URL，缺失时回退 sender.url', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'reportFontLayers', layers: ['canvas'] }, { url: 'https://sender.example/' } as any);
  await router.respond({ action: 'reportFontLayers', url: 'https://request.example/', layers: ['platform'] }, { url: 'https://sender.example/' } as any);

  const reports = calls.filter((call) => call.name === 'reportFontLayers');
  assert.deepEqual(reports[0].args, ['https://sender.example/', ['canvas']]);
  assert.deepEqual(reports[1].args, ['https://request.example/', ['platform']]);
});

test('setSiteConfig 把空对象交给保存层，applyProfile 先读再写', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'setSiteConfig' }, {} as any);
  assert.deepEqual(calls.find((call) => call.name === 'saveSiteConfig')?.args, [{}]);

  const before = calls.length;
  await router.respond({ action: 'applyProfile', profileId: 'p1' }, {} as any);
  const names = calls.slice(before).map((call) => call.name);
  assert.deepEqual(names, ['getSiteConfig', 'saveSiteConfig']);
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

  const response = await router.respond({ action: 'getWebRtcConfig' }, {} as any);
  assert.equal(response.status, 'ok');
  assert.equal(response.state.effectivePolicy, 'disable_non_proxied_udp');
});

test('getCurrentTabState 传 tabId 时按该标签页算，否则取当前活动标签页', async () => {
  const active = { id: 3, url: 'https://active.example/' };
  installChrome(active);
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);

  await router.respond({ action: 'getCurrentTabState', tabId: 9 }, {} as any);
  await router.respond({ action: 'getCurrentTabState' }, {} as any);

  const states = calls.filter((call) => call.name === 'getCurrentTabState');
  assert.deepEqual(states[0].args[0], { id: 9, url: 'https://example.com/' });
  assert.deepEqual(states[1].args[0], active);
});

test('openOptions 调 chrome.runtime.openOptionsPage', async () => {
  const opened = installChrome();
  const { services } = createServices();
  const router = createBackgroundMessageRouter(services);

  const response = await router.respond({ action: 'openOptions' }, {} as any);
  assert.equal(response.status, 'ok');
  assert.deepEqual(opened, ['options']);
});

test('未知 action 抛错，由 service worker 统一转成 error response', async () => {
  installChrome();
  const { services } = createServices();
  const router = createBackgroundMessageRouter(services);

  await assert.rejects(() => router.respond({ action: 'nope' }, {} as any), /unknown action/);
  await assert.rejects(() => router.respond(undefined, {} as any), /unknown action/);
});


test('已知 action 都能路由到对应 service（表驱动，防止新增 action 漏接）', async () => {
  installChrome();
  const { services, calls } = createServices();
  const router = createBackgroundMessageRouter(services);
  const requests: Array<Record<string, unknown>> = [
    { action: 'manualUpdate' },
    { action: 'getExtensionState' },
    { action: 'setExtensionEnabled', enabled: true },
    { action: 'getSiteConfig' },
    { action: 'setSiteConfig', config: { masterEnabled: true } },
    { action: 'resetSiteConfig' },
    { action: 'setWebRtcGlobalMode', mode: 'strict' },
    { action: 'getWebRtcConfig' },
    { action: 'getPayloadForUrl', url: 'https://example.com/' },
    { action: 'reportFontLayers', url: 'https://example.com/', layers: ['platform'] },
    { action: 'getFontLayers', url: 'https://example.com/' },
    { action: 'getBakeSnapshot' },
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

  for (const request of requests) {
    const response = await router.respond(request, {} as any);
    assert.equal(response.status, 'ok', String(request.action));
  }
  assert.ok(calls.some((call) => call.name === 'reloadAffectedTabs'));
  assert.ok(calls.some((call) => call.name === 'openDiagnosticPage'));
});
