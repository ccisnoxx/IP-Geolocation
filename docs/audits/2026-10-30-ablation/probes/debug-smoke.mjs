import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = '/Users/sc/PycharmProjects/VanishGeo';
const out = '/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/vanishgeo-ablation-20261030-m0yg_pqy';
const { CDP, launchChrome, killChrome } = await import(pathToFileURL(join(root, 'tools/lib/cdp.mjs')));
const { loadExtension } = await import(pathToFileURL(join(root, 'tools/lib/extension.mjs')));
const { evaluate, openPageStable, sendRuntimeMessage, waitFor, sleep } = await import(pathToFileURL(join(root, 'tools/lib/e2e.mjs')));
const [extension, label] = process.argv.slice(2);
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>debug behavior</title>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let chrome;
let cdp;
const results = [];
function check(name, condition) {
  results.push({ name, ok: Boolean(condition) });
  assert.ok(condition, name);
  console.log(`✓ ${name}`);
}
try {
  chrome = await launchChrome({ userDataDir: mkdtempSync(join(out, 'runtime', `debug-${label}-`)), args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
  cdp = await CDP.connect(chrome.websocketUrl);
  const id = await loadExtension(cdp, resolve(extension));
  const ui = await openPageStable(cdp, `chrome-extension://${id}/options/options.html`);
  async function send(message) {
    const reply = await sendRuntimeMessage(cdp, ui.sessionId, message);
    assert.equal(reply?.status, 'ok');
    return reply;
  }
  const base = (await send({ action: 'getSiteConfig' })).config;
  const config = {
    ...base, masterEnabled: true, debugMode: false,
    ipSync: { enabled: false, syncLanguage: false, intervalMinutes: 5 },
    canvas: { ...base.canvas, enabled: false },
    globalProfile: {
      ...base.globalProfile,
      language: { ...base.globalProfile.language, enabled: false },
      geolocation: { ...base.globalProfile.geolocation, enabled: false },
      timezone: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' }
    },
    rules: [{ id: 'debug-test', domain: 'localhost', enabled: true }]
  };
  await send({ action: 'setSiteConfig', config });
  const native = await openPageStable(cdp, `http://127.0.0.1:${server.address().port}/`);
  const nativeZone = await evaluate(cdp, native.sessionId, 'Intl.DateTimeFormat().resolvedOptions().timeZone');
  const page = await openPageStable(cdp, `http://localhost:${server.address().port}/`);
  let applied = 0;
  cdp.on(event => {
    if (event.sessionId === page.sessionId && event.method === 'Runtime.consoleAPICalled'
      && event.params?.args?.[0]?.value === '[VanishGeo] applied') applied += 1;
  });
  const zone = () => evaluate(cdp, page.sessionId, 'Intl.DateTimeFormat().resolvedOptions().timeZone');
  await waitFor(async () => await zone() === 'Asia/Tokyo', { label: 'initial Tokyo' });
  await sleep(100);
  check('debug=false 保持静默且应用 Tokyo', applied === 0);
  await send({ action: 'setSiteConfig', config: { ...config, debugMode: true } });
  await waitFor(() => applied > 0, { label: 'debug applied log' });
  await sleep(100);
  check('debug=true 输出 applied', applied > 0);
  const first = applied;
  await send({ action: 'setSiteConfig', config: {
    ...config, debugMode: false,
    globalProfile: { ...config.globalProfile, timezone: { enabled: true, mode: 'manual', timezone: 'America/Los_Angeles' } }
  } });
  await waitFor(async () => await zone() === 'America/Los_Angeles', { label: 'silent LA update' });
  await sleep(100);
  check('下一次 debug=false 更新时区且不沿用旧日志开关', applied === first);
  await send({ action: 'setSiteConfig', config: { ...config, debugMode: true } });
  await waitFor(() => applied > first, { label: 'debug enabled again' });
  await sleep(100);
  check('再次 debug=true 恢复日志', applied > first && await zone() === 'Asia/Tokyo');
  const last = applied;
  await send({ action: 'setSiteConfig', config: { ...config, masterEnabled: false, debugMode: true } });
  await waitFor(async () => await zone() === nativeZone, { label: 'clear to native' });
  await sleep(100);
  check('总关 clear 恢复原生且不输出 applied', applied === last);
  console.log(`${results.length}/${results.length} 通过`);
} finally {
  writeFileSync(join(out, `debug-${label}.json`), JSON.stringify({ label, results }, null, 2));
  cdp?.close();
  if (chrome) killChrome(chrome.child);
  await new Promise(done => server.close(done));
}
