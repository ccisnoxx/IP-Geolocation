// 验证后台对出口检测可信边界、配置事务、新文档注册与人工刷新提示的统一所有权。
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
        languages: ['ja-JP', 'ja']
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

interface ChromeMockOptions {
  tabs?: chrome.tabs.Tab[];
  sessionStorage?: Record<string, any>;
  initialScripts?: chrome.scripting.RegisteredContentScript[];
}

function installChromeMock(storage: Record<string, any>, options: ChromeMockOptions = {}) {
  const originalChrome = (globalThis as any).chrome;
  const sessionStorage: Record<string, any> = options.sessionStorage || {};
  const registeredScripts: chrome.scripting.RegisteredContentScript[][] = [];
  let actualScripts: chrome.scripting.RegisteredContentScript[] = options.initialScripts || [];
  let userScripts: chrome.userScripts.RegisteredUserScript[] = [];
  let privacyValue = 'default';
  let privacyControl = 'controllable_by_this_extension';
  const mutations = { content: 0, webrtc: 0 };
  const pageMutations = { register: 0, update: 0, unregister: 0 };
  const executeCalls: chrome.scripting.ScriptInjection<any[], any>[] = [];
  const reloadCalls: number[] = [];
  const createdTabUrls: string[] = [];
  let optionsOpened = 0;
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
    permissions: { contains: async () => true },
    userScripts: {
      getScripts: async () => structuredClone(userScripts),
      unregister: async ({ ids }: { ids: string[] }) => {
        pageMutations.unregister += 1;
        userScripts = userScripts.filter(script => !ids.includes(script.id));
      },
      update: async (scripts: chrome.userScripts.RegisteredUserScript[]) => {
        pageMutations.update += 1;
        userScripts = userScripts.map(script => structuredClone(scripts.find(next => next.id === script.id) || script));
      },
      register: async (scripts: chrome.userScripts.RegisteredUserScript[]) => {
        pageMutations.register += 1;
        userScripts.push(...structuredClone(scripts));
      }
    },
    scripting: {
      getRegisteredContentScripts: async (filter?: { ids?: string[] }) => filter?.ids ? actualScripts.filter(script => filter.ids!.includes(script.id)) : actualScripts,
      unregisterContentScripts: async (filter?: { ids?: string[] }) => { mutations.content += 1; actualScripts = filter?.ids ? actualScripts.filter(script => !filter.ids!.includes(script.id)) : []; },
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
      reload: async (tabId: number) => { reloadCalls.push(tabId); },
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
    pageMutations,
    registeredScripts,
    executeCalls,
    reloadCalls,
    createdTabUrls,
    getOptionsOpened: () => optionsOpened,
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
    country_code: 'sg',
    timezone: { id: 'Asia/Singapore' }
  }, 'ipwho', VERIFIED_AT);
  const ipapi = parseGeoApiResponse({
    ip: '203.0.113.2',
    latitude: 35.68,
    longitude: 139.76,
    country_name: 'Japan',
    country_code: 'JP',
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
        country_code: 'JP',
        timezone: 'Asia/Tokyo'
      })
    } as Response;
  }) as any;

  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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

test('重新检测保留档案 ID，更新新文档时区注册并提示人工重载绑定站点', async () => {
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const cancelled = await services.detectExitLocation('exit-home');
    assert.equal(cancelled.previous?.publicIp, '203.0.113.10');
    assert.equal(cancelled.candidate.publicIp, '203.0.113.99');
    await services.cancelExitLocationDetection(cancelled.detectionId);
    assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles[0].publicIp, '203.0.113.10');

    const preview = await services.detectExitLocation('exit-home');
    const result = await services.confirmExitLocationDetection(preview.detectionId, '新加坡家宽');
    const saved = result.config;
    assert.equal(saved.exitLocationProfiles[0].id, 'exit-home');
    assert.equal(saved.exitLocationProfiles[0].publicIp, '203.0.113.99');
    assert.equal(saved.rules[0].exitLocationProfileId, 'exit-home');
    assert.equal(saved.rules[1].exitLocationProfileId, 'exit-home');
    assert.deepEqual(result.syncReport.pageRuntime, { state: 'ready', registeredRuleCount: 2, reloadRequired: true });
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [1, 2, 3]);
    const scripts = await chrome.userScripts.getScripts();
    assert.ok(scripts.filter(script => script.id.startsWith('vanishgeo-language-timezone-')).every(script => script.js?.[0].code?.includes('Asia/Singapore')));
    assert.equal(result.syncReport.geolocationRuntime?.state, 'ready');
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
    language: { language: 'en-US', languages: ['en-US'] },
    timezone: { timezone: 'UTC' } };
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
      assert.deepEqual(mock.mutations, { content: 0, webrtc: 0 });
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
    language: { language: 'en-US', languages: ['en-US'] }, timezone: { timezone: 'UTC' } };
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const candidate = { profile: { activeProfileId: null, profiles: [profile] } };
    await assert.rejects(services.importSiteConfig(candidate), /latitude/);
    await assert.rejects(services.saveSiteConfig(candidate), /latitude/);
    assert.equal(writes, 0);
    assert.equal(removes, 0);
    assert.deepEqual(storage, original);
    assert.deepEqual(mock.sessionStorage, {});
    assert.deepEqual(mock.mutations, { content: 0, webrtc: 0 });
  } finally { mock.restore(); }
});

test('非法字体或schema输入在旧存储迁移前拒绝，合法v2导入去旧字段且档案降级', async () => {
  const storage: Record<string, any> = { bpg_config: { domainList: ['example.test'] } };
  const before = structuredClone(storage);
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    for (const candidate of [null, [], { schemaVersion: 99 }, { fontExposure: { mode: 'invalid' } },
      { fontExposure: { mode: 'custom', blockedFamilies: ['MiSans', 1] } }, { canvas: { targetFonts: 'MiSans' } }]) {
      await assert.rejects(services.importSiteConfig(candidate as any));
      await assert.rejects(services.saveSiteConfig(candidate as any));
      assert.deepEqual(storage, before);
      assert.deepEqual(mock.sessionStorage, {});
      assert.deepEqual(mock.mutations, { content: 0, webrtc: 0 });
    }
    const legacy: any = { ...createSingleRuleConfig(), schemaVersion: 2,
      canvas: { enabled: true, targetFonts: [' MiSans ', 'misans', 'Custom Font'] } };
    delete legacy.fontExposure;
    legacy.globalProfile.language.acceptLanguage = 'obsolete';
    const imported = (await services.importSiteConfig(legacy)).config;
    assert.equal(imported.schemaVersion, 3);
    assert.deepEqual(imported.fontExposure, { enabled: true, mode: 'custom', blockedFamilies: ['MiSans', 'Custom Font'] });
    assert.doesNotMatch(JSON.stringify(imported), /"(?:acceptLanguage|canvas)"/);
    assert.equal(imported.exitLocationProfiles[0].verification, 'unverified');
    assert.equal(imported.rules[0].exitLocationProfileId, null);
  } finally { mock.restore(); }
});

