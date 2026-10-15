// 验证后台对出口检测可信边界、配置事务、标签页刷新和文档级注入的统一所有权。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import { createBackgroundServices, fetchGeoApiLocation, parseGeoApiResponse } from '../src/background/services';
import { createBackgroundMessageRouter } from '../src/background/message-router';
import {
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY,
  clone,
  normalizeGeolocation,
  normalizeTimezone,
  normalizeConfig,
  createInitialConfig
} from '../src/shared/config-model';
import type { ExitLocationProfile, Profile, SiteSpoofConfig } from '../src/shared/types';

const VERIFIED_AT = 1_752_551_200_000;

function verifiedProfile(overrides: Partial<ExitLocationProfile> = {}): ExitLocationProfile {
  return {
    id: 'exit-home',
    name: '家宽出口',
    verification: 'verified',
    publicIp: '203.0.113.10',
    latitude: 35.68,
    longitude: 139.76,
    country: 'Japan',
    timezone: 'Asia/Tokyo',
    provider: 'https://ipwho.is/',
    verifiedAt: VERIFIED_AT,
    ...overrides
  };
}

function createSingleRuleConfig(
  domain = 'example.com',
  options: { automatic?: boolean; profile?: ExitLocationProfile } = {}
): SiteSpoofConfig {
  const automatic = options.automatic !== false;
  const profile = options.profile || verifiedProfile();
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      geolocation: normalizeGeolocation(automatic
        ? { enabled: true, mode: 'auto' }
        : {
            enabled: true,
            mode: 'manual',
            latitude: 35.68,
            longitude: 139.76,
            accuracy: 50,
            country: 'Japan'
          }),
      timezone: normalizeTimezone(automatic
        ? { enabled: true, mode: 'auto' }
        : { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' }),
      language: {
        enabled: true,
        mode: 'preset',
        language: 'ja-JP',
        languages: ['ja-JP', 'ja'],
        acceptLanguage: 'ja-JP,ja;q=0.9'
      }
    },
    webRtc: { globalMode: 'strict' },
    exitLocationProfiles: automatic ? [profile] : [],
    rules: [{
      id: `rule-${domain}`,
      domain,
      enabled: true,
      exitLocationProfileId: automatic ? profile.id : null,
      overrides: {
        language: { mode: 'inherit', value: null },
        timezone: { mode: 'inherit', value: null },
        geolocation: { mode: 'inherit', value: null }
      }
    }]
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChromeMockOptions {
  tabs?: chrome.tabs.Tab[];
  reloadDelayMs?: number;
  reloadFailures?: number[];
  sessionStorage?: Record<string, any>;
  initialScripts?: chrome.scripting.RegisteredContentScript[];
}

function installChromeMock(storage: Record<string, any>, options: ChromeMockOptions = {}) {
  const originalChrome = (globalThis as any).chrome;
  const sessionStorage: Record<string, any> = options.sessionStorage || {};
  const registeredScripts: chrome.scripting.RegisteredContentScript[][] = [];
  let actualScripts: chrome.scripting.RegisteredContentScript[] = options.initialScripts || [];
  let dynamicRules: chrome.declarativeNetRequest.Rule[] = [];
  let privacyValue = 'default';
  let privacyControl = 'controllable_by_this_extension';
  const mutations = { content: 0, dnr: 0, webrtc: 0 };
  const executeCalls: chrome.scripting.ScriptInjection<any[], any>[] = [];
  const reloadCalls: number[] = [];
  const createdTabUrls: string[] = [];
  let optionsOpened = 0;
  let activeReloads = 0;
  let maxActiveReloads = 0;
  const tabs = options.tabs || [];

  const storageArea = (target: Record<string, any>) => ({
    get: async (key?: string | string[] | null) => {
      if (key == null) return structuredClone(target);
      if (Array.isArray(key)) return structuredClone(Object.fromEntries(key.map((item) => [item, target[item]])));
      return structuredClone({ [key]: target[key] });
    },
    set: async (items: Record<string, any>) => {
      Object.assign(target, structuredClone(items));
    },
    remove: async (key: string | string[]) => {
      (Array.isArray(key) ? key : [key]).forEach((item) => delete target[item]);
    }
  });

  (globalThis as any).chrome = {
    storage: {
      local: storageArea(storage),
      session: storageArea(sessionStorage)
    },
    scripting: {
      getRegisteredContentScripts: async () => actualScripts,
      unregisterContentScripts: async () => { mutations.content += 1; actualScripts = []; },
      updateContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        mutations.content += 1; actualScripts = scripts;
      },
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        registeredScripts.push(scripts);
        mutations.content += 1; actualScripts = scripts;
      },
      executeScript: async (details: chrome.scripting.ScriptInjection<any[], any>) => {
        executeCalls.push(details);
        return [];
      }
    },
    declarativeNetRequest: {
      MAX_NUMBER_OF_REGEX_RULES: 1000,
      MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000,
      getDynamicRules: async () => dynamicRules,
      getSessionRules: async () => [],
      updateDynamicRules: async (update: chrome.declarativeNetRequest.UpdateRuleOptions) => {
        mutations.dnr += 1;
        dynamicRules = dynamicRules.filter((rule) => !update.removeRuleIds?.includes(rule.id)).concat(update.addRules || []);
      }
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          get: async () => ({
            value: privacyValue,
            levelOfControl: privacyControl
          }),
          set: async (details: { value: string }) => {
            mutations.webrtc += 1; privacyValue = details.value; privacyControl = 'controlled_by_this_extension';
          },
          clear: async () => {
            mutations.webrtc += 1; privacyValue = 'default'; privacyControl = 'controllable_by_this_extension';
          }
        }
      }
    },
    tabs: {
      query: async () => tabs,
      get: async (tabId: number) => {
        const tab = tabs.find((item) => item.id === tabId);
        if (!tab) throw new Error(`tab ${tabId} not found`);
        return tab;
      },
      reload: async (tabId: number) => {
        activeReloads += 1;
        maxActiveReloads = Math.max(maxActiveReloads, activeReloads);
        try {
          if (options.reloadDelayMs) await delay(options.reloadDelayMs);
          if (options.reloadFailures?.includes(tabId)) throw new Error('reload failed');
          reloadCalls.push(tabId);
        } finally {
          activeReloads -= 1;
        }
      },
      create: async ({ url }: { url: string }) => {
        createdTabUrls.push(url);
        return { id: createdTabUrls.length, url } as chrome.tabs.Tab;
      }
    },
    runtime: {
      id: 'vanishgeo-test',
      openOptionsPage: async () => { optionsOpened += 1; },
      getURL: (path: string) => `chrome-extension://vanishgeo-test/${path}`
    }
  };

  return {
    sessionStorage,
    mutations,
    registeredScripts,
    executeCalls,
    reloadCalls,
    createdTabUrls,
    getOptionsOpened: () => optionsOpened,
    getMaxActiveReloads: () => maxActiveReloads,
    restore: () => {
      (globalThis as any).chrome = originalChrome;
    }
  };
}

