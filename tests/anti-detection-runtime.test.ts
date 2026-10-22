// 验证页面运行时兼容性、配置一致性与隐私边界。
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { generateRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import type { RuntimeController, RuntimePayload } from '../src/injected/runtime-modules/types';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let compiledRuntime: string;
before(async () => {
  compiledRuntime = assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime');
});
function compileRuntime(): string { return compiledRuntime; }

function createBrowserLikeContext(extraGlobals: Record<string, unknown> = {}) {
  const sandbox: Record<string, any> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    EventTarget,
    URL,
    Blob,
    location: { href: 'https://example.test/page.html' },
    addEventListener() {},
    removeEventListener() {},
    ...extraGlobals
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    this.window = this;
    this.self = this;
    class NavigatorMock {}
    const nativeGetter = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').get;
    Object.defineProperty(NavigatorMock.prototype, 'language', {
      get: nativeGetter,
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(NavigatorMock.prototype, 'languages', {
      get: nativeGetter,
      enumerable: true,
      configurable: true
    });
    this.Navigator = NavigatorMock;
    this.navigator = new NavigatorMock();
  `, context);
  return { context };
}

const controllers = new WeakMap<vm.Context, RuntimeController>();
function applyPayload(context: vm.Context, payload: unknown): void {
  const previous = controllers.get(context);
  if (previous) previous.update(payload as RuntimePayload);
  else {
    const install = vm.runInContext('applyVanishGeoRuntime', context) as (payload: unknown) => RuntimeController;
    controllers.set(context, install(payload));
  }
}

test('私有安装句柄保持页面 getter 幂等，语言/时区结果一致', () => {
  const { context } = createBrowserLikeContext();
  vm.runInContext(compileRuntime(), context);
  const payload = { extensionEnabled: true,
    languageConfig: { enabled: true, language: 'ja-JP', languages: ['ja-JP', 'ja'] },
    timezoneConfig: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' } };
  applyPayload(context, payload);
  const first = vm.runInContext("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'language').get", context);
  applyPayload(context, payload);
  assert.equal(vm.runInContext('navigator.language', context), 'ja-JP');
  assert.deepEqual(Array.from(vm.runInContext('navigator.languages', context)), ['ja-JP', 'ja']);
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'language').get", context), first);
  assert.equal(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context), 'Asia/Tokyo');
});

test('worker wrapper remains constructible and prepends the bootstrap before module import', () => {
  const createdBlobs: Array<{ parts: string[]; options?: BlobPropertyBag }> = [];
  function URLProxy(input: string | URL, base?: string | URL) {
    return new URL(input, base);
  }
  URLProxy.createObjectURL = (blob: { parts: string[]; options?: BlobPropertyBag }) => {
    createdBlobs.push(blob);
    return `blob:patched-worker-${createdBlobs.length}`;
  };
  URLProxy.revokeObjectURL = (_url: string) => {};
  class MockBlob {
    parts: string[];
    options?: BlobPropertyBag;

    constructor(parts: string[], options?: BlobPropertyBag) {
      this.parts = parts;
      this.options = options;
    }
  }
  function NativeWorker(this: { scriptURL: string; options?: WorkerOptions }, scriptURL: string, options?: WorkerOptions) {
    this.scriptURL = scriptURL;
    this.options = options;
  }
  function NativeSharedWorker(
    this: { scriptURL: string; optionsOrName?: string | WorkerOptions },
    scriptURL: string,
    optionsOrName?: string | WorkerOptions
  ) {
    this.scriptURL = scriptURL;
    this.optionsOrName = optionsOrName;
  }

  const { context } = createBrowserLikeContext({
    URL: URLProxy,
    Blob: MockBlob,
    Worker: NativeWorker,
    SharedWorker: NativeSharedWorker
  });
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US', 'en']
    }
  });

  const worker = vm.runInContext('new Worker("/worker.js", { type: "module" })', context);
  assert.equal(worker.scriptURL, 'blob:patched-worker-1');
  const sharedWorker = vm.runInContext('new SharedWorker("/shared-worker.js", { type: "module", name: "shared" })', context);
  assert.equal(sharedWorker.scriptURL, 'blob:patched-worker-2');
  assert.equal(createdBlobs.length, 2);

  const workerSource = createdBlobs[0].parts.join('');
  assert.doesNotMatch(workerSource, /test-document:worker|stateKey/);
  assert.match(workerSource, /getTimezoneOffset/);
  assert.match(workerSource, /toLocaleString/);
  assert.match(workerSource, /DateTimeFormat/);
  assert.match(workerSource, /await import\("https:\/\/example\.test\/worker\.js"\)/);
  assert.ok(
    workerSource.indexOf('function workerBootstrap') < workerSource.lastIndexOf('await import'),
    'bootstrap prelude must run before the target module worker is imported'
  );

  const sharedWorkerSource = createdBlobs[1].parts.join('');
  assert.doesNotMatch(sharedWorkerSource, /test-document:worker|stateKey/);
  assert.match(sharedWorkerSource, /await import\("https:\/\/example\.test\/shared-worker\.js"\)/);

  const crossOriginWorker = vm.runInContext('new Worker("https://cdn.example.test/worker.js", { type: "module" })', context);
  assert.equal(crossOriginWorker.scriptURL, 'https://cdn.example.test/worker.js');
  assert.equal(createdBlobs.length, 2);
});

// 使用实际 SharedWorker fixture，在按原生 URL/name 身份建立的 VM scope 中运行。
function createWorkerHarness() {
  const blobs = new Map<string, string>();
  const revoked: string[] = [];
  const scopes = new Map<string, vm.Context>();
  const listeners = new Map<string, Array<() => void>>();
  let sequence = 0;
  let rejectBlob = false;
  class MockBlob {
    constructor(public parts: string[]) {}
  }
  class MockURL extends URL {
    static createObjectURL(blob: Blob | MediaSource) {
      const url = `blob:worker-${++sequence}`;
      blobs.set(url, (blob as unknown as MockBlob).parts.join(''));
      return url;
    }
    static revokeObjectURL(url: string) { revoked.push(url); }
  }
  class NativeWorker {
    constructor(public scriptURL: string, public options?: WorkerOptions) {
      if (rejectBlob && scriptURL.startsWith('blob:')) throw new Error('模拟包装加载失败');
    }
  }
  class NativeSharedWorker {
    port: { result: any };
    constructor(public scriptURL: string, public optionsOrName?: string | WorkerOptions) {
      if (rejectBlob && scriptURL.startsWith('blob:')) throw new Error('模拟包装加载失败');
      const name = typeof optionsOrName === 'string' ? optionsOrName : optionsOrName?.name || '';
      const key = JSON.stringify([scriptURL, name]);
      let scope = scopes.get(key);
      if (!scope) {
        scope = createBrowserLikeContext({ crypto: { randomUUID: () => `scope-${scopes.size + 1}` }, name }).context;
        const bootstrap = blobs.get(scriptURL);
        if (bootstrap) {
          // module 的实际动态 import 由真实 Chrome 检验；VM 执行同一 prelude。
          const boundary = bootstrap.indexOf('\nconst connections =');
          vm.runInContext(bootstrap.slice(0, boundary >= 0 ? boundary : Math.max(bootstrap.lastIndexOf('importScripts('), bootstrap.lastIndexOf('await import('))), scope);
        }
        vm.runInContext(fs.readFileSync(path.join(projectRoot, 'fixtures/workers/shared-worker.js'), 'utf8'), scope);
        scopes.set(key, scope);
      }
      this.port = { result: null };
      scope.__port = { postMessage: (result: unknown) => { this.port.result = result; } };
      vm.runInContext('self.onconnect({ ports: [__port] })', scope);
      delete scope.__port;
    }
  }
  const { context } = createBrowserLikeContext({
    URL: MockURL, Blob: MockBlob, Worker: NativeWorker, SharedWorker: NativeSharedWorker,
    addEventListener: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) || []), listener]);
    }
  });
  vm.runInContext(compileRuntime(), context);
  const payload = (language = 'ja-JP') => ({
    extensionEnabled: true,
    languageConfig: { enabled: true, language, languages: [language] },
    timezoneConfig: { enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' }
  });
  applyPayload(context, payload());
  return { context, blobs, revoked, listeners, payload, NativeWorker, NativeSharedWorker,
    reject: (value: boolean) => { rejectBlob = value; } };
}

test('相同 SharedWorker key 复用包装 URL 和 fixture scope，name/URL/type/credentials/config 隔离', () => {
  const h = createWorkerHarness();
  const first = vm.runInContext('new SharedWorker("/shared-worker.js", "shared")', h.context);
  const second = vm.runInContext('new SharedWorker(new URL("https://example.test/shared-worker.js"), {name:"shared",type:"classic",credentials:"same-origin"})', h.context);
  assert.equal(second.scriptURL, first.scriptURL);
  assert.equal(first.port.result.scopeId, second.port.result.scopeId);
  assert.equal(first.port.result.connectionCount, 1);
  assert.equal(second.port.result.connectionCount, 2);
  assert.equal(second.port.result.language, 'ja-JP');
  const wrapper = h.context.SharedWorker;
  applyPayload(h.context, h.payload());
  assert.equal(h.context.SharedWorker, wrapper);
  const third = vm.runInContext('new SharedWorker("/shared-worker.js", "shared")', h.context);
  assert.equal(third.scriptURL, first.scriptURL);
  assert.equal(third.port.result.connectionCount, 3);
  for (const expression of [
    'new SharedWorker("/shared-worker.js", "different")',
    'new SharedWorker("/other-worker.js", "shared")',
    'new SharedWorker("/shared-worker.js", {name:"shared",type:"module"})',
    'new SharedWorker("/shared-worker.js", {name:"shared",credentials:"omit"})'
  ]) {
    const different = vm.runInContext(expression, h.context);
    assert.notEqual(different.scriptURL, first.scriptURL);
    assert.notEqual(different.port.result.scopeId, first.port.result.scopeId);
    assert.equal(different.port.result.connectionCount, 1);
  }
  applyPayload(h.context, h.payload('fr-FR'));
  const changed = vm.runInContext('new SharedWorker("/shared-worker.js", "shared")', h.context);
  assert.notEqual(changed.scriptURL, first.scriptURL);
  assert.equal(changed.port.result.language, 'fr-FR');
  applyPayload(h.context, h.payload());
  const restored = vm.runInContext('new SharedWorker("/shared-worker.js", "shared")', h.context);
  assert.equal(restored.scriptURL, first.scriptURL);
  assert.equal(restored.port.result.connectionCount, 4);
});

test('WorkerOptions 单次转换快照用于缓存与构造，null 名称按 DOMString 转换', () => {
  const h = createWorkerHarness();
  const value = vm.runInContext(`(() => {
    const reads = [];
    const options = {
      get credentials() { reads.push('credentials'); if(reads.filter(x=>x==='credentials').length>1) throw new Error('重复读取'); return 'same-origin'; },
      get name() { reads.push('name'); return reads.filter(x=>x==='name').length === 1 ? 'first' : 'later'; },
      get type() { reads.push('type'); return 'classic'; }
    };
    const first = new SharedWorker('/shared-worker.js', options);
    const second = new SharedWorker('/shared-worker.js', {name:'first'});
    const nullName = new SharedWorker('/shared-worker.js', {name:null});
    const stringName = new SharedWorker('/shared-worker.js', 'null');
    const emptyName = new SharedWorker('/shared-worker.js');
    let throws = 0;
    try { new SharedWorker('/shared-worker.js', {get name(){throws++;throw new Error('原始 getter 错误')}}); }
    catch(error) { if(error.message !== '原始 getter 错误') throw error; }
    return {reads, same:first.scriptURL===second.scriptURL, firstName:first.port.result.name,
      nullSame:nullName.scriptURL===stringName.scriptURL, nullDistinct:nullName.scriptURL!==emptyName.scriptURL,throws};
  })()`, h.context);
  assert.deepEqual(Array.from(value.reads), ['credentials', 'name', 'type']);
  assert.equal(value.same, true);
  assert.equal(value.firstName, 'first');
  assert.equal(value.nullSame, true);
  assert.equal(value.nullDistinct, true);
  assert.equal(value.throws, 1);
});

test('SharedWorker 字符串 name 使用固定默认值，不读取 Object.prototype 的 type/credentials', () => {
  const h = createWorkerHarness();
  const value = vm.runInContext(`(() => {
    Object.prototype.type = 'module';
    Object.prototype.credentials = 'omit';
    try {
      const stringName = new SharedWorker('/shared-worker.js', 'prototype-test');
      const explicit = new SharedWorker('/shared-worker.js', {name:'prototype-test',type:'classic',credentials:'same-origin'});
      return {same:stringName.scriptURL===explicit.scriptURL,count:explicit.port.result.connectionCount};
    } finally { delete Object.prototype.type; delete Object.prototype.credentials; }
  })()`, h.context);
  assert.equal(value.same, true);
  assert.equal(value.count, 2);
});

test('Dedicated URL 在构造后回收，Shared URL 在 pagehide 幂等回收，失败不污染缓存', () => {
  const h = createWorkerHarness();
  const dedicated = vm.runInContext('new Worker("/worker.js")', h.context);
  assert.deepEqual(h.revoked, [dedicated.scriptURL]);
  const shared = vm.runInContext('new SharedWorker("/shared-worker.js")', h.context);
  assert.equal(h.revoked.includes(shared.scriptURL), false);
  h.reject(true);
  const fallback = vm.runInContext('new SharedWorker("/failed.js")', h.context);
  assert.equal(fallback.scriptURL, '/failed.js');
  const failedUrl = [...h.blobs.keys()].at(-1)!;
  assert.equal(h.revoked.includes(failedUrl), true);
  const dedicatedFallback = vm.runInContext('new Worker("/failed-worker.js")', h.context);
  assert.equal(dedicatedFallback.scriptURL, '/failed-worker.js');
  assert.equal(h.revoked.includes([...h.blobs.keys()].at(-1)!), true);
  h.reject(false);
  const recovered = vm.runInContext('new SharedWorker("/failed.js")', h.context);
  assert.notEqual(recovered.scriptURL, failedUrl);
  assert.equal(h.listeners.get('pagehide')?.length, 1);
  h.listeners.get('pagehide')!.forEach(listener => listener());
  assert.equal(h.revoked.includes(shared.scriptURL), true);
  assert.equal(h.revoked.includes(recovered.scriptURL), true);
  const count = h.revoked.length;
  h.listeners.get('pagehide')!.forEach(listener => listener());
  assert.equal(h.revoked.length, count);
  const afterHide = vm.runInContext('new SharedWorker("/shared-worker.js")', h.context);
  assert.notEqual(afterHide.scriptURL, shared.scriptURL);
});

test('Worker 透传 URL/options、构造器反射与派生类保持原生合同', () => {
  const h = createWorkerHarness();
  for (const ctor of ['Worker', 'SharedWorker']) {
    const original = ctor === 'Worker' ? h.NativeWorker : h.NativeSharedWorker;
    const wrapper = h.context[ctor];
    assert.equal(wrapper.prototype, original.prototype);
    assert.equal(wrapper.name, original.name);
    assert.equal(wrapper.length, original.length);
    assert.match(vm.runInContext(`Function.prototype.toString.call(${ctor})`, h.context), /\[native code\]/);
    assert.throws(() => vm.runInContext(`${ctor}("/worker.js")`, h.context), /class constructor|Class constructor/);
    for (const url of ['https://cdn.example.test/worker.js', 'data:text/javascript,0', 'blob:original']) {
      const value = vm.runInContext(`new ${ctor}(${JSON.stringify(url)}, {type:'module',name:'native',credentials:'include'})`, h.context);
      assert.equal(value.scriptURL, url);
    }
    const derived = vm.runInContext(`(() => { class Derived extends ${ctor} {}; const value = new Derived('/worker.js'); return value instanceof Derived; })()`, h.context);
    assert.equal(derived, true);
  }
});

test('Intl and Date timezone formatting stay consistent even with explicit caller options', () => {
  const { context } = createBrowserLikeContext();
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'fr-FR',
      languages: ['fr-FR', 'fr']
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual',
      timezone: 'Europe/Paris'
    }
  });

  const inspection = vm.runInContext(`(() => {
    const date = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
    const explicitFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const hourPart = explicitFormatter.formatToParts(date).find((part) => part.type === 'hour');
    return {
      locale: new Intl.NumberFormat().resolvedOptions().locale,
      resolvedTimezone: explicitFormatter.resolvedOptions().timeZone,
      formattedHour: hourPart && hourPart.value,
      offset: date.getTimezoneOffset(),
      fullYear: date.getFullYear(),
      hours: date.getHours(),
      localeString: date.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' }),
      stringValue: date.toString()
    };
  })()`, context);

  assert.equal(inspection.locale, 'fr-FR');
  assert.equal(inspection.resolvedTimezone, 'Europe/Paris');
  assert.equal(inspection.formattedHour, '13');
  assert.equal(inspection.offset, -60);
  assert.equal(inspection.fullYear, 2024);
  assert.equal(inspection.hours, 13);
  assert.match(inspection.localeString, /13/);
  assert.match(inspection.stringValue, /GMT\+0100/);
});

test('geolocation methods and permission query form one stable granted contract', async () => {
  const { context } = createBrowserLikeContext();
  vm.runInContext(`
    this.navigator.geolocation = {};
    class PermissionStatusMock extends EventTarget {
      constructor(state) {
        super();
        this._state = state;
      }
      get state() { return this._state; }
      get name() { return 'geolocation'; }
    }
    this.PermissionStatus = PermissionStatusMock;
    this.navigator.permissions = {
      query(desc) {
        if (desc && desc.name === 'geolocation') return Promise.resolve(new PermissionStatusMock('denied'));
        return Promise.resolve(new PermissionStatusMock('prompt'));
      }
    };
  `, context);
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, {
    extensionEnabled: true,
    geolocation: {
      enabled: true,
      latitude: 35.68,
      longitude: 139.76,
      accuracy: 25,
      randomize: true,
      randomRadiusMeters: 500,
      spoofPermission: true
    }
  });

  const inspection = await vm.runInContext(`(async () => {
    const first = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        }),
        reject
      );
    });
    const second = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        }),
        reject
      );
    });
    const watch = await new Promise((resolve, reject) => {
      const id = navigator.geolocation.watchPosition(
        (position) => {
          navigator.geolocation.clearWatch(id);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        reject
      );
    });
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    return {
      first,
      second,
      watch,
      permissionState: permission.state,
      permissionName: permission.name,
      permissionPrototype: Object.getPrototypeOf(permission).constructor.name,
      nonGeoPermissionState: (await navigator.permissions.query({ name: 'notifications' })).state
    };
  })()`, context);

  assert.deepEqual(inspection.first, inspection.second);
  assert.deepEqual(inspection.first, inspection.watch);
  assert.equal(inspection.first.accuracy, 25);
  assert.equal(inspection.permissionState, 'granted');
  assert.equal(inspection.permissionName, 'geolocation');
  assert.equal(inspection.permissionPrototype, 'PermissionStatusMock');
  assert.equal(inspection.nonGeoPermissionState, 'prompt');
});

test('registry reflection layer leaves unmodified real-device surfaces as pass-through', () => {
  function NativeAudioContext(this: { sampleRate: number }) {
    this.sampleRate = 48000;
  }
  const screen = { width: 1440, height: 900, colorDepth: 30 };
  const { context } = createBrowserLikeContext({
    screen,
    AudioContext: NativeAudioContext,
    MediaSource: {
      isTypeSupported(type: string) {
        return type.includes('avc1');
      }
    }
  });
  vm.runInContext(`
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: function hardwareConcurrency() { return 12; },
      configurable: true,
      enumerable: true
    });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function deviceMemory() { return 8; },
      configurable: true,
      enumerable: true
    });
    this.navigator.gpu = {
      requestAdapter() { return 'native-adapter'; }
    };
    this.HTMLCanvasElement = function HTMLCanvasElement() {};
    this.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
      return kind === 'webgl' ? 'native-webgl-context' : null;
    };
  `, context);
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  const snapshotScript = `(() => {
    const navigatorPrototype = Object.getPrototypeOf(navigator);
    return {
      hardwareConcurrency: navigator.hardwareConcurrency,
      hardwareDescriptorSource: Object.getOwnPropertyDescriptor(navigatorPrototype, 'hardwareConcurrency').get.toString(),
      deviceMemory: navigator.deviceMemory,
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      audioSampleRate: new AudioContext().sampleRate,
      audioSource: AudioContext.toString(),
      webglContext: new HTMLCanvasElement().getContext('webgl'),
      webglSource: HTMLCanvasElement.prototype.getContext.toString(),
      codec: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
      webgpuAdapter: navigator.gpu.requestAdapter()
    };
  })()`;
  const before = vm.runInContext(snapshotScript, context);

  applyPayload(context, {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US', 'en']
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual',
      timezone: 'America/New_York'
    },
    geolocation: {
      enabled: true,
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 50
    }
  });
  const after = vm.runInContext(snapshotScript, context);

  assert.deepEqual(after, before);
});

test('each frame document accepts its own direct runtime invocation without iframe creation hooks', () => {
  const payload = {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'fr-FR',
      languages: ['fr-FR', 'fr']
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual' as const,
      timezone: 'Europe/Paris'
    }
  };
  const contexts = [createBrowserLikeContext().context, createBrowserLikeContext().context];
  contexts.forEach((context) => {
    vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });
    applyPayload(context, payload);
  });

  assert.doesNotMatch(fs.readFileSync(path.join(projectRoot, 'src/injected/runtime.ts'), 'utf8'), /installIframePropagation/);
  contexts.forEach((context) => {
    const inspection = vm.runInContext(`({
      language: navigator.language,
      languages: Array.from(navigator.languages),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })`, context);
    assert.equal(inspection.language, 'fr-FR');
    assert.deepEqual(Array.from(inspection.languages), ['fr-FR', 'fr']);
    assert.equal(inspection.timezone, 'Europe/Paris');
  });
});

test('debugMode 只记录固定提示，不向页面控制台暴露预期 payload', async () => {
  for (const debugMode of [false, true]) {
    const logs: unknown[][] = [];
    const { context } = createBrowserLikeContext({ console: { log: (...args: unknown[]) => logs.push(args) } });
    vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });
    applyPayload(context, {
      extensionEnabled: true,
      debugMode,
      languageConfig: { enabled: true, language: 'fr-FR', languages: ['fr-FR', 'fr'] },
      timezone: 'Europe/Paris',
      timezoneConfig: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' },
      geolocation: { enabled: true, latitude: 12.345678, longitude: 23.456789, accuracy: 50 }
    });
    assert.ok(logs.every((entry) => entry.every((value) => typeof value === 'string')));
    assert.equal(logs.length, debugMode ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(logs), /12\.345678|23\.456789|fr-FR|Europe\/Paris|latitude|longitude|acceptLanguage/);
    const actual = await vm.runInContext(`new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }), reject);
    })`, context);
    assert.equal(actual.latitude, 12.345678);
    assert.equal(actual.longitude, 23.456789);
    assert.equal(actual.language, 'fr-FR');
    assert.equal(actual.timezone, 'Europe/Paris');
  }
});

function createFontExposureContext() {
  const { context } = createBrowserLikeContext();
  vm.runInContext(`
    const fontsByContext = new WeakMap();
    this.CanvasRenderingContext2D = class CanvasRenderingContext2D {
      constructor() { fontsByContext.set(this, '12px Arial'); }
      get font() {
        if (!fontsByContext.has(this)) throw new TypeError('font 非法 receiver');
        return fontsByContext.get(this);
      }
      set font(value) {
        if (!fontsByContext.has(this)) throw new TypeError('font 非法 receiver');
        fontsByContext.set(this, value);
      }
      measureText(text) {
        if (!fontsByContext.has(this)) throw new TypeError('measureText 非法 receiver');
        if (!arguments.length) throw new TypeError('measureText 缺少参数');
        const value = \`\${text}\`;
        const font = fontsByContext.get(this);
        return { width: value.length * (font.includes('MiSans') || font.includes('HarmonyOS') ? 30 : font.includes('monospace') ? 10 : 20), font };
      }
      fillText() { return this.font; }
      strokeText() { return this.font; }
      getImageData() { return 'native-pixels'; }
    };
    this.ctx = new CanvasRenderingContext2D();
    this.HTMLCanvasElement = class HTMLCanvasElement {
      getContext(kind) { return kind === '2d' ? ctx : 'native-webgl'; }
      toDataURL() { return 'native-data-url'; }
      toBlob() { return 'native-blob'; }
    };
    const fontSets = new WeakSet();
    this.FontFaceSet = class FontFaceSet {
      constructor() { fontSets.add(this); }
      check(font, text = '') {
        if (!fontSets.has(this)) throw new TypeError('check 非法 receiver');
        if (!arguments.length) throw new TypeError('check 缺少参数');
        const value = \`\${font}\`;
        const content = \`\${text}\`;
        if (!/^12px /.test(value)) throw new SyntaxError('无效字体 shorthand');
        return !value.includes('Missing') && content !== 'missing-glyph';
      }
    };
    // VM只提供既有12px样本的CSSOM接口；真实CSS grammar由Chrome回归验证。
    this.document = { fonts: new FontFaceSet(), createElement() {
      let font = '';
      return {style: {
        setProperty(name, value) { if (name === 'font') font = value; },
        getPropertyValue(name) { return name === 'font-family' ? font.replace(/^12px /, '') : ''; }
      }};
    } };
    this.navigator.userAgent = 'native-UA';
    this.navigator.userAgentData = { platform: 'native-platform' };
    this.navigator.hardwareConcurrency = 12;
    this.navigator.deviceMemory = 8;
    this.navigator.gpu = { requestAdapter() { return 'native-adapter'; } };
    this.screen = { width: 1440, height: 900, colorDepth: 30 };
    this.AudioContext = class AudioContext {};
    const fontOwners = [
      [CanvasRenderingContext2D.prototype, ['measureText', 'fillText', 'strokeText', 'getImageData', 'font']],
      [HTMLCanvasElement.prototype, ['getContext', 'toDataURL', 'toBlob']],
      [FontFaceSet.prototype, ['check']],
      [navigator, ['userAgent', 'userAgentData', 'hardwareConcurrency', 'deviceMemory', 'gpu']],
      [globalThis, ['screen', 'AudioContext']]
    ];
    const fontSnapshot = fontOwners.flatMap(([owner, keys]) => keys.map(key => ({
      owner, key, descriptor: Object.getOwnPropertyDescriptor(owner, key)
    })));
    const nativeMeasureText = CanvasRenderingContext2D.prototype.measureText;
    const nativeFontCheck = FontFaceSet.prototype.check;
    const nativeFunctionSource = Function.prototype.toString;
    const nativeReflection = [Object.getOwnPropertyDescriptor, Reflect.ownKeys];
    const sameDescriptor = (a, b) => ['value', 'get', 'set', 'enumerable', 'configurable', 'writable'].every(key => a[key] === b[key]);
    const unchangedFontSurfaces = (includeFiltered = false) => fontSnapshot.every(({owner, key, descriptor}) =>
      !includeFiltered && (key === 'measureText' || key === 'check') || sameDescriptor(descriptor, Object.getOwnPropertyDescriptor(owner, key)));
  `, context);
  vm.runInContext(compileRuntime(), context);
  return context;
}

