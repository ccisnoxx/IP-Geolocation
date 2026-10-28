import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { generatePageRuntime, generateBlobWorkerRuntime, generateRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';

let sources: string[];
before(async () => {
  sources = [
    assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime'),
    assertSelfContainedFunction((await generateBlobWorkerRuntime()).code, 'applyBlobWorkerRuntime'),
    assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime')
  ];
  sources.push(sources[2]);
});

function sample(source: string, timezone: string, probes: string[], maintenanceWorker = false) {
  const blobs: string[] = [];
  class MockBlob { constructor(parts: string[]) { blobs.push(parts.join('')); } }
  class MockURL extends URL { static createObjectURL() { return 'blob:synthetic'; } static revokeObjectURL() {} }
  let realm = vm.createContext({ URL: MockURL, Blob: MockBlob, ...(maintenanceWorker ? { Worker: function Worker() {} } : {}),
    location: { protocol: 'https:', href: 'https://example.test/' }, addEventListener() {} });
  vm.runInContext('globalThis.self = globalThis; globalThis.window = globalThis;', realm);
  vm.runInContext(`(${source})(${JSON.stringify({ timezone, timezoneConfig: { enabled: true, mode: 'manual', timezone }, intlMode: 'compatible' })})`, realm);
  if (maintenanceWorker) {
    vm.runInContext("new Worker('/fixture.js')", realm);
    const prelude = blobs[0].slice(0, blobs[0].lastIndexOf('\nimportScripts('));
    realm = vm.createContext({});
    vm.runInContext('globalThis.self = globalThis;', realm);
    vm.runInContext(prelude, realm);
  }
  return probes.map(probe => JSON.parse(vm.runInContext(`JSON.stringify(${probe})`, realm)));
}

function native(timezone: string, probes: string[]) {
  const source = `const probes=${JSON.stringify(probes)};console.log(JSON.stringify(probes.map(probe=>eval(probe))));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', source], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
}

for (const timezone of ['America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia']) {
  test(`${timezone} 页面、生产Blob、维护runtime 的本地解析及setter与目标时区原生Date一致`, () => {
    const probes = [
      "Date.parse('2026-03-08T02:30:00.123')",
      "Date.parse('2026-11-01T01:30:00')",
      "Date.parse('2011-12-30T12:00:00')",
      "Date.parse('2026-10-04T02:15:00')",
      "new Date(2026,2,8,2,30,0,123).getTime()",
      "new Date('2026-01-01T00:00:00').getTime()",
      "new Date('2026-01-01').getTime()",
      "new Date('0099-01-01T00:00:00').getTime()",
      "Date.parse('2026-01-01T00:00:00+09:00')",
      "Date.parse('2026-01-01T00:00:00.123+09:00')",
      "new Date('2026-01-01T00:00:00.123+09:00').getTime()",
      "Date.parse('2026-01-01T00:00:00.123-0500')",
      "new Date('2026-01-01T00:00:00.123-0500').getTime()",
      "Date.parse('2026-01-01T24:00:00')",
      "Date.parse('Jan 1 2026 00:00:00')",
      "new Date('03/08/2026 02:30:00').getTime()",
      "Date.parse('Jan-01-2026')",
      "Date.parse('Jan 1 2026 00:00:00 EST')",
      "Date.parse('Jan 1 2026 00:00:00 +0900')",
      "Date.parse('Jan 1 2026 00:00:00 GMT+0900 (synthetic)')",
      "Date.parse('Jan 1 2026 (UTC comment) 00:00:00')",
      "(() => { const d=new Date('2026-11-01T06:00:00Z');return [d.setHours(1,30),d.getHours(),d.getMinutes()]; })()",
      "(() => { const d=new Date('2026-03-07T12:30:20Z');return [d.setDate(d.getDate()+1),d.getHours()]; })()",
      "(() => { const d=new Date(NaN);return [d.setFullYear(2026),d.getFullYear()]; })()",
      "(() => { const d=new Date(NaN);return Number.isNaN(d.setMonth(1)); })()",
      "(() => { const d=new Date('2026-01-01T00:00:00Z');return [d.setMonth(2,8),d.setMinutes(75),d.setSeconds(-1),d.setMilliseconds(1500),d.setYear(99)]; })()",
      "(() => { class Derived extends Date {}; const d=new Derived('2026-01-01T00:00:00');return [d instanceof Derived,Object.getPrototypeOf(d)===Derived.prototype,d.getTime()]; })()"
    ];
    const expected = native(timezone, probes);
    for (const [index, source] of sources.entries()) assert.deepEqual(sample(source, timezone, probes, index === 3), expected);
  });
}

test('Date保留转换hint、单次转换、品牌和异常；复制Date保留内部时间值', () => {
  const probes = [
    "(() => { let count=0,hint='';const value={[Symbol.toPrimitive](h){count++;hint=h;return '2026-01-01T00:00:00';}};return [new Date(value).getTime(),count,hint];})()",
    "(() => { let count=0,hint='';const value={[Symbol.toPrimitive](h){count++;hint=h;return '2026-01-01T00:00:00';}};return [Date.parse(value),count,hint];})()",
    "(() => {const original=new Date('2026-01-01T00:00:00.123Z');return new Date(original).getTime();})()",
    "(() => {let converted=false;try{Date.prototype.setHours.call({}, {valueOf(){converted=true;return 1;}});}catch(e){return [e.name,converted];}})()",
    "(() => {const d=new Date('2026-01-01T00:00:00Z');let count=0;const value={valueOf(){count++;d.setTime(1);throw new SyntaxError('synthetic');}};try{d.setHours(value);}catch(e){return [e.name,count,d.getTime()];}})()",
    "(() => {try{new Date(1n,0);}catch(e){return e.name;}})()",
    "(() => {try{Date.parse(Symbol('synthetic'));}catch(e){return e.name;}})()",
    "(() => {const d=new Date('2026-01-01T00:00:00Z');return Number.isNaN(d.setHours());})()"
  ];
  const expected = native('America/New_York', probes);
  for (const [index, source] of sources.entries()) assert.deepEqual(sample(source, 'America/New_York', probes, index === 3), expected);
});
