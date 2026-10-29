#!/usr/bin/env node
/*
 * 把一批已发布的 zip 全部真开浏览器验一遍。
 *
 *   node tools/smoke-release.mjs                       # 默认 release/ 下所有包
 *   node tools/smoke-release.mjs --dir=release --require=3
 *   node tools/smoke-release.mjs --only=us-west        # 只验名字含 us-west 的
 *
 * 为什么单独做一个批量壳：`verify-release.mjs` 一次只验一个包（换来的是每个包
 * 都从干净 Chrome 起、互不污染）。每个 preset 的烘焙值各自独立，手动一个个跑
 * 很容易漏——少验一个包和一个包出错在 CI 里长得一样。这里要求"验过的包数 ==
 * 目录里的包数"，漏跑会红。
 *
 * 每个包都独立起进程：某个包把 Chrome 弄崩了，不影响后面的包。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const outDir = resolve(ROOT, String(argv.dir || 'release'));
if (!existsSync(outDir)) {
  console.error(`✗ 没有这个目录：${outDir}（先跑 npm run build && node scripts/release.mjs --all-presets）`);
  process.exit(1);
}

const zips = readdirSync(outDir)
  .filter((name) => name.endsWith('.zip'))
  .filter((name) => (argv.only ? name.includes(String(argv.only)) : true))
  .sort()
  .map((name) => join(outDir, name));

if (zips.length === 0) {
  console.error(`✗ ${outDir} 里没有 zip${argv.only ? `（--only=${argv.only}）` : ''}`);
  process.exit(1);
}

const requireCount = argv.require === undefined ? zips.length : Number(argv.require);
const results = [];

for (const zip of zips) {
  const name = zip.slice(outDir.length + 1);
  const summaryPath = zip.replace(/\.zip$/, '.json');
  const started = Date.now();
  let output = '';
  let ok = false;

  process.stdout.write(`\n=== ${name} ===\n`);
  if (!existsSync(summaryPath)) {
    // 没有发布时写下的清单就只能验"首屏不是本机值"，验不了"首屏就是烘焙值"。
    // 缺清单是打包环节的问题，直接判失败，别降级成一条永远为真的断言。
    console.log(`✗ 缺发布清单：${summaryPath.slice(outDir.length + 1)}`);
    results.push({ name, ok: false, detail: '缺 .json 清单', ms: Date.now() - started });
    continue;
  }

  try {
    output = execFileSync(process.execPath, [join(ROOT, 'tools', 'verify-release.mjs'), `--zip=${zip}`], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 240000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    ok = true;
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
  }

  console.log(output.trimEnd());
  const passed = output.match(/(\d+)\/(\d+) 通过/);
  const detail = passed ? `${passed[1]}/${passed[2]}` : '未产出结论';
  if (ok && passed && passed[1] !== passed[2]) ok = false;
  results.push({ name, ok, detail, ms: Date.now() - started });
}

const failed = results.filter((item) => !item.ok);
console.log('\n================ 汇总 ================');
for (const item of results) {
  const mark = item.ok ? '✓' : '✗';
  console.log(`${mark} ${item.name.padEnd(34)} ${item.detail.padEnd(6)} ${(item.ms / 1000).toFixed(1)}s`);
}
console.log(`\n${results.length - failed.length}/${results.length} 个包通过`);

if (results.length < requireCount) {
  console.error(`✗ 只验了 ${results.length} 个包，少于要求的 ${requireCount} 个`);
  process.exit(1);
}
if (failed.length) {
  console.error(`✗ 失败：${failed.map((item) => item.name).join(', ')}`);
  process.exit(1);
}