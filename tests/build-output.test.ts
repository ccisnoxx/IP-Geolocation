import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, type Plugin, type UserConfig } from 'vite';
import { BAKED_RULESET_ID, buildStaticAcceptLanguageRules } from '../src/background/dnr';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config-model';
import { getContentScriptRegistration, getEnabledRuleDomains } from '../src/shared/config-resolver';
import type { SiteSpoofConfig } from '../src/shared/types';

const baseManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

function buildRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'vanishgeo-build-output-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  copyFileSync(new URL('../vite.config.ts', import.meta.url), join(root, 'vite.config.ts'));
  symlinkSync(fileURLToPath(new URL('../src', import.meta.url)), join(root, 'src'), 'dir');
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
  return root;
}

async function loadBuildConfig(root: string, persona?: { config: SiteSpoofConfig; bridge: boolean }) {
  if (persona) writeFileSync(join(root, 'persona.config.json'), JSON.stringify(persona));
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'vite.config.ts'));
  assert.ok(loaded);
  return loaded.config;
}

function buildPlugin(config: UserConfig, name: string): Plugin {
  const plugin = config.plugins?.find((item): item is Plugin => (
    Boolean(item && typeof item === 'object' && 'name' in item && item.name === name)
  ));
  assert.ok(plugin, `构建配置必须注册 ${name}`);
  return plugin;
}

async function buildRuntime(root: string, outDir: string, plugins: Plugin[], source = 'globalThis.fixtureValue = 1;') {
  const entry = join(root, 'runtime.js');
  writeFileSync(entry, source);
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'silent',
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: entry,
        external: ['fixture-module'],
        output: { entryFileNames: 'injected/runtime.js' }
      }
    }
  });
}

function manifestPlugin(): Plugin {
  return {
    name: 'fixture-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(baseManifest) });
    }
  };
}

function personaConfig(languageEnabled: boolean) {
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    masterEnabled: true,
    globalProfile: {
      language: { ...DEFAULT_CONFIG.globalProfile.language, enabled: languageEnabled },
      timezone: { ...DEFAULT_CONFIG.globalProfile.timezone, enabled: true, mode: 'manual', timezone: 'Asia/Tokyo' },
      geolocation: {
        ...DEFAULT_CONFIG.globalProfile.geolocation,
        enabled: true,
        mode: 'manual',
        latitude: 35.6895,
        longitude: 139.6917
      }
    },
    rules: [{
      id: 'fixture-domain',
      domain: 'example.com',
      enabled: true,
      overrides: {
        language: { mode: 'inherit', value: null },
        timezone: { mode: 'inherit', value: null },
        geolocation: { mode: 'inherit', value: null }
      }
    }]
  });
}

for (const absolute of [false, true]) {
  test(`经典脚本校验读取 Vite 实际的${absolute ? '绝对' : '相对'} outDir 并拒绝模块产物`, async (t) => {
    const root = buildRoot(t);
    const outDir = absolute ? join(root, 'absolute-output') : 'relative-output';
    const runtimePath = resolve(root, outDir, 'injected/runtime.js');
    const config = await loadBuildConfig(root);
    await assert.rejects(
      buildRuntime(root, outDir, [buildPlugin(config, 'vanishgeo-injected-classic-script')],
        'import { value } from "fixture-module"; globalThis.fixtureValue = value;'),
      (error: Error) => {
        assert.ok(error.message.includes(runtimePath), '错误应指出本次构建的实际产物');
        assert.ok(error.message.includes('经典脚本'));
        return true;
      }
    );
    assert.ok(readFileSync(runtimePath, 'utf8').includes('fixture-module'), '失败断言针对真实生成的模块产物');
  });
}

test('经典脚本校验允许自定义目录的经典产物，不读取旧 dist 产物', async (t) => {
  const root = buildRoot(t);
  mkdirSync(join(root, 'dist/injected'), { recursive: true });
  writeFileSync(join(root, 'dist/injected/runtime.js'), 'export const stale = true;');
  const config = await loadBuildConfig(root);
  await buildRuntime(root, 'custom-output', [buildPlugin(config, 'vanishgeo-injected-classic-script')]);
  assert.equal(readFileSync(join(root, 'custom-output/injected/runtime.js'), 'utf8').trim(), 'globalThis.fixtureValue = 1;');
});