test('parseGeoApiResponse accepts complete provider responses from one detection', () => {
  const ipwho = parseGeoApiResponse({
    success: true,
    ip: '203.0.113.1',
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: { id: 'Asia/Singapore' }
  }, 'ipwho', VERIFIED_AT);
  const ipapi = parseGeoApiResponse({
    ip: '203.0.113.2',
    latitude: 35.68,
    longitude: 139.76,
    country_name: 'Japan',
    timezone: 'Asia/Tokyo'
  }, 'ipapi', VERIFIED_AT);
  const ipinfo = parseGeoApiResponse({
    ip: '203.0.113.3',
    loc: '52.52,13.405',
    country: 'DE',
    timezone: 'Europe/Berlin'
  }, 'ipinfo', VERIFIED_AT);

  assert.deepEqual(ipwho, {
    publicIp: '203.0.113.1',
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: 'Asia/Singapore',
    provider: 'ipwho',
    detectedAt: VERIFIED_AT
  });
  assert.equal(ipapi?.publicIp, '203.0.113.2');
  assert.equal(ipapi?.timezone, 'Asia/Tokyo');
  assert.equal(ipinfo?.latitude, 52.52);
  assert.equal(ipinfo?.provider, 'ipinfo');
});

test('parseGeoApiResponse rejects incomplete or internally invalid identity data', () => {
  assert.equal(parseGeoApiResponse({ latitude: 35, longitude: 139, country: 'Japan', timezone: 'Asia/Tokyo' }), null);
  assert.equal(parseGeoApiResponse({ ip: '203.0.113.1', latitude: 95, longitude: 139, country: 'Japan', timezone: 'Asia/Tokyo' }), null);
  assert.equal(parseGeoApiResponse({ ip: '203.0.113.1', latitude: 35, longitude: 139, country: 'Japan', timezone: 'Mars/Base' }), null);
  assert.equal(parseGeoApiResponse({ success: false, ip: '203.0.113.1', latitude: 35, longitude: 139, country: 'Japan', timezone: 'Asia/Tokyo' }), null);
});

test('fetchGeoApiLocation aborts a slow provider with an explicit timeout error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  })) as any;
  try {
    await assert.rejects(fetchGeoApiLocation('https://slow.example.test/json', 1), /请求在 1ms 后超时/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('active detection falls back sequentially and writes a verified profile only after confirmation', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('ipwho.is')) return { ok: false, status: 503, json: async () => ({}) } as Response;
    return {
      ok: true,
      json: async () => ({
        ip: '203.0.113.21',
        latitude: 35.68,
        longitude: 139.76,
        country_name: 'Japan',
        timezone: 'Asia/Tokyo'
      })
    } as Response;
  }) as any;

  try {
    const services = createBackgroundServices();
    const preview = await services.detectExitLocation();

    assert.deepEqual(calls, ['https://ipwho.is/', 'https://ipapi.co/json/']);
    assert.equal(preview.previous, null);
    assert.equal(preview.candidate.publicIp, '203.0.113.21');
    assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles.length, 0);
    assert.ok(mock.sessionStorage.pendingExitLocationDetection);

    const confirmed = (await services.confirmExitLocationDetection(preview.detectionId, '东京出口')).config;
    assert.equal(confirmed.exitLocationProfiles.length, 1);
    assert.equal(confirmed.exitLocationProfiles[0].name, '东京出口');
    assert.equal(confirmed.exitLocationProfiles[0].verification, 'verified');
    assert.equal(confirmed.exitLocationProfiles[0].publicIp, '203.0.113.21');
    assert.equal(mock.sessionStorage.pendingExitLocationDetection, undefined);
  } finally {
    mock.restore();
    globalThis.fetch = originalFetch;
  }
});

test('redetection previews old and new identity, then updates the same profile ID and reloads its sites', async () => {
  const config = createSingleRuleConfig();
  config.rules.push({
    ...clone(config.rules[0]),
    id: 'rule-other',
    domain: 'other.test'
  });
  const tabs = [
    { id: 1, url: 'https://example.com/page' },
    { id: 2, url: 'https://unmatched.test/page' },
    { id: 3, url: 'https://other.test/page' }
  ] as chrome.tabs.Tab[];
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage, { tabs });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      success: true,
      ip: '203.0.113.99',
      latitude: 1.3521,
      longitude: 103.8198,
      country: 'Singapore',
      timezone: { id: 'Asia/Singapore' }
    })
  })) as any;

  try {
    const services = createBackgroundServices();
    const cancelled = await services.detectExitLocation('exit-home');
    assert.equal(cancelled.previous?.publicIp, '203.0.113.10');
    assert.equal(cancelled.candidate.publicIp, '203.0.113.99');
    await services.cancelExitLocationDetection(cancelled.detectionId);
    assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles[0].publicIp, '203.0.113.10');

    const preview = await services.detectExitLocation('exit-home');
    const saved = (await services.confirmExitLocationDetection(preview.detectionId, '新加坡家宽')).config;
    assert.equal(saved.exitLocationProfiles[0].id, 'exit-home');
    assert.equal(saved.exitLocationProfiles[0].publicIp, '203.0.113.99');
    assert.equal(saved.rules[0].exitLocationProfileId, 'exit-home');
    assert.equal(saved.rules[1].exitLocationProfileId, 'exit-home');
    assert.deepEqual(mock.reloadCalls.slice().sort((a, b) => a - b), [1, 3]);
  } finally {
    mock.restore();
    globalThis.fetch = originalFetch;
  }
});

test('referenced profiles cannot be deleted until all rule bindings are cleared', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices();
    await assert.rejects(services.deleteExitLocationProfile('exit-home'), /example\.com/);

    const unbound = clone(config);
    unbound.rules[0].exitLocationProfileId = null;
    await services.saveSiteConfig(unbound);
    const saved = (await services.deleteExitLocationProfile('exit-home')).config;
    assert.equal(saved.exitLocationProfiles.length, 0);
  } finally {
    mock.restore();
  }
});

