import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_PRESETS, applyEnvironmentPreset, exitProfileSignals, findEnvironmentPreset, presetCardInfo, presetSignals } from '../src/shared/environment-presets';
import { createRule, normalizeConfig } from '../src/shared/config-model';
import { getConfigInputErrors } from '../src/shared/config-validation';

const base = () => normalizeConfig({
  masterEnabled: true,
  globalProfile: {
    language: { enabled: false, mode: 'custom', language: '', languages: [] },
    timezone: { enabled: false, mode: 'manual', timezone: '' },
    geolocation: { enabled: false, mode: 'manual', latitude: null, longitude: null, accuracy: 50, country: '' }
  } as any,
  rules: [createRule('example.com')]
});

test('只有新加坡、东京、洛杉矶三个预设，坐标/语言/时区自洽', () => {
  assert.deepEqual(ENVIRONMENT_PRESETS.map(preset => preset.id), ['singapore', 'japan-tokyo', 'us-los-angeles']);
  const byId = Object.fromEntries(ENVIRONMENT_PRESETS.map(preset => [preset.id, preset]));
  assert.equal(byId['singapore'].timezone, 'Asia/Singapore');
  assert.equal(byId['japan-tokyo'].timezone, 'Asia/Tokyo');
  assert.equal(byId['us-los-angeles'].timezone, 'America/Los_Angeles');
  assert.deepEqual([byId['us-los-angeles'].latitude, byId['us-los-angeles'].longitude], [34.0522, -118.2437]);
  for (const preset of ENVIRONMENT_PRESETS) {
    assert.ok(preset.latitude > -90 && preset.latitude < 90 && preset.longitude > -180 && preset.longitude < 180, preset.id);
    assert.equal(preset.languages[0], preset.language, preset.id);
    assert.match(preset.language, /^[a-z]{2}-[A-Z]{2}$/);
  }
});

