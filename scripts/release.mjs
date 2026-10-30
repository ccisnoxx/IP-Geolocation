#!/usr/bin/env node
/*
 * 发布流水线：烘焙 → 校验 → 打包 → 记账。
 *
 *   node scripts/release.mjs --preset=singapore
 *   node scripts/release.mjs --preset=us-west,singapore,japan --frozen
 *   node scripts/release.mjs --all-presets
 *   node scripts/release.mjs --persona=us-la-1
 *   node scripts/release.mjs --check=release/vanishgeo-1.2.1-singapore.zip
 *
 * 为什么不直接把 dist/ 交出去：开发构建的配置要经一次异步 IPC 才进到页面，页面的
 * 第一个内联脚本可能在它之前执行 —— 这个窗口没法在运行时关掉，只能在构建期烘焙。
 * 所以"发布"这一步的默认行为就是烘焙，不是打包 dist/。
 *
 * 三道闸，任一不过就不出包：
 *   1. 产物校验：runtime.js 里必须真的有目标时区/语言，且仍是经典脚本
 *   2. 版本一致：manifest.json 与 package.json 必须同版本
 *   3. 静态规则：rules/baked-language.json 非空（否则首帧请求还是要等 SW）
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromPersona, configFromPreset, releaseFileName, resolveDomains, verifyBakedRuntime } from './lib/bake-plan.mjs';
import { readPresets } from './lib/presets.mjs';
import { createZip } from './lib/zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseRoot = resolve(ROOT, String(argv.out || 'release'));
const frozen = argv.frozen === true;
const debug = argv.debug === true;
const keepBuild = argv.keep === true;
const defaultDomains = JSON.parse(readFileSync(join(ROOT, 'src', 'shared', 'default-domains.json'), 'utf8'));
const domains = resolveDomains(defaultDomains, argv.domains);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------- 目标解析 ----------

function presetTargets() {
  // 预设清单只在 TS 里有一份，抽取逻辑收在 lib/presets.mjs 里，两个消费方共用：
  // 配置来源必须唯一，多写一份 JSON 迟早对不上。
  return readPresets(ROOT);
}

function personaTargets(names) {
  const dir = join(homedir(), '.vanishgeo', 'personas');
  const wanted = names.length ? names : null;
  if (wanted) {
    return wanted.map((name) => {
      const file = join(dir, `${name}.json`);
      if (!existsSync(file)) fail(`找不到 persona：${file}\n先跑一次 node tools/chrome-env.mjs --persona=${name}`);
      return { label: name, config: configFromPersona(JSON.parse(readFileSync(file, 'utf8')), { domains, debug }) };
    });
  }
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const name = file.replace(/\.json$/, '');
      return { label: name, config: configFromPersona(JSON.parse(readFileSync(join(dir, file), 'utf8')), { domains, debug }) };
    });
}

function buildTargets() {
  const presets = presetTargets();
  const targets = [];

  if (argv['all-presets'] === true) {
    for (const preset of presets) {
      targets.push({ label: preset.id, config: configFromPreset(preset, { domains, debug }) });
    }
  }
  if (argv['all-personas'] === true) {
    targets.push(...personaTargets([]));
  }
  if (argv.preset) {
    const wanted = String(argv.preset).split(',').map((item) => item.trim()).filter(Boolean);
    for (const id of wanted) {
      const preset = presets.find((item) => item.id === id);
      if (!preset) fail(`未知 preset：${id}\n可选：${presets.map((item) => item.id).join(', ')}`);
      targets.push({ label: preset.id, config: configFromPreset(preset, { domains, debug }) });
    }
  }
  if (argv.persona) {
    targets.push(...personaTargets(String(argv.persona).split(',').map((item) => item.trim()).filter(Boolean)));
  }
  if (argv.config) {
    const file = resolve(ROOT, String(argv.config));
    if (!existsSync(file)) fail(`找不到配置文件：${file}`);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const config = parsed.config || parsed;
    const label = String(argv.label || parsed.label || 'custom');
    targets.push({ label, config });
  }
  // --label 只改产物名，不改内容：同一份配置想并存几个变体时用得上
  const label = argv.label ? String(argv.label) : null;
  return label ? targets.map((target) => ({ ...target, label })) : targets;
}

// ---------- 打包 ----------

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else out.push({ path: relative(base, full).split(sep).join('/'), data: readFileSync(full) });
  }
  return out;
}

function buildOnce(target) {
  const buildDir = join(releaseRoot, '.build', target.label);
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  const payload = {
    config: target.config,
    lastLocation: null,
    bridge: !frozen,
    nonce: randomBytes(12).toString('hex')
  };
  const personaFile = join(ROOT, 'persona.config.json');
  writeFileSync(personaFile, JSON.stringify(payload, null, 2));
  try {
    execFileSync(process.execPath, [
      join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--outDir',
      buildDir,
      '--emptyOutDir',
      '--logLevel',
      'warn'
    ], { cwd: ROOT, stdio: 'inherit' });
  } finally {
    rmSync(personaFile, { force: true });
  }
  return buildDir;
}

function verifyBuild(buildDir, target) {
  const runtimePath = join(buildDir, 'injected', 'runtime.js');
  if (!existsSync(runtimePath)) fail(`${target.label}: 产物里没有 injected/runtime.js`);
  const runtime = readFileSync(runtimePath, 'utf8');
  const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8'));
  let rules = null;
  const rulesPath = join(buildDir, 'rules', 'baked-language.json');
  if (existsSync(rulesPath)) rules = JSON.parse(readFileSync(rulesPath, 'utf8'));

  const result = verifyBakedRuntime(runtime, {
    timezone: target.config.globalProfile.timezone.timezone,
    locale: target.config.globalProfile.language.language,
    version,
    manifestVersion: manifest.version,
    rules
  });
  if (!result.ok) {
    fail(`${target.label}: 产物校验没过\n  - ${result.problems.join('\n  - ')}`);
  }
  return { manifest, ruleCount: Array.isArray(rules) ? rules.length : 0 };
}

function releaseOne(target) {
  const buildDir = buildOnce(target);
  const { manifest, ruleCount } = verifyBuild(buildDir, target);

  const files = walk(buildDir);
  const zipBuffer = createZip(files);
  const zipName = releaseFileName({ version, label: target.label, frozen });
  const zipPath = join(releaseRoot, zipName);
  writeFileSync(zipPath, zipBuffer);

  const manifestPath = join(releaseRoot, `${zipName.replace(/\.zip$/, '')}.json`);
  const summary = {
    name: zipName,
    version,
    label: target.label,
    frozen,
    builtAt: new Date().toISOString(),
    git: gitDescribe(),
    sha256: createHash('sha256').update(zipBuffer).digest('hex'),
    bytes: zipBuffer.length,
    fileCount: files.length,
    manifestVersion: manifest.version,
    timezone: target.config.globalProfile.timezone.timezone,
    locale: target.config.globalProfile.language.language,
    // 完整 languages 列表也要记账：发布验收要断言 navigator.languages 整串，
    // 只记首选语言时只能从包内字面量反推 —— 反推是"尽力而为"，记账是"发布意图"。
    languages: [...target.config.globalProfile.language.languages],
    acceptLanguage: target.config.globalProfile.language.acceptLanguage,
    coordinates: [
      target.config.globalProfile.geolocation.latitude,
      target.config.globalProfile.geolocation.longitude
    ],
    staticRules: ruleCount,
    domains: target.config.rules.map((rule) => rule.domain)
  };
  writeFileSync(manifestPath, JSON.stringify(summary, null, 2));
  if (!keepBuild) rmSync(buildDir, { recursive: true, force: true });

  return { summary, zipPath };
}

function gitDescribe() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

// ---------- 校验已有包 ----------

function checkExisting(target) {
  const path = resolve(ROOT, target);
  if (!existsSync(path)) fail(`找不到：${path}`);
  const workDir = mkdtempSync(join(tmpdir(), 'vanishgeo-check-'));
  try {
    execFileSync('unzip', ['-q', path, '-d', workDir], { stdio: 'inherit' });
    const runtime = readFileSync(join(workDir, 'injected', 'runtime.js'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'));
    const rulesPath = join(workDir, 'rules', 'baked-language.json');
    const rules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : null;
    // 没有期望值时只查"是不是烘焙构建"：把时区从 manifest 的静态规则里读不出来，
    // 所以这里退一步，只要求 runtime.js 里出现任何 IANA 时区名。
    const timezone = runtime.match(/["'](?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?["']/)?.[0]?.replace(/["']/g, '');
    if (!timezone) {
      fail(`${path}: runtime.js 里没有任何时区字面量，这不是烘焙构建`);
    }
    const result = verifyBakedRuntime(runtime, {
      timezone,
      locale: '',
      version,
      manifestVersion: manifest.version,
      rules
    });
    if (!result.ok) fail(`${path}: 校验失败\n  - ${result.problems.join('\n  - ')}`);
    console.log(`✓ ${path}`);
    console.log(`  version ${manifest.version} · 时区 ${timezone} · 静态规则 ${Array.isArray(rules) ? rules.length : 0} 条`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------- 主流程 ----------

if (argv.help || (!argv.check && !argv.preset && !argv.persona && !argv.config && argv['all-presets'] !== true && argv['all-personas'] !== true)) {
  console.log(`用法：
  node scripts/release.mjs --preset=<id[,id...]>      内置 preset
  node scripts/release.mjs --all-presets              全部内置 preset
  node scripts/release.mjs --persona=<name>           ~/.vanishgeo/personas/<name>.json
  node scripts/release.mjs --all-personas             全部 persona
  node scripts/release.mjs --config=<file>            直接给配置
  node scripts/release.mjs --check=<zip>              校验已有产物

选项：
  --frozen        关掉运行时通道（配置彻底冻结，选项页改动不再生效）
  --domains=a,b   覆盖启用域名
  --debug         打开调试日志（默认关）
  --label=名字    改产物名（不改内容）
  --out=release   输出目录
  --keep          保留中间构建目录`);
  process.exit(argv.help ? 0 : 1);
}

if (argv.check) {
  checkExisting(String(argv.check));
  process.exit(0);
}

const targets = buildTargets();
if (!targets.length) fail('没有匹配到任何目标');
mkdirSync(releaseRoot, { recursive: true });

const rows = [];
for (const target of targets) {
  process.stdout.write(`烘焙 ${target.label} … `);
  const { summary } = releaseOne(target);
  process.stdout.write('ok\n');
  rows.push(summary);
}

console.log('\n产物：');
console.log('  名称'.padEnd(44) + '大小'.padStart(10) + '  时区/语言'.padEnd(30) + '规则');
for (const row of rows) {
  const size = `${(row.bytes / 1024).toFixed(0)} KB`;
  const place = `${row.timezone} ${row.locale}`;
  console.log(`  ${row.name.padEnd(42)}${size.padStart(10)}  ${place.padEnd(30)}${row.staticRules}`);
}
console.log(`\n输出目录：${releaseRoot}`);
console.log('校验任意一个：node scripts/release.mjs --check=release/<名称>.zip');