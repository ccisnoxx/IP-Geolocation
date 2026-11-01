#!/usr/bin/env node
/*
 * 发版前一键自检：把 RELEASE.md 里那份清单按顺序跑一遍，任一红就停。
 *
 * 为什么要有这个东西：清单有九件事，跑完要十几分钟，而其中「三引擎审计」这一步
 * 只有在本地才跑得到。全靠人记得的结果不是"每次都跑"，而是"赶时间那次跳过"——
 * 2.4.0 发版前审计就差一点被跳过，真跑下去逮到两条红（定位失败可见性全引擎崩、
 * popup 交互在 Helium 上假红），单测和离线冒烟都发现不了。
 *
 * 设计上只做三件事：串行、串行、还是串行。每个 stage 是一次真实的子进程调用，
 * 不重写任何检查逻辑——检查住在各自的脚本里，这里只负责顺序、超时、汇总和
 * "红了就停"，避免出现第二套真相。
 *
 * 用法：
 *   npm run preflight                      # 全跑（~15 分钟）
 *   npm run preflight -- --skip=audit      # 跳过三引擎审计（~5 分钟，赶时间用）
 *   npm run preflight -- --only=smoke      # 只跑离线冒烟
 *   npm run preflight -- --keep-going      # 红了也继续，收集全部失败
 *   npm run preflight -- --verbose         # 子进程输出全部直出（默认只过滤关键行）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readPresets } from '../scripts/lib/presets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
// 发布包的验数必须等于实际产出数：写死 3 时，多出一个 preset 就等于"少验一个也算通过"
const PRESET_COUNT = readPresets(ROOT).length;
const flags = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  const name = key.replace(/^--/, '');
  // 重复给同一个 flag 要累积（--skip=a --skip=b 与 --skip=a,b 等价），
  // 否则后一个会静静盖掉前一个，跑出来的东西跟参数说的不一样
  flags.set(name, [...(flags.get(name) || []), value === undefined ? true : value]);
}
const list = (name) => (flags.get(name) || [])
  .flatMap((value) => String(value).split(','))
  .map((item) => item.trim())
  .filter(Boolean);
const VERBOSE = flags.has('verbose');
const KEEP_GOING = flags.has('keep-going');
const SKIP = new Set(list('skip'));
const ONLY = list('only');

const PERSONA = join(mkdtempSync(join(tmpdir(), 'vg-preflight-')), 'persona');

// 默认只直出"有信息量"的行，其余攒着失败时再倒出来。
// 审计一次要跑九分钟，全量直出会把人淹没；全量不直出又会让人以为卡死了。
const KEY_LINE = /^(✓|✗|▶|ℹ|total|合计|通过|[0-9]+\/[0-9]+)|失败|error:|Error:|时间：/;

function stage(id, label, cmd, args, { summary, timeoutMs = 600_000, deps = [] } = {}) {
  return { id, label, cmd, args, summary, timeoutMs, deps };
}

const SMOKES = [
  'presets', 'frames', 'opaque-frames', 'opaque-recovery', 'workers', 'bfcache', 'cold-start', 'cold-save',
  'baked-clear', 'baked-failclosed', 'ip-apply', 'theme', 'options', 'popup', 'userscripts'
];

const STAGES = [
  stage('version', '版本与产物一致', null, null, { timeoutMs: 30_000 }),
  // 单测和覆盖率会读取 dist，完整执行和 --only 都必须先生成当前源码的产物。
  stage('build', '构建 dist', 'npm', ['run', 'build'], { timeoutMs: 300_000 }),
  stage('verify', 'lint + 构建 + 单测', 'npm', ['run', 'verify'], {
    summary: (out) => match(out, /ℹ pass (\d+)/, (m) => `${m[1]} pass`),
    deps: ['build']
  }),
  stage('coverage', '核心分支覆盖 ≥85%', 'npm', ['run', 'test:coverage:core'], {
    summary: (out) => match(out, /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/, (m) => `分支 ${m[2]}%`),
    deps: ['build']
  }),
  // options / popup 需要构建产物，而 CI 上那份是 runner 临时目录里的；
  // 本地就用同一个构建脚本造一份，别让 preflight 依赖 ~/.vanishgeo 里的旧包
  stage('persona', '烘焙一份 persona 供 UI 冒烟', 'node',
    ['scripts/build-persona.mjs', '--persona=us-la-1', `--out=${PERSONA}`], { timeoutMs: 300_000 }),
  ...SMOKES.map((name) => stage(`smoke:${name}`, `离线冒烟 · ${name}`, 'node',
    [`tools/smoke-${name}.mjs`, ...(/^(options|popup)$/.test(name) ? [`--extension=${PERSONA}`] : [])],
    {
      summary: (out) => match(out, /(\d+)\/(\d+) 通过/, (m) => `${m[1]}/${m[2]}`),
      timeoutMs: 300_000,
      // UI 冒烟用 persona，其余读取 dist 的冒烟需要当前源码的普通构建。
      deps: /^(options|popup)$/.test(name) ? ['persona']
        : /^(frames|opaque-frames|opaque-recovery|workers|bfcache|cold-save|baked-failclosed|ip-apply|theme|userscripts)$/.test(name) ? ['build'] : []
    })),
  // 三引擎审计是唯一能覆盖 Helium 的一关，也是唯一会真开浏览器跑真实站点的一关
  stage('audit', '三引擎审计', 'npm', ['run', 'audit'], {
    summary: (out) => match(out, /合计 (\d+\/\d+) 项通过 · (\d+\/\d+) 组全绿/, (m) => `${m[1]} 项 · ${m[2]} 组`),
    timeoutMs: 1_800_000
  }),
  stage('package', '打包全部预设', 'node', ['scripts/release.mjs', '--all-presets', '--out=release'], {
    summary: (out) => (String(out).match(/vanishgeo-[\d.]+-[a-z0-9-]+\.zip/g) || []).length + ' 个包',
    timeoutMs: 600_000
  }),
  stage('release-smoke', '发布包冒烟', 'npm', ['run', 'smoke:release', '--', '--dir=release', `--require=${PRESET_COUNT}`], {
    summary: (out) => match(out, /(\d+)\/(\d+) 个包通过/, (m) => `${m[1]}/${m[2]} 个包`),
    timeoutMs: 900_000
  }),
  stage('stray', '没有残留浏览器', null, null, { timeoutMs: 60_000 })
];

function match(out, pattern, format) {
  const found = String(out).match(pattern);
  return found ? format(found) : '';
}

/** in-process 的两关：手写比开子进程更好读，而且能给出具体哪个文件对不上 */
function checkInProcess(id) {
  if (id === 'version') {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const problems = [];
    if (manifest.version !== pkg.version) {
      problems.push(`manifest ${manifest.version} ≠ package ${pkg.version}`);
    }
    // 清单里剩下那半条：dist 里不该有开发产物跟着发出去
    const dist = join(ROOT, 'dist');
    if (existsSync(dist)) {
      const leftovers = readdirSync(dist).filter((name) => /persona\.config\.json$|\.map$/.test(name));
      if (leftovers.length) problems.push(`dist 里有开发产物：${leftovers.join(', ')}`);
    }
    const describe = spawnSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8'
    });
    const note = describe.status === 0
      ? `tag ${describe.stdout.trim()}`
      : 'HEAD 还没打 tag（发版前打，preflight 本身不要求）';
    return { ok: problems.length === 0, summary: problems.length ? problems.join('；') : `v${manifest.version}`, note };
  }
  if (id === 'stray') {
    // 每个冒烟脚本都该把自己起的浏览器收干净；留一堆 headless 会抢 CPU 把后面的检查拖成超时
    const found = spawnSync('pgrep', ['-f', 'user-data-dir=.*/(vg-|vanishgeo-|audit-profile)'], { encoding: 'utf8' });
    const pids = String(found.stdout || '').trim().split('\n').filter(Boolean);
    return { ok: pids.length === 0, summary: pids.length ? `${pids.length} 个残留：${pids.slice(0, 5).join(', ')}` : '0 残留' };
  }
  throw new Error(`未知的 in-process stage: ${id}`);
}

