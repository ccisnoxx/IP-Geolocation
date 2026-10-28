// 烘焙 persona：静态注入清单必须可核对，且产物不依赖运行期 userScripts 注册。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

async function persona(args: string[]) {
  const workspace = await mkdtemp(join(tmpdir(), 'vg-persona-'));
  const dist = join(workspace, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'synthetic', version: '2.1.1',
    permissions: ['storage'], host_permissions: ['*://example.test/*']
  }, null, 2));
  const out = join(workspace, 'out');
  const { stdout } = await run(join(root, 'node_modules/tsx/dist/cli.mjs'), [join(root, 'scripts/build-persona.mjs'), '--dist', dist, '--out', out, ...args], { cwd: root });
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const meta = JSON.parse(await readFile(join(out, 'persona/persona.json'), 'utf8'));
  const code = await readFile(join(out, 'persona/page-runtime.js'), 'utf8');
  return { stdout, manifest, meta, code };
}

test('内置预设烘焙：静态 content_scripts + 画像 JSON + 自包含运行时', async () => {
  const { stdout, manifest, meta, code } = await persona(['--domains', 'claude.ai,chatgpt.com', '--preset', 'us-los-angeles']);
  assert.match(stdout, /4 条 matches/);
  assert.equal(manifest.content_scripts.length, 1);
  const entry = manifest.content_scripts[0];
  assert.deepEqual(entry.matches, ['*://claude.ai/*', '*://*.claude.ai/*', '*://chatgpt.com/*', '*://*.chatgpt.com/*']);
  assert.equal(entry.world, 'MAIN');
  assert.equal(entry.run_at, 'document_start');
  assert.equal(entry.all_frames, true);
  assert.deepEqual(entry.js, ['persona/page-runtime.js']);
  assert.ok(manifest.host_permissions.includes('*://*.claude.ai/*'));
  assert.ok(!manifest.permissions.includes('userScripts'), '烘焙产物不需要运行期注册权限');
  assert.equal(meta.persona.timezone, 'America/Los_Angeles');
  assert.deepEqual([meta.persona.latitude, meta.persona.longitude], [34.0522, -118.2437]);
  // 运行时自包含：无 import/require，payload 直接内联
  assert.match(code, /^\(function applyLanguageTimezoneRuntime\(payload\) \{/);
  assert.match(code.trimEnd(), /\);$/);
  assert.match(code, /"America\/Los_Angeles"/);
});

test('手填画像优先于预设，语言列表以主语言开头；非法输入直接失败', async () => {
  const { meta } = await persona(['--domains', 'example.com', '--lat', '1.3521', '--lon', '103.8198',
    '--timezone', 'Asia/Singapore', '--language', 'en-SG', '--languages', 'en,zh-CN', '--country', 'Singapore']);
  assert.equal(meta.persona.timezone, 'Asia/Singapore');
  assert.deepEqual(meta.persona.languages, ['en-SG', 'en', 'zh-CN']);
  assert.equal(meta.persona.label, 'custom');
  await assert.rejects(persona(['--domains', 'bad domain!']), /域名不合法/);
  await assert.rejects(persona(['--domains', 'example.com', '--preset', 'mars-base']), /未知预设/);
});
