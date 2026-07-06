import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

test('manifest uses dynamic injection instead of static all-url content scripts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.name, 'VanishGeo');
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources, []);
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('tabs'));
});

test('vite builds the single injected runtime entry', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /injected\/runtime/);
  assert.doesNotMatch(vite, /injected\/injected/);
  assert.equal(exists('src/injected/runtime.ts'), true);
  assert.equal(exists('src/injected/injected.ts'), false);
});

test('background registers only dynamic runtime and bridge scripts', () => {
  const services = read('src/background/services.ts');
  assert.match(services, /const MAIN_RUNTIME_FILES = \['injected\/runtime\.js'\]/);
  assert.match(services, /const BRIDGE_FILES = \['content\/content\.js'\]/);
  assert.doesNotMatch(services, /matches: \['<all_urls>'\]/);
});

test('legacy VanishMe storage key is confined to migration code', () => {
  const files = [
    'src/shared/config-model.ts',
    'src/shared/config-resolver.ts',
    'src/shared/storage.ts',
    'src/content/content.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
    'src/background/services.ts'
  ];
  const offenders = files
    .filter((file) => !file.includes('config-') && file !== 'src/shared/storage.ts')
    .filter((file) => read(file).includes('bpg_config'));
  assert.deepEqual(offenders, []);
});
