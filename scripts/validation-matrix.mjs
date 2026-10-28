#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { only: { type: 'string', default: 'lint,types,test-types,unit,build' },
  browser: { type: 'string', multiple: true }, output: { type: 'string' }, plan: { type: 'boolean' } } });
const checks = {
  lint: { command: 'npm', args: ['run', 'lint'] },
  types: { command: 'npm', args: ['run', 'typecheck'] },
  'test-types': { command: 'npm', args: ['run', 'typecheck:tests'] },
  unit: { command: 'npm', args: ['test'] },
  build: { command: 'npm', args: ['run', 'build'] },
  coverage: { command: 'npm', args: ['run', 'test:coverage'] },
  intl: { script: 'scripts/chrome-intl-smoke.mjs', scope: '临时最小扩展，Intl/Date定向；不代表生产注册' },
  'native-parity': { script: 'scripts/chrome-observability-audit.mjs', scope: '正式dist、独立Profile、loopback原生/补丁对照；不证明不可检测' }
};
const selected = [...new Set(values.only.split(',').filter(Boolean))];
if (!selected.length || selected.some(name => !checks[name])) throw new Error('存在未知或空的检查项');
const browsers = values.browser || (process.env.CHROME_BIN ? [process.env.CHROME_BIN] : []);
if (values.plan) console.log(JSON.stringify({ checks: selected, browserCount: browsers.length, launchesBrowser: false }, null, 2));
else {
  if (!values.output) throw new Error('需要 --output <新JSON>');
  const output = resolve(values.output);
  if (existsSync(output)) throw new Error('不得覆盖已有矩阵报告');
  await mkdir(dirname(output), { recursive: true });
  // 保留本次runner原始证据，不清理其他Profile或浏览器进程。
  const evidence = await mkdtemp(join(dirname(output), `${basename(output, '.json')}-evidence-`));
  const rows = [];
  for (const name of selected) {
    const check = checks[name];
    const targets = check.script ? (browsers.length ? browsers : [null]) : [null];
    for (const [index, browser] of targets.entries()) {
      const browserId = check.script ? `browser-${index + 1}` : null;
      if (check.script && (!browser || !existsSync(browser) || typeof WebSocket !== 'function')) {
        rows.push({ check: name, browser: browserId, status: 'UNSUPPORTED', reason: '需要明确浏览器路径及Node22+' });
        continue;
      }
      const report = join(evidence, `${name}-${index + 1}.json`);
      const started = Date.now();
      const command = check.script ? process.execPath : check.command;
      const args = check.script ? [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, check.script), '--output', report] : check.args;
      const result = spawnSync(command, args, { cwd: root, encoding: 'utf8',
        env: { ...process.env, ...(browser ? { CHROME_BIN: browser } : {}) }, maxBuffer: 8 * 1024 * 1024 });
      let observed;
      if (check.script && existsSync(report)) {
        try { observed = JSON.parse(await readFile(report, 'utf8')); }
        catch { observed = { status: 'INVALID_EVIDENCE' }; }
      }
      const evidenceOk = !check.script || (name === 'intl' ? observed?.result === 'PASS'
        : ['NATIVE', 'OBSERVABLE'].includes(observed?.status) && Array.isArray(observed.errors) && !observed.errors.length);
      const ok = result.status === 0 && !result.error && !result.signal && evidenceOk;
      rows.push({ check: name, browser: browserId, status: ok ? 'PASS' : 'FAIL', exitCode: result.status,
        signal: result.signal, durationMs: Date.now() - started, ...(check.scope ? { scope: check.scope, evidence: basename(report), evidenceStatus: observed?.status || observed?.result || 'UNKNOWN' } : {}),
        ...(result.error ? { error: result.error.code || result.error.name } : {}) });
      console.log(`${name}${browserId ? ` / ${browserId}` : ''}: ${ok ? 'PASS' : 'FAIL'}`);
      if (!ok) console.error(String(result.stderr || result.stdout || '检查未完成').replaceAll(root, '<project>/').slice(-2500));
    }
  }
  const complete = rows.every(row => row.status === 'PASS');
  await writeFile(output, JSON.stringify({ status: complete ? 'PASS' : 'INCOMPLETE', rows,
    evidenceDirectory: basename(evidence), limitations: ['UNSUPPORTED不计为通过', '未运行用户个人Profile或真实站点检查'] }, null, 2) + '\n', { flag: 'wx' });
  if (!complete) process.exitCode = 1;
}