function stream(child, onChunk) {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
}

function runStage(item) {
  return new Promise((resolveStage) => {
    const started = Date.now();
    let out = '';
    const child = spawn(item.cmd, item.args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      out += `\n[preflight] 超过 ${Math.round(item.timeoutMs / 1000)}s，杀掉子进程\n`;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, item.timeoutMs);

    stream(child, (chunk) => {
      out += chunk;
      if (VERBOSE) {
        process.stdout.write(chunk);
        return;
      }
      for (const line of String(chunk).split('\n')) {
        if (KEY_LINE.test(line)) process.stdout.write(`  ${line}\n`);
      }
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveStage({
        id: item.id,
        ok: code === 0,
        code,
        signal,
        ms: Date.now() - started,
        summary: code === 0 && item.summary ? item.summary(out) : '',
        output: out
      });
    });
  });
}

function selected(item) {
  if (SKIP.has(item.id) || SKIP.has(item.id.replace(/^smoke:/, ''))) return false;
  if (!ONLY.length) return true;
  return ONLY.some((prefix) => item.id === prefix || item.id.startsWith(`${prefix}:`) || item.id.startsWith(prefix));
}

/** 选中的阶段连同它依赖的阶段一起排进来：`--only=smoke` 不该因为少跑 persona 而假红 */
function buildPlan() {
  const plan = STAGES.filter(selected);
  const ids = new Set(plan.map((item) => item.id));
  for (const item of [...plan]) {
    for (const dep of item.deps || []) {
      if (ids.has(dep)) continue;
      const dependency = STAGES.find((candidate) => candidate.id === dep);
      if (!dependency) throw new Error(`${item.id} 依赖不存在的阶段 ${dep}`);
      if (SKIP.has(dep)) {
        throw new Error(`${item.id} 需要 ${dep}，但 --skip 把它排除了（要么别跳，要么一起跳掉 ${item.id}）`);
      }
      plan.splice(STAGES.indexOf(dependency), 0, dependency);
      ids.add(dep);
    }
  }
  return plan.sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b));
}

