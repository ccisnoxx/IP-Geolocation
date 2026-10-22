import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRuntimeState } from '../src/injected/runtime-modules/registry';
import { installLanguageSpoof } from '../src/injected/runtime-modules/surfaces/navigator';
import { installDateTimeSpoof } from '../src/injected/runtime-modules/surfaces/intl-date';
import { buildWorkerPatchSource, installWorkerHooks } from '../src/injected/runtime-modules/surfaces/workers';
import { createWorkerState } from '../src/injected/runtime-modules/worker/registry';
import { installWorkerNavigator } from '../src/injected/runtime-modules/worker/navigator';
import { installWorkerDateTime } from '../src/injected/runtime-modules/worker/intl-date';
import { installNestedWorker } from '../src/injected/runtime-modules/worker/nested-worker';
import type { RuntimeGlobals } from '../src/injected/runtime-modules/types';

function realm() {
  const context = vm.createContext({ URL, Blob, addEventListener() {}, location: { href: 'https://example.test/' } });
  vm.runInContext(`this.self=this;
    class Navigator {get language(){return 'en-US'} get languages(){return ['en-US']}}
    this.navigator=new Navigator();`, context);
  return { context, globals: vm.runInContext('globalThis', context) as RuntimeGlobals };
}

test('页面模块可直接注入 realm/state，反射与 navigator/Intl 无模块级副作用', () => {
  const { context, globals } = realm();
  const other = realm();
  const state = createRuntimeState(globals);
  assert.notEqual(createRuntimeState(globals), state);
  installLanguageSpoof(globals, state, 'fr-FR', ['fr-FR']);
  installDateTimeSpoof(globals, state, { language: 'fr-FR', timezone: 'Europe/Paris' });
  assert.equal(vm.runInContext('navigator.language', context), 'fr-FR');
  assert.equal(vm.runInContext('new Date(Date.UTC(2024,0,15)).getTimezoneOffset()', context), -60);
  assert.equal(vm.runInContext('navigator.language', other.context), 'en-US');
  const source = buildWorkerPatchSource({ languageConfig: { enabled: true, language: 'ja-JP', languages: ['ja-JP'] } }, function workerBootstrap() {});
  assert.doesNotMatch(source, /stateKey/);
  installWorkerHooks(globals, state, source);
  assert.equal(state.workerPatchSource, source);
  assert.equal(state.installedSurfaces.has('worker'), true);
});

test('worker 各模块直接消费显式 patch/state，nested wrapper 使用显式自引用', () => {
  const { context, globals } = realm();
  const patch = { language: 'ja-JP', languages: ['ja-JP'], timezone: 'Asia/Tokyo' };
  const state = createWorkerState(globals);
  installWorkerNavigator(state, patch);
  installWorkerDateTime(state, patch);
  assert.equal(vm.runInContext('navigator.language', context), 'ja-JP');
  assert.equal(vm.runInContext('new Date(Date.UTC(2024,0,15)).getTimezoneOffset()', context), -540);
  const nativeWorker = function Worker() {};
  (globals as Record<string, any>).Worker = nativeWorker;
  installNestedWorker(state, patch, function workerBootstrap() {});
  assert.notEqual(globals.Worker, nativeWorker);
  assert.match(vm.runInContext('Function.prototype.toString.call(Worker)', context), /\[native code\]/);
});
