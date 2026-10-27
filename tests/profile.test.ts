import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILES, applyProfileToConfig, validateProfile } from '../src/shared/profile';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';

const valid = DEFAULT_PROFILES[0];

test('validateProfile 覆盖 id / name / 坐标 / 精度 / 语言 / 时区每一道门', () => {
  assert.equal(validateProfile(valid), true);
  assert.equal(validateProfile({ ...valid, id: ' ' }), false);
  assert.equal(validateProfile({ ...valid, name: '' }), false);
  assert.equal(validateProfile({ ...valid, geolocation: undefined }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, latitude: 91 } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, latitude: -91 } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, latitude: Number.NaN } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, longitude: 181 } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, longitude: -181 } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, accuracy: 0 } }), false);
  assert.equal(validateProfile({ ...valid, geolocation: { ...valid.geolocation, accuracy: Number.NaN } }), false);
  assert.equal(validateProfile({ ...valid, language: undefined }), false);
  assert.equal(validateProfile({ ...valid, language: { ...valid.language, language: '' } }), false);
  assert.equal(validateProfile({ ...valid, language: { ...valid.language, languages: 'en' as any } }), false);
  assert.equal(validateProfile({ ...valid, timezone: undefined }), false);
  assert.equal(validateProfile({ ...valid, timezone: { timezone: 'Not/AZone' } }), false);
});

test('applyProfileToConfig 应用内置 profile，并保留语言/时区/定位的 enabled 开关', () => {
  const base = normalizeConfig({
    ...DEFAULT_CONFIG,
    masterEnabled: true,
    globalProfile: {
      ...DEFAULT_CONFIG.globalProfile,
      language: { ...DEFAULT_CONFIG.globalProfile.language, enabled: false },
      timezone: { ...DEFAULT_CONFIG.globalProfile.timezone, enabled: false },
      geolocation: { ...DEFAULT_CONFIG.globalProfile.geolocation, enabled: false }
    }
  });
  const applied = applyProfileToConfig(base, 'japan');
  assert.equal(applied.profile.activeProfileId, 'japan');
  assert.equal(applied.globalProfile.language.language, 'ja-JP');
  assert.equal(applied.globalProfile.language.enabled, true);
  assert.equal(applied.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(applied.globalProfile.timezone.enabled, false);
  assert.equal(applied.globalProfile.geolocation.latitude, 35.6895);
  assert.equal(applied.globalProfile.geolocation.enabled, false);
  assert.equal(applied.globalProfile.geolocation.mode, 'manual');
});

test('applyProfileToConfig 未知 profile 原样返回，自定义 profile 的 country 回退到 name', () => {
  const base = normalizeConfig(DEFAULT_CONFIG);
  const unknown = applyProfileToConfig(base, 'missing');
  assert.deepEqual(unknown, base);

  const custom = {
    ...valid,
    id: 'custom',
    name: 'Custom Name',
    geolocation: { ...valid.geolocation, country: '' }
  };
  const withCustom = normalizeConfig({ ...base, profile: { ...base.profile, profiles: [custom] } });
  const applied = applyProfileToConfig(withCustom, 'custom');
  assert.equal(applied.globalProfile.geolocation.country, 'Custom Name');
});
