#!/usr/bin/env node
/*
 * 把一个 persona 的配置在构建期烘焙进注入层。
 *
 *   node scripts/build-persona.mjs --persona=us-la-1
 *   node scripts/build-persona.mjs --persona=us-la-1 --domains=claude.ai,anthropic.com --out=dist-persona-us-la-1
 *   node scripts/build-persona.mjs --config=tools/fixtures/probe-config.json --out=dist-probe
 *
 * 产出目录里 runtime.js 已包含目标时区/语言，document_start 同步生效，
 * 页面的首屏脚本读到的就是目标值，不存在"先真值后假值"的窗口。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const personaName = argv.persona ? String(argv.persona) : null;

// persona 构建默认直接产出到 persona 的 profile 目录下，
// 启动器（tools/chrome-env.mjs）会自动把它带上，不用再手动指定 --extension
const profileRoot = personaName ? join(homedir(), '.vanishgeo', 'profiles', personaName) : null;
const outDir = String(argv.out || (profileRoot ? join(profileRoot, 'ext') : 'dist-persona'));
// 默认开：烘焙值只是初始状态，选项页的改动（语言/时区/字体伪装）要能实时生效。
// 想要"完全冻结、连消息通道都不存在"的构建就 --no-bridge。
const bridge = argv['no-bridge'] !== true;
const nonce = String(argv.nonce || randomBytes(12).toString('hex'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadPersona(name) {
  // 两处来源：先看用户自己的（chrome-env 写的那个），没有就退回仓库里随代码
  // 一起走的预设。CI 的 runner 是全新的，~/.vanishgeo 必然不存在 —— 夜跑就是
  // 卡在这里，"先跑一次 chrome-env" 对无人值守的环境不成立。
  const candidates = [
    join(homedir(), '.vanishgeo', 'personas', `${name}.json`),
    join(ROOT, 'tools', 'personas', `${name}.json`)
  ];
  const file = candidates.find((item) => existsSync(item));
  if (!file) fail(`找不到 persona 配置：${candidates.join(' 或 ')}\n先跑一次 node tools/chrome-env.mjs --persona=${name}，或往 tools/personas/ 放一份预设`);
  if (file === candidates[1]) process.stdout.write(`（persona 取自仓库预设 ${file}）\n`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function buildConfigFromPersona(persona) {
  // 不给 --domains 时跟扩展的默认白名单一致（src/shared/default-domains.json）
  const defaultDomains = JSON.parse(readFileSync(join(ROOT, 'src', 'shared', 'default-domains.json'), 'utf8'));
  const domains = String(argv.domains || defaultDomains.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const locale = String(persona.locale || 'en-US');
  const base = locale.split('-')[0];

  return {
    masterEnabled: true,
    debugMode: argv.debug === true,
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: locale,
        languages: [locale, base],
        acceptLanguage: String(persona.acceptLanguage || `${locale},${base}`)
      },
      timezone: {
        enabled: true,
        mode: 'manual',
        timezone: String(persona.timezone || 'UTC')
      },
      geolocation: {
        enabled: true,
        mode: 'manual',
        latitude: Number(persona.latitude),
        longitude: Number(persona.longitude),
        accuracy: 30,
        country: '',
        randomize: false,
        randomRadiusMeters: 0,
        spoofPermission: true
      }
    },
    webRtc: { globalMode: 'strict' },
    // 字体伪装在 JS 层无法做到自洽（FontFace local() / 真实渲染不走 measureText），默认关闭
    canvas: { enabled: false, spoofFonts: false, targetFonts: [] },
    rules: domains.map((domain, index) => ({
      id: `rule-${index}`,
      domain,
      enabled: true,
      overrides: {
        language: { mode: 'inherit', value: null },
        timezone: { mode: 'inherit', value: null },
        geolocation: { mode: 'inherit', value: null }
      }
    }))
  };
}

let baked;
if (argv.config) {
  const file = resolve(ROOT, String(argv.config));
  if (!existsSync(file)) fail(`找不到配置文件：${file}`);
  baked = JSON.parse(readFileSync(file, 'utf8'));
} else {
  if (!personaName) fail('需要 --persona=<name> 或 --config=<file>');
  baked = { config: buildConfigFromPersona(loadPersona(personaName)), lastLocation: null };
}

const payload = {
  config: baked.config,
  lastLocation: baked.lastLocation ?? null,
  bridge,
  nonce
};

const personaConfigFile = join(ROOT, 'persona.config.json');
writeFileSync(personaConfigFile, JSON.stringify(payload, null, 2));

try {
  execFileSync(process.execPath, [
    join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--outDir',
    outDir,
    // 输出目录在项目外，Vite 默认不会清空旧产物
    '--emptyOutDir'
  ], { cwd: ROOT, stdio: 'inherit' });
} finally {
  rmSync(personaConfigFile, { force: true });
}

let bakedRulesSummary = '无（走动态规则）';
try {
  const count = JSON.parse(readFileSync(join(outDir, 'rules', 'baked-language.json'), 'utf8')).length;
  if (count > 0) bakedRulesSummary = `rules/baked-language.json  ${count} 条（首帧请求即生效，不依赖 SW）`;
} catch { /* 没有就是没有 */ }

console.log(`\n已生成 ${outDir}`);
console.log(`  persona : ${personaName || '(from --config)'}`);
console.log(`  bridge  : ${bridge ? 'on' : 'off'}  (off = runtime.js 里完全没有消息通道，选项改动要重新构建才生效)`);
console.log(`  nonce   : ${nonce}`);
console.log(`  静态规则: ${bakedRulesSummary}`);
if (profileRoot) {
  console.log(`\n首次需要在这个 profile 里装一次（Chrome 155 已忽略 --load-extension）：`);
  console.log(`  node tools/chrome-env.mjs --persona=${personaName} --setup-extension`);
  console.log(`装好之后直接启动，扩展会一直在：`);
  console.log(`  node tools/chrome-env.mjs --persona=${personaName} --url=https://claude.ai`);
  console.log(`  node tools/chrome-env.mjs --persona=${personaName} --check`);
} else {
  console.log(`\n加载方式：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 ${outDir}`);
}