test('应用预设只改全局三信号，规则/出口档案/WebRTC/字体一律保留', () => {
  const config = base();
  config.exitLocationProfiles = [{ id: 'exit-home', label: '家', latitude: 1, longitude: 2, timezone: 'Asia/Tokyo', language: 'ja-JP', verifiedAt: 1, source: 'detected' } as any];
  config.fontExposure.enabled = true;
  const next = applyEnvironmentPreset(config, findEnvironmentPreset('japan-tokyo')!);
  assert.equal(next.globalProfile.language.language, 'ja-JP');
  assert.deepEqual(next.globalProfile.language.languages, ['ja-JP', 'ja', 'en-US', 'en']);
  assert.equal(next.globalProfile.language.mode, 'custom');
  assert.equal(next.globalProfile.language.enabled, true);
  assert.equal(next.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(next.globalProfile.timezone.mode, 'manual');
  assert.deepEqual([next.globalProfile.geolocation.latitude, next.globalProfile.geolocation.longitude], [35.6762, 139.6503]);
  assert.equal(next.globalProfile.geolocation.country, 'Japan');
  assert.deepEqual(next.rules, config.rules);
  assert.deepEqual(next.exitLocationProfiles, config.exitLocationProfiles);
  assert.deepEqual(next.webRtc, config.webRtc);
  assert.deepEqual(next.fontExposure, config.fontExposure);
  // 原对象不被就地修改
  assert.equal(config.globalProfile.timezone.timezone, '');
});

test('预设结果仍能通过配置校验，并可作为全局信号解析', () => {
  const next = applyEnvironmentPreset(base(), findEnvironmentPreset('us-los-angeles')!);
  assert.deepEqual(getConfigInputErrors(next), []);
  const reloaded = normalizeConfig(JSON.parse(JSON.stringify(next)));
  assert.equal(reloaded.globalProfile.timezone.timezone, 'America/Los_Angeles');
  assert.equal(reloaded.globalProfile.language.language, 'en-US');
  assert.equal(findEnvironmentPreset('nowhere'), null);
});

// 布局约束：快速设置是独立区块（含旗帜卡片 + 出口档案），不能塞进时区/地理位置的折叠组里。
test('快速设置是独立区块，且含旗帜卡片与"从 IP 自动配置"出口档案入口', async () => {
  const fs = await import('node:fs/promises');
  const popupHtml = await fs.readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
  const optionsHtml = await fs.readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');

  for (const [page, html] of [['popup', popupHtml], ['options', optionsHtml]] as const) {
    assert.match(html, /id="quickSetGroup"|id="quickSet"/, `${page} 需要独立容器`);
    assert.match(html, /从 IP 自动配置/, `${page} 需要出口档案入口`);
    const cards = [...html.matchAll(/data-preset="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(cards, ['singapore', 'japan-tokyo', 'us-los-angeles'], `${page} 卡片必须是这三个预设`);
    // 卡片副标题带旗帜
    assert.match(html, /🇸🇬 Asia\/Singapore/, `${page} 新加坡卡片缺旗帜`);
    assert.match(html, /🇯🇵 Asia\/Tokyo/, `${page} 东京卡片缺旗帜`);
    assert.match(html, /🇺🇸 America\/Los_Angeles/, `${page} 洛杉矶卡片缺旗帜`);
    // 快速设置必须在任何一个单信号分组之前
    const quick = html.indexOf('快速设置');
    for (const group of ['地理位置', '时区', '语言']) {
      const at = html.indexOf(`<summary>${group}</summary>`) >= 0 ? html.indexOf(`<summary>${group}</summary>`) : html.indexOf(`data-tab="${group === '地理位置' ? 'geolocation' : group === '时区' ? 'timezone' : 'language'}"`);
      if (at !== -1) assert.ok(quick < at, `${page} 的快速设置必须排在${group}之前`);
    }
  }
  // options：快速设置 section 不能在 tab-content 里
  const sectionStart = optionsHtml.indexOf('id="quickSet"');
  const before = optionsHtml.slice(0, sectionStart);
  assert.ok(before.lastIndexOf('data-tab=') < before.lastIndexOf('</section>'), '快速设置不能嵌在标签页内容里');
  assert.deepEqual([...optionsHtml.matchAll(/id="environmentPreset"/g)].length, 1, '出口档案控件只能有一份');
});

test('出口档案推导信号只认 verified，语言取不到就保留现值', () => {
  const verified = { id: 'exit-1', name: 'LA', verification: 'verified', publicIp: '192.0.2.1',
    latitude: 34.0522, longitude: -118.2437, country: 'United States', countryCode: 'US',
    timezone: 'America/Los_Angeles', provider: null, verifiedAt: 1 } as any;
  const signals = exitProfileSignals(verified, { language: 'zh-CN', languages: ['zh-CN', 'zh'] });
  assert.ok(signals);
  assert.deepEqual([signals!.latitude, signals!.longitude], [34.0522, -118.2437]);
  assert.equal(signals!.timezone, 'America/Los_Angeles');
  assert.equal(signals!.language, 'en-US');
  assert.deepEqual(signals!.languages, ['en-US', 'en']);

  // 未确认档案一律拒绝
  assert.equal(exitProfileSignals({ ...verified, verification: 'unverified' } as any, { language: 'zh-CN', languages: ['zh-CN'] }), null);
  // 未知国家代码：保留现有语言，但坐标与时区仍可应用
  const unknown = exitProfileSignals({ ...verified, countryCode: null } as any, { language: 'zh-CN', languages: ['zh-CN', 'zh'] });
  assert.equal(unknown!.language, 'zh-CN');
  assert.deepEqual(unknown!.languages, ['zh-CN', 'zh']);
  // 预设信号与卡片文案一致
  const preset = ENVIRONMENT_PRESETS[2];
  assert.equal(presetCardInfo(preset), '🇺🇸 America/Los_Angeles');
  assert.deepEqual(presetSignals(preset).languages, preset.languages);
});
