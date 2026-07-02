const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('background services maps default WebRTC mode to cleared browser policy', () => {
  const content = read('background/services.js');
  assert.match(content, /const WEBRTC_POLICY_VALUES = \{\s*strict: 'disable_non_proxied_udp',\s*compatible: 'default_public_interface_only',\s*default: null\s*\}/s);
});

test('popup and options expose default WebRTC wording instead of off', () => {
  const popup = read('popup.html');
  const options = read('options.html');

  assert.match(popup, /id="webrtc-default-btn"/);
  assert.doesNotMatch(popup, /id="webrtc-off-btn"/);
  assert.match(options, /option value="default">默认（恢复浏览器默认）/);
  assert.doesNotMatch(options, /option value="off">关闭/);
});
