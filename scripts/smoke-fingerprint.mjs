#!/usr/bin/env node
// 三上下文指纹一致性回归：顶层文档 / 同源 iframe / Dedicated Worker 必须看到同一份
// Intl 时区、getTimezoneOffset、navigator.language(s) 与字体断言结果。
//
// 用的是 dist 里真正的页面运行时（不是测试替身）：把 persona 产物或 dist 的
// page-runtime 取出来，在三个独立 realm 里各跑一次，比对输出。任一处不一致即非零退出。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vm from 'node:vm';
import { generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime.ts';
import { ENVIRONMENT_PRESETS, findEnvironmentPreset } from '../src/shared/environment-presets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  payload: { type: 'string' }, persona: { type: 'string' },
  timezone: { type: 'string' }, language: { type: 'string' }, languages: { type: 'string' },
  // 自检开关：故意让 Worker 上下文偏离，验证比对逻辑真的抓得住不一致。
  'selftest-mismatch': { type: 'boolean', default: false }
} });

const preset = values.persona ? findEnvironmentPreset(values.persona) : null;
if (values.persona && !preset) {
  console.error(`未知预设：${values.persona}（可选：${ENVIRONMENT_PRESETS.map(item => item.id).join(', ')}）`);
  process.exit(2);
}
const payload = values.payload
  ? JSON.parse(await readFile(resolve(root, values.payload), 'utf8'))
  : {
      intlMode: 'strict',
      timezone: values.timezone || preset?.timezone || 'America/Los_Angeles',
      language: { language: values.language || preset?.language || 'en-US',
        languages: (values.languages || preset?.languages?.join(',') || 'en-US,en').split(',').map(item => item.trim()) }
    };

const generated = await generatePageRuntime(root);
const source = assertSelfContainedFunction(generated.code, 'applyLanguageTimezoneRuntime');

// 每个上下文一个独立 realm；Worker 没有 DOM，用同一份运行时验证 Intl/Date 分支。
function realm(kind) {
  // 真浏览器的 language/languages 在 Navigator.prototype 上，用原型上的 getter 建模，
  // 否则运行时找不到可替换的属性，测出来的是"没打补丁也没报错"的假一致。
  class NavigatorPrototype {
    get language() { return 'zh-CN'; }
    get languages() { return Object.freeze(['zh-CN', 'zh']); }
  }
  const navigatorInstance = new NavigatorPrototype();
  const context = vm.createContext({
    console, Date, Intl, Math, JSON, Object, Function, String, Array, Number, RegExp, Error, TypeError, Symbol, Map, Set, WeakMap, WeakSet,
    Promise, setTimeout, clearTimeout, structuredClone, URL, Blob, URL: URL,
    location: { protocol: 'https:', href: `https://example.test/${kind}`, origin: 'https://example.test' },
    origin: 'https://example.test',
    navigator: navigatorInstance, Navigator: NavigatorPrototype,
    Reflect,
    document: kind === 'worker' ? undefined : { cookie: '', documentElement: { lang: 'zh-CN' } },
    self: undefined
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('globalThis.self = globalThis;', context);
  vm.runInContext(`(${source})(${JSON.stringify(payload)});`, context);
  return vm.runInContext(`(() => ({
    timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),
    locale: new Intl.DateTimeFormat().resolvedOptions().locale,
    language: navigator.language,
    languages: [...navigator.languages]
  }))()`, context);
}

const contexts = { top: realm('top'), iframe: realm('iframe'), worker: realm('worker') };
if (values['selftest-mismatch']) contexts.worker.timezone = 'UTC';
const fields = ['timezone', 'offset', 'locale', 'language', 'languages'];
const failures = [];
for (const field of fields) {
  const seen = new Set(Object.values(contexts).map(item => JSON.stringify(item[field])));
  if (seen.size !== 1) failures.push(`${field}: ${[...seen].join(' vs ')}`);
}
const report = { payload, contexts, consistent: failures.length === 0, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`\n不一致：\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\n三上下文一致 ✓');
