import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { normalizeConfig } from '../src/shared/config-model';
import { describeSiteStatus } from '../src/shared/site-status';
import { resolveCanvasTargetFonts } from '../src/shared/font-aliases';

/**
 * payload gate：只要有一层能生效就必须产出 payload。
 *
 * 之前的判定只认「语言 or 时区」，于是 geo-only / canvas-only 的配置拿到 payload=null，
 * 页面既不换定位也不换字体 —— 用户看到的只是"扩展装上了但什么都没发生"。
 */
function build(overrides: any = {}) {
  return normalizeConfig({
    masterEnabled: true,
    debugMode: false,
    rules: [{ domain: 'example.com', enabled: true }],
    globalProfile: {
      language: { enabled: false, mode: 'custom', language: '', languages: [], acceptLanguage: '' },
      timezone: { enabled: false, mode: 'auto', timezone: '' },
      geolocation: { enabled: false, mode: 'auto', latitude: null, longitude: null, accuracy: 100 },
      ...(overrides.globalProfile || {})
    },
    canvas: { enabled: false, ...(overrides.canvas || {}) },
    ...(overrides.rules ? { rules: overrides.rules } : {})
  } as any);
}

test('只有定位时也要产出 payload', () => {
  const config = build({
    globalProfile: {
      geolocation: { enabled: true, mode: 'manual', latitude: 35.6762, longitude: 139.6503, accuracy: 30 }
    }
  });

  const resolved = getEffectiveProfile(config, 'example.com', null);
  assert.ok(resolved.payload, 'geo-only 必须有 payload');
  assert.equal(resolved.matched, true);
  assert.equal(resolved.payload!.geolocation!.latitude, 35.6762);
  assert.equal(resolved.payload!.timezone, null, '时区没启用就不该被顺手打开');
  assert.ok(!resolved.payload!.languageConfig, '语言没启用时 languageConfig 为空');
  assert.equal(resolved.payload!.canvasConfig!.enabled, false);
});

test('只有 canvas 时也要产出 payload', () => {
  const config = build({ canvas: { enabled: true, spoofFonts: true, targetFonts: ['Helvetica'] } });

  const resolved = getEffectiveProfile(config, 'example.com', null);
  assert.ok(resolved.payload, 'canvas-only 必须有 payload');
  const canvas = resolved.payload!.canvasConfig!;
  assert.equal(canvas.enabled, true);
  // payload 带三层原始字段，解析放在注入层（避免 background 引用 font-aliases 后
  // 把注入脚本打成 chunk）
  assert.equal(canvas.platform, 'auto');
  assert.equal(canvas.hideCjkFonts, true);
  assert.deepEqual(canvas.targetFonts, ['Helvetica']);
  assert.equal(resolved.payload!.geolocation, null);
  assert.equal(resolved.payload!.timezone, null);
});

test('payload 的字体字段跟着 platform 变，而不是只有一张固定表', () => {
  const windowsClaim = build({ canvas: { enabled: true, platform: 'windows', hideCjkFonts: false } });
  const macClaim = build({ canvas: { enabled: true, platform: 'mac', hideCjkFonts: false } });

  assert.equal(getEffectiveProfile(windowsClaim, 'example.com', null).payload!.canvasConfig!.platform, 'windows');
  assert.equal(getEffectiveProfile(macClaim, 'example.com', null).payload!.canvasConfig!.platform, 'mac');

  // 注入层按这个字段展开成不同的隐藏列表
  const windowsFonts = resolveCanvasTargetFonts({ platform: 'windows', hideCjkFonts: false }, 'mac');
  const macFonts = resolveCanvasTargetFonts({ platform: 'mac', hideCjkFonts: false }, 'mac');
  assert.ok(windowsFonts.includes('PingFang SC'));
  assert.ok(!windowsFonts.includes('Microsoft YaHei'));
  assert.ok(macFonts.includes('Microsoft YaHei'));
  assert.ok(!macFonts.includes('PingFang SC'));
});

test('只有语言时照旧产出 payload', () => {
  const config = build({
    globalProfile: {
      language: { enabled: true, mode: 'custom', language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US,en;q=0.9' }
    }
  });

  const resolved = getEffectiveProfile(config, 'example.com', null);
  assert.ok(resolved.payload);
  assert.equal(resolved.payload!.languageConfig!.language, 'en-US');
});

test('什么都没开时才不给 payload', () => {
  const resolved = getEffectiveProfile(build(), 'example.com', null);
  assert.equal(resolved.matched, true, '站点仍在白名单里，只是没有可改写的东西');
  assert.equal(resolved.payload, null);
});

test('geo-only 的站点状态不再是 payload-missing', () => {
  const config = build({
    globalProfile: {
      geolocation: { enabled: true, mode: 'manual', latitude: 35.6762, longitude: 139.6503, accuracy: 30 }
    }
  });

  const status = describeSiteStatus(getEffectiveProfile(config, 'example.com', null));
  assert.equal(status.active, true);
  assert.notEqual(status.reason, 'payload-missing');

  // 对照：什么都没开时才是 payload-missing
  const idle = describeSiteStatus(getEffectiveProfile(build(), 'example.com', null));
  assert.equal(idle.reason, 'payload-missing');
});