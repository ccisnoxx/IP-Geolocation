import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installBlobWorker } from '../src/injected/runtime-modules/surfaces/blob-worker';
import { createRuntimeState } from '../src/injected/runtime-modules/registry';
import { generateBlobWorkerRuntime, generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import type { RuntimeGlobals } from '../src/injected/runtime-modules/types';
import type { LanguageTimezonePayload } from '../src/shared/types';

const payload: LanguageTimezonePayload = { language: { language: 'en-US', languages: ['en-US', 'en'] }, timezone: 'America/Los_Angeles', intlMode: 'compatible' };
function realm() {
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  let next = 0;
  class URLMock extends URL {
    static createObjectURL(blob: Blob) { const url = `blob:https://example.test/${++next}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url: string) { revoked.push(url); blobs.delete(url); }
  }
  class WorkerMock extends EventTarget {
    constructor(readonly url: string, readonly options?: WorkerOptions) {
      super();
      if (options?.type && !['classic', 'module'].includes(options.type)) throw new TypeError('type');
    }
    terminate() { /* native mock */ }
  }
  class XHRMock {
    url = '';
    value = 0;
    get status() { return this.value; }
    open(_method: string, url: string, sync: boolean) { assert.equal(sync, false); this.url = url; }
    send() { if (!blobs.has(this.url)) throw new Error('revoked'); this.value = 200; }
  }
  const context = vm.createContext({ URL: URLMock, Blob, Worker: WorkerMock, SharedWorker: function SharedWorker() {}, EventTarget,
    XMLHttpRequest: XHRMock, console: { warn() {} },
    location: { protocol: 'https:', href: 'https://example.test/' }, origin: 'https://example.test' });
  vm.runInContext(`class Navigator { get language(){return 'zh-CN'} get languages(){return ['zh-CN','zh']} }
    globalThis.navigator=new Navigator();`, context);
  const root = vm.runInContext('globalThis', context) as RuntimeGlobals;
  return { root, context, blobs, revoked, WorkerMock };
}

test('Blob构造只消费本realm URL，URL/SharedWorker/非Blob和禁用维持原生路径', () => {
  const r = realm();
  const originalShared = r.root.SharedWorker;
  const originalCreate = r.root.URL.createObjectURL;
  installBlobWorker(r.root, createRuntimeState(r.root), { ...payload, language: undefined, timezone: undefined }, () => {});
  assert.equal(r.root.Worker, r.WorkerMock);
  assert.equal(r.root.URL.createObjectURL, originalCreate);
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  for (const url of ['https://example.test/worker.js', 'data:text/javascript,0', 'blob:https://example.test/foreign']) {
    const worker = new r.root.Worker(url) as unknown as InstanceType<typeof r.WorkerMock>;
    assert.equal(worker.url, url);
  }
  const blob = new Blob(['0'], { type: 'text/javascript' });
  const url = r.root.URL.createObjectURL(blob);
  r.root.URL.revokeObjectURL(new String(url) as unknown as string);
  assert.equal((new r.root.Worker(url) as unknown as InstanceType<typeof r.WorkerMock>).url, url);
  assert.equal(r.root.SharedWorker, originalShared);
});

test('URL立即撤销不丢源；options getter依WebIDL顺序一次，terminate清理私有源', () => {
  const r = realm();
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const blob = new Blob(['"use strict"; postMessage(this);'], { type: 'text/javascript' });
  const url = r.root.URL.createObjectURL(blob);
  const reads: string[] = [];
  const options = Object.fromEntries(['credentials', 'name', 'type'].map(key => [key, undefined]));
  for (const [key, value] of Object.entries({ credentials: 'omit', name: 'probe', type: 'classic' })) {
    Object.defineProperty(options, key, { get() { reads.push(key); return value; } });
  }
  const worker = new r.root.Worker(url, options);
  assert.deepEqual(reads, ['credentials', 'name', 'type']);
  r.root.URL.revokeObjectURL(url);
  assert.equal(r.blobs.size, 1);
  assert.equal([...r.blobs.values()][0], blob);
  assert.equal(r.revoked.includes((worker as unknown as InstanceType<typeof r.WorkerMock>).url), true);
  worker.terminate();
  assert.equal(r.blobs.size, 0);
  assert.equal(worker instanceof r.WorkerMock, true);
});

test('module依赖分离补丁与业务，不替换Shared或nested；异步error清理所有私有URL', async () => {
  const r = realm();
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const original = r.root.URL.createObjectURL(new Blob(['export const x = 1'], { type: 'text/javascript' }));
  const worker = new r.root.Worker(original, { type: 'module' });
  r.root.URL.revokeObjectURL(original);
  assert.equal(r.blobs.size, 2);
  const prelude = await [...r.blobs.values()][1].text();
  assert.match(prelude, /America\/Los_Angeles/);
  assert.match(prelude, /import\.meta\.url/);
  worker.dispatchEvent(new Event('error'));
  assert.equal(r.blobs.size, 0);
});

test('options getter重入撤销不会复活源，也不重复读取getter', () => {
  const r = realm();
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const url = r.root.URL.createObjectURL(new Blob(['0']));
  let reads = 0;
  const worker = new r.root.Worker(url, { get name() { reads++; r.root.URL.revokeObjectURL(url); return ''; } });
  assert.equal((worker as unknown as InstanceType<typeof r.WorkerMock>).url, url);
  assert.equal(reads, 1);
  assert.equal(r.blobs.size, 0);
});

test('跨realm撤销后不从缓存复活源；普通URL对象进入同步路径', () => {
  const r = realm();
  const nativeRevoke = r.root.URL.revokeObjectURL;
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const url = r.root.URL.createObjectURL(new Blob(['0']));
  const worker = new r.root.Worker(new URL(url));
  assert.notEqual((worker as unknown as InstanceType<typeof r.WorkerMock>).url, url);
  worker.terminate();
  nativeRevoke(url);
  const revoked = new r.root.Worker(url);
  assert.equal((revoked as unknown as InstanceType<typeof r.WorkerMock>).url, url);
  assert.equal(r.blobs.size, 0);
});

test('核验使用安装时捕获的XHR方法和status，页面改写不能复活已撤销源', () => {
  const r = realm();
  const nativeRevoke = r.root.URL.revokeObjectURL;
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const url = r.root.URL.createObjectURL(new Blob(['0']));
  r.root.XMLHttpRequest.prototype.open = () => {};
  r.root.XMLHttpRequest.prototype.send = () => {};
  Object.defineProperty(r.root.XMLHttpRequest.prototype, 'status', { get: () => 200 });
  nativeRevoke(url);
  const worker = new r.root.Worker(url);
  assert.equal((worker as unknown as InstanceType<typeof r.WorkerMock>).url, url);
  assert.equal(r.blobs.size, 0);
});

test('非法options的原生错误分支不重复转换scriptURL对象', () => {
  const r = realm();
  installBlobWorker(r.root, createRuntimeState(r.root), payload, () => {});
  const url = r.root.URL.createObjectURL(new Blob(['0']));
  let conversions = 0;
  const argument = { toString() { conversions++; if (conversions > 1) throw new Error('double-conversion'); return url; } };
  assert.throws(() => new r.root.Worker(argument as unknown as URL, { type: 'invalid' as WorkerType }), TypeError);
  assert.equal(conversions, 1);
  r.root.URL.revokeObjectURL(url);
});

test('生产Blob bootstrap脱离页面闭包，语言/Intl/Date跟随美西快照且显式参数保持compatible', async () => {
  const generated = await generateBlobWorkerRuntime();
  const bootstrap = assertSelfContainedFunction(generated.code, 'applyBlobWorkerRuntime');
  assert.doesNotMatch(bootstrap, /installNestedWorker|installWorkerHooks|installGeolocationSpoof|installFontExposureFilter|postMessage/);
  const r = realm();
  vm.runInContext(`(${bootstrap})(${JSON.stringify(payload)})`, r.context);
  assert.equal(vm.runInContext('navigator.language', r.context), 'en-US');
  assert.deepEqual(Array.from(vm.runInContext('navigator.languages', r.context)), ['en-US', 'en']);
  assert.equal(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', r.context), 'America/Los_Angeles');
  assert.equal(vm.runInContext('Intl.NumberFormat().resolvedOptions().locale', r.context), 'en-US');
  assert.equal(vm.runInContext('new Date(Date.UTC(2026,0,15)).getTimezoneOffset()', r.context), 480);
  assert.equal(vm.runInContext('new Date(Date.UTC(2026,6,15)).getTimezoneOffset()', r.context), 420);
  assert.equal(vm.runInContext('Intl.DateTimeFormat("de-DE",{timeZone:"UTC"}).resolvedOptions().timeZone', r.context), 'UTC');
  assert.equal(r.root.Worker, r.WorkerMock);
  // 完整生产模板也必须保持二次序列化函数自包含。
  const page = assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime');
  const other = realm();
  vm.runInContext(`(${page})(${JSON.stringify(payload)})`, other.context);
  assert.notEqual(other.root.Worker, other.WorkerMock);
});
