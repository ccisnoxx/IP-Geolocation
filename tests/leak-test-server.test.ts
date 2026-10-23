import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

test('本地观察服务拒绝畸形 URL 后仍能提供页面和同源请求头观测', async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vanishgeo-leak-server-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const directory = join(projectRoot, 'dist', 'leak-test');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'leak-test.html'), '<p>synthetic observation</p>');
  const { createLeakTestServer } = await import(new URL('../scripts/serve-leak-test.mjs', import.meta.url).href);
  const server = createLeakTestServer({ projectRoot });
  // 先同步重放可导致进程退出的边界，修复前直接给出断言失败。
  for (const url of ['/%FF', '/%', 'http://[']) {
    let status = 0;
    assert.doesNotThrow(() => server.emit('request', { method: 'GET', url, headers: {} }, {
      writeHead(code: number) { status = code; }, end() {}
    }));
    assert.equal(status, 400, url);
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const send = (path: string, method = 'GET') => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { 'Accept-Language': 'en-US,en;q=0.9' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal((await send('/%FF')).status, 400);
  assert.deepEqual(await send('/'), { status: 200, body: '<p>synthetic observation</p>' });
  const echo = await send('/headers.json');
  assert.equal(echo.status, 200);
  assert.equal(JSON.parse(echo.body).acceptLanguage, 'en-US,en;q=0.9');
  assert.deepEqual(await send('/', 'HEAD'), { status: 200, body: '' });
  assert.equal((await send('/..%2Fpackage.json')).status, 404);
  assert.equal((await send('/', 'POST')).status, 405);
});
