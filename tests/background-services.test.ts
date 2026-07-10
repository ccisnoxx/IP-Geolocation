import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundServices, fetchGeoApiLocation, parseGeoApiResponse } from '../src/background/services';
import { LAST_LOCATION_KEY, SITE_CONFIG_KEY, normalizeConfig } from '../src/shared/config-model';
import {
  GEO_PROVIDER_BACKOFF_KEY,
  GEO_REFRESH_STATE_KEY,
  LAST_LOCATION_TTL_MS
} from '../src/shared/ip-location';
import type { LastLocation } from '../src/shared/types';

function createSingleRuleConfig(domain = 'example.com') {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      geolocation: {
        enabled: true,
        mode: 'manual',
        latitude: 35.68,
        longitude: 139.76,
        accuracy: 50,
        country: 'Japan',
        randomize: false,
        randomRadiusMeters: 1000,
        spoofPermission: true,
        history: []
      },
      timezone: {
        enabled: true,
        mode: 'manual',
        timezone: 'Asia/Tokyo'
      },
      language: {
        enabled: true,
        mode: 'preset',
        language: 'ja-JP',
        languages: ['ja-JP', 'ja'],
        acceptLanguage: 'ja-JP,ja;q=0.9'
      }
    },
    webRtc: { globalMode: 'strict' },
    rules: [{
      id: `rule-${domain}`,
      domain,
      enabled: true,
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

test('parseGeoApiResponse accepts ipwho.is shape', () => {
  const parsed = parseGeoApiResponse({
    success: true,
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: { id: 'Asia/Singapore', offset: 28800 }
  });

  assert.equal(parsed?.latitude, 1.3521);
  assert.equal(parsed?.longitude, 103.8198);
  assert.equal(parsed?.timezone, 'Asia/Singapore');
  assert.equal(parsed?.timezoneOffset, -480);
});

test('parseGeoApiResponse accepts ipapi location shape', () => {
  const parsed = parseGeoApiResponse({
    location: { latitude: 35.68, longitude: 139.76 },
    country: { name: 'Japan' },
    timezone: 'Asia/Tokyo'
  });

  assert.equal(parsed?.country, 'Japan');
  assert.equal(parsed?.timezone, 'Asia/Tokyo');
});

test('parseGeoApiResponse accepts ipinfo loc shape', () => {
  const parsed = parseGeoApiResponse({
    loc: '52.52,13.405',
    country: 'DE',
    timezone: 'Europe/Berlin'
  });

  assert.equal(parsed?.latitude, 52.52);
  assert.equal(parsed?.longitude, 13.405);
});

test('parseGeoApiResponse rejects invalid coordinates instead of fallback coordinates', () => {
  assert.equal(parseGeoApiResponse({
    success: true,
    latitude: 95,
    longitude: 139.76,
    country: 'Japan'
  }), null);
  assert.equal(parseGeoApiResponse({
    success: false,
    country: { code: 'CN' }
  }), null);
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
    await assert.rejects(
      fetchGeoApiLocation('https://slow.example.test/json', 1),
      /timeout after 1ms/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function installChromeMock(storage: Record<string, any>, tabs: chrome.tabs.Tab[] = [], createdTabUrls: string[] = []) {
  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string | null) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      unregisterContentScripts: async () => undefined,
      registerContentScripts: async () => undefined,
      executeScript: async () => undefined
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
      create: async ({ url }: { url: string }) => {
        createdTabUrls.push(url);
        return { id: createdTabUrls.length, url } as chrome.tabs.Tab;
      }
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://vanishgeo/${path}`
    }
  };
  return () => {
    (globalThis as any).chrome = originalChrome;
  };
}

test('updateGeolocation skips provider calls while lastLocation is fresh', async () => {
  const now = Date.now();
  const storage: Record<string, any> = {
    [LAST_LOCATION_KEY]: {
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: 'Asia/Tokyo',
      updatedAt: now,
      expiresAt: now + LAST_LOCATION_TTL_MS
    } satisfies LastLocation
  };
  const restoreChrome = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('should not fetch fresh location');
  }) as any;

  try {
    const services = createBackgroundServices();
    const result = await services.updateGeolocation(false);

    assert.equal(result.ok, true);
    assert.equal(result.unchanged, true);
    assert.equal(fetchCalls, 0);
    assert.equal(storage[GEO_REFRESH_STATE_KEY].status, 'idle');
  } finally {
    restoreChrome();
    globalThis.fetch = originalFetch;
  }
});

