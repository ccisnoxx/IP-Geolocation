// Exercises page-visible runtime shapes that BrowserInsight-style checks inspect.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type MessageListener = (event: { source: unknown; data: unknown }) => void;

function compileRuntime(): string {
  const source = fs.readFileSync(path.join(projectRoot, 'src/injected/runtime.ts'), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None
    }
  }).outputText;
}

function createBrowserLikeContext(extraGlobals: Record<string, unknown> = {}) {
  const messageListeners: MessageListener[] = [];
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
    addEventListener(type: string, listener: MessageListener) {
      if (type === 'message') messageListeners.push(listener);
    },
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
  return { context, messageListeners };
}

function applyPayload(context: vm.Context, listener: MessageListener, payload: unknown): void {
  listener({
    source: vm.runInContext('window', context),
    data: {
      source: 'vanishgeo-extension',
      type: 'apply-spoof',
      payload
    }
  });
}

test('runtime hides internal anchor and keeps Navigator language descriptors native-looking', () => {
  const { context, messageListeners } = createBrowserLikeContext();
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });
  assert.equal(messageListeners.length, 1);

  applyPayload(context, messageListeners[0], {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'ja-JP',
      languages: ['ja-JP', 'ja'],
      acceptLanguage: 'ja-JP,ja;q=0.9'
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual',
      timezone: 'Asia/Tokyo'
    }
  });

  const inspection = vm.runInContext(`(() => {
    const navigatorPrototype = Object.getPrototypeOf(navigator);
    const languagesDescriptor = Object.getOwnPropertyDescriptor(navigatorPrototype, 'languages');
    const anchor = Symbol.for('chrome.runtime.vanishgeo.state');
    const visibleMarkers = [
      ...Object.getOwnPropertyNames(window),
      ...Object.getOwnPropertySymbols(window).map(String),
      ...Reflect.ownKeys(window).map(String)
    ].filter((key) => /vanish|chrome\\.runtime/i.test(key));
    return {
      language: navigator.language,
      languages: Array.from(navigator.languages),
      ownLanguagesDescriptor: Object.getOwnPropertyDescriptor(navigator, 'languages'),
      descriptorGetterSource: languagesDescriptor.get.toString(),
      objectDescriptorSource: Object.getOwnPropertyDescriptor.toString(),
      functionToStringSource: Function.prototype.toString.toString(),
      hiddenAnchorDescriptor: Object.getOwnPropertyDescriptor(window, anchor),
      knownAnchorInGlobal: anchor in window,
      knownAnchorKey: Symbol.keyFor(anchor),
      visibleMarkers,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  })()`, context);

  assert.equal(inspection.language, 'ja-JP');
  assert.deepEqual(Array.from(inspection.languages), ['ja-JP', 'ja']);
  assert.equal(inspection.ownLanguagesDescriptor, undefined);
  assert.match(inspection.descriptorGetterSource, /\[native code\]/);
  assert.match(inspection.objectDescriptorSource, /\[native code\]/);
  assert.match(inspection.functionToStringSource, /\[native code\]/);
  assert.equal(inspection.hiddenAnchorDescriptor, undefined);
  assert.equal(inspection.knownAnchorInGlobal, false);
  assert.equal(inspection.knownAnchorKey, 'chrome.runtime.vanishgeo.state');
  assert.deepEqual(Array.from(inspection.visibleMarkers), []);
  assert.equal(inspection.locale, 'ja-JP');
  assert.equal(inspection.timezone, 'Asia/Tokyo');
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

  const { context, messageListeners } = createBrowserLikeContext({
    URL: URLProxy,
    Blob: MockBlob,
    Worker: NativeWorker,
    SharedWorker: NativeSharedWorker
  });
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, messageListeners[0], {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US', 'en'],
      acceptLanguage: 'en-US,en;q=0.9'
    }
  });

  const worker = vm.runInContext('new Worker("/worker.js", { type: "module" })', context);
  assert.equal(worker.scriptURL, 'blob:patched-worker-1');
  const sharedWorker = vm.runInContext('new SharedWorker("/shared-worker.js", { type: "module", name: "shared" })', context);
  assert.equal(sharedWorker.scriptURL, 'blob:patched-worker-2');
  assert.equal(createdBlobs.length, 2);

  const workerSource = createdBlobs[0].parts.join('');
  assert.match(workerSource, /chrome\.runtime\.vanishgeo\.state/);
  assert.match(workerSource, /getTimezoneOffset/);
  assert.match(workerSource, /toLocaleString/);
  assert.match(workerSource, /DateTimeFormat/);
  assert.match(workerSource, /await import\("https:\/\/example\.test\/worker\.js"\)/);
  assert.ok(
    workerSource.indexOf('chrome.runtime.vanishgeo.state') < workerSource.indexOf('await import'),
    'bootstrap prelude must run before the target module worker is imported'
  );

  const sharedWorkerSource = createdBlobs[1].parts.join('');
  assert.match(sharedWorkerSource, /chrome\.runtime\.vanishgeo\.state/);
  assert.match(sharedWorkerSource, /await import\("https:\/\/example\.test\/shared-worker\.js"\)/);

  const crossOriginWorker = vm.runInContext('new Worker("https://cdn.example.test/worker.js", { type: "module" })', context);
  assert.equal(crossOriginWorker.scriptURL, 'https://cdn.example.test/worker.js');
  assert.equal(createdBlobs.length, 2);
});

