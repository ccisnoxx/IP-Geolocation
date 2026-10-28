#!/usr/bin/env node
// 烘焙 persona：把一次性的出口画像（经纬度/语言/时区/域名）固化进产物，
// 让 MAIN world 的注入走 manifest 的静态 content_scripts，而不是运行期 userScripts 注册。
//
// 用法：
//   node scripts/build-persona.mjs --dist dist --out dist-persona \
//     --domains claude.ai,chatgpt.com --lat 34.0522 --lon -118.2437 \
//     --timezone America/Los_Angeles --language en-US --languages en-US,en --country "United States"
//   或直接给 --preset us-los-angeles 复用内置环境预设。
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generatePageRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime.ts';
import { freezePersonaManifest } from './lib/persona-artifact.ts';
import { ENVIRONMENT_PRESETS, findEnvironmentPreset } from '../src/shared/environment-presets.ts';
import { normalizeConfig, isValidDomain } from '../src/shared/config-model.ts';
import { buildContentScriptMatchesForDomain } from '../src/shared/config-resolver.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  dist: { type: 'string', default: 'dist' },
  out: { type: 'string', default: 'dist-persona' },
  domains: { type: 'string' },
  preset: { type: 'string' },
  lat: { type: 'string' }, lon: { type: 'string' }, timezone: { type: 'string' },
  language: { type: 'string' }, languages: { type: 'string' }, country: { type: 'string' },
  accuracy: { type: 'string' }, 'intl-mode': { type: 'string' }
} });

const fail = message => { console.error(`persona: ${message}`); process.exit(1); };
const domains = (values.domains || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
if (!domains.length) fail('需要 --domains（逗号分隔，不带通配符）');
for (const domain of domains) {
  if (!isValidDomain(domain)) fail('域名不合法');
}

const preset = values.preset ? findEnvironmentPreset(values.preset) : null;
if (values.preset && !preset) fail(`未知预设：${values.preset}（可选：${ENVIRONMENT_PRESETS.map(item => item.id).join(', ')}）`);
const number = (text, name, fallback) => {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) fail(`${name} 需要数字`);
  return value;
};
const persona = {
  label: preset?.name || 'custom',
  latitude: number(values.lat, '--lat', preset?.latitude ?? 0),
  longitude: number(values.lon, '--lon', preset?.longitude ?? 0),
  accuracy: number(values.accuracy, '--accuracy', 50),
  timezone: values.timezone || preset?.timezone || 'UTC',
  language: values.language || preset?.language || 'en-US',
  languages: (values.languages || preset?.languages?.join(',') || 'en-US,en').split(',').map(item => item.trim()).filter(Boolean),
  country: values.country || preset?.country || '',
  intlMode: values['intl-mode'] === 'compatible' ? 'compatible' : 'strict'
};
if (persona.latitude < -90 || persona.latitude > 90 || persona.longitude < -180 || persona.longitude > 180) fail('坐标超出范围');
if (persona.languages[0] !== persona.language) persona.languages.unshift(persona.language);

const source = resolve(root, values.dist);
const out = resolve(root, values.out);
if (!existsSync(join(source, 'manifest.json'))) fail(`${values.dist} 里没有 manifest.json，请先 npm run build`);

// 复用生产配置模型，保证烘焙进产物的画像与运行期语义一致。
const baked = normalizeConfig({ intlMode: persona.intlMode,
  globalProfile: {
    language: { enabled: true, mode: 'custom', language: persona.language, languages: persona.languages },
    timezone: { enabled: true, mode: 'manual', timezone: persona.timezone },
    geolocation: { enabled: true, mode: 'manual', latitude: persona.latitude, longitude: persona.longitude,
      accuracy: persona.accuracy, country: persona.country, randomize: false }
  } });

await cp(source, out, { recursive: true });
await mkdir(join(out, 'persona'), { recursive: true });
const payload = { intlMode: baked.intlMode, language: { language: persona.language, languages: persona.languages }, timezone: persona.timezone };
const generated = await generatePageRuntime(root, false);
const code = assertSelfContainedFunction(generated.code, 'applyLanguageTimezoneRuntime');
await writeFile(join(out, 'persona', 'page-runtime.js'), `(${code})(${JSON.stringify(payload)});\n`);

const manifestPath = join(out, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const matches = domains.flatMap(buildContentScriptMatchesForDomain);
freezePersonaManifest(manifest, domains);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(out, 'persona', 'persona.json'), JSON.stringify({ persona, domains, bakedAt: 'build-time' }, null, 2) + '\n');
console.log(`persona 产物已生成\n  语言/时区：${persona.language} ${persona.timezone}；配置位置仅保存在本地persona产物中。`);
console.log(`  静态注入：${matches.length} 条 matches → persona/page-runtime.js (MAIN/document_start/all_frames)`);
