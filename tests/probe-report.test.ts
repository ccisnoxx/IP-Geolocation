import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import { buildProbeReport, offsetMinutesAt, type ProbeSnapshot } from '../src/shared/probe-report';
import type { SiteSpoofConfig } from '../src/shared/types';

/**
 * 诊断页「站点实测」的判定：期望值按站点从配置解析，不在规则里时期望就是原生值。
 */

const NATIVE = { timezone: 'Asia/Shanghai', language: 'zh-CN', languages: ['zh-CN', 'zh'] };
const AT = new Date('2026-01-15T12:00:00Z');

const tokyo = (patch: Record<string, unknown> = {}): SiteSpoofConfig => normalizeConfig({
  ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  masterEnabled: true,
  globalProfile: {
    ...JSON.parse(JSON.stringify(DEFAULT_CONFIG.globalProfile)),
    language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
    timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
    geolocation: {
      ...JSON.parse(JSON.stringify(DEFAULT_CONFIG.globalProfile.geolocation)),
      enabled: true, mode: 'manual', latitude: 35.68, longitude: 139.69, randomize: false
    }
  },
  rules: [{ id: 'r1', domain: 'example.com', enabled: true }, { id: 'r2', domain: 'mail.example.com', enabled: false }],
  ...patch
} as any);

const probe = (patch: Partial<ProbeSnapshot> = {}): ProbeSnapshot => ({
  timezone: 'Asia/Tokyo',
  offsetMinutes: -540,
  temporalTimeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
  language: 'ja-JP',
  languages: ['ja-JP', 'ja'],
  geolocation: { permission: 'granted', coords: { latitude: 35.68, longitude: 139.69, accuracy: 20 }, error: null },
  webrtc: { candidates: [], error: null },
  checks: [],
  ...patch
});

const status = (report: ReturnType<typeof buildProbeReport>, label: string) =>
  report.rows.find((row) => row.label === label)?.status;

test('规则内站点：全部与期望一致', () => {
  const report = buildProbeReport(tokyo(), 'https://www.example.com/a', null, NATIVE, probe(), AT);
  assert.equal(report.spoofed, true);
  assert.match(report.scope, /命中规则 example\.com/);
  assert.equal(report.failed, 0, JSON.stringify(report.rows.filter((row) => row.status === 'bad')));
  assert.equal(status(report, 'Intl 时区'), 'ok');
  assert.equal(status(report, 'Date 偏移（getTimezoneOffset）'), 'ok');
  assert.equal(status(report, 'Temporal.Now.timeZoneId()'), 'ok');
  assert.equal(status(report, '坐标'), 'ok');
});

test('规则内站点读到原生值：逐项标出不一致', () => {
  const leaked = probe({ timezone: 'Asia/Shanghai', offsetMinutes: -480, temporalTimeZone: 'Asia/Shanghai', language: 'zh-CN', languages: ['zh-CN'], locale: 'zh-CN' });
  const report = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE, leaked, AT);
  for (const label of ['Intl 时区', 'Date 偏移（getTimezoneOffset）', 'Temporal.Now.timeZoneId()', 'navigator.language', 'navigator.languages', 'Intl 默认 locale']) {
    assert.equal(status(report, label), 'bad', label);
  }
  assert.ok(report.failed >= 6);
});

test('不在规则内、被排除、总开关关闭：期望就是原生值', () => {
  const native = probe({ timezone: 'Asia/Shanghai', offsetMinutes: -480, temporalTimeZone: 'Asia/Shanghai', language: 'zh-CN', languages: ['zh-CN', 'zh'], locale: 'zh-CN' });
  const outside = buildProbeReport(tokyo(), 'https://other.org/', null, NATIVE, native, AT);
  assert.equal(outside.spoofed, false);
  assert.match(outside.scope, /不在规则里/);
  assert.equal(outside.failed, 0);

  const excluded = buildProbeReport(tokyo(), 'https://mail.example.com/', null, NATIVE, native, AT);
  assert.match(excluded.scope, /排除/);
  assert.equal(excluded.failed, 0);

  const off = buildProbeReport(tokyo({ masterEnabled: false }), 'https://example.com/', null, NATIVE, native, AT);
  assert.match(off.scope, /总开关已关闭/);
  assert.equal(off.failed, 0);

  // 反过来：不在规则里却被伪装了，同样是不一致
  assert.equal(status(buildProbeReport(tokyo(), 'https://other.org/', null, NATIVE, probe(), AT), 'Intl 时区'), 'bad');
});

