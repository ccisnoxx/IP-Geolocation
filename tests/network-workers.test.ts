import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRuntimeState, disposeRuntimeState } from '../src/injected/runtime-modules/registry';
import { installBlobWorker } from '../src/injected/runtime-modules/surfaces/blob-worker';
import { installWorkerImportScripts } from '../src/injected/runtime-modules/surfaces/worker-imports';
import { installNetworkWorkers } from '../src/injected/runtime-modules/surfaces/network-workers';
import type { RuntimeGlobals } from '../src/injected/runtime-modules/types';
import type { LanguageTimezonePayload } from '../src/shared/types';

const payload: LanguageTimezonePayload = { language: { language: 'de-DE', languages: ['de-DE'] }, timezone: 'Europe/Berlin', intlMode: 'compatible' };
let nextUrl = 0;
function realm() {
  const blobs = new Map<string, Blob>();
  const calls: unknown[][] = [];
  class URLMock extends URL {
    static createObjectURL(blob: Blob) { const url = `blob:https://example.test/${++nextUrl}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url: string) { blobs.delete(url); }
  }
  class WorkerMock extends EventTarget {
    script: Blob | undefined;
    constructor(readonly url: string, readonly options?: WorkerOptions) {
      super(); calls.push([url, options]);
      if (options && typeof options === 'object' && 'extendedLifetime' in options) void (options as any).extendedLifetime;
      this.script = blobs.get(url);
      if (options?.type && !['classic', 'module'].includes(options.type)) throw new TypeError('native invalid type');
      if (options?.credentials && !['omit', 'include', 'same-origin'].includes(options.credentials)) throw new TypeError('native invalid credentials');
    }
    terminate() {}
  }
  class SharedMock extends WorkerMock {}
  class XHRMock {
    url = ''; get status() { return blobs.has(this.url) ? 200 : 404; }
    open(_method: string, url: string) { this.url = url; }
    send() {}
  }
  const context = vm.createContext({ Blob, URL: URLMock, Worker: WorkerMock, SharedWorker: SharedMock, EventTarget, XMLHttpRequest: XHRMock,
    console: { warn() {} }, location: { href: 'https://example.test/base/page.html' } });
  const root = vm.runInContext('globalThis', context) as RuntimeGlobals;
  const state = createRuntimeState(root);
  installBlobWorker(root, state, payload, () => {});
  installNetworkWorkers(root, state, payload, () => {});
  return { root, state, blobs, calls, WorkerMock, SharedMock };
}

test('HTTP Dedicated classic/module先应用最小快照，绝对业务入口保留，构造失败不重试裸Worker', async () => {
  const r = realm();
  const classic = new r.root.Worker('../worker.js') as any;
  const source = await classic.script.text();
  assert.match(source, /Europe\/Berlin/); assert.match(source, /importScripts\("https:\/\/example.test\/worker.js"\)/);
  assert.equal(r.blobs.has(classic.url), false);
  assert.equal(r.root.Worker.prototype.constructor, r.root.Worker);
  const module = new r.root.Worker('/module.js', { type: 'module', credentials: 'include' }) as any;
  const body = await module.script.text();
  assert.match(body, /^import "blob:/); assert.match(body, /import "https:\/\/example.test\/module.js"/);
  assert.equal(module.options.credentials, 'include');
  module.terminate(); assert.equal(r.blobs.size, 0);
  const before = r.calls.length;
  assert.throws(() => new r.root.Worker('/worker.js', { type: 'invalid' as WorkerType }), /native invalid type/);
  assert.equal(r.calls.length - before, 1);
});

test('Shared同页URL/name/type/credentials复用，跨页分离；热更新回收缓存而旧构造器退回原生', async () => {
  const r = realm(), other = realm();
  const first = new r.root.SharedWorker('/shared.js', 'name') as any;
  const second = new r.root.SharedWorker(new URL('https://example.test/shared.js'), { name: 'name' }) as any;
  assert.equal(first.url, second.url);
  assert.notEqual(first.url, (new other.root.SharedWorker('/shared.js', 'name') as any).url);
  for (const options of [{ name: 'other' }, { name: 'name', type: 'module' }, { name: 'name', credentials: 'omit' }] as WorkerOptions[]) {
    assert.notEqual(first.url, (new r.root.SharedWorker('/shared.js', options) as any).url);
  }
  const moduleEntry = await (new r.root.SharedWorker('/restart.js', { type: 'module', name: 'restart' }) as any).script.text();
  const preludeUrl = /^import "([^"]+)"/.exec(moduleEntry)![1];
  assert.ok(r.blobs.has(preludeUrl));
  assert.doesNotMatch(await r.blobs.get(preludeUrl)!.text(), /revokeObjectURL/);
  assert.equal(r.root.SharedWorker.prototype.constructor, r.root.SharedWorker);
  const cached = r.root.SharedWorker;
  disposeRuntimeState(r.root, r.state);
  assert.equal(r.root.SharedWorker, r.SharedMock);
  assert.equal(r.blobs.size, 0);
  assert.equal((new cached('/shared.js', 'name') as any).url, '/shared.js');
  assert.match(await first.script.text(), /Europe\/Berlin/);
  disposeRuntimeState(other.root, other.state);
});

test('未接管协议/跨源/TrustedScriptURL透传，URL和选项单次转换，getter异常不创建额外Worker', () => {
  const r = realm();
  const nativeCalls = () => r.calls.length;
  for (const url of ['https://other.test/worker.js', 'data:text/javascript,0', 'blob:https://example.test/foreign']) {
    assert.equal((new r.root.Worker(url) as any).url, url);
  }
  let conversions = 0; const order: string[] = [];
  const input = { toString() { conversions++; return '/worker.js'; } };
  new r.root.Worker(input as unknown as URL, {
    get credentials() { order.push('credentials'); return 'omit' as const; }, get name() { order.push('name'); return 'name'; }, get type() { order.push('type'); return 'classic' as const; }
  });
  assert.equal(conversions, 1); assert.deepEqual(order, ['credentials', 'name', 'type']);
  const before = nativeCalls();
  assert.throws(() => new r.root.Worker('/worker.js', { get name(): string { throw new Error('synthetic getter failure'); } }), /synthetic getter failure/);
  assert.equal(nativeCalls(), before);
  const trusted = { toString() { throw new Error('trusted must stay native'); } };
  r.root.trustedTypes = { isScriptURL: (value: unknown) => value === trusted };
  assert.equal((new r.root.Worker(trusted as any) as any).url, trusted);
});

test('Shared自身Blob复制后允许立即revoke，外来或已撤Blob不复活；清除只撤本次私有URL', async () => {
  const r = realm();
  const foreign = r.root.URL.createObjectURL(new Blob(['foreign']));
  const url = r.root.URL.createObjectURL(new Blob(['self.onconnect = () => {};']));
  const worker = new r.root.SharedWorker(url) as any;
  r.root.URL.revokeObjectURL(url);
  assert.match(await worker.script.text(), /importScripts\("blob:/);
  assert.equal((new r.root.SharedWorker(url) as any).url, url);
  disposeRuntimeState(r.root, r.state);
  assert.equal(r.blobs.has(foreign), true);
  assert.equal(r.blobs.size, 1);
});


test('Window相对Worker入口使用baseURI，选项getter修改base后才最终解析', async () => {
  const r = realm();const document = { baseURI: 'https://example.test/assets/' };r.root.document = document as Document;
  const first = new r.root.Worker('worker.js') as any;
  assert.match(await first.script.text(), /example.test\/assets\/worker.js/);
  const second = new r.root.SharedWorker('shared.js', { get name() { document.baseURI = 'https://example.test/changed/'; return 'changed'; } }) as any;
  assert.match(await second.script.text(), /example.test\/changed\/shared.js/);
});


test('Shared扩展寿命选项保持原生转换与加载，getter撤销Blob不从副本复活', () => {
  const r = realm();const url=r.root.URL.createObjectURL(new Blob(['0']));let reads=0;
  const worker = new r.root.SharedWorker(url, { get extendedLifetime() { reads++;r.root.URL.revokeObjectURL(url);return true; } } as any) as any;
  assert.equal(reads,1);assert.equal(worker.url,url);assert.equal(worker.script,undefined);assert.equal(r.blobs.size,0);
});


test('HTTP classic的importScripts按原入口解析，所有DOMString先单次转换，非法receiver先原生拒绝', () => {
  const r=realm();const calls:unknown[][]=[];
  r.root.importScripts=function(this:unknown,...args:unknown[]){if(this!==r.root)throw new TypeError('native receiver');calls.push(args)};
  installWorkerImportScripts(r.root,r.state,'https://example.test/assets/worker.js');
  const order:number[]=[];
  const first={toString(){order.push(1);return './one.js'}},second={toString(){order.push(2);return '../two.js'}};
  r.root.importScripts(first as any,second as any);
  assert.deepEqual(order,[1,2]);assert.deepEqual(calls.at(-1),['https://example.test/assets/one.js','https://example.test/two.js']);
  assert.throws(()=>r.root.importScripts.call({},first as any),/native receiver/);assert.deepEqual(order,[1,2]);
});


test('importScripts非法URL保留原生SyntaxError DOMException，转换一次且不执行前序脚本', () => {
  const r=realm();let loads=0,conversions=0;
  r.root.importScripts=function(this:unknown,...args:unknown[]){
    if(this!==r.root)throw new TypeError('native receiver');
    for(const input of args){try{new URL(String(input),'https://example.test/')}catch{throw new DOMException('native invalid URL','SyntaxError')}}
    loads+=args.length;
  };
  installWorkerImportScripts(r.root,r.state,'https://example.test/assets/worker.js');
  const invalid={toString(){conversions++;return 'http://['}};
  assert.throws(()=>r.root.importScripts('/valid.js',invalid as any),error=>error instanceof DOMException&&error.name==='SyntaxError');
  assert.equal(conversions,1);assert.equal(loads,0);
});
