import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'vite';
import { buildRuntimeSpike } from '../scripts/runtime-modularization/build-spike';

function detachedFunction(code: string): string {
  const tree = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const fn = tree.statements.find((node): node is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(node) && node.name?.text === 'applyRuntimeSpike'
  ));
  assert.ok(fn?.body, '最终 bundle 必须保留目标函数');
  // 只复制函数，不把 bundle 的其他语句/模块闭包带进页面。
  return `function applyRuntimeSpike(${fn.parameters.map((p) => p.getText(tree)).join(',')}) ${fn.body.getText(tree)}`;
}

function browserContext() {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`
    class Navigator {
      get language() { if (this !== navigator) throw new TypeError('非法 receiver'); return 'en-US'; }
    }
    globalThis.navigator = new Navigator();
  `, context);
  return context;
}

test('普通拆分丢失闭包；静态生成及二次打包的函数独立执行最小 surface', async () => {
  const context = browserContext();
  // 失败对照：扩展模块中可见的 helper 在被复制的函数之外，符合 Chrome 的序列化边界。
  assert.throws(() => vm.runInContext(`(function naive(payload) {
    installLanguage(payload);
  })({language:'fr-FR'})`, context), /installLanguage is not defined/);

  const temporary = await mkdtemp(join(tmpdir(), 'vg011-node-'));
  try {
    const output = await buildRuntimeSpike(temporary);
    const source = await readFile(output, 'utf8');
    // JS 类型解析直接检查整个生成函数，缺失的闭包名字应成为编译错误。
    const program = ts.createProgram([output], {
      allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2020,
      types: [], skipLibCheck: true, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts']
    });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);

    const final = await build({
      configFile: false, publicDir: false, logLevel: 'silent',
      build: { write: false, target: 'es2020', minify: false,
        rollupOptions: { input: output, preserveEntrySignatures: 'strict', output: { format: 'es' } } }
    });
    assert.ok(!Array.isArray(final) && 'output' in final);
    const chunk = final.output.find((item) => item.type === 'chunk');
    assert.ok(chunk && chunk.type === 'chunk');
    assert.deepEqual(chunk.imports, []);
    for (const code of [source, chunk.code]) {
      const page = browserContext();
      const fn = detachedFunction(code);
      vm.runInContext(`(${fn})({language:'fr-FR'}, 'synthetic-document')`, page);
      assert.equal(vm.runInContext('navigator.language', page), 'fr-FR');
      assert.equal(vm.runInContext("Object.hasOwn(navigator, 'language')", page), false);
      assert.throws(() => vm.runInContext("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'language').get.call({})", page), /非法 receiver/);
      assert.throws(() => vm.runInContext(`(${fn})({language:'ja-JP'}, '')`, browserContext()), /缺少文档标识/);
    }
    const map = JSON.parse(await readFile(`${output}.map`, 'utf8'));
    assert.equal(map.version, 3);
    assert.ok(map.mappings.length > 0);
    assert.ok(map.sources.some((s: string) => s.endsWith('/language.ts')));
    assert.ok(map.sources.some((s: string) => s.endsWith('/entry.ts')));
    assert.ok(map.sources.every((s: string) => !s.startsWith('/') && !s.includes('file:')));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