test('语言/时区仅标记受影响页面；重复保存和位置元数据不新增目标', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  config.rules.push({ ...clone(config.rules[0]), id: 'rule-other', domain: 'other.test' });
  const tabs = [
    { id: 1, url: 'https://example.com/page' },
    { id: 2, url: 'https://other.test/page' },
    { id: 3, url: 'chrome://extensions/' }
  ] as chrome.tabs.Tab[];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    // 先建立注册，再打开页面：本例只观察后续语言修改，首次恢复缺口另有回归。
    const openedAfterRegistration = tabs.splice(0);
    await services.initializeExtension();
    tabs.push(...openedAfterRegistration);
    const changed = clone(config);
    changed.rules[0].overrides.language = { mode: 'override', value: {
      enabled: true, mode: 'preset', language: 'fr-FR', languages: ['fr-FR', 'fr']
    } };
    const first = await services.saveSiteConfig(changed);
    assert.deepEqual(first.syncReport.pageRuntime, { state: 'ready', registeredRuleCount: 2, reloadRequired: true });
    const pending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
    assert.deepEqual(pending.map((item: any) => item.tabId), [1]);
    const mutations = { ...mock.pageMutations };
    await services.saveSiteConfig(changed);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    assert.deepEqual(mock.pageMutations, mutations);

    const pausedOnly = clone(changed);
    pausedOnly.debugMode = true;
    pausedOnly.globalProfile.geolocation.country = 'Metadata only';
    pausedOnly.globalProfile.geolocation.history = [{ latitude: 0, longitude: 0, accuracy: 50, createdAt: Date.now() }];
    await services.saveSiteConfig(pausedOnly);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    assert.deepEqual(mock.pageMutations, mutations);

    const compatible = clone(pausedOnly);
    compatible.intlMode = 'compatible';
    await services.saveSiteConfig(compatible);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [1, 2]);
    const disabled = await services.setExtensionEnabled(false);
    assert.deepEqual(disabled.syncReport.pageRuntime, { state: 'disabled', registeredRuleCount: 0, reloadRequired: true });
    assert.deepEqual(await chrome.userScripts.getScripts(), []);
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
  } finally { mock.restore(); }
});

test('位置修改只更新定位注册和定位重载债，debug与WebRTC不制造额外更新', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, {
    tabs: [{ id: 1, url: 'https://example.com/' }] as chrome.tabs.Tab[]
  });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await services.initializeExtension();
    const mutations = { ...mock.pageMutations };
    const next = clone(config);
    next.globalProfile.geolocation.latitude = 0;
    next.globalProfile.geolocation.longitude = 0;
    next.globalProfile.geolocation.spoofPermission = false;
    next.debugMode = true;
    const saved = await services.saveSiteConfig(next);
    const rtc = await services.setWebRtcGlobalMode('compatible');
    for (const result of [saved, rtc]) {
      assert.equal(result.syncReport.status, 'ok');
      assert.equal(result.syncReport.pageRuntime?.reloadRequired, false);
    }
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[1, ['geolocation']]]);
    assert.equal(saved.syncReport.geolocationRuntime?.reloadRequired, true);
    assert.deepEqual(mock.pageMutations, { ...mutations, update: mutations.update + 1 });
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
  } finally { mock.restore(); }
});

test('禁用后保留所有受影响文档的人工重载提示；后台重启不会自动刷新或执行旧文档', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, url: `https://app${index}.example.com/page` })) as chrome.tabs.Tab[];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  try {
    const saved = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').setExtensionEnabled(false);
    assert.equal(saved.syncReport.status, 'ok');
    assert.deepEqual(saved.syncReport.pageRuntime, { state: 'disabled', registeredRuleCount: 0, reloadRequired: true });
    assert.deepEqual(saved.syncReport.components.tabReload, { status: 'ok', errors: [] });
    const pending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
    assert.deepEqual(pending.map((item: any) => item.tabId), tabs.map(tab => tab.id));
    const restarted = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    for (const report of [await restarted.initializeExtension(), (await restarted.reconcileRuntime()).syncReport]) {
      assert.equal(report.status, 'ok');
      assert.equal(report.pageRuntime?.reloadRequired, true);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    }
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
  } finally { mock.restore(); }
});

test('页面初始化消息路径已移除，重启/保存/同签名重试均不恢复 documentId 注入', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true });
  try {
    let services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    for (const operation of ['initial', 'startup', 'save', 'same-signature'] as const) {
      if (operation === 'startup') { services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}'); await services.initializeExtension(); }
      if (operation === 'save') await services.saveSiteConfig(config);
      if (operation === 'same-signature') await services.reconcileRuntime();
      assert.equal(Reflect.has(services, 'initializeRuntimeForSender'), false);
      const router = createBackgroundMessageRouter(services);
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = async () => { throw new Error('旧初始化消息不得读取配置'); };
      try {
        for (const url of ['https://example.com/same', 'https://other.test/replacement', 'about:blank']) {
          await assert.rejects(router.respond({ action: 'initializeRuntimeForSender', payload: { language: 'fr-FR' } }, {
            id: chrome.runtime.id, tab: { id: 7 } as chrome.tabs.Tab, documentId: 'old-document', url
          }), /只允许扩展管理页面/);
        }
        await assert.rejects(router.respond({ action: 'initializeRuntimeForSender' }, {
          id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html')
        }), /未知操作/);
      } finally { chrome.storage.local.get = originalGet; }
      assert.deepEqual(mock.executeCalls, []);
      assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    }
  } finally { mock.restore(); }
});

