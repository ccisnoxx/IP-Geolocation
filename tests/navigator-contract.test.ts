import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { generateRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import type { RuntimeController, RuntimeGlobals } from '../src/injected/runtime-modules/types';
import type { captureNavigatorContract } from './helpers/navigator-contract';

type Probe = ReturnType<typeof captureNavigatorContract>;
const payload = { extensionEnabled: true,
  languageConfig: { enabled: true, language: 'fr-FR', languages: ['fr-FR', 'fr'] } };
let runtime: string;
let probeSource: string;
before(async () => {
  runtime = assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime');
  const source = await readFile(new URL('./helpers/navigator-contract.ts', import.meta.url), 'utf8');
  probeSource = assertSelfContainedFunction(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }
  }).outputText, 'captureNavigatorContract');
});

function realm(brand = new WeakSet<object>()) {
  const blobs: string[] = [];
  const context = vm.createContext({ URL: class extends URL {
    static createObjectURL(blob: Blob) { blobs.push((blob as unknown as { parts: string[] }).parts.join('')); return 'blob:contract'; }
    static revokeObjectURL() {}
  }, Blob: class { constructor(public parts: string[]) {} }, location: { href: 'https://example.test/' },
    addEventListener() {}, Worker: function Worker() {}, brand });
  vm.runInContext(`this.window=this;this.self=this;
    this.Navigator=class Navigator {
      constructor(){brand.add(this)}
      get language(){if(!brand.has(this))throw new TypeError('非法 receiver');return 'en-US'}
      get languages(){if(!brand.has(this))throw new TypeError('非法 receiver');return Object.freeze(['en-US'])}
    };
    this.navigator=new Navigator();`, context);
  const globals = vm.runInContext('globalThis', context) as RuntimeGlobals;
  const probe = vm.runInContext(`(${probeSource})()`, context) as Probe;
  const install = vm.runInContext(`(${runtime})`, context) as (value: unknown) => RuntimeController;
  return { context, globals, probe, install, blobs };
}

function assertContract(probe: Probe, extra: unknown[] = [], foreignKeys?: typeof Reflect.ownKeys) {
  const result = probe.inspect(extra, foreignKeys);
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'boolean') assert.equal(value, true, key);
  }
  assert.equal(result.language, 'fr-FR');
  assert.deepEqual(Array.from(result.languages), ['fr-FR', 'fr']);
}

function assertMutations(probe: Probe) {
  const result = probe.mutate();
  for (const [key, value] of Object.entries(result)) assert.equal(value, true, key);
}

test('生成页面 runtime 不暴露状态、不替换反射 API，descriptor 跟随替换/删除/freeze', () => {
  const page = realm();
  page.install(payload);
  assertContract(page.probe);
  assertMutations(page.probe);
});

test('iframe 各 realm 独立安装，合法跨 realm receiver 和另一 realm 的反射保持原生', () => {
  const brand = new WeakSet<object>();
  const top = realm(brand), frame = realm(brand);
  frame.install(payload);
  assert.equal(top.globals.navigator.language, 'en-US');
  assertContract(frame.probe, [top.globals.navigator], top.globals.Reflect.ownKeys);
  top.install(payload);
  assertContract(top.probe, [frame.globals.navigator], frame.globals.Reflect.ownKeys);
  assertContract(frame.probe, [top.globals.navigator], top.globals.Reflect.ownKeys);
  assertMutations(frame.probe);
  assert.equal(top.globals.navigator.language, 'fr-FR');
});

test('实际生成 Worker prelude 保持全局状态、反射和 getter receiver 合同', () => {
  const page = realm();
  page.install(payload);
  vm.runInContext("new Worker('/worker.js')", page.context);
  const prelude = page.blobs[0].slice(0, page.blobs[0].lastIndexOf('\nimportScripts('));
  const worker = realm();
  vm.runInContext(prelude, worker.context);
  assertContract(worker.probe);
  assertMutations(worker.probe);
});
