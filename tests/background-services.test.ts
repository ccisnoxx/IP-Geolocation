import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeoApiResponse } from '../src/background/services';

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
