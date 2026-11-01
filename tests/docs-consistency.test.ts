import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 文档与仓库的一致性守卫。
 *
 * 这一轮的返工基本上都是"文档写的是上一版的行为"：三种匹配模式、通配符、
 * 默认 persona 钉死时区、保存就重载所有页面、Proxy 包装。所以把能机械检查的
 * 部分钉住 —— 检查不了的（描述是否准确）留给 review。
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

const DOC_FILES = ['README.md', 'INSTALL.md', 'CONFIG_GUIDE.md', 'RELEASE.md', 'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md'];

test('文档里没有真实 IP 和个人绝对路径', () => {
  for (const file of DOC_FILES) {
    const text = read(file);
    // 允许 0.0.0.0 / 127.0.0.1 这类示例地址，其余 IPv4 一律视为泄漏
    const ips = (text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])
      .filter((ip) => !/^(?:0\.0\.0\.0|127\.0\.0\.1|255\.255\.255\.255)$/.test(ip));
    assert.deepEqual(ips, [], `${file} 出现了真实 IP`);
    assert.doesNotMatch(text, /\/Users\/[a-z]/i, `${file} 出现了个人绝对路径`);
    assert.doesNotMatch(text, /~\/\.vanishgeo\/profiles\/?$/m, `${file} 指向了浏览器 profile`);
  }
});

test('文档描述的是现行匹配模型：域名规则 + 排除，没有通配符和三模式', () => {
  const readme = read('README.md');

  // 允许"没有 X / 不支持 X"这种否定句，禁止正面宣传旧模型
  const NEGATIONS = /没有|不支持|无通配符|no wildcards|not supported|are no|no longer|不该|不是 Proxy/;
  const forbidden: Array<[string, RegExp]> = [
    ['通配符示例', /\*\.(?:google|example)\.com|\*(?:openai|keyword)\*/],
    ['三种匹配模式', /黑名单模式|全局模式|whitelist mode|blacklist mode/i],
    ['Proxy 包装', /[Uu]se Proxy to wrap|使用 Proxy 包装/]
  ];
  for (const [label, pattern] of forbidden) {
    for (const line of readme.split('\n')) {
      if (!pattern.test(line)) continue;
      assert.match(line, NEGATIONS, `README 出现${label}的正面描述：${line.trim()}`);
    }
  }

  // 现行模型必须在文档里出现
  assert.match(readme, /!mail\.google\.com/, '需要给出显式排除的示例');
  assert.match(readme, /最长匹配优先|longest match wins/i, '需要说明最长匹配优先');
  assert.match(readme, /不支持通配符|no wildcards/i, '需要明确说不支持通配符');
});

test('文档里引用的本地文件都存在', () => {
  for (const file of [...DOC_FILES, 'public/icons/README.md']) {
    const text = read(file);
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const link of links) {
      const target = link.split('#')[0].trim();
      if (!target || /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:')) continue;
      // 相对链接按文档所在目录解析，与 GitHub 渲染一致
      assert.equal(exists(path.join(path.dirname(file), target)), true, `${file} 引用了不存在的文件：${target}`);
    }
  }
});

test('品牌统一：除迁移说明与上游署名外不出现旧名', () => {
  // 旧名只允许出现在三种语境里：从旧版迁移、旧字标待重出、以及 MIT 要求的上游署名。
  // 第三种不能省 —— 署名被删掉就不是"改名干净"，而是许可问题。
  const ALLOWED = /convertVanishMeConfig|旧字标|旧版|old `VanishMe`|migrate|NOTICE|署名|attribution|许可/i;
  for (const file of DOC_FILES) {
    for (const [index, line] of read(file).split('\n').entries()) {
      if (!line.includes('VanishMe')) continue;
      assert.match(line, ALLOWED, `${file}:${index + 1} 残留旧品牌：${line.trim()}`);
    }
  }
});