test('generic saves cannot forge verified identity, while imports downgrade profiles and clear bindings', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices();
    const forged = clone(config);
    forged.exitLocationProfiles[0].publicIp = '203.0.113.200';
    forged.exitLocationProfiles[0].latitude = 0;
    const normallySaved = (await services.saveSiteConfig(forged)).config;
    assert.equal(normallySaved.exitLocationProfiles[0].publicIp, '203.0.113.10');
    assert.equal(normallySaved.exitLocationProfiles[0].latitude, 35.68);

    const imported = (await services.importSiteConfig(forged)).config;
    assert.equal(imported.exitLocationProfiles[0].verification, 'unverified');
    assert.equal(imported.exitLocationProfiles[0].publicIp, null);
    assert.equal(imported.exitLocationProfiles[0].provider, null);
    assert.equal(imported.exitLocationProfiles[0].verifiedAt, null);
    assert.equal(imported.rules[0].exitLocationProfileId, null);
  } finally {
    mock.restore();
  }
});

test('保存和导入在原始 Profile 校验失败时拒绝，不写配置或触发运行时副作用', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  const valid: Profile = { id: 'synthetic', name: '中文方案',
    geolocation: { latitude: 0, longitude: 0, accuracy: 50 },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' },
    timezone: { timezone: 'UTC' } };
  try {
    const services = createBackgroundServices();
    const invalid: Array<[Profile[], RegExp]> = [
      [[{ ...valid, geolocation: { ...valid.geolocation, latitude: 95 } }], /latitude/],
      [[{ ...valid, timezone: { timezone: 'Mars/Base' } }], /timezone/],
      [[{ ...valid, geolocation: { ...valid.geolocation, accuracy: 0 } }], /accuracy/],
      [[{ ...valid, id: '' }], /id/],
      [[valid, { ...valid, id: ' synthetic ' }], /ID.*重复/]
    ];
    for (const [profiles, error] of invalid) {
      const candidate = { ...clone(config), profile: { activeProfileId: null, profiles } };
      await assert.rejects(services.importSiteConfig(candidate), error);
      await assert.rejects(services.saveSiteConfig(candidate), error);
      assert.deepEqual(storage[SITE_CONFIG_KEY], config);
      assert.deepEqual(mock.sessionStorage, {});
      assert.deepEqual(mock.mutations, { content: 0, dnr: 0, webrtc: 0 });
    }
    const imported = (await services.importSiteConfig({ ...config, profile: { activeProfileId: valid.id, profiles: [valid] } })).config;
    assert.equal(imported.profile.profiles[0].geolocation.latitude, 0);
    assert.equal(imported.exitLocationProfiles[0].verification, 'unverified');
    assert.equal(imported.rules[0].exitLocationProfileId, null);
  } finally { mock.restore(); }
});

test('旧存储未初始化时非法 Profile 保存或导入不触发迁移写入及旧键清理', async () => {
  const storage: Record<string, any> = { bpg_config: {
    domainList: ['example.test'], geolocation: { latitude: 0, longitude: 0, accuracy: 50 }
  } };
  const original = structuredClone(storage);
  const mock = installChromeMock(storage);
  let writes = 0;
  let removes = 0;
  chrome.storage.local.set = (async () => { writes += 1; }) as any;
  chrome.storage.local.remove = (async () => { removes += 1; }) as any;
  const profile: Profile = { id: 'invalid', name: '非法方案',
    geolocation: { latitude: 95, longitude: 0, accuracy: 50 },
    language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' }, timezone: { timezone: 'UTC' } };
  try {
    const services = createBackgroundServices();
    const candidate = { profile: { activeProfileId: null, profiles: [profile] } };
    await assert.rejects(services.importSiteConfig(candidate), /latitude/);
    await assert.rejects(services.saveSiteConfig(candidate), /latitude/);
    assert.equal(writes, 0);
    assert.equal(removes, 0);
    assert.deepEqual(storage, original);
    assert.deepEqual(mock.sessionStorage, {});
    assert.deepEqual(mock.mutations, { content: 0, dnr: 0, webrtc: 0 });
  } finally { mock.restore(); }
});

test('only tabs whose effective runtime payload changed are reloaded', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  config.rules.push({
    ...clone(config.rules[0]),
    id: 'rule-other',
    domain: 'other.test'
  });
  const tabs = [
    { id: 1, url: 'https://example.com/page' },
    { id: 2, url: 'https://other.test/page' },
    { id: 3, url: 'chrome://extensions/' }
  ] as chrome.tabs.Tab[];
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage, { tabs });
  try {
    const services = createBackgroundServices();
    const changed = clone(config);
    changed.rules[0].overrides.language = {
      mode: 'override',
      value: {
        enabled: true,
        mode: 'preset',
        language: 'fr-FR',
        languages: ['fr-FR', 'fr'],
        acceptLanguage: 'fr-FR,fr;q=0.9'
      }
    };
    await services.saveSiteConfig(changed);
    assert.deepEqual(mock.reloadCalls, [1]);

    mock.reloadCalls.length = 0;
    await services.saveSiteConfig(changed);
    assert.deepEqual(mock.reloadCalls, []);

    const metadataOnly = clone(changed);
    metadataOnly.globalProfile.geolocation.country = 'Metadata only';
    metadataOnly.globalProfile.geolocation.history = [{
      latitude: 35.68,
      longitude: 139.76,
      accuracy: 50,
      createdAt: Date.now()
    }];
    await services.saveSiteConfig(metadataOnly);
    assert.deepEqual(mock.reloadCalls, []);

    const compatible = clone(metadataOnly);
    compatible.intlMode = 'compatible';
    await services.saveSiteConfig(compatible);
    assert.deepEqual(mock.reloadCalls.sort(), [1, 2]);
    mock.reloadCalls.length = 0;
    await services.saveSiteConfig(compatible);
    assert.deepEqual(mock.reloadCalls, []);

    await services.setExtensionEnabled(false);
    assert.deepEqual(mock.reloadCalls.sort(), [1, 2]);
  } finally {
    mock.restore();
  }
});

test('changed-tab reloads are failure-isolated and limited to four concurrent operations', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    url: `https://app${index}.example.com/page`
  })) as chrome.tabs.Tab[];
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage, { tabs, reloadDelayMs: 2, reloadFailures: [2] });
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const services = createBackgroundServices();
    await services.setExtensionEnabled(false);
    assert.equal(mock.reloadCalls.length, 6);
    assert.ok(mock.getMaxActiveReloads() <= 4);
  } finally {
    console.warn = originalWarn;
    mock.restore();
  }
});

