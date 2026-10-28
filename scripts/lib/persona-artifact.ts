import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENVIRONMENT_PRESETS } from '../../src/shared/environment-presets';
import { generatePageRuntime, assertSelfContainedFunction } from '../../build/self-contained-runtime';
import { isValidDomain } from '../../src/shared/config-model';
import { buildContentScriptMatchesForDomain } from '../../src/shared/config-resolver';

export function personaTarget(id: string, rawDomains: string) {
  const preset = ENVIRONMENT_PRESETS.find(item => item.id === id);
  assert.ok(preset, '请选择已知的 persona 预设');
  const domains = rawDomains.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  assert.ok(domains.length && domains.every(domain => isValidDomain(domain)), 'persona需要明确的合法域名');
  return { preset, domains: [...new Set(domains)] };
}

// persona只派发固定语言/时区；没有普通包后台、编辑入口、实时桥、DNR或自动出口权限。
export function freezePersonaManifest(manifest: any, domains: string[]) {
  const matches = domains.flatMap(buildContentScriptMatchesForDomain);
  delete manifest.background; delete manifest.options_page; delete manifest.declarative_net_request;
  if (manifest.action) { delete manifest.action.default_popup; manifest.action.default_title = 'VanishGeo Persona · 固定语言/时区'; }
  manifest.permissions = [];
  manifest.host_permissions = matches;
  manifest.description = 'Frozen language/timezone persona for explicitly selected sites. No live settings or background detection.';
  manifest.content_scripts = [{ matches, js: ['persona/page-runtime.js'], run_at: 'document_start', all_frames: true, world: 'MAIN', match_about_blank: false }];
  return manifest;
}

export async function auditPersona(root: string, zip: string, id: string, rawDomains: string, dist = join(root, 'dist')) {
  const { preset, domains } = personaTarget(id, rawDomains);
  const expected = new Map<string, Buffer>();
  async function visit(directory: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), '构建中不允许符号链接');
      if (entry.isDirectory()) await visit(join(directory, entry.name), `${prefix}${entry.name}/`);
      else expected.set(prefix + entry.name, await readFile(join(directory, entry.name)));
    }
  }
  await visit(dist);
  const manifest = JSON.parse(expected.get('manifest.json')!.toString());
  freezePersonaManifest(manifest, domains);
  expected.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const code = assertSelfContainedFunction((await generatePageRuntime(root, false)).code, 'applyLanguageTimezoneRuntime');
  const payload = { intlMode: 'strict', language: { language: preset.language, languages: preset.languages }, timezone: preset.timezone };
  expected.set('persona/page-runtime.js', Buffer.from(`(${code})(${JSON.stringify(payload)});\n`));
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n');
  for (const name of entries) assert.ok(name && !name.startsWith('/') && !/^[a-z]:/i.test(name) && !name.includes('\\')
    && !name.split('/').some(part => part === '..' || part === '.'), 'ZIP含非法路径');
  assert.equal(new Set(entries.map(name => name.replace(/\/$/, ''))).size, entries.length, 'ZIP不允许重复路径');
  const names = entries.filter(name => !name.endsWith('/'));
  assert.ok(JSON.stringify([...names].sort()) === JSON.stringify([...expected.keys(), 'persona/persona.json'].sort()), 'persona文件集合与当前构建不一致');
  const read = (name: string) => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 16 * 1024 * 1024 });
  for (const [name, bytes] of expected) assert.ok(bytes.equals(read(name)), `persona文件与当前维护源及预期配置不一致：${name}`);
  const metadata = JSON.parse(read('persona/persona.json').toString());
  const expectedMetadata = { persona: { label: preset.name, latitude: preset.latitude, longitude: preset.longitude,
    accuracy: 50, timezone: preset.timezone, language: preset.language, languages: preset.languages,
    country: preset.country, intlMode: 'strict' }, domains, bakedAt: 'build-time' };
  assert.ok(JSON.stringify(metadata) === JSON.stringify(expectedMetadata), 'persona元数据与已知预期配置不一致');
  return { artifactKind: 'persona-language-timezone', preset: id, files: names.length,
    staticScope: ['language', 'timezone'], browserAcceptance: 'NOT_RUN',
    limitations: ['仅核对静态语言/时区快照及产物身份；未证明完整定位/字体/DNR或关闭恢复', '未将普通包发布审查替换为persona审查'] };
}