test('所有管理动作先校验扩展来源，页面伪造配置或旧初始化动作均不能读取和保存配置', async () => {
  const config = createSingleRuleConfig();
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  try {
    const router = createBackgroundMessageRouter(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}'));
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = async () => { throw new Error('不可信 sender 不得读取配置'); };
    for (const sender of [
      { id: chrome.runtime.id, url: 'https://example.com/', documentId: 'old-document', tab: { id: 7 } },
      { id: 'other-extension', url: chrome.runtime.getURL('options/options.html') },
      { id: chrome.runtime.id, url: undefined },
      { id: chrome.runtime.id, url: 'about:blank' }
    ]) for (const action of ['initializeRuntimeForSender', 'setSiteConfig', 'setExtensionEnabled', 'getSiteConfig']) {
      await assert.rejects(router.respond({ action, config: { masterEnabled: false }, enabled: false,
        url: chrome.runtime.getURL('options/options.html'), payload: { extensionEnabled: true } }, sender as chrome.runtime.MessageSender), /只允许扩展管理页面/);
    }
    chrome.storage.local.get = originalGet;
    assert.deepEqual(storage[SITE_CONFIG_KEY], config);
    assert.deepEqual(mock.sessionStorage, {});
    assert.deepEqual(mock.executeCalls, []);
    assert.deepEqual(mock.pageMutations, { register: 0, update: 0, unregister: 0 });
  } finally { mock.restore(); }
});

test('初始化先撤销旧 ISOLATED bootstrap，再注册新文档语言/时区；重复对账幂等且不联网', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, {
    initialScripts: [{ id: 'vanishgeo-runtime-init', matches: ['*://example.com/*'], js: ['content/content.js'] }]
  });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; throw new Error('初始化不应定位'); }) as typeof fetch;
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const report = await services.initializeExtension();
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.pageRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: false });
    for (const component of Object.values(report.components)) assert.equal(component.status, 'ok');
    const scripts = await chrome.userScripts.getScripts();
    assert.equal(scripts.length, 2);
    assert.equal(report.geolocationRuntime?.registeredRuleCount, 1);
    assert.equal(scripts[0].world, 'MAIN');
    assert.equal(scripts[0].runAt, 'document_start');
    const mutations = { ...mock.pageMutations };
    await Promise.all([services.initializeExtension(), services.reconcileRuntime()]);
    assert.deepEqual(await chrome.userScripts.getScripts(), scripts);
    assert.deepEqual(mock.pageMutations, mutations);
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.equal(mock.mutations.content, 1);
    assert.equal(mock.registeredScripts.length, 0);
    assert.deepEqual(mock.executeCalls, []);
    assert.equal(requests, 0);
  } finally { mock.restore(); globalThis.fetch = originalFetch; }
});

test('启动读取失败仍撤销所属字体注册，保留其他ID及原始错误，恢复后可再次对账', async (t) => {
  for (const source of [
    { name: '首次 local 读取', area: 'local', failAt: 1 },
    { name: '配置 local 读取', area: 'local', failAt: 2 },
    { name: 'session metadata 读取', area: 'session', failAt: 1 }
  ] as const) await t.test(source.name, async () => {
    const config = createInitialConfig();
    config.fontExposure.enabled = true;
    const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
    const before = clone(storage);
    const other = { id: 'other-owned-component', matches: ['*://example.test/*'], js: ['font-exposure/filter.js'] };
    const mock = installChromeMock(storage, { initialScripts: [
      { ...other, id: 'vanishgeo-font-exposure-example.test' }, other
    ] });
    const area = chrome.storage[source.area];
    const originalGet = area.get;
    const readError = new Error(`合成${source.name}失败`);
    let reads = 0;
    area.get = (async (...args: unknown[]) => {
      if (++reads === source.failAt) throw readError;
      return Reflect.apply(originalGet, area, args);
    }) as typeof area.get;
    try {
      const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      await assert.rejects(services.initializeExtension(), error => error === readError);
      assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), [other]);
      assert.deepEqual(mock.registeredScripts, []);
      assert.deepEqual(storage, before);
      assert.deepEqual(mock.sessionStorage, {});
      assert.deepEqual(mock.pageMutations, { register: 0, update: 0, unregister: 0 });
      assert.equal(mock.mutations.webrtc, 0);
      assert.deepEqual(mock.executeCalls, []);
      assert.deepEqual(mock.reloadCalls, []);

      area.get = originalGet;
      const restored = await services.initializeExtension();
      assert.equal(restored.fontRuntime?.state, 'disabled');
      assert.equal(restored.fontRuntime?.registeredRuleCount, 0);
      assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), [other]);
    } finally { mock.restore(); }
  });
});

test('启动读取失败且字体撤销失败时保留启动原因并明确清理未确认，不伪报成功', async () => {
  const config = createInitialConfig();
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { initialScripts: [
    { id: 'vanishgeo-font-exposure-example.test', matches: ['*://example.test/*'], js: ['font-exposure/filter.js'] }
  ] });
  const readError = new Error('合成启动读取失败');
  const originalGet = chrome.storage.local.get;
  const originalUnregister = chrome.scripting.unregisterContentScripts;
  chrome.storage.local.get = (async () => { throw readError; }) as typeof originalGet;
  chrome.scripting.unregisterContentScripts = async () => { throw new Error('合成字体撤销失败'); };
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await assert.rejects(services.initializeExtension(), error => {
      const failure = error as Error & { code?: string; cause?: unknown };
      assert.equal(failure.code, 'font-scripts-sync-failed');
      assert.equal(failure.cause, readError);
      assert.match(failure.message, /合成启动读取失败/);
      assert.match(failure.message, /字体.*清理.*未.*确认/);
      return true;
    });
    assert.equal((await chrome.scripting.getRegisteredContentScripts()).length, 1);
    assert.deepEqual(mock.registeredScripts, []);
    assert.deepEqual(mock.sessionStorage, {});
    chrome.storage.local.get = originalGet;
    chrome.scripting.unregisterContentScripts = originalUnregister;
    const restored = await services.initializeExtension();
    assert.equal(restored.fontRuntime?.state, 'disabled');
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
  } finally { mock.restore(); }
});

