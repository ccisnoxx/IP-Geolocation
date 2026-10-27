import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const CHROME_PATH = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
    // 页面导航/关闭时 CDP 会回 -32000；调用方可能已经不再关心这个请求，
    // 挂一个空 catch 防止 unhandled rejection 把整个进程带掉（返回的仍然是原 promise）
    promise.catch(() => {});
    return promise;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitFor(method, sessionId, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${method}`));
      }, timeout);
      const off = this.on((message) => {
        if (message.method !== method) return;
        if (sessionId && message.sessionId !== sessionId) return;
        clearTimeout(timer);
        off();
        resolve(message.params);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export async function launchChrome({ userDataDir, headless = true, args = [], env = {}, debugPort = true }) {
  mkdirSync(userDataDir, { recursive: true });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  if (existsSync(portFile)) rmSync(portFile);

  const argv = [
    ...(debugPort ? ['--remote-debugging-port=0'] : []),
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--password-store=basic',
    '--use-mock-keychain',
    '--metrics-recording-only',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    ...(headless ? ['--headless=new'] : []),
    ...(process.env.VANISHGEO_EXTENSION ? [`--load-extension=${process.env.VANISHGEO_EXTENSION}`] : []),
    ...args,
    // 只有看起来像 URL 的参数才算导航目标（-AppleLanguages "(en-US)" 这类值不是）
    ...(args.some((item) => /^(https?:|file:|about:|data:|chrome:)/i.test(item)) ? [] : ['about:blank'])
  ];

  const child = spawn(CHROME_PATH, argv, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组：收尾时可以整组杀掉，避免残留浏览器把后续检查拖慢
    detached: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  if (!debugPort) return { child, port: 0, websocketUrl: null, stderr: () => stderr };

  const deadline = Date.now() + 25000;
  let port = 0;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [first, second] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (first && Number(first)) {
        port = Number(first);
        void second;
        break;
      }
    }
    if (child.exitCode !== null) break;
    await sleep(100);
  }

  if (!port) {
    child.kill('SIGKILL');
    throw new Error(`Chrome did not expose a DevTools port.\n${stderr.slice(-2000)}`);
  }

  let websocketUrl = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      websocketUrl = version.webSocketDebuggerUrl;
      if (websocketUrl) break;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  if (!websocketUrl) {
    child.kill('SIGKILL');
    throw new Error('Could not read /json/version from Chrome.');
  }

  return { child, port, websocketUrl, stderr: () => stderr };
}

export async function openPage(cdp, url, { viewport, beforeNavigate } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  if (beforeNavigate) await beforeNavigate(cdp, sessionId, targetId);
  if (viewport) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
      mobile: false
    }, sessionId);
  }
  if (url) {
    const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;
  }
  return { targetId, sessionId };
}

export async function evaluate(cdp, sessionId, expression, { awaitPromise = false } = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail);
  }
  return result.result.value;
}

export async function waitForValue(cdp, sessionId, expression, { timeout = 15000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, sessionId, expression);
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`value never became truthy: ${expression}`);
}

export { sleep };
/**
 * 关掉整个进程组。浏览器的 SIGTERM 经常因为 beforeunload / 后台任务被忽略，
 * 残留实例会抢 CPU，让后面的检查超时——所以先 TERM 再 KILL 整组。
 */
export function killChrome(child, { graceMs = 1200 } = {}) {
  if (!child || typeof child.pid !== 'number') return;
  const signal = (name) => {
    try { process.kill(-child.pid, name); return true; } catch {
      try { child.kill(name); return true; } catch { return false; }
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), graceMs);
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}

/** 杀掉本工具集留下的所有浏览器实例（只匹配临时 profile 目录，绝不碰用户自己开着的窗口） */
export function reapStrayBrowsers() {
  const patterns = ['vanishgeo-', 'audit-profile'];
  const listed = spawnSync('pgrep', ['-fl', 'Chromium|Helium|Google Chrome'], { encoding: 'utf8' });
  const killed = [];
  for (const line of String(listed.stdout || '').split('\n')) {
    if (!patterns.some((pattern) => line.includes(pattern))) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!Number.isFinite(pid) || pid === process.pid) continue;
    try { process.kill(pid, 'SIGKILL'); killed.push(pid); } catch { /* 已退出 */ }
  }
  return killed;
}
