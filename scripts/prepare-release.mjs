#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENVIRONMENT_PRESETS } from '../src/shared/environment-presets.ts';
import { personaTarget, auditPersona } from './lib/persona-artifact.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { kind: { type: 'string', default: 'regular' }, preset: { type: 'string' },
  'all-presets': { type: 'boolean' }, domains: { type: 'string' }, out: { type: 'string', default: 'release' }, plan: { type: 'boolean' } } });
if (!['regular', 'persona'].includes(values.kind)) throw new Error('kind只能为regular或persona');
if (values.preset && values['all-presets']) throw new Error('preset与all-presets只能选择一项');
if (values.kind === 'regular' && (values.preset || values['all-presets'] || values.domains)) throw new Error('普通包不使用persona选项');
const targets = [...new Set(values.kind === 'regular' ? ['regular'] : values['all-presets'] ? ENVIRONMENT_PRESETS.map(item => item.id) : (values.preset || '').split(',').filter(Boolean))];
if (!targets.length) throw new Error('persona需要preset或all-presets');
if (values.kind === 'persona') for (const id of targets) personaTarget(id, values.domains || '');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (values.plan) { console.log(JSON.stringify({ version: pkg.version, artifactKind: values.kind, targets, publishes: false }, null, 2)); }
else {
  // 完整现行门禁不可旁路；此命令只准备本地包，不打tag或发布。
  execFileSync('npm', ['run', 'check'], { cwd: root, stdio: 'inherit' });
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const destination = await mkdtemp(join(out, `vanishgeo-${pkg.version}-`));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  const reports = [];
  for (const id of targets) {
    const temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-package-'));
    try {
      let source = join(root, 'dist');
      if (values.kind === 'persona') {
        source = join(temporary, 'persona');
        execFileSync(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'scripts/build-persona.mjs'),
          '--dist', join(root, 'dist'), '--out', source, '--preset', id, '--domains', values.domains], { cwd: root, stdio: 'pipe' });
      }
      const zip = join(destination, `vanishgeo-${pkg.version}-${id}.zip`);
      execFileSync('zip', ['-qr', zip, '.'], { cwd: source });
      let audit;
      if (values.kind === 'regular') {
        const output = join(destination, 'regular-audit.json');
        execFileSync(process.execPath, [join(root, 'scripts/audit-release.mjs'), '--zip', zip, '--output', output], { cwd: root, stdio: 'pipe' });
        audit = JSON.parse(await readFile(output, 'utf8'));
      } else audit = await auditPersona(root, zip, id, values.domains);
      reports.push({ name: `vanishgeo-${pkg.version}-${id}.zip`, artifactKind: values.kind, head, dirty,
        sha256: createHash('sha256').update(await readFile(zip)).digest('hex'), audit });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  await writeFile(join(destination, 'artifacts.json'), JSON.stringify(reports, null, 2) + '\n', { flag: 'wx' });
  const display = relative(root, destination);
  console.log(`本地准备完成：${targets.length} 个包；未发布。输出目录：${display.startsWith('..') ? basename(destination) : display}`);
}