test('启动读取失败的字体清理完成前，不放行后续配置事务', async () => {
  const config = createSingleRuleConfig('example.test', { automatic: false });
  config.fontExposure.enabled = true;
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { initialScripts: [
    { id: 'vanishgeo-font-exposure-example.test', matches: ['*://example.test/*'], js: ['font-exposure/filter.js'] }
  ] });
  const readError = new Error('合成首次启动读取失败');
  const originalGet = chrome.storage.local.get;
  const originalUnregister = chrome.scripting.unregisterContentScripts;
  let reads = 0;
  let signalCleanup!: () => void;
  let releaseCleanup!: () => void;
  const cleanupStarted = new Promise<void>(resolve => { signalCleanup = resolve; });
  const cleanupReleased = new Promise<void>(resolve => { releaseCleanup = resolve; });
  chrome.storage.local.get = (async (...args: unknown[]) => {
    if (++reads === 1) throw readError;
    return Reflect.apply(originalGet, chrome.storage.local, args);
  }) as typeof originalGet;
  chrome.scripting.unregisterContentScripts = (async (filter?: chrome.scripting.ContentScriptFilter) => {
    signalCleanup();
    await cleanupReleased;
    await originalUnregister(filter);
  }) as typeof originalUnregister;
  let operations: Promise<unknown>[] = [];
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const failed = assert.rejects(services.initializeExtension(), error => error === readError);
    const queued = services.setExtensionEnabled(false);
    operations = [failed, queued];
    await cleanupStarted;
    assert.equal(reads, 1);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, true);
    releaseCleanup();
    await failed;
    const saved = await queued;
    assert.equal(saved.config.masterEnabled, false);
    assert.equal(saved.syncReport.fontRuntime?.state, 'disabled');
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.deepEqual(mock.registeredScripts, []);
    assert.deepEqual(mock.reloadCalls, []);
  } finally {
    releaseCleanup();
    await Promise.allSettled(operations);
    mock.restore();
  }
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await Promise.all([services.initializeExtension(), services.handleInstalled('install')]);
    assert.deepEqual(storage[SITE_CONFIG_KEY], createInitialConfig());
    assert.equal(storage[RULES_INITIALIZED_KEY], true);
    assert.equal(mock.getOptionsOpened(), 1);
    await services.handleInstalled('update');
    await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(mock.getOptionsOpened(), 1);
    assert.equal(requests, 0);
    assert.equal(privacySets, 0);
    assert.equal(mock.mutations.content, 0);
    assert.deepEqual(mock.pageMutations, { register: 0, update: 0, unregister: 0 });
    assert.deepEqual(await chrome.userScripts.getScripts(), []);
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
      language: { language: 'en-US', languages: ['en-US'] } }] };
    const before = clone(config);
    const storage: Record<string, any> = { [SITE_CONFIG_KEY]: config };
    const mock = installChromeMock(storage);
    try {
      const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
    assert.equal(saved.syncReport.status, 'ok');
    assert.deepEqual(saved.syncReport.pageRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
    assert.equal(saved.config.masterEnabled, true);
    assert.equal(saved.config.webRtc.globalMode, 'default');
    assert.equal(saved.config.rules[0].exitLocationProfileId, 'exit-home');
    assert.equal((await services.getPayloadForUrl('https://example.com/')).payload?.timezone, 'Asia/Tokyo');
    const repeated = await router.respond(request, sender);
    assert.deepEqual(repeated.config, saved.config);
    assert.deepEqual(mock.reloadCalls, []);
    assert.equal(mock.registeredScripts.length, 0);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [1]);
    assert.deepEqual(mock.pageMutations, { register: 2, update: 0, unregister: 0 });
    const skipped = await router.respond({ action: 'skipOnboarding' }, sender);
    assert.equal(skipped.config.masterEnabled, false);
    assert.equal(skipped.config.webRtc.globalMode, 'default');
    assert.deepEqual(skipped.config.exitLocationProfiles, saved.config.exitLocationProfiles);
    assert.deepEqual(skipped.config.rules, saved.config.rules);
    assert.deepEqual(skipped.syncReport.pageRuntime, { state: 'disabled', registeredRuleCount: 0, reloadRequired: true });
    assert.deepEqual(await chrome.userScripts.getScripts(), []);
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
        && ['populateForm', 'readForm', 'updateTimezoneOffset', 'updateFontExposureMode'].includes(node.name?.text || ''));
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
      assert.equal(effective.payload?.latitude, null, page);
      assert.equal(roundtrip.config.exitLocationProfiles[0].latitude, 0, page);
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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

test('初始化迁移旧位置与配置并移除旧键；匹配的既有页面仅记录人工重载提示', async () => {
  const storage: Record<string, any> = {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US']
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const report = await services.initializeExtension();

    assert.equal(storage[SITE_CONFIG_KEY].schemaVersion, 3);
    assert.deepEqual(storage[SITE_CONFIG_KEY].exitLocationProfiles.map((profile: ExitLocationProfile) => ({
      id: profile.id,
      verification: profile.verification,
      publicIp: profile.publicIp
    })), [{ id: 'legacy-last-location', verification: 'unverified', publicIp: null }]);
    assert.ok(storage[SITE_CONFIG_KEY].rules.every((rule: { exitLocationProfileId: string | null }) => rule.exitLocationProfileId === null));
    assert.deepEqual(mock.reloadCalls, []);
    assert.equal(report.pageRuntime?.reloadRequired, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [1]);
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
        await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').openDiagnosticTarget('hosted');
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await services.openDiagnosticTarget('localhost', 8788);
    assert.deepEqual(mock.createdTabUrls, ['http://localhost:8788/leak-test/leak-test.html?ui=zh']);
    await assert.rejects(services.openDiagnosticTarget('localhost', 0), /端口无效/);
    await assert.rejects(services.openDiagnosticTarget('attacker' as any), /未知诊断目标/);
  } finally { mock.restore(); }
});

for (const component of ['contentScripts', 'webrtc'] as const) {
  test(`${component} 保存失败组件可见，worker 再初始化恢复注册与人工重载提示且收敛后幂等`, async () => {
    const config = createSingleRuleConfig('example.com', { automatic: false });
    const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
    const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[] });
    const target: any = component === 'contentScripts' ? chrome.userScripts
      : chrome.privacy.network.webRTCIPHandlingPolicy;
    const method = component === 'contentScripts' ? 'register' : 'set';
    const original = target[method];
    target[method] = async () => { throw new Error('合成 API 故障 https://private.example.test/sensitive'); };
    try {
      const next = clone(config); next.globalProfile.language.language = 'de-DE';
      const router = createBackgroundMessageRouter(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}'));
      const response = await router.respond({ action: 'setSiteConfig', config: next }, {
        id: chrome.runtime.id, url: chrome.runtime.getURL('options/options.html')
      });
      assert.equal(response.status, 'partial');
      assert.equal(response.saved, true);
      assert.equal(response.config.globalProfile.language.language, 'de-DE');
      assert.equal(response.syncReport.components[component].status, 'failed');
      assert.ok(response.syncReport.components[component].errors.some((error: any) =>
        error.code === (component === 'contentScripts' ? 'userscripts-register-failed' : 'browser-api-failed')));
      assert.deepEqual(response.syncReport.components.tabReload, { status: 'ok', errors: [] });
      assert.equal(response.syncReport.pageRuntime.reloadRequired, component !== 'contentScripts');
      for (const other of ['contentScripts', 'webrtc'] as const) {
        if (other !== component) assert.equal(response.syncReport.components[other].status, 'ok');
      }
      assert.equal(storage[SITE_CONFIG_KEY].globalProfile.language.language, 'de-DE');
      assert.deepEqual(mock.reloadCalls, []);
      assert.doesNotMatch(JSON.stringify(mock.sessionStorage.runtimeSyncMetadata), /private\.example|sensitive|example\.com|35\.68|139\.76/);
      const pending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
      assert.deepEqual(pending.map((item: any) => item.tabId), [1]);
      target[method] = original;
      const restarted = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      const recovered = await restarted.initializeExtension();
      assert.equal(recovered.status, 'ok');
      assert.deepEqual(recovered.pageRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
      assert.equal(recovered.configSignature, response.syncReport.configSignature);
      const counts = { ...mock.mutations };
      const pageCounts = { ...mock.pageMutations };
      await Promise.all([restarted.initializeExtension(), restarted.reconcileRuntime()]);
      assert.deepEqual(mock.mutations, counts);
      assert.deepEqual(mock.pageMutations, pageCounts);
      assert.deepEqual(mock.reloadCalls, []);
      assert.deepEqual(mock.executeCalls, []);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    } finally { target[method] = original; mock.restore(); }
  });
}

