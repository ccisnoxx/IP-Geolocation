/**
 * Release 正文是**产物**，不是手写文案 —— 所以它也必须被测。
 *
 * 上一次发布把三件事写错了，三处都是"写死的数字"：
 *   - 默认域名写成 13 个（实际 20 个）
 *   - 预设包写成 singapore / japan / germany / united-states / china（实际只有
 *     DEFAULT_PROFILES 里的三个）
 *   - 安全承诺写成"私有 MessagePort 下发配置"（实际是开放的 P1 桥）
 *
 * 这些用例用一份临时产物目录跑真实的 scripts/release-notes.mjs，断言正文里的数字、
 * 包名、承诺全部来自数据：数据一变正文跟着变，数据对不上直接失败。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = '9.9.9';

const domains = JSON.parse(readFileSync(join(ROOT, 'src/shared/default-domains.json'), 'utf8'));

/** 逐 preset 覆盖的 summary 字段（用来造"数据对不上"的坏产物）。 */
type SummaryOverrides = Record<string, Record<string, unknown>>;

/** 造一份"看起来像真的"产物目录：只要 summary 字段齐全，zip 存在即可。 */
function makeFixture(overrides: SummaryOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vanishgeo-notes-'));
  const presets = [
    { label: 'us-west', timezone: 'America/Los_Angeles', locale: 'en-US', acceptLanguage: 'en-US,en;q=0.9' },
    { label: 'singapore', timezone: 'Asia/Singapore', locale: 'en-SG', acceptLanguage: 'en-SG,en-US;q=0.9,en;q=0.8' },
    { label: 'japan', timezone: 'Asia/Tokyo', locale: 'ja-JP', acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7' }
  ];
  for (const preset of presets) {
    const summary = {
      name: `vanishgeo-${VERSION}-${preset.label}.zip`,
      version: VERSION,
      manifestVersion: VERSION,
      label: preset.label,
      frozen: false,
      builtAt: '2026-01-01T00:00:00.000Z',
      git: 'deadbee',
      sha256: '0'.repeat(64),
      bytes: 1024,
      fileCount: 40,
      timezone: preset.timezone,
      locale: preset.locale,
      acceptLanguage: preset.acceptLanguage,
      coordinates: [0, 0],
      staticRules: domains.length,
      domains: domains.slice(),
      ...(overrides[preset.label] || {})
    };
    writeFileSync(join(dir, `vanishgeo-${VERSION}-${preset.label}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(dir, `vanishgeo-${VERSION}-${preset.label}.zip`), 'PK\u0003\u0004');
  }
  return dir;
}

function runNotes(dir: string, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    ['scripts/release-notes.mjs', `--version=${VERSION}`, `--release-dir=${dir}`, ...extra],
    { cwd: ROOT, encoding: 'utf8' }
  );
}

test('Release 正文里的数字与包名全部来自产物', () => {
  const dir = makeFixture();
  try {
    const result = runNotes(dir);
    assert.equal(result.status, 0, result.stderr);
    const body = result.stdout;

    // 域名条数：来自 default-domains.json，写死 13 会当场失败
    assert.ok(body.includes(`${domains.length} 条域名规则`), `正文里没有「${domains.length} 条域名规则」`);
    assert.ok(body.includes(`(${domains.length} domains)`), '英文段落也要跟着数据走');
    assert.ok(!/13 (个域名|条域名)/.test(body), '正文里还留着旧的「13 个域名」');
    assert.ok(!/\b(13 domains)\b/.test(body), '英文段落还留着旧的 13 domains');

    // 包清单：三个真实存在的包 + 它们真实的时区/语言
    for (const line of [
      '| `vanishgeo-9.9.9-us-west.zip` | America/Los_Angeles | en-US |',
      '| `vanishgeo-9.9.9-singapore.zip` | Asia/Singapore | en-SG |',
      '| `vanishgeo-9.9.9-japan.zip` | Asia/Tokyo | ja-JP |'
    ]) {
      assert.ok(body.includes(line), `正文缺这一行：${line}`);
    }
    for (const absent of ['germany', 'china.zip', 'united-states.zip', 'Berlin', 'Asia/Shanghai']) {
      assert.ok(!body.includes(absent), `正文里出现了不存在的包/时区：${absent}`);
    }

    // 安全承诺：写"开放的 P1 + 权限已分权"，不写"私有 / 页面无法伪造"
    assert.ok(body.includes('已知缺口（P1）'), '正文必须写出 P1 桥缺口');
    assert.ok(body.includes('REVIEW-P1-BRIDGE.md'), '正文要指到细节文档');
    assert.ok(body.includes('按来源分权'), '正文要写后台权限边界已加固');
    for (const lie of ['私有 MessagePort', '私有且页面无法伪造', '页面无法伪造', '私有端口']) {
      assert.ok(!body.includes(lie), `正文还在用被否定的表述：${lie}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('产物与数据对不上时，正文生成直接失败', () => {
  // 少一个默认域名：说明打包用的规则集已经和 default-domains.json 分叉了
  const missing = makeFixture({ japan: { domains: domains.slice(1) } });
  try {
    const result = runNotes(missing);
    assert.notEqual(result.status, 0, '缺域名必须失败');
    assert.match(result.stderr, /缺少默认域名/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }

  // 版本串号：release/ 里混着旧包，直接传上去会让 2.4.2 的页面挂着 2.4.1 的资产
  const stale = makeFixture({ 'japan': { version: '9.9.8', manifestVersion: '9.9.8' } });
  try {
    const result = runNotes(stale);
    assert.notEqual(result.status, 0, '版本串号必须失败');
    assert.match(result.stderr, /期望 9\.9\.9/);
  } finally {
    rmSync(stale, { recursive: true, force: true });
  }

  // summary 在、zip 不在：资产上传会漏
  const orphan = makeFixture();
  try {
    rmSync(join(orphan, `vanishgeo-${VERSION}-japan.zip`));
    const result = runNotes(orphan);
    assert.notEqual(result.status, 0, 'summary 没有对应 zip 必须失败');
    assert.match(result.stderr, /没有对应的/);
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }

  // 空目录：一个字都不该发出去
  const empty = mkdtempSync(join(tmpdir(), 'vanishgeo-notes-empty-'));
  try {
    mkdirSync(join(empty, 'nested'), { recursive: true });
    const result = runNotes(empty);
    assert.notEqual(result.status, 0, '没有产物必须失败');
    assert.match(result.stderr, /没有 9\.9\.9 的烘焙包/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('变更日志通过文件注入，不从正文里猜', () => {
  const dir = makeFixture();
  const changelog = join(dir, 'changelog.md');
  writeFileSync(changelog, '- 修好了 A\n- 修好了 B\n', 'utf8');
  try {
    const result = runNotes(dir, [`--changelog-file=${changelog}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('- 修好了 A\n- 修好了 B'), '变更日志原文要进正文');
    assert.ok(!result.stdout.includes('见提交历史'), '注入了日志就不该再退回占位句');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});