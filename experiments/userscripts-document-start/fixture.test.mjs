import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createFixtureServer, fixtureHtml } from './fixture.mjs';

test('fixture 首个 head inline 同步保存实际值，普通 iframe 有独立文档', async () => {
  const server = createFixtureServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const top = await fetch(`${origin}/matched/top.html`);
    const html = await top.text();
    const child = await (await fetch(`${origin}/matched/child.html`)).text();
    assert.equal(top.status, 200);
    assert.match(html, /<head><script>\s*\(\(\) =>/);
    assert.ok(html.indexOf('const earliest = sample();') < html.indexOf("addEventListener('load'"));
    assert.match(html, /src="\/matched\/child.html"/);
    assert.doesNotMatch(child, /<iframe/);
    assert.notEqual(html.match(/serial: (\d+)/)[1], child.match(/serial: (\d+)/)[1]);
    for (const path of ['/matched/sub/deep.html', '/outside/top.html', '/matchedness/top.html']) {
      assert.equal((await fetch(origin + path)).status, 200);
    }
    assert.equal((await fetch(`${origin}/unknown`)).status, 404);
    assert.equal((await fetch(`${origin}/matched/top.html`, { method: 'POST', body: 'ignored' })).status, 404);
    assert.doesNotMatch(html, /x-vg-a|x-vg-b|postMessage|fetch\(/);
    assert.doesNotMatch(fixtureHtml(1), /srcdoc|document\.write|eval\(|new Function/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('实验扩展权限和控制面局限在固定本地合成注册', async () => {
  const manifest = JSON.parse(await readFile(new URL('./extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '138');
  assert.deepEqual(manifest.permissions, ['userScripts']);
  assert.deepEqual(manifest.host_permissions, ['http://localhost/*']);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources, []);
  const control = await readFile(new URL('./extension/control.js', import.meta.url), 'utf8');
  assert.doesNotMatch(control, /eval\(|new Function|fetch\(|postMessage|executeScript|documentId/);
});