test('安全暂停在配置读取和任何 runtime 派发前拒绝，重启/保存/同签名重试不能绕过', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true });
  try {
    let services = createBackgroundServices();
    for (const operation of ['initial', 'startup', 'save', 'same-signature'] as const) {
      if (operation === 'startup') { services = createBackgroundServices(); await services.initializeExtension(); }
      if (operation === 'save') await services.saveSiteConfig(config);
      if (operation === 'same-signature') await services.reconcileRuntime();
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = async () => { throw new Error('不得解析或传送配置'); };
      try {
        for (const url of ['https://example.com/same', 'https://other.test/replacement', 'about:blank']) {
          await assert.rejects(services.initializeRuntimeForSender({ id: chrome.runtime.id,
            tab: { id: 7, url } as chrome.tabs.Tab, documentId: 'old-document', url }),
          (error: any) => error.code === 'runtime-injection-paused' && /页面伪装已暂停/.test(error.message));
        }
      } finally { chrome.storage.local.get = originalGet; }
      assert.equal(mock.executeCalls.length, 0);
      assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    }
  } finally { mock.restore(); }
});

test('初始化仍校验可信 sender，拒绝页面伪造与缺失文档；暂停不返回 payload', async () => {
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: createSingleRuleConfig(), [RULES_INITIALIZED_KEY]: true });
  try {
    const services = createBackgroundServices();
    const router = createBackgroundMessageRouter(services);
    const sender = { id: chrome.runtime.id, tab: { id: 7 } as chrome.tabs.Tab,
      documentId: 'old-document', url: 'https://example.com/' };
    await assert.rejects(router.respond({ action: 'initializeRuntimeForSender',
      url: 'https://attacker.test/', payload: { extensionEnabled: true }, safe: true }, sender), /页面伪装已暂停/);
    await assert.rejects(services.initializeRuntimeForSender({ ...sender, id: 'other-extension' }), /拒绝非本扩展/);
    await assert.rejects(services.initializeRuntimeForSender({ ...sender, documentId: undefined }), /缺少目标文档/);
    await assert.rejects(router.respond({ action: 'setExtensionEnabled', enabled: false }, sender), /只允许扩展管理页面/);
    assert.equal(mock.executeCalls.length, 0);
  } finally { mock.restore(); }
});

test('初始化撤销旧 ISOLATED bootstrap，保持暂停报告且不联网；重复对账不重新注册', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, {
    initialScripts: [{ id: 'vanishgeo-runtime-init', matches: ['*://example.com/*'], js: ['content/content.js'] }]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('初始化不应定位'); }) as any;
  try {
    const services = createBackgroundServices();
    const report = await services.initializeExtension();
    assert.equal(report.status, 'partial');
    assert.equal(report.components.contentScripts.status, 'partial');
    assert.equal(report.components.contentScripts.errors[0].code, 'runtime-injection-paused');
    assert.equal(report.components.dnr.status, 'ok');
    assert.equal(report.components.webrtc.status, 'ok');
    await Promise.all([services.initializeExtension(), services.reconcileRuntime()]);
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.equal(mock.mutations.content, 1);
    assert.equal(mock.registeredScripts.length, 0);
    assert.equal(mock.executeCalls.length, 0);
  } finally { mock.restore(); globalThis.fetch = originalFetch; }
});

test('空storage安装/重复初始化安全关闭，不设置strict、注册脚本、刷新或联网；只有install打开引导', async () => {
  const storage: Record<string, any> = {};
  const mock = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; throw new Error('不得自动检测'); }) as typeof fetch;
  const setting = chrome.privacy.network.webRTCIPHandlingPolicy;
  const originalSet = setting.set;
  let privacySets = 0;
  setting.set = (() => { privacySets += 1; throw new Error('不得设置WebRTC策略'); }) as typeof setting.set;
  try {
    const services = createBackgroundServices();
    await Promise.all([services.initializeExtension(), services.handleInstalled('install')]);
    assert.deepEqual(storage[SITE_CONFIG_KEY], createInitialConfig());
    assert.equal(storage[RULES_INITIALIZED_KEY], true);
    assert.equal(mock.getOptionsOpened(), 1);
    await services.handleInstalled('update');
    await createBackgroundServices().initializeExtension();
    assert.equal(mock.getOptionsOpened(), 1);
    assert.equal(requests, 0);
    assert.equal(privacySets, 0);
    assert.equal(mock.mutations.content, 0);
    assert.equal(mock.mutations.dnr, 0);
    assert.deepEqual(mock.reloadCalls, []);
  } finally { setting.set = originalSet; mock.restore(); globalThis.fetch = originalFetch; }
});