const fontExposurePayload = (enabled = true): RuntimePayload => ({
  extensionEnabled: true,
  fontExposureConfig: { enabled, mode: 'vendor-software', blockedFamilies: ['MiSans', 'HarmonyOS Sans SC'] }
});

test('字体维护 runtime 仅过滤目标测量，普通中文/拉丁字体和绘图/设备表面原生透传', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  const value = vm.runInContext(`(() => {
    const targets = ['12px MiSans', '12px "HarmonyOS Sans SC"', '12px MiSans, Arial'].map(font => {
      ctx.font = font;
      const result = ctx.measureText('字A');
      return {font, measured:result.font, width:result.width, restored:ctx.font===font,
        fill:ctx.fillText('字A',0,0),stroke:ctx.strokeText('字A',0,0)};
    });
    const ordinary = ['Microsoft YaHei', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', 'Arial'].map(family => {
      ctx.font = '12px "' + family + '"';
      return JSON.stringify(ctx.measureText('字A')) === JSON.stringify(nativeMeasureText.call(ctx, '字A'));
    });
    return { targets, ordinary, untouched:unchangedFontSurfaces(),
      webgl:new HTMLCanvasElement().getContext('webgl'),pixels:ctx.getImageData(),
      data:new HTMLCanvasElement().toDataURL(),blob:new HTMLCanvasElement().toBlob() };
  })()`, context);
  assert.deepEqual(Array.from(value.targets, (row: any) => row.measured), ['12px monospace', '12px monospace', '12px Arial']);
  assert.deepEqual(Array.from(value.targets, (row: any) => row.width), [20, 20, 40]);
  assert.ok(value.targets.every((row: any) => row.restored && row.fill === row.font && row.stroke === row.font));
  assert.ok(value.ordinary.every(Boolean));
  assert.equal(value.untouched, true);
  assert.equal(value.webgl, 'native-webgl');
  assert.equal(value.pixels, 'native-pixels');
  assert.equal(value.data, 'native-data-url');
  assert.equal(value.blob, 'native-blob');
});

