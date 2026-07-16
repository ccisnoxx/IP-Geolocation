// 验证后台对出口检测可信边界、配置事务、标签页刷新和文档级注入的统一所有权。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundServices, fetchGeoApiLocation, parseGeoApiResponse } from '../src/background/services';
import { createBackgroundMessageRouter } from '../src/background/message-router';
import {
  RULES_INITIALIZED_KEY,
  SITE_CONFIG_KEY,
  clone,
  normalizeConfig
} from '../src/shared/config-model';
import type { ExitLocationProfile, SiteSpoofConfig } from '../src/shared/types';

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
      geolocation: automatic
        ? { enabled: true, mode: 'auto' }
        : {
            enabled: true,
            mode: 'manual',
            latitude: 35.68,
            longitude: 139.76,
            accuracy: 50,
            country: 'Japan'
          },
      timezone: automatic
        ? { enabled: true, mode: 'auto' }
        : { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
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
}

function installChromeMock(storage: Record<string, any>, options: ChromeMockOptions = {}) {
  const originalChrome = (globalThis as any).chrome;
  const sessionStorage: Record<string, any> = {};
  const registeredScripts: chrome.scripting.RegisteredContentScript[][] = [];
  const executeCalls: chrome.scripting.ScriptInjection<any[], any>[] = [];
  const reloadCalls: number[] = [];
  const createdTabUrls: string[] = [];
  let activeReloads = 0;
  let maxActiveReloads = 0;
  const tabs = options.tabs || [];

  const storageArea = (target: Record<string, any>) => ({
    get: async (key?: string | string[] | null) => {
      if (key == null) return { ...target };
      if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, target[item]]));
      return { [key]: target[key] };
    },
    set: async (items: Record<string, any>) => {
      Object.assign(target, items);
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
      unregisterContentScripts: async () => undefined,
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        registeredScripts.push(scripts);
      },
      executeScript: async (details: chrome.scripting.ScriptInjection<any[], any>) => {
        executeCalls.push(details);
        return [];
      }
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => undefined
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          get: async () => ({
            value: 'disable_non_proxied_udp',
            levelOfControl: 'controlled_by_this_extension'
          }),
          set: async () => undefined,
          clear: async () => undefined
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
      getURL: (path: string) => `chrome-extension://vanishgeo-test/${path}`
    }
  };

  return {
    sessionStorage,
    registeredScripts,
    executeCalls,
    reloadCalls,
    createdTabUrls,
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

    const confirmed = await services.confirmExitLocationDetection(preview.detectionId, '东京出口');
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
    const saved = await services.confirmExitLocationDetection(preview.detectionId, '新加坡家宽');
    assert.equal(saved.exitLocationProfiles[0].id, 'exit-home');
    assert.equal(saved.exitLocationProfiles[0].publicIp, '203.0.113.99');
    assert.equal(saved.rules[0].exitLocationProfileId, 'exit-home');
    assert.equal(saved.rules[1].exitLocationProfileId, 'exit-home');
    assert.deepEqual(mock.reloadCalls, [1, 3]);
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
    const saved = await services.deleteExitLocationProfile('exit-home');
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
    const normallySaved = await services.saveSiteConfig(forged);
    assert.equal(normallySaved.exitLocationProfiles[0].publicIp, '203.0.113.10');
    assert.equal(normallySaved.exitLocationProfiles[0].latitude, 35.68);

    const imported = await services.importSiteConfig(forged);
    assert.equal(imported.exitLocationProfiles[0].verification, 'unverified');
    assert.equal(imported.exitLocationProfiles[0].publicIp, null);
    assert.equal(imported.exitLocationProfiles[0].provider, null);
    assert.equal(imported.exitLocationProfiles[0].verifiedAt, null);
    assert.equal(imported.rules[0].exitLocationProfileId, null);
  } finally {
    mock.restore();
  }
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

