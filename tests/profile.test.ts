import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeProfiles, getTimezoneOffsetMinutes } from '../src/shared/config-model';
import { validateConfig } from '../src/shared/config-resolver';
import { validateProfile, applyProfileToConfig, createCustomProfile } from '../src/shared/profile';
import type { Profile } from '../src/shared/types';

function validProfile(): Profile {
  return { id: 'synthetic', name: '中文方案',
    geolocation: { latitude: 0, longitude: 0, accuracy: 50 },
    language: { language: 'en-US', languages: ['en-US'] },
    timezone: { timezone: 'UTC' } };
}

test('Profile 校验与有效配置共用范围、accuracy、时区、名称和 ID 合同', () => {
  for (const [latitude, longitude] of [[0, 0], [0, 120], [-30, 0], [-90, -180], [90, 180]]) {
    const profile = validProfile();
    Object.assign(profile.geolocation, { latitude, longitude });
    assert.equal(validateProfile(profile), true);
    assert.equal(validateConfig({ ...normalizeConfig({ rules: [] }), profile: { activeProfileId: profile.id, profiles: [profile] } }).ok, true);
    assert.equal(normalizeProfiles([profile]).length, 1);
  }
  const cases: Array<[string, (profile: Profile) => void]> = [
    ['latitude', (p) => { p.geolocation.latitude = 90.01; }],
    ['latitude', (p) => { p.geolocation.latitude = -90.01; }],
    ['longitude', (p) => { p.geolocation.longitude = 180.01; }],
    ['longitude', (p) => { p.geolocation.longitude = -180.01; }],
    ['latitude', (p) => { p.geolocation.latitude = null as any; }],
    ['longitude', (p) => { p.geolocation.longitude = undefined as any; }],
    ['accuracy', (p) => { p.geolocation.accuracy = 0; }],
    ['accuracy', (p) => { p.geolocation.accuracy = -1; }],
    ['accuracy', (p) => { p.geolocation.accuracy = Infinity; }],
    ['timezone', (p) => { p.timezone.timezone = 'Mars/Base'; }],
    ['timezone', (p) => { p.timezone.timezone = '+08:00'; }],
    ['name', (p) => { p.name = '  '; }],
    ['id', (p) => { p.id = ''; }]
  ];
  for (const [field, change] of cases) {
    const profile = validProfile(); change(profile);
    assert.equal(validateProfile(profile), false, field);
    assert.deepEqual(normalizeProfiles([profile]), [], field);
    const result = validateConfig({ ...normalizeConfig({ rules: [] }), profile: { activeProfileId: profile.id, profiles: [profile] } });
    assert.equal(result.ok, false, field);
    assert.match(result.errors.join(' | '), new RegExp(field));
    assert.equal(result.config, undefined);
  }
});

test('中文、emoji 和同名方案创建唯一 UUID，缺失坐标或非法 accuracy 不被修复', () => {
  const config = normalizeConfig({ rules: [], globalProfile: {
    language: { enabled: true, mode: 'preset', language: 'en-US', languages: ['en-US'] },
    timezone: { enabled: true, mode: 'manual', timezone: 'UTC' },
    geolocation: { ...normalizeConfig({}).globalProfile.geolocation, mode: 'manual', latitude: 0, longitude: 0 }
  } });
  const profiles = ['中文名称', '中文名称', '🌏方案'].map((name) => createCustomProfile(config, name));
  assert.equal(new Set(profiles.map((p) => p.id)).size, 3);
  profiles.forEach((p) => assert.match(p.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i));
  assert.deepEqual(profiles.map((p) => p.name), ['中文名称', '中文名称', '🌏方案']);
  profiles.forEach((profile) => assert.equal('acceptLanguage' in profile.language, false));
  assert.deepEqual(config.profile.profiles, []);
  config.globalProfile.geolocation.latitude = null;
  assert.throws(() => createCustomProfile(config, '缺坐标'), /latitude/);
  config.globalProfile.geolocation.latitude = 0;
  config.globalProfile.geolocation.accuracy = 0;
  assert.throws(() => createCustomProfile(config, '无效精度'), /accuracy/);
});

test('Profile 名称可重复但 trim 后 ID 不可重复，非法列表条目明确拒绝', () => {
  const first = validProfile();
  const second = { ...validProfile(), id: 'another' };
  assert.equal(validateConfig({ ...normalizeConfig({ rules: [] }), profile: { activeProfileId: null, profiles: [first, second] } }).ok, true);
  second.id = ' synthetic ';
  const duplicate = validateConfig({ ...normalizeConfig({ rules: [] }), profile: { activeProfileId: first.id, profiles: [first, second] } });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join(' | '), /ID.*重复/);
  assert.equal(duplicate.config, undefined);
  for (const profiles of [[null], [42], [first, {}], {}, 'bad']) {
    const input = { ...normalizeConfig({ rules: [] }), profile: { activeProfileId: null, profiles } };
    assert.equal(validateConfig(input).ok, false);
  }
});

test('非法存量方案不被应用，合法零坐标方案 ID 在归一化和应用后保持', () => {
  const profile = validProfile();
  const config = normalizeConfig({ intlMode: 'compatible',
    fontExposure: { enabled: true, mode: 'custom', blockedFamilies: ['My Font'], canvasSpoof: { enabled: false, platform: 'macos' } },
    profile: { activeProfileId: profile.id, profiles: [profile] } });
  const applied = applyProfileToConfig(config, profile.id);
  assert.equal(applied.globalProfile.geolocation.mode, 'manual');
  assert.equal(applied.globalProfile.geolocation.latitude, 0);
  assert.equal(applied.profile.activeProfileId, profile.id);
  assert.equal(applied.intlMode, 'compatible');
  assert.deepEqual(applied.fontExposure, config.fontExposure);
  assert.equal('acceptLanguage' in applied.globalProfile.language, false);
  assert.deepEqual(normalizeConfig(applied), applied);
  profile.timezone.timezone = 'Mars/Base';
  const invalid = { ...config, profile: { activeProfileId: profile.id, profiles: [profile] } };
  const rejected = applyProfileToConfig(invalid, profile.id);
  assert.equal(rejected.profile.activeProfileId, null);
  assert.deepEqual(rejected.profile.profiles, []);
});

test('目标时区偏移包含 DST 切换、半小时、跨年与 epoch，非法时区返回 null', () => {
  const cases: Array<[string, string | number, number]> = [
    ['UTC', '2026-01-01T00:00:00Z', 0],
    ['Asia/Shanghai', '2026-01-01T00:00:00Z', -480],
    ['Asia/Kolkata', '2026-01-01T00:00:00Z', -330],
    ['America/New_York', '2026-03-08T06:59:59Z', 300],
    ['America/New_York', '2026-03-08T07:00:00Z', 240],
    ['America/New_York', '2026-11-01T05:59:59Z', 240],
    ['America/New_York', '2026-11-01T06:00:00Z', 300],
    ['America/New_York', 0, 300]
  ];
  for (const [timezone, date, offset] of cases) assert.equal(getTimezoneOffsetMinutes(timezone, date), offset);
  assert.equal(getTimezoneOffsetMinutes('Mars/Base'), null);
  assert.equal(getTimezoneOffsetMinutes('UTC', 'invalid'), null);
});
