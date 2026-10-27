import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBakedPayload } from '../src/injected/baked-resolver';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import {
  DEFAULT_CANVAS,
  DEFAULT_GEOLOCATION,
  DEFAULT_LANGUAGE,
  DEFAULT_WEBRTC,
  normalizeConfig
} from '../src/shared/config-model';
import type { LastLocation, SiteSpoofConfig } from '../src/shared/types';

const lastLocation: LastLocation = {
  latitude: 35.6762,
  longitude: 139.6503,
  country: 'Japan',
  timezone: 'Asia/Tokyo',
  updateTime: '2026-01-01 00:00:00'
};

function config(overrides: Partial<SiteSpoofConfig> = {}): SiteSpoofConfig {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { ...DEFAULT_LANGUAGE, language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: false, mode: 'auto' }
    },
    webRtc: DEFAULT_WEBRTC,
    canvas: { ...DEFAULT_CANVAS, enabled: false },
    rules: [
      { id: 'a', domain: 'claude.ai', enabled: true },
      { id: 'b', domain: 'api.anthropic.com', enabled: true }
    ],
    ...overrides
  } as any);
}

function pickPayload(payload: any) {
  if (!payload) return null;
  return {
    timezone: payload.timezone,
    language: payload.languageConfig ? payload.languageConfig.language : null,
    languages: payload.languageConfig ? payload.languageConfig.languages : null,
    acceptLanguage: payload.languageConfig ? payload.languageConfig.acceptLanguage : null,
    latitude: payload.geolocation ? payload.geolocation.latitude : null,
    longitude: payload.geolocation ? payload.geolocation.longitude : null,
    canvasEnabled: payload.canvasConfig ? payload.canvasConfig.enabled : null
  };
}

test('baked resolver matches getEffectiveProfile for inherited rules', () => {
  const source = config();
  for (const host of ['claude.ai', 'console.claude.ai', 'api.anthropic.com', 'example.com']) {
    const expected = pickPayload(getEffectiveProfile(source, host, lastLocation).payload);
    const actual = pickPayload(resolveBakedPayload(source, host, lastLocation));
    assert.deepEqual(actual, expected, `host ${host}`);
  }
});

test('baked resolver matches getEffectiveProfile for explicit overrides', () => {
  const source = config({
    rules: [
      {
        id: 'a',
        domain: 'claude.ai',
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
    ]
  } as any);

  for (const host of ['claude.ai', 'claude.ai.evil.com']) {
    const expected = pickPayload(getEffectiveProfile(source, host, lastLocation).payload);
    const actual = pickPayload(resolveBakedPayload(source, host, lastLocation));
    assert.deepEqual(actual, expected, `host ${host}`);
  }
});

test('baked resolver falls back to lastLocation timezone when mode is auto', () => {
  const source = config({
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: { enabled: true, mode: 'auto', timezone: '' },
      geolocation: { ...DEFAULT_GEOLOCATION, enabled: true, mode: 'auto' }
    },
    rules: [{ id: 'a', domain: 'claude.ai', enabled: true }]
  } as any);

  const expected = pickPayload(getEffectiveProfile(source, 'claude.ai', lastLocation).payload);
  const actual = pickPayload(resolveBakedPayload(source, 'claude.ai', lastLocation));
  assert.deepEqual(actual, expected);
  assert.equal(actual?.timezone, 'Asia/Tokyo');
  assert.equal(actual?.latitude, lastLocation.latitude);
});

test('baked resolver returns null when the extension is disabled or the host does not match', () => {
  assert.equal(resolveBakedPayload(config({ masterEnabled: false }), 'claude.ai', lastLocation), null);
  assert.equal(resolveBakedPayload(config(), 'not-claude.ai', lastLocation), null);
  assert.equal(resolveBakedPayload(null, 'claude.ai', lastLocation), null);
});