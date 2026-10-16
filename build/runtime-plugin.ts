import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import ts from 'typescript';
import { generateRuntime, generatePageRuntime, pageRuntimeSourceId, runtimeModuleId, projectRoot, assertSelfContainedFunction } from './self-contained-runtime';
import type { GeneratedRuntime } from './self-contained-runtime';

export function runtimePlugin(root = projectRoot): Plugin {
  let generated: GeneratedRuntime;
  let page: GeneratedRuntime;
  const resolvedId = resolve(root, 'src/injected/vanishgeo-runtime.generated.js');
  const pageId = resolve(root, 'src/injected/page-runtime-source.generated.js');
  return {
    name: 'vanishgeo-runtime',
    async buildStart() {
      // 完整隔离 graph 与生产语言/时区 graph 均在构建期执行自包含守卫。
      generated = await generateRuntime(root);
      page = await generatePageRuntime(root);
      generated.dependencies.forEach(path => this.addWatchFile(path));
      page.dependencies.forEach(path => this.addWatchFile(path));
    },
    resolveId(id) { if (id === runtimeModuleId) return resolvedId; if (id === pageRuntimeSourceId) return pageId; },
    load(id) {
      if (id === pageId) return `export const pageRuntimeSource = ${JSON.stringify(assertSelfContainedFunction(page.code, 'applyLanguageTimezoneRuntime'))};`;
      if (id === resolvedId) {
        const map = JSON.parse(generated.map);
        map.sources = map.sources.map((source: string) => resolve(root, 'dist', source));
        return { code: generated.code, map };
      }
    },
    shouldTransformCachedModule({ id }) { return id === resolvedId || id === pageId; },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        if (item.dynamicImports.length) this.error('扩展构建不允许动态 chunk');
        // 完整 facade 在隔离打包中使用时，继续检查最终函数脱离模块闭包。
        if (item.code.includes('function applyVanishGeoRuntime(')) {
          const start = item.code.indexOf('function applyVanishGeoRuntime(');
          const tail = item.code.slice(start);
          // 使用解析器取得函数，拒绝其对最终 bundle 的闭包依赖。
          const tree = ts.createSourceFile('final.js', tail, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
          const fn = tree.statements[0];
          if (!ts.isFunctionDeclaration(fn)) this.error('最终 runtime 函数缺失');
          assertSelfContainedFunction(fn.getText(tree), 'applyVanishGeoRuntime');
        }
      }
    }
  };
}