test('重载提示目标查询失败时保留待办并显式报错；恢复后重新提示且不自动刷新', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs = [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  const original = chrome.tabs.query;
  try {
    await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').setExtensionEnabled(false);
    const pending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
    chrome.tabs.query = async () => { throw new Error('合成查询失败'); };
    const failed = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(failed.status, 'partial');
    assert.equal(failed.components.tabReload.status, 'failed');
    assert.equal(failed.components.tabReload.errors[0].code, 'tab-query-failed');
    assert.equal(failed.pageRuntime?.reloadRequired, false);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    chrome.tabs.query = original;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(recovered.status, 'ok');
    assert.equal(recovered.pageRuntime?.reloadRequired, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
  } finally { chrome.tabs.query = original; mock.restore(); }
});

test('人工重载待办跨后续保存保留；导航或关闭后仅移除对应旧目标且不刷新任何页面', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs = [
    { id: 1, url: 'https://example.com/old' },
    { id: 2, url: 'https://example.com/old' },
    { id: 3, url: 'https://example.com/retained' }
  ] as chrome.tabs.Tab[];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const disabled = await services.setExtensionEnabled(false);
    assert.equal(disabled.syncReport.pageRuntime?.reloadRequired, true);
    await services.setWebRtcGlobalMode('compatible');
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.length, 3);
    tabs[0].url = 'https://unmatched.test/new';
    tabs.splice(1, 1);
    const retained = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(retained.status, 'ok');
    assert.equal(retained.pageRuntime?.reloadRequired, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [3]);
    tabs.splice(1, 1);
    const cleared = await services.initializeExtension();
    assert.equal(cleared.pageRuntime?.reloadRequired, false);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, []);
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const first = services.initializeExtension();
    await started;
    const saved = services.setExtensionEnabled(false);
    const last = services.initializeExtension();
    release();
    assert.equal((await first).status, 'ok');
    const result = await saved;
    assert.equal(result.config.masterEnabled, false);
    assert.equal((await last).configSignature, result.syncReport.configSignature);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.deepEqual(await chrome.userScripts.getScripts(), []);
    assert.deepEqual(mock.executeCalls, []);
    assert.deepEqual(mock.reloadCalls, []);
  } finally { release(); mock.restore(); }
});


test('session 预写失败不保存；保存后 checkpoint 失败可见且下次初始化恢复', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  const original = chrome.storage.session.set;
  try {
    chrome.storage.session.set = async () => { throw new Error('合成 session 故障'); };
    await assert.rejects(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').setExtensionEnabled(false), /session/);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, true);
    let calls = 0;
    chrome.storage.session.set = (async (...args: any[]) => { if (++calls > 1) throw new Error('合成 checkpoint 故障'); await (original as any)(...args); }) as any;
    const result = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').setExtensionEnabled(false);
    assert.equal(storage[SITE_CONFIG_KEY].masterEnabled, false);
    assert.equal(result.syncReport.status, 'partial');
    assert.equal(result.syncReport.metadataError?.code, 'metadata-write-failed');
    chrome.storage.session.set = original;
    assert.equal((await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension()).status, 'ok');
  } finally { mock.restore(); }
});

test('local 配置写失败恢复旧欠账，不伪造已保存结果', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage);
  try {
    await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    const metadata = clone(mock.sessionStorage.runtimeSyncMetadata);
    chrome.storage.local.set = async () => { throw new Error('合成 local 故障'); };
    await assert.rejects(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').setExtensionEnabled(false), /local/);
    assert.deepEqual(storage[SITE_CONFIG_KEY], config);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata, metadata);
  } finally { mock.restore(); }
});

test('保存后注册失败保留人工重载待办；worker 重启读取实际注册，不信任局部成功报告', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[] });
  const original = chrome.userScripts.register;
  try {
    chrome.userScripts.register = async () => { throw new Error('模拟保存后的注册中断'); };
    const changed = clone(config); changed.globalProfile.timezone.timezone = 'UTC';
    const saved = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').saveSiteConfig(changed);
    assert.equal(saved.syncReport.pageRuntime?.state, 'sync-failed');
    assert.equal(saved.syncReport.pageRuntime?.reloadRequired, false);
    const pending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
    assert.deepEqual(pending.map((item: any) => item.tabId), [1]);
    // 中断时的局部报告不能替代实际 userScripts 读回。
    mock.sessionStorage.runtimeSyncMetadata.report.components.contentScripts.status = 'ok';
    chrome.userScripts.register = original;
    const report = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.pageRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
    assert.ok((await chrome.userScripts.getScripts())[0].js?.[0].code?.includes('UTC'));
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, pending);
    assert.deepEqual(mock.reloadCalls, []);
    assert.deepEqual(mock.executeCalls, []);
  } finally { chrome.userScripts.register = original; mock.restore(); }
});

test('local 写入前中断恢复旧签名的人工重载待办，local 写入后中断恢复新待办', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { tabs: [{ id: 1, url: 'https://example.com/page' }] as chrome.tabs.Tab[] });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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
      const report = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
      assert.equal(report.status, 'ok');
      assert.deepEqual(report.pageRuntime, { state: current.masterEnabled ? 'ready' : 'disabled',
        registeredRuleCount: current.masterEnabled ? 1 : 0, reloadRequired: true });
      assert.equal(report.configSignature, current.masterEnabled ? prepared.report.configSignature : prepared.previous.configSignature);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [1]);
      assert.equal(mock.sessionStorage.runtimeSyncMetadata.previous, undefined);
      assert.deepEqual(mock.reloadCalls, []);
      assert.deepEqual(mock.executeCalls, []);
    }
  } finally { mock.restore(); }
});