test('updateGeolocation falls back to the next provider and records failed-provider backoff', async () => {
  const storage: Record<string, any> = {};
  const restoreChrome = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('ipwho.is')) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({
        location: { latitude: 35.68, longitude: 139.76 },
        country: { name: 'Japan' },
        timezone: 'Asia/Tokyo'
      })
    };
  }) as any;

  try {
    const services = createBackgroundServices();
    const result = await services.updateGeolocation(true);

    assert.equal(result.ok, true);
    assert.equal(result.location?.provider, 'https://ipapi.co/json/');
    assert.deepEqual(calls, ['https://ipwho.is/', 'https://ipapi.co/json/']);
    assert.equal(storage[LAST_LOCATION_KEY].provider, 'https://ipapi.co/json/');
    assert.equal(storage[GEO_PROVIDER_BACKOFF_KEY]['https://ipwho.is/'].failures, 1);
    assert.equal(storage[GEO_PROVIDER_BACKOFF_KEY]['https://ipapi.co/json/'], undefined);
    assert.equal(storage[GEO_REFRESH_STATE_KEY].status, 'idle');
  } finally {
    restoreChrome();
    globalThis.fetch = originalFetch;
  }
});

test('provider backoff preserves stale last-known-good injection instead of overwriting with bad data', async () => {
  const now = Date.now();
  const staleLocation: LastLocation = {
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: 'Asia/Singapore',
    updatedAt: now - (LAST_LOCATION_TTL_MS * 2),
    expiresAt: now - LAST_LOCATION_TTL_MS
  };
  const storage: Record<string, any> = {
    [LAST_LOCATION_KEY]: staleLocation,
    [GEO_PROVIDER_BACKOFF_KEY]: {
      'https://ipwho.is/': { failures: 2, nextRetryAt: now + LAST_LOCATION_TTL_MS, lastError: 'HTTP 503' },
      'https://ipapi.co/json/': { failures: 2, nextRetryAt: now + LAST_LOCATION_TTL_MS, lastError: 'timeout' },
      'https://ipinfo.io/json': { failures: 2, nextRetryAt: now + LAST_LOCATION_TTL_MS, lastError: 'HTTP 429' }
    }
  };
  const restoreChrome = installChromeMock(storage);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('providers should be skipped during backoff');
  }) as any;

  try {
    const services = createBackgroundServices();
    const result = await services.updateGeolocation(false);
    const payload = await services.getPayloadForUrl('https://chatgpt.com/');

    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.equal(result.location?.latitude, staleLocation.latitude);
    assert.equal(fetchCalls, 0);
    assert.equal(storage[LAST_LOCATION_KEY], staleLocation);
    assert.equal(storage[GEO_REFRESH_STATE_KEY].status, 'error');
    assert.match(storage.lastGeoError, /cooling down/);
    assert.equal(payload.payload?.latitude, staleLocation.latitude);
    assert.equal(payload.payload?.timezone, staleLocation.timezone);
  } finally {
    restoreChrome();
    globalThis.fetch = originalFetch;
  }
});

test('openDiagnosticPage passes the leak-test effective profile as expected query params', async () => {
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: createSingleRuleConfig('leak.962850.xyz')
  };
  const createdTabUrls: string[] = [];
  const restoreChrome = installChromeMock(storage, [], createdTabUrls);

  try {
    const services = createBackgroundServices();
    await services.openDiagnosticPage();

    assert.equal(createdTabUrls.length, 1);
    const url = new URL(createdTabUrls[0]);
    assert.equal(url.origin, 'https://leak.962850.xyz');
    assert.equal(url.pathname, '/leak-test/leak-test.html');
    assert.equal(url.searchParams.get('ui'), 'zh');
    assert.equal(url.searchParams.get('validation'), 'acceptance');
    assert.equal(url.searchParams.get('expectedLanguage'), 'ja-JP');
    assert.equal(url.searchParams.get('expectedLanguages'), 'ja-JP,ja');
    assert.equal(url.searchParams.get('expectedAcceptLanguage'), 'ja-JP,ja;q=0.9');
    assert.equal(url.searchParams.get('expectedTimezone'), 'Asia/Tokyo');
    assert.equal(url.searchParams.get('expectedTimezoneOffset'), '-540');
    assert.equal(url.searchParams.get('expectedLatitude'), '35.68');
    assert.equal(url.searchParams.get('expectedLongitude'), '139.76');
    assert.equal(url.searchParams.get('expectedGeoToleranceMeters'), '50');
    assert.equal(url.searchParams.get('expectedWebRtcMode'), 'strict');
    assert.equal(url.searchParams.get('expectedWebRtcPolicy'), 'disable_non_proxied_udp');
    assert.equal(url.searchParams.get('actualWebRtcPolicySupported'), 'true');
    assert.equal(url.searchParams.get('actualWebRtcPolicy'), 'disable_non_proxied_udp');
    assert.equal(url.searchParams.get('actualWebRtcPolicyLevelOfControl'), 'controlled_by_this_extension');
    assert.equal(url.searchParams.get('actualWebRtcPolicyControlledByThisExtension'), 'true');
    assert.equal(url.searchParams.get('actualWebRtcLeakProtectionActive'), 'true');
    assert.match(url.searchParams.get('expectedLocaleStringTimestamp') || '', /^\d+$/);
    assert.ok(url.searchParams.get('expectedLocaleString'));
  } finally {
    restoreChrome();
  }
});

