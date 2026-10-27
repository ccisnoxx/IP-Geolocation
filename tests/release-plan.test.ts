import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configFromPersona,
  configFromPreset,
  releaseFileName,
  resolveDomains,
  verifyBakedRuntime
} from '../scripts/lib/bake-plan.mjs';
import { createZip } from '../scripts/lib/zip.mjs';
import { auditConfig } from '../src/shared/config-audit';
import { DEFAULT_PROFILES, normalizeConfig } from '../src/shared/config-model';

/**
 * 发布流水线里"能算的那部分"。
 *
 * 真构建（vite）不在这里跑：它慢、而且断言的是产物而不是逻辑。这里守住三件真正
 * 容易错的事 —— 烘焙配置本身是否自洽、命名与校验规则、以及 zip 能不能被解开。
 */

const DOMAINS = ['claude.ai', 'anthropic.com'];

test('preset → 烘焙配置：三处取值同源，且能过配置体检', () => {
  for (const preset of DEFAULT_PROFILES) {
    const config = normalizeConfig(configFromPreset(preset, { domains: DOMAINS }) as any);

    assert.equal(config.globalProfile.timezone.timezone, preset.timezone.timezone, `${preset.id}: 时区`);
    assert.equal(config.globalProfile.language.language, preset.language.language, `${preset.id}: 主语言`);
    assert.deepEqual(config.globalProfile.language.languages, preset.language.languages, `${preset.id}: 语言列表`);
    assert.equal(config.globalProfile.geolocation.latitude, preset.geolocation.latitude, `${preset.id}: 纬度`);
    assert.equal(config.globalProfile.geolocation.longitude, preset.geolocation.longitude, `${preset.id}: 经度`);

    // 发布的包不能自带矛盾：这条把 P2 的体检接到发布路径上
    assert.deepEqual(
      auditConfig(config).map((finding) => finding.id),
      [],
      `${preset.id} 的烘焙配置自带问题`
    );
  }
});

test('preset → 烘焙配置：域名规则逐个启用，id 稳定', () => {
  const config = configFromPreset(DEFAULT_PROFILES[0], { domains: DOMAINS });
  assert.deepEqual(config.rules.map((rule) => rule.domain), DOMAINS);
  assert.ok(config.rules.every((rule) => rule.enabled === true));
  assert.deepEqual(config.rules.map((rule) => rule.id), ['rule-0', 'rule-1']);
});

test('persona → 烘焙配置：扁平字段被摊进 globalProfile', () => {
  const config = normalizeConfig(configFromPersona({
    timezone: 'America/Los_Angeles',
    locale: 'en-US',
    acceptLanguage: 'en-US,en',
    latitude: 37.7749,
    longitude: -122.4194
  }, { domains: DOMAINS }) as any);

  assert.equal(config.globalProfile.timezone.timezone, 'America/Los_Angeles');
  assert.equal(config.globalProfile.language.language, 'en-US');
  assert.deepEqual(config.globalProfile.language.languages, ['en-US', 'en']);
  assert.equal(config.globalProfile.geolocation.latitude, 37.7749);
  assert.deepEqual(auditConfig(config).map((finding) => finding.id), []);
});

test('persona 缺字段时有兜底，不会烘焙出 NaN 坐标', () => {
  const config = configFromPersona({}, { domains: DOMAINS });
  assert.equal(config.globalProfile.timezone.timezone, 'UTC');
  assert.equal(config.globalProfile.language.language, 'en-US');
  // 缺坐标时 Number(undefined) 是 NaN，序列化后是 null —— 至少不该是 NaN 字符串
  assert.equal(Number.isNaN(config.globalProfile.geolocation.latitude), true);
  assert.equal(JSON.parse(JSON.stringify(config)).globalProfile.geolocation.latitude, null);
});

