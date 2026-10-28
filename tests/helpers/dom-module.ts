import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

// 执行整份维护源和真实 HTML；共享依赖使用真实模块，Chrome IPC 由调用方提供。
export async function loadDomModule(source: URL, html: URL, chrome: unknown) {
  const text = await readFile(source, 'utf8');
  const parsed = ts.createSourceFile(source.pathname, text, ts.ScriptTarget.Latest, true);
  const dependencies = new Map<string, unknown>();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.endsWith('.css')) dependencies.set(specifier, {});
    else dependencies.set(specifier, await import(new URL(`${specifier}.ts`, source).href));
  }
  const dom = new JSDOM(await readFile(html, 'utf8'), { url: 'https://extension.test/', runScripts: 'outside-only' });
  const alerts: string[] = [];
  const exports = {};
  Object.assign(dom.window, { chrome, exports, structuredClone,
    alert: (message: string) => alerts.push(message), confirm: () => true,
    require(specifier: string) {
      if (!dependencies.has(specifier)) throw new Error(`测试未加载模块：${specifier}`);
      return dependencies.get(specifier);
    } });
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  try { vm.runInContext(code, dom.getInternalVMContext()); }
  catch (error) { dom.window.close(); throw error; }
  return { dom, window: dom.window, document: dom.window.document, alerts, close: () => dom.window.close() };
}

export async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('DOM 交互未到达预期状态');
}
