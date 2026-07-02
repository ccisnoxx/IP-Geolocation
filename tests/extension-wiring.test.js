const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function extractHtmlScripts(relativePath) {
  const content = read(relativePath);
  return Array.from(content.matchAll(/<script\s+src="([^"]+)"><\/script>/g)).map((match) => match[1]);
}

function extractImportScripts(relativePath) {
  const content = read(relativePath);
  const match = content.match(/importScripts\(([\s\S]*?)\);/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((item) => item[1]);
}

function extractRegisteredScriptFiles() {
  const content = read('background/services.js');
  return ['MAIN_WORLD_SCRIPT_FILES', 'BRIDGE_SCRIPT_FILES']
    .flatMap((name) => {
      const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
      if (!match) return [];
      return Array.from(match[1].matchAll(/'([^']+)'/g)).map((item) => item[1]);
    });
}

test('manifest background service worker exists', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(exists(manifest.background.service_worker), true);
});

test('extension pages only reference existing local scripts', () => {
  ['popup.html', 'options.html', 'test.html'].forEach((htmlFile) => {
    const scripts = extractHtmlScripts(htmlFile);
    assert.ok(scripts.length > 0, `${htmlFile} should load at least one script`);
    scripts.forEach((scriptPath) => {
      assert.equal(exists(scriptPath), true, `${htmlFile} references missing script ${scriptPath}`);
    });
  });
});

test('background importScripts references existing modules', () => {
  const imports = extractImportScripts('background.js');
  assert.ok(imports.length > 0, 'background.js should import shared modules');
  imports.forEach((scriptPath) => {
    assert.equal(exists(scriptPath), true, `background.js imports missing script ${scriptPath}`);
  });
});

test('registered content script file lists only existing modules', () => {
  const scriptFiles = extractRegisteredScriptFiles();
  assert.ok(scriptFiles.length >= 2, 'background/services.js should register content script files');
  scriptFiles.forEach((scriptPath) => {
    assert.equal(exists(scriptPath), true, `background/services.js registers missing file ${scriptPath}`);
  });
});

test('background content script registration no longer targets all urls', () => {
  const content = read('background/services.js');
  assert.equal(content.includes("matches: ['<all_urls>']"), false);
});

test('manifest does not expose extension-only resources as web accessible', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.web_accessible_resources, []);
});