test('旧 bootstrap 注销失败或虚假成功均阻止新注册；恢复后注册语言/时区且不恢复消息注入', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, {
    initialScripts: [{ id: 'vanishgeo-runtime-init', matches: ['*://example.com/*'], js: ['content/content.js'] }]
  });
  try {
    const original = chrome.scripting.unregisterContentScripts;
    for (const failure of ['reject', 'no-op']) {
      chrome.scripting.unregisterContentScripts = async () => { if (failure === 'reject') throw new Error('合成注销故障'); };
      const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      const report = await services.initializeExtension();
      assert.equal(report.components.contentScripts.status, 'failed');
      assert.deepEqual(report.pageRuntime, { state: 'sync-failed', registeredRuleCount: null, reloadRequired: false });
      assert.ok(report.components.contentScripts.errors.some((error) => error.code === (failure === 'reject' ? 'browser-api-failed' : 'verification-failed')));
      assert.equal(report.components.webrtc.status, 'ok');
      assert.equal(Reflect.has(services, 'initializeRuntimeForSender'), false);
      assert.deepEqual(await chrome.userScripts.getScripts(), []);
      assert.deepEqual(mock.executeCalls, []);
    }
    chrome.scripting.unregisterContentScripts = original;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(recovered.status, 'ok');
    assert.deepEqual(recovered.pageRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: false });
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
    const router = createBackgroundMessageRouter(createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}'));
    for (let index = 0; index < 2; index++) {
      const response = await router.respond({ action: 'confirmExitLocationDetection', detectionId, name: '合成出口' }, sender);
      assert.equal(response.saved, true); assert.equal(response.status, 'partial');
      assert.equal(response.syncReport.warnings[0].code, 'candidate-cleanup-failed');
      assert.equal(response.config.exitLocationProfiles.length, 1);
      assert.equal(storage[SITE_CONFIG_KEY].exitLocationProfiles.length, 1);
    }
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingDetectionCleanup, detectionId);
    chrome.storage.session.remove = originalRemove;
    assert.equal((await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension()).status, 'ok');
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
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
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


test('移除DNR权限后无API也能保存、启停和worker恢复，旧marker不产生清理状态或新写入', async () => {
  for (const marker of [undefined, true, false]) {
    const config = createSingleRuleConfig('example.com', { automatic: false });
    const storage: Record<string, any> = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true,
      ...(marker === undefined ? {} : { legacyDnrCleanupV3Complete: marker }) };
    const mock = installChromeMock(storage);
    try {
      assert.equal((chrome as any).declarativeNetRequest, undefined);
      const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      const check = (report: any) => {
        assert.equal(report.status, 'ok');
        assert.deepEqual(Object.keys(report.components).sort(), ['contentScripts', 'tabReload', 'webrtc']);
      };
      check(await services.initializeExtension());
      const next = clone(config);
      next.globalProfile.language = { enabled: true, mode: 'custom', language: 'de-DE', languages: ['de-DE'] };
      check((await services.saveSiteConfig(next)).syncReport);
      check((await services.setExtensionEnabled(false)).syncReport);
      check((await services.setExtensionEnabled(true)).syncReport);
      check((await services.reconcileRuntime()).syncReport);
      check(await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension());
      assert.equal(storage.legacyDnrCleanupV3Complete, marker);
      assert.equal(Object.prototype.hasOwnProperty.call(storage, 'legacyDnrCleanupV3Complete'), marker !== undefined);
      assert.deepEqual(mock.executeCalls, []);
      assert.deepEqual(mock.reloadCalls, []);
    } finally { mock.restore(); }
  }
});


test('未启用规则时后台对账撤销旧字体项，不影响语言时区或其他注册', async () => {
  const value = createInitialConfig();
  value.masterEnabled = true; value.fontExposure.enabled = true;
  const storage = { [SITE_CONFIG_KEY]: value };
  const mock = installChromeMock(storage, { initialScripts: [
    { id: 'vanishgeo-font-exposure-example.test', matches: ['*://example.test/*'], js: ['font-exposure/filter.js'] },
    { id: 'other-owned-component', matches: ['*://other.test/*'], js: ['other.js'] }
  ] });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const result = await services.reconcileRuntime();
    assert.equal(result.syncReport.components.contentScripts.status, 'ok');
    assert.deepEqual((await chrome.scripting.getRegisteredContentScripts()).map(script => script.id), ['other-owned-component']);
    assert.deepEqual(mock.registeredScripts, []);
  } finally { mock.restore(); }
});

test('获准字体生产接线独立于 userScripts：按实际字体变化保留重载欠账，重启恢复且不自动刷新', async () => {
    const config = createSingleRuleConfig('example.com', { automatic: false });
  config.globalProfile.language.enabled = false; config.globalProfile.timezone.enabled = false;
  config.fontExposure.enabled = false;
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const mock = installChromeMock(storage, { tabs: [
    { id: 1, url: 'https://example.com/page' }, { id: 2, url: 'https://unmatched.test/page' }
  ] as chrome.tabs.Tab[] });
  const originalRegister = chrome.scripting.registerContentScripts;
  try {
    chrome.userScripts.getScripts = async () => { throw new Error('Allow User Scripts 未开'); };
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    const changed = clone(config); changed.fontExposure.enabled = true;
    chrome.scripting.registerContentScripts = async () => { throw new Error('合成字体注册故障'); };
    const failed = await services.saveSiteConfig(changed);
    assert.equal(failed.syncReport.fontRuntime?.state, 'sync-failed');
    assert.equal(failed.syncReport.fontRuntime?.registeredRuleCount, null);
    assert.equal(failed.syncReport.fontRuntime?.reloadRequired, false);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[1, ['font']], [2, ['font']]]);
    chrome.scripting.registerContentScripts = originalRegister;
    const restored = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.deepEqual(restored.fontRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
    assert.equal(restored.pageRuntime?.reloadRequired, false);
    assert.notEqual(restored.pageRuntime?.state, 'ready');
    assert.equal(restored.status, 'partial');
    assert.equal((await chrome.scripting.getRegisteredContentScripts())[0].world, 'MAIN');
    const oldPending = clone(mock.sessionStorage.runtimeSyncMetadata.pendingReloads);
    const custom = clone(changed); custom.fontExposure.mode = 'custom';
    const saved = await services.saveSiteConfig(custom);
    assert.equal(saved.syncReport.fontRuntime?.state, 'custom-paused');
    // 自定义模式也必须提示重载，旧固定 hook 不会被撤销。
    assert.equal(saved.syncReport.fontRuntime?.reloadRequired, true);
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.previous, undefined);
    custom.fontExposure.blockedFamilies = ['Synthetic Custom Font'];
    await services.saveSiteConfig(custom);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads, oldPending);
    const off = await services.setExtensionEnabled(false);
    assert.equal(off.syncReport.fontRuntime?.state, 'disabled');
    assert.equal(off.syncReport.fontRuntime?.reloadRequired, true);
    assert.deepEqual(mock.executeCalls, []); assert.deepEqual(mock.reloadCalls, []);
  } finally { mock.restore(); }
});

