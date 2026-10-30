import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { randomBytes } from 'crypto';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { BAKED_RULESET_ID, buildStaticAcceptLanguageRules } from './src/background/dnr';
import { buildContentScriptMatchesForDomain, getEnabledRuleDomains } from './src/shared/config-resolver';

/**
 * 注入脚本（MAIN world）是包成 IIFE 的经典脚本，产物里任何顶层 `import`/`export`
 * 都会让整段脚本语法错误 —— 而且是**静默**失败：页面只是"没有任何补丁"，控制台之外
 * 看不出异常。2026-10-29 就因为 injected 层 import 了 shared/config-model 被 Rollup
 * 拆出 `import '../assets/config-model-xxx.js'`，浏览器 smoke 直挂。
 */
function injectedClassicScriptPlugin() {
  let root = process.cwd();
  let outDir = 'dist';
  return {
    name: 'vanishgeo-injected-classic-script',
    configResolved(config: { root: string; build: { outDir: string } }) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = resolvePath(root, outDir, 'injected/runtime.js');
      if (!existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      if (/^\s*(import|export)\s/m.test(source)) {
        throw new Error(
          `${file} 必须是零 import 的经典脚本：注入层不要 import shared/*，把需要的逻辑内联`
        );
      }
    }
  };
}

/**
 * persona.config.json 由 scripts/build-persona.mjs 在构建前写入，
 * 构建结束后删除。存在时：配置烘焙进注入层、运行时通道关闭。
 */
const personaFile = resolve(__dirname, 'persona.config.json');
const persona = existsSync(personaFile)
  ? JSON.parse(readFileSync(personaFile, 'utf8'))
  : null;
const nonce = (persona && typeof persona.nonce === 'string' && persona.nonce) || randomBytes(12).toString('hex');

// 烘焙构建额外产出一份**静态** DNR 规则集：静态规则在第一条请求之前就生效，
// 不依赖 Service Worker 启动，也就不会出现"启动后第一屏请求没被改写"的空窗。
const bakedRules = persona?.config
  ? buildStaticAcceptLanguageRules(persona.config)
  : null;

// 烘焙域名同时写进 manifest 的静态 content_scripts：静态脚本在渲染进程创建时就注入，
// 动态 registerContentScripts 则可能漏掉会话里的第一次导航（Chromium 156 实测）。
const bakedDomains = persona?.config ? getEnabledRuleDomains(persona.config) : [];

/**
 * 把静态规则写进产物、并把 ruleset 声明打进 manifest。
 * 普通构建（没有 persona.config.json）完全不动 manifest。
 */
