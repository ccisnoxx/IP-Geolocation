import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sectionOf } from '../scripts/lib/changelog.mjs';

/**
 * 这一层守的是"发出去的正文和源码说得一样"。
 *
 * v2.4.2 首次发布时正文的变更日志写成了「VanishGeo 首个发布」：workflow 里现算
 * `git log 上一个 tag..HEAD`，而 actions/checkout 默认 shallow、上一个 tag 根本
 * 不在本地，于是 fallback 生效。正文看起来正常、内容完全是假的 —— 比崩掉更难发现。
 */

const SAMPLE = `# 更新日志

## 2.4.1

- 旧版本

## 2.4.2

- 新版本 A
- 新版本 B

## 2.4.20

- 更远的将来
`;

test('sectionOf 只取本次版本的小节，边界靠下一个 ## 划开', () => {
  assert.equal(sectionOf(SAMPLE, '2.4.2'), '- 新版本 A\n- 新版本 B');
});

test('sectionOf 不把 2.4.2 当成 2.4.20 的前缀', () => {
  assert.equal(sectionOf(SAMPLE, '2.4.20'), '- 更远的将来');
  assert.equal(sectionOf(SAMPLE, '2.4.1'), '- 旧版本');
});

test('sectionOf 认不出来就返回空串，让调用方退回占位文案', () => {
  assert.equal(sectionOf(SAMPLE, '9.9.9'), '');
  assert.equal(sectionOf('', '2.4.2'), '');
});

test('sectionOf 允许标题带 v 前缀（tag 与 manifest 两种写法都吃得下）', () => {
  assert.equal(sectionOf('## v2.4.2\n- x\n', '2.4.2'), '- x');
});

test('仓库里的 CHANGELOG.md 必须有当前版本的小节', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { version: string };
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  assert.notEqual(sectionOf(changelog, manifest.version), '', `CHANGELOG.md 缺 ${manifest.version} 小节`);
});

test('发布工作流不再自己拼 changelog（shallow clone 下必然拼错）', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /--changelog-md=CHANGELOG\.md/);
  assert.ok(!/--changelog-file=/.test(workflow), 'release.yml 不该再传 --changelog-file');
  assert.ok(!/rev-list --tags --skip/.test(workflow), 'release.yml 不该再靠 git 历史猜上一个 tag');
});
