import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import ts from 'typescript';
import { generateRuntime, runtimeModuleId, projectRoot, assertSelfContainedFunction } from './self-contained-runtime';
import type { GeneratedRuntime } from './self-contained-runtime';

export function runtimePlugin(root = projectRoot): Plugin {
  let generated: GeneratedRuntime;
  const resolvedId = resolve(root, 'src/injected/vanishgeo-runtime.generated.js');
  return {
    name: 'vanishgeo-runtime',
    async buildStart() {
      // 安全暂停期间也校验维护源；不把 runtime 加入生产派发或发布入口。
      generated = await generateRuntime(root);
      generated.dependencies.forEach(path => this.addWatchFile(path));
    },
    resolveId(id) { if (id === runtimeModuleId) return resolvedId; },
    load(id) { if (id === resolvedId) {
      const map = JSON.parse(generated.map);
      map.sources = map.sources.map((source: string) => resolve(root, 'dist', source));
      return { code: generated.code, map };
    } },
    shouldTransformCachedModule({ id }) { return id === resolvedId; },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        if (item.dynamicImports.length) this.error('扩展构建不允许动态 chunk');
        // 恢复派发的独立任务若重新接入 facade，仍必须检查最终后台函数。
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