test('v2升级不覆盖开关、WebRTC、规则、环境方案或出口档案；缺标记也不重写配置', async () => {
  for (const enabled of [false, true]) for (const mode of ['default', 'strict', 'compatible'] as const) for (const empty of [false, true]) {
    const config = createSingleRuleConfig();
    config.masterEnabled = enabled;
    config.webRtc.globalMode = mode;
    if (empty) config.rules = [];
    config.profile = { activeProfileId: 'custom', profiles: [{ id: 'custom', name: '保留方案',
      geolocation: { latitude: 0, longitude: 0, accuracy: 50 }, timezone: { timezone: 'UTC' },
      language: { language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' } }] };
    const before = clone(config);
    const storage: Record<string, any> = { [SITE_CONFIG_KEY]: config };
    const mock = installChromeMock(storage);
    try {
      const services = createBackgroundServices();
      await services.handleInstalled('update');
      await services.initializeExtension();
      assert.deepEqual(storage[SITE_CONFIG_KEY], before);
      const actual = await services.getSiteConfig();
      assert.equal(actual.masterEnabled, enabled);
      assert.equal(actual.webRtc.globalMode, mode);
      assert.deepEqual(actual.rules, before.rules);
      assert.equal(actual.profile.profiles[0].id, 'custom');
      assert.deepEqual(actual.exitLocationProfiles, before.exitLocationProfiles);
      assert.equal(mock.getOptionsOpened(), 0);
    } finally { mock.restore(); }
  }
});

test('引导必须确认并选择已验证档案与合法站点；按选择启用且重复提交保留ID、无重复刷新', async () => {
  const storage: Record<string, any> = {};
  const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/' }] as chrome.tabs.Tab[] });
  try {
    const services = createBackgroundServices();
    const router = createBackgroundMessageRouter(services);
    const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html') };
    const request = { action: 'completeOnboarding', domains: 'example.com', profileId: 'exit-home', webRtcMode: 'default', confirmed: true };
    await assert.rejects(router.respond(request, { id: chrome.runtime.id, url: 'https://example.com/' }), /只允许扩展管理页面/);
    await assert.rejects(router.respond({ ...request, confirmed: false }, sender), /明确确认/);
    await assert.rejects(router.respond(request, sender), /主动检测并确认/);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    storage[SITE_CONFIG_KEY].exitLocationProfiles = [verifiedProfile({ verification: 'unverified' })];
    await assert.rejects(router.respond(request, sender), /主动检测并确认/);
    storage[SITE_CONFIG_KEY].exitLocationProfiles = [verifiedProfile()];
    for (const invalid of [{ domains: '' }, { domains: '/' }, { domains: 'bad_domain' }, { webRtcMode: 'unknown' }]) {
      await assert.rejects(router.respond({ ...request, ...invalid }, sender));
      assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    }
    const saved = await router.respond(request, sender);
    assert.equal(saved.saved, true);
    assert.equal(saved.syncReport.status, 'partial');
    assert.equal(saved.syncReport.components.contentScripts.errors[0].code, 'runtime-injection-paused');
    assert.equal(saved.config.masterEnabled, true);
    assert.equal(saved.config.webRtc.globalMode, 'default');
    assert.equal(saved.config.rules[0].exitLocationProfileId, 'exit-home');
    assert.equal((await services.getPayloadForUrl('https://example.com/')).payload?.timezone, 'Asia/Tokyo');
    const repeated = await router.respond(request, sender);
    assert.deepEqual(repeated.config, saved.config);
    assert.deepEqual(mock.reloadCalls, [1]);
    assert.equal(mock.registeredScripts.length, 0);
    const skipped = await router.respond({ action: 'skipOnboarding' }, sender);
    assert.equal(skipped.config.masterEnabled, false);
    assert.equal(skipped.config.webRtc.globalMode, 'default');
    assert.deepEqual(skipped.config.exitLocationProfiles, saved.config.exitLocationProfiles);
    assert.deepEqual(skipped.config.rules, saved.config.rules);
  } finally { mock.restore(); }
});

test('引导串行合并当前配置、保留其他规则并尊重显式WebRTC选择；同步失败返回saved/partial', async () => {
  const config = createSingleRuleConfig('other.example', { automatic: false });
  config.exitLocationProfiles = [verifiedProfile({ latitude: 0, longitude: 0, timezone: 'UTC' })];
  config.globalProfile.geolocation.history = [{ latitude: 0, longitude: 0, accuracy: 50, label: '保留历史', createdAt: 1 }];
  config.rules[0].id = 'rule-example.com';
  config.masterEnabled = false;
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices();
    const saved = await services.completeOnboarding('example.com', 'exit-home', 'compatible');
    assert.deepEqual(saved.config.rules[0], config.rules[0]);
    assert.equal(new Set(saved.config.rules.map((rule) => rule.id)).size, 2);
    assert.equal(saved.config.webRtc.globalMode, 'compatible');
    assert.equal(saved.config.globalProfile.timezone.timezone, '');
    assert.equal(saved.config.globalProfile.geolocation.latitude, null);
    assert.equal(saved.config.globalProfile.geolocation.longitude, null);
    assert.deepEqual(saved.config.globalProfile.geolocation.history, config.globalProfile.geolocation.history);
    // 真正执行两页的填充/读取，再经后台普通保存，旧手工值不能复活。
    for (const page of ['options', 'popup']) {
      const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
      const parsed = ts.createSourceFile('ui.ts', source, ts.ScriptTarget.Latest, true);
      const functions = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
        && ['populateForm', 'readForm', 'updateTimezoneOffset'].includes(node.name?.text || ''));
      const elements = Object.fromEntries([...source.matchAll(/const (\w+El) = document\.getElementById\(/g)]
        .map((match) => [match[1], { value: '', checked: false }]));
      const context = vm.createContext({ ...configModel, ...elements, currentConfig: saved.config, ruleListToText, rulesFromText,
        updateGlobalStatus() {}, updateExitLocationProfile() {}, renderProfiles() {}, renderExitLocationProfiles() {}, renderSiteRules() {}, renderOnboarding() {},
        webRtcSelectValue: () => 'default_public_interface_only' });
      vm.runInContext(ts.transpileModule(functions.map((node) => node.getText(parsed)).join('\n'),
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
      vm.runInContext('populateForm(currentConfig)', context);
      const roundtrip = await services.saveSiteConfig(vm.runInContext('readForm()', context));
      assert.equal(roundtrip.config.globalProfile.geolocation.mode, 'auto', page);
      assert.equal(roundtrip.config.globalProfile.timezone.mode, 'auto', page);
      const effective = await services.getPayloadForUrl('https://example.com/');
      assert.equal(effective.payload?.timezone, 'UTC', page);
      assert.equal(effective.payload?.latitude, 0, page);
    }
    chrome.scripting.getRegisteredContentScripts = async () => { throw new Error('合成同步失败'); };
    const partial = await services.completeOnboarding('third.example', 'exit-home', 'strict');
    assert.equal(partial.syncReport.status, 'partial');
    assert.equal(partial.syncReport.components.contentScripts.status, 'failed');
    assert.equal(storage[SITE_CONFIG_KEY].webRtc.globalMode, 'strict');
    assert.equal(storage[SITE_CONFIG_KEY].rules.length, 3);
  } finally { mock.restore(); }
});

test('reset清空配置/方案/档案/历史与候选，重置前的在途检测不能重新发布', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { sessionStorage: { pendingExitLocationDetection: { detectionId: 'old' } } });
  const originalFetch = globalThis.fetch;
  let started!: () => void;
  let release!: (response: Response) => void;
  const networkStarted = new Promise<void>((done) => { started = done; });
  globalThis.fetch = (() => { started(); return new Promise<Response>((done) => { release = done; }); }) as typeof fetch;
  try {
    const services = createBackgroundServices();
    const detection = services.detectExitLocation();
    await networkStarted;
    const reset = await services.resetSiteConfig();
    assert.deepEqual(reset.config, createInitialConfig());
    assert.equal(mock.sessionStorage.pendingExitLocationDetection, undefined);
    release({ ok: true, json: async () => ({ ip: '203.0.113.10', latitude: 0, longitude: 0, country: 'Synthetic', timezone: 'UTC' }) } as Response);
    await assert.rejects(detection, /配置已重置/);
    assert.equal(mock.sessionStorage.pendingExitLocationDetection, undefined);
    await assert.rejects(services.confirmExitLocationDetection('old', '失效候选'), /失效/);
    assert.deepEqual(storage[SITE_CONFIG_KEY], createInitialConfig());
  } finally { mock.restore(); globalThis.fetch = originalFetch; }
});

test('initializeExtension migrates flat legacy location state, removes obsolete keys, and reloads old matched tabs', async () => {
  const storage: Record<string, any> = {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US'],
      acceptLanguage: 'en-US'
    },
    timezoneConfig: { enabled: true, mode: 'auto', timezone: '' },
    webRtcConfig: { enabled: true, policy: 'disable_non_proxied_udp' },
    lastLocation: {
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: 'Asia/Tokyo'
    },
    geoProviderBackoff: { legacy: true },
    geoRefreshState: { status: 'idle' },
    lastGeoError: 'legacy error'
  };
  const mock = installChromeMock(storage, {
    tabs: [{ id: 1, url: 'https://chatgpt.com/' }] as chrome.tabs.Tab[]
  });
  try {
    const services = createBackgroundServices();
    await services.initializeExtension();

    assert.equal(storage[SITE_CONFIG_KEY].schemaVersion, 2);
    assert.deepEqual(storage[SITE_CONFIG_KEY].exitLocationProfiles.map((profile: ExitLocationProfile) => ({
      id: profile.id,
      verification: profile.verification,
      publicIp: profile.publicIp
    })), [{ id: 'legacy-last-location', verification: 'unverified', publicIp: null }]);
    assert.ok(storage[SITE_CONFIG_KEY].rules.every((rule: { exitLocationProfileId: string | null }) => rule.exitLocationProfileId === null));
    assert.deepEqual(mock.reloadCalls, [1]);
    [
      'extensionEnabled',
      'languageConfig',
      'timezoneConfig',
      'webRtcConfig',
      'lastLocation',
      'geoProviderBackoff',
      'geoRefreshState',
      'lastGeoError'
    ].forEach((key) => assert.equal(storage[key], undefined));
  } finally {
    mock.restore();
  }
});

test('诊断 URL 对所有配置只携带固定 UI 参数，不泄露预期值', async () => {
  const manual = createSingleRuleConfig('leak.962850.xyz', { automatic: false });
  manual.globalProfile.geolocation.latitude = 12.345678;
  manual.globalProfile.geolocation.longitude = 23.456789;
  const automatic = createSingleRuleConfig('leak.962850.xyz', {
    profile: verifiedProfile({ latitude: 12.345678, longitude: 23.456789 })
  });
  const unmatched = createSingleRuleConfig('unmatched.test', { automatic: false });
  const disabled = clone(manual);
  disabled.masterEnabled = false;
  const unbound = clone(automatic);
  unbound.rules[0].exitLocationProfileId = null;
  for (const config of [manual, automatic, unmatched, disabled, unbound]) {
    for (const mode of ['strict', 'compatible', 'default'] as const) {
      config.webRtc.globalMode = mode;
      const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
      const before = clone(storage);
      const mock = installChromeMock(storage);
      try {
        await createBackgroundServices().openDiagnosticTarget('hosted');
        assert.equal(mock.createdTabUrls.length, 1);
        const url = new URL(mock.createdTabUrls[0]);
        assert.equal(url.origin, 'https://leak.962850.xyz');
        assert.equal(url.pathname, '/leak-test/leak-test.html');
        assert.deepEqual([...url.searchParams], [['ui', 'zh']]);
        assert.equal([...url.searchParams.keys()].some((key) => /^expected/i.test(key)), false);
        assert.equal(url.hash, '');
        assert.equal(url.username, '');
        assert.equal(url.password, '');
        assert.deepEqual(storage, before);
      } finally {
        mock.restore();
      }
    }
  }
});

test('诊断 launcher 不读取配置或策略，创建标签失败保持显式错误', async () => {
  const mock = installChromeMock({});
  try {
    chrome.storage.local.get = async () => { throw new Error('不应读取配置'); };
    chrome.privacy.network.webRTCIPHandlingPolicy.get = async () => { throw new Error('不应读取策略'); };
    const services = createBackgroundServices();
    await Promise.all([services.openDiagnosticPage(), services.openDiagnosticPage()]);
    assert.deepEqual(mock.createdTabUrls, [
      'chrome-extension://vanishgeo-test/diagnostic/report.html',
      'chrome-extension://vanishgeo-test/diagnostic/report.html'
    ]);
    chrome.tabs.create = async () => { throw new Error('标签创建失败'); };
    await assert.rejects(services.openDiagnosticPage(), /标签创建失败/);
  } finally {
    mock.restore();
  }
});

test('localhost 目标只带固定 UI 参数且拒绝非法目标或端口', async () => {
  const mock = installChromeMock({});
  try {
    const services = createBackgroundServices();
    await services.openDiagnosticTarget('localhost', 8788);
    assert.deepEqual(mock.createdTabUrls, ['http://localhost:8788/leak-test/leak-test.html?ui=zh']);
    await assert.rejects(services.openDiagnosticTarget('localhost', 0), /端口无效/);
    await assert.rejects(services.openDiagnosticTarget('attacker' as any), /未知诊断目标/);
  } finally { mock.restore(); }
});

for (const component of ['contentScripts', 'dnr', 'webrtc'] as const) {
  test(`${component} 保存失败组件可见，worker 再初始化重试且收敛后无重复副作用`, async () => {
    const config = createSingleRuleConfig('example.com', { automatic: false });
    const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
    const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[] });
    const target: any = component === 'contentScripts' ? chrome.scripting
      : component === 'dnr' ? chrome.declarativeNetRequest : chrome.privacy.network.webRTCIPHandlingPolicy;
    const method = component === 'contentScripts' ? 'getRegisteredContentScripts' : component === 'dnr' ? 'updateDynamicRules' : 'set';
    const original = target[method];
    target[method] = async () => { throw new Error('合成 API 故障 https://private.example.test/sensitive'); };
    try {
      const next = clone(config); next.globalProfile.language.language = 'de-DE';
      const router = createBackgroundMessageRouter(createBackgroundServices());
      const response = await router.respond({ action: 'setSiteConfig', config: next }, {
        id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html')
      });
      assert.equal(response.status, 'partial');
      assert.equal(response.saved, true);
      assert.equal(response.config.globalProfile.language.language, 'de-DE');
      assert.equal(response.syncReport.components[component].status, 'failed');
      assert.ok(response.syncReport.components[component].errors.some((error: any) => error.code === 'browser-api-failed'));
      assert.equal(response.syncReport.components.tabReload.status, 'partial');
      assert.equal(storage[SITE_CONFIG_KEY].globalProfile.language.language, 'de-DE');
      assert.deepEqual(mock.reloadCalls, []);
      assert.doesNotMatch(JSON.stringify(mock.sessionStorage.runtimeSyncMetadata), /private\.example|sensitive|example\.com|35\.68|139\.76/);
      target[method] = original;
      const restarted = createBackgroundServices();
      const recovered = await restarted.initializeExtension();
      assert.equal(recovered.status, 'partial');
      assert.equal(recovered.components.contentScripts.errors[0].code, 'runtime-injection-paused');
      assert.equal(recovered.configSignature, response.syncReport.configSignature);
      assert.deepEqual(mock.reloadCalls, [1]);
      const counts = { ...mock.mutations };
      await Promise.all([restarted.initializeExtension(), restarted.reconcileRuntime()]);
      assert.deepEqual(mock.mutations, counts);
      assert.deepEqual(mock.reloadCalls, [1]);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, []);
    } finally { target[method] = original; mock.restore(); }
  });
}

