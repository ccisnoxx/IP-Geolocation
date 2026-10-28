import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFontFamilies, PLATFORM_FONTS, CJK_VENDOR_FONTS } from '../src/shared/font-layers';
import { createInitialConfig, createRule, normalizeConfig, SITE_CONFIG_KEY } from '../src/shared/config-model';
import { validateConfig, migrateLegacyConfig, getLanguageTimezonePayload, getFontExposurePayload } from '../src/shared/config-resolver';
import { compileFontPolicyScripts } from '../src/background/page-scripts';

test('三层字体使用真实平台，平台/CJK/手动独立并集，未知平台不猜测', () => {
  const config = createInitialConfig().fontExposure;
  config.enabled = true; config.blockedFamilies = ['My Family', 'my family'];
  const platformOnly = { ...config, layers: { platform: 'auto' as const, hideCjkFonts: false } };
  const families = resolveFontFamilies(platformOnly, { userAgentData: { platform: 'macOS' }, platform: 'Win32' });
  assert.ok(PLATFORM_FONTS.windows.every(font => families.includes(font)));
  assert.ok(PLATFORM_FONTS.linux.every(font => families.includes(font)));
  assert.equal(families.includes('Helvetica Neue'), false);
  assert.deepEqual(resolveFontFamilies(platformOnly, {}), ['My Family']);
  const cjk = resolveFontFamilies({ ...config, layers: { platform: 'none', hideCjkFonts: true } }, { platform: 'MacIntel' });
  assert.ok(CJK_VENDOR_FONTS.every(font => cjk.includes(font)));
  assert.equal(cjk.includes('Segoe UI'), false);
  assert.deepEqual(resolveFontFamilies({ ...config, enabled: false }, {}), []);
});

test('schema 4 release 输入单独校验并迁到5，不从历史声明创建verified身份', () => {
  const current = createInitialConfig();
  const { fontExposure: _font, intlMode: _intl, exitLocationProfiles: _exits, ...base } = current;
  const release = { ...base, schemaVersion: 4, canvas: { enabled: true, spoofFonts: true, platform: 'none', hideCjkFonts: false, targetFonts: ['My Family'] },
    rules: [{ ...createRule('example.test'), exitLocationProfileId: undefined }] };
  const result = validateConfig(release);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.config.schemaVersion, 5);
  assert.deepEqual(result.config.fontExposure, { enabled: true, mode: 'layered', layers: { platform: 'none', hideCjkFonts: false },
    blockedFamilies: ['My Family'], canvasSpoof: { enabled: false, platform: 'macos' } });
  assert.equal(result.config.rules[0].exitLocationProfileId, null);
  assert.deepEqual(result.config.exitLocationProfiles, []);
  assert.equal(validateConfig({ ...release, canvas: { ...release.canvas, hideCjkFonts: 'false' } }).ok, false);
  assert.equal(validateConfig({ ...release, canvas: { ...release.canvas, platform: 'windows' } }).ok, false);
  const migrated = migrateLegacyConfig({ [SITE_CONFIG_KEY]: release, lastLocation: { latitude: 12, longitude: 23, country: 'Synthetic', timezone: 'UTC' } });
  assert.equal(migrated.exitLocationProfiles[0].verification, 'unverified');
  assert.equal(migrated.exitLocationProfiles[0].publicIp, null);
  assert.deepEqual(migrateLegacyConfig({ [SITE_CONFIG_KEY]: migrated }), migrated);
});

test('字体可独立于语言时区启用，沿用域名排除和安全JSON，页面与Worker派生同一策略', () => {
  const config = normalizeConfig({ ...createInitialConfig(), masterEnabled: true, rules: [createRule('example.test'), { ...createRule('sub.example.test'), enabled: false }] });
  config.fontExposure.enabled = true;
  config.fontExposure.blockedFamilies = ['</script>\u2028family'];
  const policy = getFontExposurePayload(config, 'example.test');
  assert.ok(policy);
  assert.deepEqual(getLanguageTimezonePayload(config, 'example.test')?.fontPolicy, policy);
  const scripts = compileFontPolicyScripts(config, 'function filter() {}');
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].excludeMatches, ['*://*.sub.example.test/*', '*://sub.example.test/*']);
  assert.equal(scripts[0].allFrames, true);
  assert.doesNotMatch(JSON.stringify(scripts[0].js), /<\/script>/);
  config.rules[0].compatibilityPreset = 'consistency';
  assert.equal(getFontExposurePayload(config, 'example.test'), null);
  assert.equal(getLanguageTimezonePayload(config, 'example.test'), null);
});
