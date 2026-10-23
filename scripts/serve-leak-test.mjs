#!/usr/bin/env node
/**
 * Serves the built leak-test bundle from a normal localhost origin so Chrome
 * content-script and DNR allowlist rules can apply during manual validation.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LEAK_TEST_HOST = 'localhost';
export const DEFAULT_LEAK_TEST_PORT = 8787;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8']
]);

export function getLeakTestDistRoot(projectRoot = resolve(scriptDir, '..')) {
  return join(projectRoot, 'dist');
}

export function getLeakTestEntryPath(projectRoot = resolve(scriptDir, '..')) {
  return join(getLeakTestDistRoot(projectRoot), 'leak-test', 'leak-test.html');
}

export function assertLeakTestDist(projectRoot = resolve(scriptDir, '..')) {
  const entryPath = getLeakTestEntryPath(projectRoot);
  if (!existsSync(entryPath)) {
    throw new Error('dist/leak-test/leak-test.html is missing. Run `npm run build` first.');
  }
}

function normalizePort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return port;
}

function resolveRequestPath(distRoot, decodedPath) {
  const relativePath = decodedPath === '/'
    ? join('leak-test', 'leak-test.html')
    : decodedPath.replace(/^\/+/, '');
  const filePath = normalize(join(distRoot, relativePath));
  const isInsideDist = filePath === distRoot || filePath.startsWith(`${distRoot}${sep}`);
  return isInsideDist ? filePath : null;
}

function writeJson(response, request, payload) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function createLeakTestServer(options = {}) {
  const projectRoot = options.projectRoot || resolve(scriptDir, '..');
  const host = options.host || DEFAULT_LEAK_TEST_HOST;
  const distRoot = options.distRoot || getLeakTestDistRoot(projectRoot);
  assertLeakTestDist(projectRoot);

  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }

    let requestUrl;
    let decodedPath;
    try {
      requestUrl = new URL(request.url || '/', `http://${host}`);
      decodedPath = decodeURIComponent(requestUrl.pathname);
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof URIError)) throw error;
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    if (requestUrl.pathname === '/headers.json') {
      writeJson(response, request, {
        acceptLanguage: request.headers['accept-language'] || null,
        headers: request.headers
      });
      return;
    }

    const filePath = resolveRequestPath(distRoot, decodedPath);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes.get(extname(filePath)) || 'application/octet-stream'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  });
}

export function startLeakTestServer(options = {}) {
  const host = options.host || DEFAULT_LEAK_TEST_HOST;
  const port = normalizePort(options.port || DEFAULT_LEAK_TEST_PORT);
  const server = createLeakTestServer(options);
  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(port, host, () => {
      server.off('error', rejectStart);
      resolveStart({
        server,
        host,
        port,
        origin: `http://${host}:${port}`
      });
    });
  });
}

async function runCli() {
  const host = DEFAULT_LEAK_TEST_HOST;
  const rawPort = process.argv[2] || process.env.VANISHGEO_LEAK_TEST_PORT || String(DEFAULT_LEAK_TEST_PORT);
  let port;
  try {
    port = normalizePort(rawPort);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    const serverInfo = await startLeakTestServer({ host, port });
    serverInfo.server.on('error', (error) => {
      console.error(error);
      process.exit(1);
    });
    console.log(`VanishGeo leak-test target: ${serverInfo.origin}/leak-test/leak-test.html`);
    console.log(`Request-header echo target: ${serverInfo.origin}/headers.json`);
    console.log('Add `localhost` to the VanishGeo allowlist, reload the URL, then run the checks.');
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Pass another port, for example: npm run serve:leak-test -- 8788`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli();
}
