const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../shared/runtime');

test('unwrapRuntimeResponse passes successful responses through', () => {
  const response = runtime.unwrapRuntimeResponse({ status: 'ok', state: { ok: true } });
  assert.deepEqual(response, { status: 'ok', state: { ok: true } });
});

test('unwrapRuntimeResponse throws response message for runtime errors', () => {
  assert.throws(
    () => runtime.unwrapRuntimeResponse({ status: 'error', message: 'boom' }),
    /boom/
  );
});