test('域名解析：给了就用给的，没给回落到内置白名单', () => {
  assert.deepEqual(resolveDomains(['a.com'], 'x.com, y.com ,,'), ['x.com', 'y.com']);
  assert.deepEqual(resolveDomains(['a.com'], ''), ['a.com']);
  assert.deepEqual(resolveDomains(['a.com'], undefined), ['a.com']);
});

test('产物命名：label 里的奇怪字符被收敛，frozen 有后缀', () => {
  assert.equal(releaseFileName({ version: '1.2.1', label: 'singapore' }), 'vanishgeo-1.2.1-singapore.zip');
  assert.equal(releaseFileName({ version: '1.2.1', label: 'us-la-1', frozen: true }), 'vanishgeo-1.2.1-us-la-1-frozen.zip');
  // 纯中文 label 清干净后是空串：退回到稳定哈希，而不是报错挡住发布
  const chinese = releaseFileName({ version: '1.2.1', label: '中国 上海' });
  assert.match(chinese, /^vanishgeo-1\.2\.1-label-[0-9a-f]{8}\.zip$/);
  assert.equal(chinese, releaseFileName({ version: '1.2.1', label: '中国 上海' }), '同一个标签必须给出同一个名字');
  assert.notEqual(chinese, releaseFileName({ version: '1.2.1', label: '日本' }));
});

test('产物校验：开发构建必须被拦下（首屏窗口就在这儿漏出去的）', () => {
  const devRuntime = 'import { a } from "./x.js";\nconsole.log(window.__VANISHGEO_BAKED__);\n';
  const result = verifyBakedRuntime(devRuntime, { timezone: 'Asia/Singapore', locale: 'en-SG' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => item.includes('经典脚本')));
  assert.ok(result.problems.some((item) => item.includes('__VANISHGEO_BAKED__')));
  assert.ok(result.problems.some((item) => item.includes('Asia/Singapore')));
  assert.ok(result.problems.some((item) => item.includes('en-SG')));
});

test('产物校验：烘焙构建通过，版本不一致与空规则会被挑出来', () => {
  const baked = '(function(){"use strict";var tz="Asia/Singapore",loc="en-SG";})();';
  assert.deepEqual(
    verifyBakedRuntime(baked, { timezone: 'Asia/Singapore', locale: 'en-SG', version: '1.2.1', manifestVersion: '1.2.1', rules: [{}] }),
    { ok: true, problems: [] }
  );

  const versionMismatch = verifyBakedRuntime(baked, {
    timezone: 'Asia/Singapore', locale: 'en-SG', version: '1.2.1', manifestVersion: '1.2.0', rules: [{}]
  });
  assert.equal(versionMismatch.ok, false);
  assert.match(versionMismatch.problems.join('\n'), /版本/);

  const emptyRules = verifyBakedRuntime(baked, {
    timezone: 'Asia/Singapore', locale: 'en-SG', rules: []
  });
  assert.match(emptyRules.problems.join('\n'), /baked-language\.json/);
});

test('zip：能被系统 unzip -t 解开，内容逐字节一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vanishgeo-zip-'));
  try {
    const content = Buffer.from('console.log("中文 & unicode ✓");\n'.repeat(200));
    const binary = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const zip = createZip([
      { path: 'injected/runtime.js', data: content },
      { path: 'icons/icon.png', data: binary }
    ], { date: new Date('2026-01-02T03:04:06Z') });

    const zipPath = join(dir, 'test.zip');
    writeFileSync(zipPath, zip);
    execFileSync('unzip', ['-q', zipPath, '-d', join(dir, 'out')], { stdio: 'inherit' });

    assert.equal(readFileSync(join(dir, 'out', 'injected', 'runtime.js')).toString(), content.toString());
    assert.deepEqual([...readFileSync(join(dir, 'out', 'icons', 'icon.png'))], [...binary]);

    // 只读一次表头也要能通过（CRC 与长度都写对了）
    const test = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
    assert.match(test, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});