test('initializeExtension coalesces repeated runtime side effects and geolocation refresh', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  const registered = new Set<string>();
  let registerCalls = 0;
  let dnrCalls = 0;
  let webRtcCalls = 0;
  let fetchCalls = 0;

  const originalChrome = (globalThis as any).chrome;
  const originalFetch = globalThis.fetch;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        ids.forEach((id) => registered.delete(id));
      },
      registerContentScripts: async (scripts: Array<{ id: string }>) => {
        registerCalls += 1;
        scripts.forEach((script) => {
          if (registered.has(script.id)) {
            throw new Error(`Duplicate script ID '${script.id}'`);
          }
        });
        scripts.forEach((script) => registered.add(script.id));
      }
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => {
        dnrCalls += 1;
      }
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set: async () => {
            webRtcCalls += 1;
          },
          clear: async () => undefined
        }
      }
    },
    tabs: {
      query: async () => []
    }
  };
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    await delay(1);
    return {
      ok: true,
      json: async () => ({
        success: true,
        latitude: 35.68,
        longitude: 139.76,
        country: 'Japan',
        timezone: { id: 'Asia/Tokyo', offset: 32400 }
      })
    };
  }) as any;

  try {
    const services = createBackgroundServices();
    await Promise.all([
      services.initializeExtension(),
      services.initializeExtension()
    ]);

    assert.ok(storage[SITE_CONFIG_KEY]);
    assert.equal(registered.has('vanishgeo-main-runtime'), true);
    assert.equal(registered.has('vanishgeo-bridge'), true);
    assert.equal(registerCalls, 1);
    assert.equal(dnrCalls, 1);
    assert.equal(webRtcCalls, 1);
    assert.equal(fetchCalls, 1);
  } finally {
    (globalThis as any).chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test('concurrent saveSiteConfig coalesces runtime side effects and all-tab reinjection', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  const tabs = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    url: `https://app${index}.example.com/page`
  })) as chrome.tabs.Tab[];
  const registered = new Set<string>();
  const executeCalls: Array<{ tabId: number; kind: 'runtime' | 'payload' }> = [];
  let activeExecuteCalls = 0;
  let maxActiveExecuteCalls = 0;
  let registerCalls = 0;
  let dnrCalls = 0;
  let webRtcCalls = 0;

  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        ids.forEach((id) => registered.delete(id));
      },
      registerContentScripts: async (scripts: Array<{ id: string }>) => {
        registerCalls += 1;
        scripts.forEach((script) => {
          if (registered.has(script.id)) {
            throw new Error(`Duplicate script ID '${script.id}'`);
          }
        });
        scripts.forEach((script) => registered.add(script.id));
      },
      executeScript: async (details: { target: { tabId: number }; files?: string[]; func?: unknown }) => {
        activeExecuteCalls += 1;
        maxActiveExecuteCalls = Math.max(maxActiveExecuteCalls, activeExecuteCalls);
        executeCalls.push({
          tabId: details.target.tabId,
          kind: details.files ? 'runtime' : 'payload'
        });
        await delay(2);
        activeExecuteCalls -= 1;
      }
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => {
        dnrCalls += 1;
      }
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set: async () => {
            webRtcCalls += 1;
          },
          clear: async () => undefined
        }
      }
    },
    tabs: {
      query: async () => tabs
    }
  };

  try {
    const services = createBackgroundServices();
    await Promise.all([
      services.saveSiteConfig(config),
      services.saveSiteConfig(config)
    ]);

    assert.equal(registerCalls, 1);
    assert.equal(dnrCalls, 1);
    assert.equal(webRtcCalls, 1);
    assert.equal(executeCalls.length, tabs.length * 2);
    assert.equal(new Set(executeCalls.map((call) => call.tabId)).size, tabs.length);
    assert.ok(maxActiveExecuteCalls <= 4);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('runtime side effect failure does not block other effects or tab injection', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  let registerCalls = 0;
  let webRtcCalls = 0;
  let payloadCalls = 0;

  const originalChrome = (globalThis as any).chrome;
  const originalWarn = console.warn;
  console.warn = () => undefined;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      unregisterContentScripts: async () => undefined,
      registerContentScripts: async () => {
        registerCalls += 1;
      },
      executeScript: async (details: { files?: string[] }) => {
        if (!details.files) {
          payloadCalls += 1;
        }
      }
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => {
        throw new Error('DNR unavailable');
      }
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set: async () => {
            webRtcCalls += 1;
          },
          clear: async () => undefined
        }
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com/page' }]
    }
  };

  try {
    const services = createBackgroundServices();
    const saved = await services.saveSiteConfig(config);

    assert.equal(saved.rules[0].domain, 'example.com');
    assert.equal(registerCalls, 1);
    assert.equal(webRtcCalls, 1);
    assert.equal(payloadCalls, 1);
  } finally {
    (globalThis as any).chrome = originalChrome;
    console.warn = originalWarn;
  }
});

