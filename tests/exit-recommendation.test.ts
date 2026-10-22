// 纯推荐不建立配置/verified 事实；以下均为合成档案与 Node 证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeCountryCode } from '../src/shared/config-model';
import { recommendExitEnvironment } from '../src/shared/exit-recommendation';
import type { ExitLocationProfile } from '../src/shared/types';

const profile: ExitLocationProfile = {
  id: 'synthetic-exit', name: '合成出口', verification: 'verified', publicIp: '203.0.113.10',
  latitude: 0, longitude: 0, country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo',
  provider: 'https://ipwho.is/', verifiedAt: 1
};

test('推荐只计算候选，不修改输入、配置或发起隐式网络请求', () => {
  const originalChrome = (globalThis as any).chrome;
  const originalFetch = globalThis.fetch;
  (globalThis as any).chrome = new Proxy({}, { get() { throw new Error('推荐不可访问 Chrome'); } });
  globalThis.fetch = (() => { throw new Error('推荐不可访问网络'); }) as typeof fetch;
  try {
    const input = Object.freeze({ ...profile });
    const result = recommendExitEnvironment(input);
    assert.deepEqual(input, profile);
    assert.equal(result.profileId, profile.id);
    assert.equal(result.timezone.value, 'Asia/Tokyo');
    assert.equal(result.timezone.confidence, 'provider-reported');
    assert.match(result.timezone.reason, /单一服务声明，未交叉验证/);
    assert.deepEqual(result.language.value?.languages, ['ja-JP', 'ja']);
    assert.equal(result.fontExposure.value.mode, 'vendor-software');
    assert.equal(result.webRtc.value, 'compatible');
    result.language.value!.languages.push('synthetic');
    result.fontExposure.value.blockedFamilies.length = 0;
    const next = recommendExitEnvironment(input);
    assert.deepEqual(next.language.value?.languages, ['ja-JP', 'ja']);
    assert.ok(next.fontExposure.value.blockedFamilies.length > 0);
  } finally { (globalThis as any).chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('未知国家代码不根据国家名、坐标或时区猜测 locale；未维护地区不给候选', () => {
  for (const countryCode of [undefined, null, '', 'ZZ', 'XX', 'Japan', 'JPN']) {
    const result = recommendExitEnvironment({ ...profile, countryCode });
    assert.equal(result.countryCode, null);
    assert.equal(result.language.value, null);
    assert.equal(result.timezone.value, 'Asia/Tokyo');
  }
  assert.equal(recommendExitEnvironment({ ...profile, countryCode: 'AQ' }).language.value, null);
  assert.equal(normalizeCountryCode(' jp '), 'JP');
  assert.equal(normalizeCountryCode('AA'), null);
});

test('未验证档案与非法时区不产生可信候选；多语言地区仅明确给出常用示例', () => {
  const unverified = recommendExitEnvironment({ ...profile, verification: 'unverified' });
  assert.equal(unverified.verifiedAt, null);
  assert.equal(unverified.timezone.value, null);
  assert.equal(unverified.timezone.confidence, 'unknown');
  assert.equal(unverified.language.value, null);
  assert.equal(recommendExitEnvironment({ ...profile, timezone: 'Mars/Base' }).timezone.value, null);
  const singapore = recommendExitEnvironment({ ...profile, countryCode: 'SG', timezone: 'Asia/Singapore' });
  assert.equal(singapore.language.value?.language, 'en-SG');
  assert.match(singapore.language.reason, /不代表个人偏好，默认保留/);
});

test('countryCode 增量归一化兼容旧 verified 档案，不补造旧代码或改变 schema', () => {
  const { countryCode: _omitted, ...oldProfile } = profile;
  const old = normalizeConfig({ exitLocationProfiles: [oldProfile] });
  assert.equal(old.schemaVersion, 3);
  assert.deepEqual(old.exitLocationProfiles[0], oldProfile);
  const current = normalizeConfig({ exitLocationProfiles: [{ ...profile, countryCode: ' jp ' }] });
  assert.equal(current.exitLocationProfiles[0].countryCode, 'JP');
  assert.equal(current.exitLocationProfiles[0].verification, 'verified');
  assert.deepEqual(normalizeConfig(current), current);
});