function bakedRulesetPlugin(
  rules: chrome.declarativeNetRequest.Rule[] | null,
  domains: string[],
  bridge: boolean
) {
  let root = process.cwd();
  let outDir = 'dist';
  return {
    name: 'vanishgeo-baked-ruleset',
    configResolved(config: { root: string; build: { outDir: string } }) {
      root = config.root;
      outDir = config.build.outDir;
    },
    // viteStaticCopy 在 writeBundle 里落 manifest.json，这里必须排在它之后
    closeBundle() {
      // 没有语言 DNR 规则时，时区和定位仍可能需要静态注入。
      if (!rules) return;
      // outDir 可能是绝对路径（persona 构建写进 ~/.vanishgeo/profiles/...），必须用 resolve
      const dir = resolvePath(root, outDir);
      if (rules.length > 0) {
        mkdirSync(join(dir, 'rules'), { recursive: true });
        writeFileSync(join(dir, 'rules', `${BAKED_RULESET_ID}.json`), `${JSON.stringify(rules, null, 2)}\n`);
      }

      const manifestPath = join(dir, 'manifest.json');
      if (!existsSync(manifestPath)) return;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (rules.length > 0) {
        manifest.declarative_net_request = {
          ...(manifest.declarative_net_request || {}),
          rule_resources: [
            {
              id: BAKED_RULESET_ID,
              enabled: true,
              path: `rules/${BAKED_RULESET_ID}.json`
            }
          ]
        };
      }

      const matches = domains.flatMap((domain) => buildContentScriptMatchesForDomain(domain));
      if (matches.length > 0) {
        // about:blank 匹配与来源回退是不同开关。blob/data 还需要 Chrome119 起的
        // match_origin_as_fallback；这些域名不会再动态注册，不能漏掉静态来源回退。
        const entries: unknown[] = [
          {
            matches,
            js: ['injected/runtime.js'],
            run_at: 'document_start',
            all_frames: true,
            match_about_blank: true,
            match_origin_as_fallback: true,
            world: 'MAIN'
          }
        ];
        if (bridge) {
          // 通道关闭的构建没必要多注入一个隔离世界的空脚本
          entries.push({
            matches,
            js: ['content/content.js'],
            run_at: 'document_start',
            all_frames: true,
            match_about_blank: true,
            match_origin_as_fallback: true
          });
        }
        manifest.content_scripts = entries;
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  };
}

export default defineConfig({
  define: {
    __VANISHGEO_BAKED__: JSON.stringify(persona
      ? { config: persona.config, lastLocation: persona.lastLocation ?? null }
      : null),
    __VANISHGEO_NONCE__: JSON.stringify(nonce),
    __VANISHGEO_BRIDGE__: JSON.stringify(persona ? persona.bridge !== false : true),
    __VANISHGEO_STATIC_RULES__: JSON.stringify(bakedRules),
    __VANISHGEO_STATIC_SCRIPT_DOMAINS__: JSON.stringify(bakedDomains)
  },
  plugins: [
    injectedClassicScriptPlugin(),
    bakedRulesetPlugin(bakedRules, bakedDomains, persona ? persona.bridge !== false : false),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'public/icons/*',
          dest: 'icons'
        },
        {
          src: 'src/popup/popup.html',
          dest: 'popup',
          rename: 'popup.html'
        },
        {
          src: 'src/options/options.html',
          dest: 'options',
          rename: 'options.html'
        },
        {
          src: 'src/leak-test/leak-test.html',
          dest: 'leak-test',
          rename: 'leak-test.html'
        },
        {
          src: 'fixtures',
          dest: '.'
        },
        {
          src: 'LICENSE',
          dest: '.'
        },
        {
          src: 'NOTICE',
          dest: '.'
        }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/content': resolve(__dirname, 'src/content/content.ts'),
        'injected/runtime': resolve(__dirname, 'src/injected/runtime.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'options/options': resolve(__dirname, 'src/options/options.ts'),
        'leak-test/leak-test': resolve(__dirname, 'src/leak-test/leak-test.ts')
      },
      output: {
        entryFileNames: '[name].js',
        // runtime.js 注入到 MAIN world 时是经典脚本：模块顶层的 function/var 会变成
        // window 的可枚举属性，等于告诉页面"这里被动过"。只给这一个入口包 IIFE。
        //
        // 包裹层里再加 `"use strict"`：源码是在 ESM（=strict）语义下写的，Rollup 拍平成
        // 经典 IIFE 时会把隐式 strict 丢掉。sloppy 下每个函数对象都会长出自有
        // `arguments` / `caller`（`Object.getOwnPropertyNames(fn)` 直接可见），原生内建
        // 函数没有这两样，等于给整层补丁盖了个"非原生"的章。
        banner: (chunk) => (chunk.name === 'injected/runtime' ? '(function () {\n"use strict";' : ''),
        footer: (chunk) => (chunk.name === 'injected/runtime' ? '})();' : ''),
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) {
            if (name.includes('popup')) return 'popup/popup.css';
            if (name.includes('options')) return 'options/options.css';
            if (name.includes('leak-test')) return 'leak-test/leak-test.css';
          }
          return 'assets/[name].[hash][extname]';
        }
      },
      // Prevent automatic code splitting by not sharing modules
      preserveEntrySignatures: 'strict'
    },
    target: 'esnext',
    minify: false,
    // Force Rollup to inline shared code instead of creating chunks
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
