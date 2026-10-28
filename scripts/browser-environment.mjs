#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { findEnvironmentPreset } from '../src/shared/environment-presets.ts';
import { getAcceptLanguageValue } from '../src/shared/config-model.ts';

const { values } = parseArgs({ options: { preset: { type: 'string' }, browser: { type: 'string' }, profile: { type: 'string' },
  url: { type: 'string', default: 'about:blank' }, plan: { type: 'boolean' } } });
const preset = findEnvironmentPreset(values.preset || '');
if (!preset) throw new Error('需要 --preset <已知预设>');
if (values.url !== 'about:blank' && !/^https?:$/.test(new URL(values.url).protocol)) throw new Error('只打开普通HTTP(S)或about:blank');
const flags = [`--lang=${preset.language}`, `--accept-lang=${getAcceptLanguageValue(preset.languages)}`];
if (values.plan) console.log(JSON.stringify({ preset: preset.id, env: { TZ: preset.timezone }, flags, launchesBrowser: false,
  limitations: ['启动参数的实际效果须按浏览器观测；未声明Worker或ServiceWorker验收通过'] }, null, 2));
else {
  const browser = [values.browser, process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!browser) throw new Error('需要可用浏览器路径');
  const version = execFileSync(browser, ['--version'], { encoding: 'utf8' }).trim();
  const major = Number(/(?:Chrome|Chromium)\s+(\d+)\./.exec(version)?.[1]);
  if (!Number.isFinite(major) || major < 138) throw new Error('此启动器需要已识别的Chrome/Chromium138+');
  const temporary = !values.profile;
  const profile = values.profile ? resolve(values.profile) : await mkdtemp(join(tmpdir(), 'vanishgeo-env-'));
  await mkdir(profile, { recursive: true });
  const marker = join(profile, '.vanishgeo-environment.json');
  const entries = await readdir(profile);
  if (entries.length && !existsSync(marker)) throw new Error('目录不是本工具拥有的独立Profile，不访问个人浏览器配置');
  if (existsSync(marker) && JSON.parse(await readFile(marker, 'utf8')).owner !== 'vanishgeo-browser-environment-v1') throw new Error('Profile所有权标记不符');
  try { await lstat(join(profile, 'SingletonLock')); throw new Error('该Profile仍有浏览器占用，请先关闭'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(marker, JSON.stringify({ owner: 'vanishgeo-browser-environment-v1', preset: preset.id }) + '\n');
  const child = spawn(browser, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...flags, values.url],
    { env: { ...process.env, TZ: preset.timezone }, stdio: 'ignore', detached: true });
  let exited = false;
  let stopping = false;
  let stopTimer;
  const signalGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const groupAlive = () => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  const closeGroup = async () => {
    if (!groupAlive()) return;
    signalGroup('SIGTERM');
    const grace = Date.now() + 1500;
    while (groupAlive() && Date.now() < grace) await new Promise(done => setTimeout(done, 40));
    if (groupAlive()) signalGroup('SIGKILL');
    const deadline = Date.now() + 5000;
    while (groupAlive() && Date.now() < deadline) await new Promise(done => setTimeout(done, 40));
    if (groupAlive()) throw new Error('未能确认本次浏览器进程组已退出，保留Profile以便检查');
  };
  // 只终止本次启动的进程组；Chrome可能忽略首次TERM，关闭宽限后再收回本组。
  const stop = () => {
    stopping = true;
    signalGroup('SIGTERM');
    stopTimer = setTimeout(() => signalGroup('SIGKILL'), 1500);
    stopTimer.unref();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await once(child, 'spawn');
    console.log(`已启动独立环境：${preset.id}；实际语言/时区待浏览器观测，无JS或CDP覆盖。`);
    const [code] = await once(child, 'exit');
    exited = true;
    if (code !== 0 && !stopping) throw new Error('浏览器未正常退出');
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { await closeGroup(); }
    finally { if (stopTimer) clearTimeout(stopTimer); }
    if (temporary && (exited || !child.pid)) await rm(profile, { recursive: true, force: true });
  }
}