test('injectScript coalesces duplicate concurrent requests for the same tab payload', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  const executeCalls: string[] = [];
  const originalChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      executeScript: async (details: { files?: string[] }) => {
        executeCalls.push(details.files ? 'runtime' : 'payload');
        await delay(2);
      }
    }
  };

  try {
    const services = createBackgroundServices();
    await Promise.all([
      services.injectScript(1, 'https://example.com/page'),
      services.injectScript(1, 'https://example.com/page')
    ]);

    assert.deepEqual(executeCalls, ['runtime', 'payload']);
  } finally {
    (globalThis as any).chrome = originalChrome;
  }
});

test('tab injection failure is isolated from other tabs', async () => {
  const config = createSingleRuleConfig();
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  const tabs = [1, 2, 3].map((id) => ({ id, url: `https://app${id}.example.com/page` })) as chrome.tabs.Tab[];
  const payloadTabs: number[] = [];
  const originalChrome = (globalThis as any).chrome;
  const originalWarn = console.warn;
  console.warn = () => undefined;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      unregisterContentScripts: async () => undefined,
      registerContentScripts: async () => undefined,
      executeScript: async (details: { target: { tabId: number }; files?: string[] }) => {
        if (!details.files) {
          if (details.target.tabId === 2) {
            throw new Error('tab closed');
          }
          payloadTabs.push(details.target.tabId);
        }
      }
    },
    declarativeNetRequest: {
      updateDynamicRules: async () => undefined
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set: async () => undefined,
          clear: async () => undefined
        }
      }
    },
    tabs: {
      query: async () => tabs
    }
  };

  try {
    const services = createBackgroundServices();
    await services.saveSiteConfig(config);

    assert.deepEqual(payloadTabs.sort(), [1, 3]);
    assert.equal(storage[SITE_CONFIG_KEY].rules[0].domain, 'example.com');
  } finally {
    (globalThis as any).chrome = originalChrome;
    console.warn = originalWarn;
  }
});

test('concurrent scheduled geolocation refresh shares provider work and one reinjection batch', async () => {
  const manualConfig = createSingleRuleConfig();
  const config = normalizeConfig({
    ...manualConfig,
    globalProfile: {
      ...manualConfig.globalProfile,
      geolocation: {
        ...manualConfig.globalProfile.geolocation,
        mode: 'auto',
        latitude: null,
        longitude: null
      },
      timezone: {
        ...manualConfig.globalProfile.timezone,
        mode: 'auto',
        timezone: ''
      }
    }
  });
  const storage: Record<string, any> = {
    [SITE_CONFIG_KEY]: config
  };
  const payloads: Array<{ latitude?: number | null; timezone?: string | null }> = [];
  let fetchCalls = 0;

  const originalChrome = (globalThis as any).chrome;
  const originalFetch = globalThis.fetch;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key?: string) => {
          if (!key) return { ...storage };
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set: async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }
      }
    },
    scripting: {
      executeScript: async (details: { files?: string[]; args?: any[] }) => {
        if (!details.files) {
          payloads.push(details.args?.[0] || {});
        }
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com/page' }]
    }
  };
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    await delay(2);
    return {
      ok: true,
      json: async () => ({
        success: true,
        latitude: 1.3521,
        longitude: 103.8198,
        country: 'Singapore',
        timezone: { id: 'Asia/Singapore', offset: 28800 }
      })
    };
  }) as any;

  try {
    const services = createBackgroundServices();
    const [firstResult, secondResult] = await Promise.all([
      services.updateGeolocation(false),
      services.updateGeolocation(false)
    ]);

    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(fetchCalls, 1);
    assert.equal(storage[LAST_LOCATION_KEY].timezone, 'Asia/Singapore');
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].latitude, 1.3521);
    assert.equal(payloads[0].timezone, 'Asia/Singapore');
  } finally {
    (globalThis as any).chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
