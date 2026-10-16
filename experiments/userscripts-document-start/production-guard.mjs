import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const experimentPrefix = 'experiments/userscripts-document-start/';
const inside = (root, path) => { const suffix = relative(root, path); return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix)); };

export async function validateOutputPath(path, repoRoot) {
  const resolved = resolve(path);
  const parent = await realpath(dirname(resolved));
  const experiment = await realpath(resolve(repoRoot, experimentPrefix));
  const temporary = await realpath(tmpdir());
  if (!resolved.endsWith('.json') || (inside(repoRoot, resolved) && !inside(experiment, parent)) ||
    (!inside(experiment, parent) && !inside(temporary, parent))) {
    throw new Error('OUTPUT_OUTSIDE_EXPERIMENT_OR_TEMP');
  }
  try {
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('OUTPUT_NOT_INDEPENDENT_FILE');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return resolved;
}

export async function captureProduction(repoRoot) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot })
    .toString().split('\0').filter(path => path && !path.startsWith(experimentPrefix));
  const files = new Map();
  for (const path of [...new Set(paths)].sort()) {
    try {
      const stat = await lstat(resolve(repoRoot, path));
      const bytes = stat.isSymbolicLink() ? await readlink(resolve(repoRoot, path)) : await readFile(resolve(repoRoot, path));
      files.set(path, `${stat.mode}:${createHash('sha256').update(bytes).digest('hex')}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; files.set(path, 'MISSING'); }
  }
  const services = await readFile(resolve(repoRoot, 'src/background/services.ts'), 'utf8');
  const start = services.indexOf('async function initializeRuntimeForSender(');
  const end = services.indexOf('\n  async function ', start + 1);
  const body = start < 0 || end < 0 ? '' : services.slice(start, end);
  const pauseGate = body.includes('throw new RuntimeSyncOperationError(RUNTIME_INJECTION_PAUSED.code, RUNTIME_INJECTION_PAUSED.message);') &&
    !/getSiteConfig\(|executeScript\(|applyVanishGeoRuntime\(/.test(body);
  return { files, pauseGate };
}

export function compareProduction(before, after) {
  if (!before || !after) return { status: 'UNKNOWN', unchanged: 'UNKNOWN', pauseGate: 'UNKNOWN' };
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const changedCount = [...paths].filter(path => before.files.get(path) !== after.files.get(path)).length;
  const unchanged = changedCount === 0 ? 'PASS' : 'FAIL';
  const pauseGate = before.pauseGate && after.pauseGate ? 'PASS' : 'FAIL';
  return { status: unchanged === 'PASS' && pauseGate === 'PASS' ? 'PASS' : 'FAIL',
    unchanged, pauseGate, checkedFiles: paths.size, changedCount };
}
