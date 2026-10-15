// 隔离的构建验证；不读取生产 Vite 配置，不写 dist，不改变生产注入入口。
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildRuntimeSpike(outputDir: string): Promise<string> {
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      target: 'es2020',
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'tests/fixtures/runtime-modularization/entry.ts'),
        output: {
          format: 'es',
          entryFileNames: 'runtime-spike.js',
          inlineDynamicImports: true,
          // 静态生成的函数声明；没有在扩展或页面运行时编译字符串。
          banner: 'export function applyRuntimeSpike(payload, documentStateKey) {',
          footer: '}'
        }
      }
    }
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('spike 构建未返回单一输出');
  const chunks = result.output.filter((item) => item.type === 'chunk');
  const chunk = chunks[0];
  if (chunks.length !== 1 || chunk.imports.length || chunk.dynamicImports.length || !chunk.map) {
    throw new Error('spike 必须生成带 source map、无外部依赖的单一函数');
  }
  const tree = ts.createSourceFile(chunk.fileName, chunk.code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const isExport = (node: ts.Statement) => ts.isExportDeclaration(node) && !node.moduleSpecifier
    && node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length === 1
    && node.exportClause.elements[0].name.text === 'applyRuntimeSpike'
    && !node.exportClause.elements[0].propertyName;
  // Vite 的最终 esbuild pass 会把 export function 改写为末尾具名 export。
  if (!ts.isFunctionDeclaration(tree.statements[0]) || tree.statements[0].name?.text !== 'applyRuntimeSpike'
    || tree.statements.slice(1).some((node) => !isExport(node))) {
    throw new Error('spike 生成结果含函数体之外的语句');
  }
  await mkdir(outputDir, { recursive: true });
  const output = resolve(outputDir, chunk.fileName);
  await writeFile(output, chunk.code);
  await writeFile(`${output}.map`, chunk.map.toString());
  return output;
}
