import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

/*
 * 主题契约：2026-10-29 定下来的决定是「就用现在面板这两套，不做双主题」。
 *
 *   popup     浅色玻璃（--bg-top #f4faff）
 *   options   深绿配置中心（--bg #070b09）
 *   leak-test 深灰诊断页（#1a1a1a）
 *
 * 三套配色是刻意分开的，不是待统一的债；真正要守的是「系统外观不许把它们带跑」。
 * 一旦某个入口漏了 color-scheme，系统深浅色一变，原生控件与滚动条就按 UA 的
 * 默认配色画——深色页上冒出白色 select 弹层、浅色页上冒出黑色滚动条，这一条
 * 静态断言就是为了在那种改动进来时立刻红。
 */
const PAGES = [
  { name: 'popup', html: 'src/popup/popup.html', css: 'src/popup/popup.css', scheme: 'light' },
  { name: 'options', html: 'src/options/options.html', css: 'src/options/options.css', scheme: 'dark' },
  { name: 'leak-test', html: 'src/leak-test/leak-test.html', css: 'src/leak-test/leak-test.css', scheme: 'dark' }
] as const;

for (const page of PAGES) {
  test(`${page.name}：HTML 声明了 ${page.scheme} 的 color-scheme`, () => {
    const html = read(page.html);
    const meta = html.match(/<meta name="color-scheme" content="([a-z]+)">/);
    assert.ok(meta, `${page.html} 缺 <meta name="color-scheme">：系统深色下原生控件会被 UA 反色`);
    assert.equal(meta[1], page.scheme, `${page.html} 的 meta 写的是 ${meta[1]}，与这套面板不符`);
  });

  test(`${page.name}：CSS 的 :root 与 meta 声明同一个 color-scheme`, () => {
    const css = read(page.css);
    const root = css.match(/:root\s*\{([^}]*)\}/);
    assert.ok(root, `${page.css} 没有 :root 变量块`);
    const declared = root[1].match(/color-scheme:\s*([a-z]+)/);
    assert.ok(declared, `${page.css} 的 :root 没声明 color-scheme`);
    // 两处都写是因为它们在不同时刻生效：meta 在 CSS 解析之前就落地（避免首帧闪白），
    // CSS 那份负责后面的计算样式。写歪一处，页面与实际渲染就对不上。
    assert.equal(declared[1], page.scheme, `${page.css} 的 color-scheme 与 meta 不一致`);
  });
}

test('三个入口都不跟随系统外观：全仓库不许出现 prefers-color-scheme', () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(relative));
      else if (/\.(css|html|ts)$/.test(entry.name)) out.push(relative);
    }
    return out;
  };

  const offenders = walk('src').filter((file) => read(file).includes('prefers-color-scheme'));
  // 真要上双主题，得连数据契约、冒烟、截图一起改；先在单测这里挡住"顺手加个
  // @media (prefers-color-scheme: dark)"的半吊子实现 —— 那种改法只会让半张页面变色。
  assert.deepEqual(offenders, [], `这些文件里出现了 prefers-color-scheme：${offenders.join(', ')}`);
});

test('深色面板的原生控件与滚动条都有显式配色', () => {
  // color-scheme 管的是 UA 默认配色，能盖住 select 弹层与光标；滚动条与选中高亮
  // 浏览器不保证跟着走，所以深色面板自己写一遍。
  for (const page of PAGES.filter((item) => item.scheme === 'dark')) {
    const css = read(page.css);
    assert.match(css, /scrollbar-(width|color)/, `${page.css} 没给滚动条配色`);
    assert.match(css, /::selection/, `${page.css} 没给选中高亮配色`);
  }
});

test('浅色面板同样写死滚动条与选中高亮', () => {
  const css = read('src/popup/popup.css');
  assert.match(css, /scrollbar-(width|color)/, 'popup.css 没给滚动条配色');
  assert.match(css, /::selection/, 'popup.css 没给选中高亮配色');
});
