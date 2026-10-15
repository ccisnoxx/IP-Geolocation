// 执行真实诊断页面脚本，验证旧 query 不影响模式、观测值或网络请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildWebRtcLeakSnapshot } from '../src/shared/diagnostic';
import { formatLocaleDateTimeForPage } from '../src/shared/locale-datetime';

const source = fs.readFileSync(new URL('../src/leak-test/leak-test.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(source.replace(/^import .*;\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

class Element {
  textContent = '';
  innerHTML = '';
  className = '';
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  classList = { add() {}, remove() {}, toggle() {} };
  setAttribute() {}
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  replaceChildren(...children: Element[]) { this.children = children; }
  getContext() { return null; }
  canPlayType() { return ''; }
}

function createPage(options: { search?: string; candidates?: string[]; failProbes?: boolean; failHeaders?: boolean } = {}) {
  const elements = new Map<string, Element>();
  const localStorage = new Map<string, string>();
  const requests: { url: string; init: RequestInit }[] = [];
  const logs: unknown[][] = [];
  const peerConfigs: RTCConfiguration[] = [];
  let peerClosed = false;
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const position = { coords: { latitude: 0, longitude: 0, accuracy: 50 } };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const window = {
    location: { protocol: 'https:', origin: 'https://observation.example.test', hostname: 'observation.example.test', search: options.search || '' },
    localStorage: {
      getItem: (key: string) => localStorage.get(key) ?? null,
      setItem: (key: string, value: string) => localStorage.set(key, value),
      removeItem: (key: string) => localStorage.delete(key)
    },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    devicePixelRatio: 1,
    // 访问这些入口即失败，避免测试把错误吞掉后误判为无桥。
    get chrome(): never { throw new Error('页面不得访问扩展配置'); },
    postMessage(): never { throw new Error('页面不得提交配置'); },
    RTCPeerConnection: class {}
  };
  class Peer {
    onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;
    onicegatheringstatechange = null;
    iceGatheringState = 'new';
    constructor(config: RTCConfiguration) { peerConfigs.push(config); }
    createDataChannel() {}
    async createOffer() {
      if (options.failProbes) throw new Error('合成 ICE 失败');
      return {};
    }
    async setLocalDescription() {
      for (const candidate of options.candidates || []) this.onicecandidate?.({ candidate: { candidate } });
      this.onicecandidate?.({ candidate: null });
    }
    close() { peerClosed = true; }
  }
  const context = vm.createContext({
    window,
    document: { getElementById: element, createElement: () => new Element(), documentElement: { lang: '' }, querySelectorAll: () => [], title: '' },
    navigator: {
      language: 'en-US', languages: ['en-US', 'en'], platform: 'synthetic', userAgent: 'synthetic', hardwareConcurrency: 4,
      permissions: { query: async () => ({ state: 'prompt' }) },
      geolocation: {
        getCurrentPosition: (success: (value: unknown) => void, failure: (error: Error) => void) => options.failProbes ? failure(new Error('合成位置失败')) : success(position),
        watchPosition: (success: (value: unknown) => void, failure: (error: Error) => void) => {
          queueMicrotask(() => options.failProbes ? failure(new Error('合成 watch 失败')) : success(position));
          return 1;
        },
        clearWatch() {}
      }
    },
    screen: { width: 800, height: 600, colorDepth: 24 },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return { ok: !options.failHeaders, status: 503, json: async () => ({ acceptLanguage: 'en-US,en;q=0.9' }) };
    },
    console: { log: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
    URLSearchParams, RTCPeerConnection: Peer, buildWebRtcLeakSnapshot, formatLocaleDateTimeForPage
  });
  vm.runInContext(script, context);
  return {
    elements, localStorage, requests, logs, peerConfigs,
    run: (code: string) => vm.runInContext(code, context),
    raw: () => JSON.parse(element('rawValues').textContent),
    rendered: () => [...elements.values()].map((item) => item.textContent + item.innerHTML + item.children.map((child) => child.innerHTML).join('')).join('\n'),
    isPeerClosed: () => peerClosed
  };
}

const legacyQuery = '?ui=en&validation=acceptance&expectedLatitude=12.345678&expectedLongitude=23.456789&expectedLanguage=fr-FR&expectedLanguages=fr-FR,fr&expectedAcceptLanguage=fr-FR&expectedTimezone=Europe/Paris&expectedTimezoneOffset=-60&expectedWebRtcMode=strict&expectedWebRtcPolicy=disable_non_proxied_udp&expectedLocaleString=private-locale&expectedLocaleStringTimestamp=1&actualWebRtcPolicyError=private-policy-error';

test('旧敏感 query 被忽略，实际语言/时区/header/位置仍可观测且无配置桥', async () => {
  const page = createPage({ search: legacyQuery });
  await page.run('runPassiveChecks()');
  await page.run('runGeolocationCheck()');
  const raw = page.raw();
  assert.equal(raw.mode, 'observe');
  assert.equal(raw.status, 'UNKNOWN');
  assert.equal('expected' in raw, false);
  assert.equal(raw.snapshots.language.navigatorLanguage, 'en-US');
  assert.equal(raw.snapshots.language.acceptLanguageHeader, 'en-US,en;q=0.9');
  assert.ok(raw.snapshots.timezone.timezone);
  assert.ok(raw.snapshots.timezone.localeString.actual);
  assert.equal(raw.snapshots.geolocation.find((row: any) => row.id === 'geo-position').actual, '0, 0');
  assert.deepEqual(raw.snapshots.webRtcPolicy, { status: 'not_observable' });
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests)), [{ url: '/headers.json', init: { cache: 'no-store', referrerPolicy: 'no-referrer' } }]);
  assert.doesNotMatch(page.rendered(), /12\.345678|23\.456789|fr-FR|Europe\/Paris|private-locale|private-policy-error|status-pass|status-fail/);
  assert.deepEqual(page.logs, []);
  page.run('writePassThroughBaseline()');
  assert.equal(page.localStorage.size, 1);
  assert.doesNotMatch(page.rendered(), /status-pass|status-fail/);
  page.run('clearPassThroughBaseline()');
  assert.equal(page.localStorage.size, 0);
});

