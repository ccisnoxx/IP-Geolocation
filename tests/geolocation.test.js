const test = require('node:test');
const assert = require('node:assert/strict');

const geolocation = require('../spoof/geolocation');

test('createGeolocationController returns deterministic watch ids and clears them', async () => {
  const controller = geolocation.createGeolocationController({
    latitude: 35.68,
    longitude: 139.76
  });

  const seen = [];
  const watchId = controller.watchPosition((payload) => {
    seen.push(payload.coords.latitude);
  });

  assert.equal(watchId, 1);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(seen.length, 1);
  assert.equal(controller.snapshot().activeWatchIds.includes(1), true);
  assert.equal(controller.clearWatch(1), true);
  assert.equal(controller.snapshot().activeWatchIds.includes(1), false);
});

test('createGeolocationController supports forced error branch', () => {
  const controller = geolocation.createGeolocationController({
    latitude: 35.68,
    longitude: 139.76
  });
  let received = null;

  controller.setForcedError({ code: 1, message: 'Permission denied (fixture)' });
  controller.getCurrentPosition(
    () => {
      throw new Error('success callback should not be called');
    },
    (error) => {
      received = error;
    }
  );

  assert.equal(received.code, 1);
  assert.equal(received.message, 'Permission denied (fixture)');
});
