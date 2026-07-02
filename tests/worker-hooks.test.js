const test = require('node:test');
const assert = require('node:assert/strict');

const workerHooks = require('../spoof/worker-hooks');

test('buildWorkerBootstrapSource uses importScripts for classic workers', () => {
  const source = workerHooks.buildWorkerBootstrapSource(
    'https://example.com/worker-classic.js',
    false,
    'PATCH();'
  );

  assert.match(source, /^PATCH\(\);\nimportScripts\("https:\/\/example\.com\/worker-classic\.js"\);$/);
});

test('buildWorkerBootstrapSource uses dynamic import for module workers', () => {
  const source = workerHooks.buildWorkerBootstrapSource(
    'https://example.com/worker-module.js',
    true,
    'PATCH();'
  );

  assert.match(source, /^PATCH\(\);\nawait import\("https:\/\/example\.com\/worker-module\.js"\);$/);
  assert.doesNotMatch(source, /\nimport "https:\/\/example\.com\/worker-module\.js";$/);
});
