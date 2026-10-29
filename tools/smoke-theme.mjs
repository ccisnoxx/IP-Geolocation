#!/usr/bin/env node
/*
 * 主题 smoke：三套面板必须对系统外观免疫。
 *
 * 2026-10-29 定下来的决定是「就用手上这两套面板，不做双主题」：
 *   popup     浅色玻璃
 *   options   深绿配置中心
 *   leak-test 深灰诊断页
 *
 * 这条脚本用 CDP 把 prefers-color-scheme 分别模拟成 light / dark，验三件事：
 *   1. 两档下 html 的计算 color-scheme 不变（面板把 UA 默认配色钉死）
 *   2. 两档下实际画出来的背景色不变（不是只改了声明，而是真的没跟着变）
 *   3. 模拟本身确实生效：页面里 matchMedia('(prefers-color-scheme: dark)')
 *      必须跟着档位翻转，否则第 1、2 条是在空转
 *
 * 第 3 条是这轮实测出来的事实，跟直觉相反：Chrome 的 prefers-color-scheme
 * **不**受页面 color-scheme 影响，系统切成深色它照样报 dark —— 哪怕这个页面
 * 声明了 color-scheme: light。所以 1、2 两条能绿，靠的是 color-scheme 只作用于
 * UA 默认配色（控件、滚动条、光标），而不是把媒体查询也钉住。这也正好说明为什么
 * 我们不用双主题：面板只有一套，系统外观与它无关，任何 prefers-color-scheme
 * 分支在浅色弹窗里都会给出与弹窗不一致的答案（tests/theme.test.ts 因此禁掉它）。
 */
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sleep } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const extensionPath = argv.extension
  ? resolve(String(argv.extension))
  : resolve(ROOT, 'dist');
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到扩展构建：${extensionPath}（先 npm run build，或用 --extension 指一个）`);
  process.exit(1);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

// 面板期望：scheme 是声明的计算值，tone 是背景该有的明暗
const PANELS = [
  { name: 'popup', path: 'popup/popup.html', scheme: 'light', tone: 'light' },
  { name: 'options', path: 'options/options.html', scheme: 'dark', tone: 'dark' },
  { name: 'leak-test', path: 'leak-test/leak-test.html', scheme: 'dark', tone: 'dark' }
];

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-theme-')),
  headless: true,
  args: []
});
const cdp = await CDP.connect(chrome.websocketUrl);
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp.close(); } catch { /* noop */ }
  try { killChrome(chrome.child); } catch { /* noop */ }
  if (!argv.keep) {
    try { rmSync(chrome.userDataDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
process.on('exit', () => { try { killChrome(chrome.child); } catch { /* noop */ } });

/** 读一次"画出来是什么样"：声明值 + 真实背景 + 媒体查询答案。 */
async function snapshot(sessionId) {
  return evaluate(cdp, sessionId, `(() => {
    const html = document.documentElement;
    const body = document.body;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = getComputedStyle(body);
    // body 可能只有渐变（backgroundColor 是 transparent），所以两层都取
    const painted = bodyStyle.backgroundImage !== 'none'
      ? bodyStyle.backgroundImage
      : bodyStyle.backgroundColor;
    return {
      scheme: htmlStyle.colorScheme.trim(),
      background: painted,
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      prefersLight: matchMedia('(prefers-color-scheme: light)').matches
    };
  })()`);
}

async function emulate(sessionId, value) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  }, sessionId);
  // 媒体查询与 color-scheme 的重算是同步的，但给样式解析留一帧
  await sleep(80);
}

try {
  const extensionId = await loadExtension(cdp, extensionPath);
  if (!extensionId) throw new Error('扩展没有返回 extension id');

  const opened = [];
  for (const panel of PANELS) {
    const page = await openPageStable(cdp, `chrome-extension://${extensionId}/${panel.path}`);
    opened.push({ panel, page });
  }

  for (const { panel, page } of opened) {
    await emulate(page.sessionId, 'light');
    const light = await snapshot(page.sessionId);
    await emulate(page.sessionId, 'dark');
    const dark = await snapshot(page.sessionId);

    check(`${panel.name}：系统浅色/深色下 color-scheme 都是 ${panel.scheme}`,
      light.scheme === panel.scheme && dark.scheme === panel.scheme,
      `${light.scheme} / ${dark.scheme}`);

    check(`${panel.name}：背景不随系统外观变化`,
      light.background === dark.background,
      light.background === dark.background ? panel.tone : `${light.background} ≠ ${dark.background}`);

    // 这一条验的是"模拟生效"，不是"面板钉死了媒体查询"——后者是错的假设，
    // 记在这里免得下次有人照着错的直觉改断言。
    check(`${panel.name}：模拟生效（媒体查询跟着档位翻转）`,
      light.prefersDark === false && dark.prefersDark === true,
      `light 档=${light.prefersDark} dark 档=${dark.prefersDark}`);
  }
} catch (error) {
  check('主题免疫流程', false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed ? 1 : 0;
