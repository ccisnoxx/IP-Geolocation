import { build } from 'vite';
import type { Plugin } from 'vite';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const runtimeModuleId = 'virtual:vanishgeo-runtime';
export const workerModuleId = 'virtual:vanishgeo-worker';
export const pageRuntimeSourceId = 'virtual:vanishgeo-page-runtime-source';
export const geolocationRuntimeSourceId = 'virtual:vanishgeo-geolocation-runtime-source';
export type GeneratedRuntime = { code: string; map: string; dependencies: string[] };

// 只检查被序列化的函数；不能用扩展模块中的其他声明满足其自由变量。
export function assertSelfContainedFunction(code: string, name: string): string {
  // 用 TS 值绑定分析，避免 JS 检查器合成 CommonJS 的 require/module/exports。
  const file = '/vanishgeo-generated.ts';
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const fn = tree.statements[0];
  const pureExport = (node: ts.Statement) => ts.isExportDeclaration(node) && !node.moduleSpecifier
    && node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length === 1
    && node.exportClause.elements[0].name.text === name && !node.exportClause.elements[0].propertyName;
  if (!fn || !ts.isFunctionDeclaration(fn) || fn.name?.text !== name || !fn.body
    || tree.statements.slice(1).some(node => !pureExport(node))) {
    throw new Error(`运行时必须只导出自包含函数 ${name}`);
  }
  const calleeName = (expression: ts.Expression): string | undefined => {
    if (ts.isParenthesizedExpression(expression)) return calleeName(expression.expression);
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression
      && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text;
  };
  const inspect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier
      || ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
      || (ts.isCallExpression(node) || ts.isNewExpression(node))
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || /^(eval|Function)$/.test(calleeName(node.expression) || ''))) {
      throw new Error('运行时包含外部 import 或运行期代码编译');
    }
    ts.forEachChild(node, inspect);
  };
  inspect(fn);
  const options: ts.CompilerOptions = { noEmit: true,
    target: ts.ScriptTarget.ESNext, types: [], skipLibCheck: true, lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === file
    ? tree : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], options, host);
  // 维护 TS 另由 strict typecheck 检查；这里仅证明全部值绑定归属函数或浏览器原生环境。
  const syntax = program.getSyntacticDiagnostics(tree);
  if (syntax.length) throw new Error('运行时函数语法不合法');
  const checker = program.getTypeChecker();
  const unresolved = new Set<string>();
  const inspectBinding = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const propertyOrLabel = ts.isPropertyAccessExpression(parent) && parent.name === node
        || ts.isPropertyAssignment(parent) && parent.name === node
        || ts.isBindingElement(parent) && parent.propertyName === node
        || ts.isExportSpecifier(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent);
      const symbol = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
      if (!propertyOrLabel && !symbol) unresolved.add(node.text);
    }
    ts.forEachChild(node, inspectBinding);
  };
  inspectBinding(fn);
  if (unresolved.size) throw new Error(`运行时存在外部绑定：${[...unresolved].join(', ')}`);
  return `function ${name}(${fn.parameters.map(p => p.getText(tree)).join(', ')}) ${fn.body.getText(tree)}`;
}