test('FontFaceSet.check 目标过滤，非目标、原生异常和单次参数转换保持合同', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  const value = vm.runInContext(`(() => {
    let conversions = 0;
    const objectTarget = document.fonts.check({[Symbol.toPrimitive](hint) {
      if (hint !== 'string') throw new Error('转换 hint 变化');
      conversions++; return '12px MiSans';
    }});
    const ordinary = ['Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Arial','Missing'].map(family => {
      const font = '12px "' + family + '"';
      return document.fonts.check(font) === nativeFontCheck.call(document.fonts, font);
    });
    const outcome = f => {try{return {value:f()}}catch(error){return {name:error.name,message:error.message}}};
    const errors = [
      [{}, ['12px MiSans']], [null, ['12px MiSans']],
      [new Proxy(document.fonts, {}), ['12px MiSans']], [document.fonts, []],
      [document.fonts, ['invalid 12px MiSans']], [document.fonts, [Symbol('font')]],
      [document.fonts, ['12px MiSans', {toString(){throw new RangeError('text 转换错误')}}]],
      [document.fonts, [{toString(){throw new SyntaxError('font 转换错误')}}]]
    ].map(([receiver,args]) => JSON.stringify(outcome(()=>Reflect.apply(document.fonts.check,receiver,args))) ===
      JSON.stringify(outcome(()=>Reflect.apply(nativeFontCheck,receiver,args))));
    let invalidReceiverConversions = 0;
    try { document.fonts.check.call({}, {toString(){invalidReceiverConversions++;return '12px MiSans'}}); } catch {}
    return {objectTarget,conversions,ordinary,errors,invalidReceiverConversions,
      blocked:document.fonts.check('12px MiSans'),native:nativeFontCheck.call(document.fonts,'12px MiSans')};
  })()`, context);
  assert.equal(value.objectTarget, false);
  assert.equal(value.conversions, 1);
  assert.equal(value.invalidReceiverConversions, 0);
  assert.equal(value.blocked, false);
  assert.equal(value.native, true);
  assert.ok(value.ordinary.every(Boolean));
  assert.ok(value.errors.every(Boolean));
});

