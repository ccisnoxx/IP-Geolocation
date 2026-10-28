#!/usr/bin/env node
// Node VM 定向回归：从维护源分别生成页面和 Blob Worker 入口，在独立 JS realm
// 中核对语言、Intl 和 Date 预期。这里不验证浏览器加载、iframe 或 Worker 生命周期。
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generatePageRuntime, generateBlobWorkerRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime.ts';
import { ENVIRONMENT_PRESETS, findEnvironmentPreset } from '../src/shared/environment-presets.ts';
import { sampleFingerprintRealm, fingerprintFailures } from './fingerprint-realms.ts';

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
const workerSource = assertSelfContainedFunction((await generateBlobWorkerRuntime(root)).code, 'applyBlobWorkerRuntime');
const samples = { top: sampleFingerprintRealm(source, payload, 'top'), iframe: sampleFingerprintRealm(source, payload, 'iframe'),
  worker: sampleFingerprintRealm(workerSource, payload, 'worker') };
if (values['selftest-mismatch']) samples.worker.actual.timezone = samples.worker.actual.timezone === 'UTC' ? 'Asia/Tokyo' : 'UTC';
const failures = fingerprintFailures(payload, samples);
const contexts = Object.fromEntries(Object.entries(samples).map(([kind, sample]) => [kind, sample.actual]));
const report = { evidence: 'node-vm-generated-source', payload, contexts, consistent: failures.length === 0, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`\n不一致：\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\n三上下文一致 ✓');
