import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, parseGeoApiResponse } from '../src/background/services';

test('parseGeoApiResponse accepts ipwho.is shape', () => {
  const parsed = parseGeoApiResponse({
    success: true,
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: { id: 'Asia/Singapore', offset: 28800 }
  });

  assert.equal(parsed?.latitude, 1.3521);
  assert.equal(parsed?.longitude, 103.8198);
  assert.equal(parsed?.timezone, 'Asia/Singapore');
  assert.equal(parsed?.timezoneOffset, -480);
});

test('parseGeoApiResponse accepts ipapi location shape', () => {
  const parsed = parseGeoApiResponse({
    location: { latitude: 35.68, longitude: 139.76 },
    country: { name: 'Japan' },
    timezone: 'Asia/Tokyo'
  });

  assert.equal(parsed?.country, 'Japan');
  assert.equal(parsed?.timezone, 'Asia/Tokyo');
});

test('parseGeoApiResponse accepts ipinfo loc shape', () => {
  const parsed = parseGeoApiResponse({
    loc: '52.52,13.405',
    country: 'DE',
    timezone: 'Europe/Berlin'
  });

  assert.equal(parsed?.latitude, 52.52);
  assert.equal(parsed?.longitude, 13.405);
});

// ---------- 坐标的 0 值与范围 ----------

test('parseGeoApiResponse 接受 0 纬度 / 0 经度（赤道与本初子午线）', () => {
  const parsed = parseGeoApiResponse({ latitude: 0, longitude: 0, country: 'Gulf of Guinea' });
  assert.equal(parsed?.latitude, 0);
  assert.equal(parsed?.longitude, 0);
});

test('parseGeoApiResponse 接受 loc 里的 0 值', () => {
  const parsed = parseGeoApiResponse({ loc: '0,0', country: 'X' });
  assert.equal(parsed?.latitude, 0);
  assert.equal(parsed?.longitude, 0);
});

test('parseGeoApiResponse 拒绝越界与 NaN，而不是静默取整', () => {
  assert.equal(parseGeoApiResponse({ latitude: 91, longitude: 0 }), null);
  assert.equal(parseGeoApiResponse({ latitude: 0, longitude: 181 }), null);
  assert.equal(parseGeoApiResponse({ latitude: 'north', longitude: 0 }), null);
  assert.equal(parseGeoApiResponse({ latitude: null, longitude: null }), null);
});

test('只有国家没有坐标时返回 null（不再伪造 0,0）', () => {
  assert.equal(parseGeoApiResponse({ success: false, country: { code: 'CN' } }), null);
});

test('parseGeoApiResponse 不把布尔或数组坐标强转成真实地点', () => {
  for (const value of [false, true, [], [1], {}]) {
    assert.equal(parseGeoApiResponse({ latitude: value, longitude: 0 }), null);
    assert.equal(parseGeoApiResponse({ location: { latitude: 0, longitude: value } }), null);
  }
  assert.equal(parseGeoApiResponse({ latitude: '0', longitude: '12.5' })?.longitude, 12.5);
});

test('国家字段是对象时仍然给出字符串', () => {
  const parsed = parseGeoApiResponse({ latitude: 1, longitude: 2, country: { name: 'Singapore', code: 'SG' } });
  assert.equal(parsed?.country, 'Singapore');
});

// ---------- 请求超时 ----------

test('fetchJson 在超时后中止请求', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: any, init?: any) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as any;

  try {
    await assert.rejects(() => fetchJson('https://example.test', 20), /aborted/);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchJson 对非 2xx 抛 HTTP 错误', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 503 })) as any;
  try {
    await assert.rejects(() => fetchJson('https://example.test'), /HTTP 503/);
  } finally {
    globalThis.fetch = original;
  }
});