test('Intl and Date timezone formatting stay consistent even with explicit caller options', () => {
  const { context, messageListeners } = createBrowserLikeContext();
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, messageListeners[0], {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'fr-FR',
      languages: ['fr-FR', 'fr'],
      acceptLanguage: 'fr-FR,fr;q=0.9'
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
  const { context, messageListeners } = createBrowserLikeContext();
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

  applyPayload(context, messageListeners[0], {
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
  const { context, messageListeners } = createBrowserLikeContext({
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

  applyPayload(context, messageListeners[0], {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'en-US',
      languages: ['en-US', 'en'],
      acceptLanguage: 'en-US,en;q=0.9'
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

test('dynamic about:blank and srcdoc iframes receive the same registry-backed spoofing', async () => {
  const childBlank = createBrowserLikeContext();
  const childSrcdoc = createBrowserLikeContext();
  const childContexts = [childBlank.context, childSrcdoc.context];
  const childWindows = childContexts.map((child) => vm.runInContext('window', child));
  const createdFrames: Array<{ contentWindow: vm.Context; addEventListener(type: string, listener: () => void): void }> = [];
  const documentMock = {
    createElement(tagName: string) {
      const frame = {
        contentWindow: childWindows[createdFrames.length],
        src: '',
        srcdoc: '',
        listeners: new Map<string, Array<() => void>>(),
        addEventListener(type: string, listener: () => void) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }
      };
      createdFrames.push(frame);
      return frame;
    }
  };
  const { context, messageListeners } = createBrowserLikeContext({ document: documentMock });
  vm.runInContext(compileRuntime(), context, { filename: 'runtime.js' });

  applyPayload(context, messageListeners[0], {
    extensionEnabled: true,
    languageConfig: {
      enabled: true,
      language: 'fr-FR',
      languages: ['fr-FR', 'fr'],
      acceptLanguage: 'fr-FR,fr;q=0.9'
    },
    timezoneConfig: {
      enabled: true,
      mode: 'manual',
      timezone: 'Europe/Paris'
    }
  });

  vm.runInContext(`
    const blankFrame = document.createElement('iframe');
    blankFrame.src = 'about:blank';
    const srcdocFrame = document.createElement('iframe');
    srcdocFrame.srcdoc = '<p>same-origin</p>';
  `, context);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(createdFrames.length, 2);
  for (const child of childContexts) {
    const inspection = vm.runInContext(`(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'languages');
      return {
        language: navigator.language,
        languages: Array.from(navigator.languages),
        descriptorSource: descriptor.get.toString(),
        ownLanguagesDescriptor: Object.getOwnPropertyDescriptor(navigator, 'languages'),
        visibleMarkers: [
          ...Object.getOwnPropertyNames(window),
          ...Object.getOwnPropertySymbols(window).map(String),
          ...Reflect.ownKeys(window).map(String)
        ].filter((key) => /vanish|chrome\\.runtime/i.test(key)),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    })()`, child);
    assert.equal(inspection.language, 'fr-FR');
    assert.deepEqual(Array.from(inspection.languages), ['fr-FR', 'fr']);
    assert.match(inspection.descriptorSource, /\[native code\]/);
    assert.equal(inspection.ownLanguagesDescriptor, undefined);
    assert.deepEqual(Array.from(inspection.visibleMarkers), []);
    assert.equal(inspection.timezone, 'Europe/Paris');
  }
});
