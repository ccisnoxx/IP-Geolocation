#!/usr/bin/env node
/*
 * 一条命令跑完所有验证，双引擎对比，最后给通过率表格 + 非零退出码。
 *
 *   npm run audit
 *   npm run audit -- --engines=helium
 *   npm run audit -- --only=options,failclosed
 *   npm run audit -- --skip=realsite --verbose
 *   npm run audit -- --no-build --timeout=300
 *
 * 检查项：
 *   options     选项页端到端（改语言 → 静态规则停用、动态注册生效）
 *   failclosed  定位失败可见性（角标 !、payload=null、弹窗告警、恢复后清空）
 *   frames      父域 / 子域 / 不透明 frame 的 payload 隔离与 clear
 *   bakedfailclosed 烘焙包坐标未解析 → deny，恢复坐标后可逆，关总开关恢复原生
 *   bakedclear  烘焙包排除站点 / 关总开关 / frozen 的 clear 与冻结行为
 *   native      原生模式自检（无调试端口，19 项环境一致性）
 *   realsite    真实站点一致性（真实注册页 vs 当前代理出口 IP）
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { reapStrayBrowsers } from './lib/cdp.mjs';
import { lookupExit } from './lib/exit.mjs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const PERSONA = String(argv.persona || 'us-la-1');
const TIMEOUT = Number(argv.timeout || 240) * 1000;
// 浏览器级 E2E 天生偶发（首个 TLS 握手、冷启动、系统负载），失败组自动重跑
const RETRIES = Number(argv.retries === undefined || argv.retries === true ? 1 : argv.retries);

const ENGINES = [
  {
    id: 'chrome',
    name: 'Chrome 155',
    path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // 154+ 起 Chrome 忽略 --load-extension，而原生自检不能开调试端口装扩展 → 这个引擎测不了
    nativeMode: false,
    nativeNote: 'Chrome 155 忽略 --load-extension，原生模式装不上扩展'
  },
  {
    id: 'chrome119',
    name: 'Chrome 119',
    path: process.env.CHROME119_PATH || join(homedir(), '.vanishgeo', 'browsers', 'chrome-119', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    // Chrome 119 没有 CDP Extensions.loadUnpacked，只能靠 --load-extension 启动参数
    legacyExtension: true,
    nativeMode: true
  },
  { id: 'helium', name: 'Helium 156', path: '/Applications/Helium.app/Contents/MacOS/Helium', nativeMode: true }
];

// 与引擎无关的静态检查：类型、单测、构建。它们的意义是"契约没被悄悄改坏"，
// 放在浏览器检查前面先跑——基础都不绿的话，E2E 的结果没有解读价值。
const STATIC_CHECKS = [
  {
    id: 'typecheck',
    label: '类型检查',
    run: () => spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT })
  },
  {
    id: 'unittest',
    label: '单元测试',
    run: () => {
      const files = readdirSync(join(ROOT, 'tests')).filter((name) => name.endsWith('.test.ts')).map((name) => join('tests', name));
      return spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--test', ...files], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT });
    }
  },
  {
    id: 'build',
    label: '构建',
    run: () => spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT })
  }
];

const CHECKS = [
  { id: 'options', label: 'options 页端到端', script: 'tools/smoke-options.mjs', args: [] },
  { id: 'failclosed', label: '定位失败可见性', script: 'tools/smoke-failclosed.mjs', args: [] },
  { id: 'frames', label: 'frame 隔离', script: 'tools/smoke-frames.mjs', lateArgs: () => ['--extension=' + extensionPath] },
  { id: 'bakedfailclosed', label: '烘焙 fail-closed', script: 'tools/smoke-baked-failclosed.mjs', lateArgs: () => ['--extension=' + extensionPath] },
  { id: 'bakedclear', label: '烘焙 clear / frozen', script: 'tools/smoke-baked-clear.mjs', args: [] },
  { id: 'presets', label: '内置 preset 浏览器 E2E', script: 'tools/smoke-presets.mjs', args: [] },
  { id: 'coldstart', label: '冷启动 / clear', script: 'tools/smoke-cold-start.mjs', args: [] },
  { id: 'popup', label: 'popup 交互', script: 'tools/smoke-popup.mjs', lateArgs: () => ['--extension=' + extensionPath] },
  { id: 'native', label: '原生模式自检', script: 'tools/native-audit.mjs', args: ['--profile=' + join(homedir(), '.vanishgeo', 'audit-profile')] },
  { id: 'realsite', label: '真实站点一致性', script: 'tools/smoke-real-site.mjs', args: [] },
  // auto 构建（时区按出口 IP 派生）单独跑一遍：首帧头与页面语言必须一致，
  // 这条就是 P0「请求头 zh-CN / 页面 en-US」的回归护栏
  { id: 'autobuild', label: 'auto 构建跟随 IP', script: 'tools/smoke-real-site.mjs', args: ['--extension=' + join(ROOT, 'dist')] },
  // 出口 IP 换时区后，环境要跟着变（含已打开页面无需重载）
  { id: 'ipchange', label: '出口变化跟随', script: 'tools/smoke-ip-change.mjs', args: ['--extension=' + join(ROOT, 'dist')] },
  // 跨上下文指纹一致性 + WebRTC 是否泄漏真实 IP（用烘焙 persona 构建）
  { id: 'fingerprint', label: '指纹一致性', script: 'tools/smoke-fingerprint.mjs', lateArgs: () => ['--extension=' + extensionPath] }
];

const wanted = (value, allowed) => (value === undefined || value === true ? allowed : String(value).split(',').map((item) => item.trim()));
const engineIds = wanted(argv.engines, ENGINES.map((item) => item.id));
const ALL_CHECK_IDS = [...CHECKS.map((item) => item.id), ...STATIC_CHECKS.map((item) => item.id)];
const checkIds = wanted(argv.only, ALL_CHECK_IDS).filter((id) => !wanted(argv.skip, []).includes(id));

const engines = ENGINES.filter((item) => engineIds.includes(item.id) && existsSync(item.path));
const checks = CHECKS.filter((item) => checkIds.includes(item.id));
const staticChecks = STATIC_CHECKS.filter((item) => checkIds.includes(item.id));
if (!checks.length && !staticChecks.length) {
  console.error('没有要跑的检查项');
  process.exit(2);
}
// 只跑静态项时不要求浏览器在场
if (!checks.length && argv.engines !== undefined) {
  console.error('没有可用的浏览器（Chrome / Helium 都不在默认路径）');
  process.exit(2);
}
if (checks.length && !engines.length) {
  console.error('没有可用的浏览器（Chrome / Helium 都不在默认路径）');
  process.exit(2);
}

const extensionPath = join(homedir(), '.vanishgeo', 'profiles', PERSONA, 'ext');
if (!argv['no-build'] && existsSync(join(ROOT, 'scripts', 'build-persona.mjs'))) {
  process.stdout.write(`准备 ${PERSONA} 烘焙构建 … `);
  const build = spawnSync(process.execPath, ['scripts/build-persona.mjs', `--persona=${PERSONA}`], { cwd: ROOT, encoding: 'utf8' });
  console.log(build.status === 0 ? '完成' : `失败\n${build.stderr || build.stdout}`);
  if (build.status !== 0) process.exit(2);
}
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到扩展构建：${extensionPath}`);
  process.exit(2);
}

function run(check, engine) {
  const started = Date.now();
  const args = check.lateArgs ? check.lateArgs() : (check.args || []);
  const result = spawnSync(process.execPath, [check.script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      CHROME_PATH: engine.path,
      VANISHGEO_PERSONA: PERSONA,
      VANISHGEO_EXIT_JSON: exitJson,
      ...(engine.legacyExtension ? { VANISHGEO_LEGACY_EXTENSION: '1' } : {})
    }
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const skippedMatch = output.match(/（(\d+) 项跳过）/);
  const match = [...output.matchAll(/(\d+)\/(\d+) 通过/g)].pop();
  const passed = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  return {
    ok: !timedOut && passed === total && total > 0,
    passed,
    total,
    skipped: skippedMatch ? Number(skippedMatch[1]) : 0,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    timedOut,
    output
  };
}

// 出口 IP 只查一次，传给需要它的检查（重复查会被接口限流，导致时区判定被跳过）
let exitJson = '';
if (checks.some((check) => check.id === 'realsite' || check.id === 'autobuild')) {
  const exit = await lookupExit({ timeoutMs: 6000 });
  exitJson = exit ? JSON.stringify(exit) : '';
  console.log(exit
    ? `出口 ${exit.ip || '?'} · ${exit.country || '?'}${exit.city ? ` · ${exit.city}` : ''} · ${exit.tz || '时区未知'}`
    : '出口 IP 查询失败（真实站点检查里时区判定会被跳过）');
}

const staticRows = [];
for (const check of staticChecks) {
  const started = Date.now();
  process.stdout.write(`▶ 静态 · ${check.label} … `);
  const result = check.run();
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const ok = result.status === 0;
  let score = ok ? '✓' : '✗';
  if (check.id === 'unittest') {
    const pass = (output.match(/^# pass (\d+)$/m) || output.match(/ℹ pass (\d+)/) || [])[1];
    const fail = (output.match(/^# fail (\d+)$/m) || output.match(/ℹ fail (\d+)/) || [])[1];
    if (pass) score = `${ok ? '✓' : '✗'} ${pass}/${Number(pass) + Number(fail || 0)}`;
  }
  console.log(`${score}  ${seconds}s`);
  if (!ok) {
    const tail = output.split('\n').slice(-20).map((line) => `    ${line}`).join('\n');
    console.log(tail);
  }
  staticRows.push({ id: check.id, label: check.label, ok, seconds });
}

const matrix = [];
for (const engine of engines) {
  const row = { engine: engine.name, cells: {} };
  for (const check of checks) {
    if (check.id === 'native' && engine.nativeMode === false) {
      row.cells[check.id] = { na: true, reason: engine.nativeNote, passed: 0, total: 0, seconds: 0 };
      console.log(`▶ ${engine.name} · ${check.label} … n/a（${engine.nativeNote}）`);
      continue;
    }
    process.stdout.write(`▶ ${engine.name} · ${check.label} … `);
    // 上一轮的浏览器如果没退干净会抢 CPU 让这一轮超时，先清一遍
    const reaped = reapStrayBrowsers();
    if (reaped.length && argv.verbose) console.log(`(清理残留 ${reaped.length} 个) `);
    // 上一组浏览器刚退场时会让新一轮的首次导航更容易被重置，给它 1.5s 缓冲
    await new Promise((done) => setTimeout(done, 1500));
    let outcome = run(check, engine);
    let usedRetries = 0;
    while (!outcome.ok && usedRetries < RETRIES) {
      usedRetries += 1;
      reapStrayBrowsers();
      if (argv.verbose) console.log(`\n  ↻ 重试 ${usedRetries}/${RETRIES} … `);
      outcome = run(check, engine);
    }
    outcome.retries = usedRetries;
    row.cells[check.id] = outcome;
    const mark = outcome.ok ? (usedRetries ? '↻' : '✓') : '✗';
    console.log(`${mark} ${outcome.passed}/${outcome.total}${outcome.skipped ? ` (${outcome.skipped} 跳过)` : ''}  ${outcome.seconds}s${usedRetries ? `（重试 ${usedRetries} 次后通过）` : ''}`);
    if (!outcome.ok && argv.verbose) {
      const tail = String(outcome.output || '').split('\n').slice(-30).map((line) => `    ${line}`).join('\n');
      console.log(tail);
    }
  }
  matrix.push(row);
}

// ---- 表格（中文按 2 列宽算） ----
const width = (text) => [...String(text)].reduce((sum, char) => sum + (/[\u1100-\uffff]/.test(char) ? 2 : 1), 0);
const pad = (text, size) => `${text}${' '.repeat(Math.max(0, size - width(text)))}`;
const columns = checks.map((check) => check.label);
const colWidths = columns.map((label, index) => Math.max(
  width(label),
  ...matrix.map((row) => width(cellText(row.cells[checks[index].id])))
));
function cellText(outcome) {
  if (!outcome) return '-';
  if (outcome.na) return 'n/a';
  const mark = outcome.ok ? (outcome.retries ? '↻' : '✓') : '✗';
  const score = outcome.total ? `${outcome.passed}/${outcome.total}` : (outcome.timedOut ? '超时' : '出错');
  return `${mark} ${score}${outcome.skipped ? ` +${outcome.skipped}⚠` : ''}`;
}

if (checks.length) {
const engineWidth = Math.max(width('引擎'), ...matrix.map((row) => width(row.engine)));
const header = `│ ${pad('引擎', engineWidth)} │ ${columns.map((label, index) => pad(label, colWidths[index])).join(' │ ')} │`;
const tableWidth = width(header);
console.log('');
console.log('─'.repeat(tableWidth));
console.log(header);
console.log('─'.repeat(tableWidth));
for (const row of matrix) {
  const cells = checks.map((check, index) => pad(cellText(row.cells[check.id]), colWidths[index]));
  console.log(`│ ${pad(row.engine, engineWidth)} │ ${cells.join(' │ ')} │`);
}
console.log('─'.repeat(tableWidth));
}

const all = matrix.flatMap((row) => Object.values(row.cells)).filter((outcome) => !outcome.na);
const failures = [...all.filter((outcome) => !outcome.ok), ...staticRows.filter((row) => !row.ok)];
const totalCases = all.reduce((sum, outcome) => sum + outcome.total, 0) + staticRows.length;
const passedCases = all.reduce((sum, outcome) => sum + outcome.passed, 0) + staticRows.filter((row) => row.ok).length;
const skippedGroups = matrix.flatMap((row) => Object.values(row.cells)).filter((outcome) => outcome.na).length;
const seconds = Math.round(all.reduce((sum, outcome) => sum + outcome.seconds, 0) + staticRows.reduce((sum, row) => sum + row.seconds, 0));
const groupsTotal = all.length + staticRows.length;
const summary = totalCases
  ? `${passedCases}/${totalCases} 项通过`
  : '没有任何断言真的跑起来（全部超时/崩溃）';
console.log(`\n合计 ${summary} · ${groupsTotal - failures.length}/${groupsTotal} 组全绿 · 用时 ${seconds}s${skippedGroups ? `（${skippedGroups} 组因引擎能力跳过）` : ''}`);

if (failures.length) {
  console.log('');
  for (const row of staticRows.filter((item) => !item.ok)) {
    console.log(`✗ 静态 · ${row.label}`);
  }
  for (const row of matrix) {
    for (const check of checks) {
      const outcome = row.cells[check.id];
      if (!outcome || outcome.ok || outcome.na) continue;
      console.log(`✗ ${row.engine} · ${check.label}  ${outcome.timedOut ? '超时' : `${outcome.passed}/${outcome.total}`}`);
      const interesting = String(outcome.output || '').split('\n').filter((text) => /^[✗⚠]|Error:/.test(text)).slice(0, 8);
      if (interesting.length) console.log(interesting.map((text) => `    ${text}`).join('\n'));
    }
  }
  process.exit(1);
}
process.exit(0);