test('ICE 有候选或无候选均保持 UNKNOWN，不声称策略或泄露防护通过', async () => {
  for (const candidates of [[], ['candidate:1 1 udp 1 203.0.113.9 443 typ srflx']]) {
    const page = createPage({ search: legacyQuery, candidates });
    await page.run('runWebRtcIceCheck()');
    assert.equal(page.raw().status, 'UNKNOWN');
    assert.equal(page.raw().snapshots.webRtcIce.exposesPublicIp, candidates.length > 0);
    assert.equal('protected' in page.raw().snapshots.webRtcIce, false);
    assert.equal(page.isPeerClosed(), true);
    assert.doesNotMatch(page.rendered(), /status-pass|status-fail/);
    assert.deepEqual(JSON.parse(JSON.stringify(page.peerConfigs)), [{ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }]);
  }
});

test('header/位置/ICE 失败保持未验证，错误不包含旧 query 预期值', async () => {
  const page = createPage({ search: legacyQuery, failProbes: true, failHeaders: true });
  await page.run('runPassiveChecks()');
  await page.run('runGeolocationCheck()');
  await page.run('runWebRtcIceCheck()');
  assert.equal(page.raw().status, 'UNKNOWN');
  assert.equal(page.raw().snapshots.language.acceptLanguageHeader, null);
  assert.match(page.rendered(), /合成位置失败/);
  assert.match(page.rendered(), /合成 ICE 失败/);
  assert.doesNotMatch(page.rendered(), /12\.345678|23\.456789|fr-FR|private-policy-error|status-pass|status-fail/);
  assert.deepEqual(page.logs, []);
});
