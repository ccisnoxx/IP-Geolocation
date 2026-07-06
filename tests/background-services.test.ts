import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundServices, parseGeoApiResponse } from '../src/background/services';
import { SITE_CONFIG_KEY } from '../src/shared/config-model';

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

test('initializeExtension serializes dynamic content script registration', async () => {
  const storage: Record<string, any> = {};
  const registered = new Set<string>();
  let registerCalls = 0;

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
      query: async () => []
    }
  };
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      success: true,
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: { id: 'Asia/Tokyo', offset: 32400 }
    })
  })) as any;

  try {
    const services = createBackgroundServices();
    await Promise.all([
      services.initializeExtension(),
      services.initializeExtension()
    ]);

    assert.ok(storage[SITE_CONFIG_KEY]);
    assert.equal(registered.has('vanishgeo-main-runtime'), true);
    assert.equal(registered.has('vanishgeo-bridge'), true);
    assert.equal(registerCalls, 2);
  } finally {
    (globalThis as any).chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