test('字体代理保持 descriptor/函数形状/toString 和非法 receiver，测量异常后恢复原字体', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  const value = vm.runInContext(`(() => {
    const shape = [[CanvasRenderingContext2D.prototype,'measureText',nativeMeasureText], [FontFaceSet.prototype,'check',nativeFontCheck]].map(([owner,key,native]) => {
      const current = owner[key], old = fontSnapshot.find(row=>row.owner===owner&&row.key===key).descriptor;
      const descriptor = Object.getOwnPropertyDescriptor(owner,key);
      const constructible = f => {try { Reflect.construct(f, []);return true;} catch {return false;}};
      return current !== native && current.name === native.name && current.length === native.length
        && Object.getPrototypeOf(current) === Object.getPrototypeOf(native)
        && Reflect.ownKeys(current).length === Reflect.ownKeys(native).length
        && Reflect.ownKeys(native).every(key=>sameDescriptor(Object.getOwnPropertyDescriptor(current,key),Object.getOwnPropertyDescriptor(native,key)))
        && ['enumerable','configurable','writable'].every(key=>descriptor[key]===old[key])
        && constructible(current) === constructible(native) && /\\[native code\\]/.test(Function.prototype.toString.call(current));
    });
    const outcome = f => {try{return {value:f()}}catch(error){return {name:error.name,message:error.message}}};
    const fake = {get font(){throw new Error('不应读取页面属性')}};
    const receiverErrors = [{},null,undefined,Object.create(CanvasRenderingContext2D.prototype),new Proxy(ctx,{}),fake].map(receiver =>
      JSON.stringify(outcome(()=>Reflect.apply(ctx.measureText,receiver,['字']))) === JSON.stringify(outcome(()=>Reflect.apply(nativeMeasureText,receiver,['字']))));
    ctx.font = '12px MiSans';
    const marker = new RangeError('测量参数转换错误');
    let sameError = false, conversions = 0;
    try { ctx.measureText({toString(){conversions++;throw marker}}); } catch(error) { sameError = error === marker; }
    const missing = JSON.stringify(outcome(()=>ctx.measureText())) === JSON.stringify(outcome(()=>nativeMeasureText.call(ctx)));
    return {shape,receiverErrors,sameError,conversions,missing,restored:ctx.font==='12px MiSans',
      reflection:Function.prototype.toString===nativeFunctionSource && Object.getOwnPropertyDescriptor===nativeReflection[0] && Reflect.ownKeys===nativeReflection[1]};
  })()`, context);
  assert.ok(value.shape.every(Boolean));
  assert.ok(value.receiverErrors.every(Boolean));
  assert.equal(value.sameError, true);
  assert.equal(value.conversions, 1);
  assert.equal(value.missing, true);
  assert.equal(value.restored, true);
  assert.equal(value.reflection, true);
});