test('单 tab 刷新失败返回 partial，恢复只重试失败目标且保留有界并发', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const failures = [2];
  const tabs = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, url: `https://app${index}.example.com/page` })) as chrome.tabs.Tab[];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs, reloadFailures: failures, reloadDelayMs: 1 });
  try {
    const saved = await createBackgroundServices().setExtensionEnabled(false);
    assert.equal(saved.syncReport.status, 'partial');
    assert.equal(saved.syncReport.components.tabReload.status, 'partial');
    assert.equal(saved.syncReport.components.tabReload.errors[0].code, 'tab-reload-failed');
    assert.equal(mock.reloadCalls.length, 6);
    assert.ok(mock.getMaxActiveReloads() <= 4);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [2]);
    failures.length = 0;
    assert.equal((await createBackgroundServices().initializeExtension()).status, 'ok');
    assert.deepEqual(mock.reloadCalls.slice(6), [2]);
  } finally { mock.restore(); }
});

test('欠账跨后续保存保留；导航或关闭的旧目标不被重试刷新', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs = [{ id: 1, url: 'https://example.com/old' }, { id: 2, url: 'https://example.com/old' }] as chrome.tabs.Tab[];
  const failures = [1, 2];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs, reloadFailures: failures });
  try {
    const services = createBackgroundServices();
    assert.equal((await services.setExtensionEnabled(false)).syncReport.components.tabReload.status, 'failed');
    await services.setWebRtcGlobalMode('compatible');
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.length, 2);
    tabs[0].url = 'https://unmatched.test/new'; tabs.splice(1, 1); failures.length = 0;
    assert.equal((await createBackgroundServices().initializeExtension()).status, 'ok');
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, []);
  } finally { mock.restore(); }
});

