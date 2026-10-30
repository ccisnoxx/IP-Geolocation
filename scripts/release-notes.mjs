#!/usr/bin/env node
/*
 * 从**实际产物**生成 Release 正文。
 *
 *   node scripts/release-notes.mjs --version=2.4.2 --release-dir=release \
 *        --changelog-md=CHANGELOG.md --out=release-notes.md
 *
 * 为什么不再手写 YAML 正文：旧正文里写死了「13 个域名」「五个预设包（含 germany /
 * china / united-states）」「私有 MessagePort 下发配置」，而实际默认域名是 20 条、
 * 实际产物只有 DEFAULT_PROFILES 里的三个 —— 三处口径各说各的，用户按正文去找的包
 * 根本不存在。这里所有数字都从同一个来源读：
 *
 *   域名清单   src/shared/default-domains.json（并与打包时的 summary.domains 交叉校验）
 *   预设清单   src/shared/config-model.ts 的 DEFAULT_PROFILES（scripts/lib/presets.mjs）
 *   包文件     release/ 下真实存在的 zip + 同名 summary json
 *
 * 任何一处对不上就退出码非零：发版正文宁可失败，也不能描述一个不存在的包。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPresets } from './lib/presets.mjs';
import { sectionOf } from './lib/changelog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const version = arg('version', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const releaseDir = resolve(ROOT, arg('release-dir', 'release'));
const changelogFile = arg('changelog-file', '');
const changelogMd = arg('changelog-md', 'CHANGELOG.md');
const outPath = arg('out', '');
const domainsFile = resolve(ROOT, arg('domains', 'src/shared/default-domains.json'));


function pickChangelog({ version: releaseVersion, changelogMd, changelogFile }) {
  const mdPath = resolve(ROOT, changelogMd);
  if (changelogMd && existsSync(mdPath)) {
    const section = sectionOf(readFileSync(mdPath, 'utf8'), releaseVersion);
    if (section) return section;
    console.warn(`提示：${mdPath} 里没有 ${releaseVersion} 的小节，正文会退回占位文案`);
  }
  if (changelogFile) {
    const path = resolve(ROOT, changelogFile);
    if (!existsSync(path)) throw new Error(`没有 changelog 文件：${path}`);
    const text = readFileSync(path, 'utf8').trim();
    if (text) return text;
  }
  return '- 见提交历史 / See commit history';
}

const problems = [];

// ── 域名：默认清单是唯一来源 ────────────────────────────────────────────────
const defaultDomains = JSON.parse(readFileSync(domainsFile, 'utf8'));
if (!Array.isArray(defaultDomains) || !defaultDomains.length) {
  throw new Error(`${domainsFile} 不是非空数组`);
}
const defaultSet = new Set(defaultDomains);

// ── 预设：顺序取自 DEFAULT_PROFILES ────────────────────────────────────────
const presets = readPresets(ROOT);
const presetOrder = new Map(presets.map((preset, index) => [preset.id, index]));

// ── 产物：release/ 里真实存在的 zip + summary ──────────────────────────────
if (!existsSync(releaseDir)) throw new Error(`没有 ${releaseDir}：先跑 npm run release -- --all-presets`);
const summaryFiles = readdirSync(releaseDir).filter((name) => name.endsWith('.json'));
const builds = [];
for (const name of summaryFiles) {
  let summary;
  try {
    summary = JSON.parse(readFileSync(join(releaseDir, name), 'utf8'));
  } catch (error) {
    problems.push(`${name} 不是合法 JSON：${error.message}`);
    continue;
  }
  if (summary.version !== version) {
    problems.push(`${name} 的 version 是 ${summary.version}，期望 ${version}（旧包混进 release/ 了？）`);
    continue;
  }
  const zipName = name.replace(/\.json$/, '.zip');
  if (!existsSync(join(releaseDir, zipName))) {
    problems.push(`${name} 没有对应的 ${zipName}`);
    continue;
  }
  builds.push({ ...summary, fileName: zipName });
}

if (!builds.length) {
  problems.push(`${releaseDir} 里没有 ${version} 的烘焙包 summary`);
}

const known = new Set(presetOrder.keys());
for (const build of builds) {
  if (!known.has(build.label)) {
    problems.push(`包 ${build.fileName} 的 label "${build.label}" 不在 DEFAULT_PROFILES 里（正文会描述错包）`);
  }
  if (build.manifestVersion !== version) {
    problems.push(`${build.fileName} 的 manifest 版本是 ${build.manifestVersion}，与 ${version} 不一致`);
  }
  const baked = Array.isArray(build.domains) ? build.domains : [];
  const missing = defaultDomains.filter((domain) => !baked.includes(domain));
  if (missing.length) {
    problems.push(`${build.fileName} 缺少默认域名：${missing.join(', ')}`);
  }
  for (const domain of baked) {
    if (!defaultSet.has(domain)) problems.push(`${build.fileName} 带了不在 default-domains.json 里的域名：${domain}`);
  }
  if (typeof build.staticRules !== 'number' || build.staticRules < baked.length) {
    problems.push(`${build.fileName} 的静态规则条数 ${build.staticRules} 少于域名数 ${baked.length}`);
  }
}

if (problems.length) {
  console.error('发版正文生成失败：');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

builds.sort((a, b) => (presetOrder.get(a.label) ?? 99) - (presetOrder.get(b.label) ?? 99) || a.label.localeCompare(b.label));

// ── 变更日志 ──────────────────────────────────────────────────────────────
//
// 以前这一步是 release.yml 里现算 `git log 上一个 tag..HEAD`：shallow clone 下
// 上一个 tag 根本不在本地，于是正文写成了「VanishGeo 首个发布」—— 发出去的正文
// 和实际改动无关，正是这一版要消灭的那种分叉。现在改成读仓库里的 CHANGELOG.md，
// 按 `## <version>` 小节取；没有这一节就退回 --changelog-file，再退回一句占位。
const changelog = pickChangelog({ version, changelogMd, changelogFile });

const devZip = `vanishgeo-v${version}.zip`;
const tableRows = builds
  .map((build) => `| \`${build.fileName}\` | ${build.timezone} | ${build.locale} | ${build.acceptLanguage} |`)
  .join('\n');

const body = `## VanishGeo v${version}

### 安装 / Installation

1. 下载 \`${devZip}\` / Download \`${devZip}\`
2. 解压 / Extract it
3. 打开 \`chrome://extensions/\`，启用「开发者模式」 / Open \`chrome://extensions/\` and enable Developer mode
4. 「加载已解压的扩展程序」→ 选择解压出来的文件夹 / Load unpacked → pick the extracted folder

首次安装会自动启用内置的 ${defaultDomains.length} 条域名规则（\`src/shared/default-domains.json\`），
可在扩展的选项页里逐条开关、追加自己的域名、或用 \`!host\` 显式排除。
The built-in allowlist (${defaultDomains.length} domains) is enabled on first install;
toggle them, add your own, or exclude a host with \`!host\` in the options page.

### 两种构建 / Two kinds of build

\`${devZip}\` 是开发构建：配置经一次异步 IPC 进入页面，页面的**第一个内联脚本**可能
读到原生值。要彻底关掉这个窗口，用按预设烘焙好的包 —— 配置编译进
\`injected/runtime.js\`，\`document_start\` 同步生效：

| 包 / Package | 时区 / Timezone | 语言 / Locale | Accept-Language |
| --- | --- | --- | --- |
${tableRows}

安装方式同上。其余城市/地区可本地构建：\`npm run release -- --preset=<id>\`
（见 CONFIG_GUIDE §十）。The packaged builds are listed above; build others locally.

### 安全边界 / Security posture

后台已按来源分权：内容脚本只能调用 \`getPayloadForUrl\` / \`reportFontLayers\` /
\`reportWorkerFallback\`，UI 页面只能调用自己那几个 action，任意管理动作不再能从内容桥转发。

**已知缺口（P1）**：MAIN world 消息桥仍缺少可验证的扩展身份 —— 握手的端口由页面可观察的
\`postMessage\` 递交，构建 nonce 随发行包公开，因此页面可以抢先握手并向 runtime 提交
伪造 payload，破坏**当前页面**的配置完整性。它拿不到 \`chrome.*\` 特权 API，但
"页面里的环境值是扩展不可伪造地证明的"这句话不成立。细节见 \`REVIEW-P1-BRIDGE.md\`。

Known gap (P1): the MAIN-world message bridge has no verifiable extension identity, so a page
can race the handshake and submit a forged payload. It cannot reach \`chrome.*\`, but page-side
values are not cryptographically attested by the extension.

### 变更 / Changelog

${changelog}

### 功能 / Features

- 时区 / 语言 / 地理位置 / canvas 四层一致伪装
- 请求头与页面内 API 同源，\`Accept-Language\` 由 DNR 在首个请求前改好
- 反检测：原生函数签名、WebIDL 形状对齐（含 \`Function.prototype.toString\` 的 own-key
  与可构造性）、会话固定偏移
- 域名规则支持显式排除（\`!mail.google.com\`），最长匹配优先
- WebRTC 防泄漏、失败即关闭（fail-closed）并给出可见提示

完整文档见 README.md。`;

if (outPath && outPath !== '-') {
  writeFileSync(resolve(ROOT, outPath), `${body}\n`, 'utf8');
  console.error(`已写入 ${resolve(ROOT, outPath)}（${builds.length} 个烘焙包 + 开发构建）`);
} else {
  process.stdout.write(`${body}\n`);
}