test('CI 跑 typecheck + lint + 单测，release 显式声明 contents: write', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /run: npm run typecheck/);
  assert.match(ci, /run: npm run lint/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /run: npm run test:coverage:core/);
  assert.match(ci, /run: npm run build/);
  assert.match(ci, /permissions:\s*\n\s*contents: read/);

  const release = read('.github/workflows/release.yml');
  assert.match(release, /run: npm run lint/);
  assert.match(release, /permissions:\s*\n\s*contents: write/);
  // 打包前必须先过校验，否则会发出一个类型不干净的包
  const typecheckAt = release.indexOf('npm run typecheck');
  const buildAt = release.indexOf('npm run build');
  assert.ok(typecheckAt > 0 && buildAt > 0 && typecheckAt < buildAt, '校验要在打包之前');
  assert.match(release, /vanishgeo-v\$\{\{/);
  assert.doesNotMatch(release, /vanishme-v/, '产物名不该再带旧品牌');
});

test('横幅：PNG 与 SVG 源文件尺寸一致，README 引用的是渲染结果', () => {
  for (const name of ['banner-zh', 'banner-en']) {
    const svgPath = `images/${name}.svg`;
    const pngPath = `images/${name}.png`;
    assert.equal(exists(svgPath), true, `缺源文件 ${svgPath}`);
    assert.equal(exists(pngPath), true, `缺渲染结果 ${pngPath}`);

    const svg = read(svgPath);
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(viewBox, `${svgPath} 缺 viewBox`);
    const [width, height] = [Number(viewBox![1]), Number(viewBox![2])];

    const png = fs.readFileSync(path.join(projectRoot, pngPath));
    assert.equal(png.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n');
    // PNG 头里的尺寸必须等于 SVG 的画布：不一致说明 PNG 是改 SVG 之前渲染的旧图
    assert.equal(png.readUInt32BE(16), width, `${pngPath} 宽 ${png.readUInt32BE(16)} != SVG ${width}`);
    assert.equal(png.readUInt32BE(20), height, `${pngPath} 高 ${png.readUInt32BE(20)} != SVG ${height}`);

    assert.match(read('README.md'), new RegExp(`images/${name}\\.png`), `README 没有引用 ${pngPath}`);
  }
});

test('横幅里不残留旧字标', () => {
  for (const name of ['banner-zh', 'banner-en']) {
    const svg = read(`images/${name}.svg`);
    assert.doesNotMatch(svg, /VanishMe/, `${name}.svg 仍写着旧名`);
    assert.match(svg, />VanishGeo</, `${name}.svg 缺 VanishGeo 字标`);
  }
});

test('核心覆盖率门禁按文件检查分支且阈值是 85%', () => {
  const pkg = JSON.parse(read('package.json'));
  const command = pkg.scripts['test:coverage:core'];
  assert.match(command, /--per-file/);
  assert.match(command, /--branches=85/);
  assert.match(command, /c8/);
  for (const file of [
    'src/background/services.ts',
    'src/background/dnr.ts',
    'src/content/content-bridge.ts',
    'src/injected/baked-resolver.ts',
    'src/shared/config-model.ts',
    'src/shared/config-resolver.ts'
  ]) {
    assert.match(command, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('nightly 自动安装 Chrome 119 并跑浏览器审计', () => {
  const nightly = read('.github/workflows/nightly.yml');
  assert.match(nightly, /npm run setup:chrome119/);
  assert.match(nightly, /setup-browsers\.mjs --chrome=119 --check/);
  assert.match(nightly, /npm run audit/);
  const setup = read('scripts/setup-browsers.mjs');
  assert.match(setup, /119\.0\.6045\.105/);
  assert.match(setup, /SHA256/);
});

test('新增 preset / 冷启动 / popup 浏览器检查已接入 audit 与 npm scripts', () => {
  const pkg = JSON.parse(read('package.json'));
  const audit = read('tools/audit.mjs');
  assert.equal(pkg.scripts['smoke:presets'], 'node tools/smoke-presets.mjs');
  assert.equal(pkg.scripts['smoke:cold-start'], 'node tools/smoke-cold-start.mjs');
  assert.equal(pkg.scripts['smoke:popup'], 'node tools/smoke-popup.mjs');
  for (const id of ['presets', 'coldstart', 'popup']) {
    assert.match(audit, new RegExp(`id: '${id}'`));
  }
});