let plan;
try {
  plan = buildPlan();
} catch (error) {
  console.error(`preflight 参数有冲突：${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!plan.length) {
  console.error(`没有可跑的阶段（--skip=${[...SKIP].join(',')} --only=${ONLY.join(',')}）`);
  process.exit(2);
}

console.log(`preflight：${plan.length} 个阶段${SKIP.size ? `（跳过 ${[...SKIP].join(',')}）` : ''}\n`);

// 中文是双宽字符：padEnd 按码点数补空格，含中文的行会比别的行宽出一截，整张表推歪
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
function displayWidth(text) {
  return [...String(text)].reduce((width, ch) => width + (WIDE.test(ch) ? 2 : 1), 0);
}

function pad(text, width) {
  return String(text) + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function human(ms) {
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`;
}

const results = [];
const startedAll = Date.now();

for (const item of plan) {
  process.stdout.write(`▶ ${item.label} … `);
  if (!item.cmd) {
    const result = checkInProcess(item.id);
    // in-process 的两关没有子进程输出，行内打完收工
    console.log(`${result.ok ? '✓' : '✗'} ${result.summary}${result.note ? `（${result.note}）` : ''}`);
    results.push({ id: item.id, ok: result.ok, ms: 0, summary: result.summary, output: '' });
    if (!result.ok && !KEEP_GOING) break;
    continue;
  }
  console.log('');
  const result = await runStage(item);
  results.push(result);
  console.log(`  ${result.ok ? '✓' : '✗'} ${item.label}  ${result.summary || (result.ok ? '' : `退出码 ${result.code ?? result.signal}`)}  ${human(result.ms)}`);
  if (!result.ok) {
    const tail = result.output.trimEnd().split('\n').slice(-25).join('\n');
    if (tail) console.log(tail.split('\n').map((line) => `    │ ${line}`).join('\n'));
    if (!KEEP_GOING) {
      console.log('\n失败即停（要一次看完全部失败：--keep-going）');
      break;
    }
  }
}

try { rmSync(join(PERSONA, '..'), { recursive: true, force: true }); } catch { /* noop */ }

const failed = results.filter((r) => !r.ok);
const ranIds = new Set(plan.map((item) => item.id));
const skipped = STAGES.filter((item) => !ranIds.has(item.id)).map((item) => item.id);
const total = human(Date.now() - startedAll);

console.log(`\n${'─'.repeat(72)}`);
for (const r of results) {
  const label = STAGES.find((item) => item.id === r.id)?.label || r.id;
  console.log(`${r.ok ? '✓' : '✗'} ${pad(label, 30)} ${pad(r.summary || '', 22)} ${human(r.ms).padStart(6, ' ')}`);
}
if (skipped.length) console.log(`\n跳过：${skipped.join(', ')}`);
console.log(`\n合计 ${results.length - failed.length}/${results.length} 个阶段通过 · 用时 ${total}`);

if (failed.length) {
  console.log(`\n✗ 还不能发版：${failed.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
console.log('✓ 发版前自检全绿，可以 push tag 了');