test('字体撤销窗口中新开顶层不匹配的页面也保守覆盖 iframe，补录义务跨中断恢复', async () => {
    const config = createSingleRuleConfig('example.com', { automatic: false });
  config.globalProfile.language.enabled = false; config.globalProfile.timezone.enabled = false;
  config.fontExposure.enabled = true;
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const tabs: chrome.tabs.Tab[] = [];
  const mock = installChromeMock(storage, { tabs });
  const originalSet = chrome.storage.local.set, originalRevoke = chrome.scripting.unregisterContentScripts;
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await services.initializeExtension();
    let oldHookPossible = false;
    chrome.storage.local.set = (async (items: Record<string, any>) => {
      await originalSet(items);
      if (items[SITE_CONFIG_KEY]?.fontExposure.enabled === false) {
        oldHookPossible = (await chrome.scripting.getRegisteredContentScripts()).length === 1;
        // 顶层 URL 不匹配，但其普通 iframe 可以匹配 example.com。
        tabs.push({ id: 9, url: 'https://unmatched.test/with-iframe' } as chrome.tabs.Tab);
      }
    }) as typeof chrome.storage.local.set;
    chrome.scripting.unregisterContentScripts = async () => { throw new Error('合成窗口中断'); };
    const disabled = clone(config); disabled.fontExposure.enabled = false;
    const failed = await services.saveSiteConfig(disabled);
    assert.equal(oldHookPossible, true);
    assert.equal(failed.syncReport.fontRuntime?.state, 'sync-failed');
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingFontScopeChange, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[9, ['font']]]);
    tabs.push({ id: 10, url: 'https://another.test/late-iframe' } as chrome.tabs.Tab);
    chrome.scripting.unregisterContentScripts = originalRevoke;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.deepEqual(recovered.fontRuntime, { state: 'disabled', registeredRuleCount: 0, reloadRequired: true });
    assert.equal(recovered.pageRuntime?.reloadRequired, false);
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingFontScopeChange, undefined);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [9, 10]);
    assert.deepEqual(mock.reloadCalls, []); assert.deepEqual(mock.executeCalls, []);
  } finally { mock.restore(); }
});


test('定位撤销窗口覆盖iframe与新开页面，故障和后台重启不丢失补录义务', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
  const tabs: chrome.tabs.Tab[] = [];
  const mock = installChromeMock(storage, { tabs });
  const originalSet = chrome.storage.local.set, originalRevoke = chrome.userScripts.unregister;
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await services.initializeExtension();
    chrome.storage.local.set = (async (items: Record<string, any>) => {
      await originalSet(items);
      if (items[SITE_CONFIG_KEY]?.globalProfile.geolocation.enabled === false) tabs.push({ id: 9, url: 'https://unmatched.test/iframe' } as chrome.tabs.Tab);
    }) as typeof chrome.storage.local.set;
    chrome.userScripts.unregister = async () => { throw new Error('合成定位撤销失败'); };
    const off = clone(config); off.globalProfile.geolocation.enabled = false;
    const failed = await services.saveSiteConfig(off);
    assert.equal(failed.syncReport.geolocationRuntime?.state, 'sync-failed');
    assert.equal(failed.syncReport.pageRuntime?.state, 'ready');
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingGeolocationScopeChange, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[9, ['geolocation']]]);
    tabs.push({ id: 10, url: 'https://another.test/iframe' } as chrome.tabs.Tab);
    chrome.userScripts.unregister = originalRevoke;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.deepEqual(recovered.geolocationRuntime, { state: 'disabled', registeredRuleCount: 0, reloadRequired: true });
    assert.equal(recovered.pageRuntime?.reloadRequired, false);
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingGeolocationScopeChange, undefined);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => item.tabId), [9, 10]);
    assert.deepEqual(mock.reloadCalls, []);
  } finally { mock.restore(); }
});

test('启动配置读取失败撤销所属定位注册，保留其他namespace且原始错误可见', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs: chrome.tabs.Tab[] = [];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    await services.initializeExtension();
    await chrome.userScripts.register([{ id: 'other-owner', matches: ['*://other.test/*'], js: [{ code: 'void 0' }] }]);
    const error = new Error('合成配置读取失败');
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = async () => { throw error; };
    await assert.rejects(services.initializeExtension(), value => value === error);
    const actual = await chrome.userScripts.getScripts();
    assert.equal(actual.some(script => script.id.startsWith('vanishgeo-geolocation-')), false);
    assert.equal(actual.some(script => script.id.startsWith('vanishgeo-language-timezone-')), true);
    assert.equal(actual.some(script => script.id === 'other-owner'), true);
    tabs.push({ id: 12, url: 'https://example.com/during-failure' } as chrome.tabs.Tab);
    chrome.storage.local.get = originalGet;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(recovered.geolocationRuntime?.reloadRequired, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[12, ['geolocation']]]);
  } finally { mock.restore(); }
});

test('定位注册恢复预写窗口跨最终checkpoint失败和worker重启保留，预写失败不改定位注册', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const tabs: chrome.tabs.Tab[] = [];
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
  const sessionSet = chrome.storage.session.set;
  try {
    const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
    chrome.storage.session.set = async () => { throw new Error('合成预写失败'); };
    const failed = await services.initializeExtension();
    assert.equal(failed.geolocationRuntime?.state, 'sync-failed');
    assert.equal((await chrome.userScripts.getScripts()).some(script => script.id.startsWith('vanishgeo-geolocation-')), false);
    chrome.storage.session.set = (async (items: Record<string, any>) => {
      const metadata = items.runtimeSyncMetadata;
      if (metadata?.report.geolocationRuntime?.state === 'ready' && !metadata.pendingGeolocationScopeChange) throw new Error('合成最终checkpoint失败');
      return sessionSet(items);
    }) as typeof chrome.storage.session.set;
    const registered = await services.initializeExtension();
    assert.equal(registered.geolocationRuntime?.state, 'ready');
    assert.equal(registered.status, 'partial');
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingGeolocationScopeChange, true);
    tabs.push({ id: 17, url: 'https://example.com/during-recovery' } as chrome.tabs.Tab);
    chrome.storage.session.set = sessionSet;
    const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(recovered.geolocationRuntime?.reloadRequired, true);
    assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]), [[17, ['geolocation']]]);
    assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingGeolocationScopeChange, undefined);
  } finally { mock.restore(); }
});