test('auto 时区还没取得出口位置：期望保持原生时区', () => {
  const config = tokyo();
  config.globalProfile.timezone = { enabled: true, mode: 'auto', timezone: '' };
  config.globalProfile.geolocation.enabled = false;
  const report = buildProbeReport(config, 'https://example.com/', null, NATIVE,
    probe({ timezone: 'Asia/Shanghai', offsetMinutes: -480, temporalTimeZone: 'Asia/Shanghai' }), AT);
  assert.equal(status(report, 'Intl 时区'), 'ok');
  assert.match(report.rows.find((row) => row.label === 'Intl 时区')!.expected, /保持原生/);
});

test('定位：未授权时跳过、不判失败；随机偏移按容差判定；解析失败时期望拒绝', () => {
  const skipped = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE,
    probe({ geolocation: { permission: 'prompt', coords: null, error: null } }), AT);
  assert.equal(status(skipped, '坐标'), 'skip');
  assert.equal(skipped.failed, 0);

  const config = tokyo();
  config.globalProfile.geolocation.randomize = true;
  config.globalProfile.geolocation.randomRadiusMeters = 500;
  const near = buildProbeReport(config, 'https://example.com/', null, NATIVE,
    probe({ geolocation: { permission: 'granted', coords: { latitude: 35.685, longitude: 139.695, accuracy: 600 }, error: null } }), AT);
  assert.equal(status(near, '坐标'), 'ok', '700 米内的随机偏移');
  const far = buildProbeReport(config, 'https://example.com/', null, NATIVE,
    probe({ geolocation: { permission: 'granted', coords: { latitude: 31.23, longitude: 121.47, accuracy: 20 }, error: null } }), AT);
  assert.equal(status(far, '坐标'), 'bad', '上海的真实坐标');

  const auto = tokyo();
  auto.globalProfile.geolocation.mode = 'auto';
  const denied = buildProbeReport(auto, 'https://example.com/', null, NATIVE,
    probe({ geolocation: { permission: 'granted', coords: null, error: '错误：Position unavailable' } }), AT);
  assert.equal(status(denied, 'getCurrentPosition'), 'ok', '没有出口位置时应当拒绝，而不是给出真实坐标');
});

test('字体检查只在字体伪装开启时参与判定；其它检查照常', () => {
  const checks: ProbeSnapshot['checks'] = [
    { group: '字体', label: 'canvas 探测不到被隐藏的中文字体', value: 'PingFang SC', ok: false },
    { group: '反检测', label: 'navigator.languages 是冻结数组', value: 'true', ok: true }
  ];
  const off = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE, probe({ checks }), AT);
  assert.equal(off.rows.some((row) => row.group === '字体'), false);
  assert.equal(status(off, 'navigator.languages 是冻结数组'), 'ok');

  const on = buildProbeReport(tokyo({ canvas: { ...DEFAULT_CONFIG.canvas, enabled: true } }), 'https://example.com/', null, NATIVE, probe({ checks }), AT);
  assert.equal(status(on, 'canvas 探测不到被隐藏的中文字体'), 'bad');
});

test('offsetMinutesAt 与 getTimezoneOffset 同号：东京 -540，纽约冬季 300，加德满都 -345', () => {
  assert.equal(offsetMinutesAt('Asia/Tokyo', AT), -540);
  assert.equal(offsetMinutesAt('America/New_York', AT), 300);
  assert.equal(offsetMinutesAt('Asia/Kathmandu', AT), -345);
  assert.equal(offsetMinutesAt('Not/AZone', AT), null);
});

test('WebRTC：网页里没有候选或只有 .local 匿名地址算通过，出现字面 IP 算暴露', () => {
  const label = 'ICE 候选（网页可见的本机地址）';
  const none = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE, probe(), AT);
  assert.equal(status(none, label), 'ok');
  const mdns = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE,
    probe({ webrtc: { candidates: ['48c8988c-a6e5-445d-99b4-df6f092ca857.local'], error: null } }), AT);
  assert.equal(status(mdns, label), 'ok');
  for (const address of ['10.0.0.111', '2001:db8::1']) {
    const leaked = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE,
      probe({ webrtc: { candidates: [address], error: null } }), AT);
    assert.equal(status(leaked, label), 'bad', address);
  }
  const missing = buildProbeReport(tokyo(), 'https://example.com/', null, NATIVE, probe({ webrtc: null }), AT);
  assert.equal(missing.rows.some((row) => row.label === label), false, '浏览器不支持 RTCPeerConnection 时不出这一行');
});
