import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SourceMap } from 'node:module';
import { build } from 'vite';
import type { RollupWatcher } from 'rollup';
import { generateRuntime, generatePageRuntime, assertSelfContainedFunction, projectRoot } from '../build/self-contained-runtime';
import { runtimePlugin } from '../build/runtime-plugin';
import { normalizeTimezonePayload } from '../src/injected/runtime-modules/payload';
import { fontFamilyKey, splitFontFamilies, getFallbackFont } from '../src/injected/runtime-modules/surfaces/font-exposure';
import { FONT_FAMILY_ALIASES, VENDOR_SOFTWARE_FONT_FAMILIES } from '../src/shared/font-families';
import { randomCoordinateInRadius } from '../src/injected/runtime-modules/surfaces/geolocation-permissions';

function page() {
  const context = vm.createContext({ URL, Blob, location: { href: 'https://example.test/' }, addEventListener() {} },
    { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`globalThis.self=globalThis;
    class Navigator { get language(){ if(this!==navigator) throw new TypeError('receiver'); return 'en-US'; }
      get languages(){return ['en-US'];} }
    globalThis.navigator=new Navigator();`, context);
  return context;
}
const payload = { extensionEnabled: true, languageConfig: { enabled: true, language: 'fr-FR', languages: ['fr-FR'] },
  timezoneConfig: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' } };

test('本地字体别名只归入既定43族，过滤后保留普通族或使用自然缺失回退', () => {
  const canonical = new Set(VENDOR_SOFTWARE_FONT_FAMILIES.map(fontFamilyKey));
  assert.equal(VENDOR_SOFTWARE_FONT_FAMILIES.length, 43);
  for (const [alias, family] of Object.entries(FONT_FAMILY_ALIASES)) {
    assert.ok(canonical.has(family), alias);
    assert.equal(fontFamilyKey(`"${alias}"`), family);
  }
  const blocked = new Set(['microsoft yahei', 'pingfang sc']);
  assert.equal(getFallbackFont('12px "微软雅黑", Arial', blocked), '12px Arial');
  assert.equal(getFallbackFont('12px "苹方-简"', blocked), '12px "__vg_absent__"');
  assert.equal(getFallbackFont('12px "微软雅黑 Plus"', blocked), null);
  assert.equal(fontFamilyKey('"Arial Narrow"'), 'arial narrow');
  const prototype = Object.prototype as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(prototype, 'arial');
  try {
    Object.defineProperty(prototype, 'arial', { configurable: true, value: 'misans' });
    assert.equal(fontFamilyKey('Arial'), 'arial');
    assert.equal(fontFamilyKey('constructor'), 'constructor');
    assert.equal(fontFamilyKey('__proto__'), '__proto__');
    assert.equal(getFallbackFont('12px Arial', new Set(['misans'])), null);
  } finally {
    if (previous) Object.defineProperty(prototype, 'arial', previous);
    else delete prototype.arial;
  }
});

test('纯逻辑模块直接导入：timezone、位置和字体解析保持既有合同', () => {
  assert.deepEqual(normalizeTimezonePayload({ timezone: 'UTC' }), { timezone: null });
  assert.deepEqual(normalizeTimezonePayload({ timezone: 'UTC', timezoneConfig: { enabled: true, mode: 'auto', timezone: '' } }), { timezone: 'UTC' });
  assert.equal(fontFamilyKey(' "Arial Narrow" '), 'arial narrow');
  assert.deepEqual(splitFontFamilies('"Font, With Comma", Arial, sans-serif'), ['"Font, With Comma"', 'Arial', 'sans-serif']);
  assert.equal(getFallbackFont('italic 12px "Font, With Comma", monospace', new Set(['font, with comma'])), 'italic 12px monospace');
  assert.equal(getFallbackFont('12px Arial', new Set(['other'])), null);
  assert.deepEqual(randomCoordinateInRadius(12, 23, 0), { latitude: 12, longitude: 23 });
});

test('字体测量仅过滤固定名单，名单外显式字体与混合列表顺序保持', () => {
  const blocked = new Set(VENDOR_SOFTWARE_FONT_FAMILIES.map(fontFamilyKey));
  assert.equal(blocked.size, 43);
  assert.equal(getFallbackFont('20px PingFang   SC', blocked), '20px "__vg_absent__"');
  assert.equal(getFallbackFont('20px "Mi\\53 ans"', blocked), '20px "__vg_absent__"');
  for (const name of VENDOR_SOFTWARE_FONT_FAMILIES) {
    assert.equal(getFallbackFont(`20px "${name}"`, blocked), '20px "__vg_absent__"');
    assert.equal(getFallbackFont(`20px "${name}", Arial, serif`, blocked), '20px Arial, serif');
  }
  for (const font of ['20px Arial', '20px "Mi Sans"', '20px PingFangSC', '20px PingFang\\a0 SC', '20px PingFang\\20\\20SC', '20px PingFang\u00a0SC', '20px MiSans\u00a0', '20px "PingFang  SC"', '20px "Future Font"', '20px "serif"', '20px "Font, With Comma"', '20px "测试字体"', '20px monospace, sans-serif, serif']) {
    assert.equal(getFallbackFont(font, blocked), null);
  }
});

test('构建守卫拒绝外部 helper、动态 import、运行期编译及函数外状态', () => {
  assert.throws(() => assertSelfContainedFunction('function r(){missingHelper()}', 'r'), /外部绑定/);
  for (const body of ['require("node:fs")', 'process.version', 'Buffer.from("x")', 'module.exports', 'exports.value', '__dirname', '{missing}']) {
    assert.throws(() => assertSelfContainedFunction(`function r(){return ${body}}`, 'r'), /外部绑定/);
  }
  assert.throws(() => assertSelfContainedFunction('function r(){return import("external")}', 'r'), /import/);
  assert.throws(() => assertSelfContainedFunction('function r(){return new Function("return 1")}', 'r'), /编译/);
  for (const compiler of ['globalThis.eval', 'globalThis.Function', 'globalThis["eval"]', 'globalThis["Function"]', '(globalThis.Function)']) {
    assert.throws(() => assertSelfContainedFunction(`function r(){return ${compiler}("return 1")}`, 'r'), /编译/);
  }
  assert.throws(() => assertSelfContainedFunction('const hidden=1; function r(){return hidden}', 'r'), /只导出/);
  assert.throws(() => assertSelfContainedFunction('function r(){', 'r'), /语法/);
});

test('禁用或空首次安装不写全局状态，私有句柄更新不热更新页面 surface', async () => {
  const fn = assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime');
  for (const initial of ['undefined', 'null', '{extensionEnabled:false}', '{enabled:false}']) {
    const context = page();
    const globalKeys = vm.runInContext('Reflect.ownKeys(globalThis)', context);
    const controller = vm.runInContext(`(${fn})(${initial})`, context);
    assert.equal(vm.runInContext('navigator.language', context), 'en-US');
    assert.deepEqual(vm.runInContext('Reflect.ownKeys(globalThis)', context), globalKeys);
    controller.update(payload);
    assert.equal(vm.runInContext('navigator.language', context), 'en-US');
  }
});

test('生产 userScripts 独立语言时区与Blob Worker graph不含历史Worker或其他surface', async () => {
  const generated = await generatePageRuntime();
  const fn = assertSelfContainedFunction(generated.code, 'applyLanguageTimezoneRuntime');
  assert.ok(generated.dependencies.some(path => path.endsWith('/language-timezone-entry.ts')));
  assert.ok(generated.dependencies.some(path => path.endsWith('/blob-worker-entry.ts')));
  assert.ok(generated.dependencies.every(path => !/\/(?:font-exposure|geolocation-permissions|workers)\.ts$|\/worker\//.test(path)));
  assert.doesNotMatch(fn, /installFontExposureFilter|installGeolocationSpoof|installWorkerHooks|workerBootstrap/);
  const context = page();
  context.location = { href: 'https://example.test/', protocol: 'https:' };
  context.origin = 'https://example.test';
  vm.runInContext(`this.CanvasRenderingContext2D=class {measureText(){return 'native-width'}};
    this.document={fonts:{check(){return true}}};
    this.nativeMeasure=CanvasRenderingContext2D.prototype.measureText;
    this.nativeCheck=document.fonts.check;
    this.nativeWorker=Worker;`, Object.assign(context, { Worker: undefined }));
  vm.runInContext(`(${fn})(${JSON.stringify({
    language: { language: 'fr-FR', languages: ['fr-FR'] }, timezone: 'Europe/Paris', intlMode: 'strict',
    fontExposureConfig: { enabled: true, mode: 'custom', blockedFamilies: ['MiSans'] }
  })})`, context);
  assert.equal(vm.runInContext('navigator.language', context), 'fr-FR');
  assert.equal(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context), 'Europe/Paris');
  assert.equal(vm.runInContext('CanvasRenderingContext2D.prototype.measureText===nativeMeasure && document.fonts.check===nativeCheck && Worker===nativeWorker', context), true);
});

test('完整页面与 worker 经 facade 二次打包后分别脱离闭包，source map 指回维护 TS', async () => {
  const result = await build({ root: projectRoot, configFile: false, publicDir: false, logLevel: 'silent', plugins: [runtimePlugin()],
    build: { write: false, target: 'es2020', minify: false, sourcemap: true,
      rollupOptions: { input: resolve(projectRoot, 'src/injected/runtime.ts'), preserveEntrySignatures: 'strict',
        output: { format: 'es', entryFileNames: 'runtime.js' } } } });
  assert.ok(!Array.isArray(result) && 'output' in result);
  const chunks = result.output.filter(item => item.type === 'chunk');
  assert.equal(chunks.length, 1);
  const chunk = chunks[0];
  assert.deepEqual(chunk.imports, []);
  assert.deepEqual(chunk.dynamicImports, []);
  const parsed = ts.createSourceFile('runtime.js', chunk.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'applyVanishGeoRuntime');
  assert.ok(declaration);
  const fn = assertSelfContainedFunction(declaration.getText(parsed), 'applyVanishGeoRuntime');
  assert.ok(chunk.exports.includes('pageRuntimeSource'));
  const context = page();
  vm.runInContext(`(${fn})(${JSON.stringify(payload)})`, context);
  assert.equal(vm.runInContext('navigator.language', context), 'fr-FR');
  assert.equal(vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', context), 'Europe/Paris');
  assert.equal(vm.runInContext("Object.getOwnPropertySymbols(globalThis).length", context), 0);
  assert.throws(() => vm.runInContext("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),'language').get.call({})", context), /receiver/);
  // 从实际生成的 Blob prelude 提取第二次序列化函数，独立 worker 中再次生成嵌套 worker。
  const blobs: string[] = [];
  context.URL = class extends URL {
    static createObjectURL(blob: Blob | MediaSource) { blobs.push((blob as unknown as { parts: string[] }).parts.join('')); return 'blob:synthetic'; }
    static revokeObjectURL() {}
  };
  context.Blob = class { constructor(public parts: string[]) {} };
  context.Worker = function Worker() {};
  // 使用新文档，使 constructor 在首次安装时存在。
  const workerPage = page();
  Object.assign(workerPage, { URL: context.URL, Blob: context.Blob, Worker: context.Worker });
  vm.runInContext(`(${fn})(${JSON.stringify(payload)}); new Worker('/classic.js')`, workerPage);
  const prelude = blobs[0].slice(0, blobs[0].lastIndexOf('\nimportScripts('));
  const worker = page();
  Object.assign(worker, { URL: context.URL, Blob: context.Blob, Worker: context.Worker });
  vm.runInContext(prelude, worker);
  assert.equal(vm.runInContext('navigator.language', worker), 'fr-FR');
  assert.equal(vm.runInContext('new Date(Date.UTC(2024,6,1)).getTimezoneOffset()', worker), -120);
  vm.runInContext("new Worker('/nested.js')", worker);
  const nested = page();
  vm.runInContext(blobs[1].slice(0, blobs[1].lastIndexOf('\nimportScripts(')), nested);
  assert.equal(vm.runInContext('navigator.language', nested), 'fr-FR');
  assert.ok(chunk.map);
  const map = JSON.parse(chunk.map.toString());
  assert.ok(map.sources.every((s: string) => !s.startsWith('/') && !s.includes('file:')));
  const sourceMap = new SourceMap(map);
  for (const [token, file] of [['function createRuntimeState', 'registry.ts'], ['function installWorkerDateTime', 'worker/intl-date.ts']]) {
    const position = chunk.code.indexOf(token);
    assert.ok(position > 0);
    const prefix = chunk.code.slice(0, position);
    const entry = sourceMap.findEntry(prefix.split('\n').length - 1, prefix.length - prefix.lastIndexOf('\n') - 1);
    assert.ok('originalSource' in entry, JSON.stringify(entry));
    assert.ok(entry.originalSource?.endsWith(file), JSON.stringify(entry));
    assert.ok((entry.originalLine ?? -1) >= 0);
  }
});

test('build watch 对 page/worker 依赖重建，缺源和循环依赖显式失败', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'vg012-watch-'));
  let watcher: RollupWatcher | undefined;
  try {
    await mkdir(join(temporary, 'src'), { recursive: true });
    await cp(resolve(projectRoot, 'src/injected'), join(temporary, 'src/injected'), { recursive: true });
    await mkdir(join(temporary, 'src/shared'), { recursive: true });
    await cp(resolve(projectRoot, 'src/shared/font-families.ts'), join(temporary, 'src/shared/font-families.ts'));
    await cp(resolve(projectRoot, 'src/shared/font-layers.ts'), join(temporary, 'src/shared/font-layers.ts'));
    // Canvas 字体伪装的平台表在 src/shared，构建期也要能解析到
    await cp(resolve(projectRoot, 'src/shared/canvas-fonts.ts'), join(temporary, 'src/shared/canvas-fonts.ts'));
    const generated = await generateRuntime(temporary);
    assert.ok(generated.dependencies.some(p => p.endsWith('/worker/navigator.ts')));
    const result = await build({ root: temporary, configFile: false, publicDir: false, logLevel: 'silent', plugins: [runtimePlugin(temporary)],
      build: { watch: {}, outDir: join(temporary, 'out'), minify: false,
        rollupOptions: { input: join(temporary, 'src/injected/runtime.ts'), preserveEntrySignatures: 'strict', output: { entryFileNames: 'runtime.js' } } } });
    assert.ok('on' in result);
    watcher = result as RollupWatcher;
    const nextBuild = () => new Promise<void>((done, fail) => {
      const timer = setTimeout(() => { watcher!.off('event', listener); fail(new Error('watch 未重建')); }, 15000);
      const listener = (event: any) => {
        if (event.code === 'END' || event.code === 'ERROR') {
          clearTimeout(timer); watcher!.off('event', listener);
          if (event.code === 'ERROR') fail(event.error); else done();
        }
      };
      watcher!.on('event', listener);
    });
    await nextBuild();
    for (const [file, from, to] of [['surfaces/navigator.ts', "'navigator-language'", "'navigator-language-vg012'"],
      ['worker/navigator.ts', "property === 'language'", "property === 'language-vg012'"]]) {
      const pending = nextBuild();
      const path = join(temporary, 'src/injected/runtime-modules', file);
      await writeFile(path, (await readFile(path, 'utf8')).replace(from, to));
      await pending;
      assert.ok((await readFile(join(temporary, 'out/runtime.js'), 'utf8')).replace(/["']/g, '').includes(to.replace(/["']/g, '')), file);
    }
    await watcher.close(); watcher = undefined;
    const entry = join(temporary, 'src/injected/runtime-modules/entry.ts');
    const original = await readFile(entry, 'utf8');
    await writeFile(entry, "import './missing';\n" + original);
    await assert.rejects(generateRuntime(temporary), /resolve|missing/);
    await writeFile(entry, original);
    const navigator = join(temporary, 'src/injected/runtime-modules/surfaces/navigator.ts');
    await writeFile(navigator, "import '../entry';\n" + await readFile(navigator, 'utf8'));
    await assert.rejects(generateRuntime(temporary), /Circular dependency/);
  } finally { await watcher?.close(); await rm(temporary, { recursive: true, force: true }); }
});