test('字体关闭、未配置或扩展禁用时零 hook', () => {
  for (const payload of [{ extensionEnabled: true }, fontExposurePayload(false),
    { ...fontExposurePayload(), extensionEnabled: false },
    { extensionEnabled: true, fontExposureConfig: { enabled: true, mode: 'custom', blockedFamilies: [] } }]) {
    const context = createFontExposureContext();
    applyPayload(context, payload);
    assert.equal(vm.runInContext('unchangedFontSurfaces(true)', context), true);
  }
});

test('目标字体测量的用户参数转换在原始字体下运行，重入绘图不被临时fallback污染', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  const value = vm.runInContext(`(() => {
    ctx.font = '12px MiSans';
    let seen, count = 0;
    const metrics = ctx.measureText({toString() {
      count++; seen = ctx.fillText('字', 0, 0);
      ctx.font = '12px Arial';
      return '字A';
    }});
    return {seen, count, measured: metrics.font, restored: ctx.font};
  })()`, context);
  assert.equal(value.seen, '12px MiSans');
  assert.equal(value.count, 1);
  assert.equal(value.measured, '12px Arial');
  assert.equal(value.restored, '12px Arial');
});


test('非目标字体的参数转换改成目标字体后仍过滤，且保留转换设置的新字体', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  const value = vm.runInContext(`(() => {
    ctx.font = '12px Arial';let count = 0;
    const result = ctx.measureText({toString(){count++;ctx.font = '12px MiSans';return '字A';}});
    return { count, font: result.font, restored: ctx.font };
  })()`, context);
  assert.equal(value.count, 1);
  assert.equal(value.font, '12px monospace');
  assert.equal(value.restored, '12px MiSans');
});


test('FontFaceSet.check 的合法CSS escape字体名与目标名字等价', () => {
  const context = createFontExposureContext();
  applyPayload(context, fontExposurePayload());
  assert.equal(vm.runInContext(`document.fonts.check('12px "Mi'+String.fromCharCode(92)+'53 ans"')`, context), false);
  assert.equal(vm.runInContext(`document.fonts.check('12px "Ar'+String.fromCharCode(92)+'69 al"')`, context), true);
});