test('配置修改与初始化串行，延迟旧副作用不会覆盖后来的配置', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { initialScripts: [{ id: 'vanishgeo-runtime-init', matches: ['*://example.com/*'], js: ['content/content.js'] }] });
  const original = chrome.scripting.unregisterContentScripts;
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  let reached!: () => void;
  const started = new Promise<void>((done) => { reached = done; });
  chrome.scripting.unregisterContentScripts = (async (...args: any[]) => { reached(); await gate; await (original as any)(...args); }) as any;
  try {
    const services = createBackgroundServices();
    const first = services.initializeExtension();
    await started;
    const saved = services.setExtensionEnabled(false);
    const last = services.initializeExtension();
    release();
    assert.equal((await first).status, 'partial');
    const result = await saved;
    assert.equal(result.config.masterEnabled, false);
    assert.equal((await last).configSignature, result.syncReport.configSignature);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.deepEqual(await chrome.declarativeNetRequest.getDynamicRules(), []);
  } finally { release(); mock.restore(); }
});

test('DNR 可管理容量溢出在配置写入前拒绝，禁用/无语言规则不占容量', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  try {
    const next = clone(config);
    next.rules = Array.from({ length: 1001 }, (_, index) => ({ ...clone(config.rules[0]), id: `r-${index}`, domain: `site${index}.example.test` }));
    await assert.rejects(createBackgroundServices().saveSiteConfig(next), /可管理上限/);
    assert.deepEqual(storage[SITE_CONFIG_KEY], config);
    assert.equal(mock.sessionStorage.runtimeSyncMetadata, undefined);
    next.rules[1000].enabled = false;
    assert.equal((await createBackgroundServices().saveSiteConfig(next)).syncReport.status, 'partial');
  } finally { mock.restore(); }
});

test('session 预写失败不保存；保存后 checkpoint 失败可见且下次初始化恢复', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  const original = chrome.storage.session.set;
  try {
    chrome.storage.session.set = async () => { throw new Error('合成 session 故障'); };
    await assert.rejects(createBackgroundServices().setExtensionEnabled(false), /session/);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, true);
    let calls = 0;
    chrome.storage.session.set = (async (...args: any[]) => { if (++calls > 1) throw new Error('合成 checkpoint 故障'); await (original as any)(...args); }) as any;
    const result = await createBackgroundServices().setExtensionEnabled(false);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    assert.equal(result.syncReport.status, 'partial');
    assert.equal(result.syncReport.metadataError?.code, 'metadata-write-failed');
    chrome.storage.session.set = original;
    assert.equal((await createBackgroundServices().initializeExtension()).status, 'ok');
  } finally { mock.restore(); }
});

test('local 配置写失败恢复旧欠账，不伪造已保存结果', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  try {
    await createBackgroundServices().initializeExtension();
    const metadata = clone(mock.sessionStorage.runtimeSyncMetadata);
    chrome.storage.local.set = async () => { throw new Error('合成 local 故障'); };
    await assert.rejects(createBackgroundServices().setExtensionEnabled(false), /local/);
    assert.deepEqual(storage[SITE_CONFIG_KEY], config);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata, metadata);
  } finally { mock.restore(); }
});

test('保存后 worker 中断仍能用预写欠账恢复，不需要旧配置副本', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[] });
  try {
    const original = chrome.scripting.getRegisteredContentScripts;
    chrome.scripting.getRegisteredContentScripts = async () => { throw new Error('模拟保存后的中断'); };
    await createBackgroundServices().setExtensionEnabled(true);
    const changed = clone(config); changed.debugMode = true;
    await createBackgroundServices().saveSiteConfig(changed);
    // 预写记录已可恢复；不把局部组件结果当作 actual state。
    mock.sessionStorage.runtimeSyncMetadata.report.components.contentScripts.status = 'ok';
    chrome.scripting.getRegisteredContentScripts = original;
    const report = await createBackgroundServices().initializeExtension();
    assert.equal(report.status, 'partial');
    assert.deepEqual(mock.reloadCalls, [1]);
  } finally { mock.restore(); }
});

