import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { runtimePlugin } from './build/runtime-plugin';

export default defineConfig({
  plugins: [
    runtimePlugin(),
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
          src: 'src/diagnostic/report.html',
          dest: 'diagnostic'
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
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'options/options': resolve(__dirname, 'src/options/options.ts'),
        'leak-test/leak-test': resolve(__dirname, 'src/leak-test/leak-test.ts'),
        'diagnostic/report': resolve(__dirname, 'src/diagnostic/report.ts')
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) {
            if (name.includes('report')) return 'diagnostic/report.css';
            if (name.includes('popup')) return 'popup/popup.css';
            if (name.includes('options')) return 'options/options.css';
            if (name.includes('leak-test')) return 'leak-test/leak-test.css';
          }
          return 'assets/[name].[hash][extname]';
        }
      },
      // 保持扩展入口文件名稳定。
      preserveEntrySignatures: 'strict'
    },
    target: 'esnext',
    minify: false,
    // 共享 assets chunks 随整个 dist 分发；MAIN 函数另由生成器保证自包含。
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
