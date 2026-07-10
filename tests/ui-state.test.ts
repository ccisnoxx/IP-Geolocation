import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLastLocationStatus } from '../src/shared/last-location-display';
import { deriveCurrentSiteStatus, deriveEffectiveEnvironment, freezeIpLocationToManualConfig } from '../src/shared/ui-state';
import { normalizeConfig } from '../src/shared/config-model';
import { deriveIpLocationStatus } from '../src/shared/ip-location';
import type { LastLocation } from '../src/shared/types';

const now = Date.now();
const lastLocation: LastLocation = {
  latitude: 35.68,
  longitude: 139.76,
  country: 'Japan',
  timezone: 'Asia/Tokyo',
  timezoneOffset: -540,
  updatedAt: now,
  expiresAt: now + 60_000,
  updateTime: '2026/7/6 20:00:00'
};

test('deriveCurrentSiteStatus differentiates unsupported, disabled, unmatched, enabled, and error states', () => {
  const config = normalizeConfig({
    masterEnabled: true,
    rules: [{ domain: 'example.com', enabled: true }] as any
  });
  const base = {
    domain: 'example.com',
    scriptable: true,
    config,
    matched: true,
    rule: config.rules[0],
    payload: {} as any,
    errors: []
  };

  assert.equal(deriveCurrentSiteStatus({ ...base, scriptable: false }).kind, 'unsupported');
  assert.equal(deriveCurrentSiteStatus({ ...base, config: normalizeConfig({ ...config, masterEnabled: false }) }).kind, 'global-disabled');
  assert.equal(deriveCurrentSiteStatus({ ...base, matched: false, rule: null, payload: null }).kind, 'not-allowlisted');
  assert.equal(deriveCurrentSiteStatus({ ...base, payload: null, errors: ['timezone is missing'] }).kind, 'error');
  assert.equal(deriveCurrentSiteStatus(base).kind, 'enabled');
  assert.equal(deriveCurrentSiteStatus(base).disableDomain, 'example.com');
});

test('deriveEffectiveEnvironment shows follow-IP values without writing manual config', () => {
  const config = normalizeConfig({
    globalProfile: {
      geolocation: { enabled: true, mode: 'auto' },
      timezone: { enabled: true, mode: 'auto' },
      language: { enabled: false }
    } as any
  });
  const display = deriveEffectiveEnvironment(config, lastLocation);

  assert.equal(display.geolocation.source, 'ip');
  assert.match(display.geolocation.value, /35\.68/);
  assert.equal(display.timezone.source, 'ip');
  assert.equal(display.timezone.value, 'Asia/Tokyo');
  assert.match(display.timezone.detail, /GMT\+09:00/);
  assert.equal(display.geolocation.freshness, 'fresh');
  assert.equal(config.globalProfile.geolocation.mode, 'auto');
  assert.equal(config.globalProfile.timezone.mode, 'auto');
  assert.equal(display.canFreezeIpLocation, true);
});

test('IP location display differentiates fresh stale refreshing and error states', () => {
  const staleLocation = {
    ...lastLocation,
    updatedAt: now - 120_000,
    expiresAt: now - 60_000
  };
  const staleStatus = deriveIpLocationStatus(staleLocation, { status: 'idle' }, now);
  const refreshingStatus = deriveIpLocationStatus(staleLocation, { status: 'refreshing', startedAt: now }, now);
  const errorStatus = deriveIpLocationStatus(staleLocation, { status: 'error', error: 'provider timeout', completedAt: now }, now);

  assert.match(formatLastLocationStatus(lastLocation, deriveIpLocationStatus(lastLocation, { status: 'idle' }, now)), /Fresh（有效）/);
  assert.match(formatLastLocationStatus(staleLocation, staleStatus), /Stale（过期）/);
  assert.match(formatLastLocationStatus(staleLocation, refreshingStatus), /Refreshing（刷新中）/);
  assert.match(formatLastLocationStatus(staleLocation, errorStatus), /Error（错误）provider timeout/);

  const display = deriveEffectiveEnvironment(normalizeConfig({
    globalProfile: {
      geolocation: { enabled: true, mode: 'auto' },
      timezone: { enabled: true, mode: 'auto' }
    } as any
  }), staleLocation, staleStatus);
  assert.equal(display.geolocation.freshness, 'stale');
  assert.match(display.geolocation.detail, /Stale（过期）/);
});

test('freezeIpLocationToManualConfig copies latest IP location only on explicit request', () => {
  const config = normalizeConfig({
    globalProfile: {
      geolocation: { enabled: true, mode: 'auto', accuracy: 50, randomize: true },
      timezone: { enabled: true, mode: 'auto' }
    } as any
  });
  const frozen = freezeIpLocationToManualConfig(config, lastLocation);

  assert.ok(frozen);
  assert.equal(config.globalProfile.geolocation.mode, 'auto');
  assert.equal(frozen.globalProfile.geolocation.mode, 'manual');
  assert.equal(frozen.globalProfile.geolocation.latitude, 35.68);
  assert.equal(frozen.globalProfile.geolocation.longitude, 139.76);
  assert.equal(frozen.globalProfile.geolocation.randomize, true);
  assert.equal(frozen.globalProfile.timezone.mode, 'manual');
  assert.equal(frozen.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(freezeIpLocationToManualConfig(config, { ...lastLocation, timezone: null }), null);
});