test('local 写入前中断仍保留旧签名的刷新欠账，local 写入后中断恢复新欠账', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const failures = [1];
  const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[], reloadFailures: failures });
  try {
    const services = createBackgroundServices();
    await services.setExtensionEnabled(false);
    const oldConfig = clone(storage[SITE_CONFIG_KEY]);
    const oldReport = clone(mock.sessionStorage.runtimeSyncMetadata.report);
    let prepared: any;
    const originalSet = chrome.storage.session.set;
    chrome.storage.session.set = (async (items: any) => {
      if (items.runtimeSyncMetadata?.previous) prepared = clone(items.runtimeSyncMetadata);
      await (originalSet as any)(items);
    }) as any;
    await services.setExtensionEnabled(true);
    assert.equal(prepared.previous.configSignature, oldReport.configSignature);
    assert.equal(prepared.previous.pendingReloads.length, 1);
    // 分别模拟 session 预写完成但 local 尚未写入，以及 local 写完但对账未开始。
    const newConfig = clone(storage[SITE_CONFIG_KEY]);
    for (const current of [oldConfig, newConfig]) {
      storage[SITE_CONFIG_KEY] = current;
      mock.sessionStorage.runtimeSyncMetadata = clone(prepared);
      failures.length = 0; mock.reloadCalls.length = 0;
      const report = await createBackgroundServices().initializeExtension();
      assert.equal(report.status, current.masterEnabled ? 'partial' : 'ok');
      assert.deepEqual(mock.reloadCalls, [1]);
      assert.equal(mock.sessionStorage.runtimeSyncMetadata.previous, undefined);
    }
  } finally { mock.restore(); }
});

test('注销失败或虚假成功均报告失败，仍拒绝派发；恢复后保持暂停且不注册', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, {
    initialScripts: [{ id: 'vanishgeo-runtime-init', matches: ['*://example.com/*'], js: ['content/content.js'] }]
  });
  try {
    const original = chrome.scripting.unregisterContentScripts;
    for (const failure of ['reject', 'no-op']) {
      chrome.scripting.unregisterContentScripts = async () => { if (failure === 'reject') throw new Error('合成注销故障'); };
      const services = createBackgroundServices();
      const report = await services.initializeExtension();
      assert.equal(report.components.contentScripts.status, 'failed');
      assert.equal(report.components.contentScripts.errors[0].code, 'runtime-injection-paused');
      assert.ok(report.components.contentScripts.errors.some((error) => error.code === (failure === 'reject' ? 'browser-api-failed' : 'verification-failed')));
      await assert.rejects(services.initializeRuntimeForSender({ id: chrome.runtime.id,
        tab: { id: 7 } as chrome.tabs.Tab, documentId: 'old-document' }), /页面伪装已暂停/);
      assert.equal(mock.executeCalls.length, 0);
    }
    chrome.scripting.unregisterContentScripts = original;
    assert.equal((await createBackgroundServices().initializeExtension()).components.contentScripts.status, 'partial');
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.equal(mock.registeredScripts.length, 0);
  } finally { mock.restore(); }
});

test('确认已保存后的候选清理失败返回 saved/partial，重试不重复创建档案并可恢复', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  const originalRemove = chrome.storage.session.remove;
  try {
    const detectionId = 'synthetic-detection-id';
    mock.sessionStorage.pendingExitLocationDetection = { detectionId, targetProfileId: null, baseVerifiedAt: null,
      expiresAt: Date.now() + 300000, candidate: { publicIp: '203.0.113.30', latitude: 1, longitude: 2,
        country: 'Synthetic', timezone: 'UTC', provider: 'https://provider.example.test/', detectedAt: Date.now() } };
    chrome.storage.session.remove = (async (key: any) => {
      if (key === 'pendingExitLocationDetection') throw new Error('合成候选清理失败');
      await (originalRemove as any)(key);
    }) as any;
    const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html') };
    const router = createBackgroundMessageRouter(createBackgroundServices());
    for (let index = 0; index < 2; index++) {
      const response = await router.respond({ action: 'confirmExitLocationDetection', detectionId, name: '合成出口' }, sender);
      assert.equal(response.saved, true); assert.equal(response.status, 'partial');
      assert.equal(response.syncReport.warnings[0].code, 'candidate-cleanup-failed');
      assert.equal(response.config.exitLocationProfiles.length, 1);
      assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles.length, 1);
    }
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingDetectionCleanup, detectionId);
    chrome.storage.session.remove = originalRemove;
    assert.equal((await createBackgroundServices().initializeExtension()).status, 'partial');
    assert.equal(mock.sessionStorage.pendingExitLocationDetection, undefined);
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingDetectionCleanup, undefined);
    assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles.length, 1);
  } finally { mock.restore(); }
});

test('候选清理失败后导入降级，同检测 ID 碰撞须拒绝且保留配置与候选', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  const originalRemove = chrome.storage.session.remove;
  try {
    const detectionId = 'synthetic-import-collision';
    mock.sessionStorage.pendingExitLocationDetection = { detectionId, targetProfileId: null, baseVerifiedAt: null,
      expiresAt: Date.now() + 300000, candidate: { publicIp: '203.0.113.31', latitude: 1, longitude: 2,
        country: 'Synthetic', timezone: 'UTC', provider: 'https://provider.example.test/', detectedAt: Date.now() } };
    chrome.storage.session.remove = (async (key: any) => {
      if (key === 'pendingExitLocationDetection') throw new Error('合成候选清理失败');
      await (originalRemove as any)(key);
    }) as any;
    const services = createBackgroundServices();
    const confirmed = await services.confirmExitLocationDetection(detectionId, '合成出口');
    const imported = await services.importSiteConfig(confirmed.config);
    assert.equal(imported.config.exitLocationProfiles[0].verification, 'unverified');
    const before = clone(storage[SITE_CONFIG_KEY]);
    const candidate = clone(mock.sessionStorage.pendingExitLocationDetection);
    chrome.storage.session.remove = originalRemove;
    await assert.rejects(services.confirmExitLocationDetection(detectionId, '再次确认'), /已发生变化.*重新检测/);
    assert.deepEqual(storage[SITE_CONFIG_KEY], before);
    assert.deepEqual(mock.sessionStorage.pendingExitLocationDetection, candidate);
  } finally { mock.restore(); }
});