for (const bridge of [false, true]) {
  test(`关闭语言的 persona 仍生成时区与定位静态注入，bridge=${bridge}`, async (t) => {
    const root = buildRoot(t);
    const outDir = join(root, 'persona-output');
    const config = personaConfig(false);
    const rules = buildStaticAcceptLanguageRules(config);
    const domains = getEnabledRuleDomains(config);
    const buildConfig = await loadBuildConfig(root, { config, bridge });
    assert.deepEqual(rules, [], '关闭语言后没有 Accept-Language DNR 规则');
    assert.deepEqual(JSON.parse(buildConfig.define!.__VANISHGEO_STATIC_SCRIPT_DOMAINS__), domains);
    assert.deepEqual(getContentScriptRegistration(config, domains).matches, [], '后台依赖这些域名已被静态注入');
    await buildRuntime(root, outDir, [buildPlugin(buildConfig, 'vanishgeo-baked-ruleset'), manifestPlugin()]);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    const main = {
      matches: ['*://example.com/*', '*://*.example.com/*'],
      js: ['injected/runtime.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
      world: 'MAIN'
    };
    assert.deepEqual(manifest.content_scripts, bridge ? [main, {
      matches: main.matches,
      js: ['content/content.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true
    }] : [main]);
    assert.equal(manifest.declarative_net_request, undefined);
    assert.equal(existsSync(join(outDir, 'rules', `${BAKED_RULESET_ID}.json`)), false);
  });
}

test('启用语言的 persona 同时生成 DNR 与静态注入', async (t) => {
  const root = buildRoot(t);
  const config = personaConfig(true);
  const rules = buildStaticAcceptLanguageRules(config);
  const buildConfig = await loadBuildConfig(root, { config, bridge: false });
  assert.ok(rules.length > 0);
  await buildRuntime(root, 'language-output', [buildPlugin(buildConfig, 'vanishgeo-baked-ruleset'), manifestPlugin()]);
  const outDir = join(root, 'language-output');
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.declarative_net_request.rule_resources, [{
    id: BAKED_RULESET_ID,
    enabled: true,
    path: `rules/${BAKED_RULESET_ID}.json`
  }]);
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'rules', `${BAKED_RULESET_ID}.json`), 'utf8')), rules);
  assert.deepEqual(manifest.content_scripts[0].matches, ['*://example.com/*', '*://*.example.com/*']);
});

test('普通构建不增加 persona 的静态规则或注入', async (t) => {
  const root = buildRoot(t);
  const config = await loadBuildConfig(root);
  await buildRuntime(root, 'plain-output', [buildPlugin(config, 'vanishgeo-baked-ruleset'), manifestPlugin()]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'plain-output/manifest.json'), 'utf8')), baseManifest);
});

test('注入层产物是 IIFE 且显式 strict —— sloppy 会给每个函数加 arguments/caller', async (t) => {
  const root = buildRoot(t);
  const config = await loadBuildConfig(root);
  const output = config.build?.rollupOptions?.output as {
    banner?: (chunk: { name: string }) => string;
    footer?: (chunk: { name: string }) => string;
  };
  assert.ok(output.banner && output.footer, '必须声明 banner / footer');
  // 源码是 ESM（隐式 strict）语义，Rollup 拍平成经典 IIFE 时会把 strict 丢掉。
  // sloppy 下 `Object.getOwnPropertyNames(fn)` 会多出 arguments / caller，
  // 原生内建函数没有这两样 —— 等于给整层补丁盖了个"非原生"的章。
  assert.match(output.banner({ name: 'injected/runtime' }), /^\(function \(\) \{\n"use strict";$/);
  assert.equal(output.footer({ name: 'injected/runtime' }), '})();');
  // 其它入口是正常模块产物，不能被包一层
  assert.equal(output.banner({ name: 'content/content' }), '');
  assert.equal(output.footer({ name: 'content/content' }), '');
});