async function generateGraph(root: string, worker?: GeneratedRuntime, pageOnly = false, fontOnly = false, geolocationOnly = false, blobWorkerOnly = false, workerFontHookOnly = false, canvasFontsOnly = false): Promise<GeneratedRuntime> {
  const isWorker = !worker && !pageOnly && !fontOnly && !geolocationOnly && !blobWorkerOnly && !workerFontHookOnly && !canvasFontsOnly;
  const name = blobWorkerOnly ? 'applyBlobWorkerRuntime' : workerFontHookOnly ? 'applyWorkerFontHook' : canvasFontsOnly ? 'applyCanvasFontSpoof' : geolocationOnly ? 'applyGeolocationRuntime' : fontOnly ? 'applyFixedFontFilter' : pageOnly ? 'applyLanguageTimezoneRuntime' : isWorker ? 'workerBootstrap' : 'applyVanishGeoRuntime';
  const fileName = blobWorkerOnly ? 'vanishgeo-blob-worker.js' : workerFontHookOnly ? 'vanishgeo-worker-font-hook.js' : canvasFontsOnly ? 'vanishgeo-canvas-fonts.js' : geolocationOnly ? 'vanishgeo-geolocation-runtime.js' : fontOnly ? 'vanishgeo-font-filter.js' : pageOnly ? 'vanishgeo-page-runtime.js' : isWorker ? 'vanishgeo-worker.js' : 'vanishgeo-runtime.js';
  const entry = resolve(root, `src/injected/runtime-modules/${blobWorkerOnly ? 'blob-worker-entry.ts' : workerFontHookOnly ? 'worker-font-hook-entry.ts' : canvasFontsOnly ? 'canvas-fonts-entry.ts' : geolocationOnly ? 'geolocation-entry.ts' : fontOnly ? 'font-exposure-entry.ts' : pageOnly ? 'language-timezone-entry.ts' : `${isWorker ? 'worker/' : ''}entry.ts`}`);
  const virtualEntry = '\0vanishgeo-generation-entry';
  const workerId = resolve(root, 'dist/vanishgeo-worker.js');
  const dependencies = new Set<string>(worker?.dependencies || []);
  const plugin: Plugin = {
    name: 'vanishgeo-static-generation',
    resolveId(source) {
      if (source === virtualEntry) return source;
      if (source === workerModuleId || source === 'virtual:vanishgeo-blob-worker') return workerId;
      if (!source.startsWith('.') && !isAbsolute(source)) throw new Error(`运行时不允许外部模块：${source}`);
    },
    load(id) {
      if (id === virtualEntry) return isWorker
        ? `import { applyWorkerRuntime } from ${JSON.stringify(entry)}; applyWorkerRuntime(patchConfig, workerBootstrap);`
        : `export { ${blobWorkerOnly ? 'applyBlobWorkerRuntime' : workerFontHookOnly ? 'applyWorkerFontHook' : canvasFontsOnly ? 'applyCanvasFontSpoof' : geolocationOnly ? 'applyGeolocationRuntime' : fontOnly ? 'applyFontFilter' : pageOnly ? 'applyPageRuntime' : 'applyRuntime'} } from ${JSON.stringify(entry)};`;
      if (id === workerId && worker) return { code: worker.code, map: worker.map };
    },
    moduleParsed(info) {
      if (!info.id.startsWith('\0') && info.id !== workerId && isAbsolute(info.id)) dependencies.add(info.id);
      if (info.dynamicallyImportedIds.length) throw new Error('运行时模块不允许动态依赖');
    }
  };
  const result = await build({
    root, configFile: false, publicDir: false, logLevel: 'silent', plugins: [plugin],
    build: { write: false, target: 'es2020', minify: false, sourcemap: true,
      rollupOptions: { input: virtualEntry, preserveEntrySignatures: 'strict', onwarn(warning, warn) {
        if (['CIRCULAR_DEPENDENCY', 'UNRESOLVED_IMPORT'].includes(warning.code || '')) throw new Error(warning.message);
        warn(warning);
      }, output: { format: isWorker ? 'es' : 'iife', name: 'runtimeExports', entryFileNames: fileName,
        banner: `export function ${name}(${fontOnly ? '' : canvasFontsOnly ? 'platform' : isWorker ? 'patchConfig' : 'payload'}) {`,
        footer: isWorker ? '}' : `return runtimeExports.${blobWorkerOnly ? 'applyBlobWorkerRuntime' : workerFontHookOnly ? 'applyWorkerFontHook' : canvasFontsOnly ? 'applyCanvasFontSpoof' : geolocationOnly ? 'applyGeolocationRuntime' : fontOnly ? 'applyFontFilter' : pageOnly ? 'applyPageRuntime' : 'applyRuntime'}(${fontOnly || workerFontHookOnly ? '' : canvasFontsOnly ? 'platform' : blobWorkerOnly ? 'payload, applyBlobWorkerRuntime' : 'payload'});\n}`,
        sourcemapPathTransform(source) { return isAbsolute(source) ? relative(root, source).replace(/\\/g, '/') : source; }
      } }
    }
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('运行时生成没有返回单一构建结果');
  const chunks = result.output.filter(item => item.type === 'chunk');
  const chunk = chunks[0];
  if (chunks.length !== 1 || chunk.fileName !== fileName || chunk.imports.length || chunk.dynamicImports.length || !chunk.map) {
    throw new Error('运行时必须是稳定文件名、无 import/dynamic chunk、带 source map 的单一函数');
  }
  assertSelfContainedFunction(chunk.code, name);
  return { code: chunk.code, map: chunk.map.toString(), dependencies: [...dependencies].sort() };
}

export async function generateRuntime(root = projectRoot): Promise<GeneratedRuntime> {
  const worker = await generateGraph(root);
  return generateGraph(root, worker);
}

export async function generatePageRuntime(root = projectRoot): Promise<GeneratedRuntime> {
  const worker = await generateBlobWorkerRuntime(root);
  return generateGraph(root, worker, true);
}

export function generateBlobWorkerRuntime(root = projectRoot): Promise<GeneratedRuntime> {
  return generateGraph(root, undefined, false, false, false, true);
}

export function generateCanvasFontSpoof(root = projectRoot): Promise<GeneratedRuntime> {
  return generateGraph(root, undefined, false, false, false, false, false, true);
}

export async function generateWorkerFontHook(root = projectRoot): Promise<GeneratedRuntime> {
  const worker = await generateGraph(root);
  return generateGraph(root, worker, false, false, false, false, true);
}

export function generateFontFilter(root = projectRoot): Promise<GeneratedRuntime> {
  return generateGraph(root, undefined, false, true);
}

export function generateGeolocationRuntime(root = projectRoot): Promise<GeneratedRuntime> {
  return generateGraph(root, undefined, false, false, true);
}