test('runtime initialization trusts sender metadata and injects only that document in MAIN world', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices();
    const router = createBackgroundMessageRouter(services);
    const sender = {
      id: 'vanishgeo-test',
      tab: { id: 7, url: 'https://example.com/page' } as chrome.tabs.Tab,
      documentId: 'document-7',
      url: 'https://example.com/page',
      origin: 'https://example.com'
    } satisfies chrome.runtime.MessageSender;
    const response = await router.respond({
      action: 'initializeRuntimeForSender',
      url: 'https://attacker.test/',
      payload: { languageConfig: { enabled: true, language: 'fr-FR' } }
    }, sender);

    assert.ok(response.payload);
    assert.equal(response.payload.languageConfig.language, 'ja-JP');
    assert.equal(mock.executeCalls.length, 1);
    assert.deepEqual(mock.executeCalls[0].target, { tabId: 7, documentIds: ['document-7'] });
    assert.equal(mock.executeCalls[0].world, 'MAIN');
    assert.equal(mock.executeCalls[0].injectImmediately, true);
    assert.equal(mock.executeCalls[0].args?.[1], 'document-7');
    await services.initializeRuntimeForSender({
      id: 'vanishgeo-test',
      tab: { id: 7, url: 'https://example.com/page' } as chrome.tabs.Tab,
      documentId: 'document-about',
      url: 'about:blank',
      origin: 'null'
    });
    assert.equal(mock.executeCalls.length, 2);
    assert.deepEqual(mock.executeCalls[1].target, { tabId: 7, documentIds: ['document-about'] });
    await assert.rejects(router.respond({ action: 'setExtensionEnabled', enabled: false }, sender), /只允许扩展管理页面/);
    const extensionPageResponse = await router.respond({ action: 'getSiteConfig' }, {
      id: 'vanishgeo-test',
      tab: { id: 9, url: 'chrome-extension://vanishgeo-test/options/options.html' } as chrome.tabs.Tab,
      url: 'chrome-extension://vanishgeo-test/options/options.html'
    });
    assert.equal(extensionPageResponse.config.schemaVersion, 2);
    await assert.rejects(services.initializeRuntimeForSender({
      id: 'other-extension',
      tab: { id: 7 } as chrome.tabs.Tab,
      documentId: 'document-7',
      url: 'https://example.com/page'
    }), /拒绝非本扩展/);
    await assert.rejects(services.initializeRuntimeForSender({
      tab: { id: 7 } as chrome.tabs.Tab,
      documentId: 'document-7',
      url: 'https://example.com/page'
    }), /拒绝非本扩展/);
  } finally {
    mock.restore();
  }
});

test('initializeExtension performs no network detection and registers one isolated all-frame bootstrap', async () => {
  const config = createSingleRuleConfig('example.com', { automatic: false });
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('初始化不应定位');
  }) as any;
  try {
    const services = createBackgroundServices();
    await Promise.all([services.initializeExtension(), services.initializeExtension()]);
    assert.equal(fetchCalls, 0);
    assert.equal(mock.registeredScripts.length, 1);
    const script = mock.registeredScripts[0][0];
    assert.equal(script.id, 'vanishgeo-runtime-init');
    assert.equal(script.world, 'ISOLATED');
    assert.equal(script.allFrames, true);
    assert.equal(script.matchOriginAsFallback, true);
    assert.equal(script.runAt, 'document_start');
  } finally {
    mock.restore();
    globalThis.fetch = originalFetch;
  }
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

test('openDiagnosticPage passes the effective profile as expected query params', async () => {
  const config = createSingleRuleConfig('leak.962850.xyz', { automatic: false });
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config,
    [RULES_INITIALIZED_KEY]: true
  };
  const mock = installChromeMock(storage);
  try {
    const services = createBackgroundServices();
    await services.openDiagnosticPage();
    assert.equal(mock.createdTabUrls.length, 1);
    const url = new URL(mock.createdTabUrls[0]);
    assert.equal(url.origin, 'https://leak.962850.xyz');
    assert.equal(url.searchParams.get('validation'), 'acceptance');
    assert.equal(url.searchParams.get('expectedLanguage'), 'ja-JP');
    assert.equal(url.searchParams.get('expectedTimezone'), 'Asia/Tokyo');
    assert.equal(url.searchParams.get('expectedLatitude'), '35.68');
    assert.equal(url.searchParams.get('expectedWebRtcMode'), 'strict');
  } finally {
    mock.restore();
  }
});