test('字体故障恢复：配置不变也补录读取失败窗口的顶层和iframe重载债', async (t) => {
  for (const areaName of ['local', 'session'] as const) await t.test(areaName, async () => {
    const config = createSingleRuleConfig('example.test', { automatic: false });
    config.fontExposure.enabled = true;
    config.globalProfile.geolocation.enabled = false;
    const storage = { [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true };
    const tabs: chrome.tabs.Tab[] = [];
    const mock = installChromeMock(storage, { tabs });
    const area = chrome.storage[areaName], get = area.get;
    try {
      const services = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      await services.initializeExtension();
      const before = clone(storage);
      const pageScripts = await chrome.userScripts.getScripts();
      const error = new Error('合成启动读取故障');
      area.get = (async () => { throw error; }) as typeof get;
      await assert.rejects(services.initializeExtension(), failure => failure === error);
      assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
      tabs.push({ id: 31, url: 'https://example.test/during-failure' } as chrome.tabs.Tab,
        { id: 32, url: 'https://unmatched.test/with-matched-iframe' } as chrome.tabs.Tab,
        { id: 33, url: 'chrome://extensions/' } as chrome.tabs.Tab);
      area.get = get;
      const recovered = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
      assert.deepEqual(recovered.fontRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
      assert.equal(recovered.pageRuntime?.state, 'ready');
      assert.equal(recovered.pageRuntime?.reloadRequired, false);
      assert.equal(recovered.geolocationRuntime?.reloadRequired, false);
      assert.deepEqual(await chrome.userScripts.getScripts(), pageScripts);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]),
        [[31, ['font']], [32, ['font']]]);
      assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingFontScopeChange, undefined);
      assert.deepEqual(storage, before);
      assert.deepEqual(mock.reloadCalls, []);
      assert.deepEqual(mock.executeCalls, []);
    } finally { area.get = get; mock.restore(); }
  });
});

test('字体故障恢复：注册预写失败不改变实际字体注册', async () => {
  const config = createSingleRuleConfig('example.test', { automatic: false });
  config.fontExposure.enabled = true;
  config.globalProfile.geolocation.enabled = false;
  const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true });
  const set = chrome.storage.session.set;
  try {
    chrome.storage.session.set = async () => { throw new Error('合成字体预写失败'); };
    const report = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
    assert.equal(report.fontRuntime?.state, 'sync-failed');
    assert.equal(report.fontRuntime?.registeredRuleCount, null);
    assert.equal(report.fontRuntime?.reloadRequired, false);
    assert.equal(report.status, 'partial');
    assert.deepEqual(await chrome.scripting.getRegisteredContentScripts(), []);
    assert.deepEqual(mock.registeredScripts, []);
  } finally { chrome.storage.session.set = set; mock.restore(); }
});

test('字体故障恢复：注册、查询和最终checkpoint失败后跨worker补录窗口且保持幂等', async (t) => {
  for (const fault of ['register', 'query', 'checkpoint']) await t.test(fault, async () => {
    const config = createSingleRuleConfig('example.test', { automatic: false });
    config.fontExposure.enabled = true;
    config.globalProfile.geolocation.enabled = false;
    const tabs: chrome.tabs.Tab[] = [];
    const mock = installChromeMock({ [SITE_CONFIG_KEY]: config, [RULES_INITIALIZED_KEY]: true }, { tabs });
    const set = chrome.storage.session.set, query = chrome.tabs.query, register = chrome.scripting.registerContentScripts;
    try {
      if (fault === 'register') chrome.scripting.registerContentScripts = async () => { throw new Error('合成注册失败'); };
      if (fault === 'query') chrome.tabs.query = async () => { throw new Error('合成查询失败'); };
      if (fault === 'checkpoint') chrome.storage.session.set = (async (items: Record<string, any>) => {
        if (items.runtimeSyncMetadata?.report.fontRuntime?.state === 'ready' && !items.runtimeSyncMetadata.pendingFontScopeChange) {
          throw new Error('合成字体最终checkpoint失败');
        }
        return set(items);
      }) as typeof set;
      const failed = await createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension();
      assert.equal(failed.status, 'partial');
      assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingFontScopeChange, true);
      if (fault === 'register') assert.equal(failed.fontRuntime?.state, 'sync-failed');
      if (fault === 'query') assert.equal(failed.components.tabReload.status, 'failed');
      if (fault === 'checkpoint') assert.equal(failed.metadataError?.code, 'metadata-write-failed');
      tabs.push({ id: 41, url: 'https://example.test/during-recovery' } as chrome.tabs.Tab,
        { id: 42, url: 'https://unmatched.test/with-matched-iframe' } as chrome.tabs.Tab);
      chrome.storage.session.set = set; chrome.tabs.query = query; chrome.scripting.registerContentScripts = register;
      const restarted = createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      const recovered = await restarted.initializeExtension();
      assert.deepEqual(recovered.fontRuntime, { state: 'ready', registeredRuleCount: 1, reloadRequired: true });
      assert.equal(recovered.pageRuntime?.reloadRequired, false);
      assert.equal(recovered.geolocationRuntime?.reloadRequired, false);
      assert.equal(mock.sessionStorage.runtimeSyncMetadata.pendingFontScopeChange, undefined);
      assert.deepEqual(mock.sessionStorage.runtimeSyncMetadata.pendingReloads.map((item: any) => [item.tabId, item.surfaces]),
        [[41, ['font']], [42, ['font']]]);
      let writes = 0;
      chrome.storage.session.set = (async (...args: any[]) => { writes += 1; return Reflect.apply(set, chrome.storage.session, args); }) as typeof set;
      const mutations = clone(mock.mutations);
      await restarted.initializeExtension();
      assert.equal(writes, 0);
      assert.deepEqual(mock.mutations, mutations);
      assert.deepEqual(mock.reloadCalls, []); assert.deepEqual(mock.executeCalls, []);
    } finally { mock.restore(); }
  });
});
