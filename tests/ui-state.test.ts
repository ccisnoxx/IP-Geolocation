// 验证 Popup 当前站点状态只依赖共享解析器产生的匹配结果和有效 payload。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { normalizeConfig } from '../src/shared/config-model';
import { deriveCurrentSiteStatus } from '../src/shared/ui-state';

function createConfig() {
  return normalizeConfig({
    masterEnabled: true,
    globalProfile: {
      language: { enabled: false },
      timezone: { enabled: true, mode: 'auto' },
      geolocation: { enabled: true, mode: 'auto' }
    } as any,
    exitLocationProfiles: [{
      id: 'exit-home',
      name: '家宽出口',
      verification: 'verified',
      publicIp: '203.0.113.10',
      latitude: 35.68,
      longitude: 139.76,
      country: 'Japan',
      timezone: 'Asia/Tokyo',
      provider: 'https://ipwho.is/',
      verifiedAt: 1_752_551_200_000
    }],
    rules: [{
      id: 'rule-example',
      domain: 'example.com',
      enabled: true,
      exitLocationProfileId: 'exit-home'
    }] as any
  });
}

test('deriveCurrentSiteStatus differentiates unsupported, disabled, unmatched, enabled, and error states', () => {
  const config = createConfig();
  const resolved = getEffectiveProfile(config, 'example.com');
  const base = {
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved
  };

  assert.equal(deriveCurrentSiteStatus({ ...base, scriptable: false }).kind, 'unsupported');
  assert.equal(deriveCurrentSiteStatus({
    ...base,
    config: normalizeConfig({ ...config, masterEnabled: false })
  }).kind, 'global-disabled');
  assert.equal(deriveCurrentSiteStatus({
    ...base,
    matched: false,
    rule: null,
    payload: null,
    errors: []
  }).kind, 'not-allowlisted');
  assert.equal(deriveCurrentSiteStatus(base).kind, 'enabled');
  assert.equal(deriveCurrentSiteStatus(base).disableDomain, 'example.com');
});

test('an automatic rule without an explicit exit profile is surfaced as a configuration error', () => {
  const config = createConfig();
  config.rules[0].exitLocationProfileId = null;
  const resolved = getEffectiveProfile(config, 'example.com');
  const status = deriveCurrentSiteStatus({
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved
  });

  assert.equal(status.kind, 'error');
  assert.match(status.detail, /未选择出口位置档案/);
  assert.equal(status.canDisable, true);
});

test('an unverified selected profile cannot produce an enabled runtime state', () => {
  const config = createConfig();
  config.exitLocationProfiles[0].verification = 'unverified';
  config.exitLocationProfiles[0].publicIp = null;
  config.exitLocationProfiles[0].provider = null;
  config.exitLocationProfiles[0].verifiedAt = null;
  const resolved = getEffectiveProfile(config, 'example.com');
  const status = deriveCurrentSiteStatus({
    domain: 'example.com',
    scriptable: true,
    config,
    ...resolved
  });

  assert.equal(status.kind, 'error');
  assert.match(status.detail, /尚未验证/);
});
