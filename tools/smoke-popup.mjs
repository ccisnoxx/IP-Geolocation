#!/usr/bin/env node
/*
 * popup 浏览器 smoke：真实扩展页面 + 真实 chrome.storage / 后台消息。
 *
 * 打开扩展的 popup.html（作为普通扩展页），切换全局开关，确认：
 *   - 页面上的 checkbox 状态同步
 *   - chrome.storage 里的 siteSpoofConfig.masterEnabled 持久化
 *   - 再切回来能恢复
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, waitFor } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const extensionPath = resolve(String(argv.extension || join(homedir(), '.vanishgeo', 'profiles', 'us-la-1', 'ext')));
if (!existsSync(join(extensionPath, 'manifest.json'))) {
  console.error(`找不到扩展构建：${extensionPath}`);
  process.exit(1);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}

if (process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-popup-')),
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

async function readPopup(sessionId) {
  return evaluate(cdp, sessionId, `new Promise((resolve) => {
    chrome.storage.local.get(['siteSpoofConfig'], (data) => resolve({
      checked: Boolean(document.getElementById('globalEnabled')?.checked),
      masterEnabled: data.siteSpoofConfig?.masterEnabled,
      status: document.getElementById('globalStatus')?.textContent || ''
    }));
  })`, { awaitPromise: true });
}

try {
  const extensionId = await loadExtension(cdp, extensionPath);
  if (!extensionId) throw new Error('扩展没有返回 extension id');
  const popup = await openPageStable(cdp, `chrome-extension://${extensionId}/popup/popup.html`);
  // 等面板自己说"画完了"，而不是等 storage 读到了 —— 后者在慢引擎上会早于渲染完成
  await waitFor(async () => await evaluate(cdp, popup.sessionId,
    `document.documentElement.dataset.popupReady === '1'`), {
    timeout: 15000,
    label: 'popup 首屏渲染'
  });
  const initial = await readPopup(popup.sessionId);
  check('popup 初始状态与 storage 一致', initial.checked === initial.masterEnabled, JSON.stringify(initial));

  await evaluate(cdp, popup.sessionId, `document.getElementById('globalEnabled').click()`);
  const toggled = await waitFor(async () => {
    const value = await readPopup(popup.sessionId);
    return value.masterEnabled !== initial.masterEnabled ? value : null;
  }, { timeout: 5000, label: 'popup toggle persist' });
  check('切换后 checkbox 与 storage 同步', toggled.checked === toggled.masterEnabled, JSON.stringify(toggled));
  check('切换后状态文案更新', toggled.status.includes(toggled.masterEnabled ? '启用' : '禁用'), toggled.status);

  await evaluate(cdp, popup.sessionId, `document.getElementById('globalEnabled').click()`);
  const restored = await waitFor(async () => {
    const value = await readPopup(popup.sessionId);
    return value.masterEnabled === initial.masterEnabled ? value : null;
  }, { timeout: 10000, label: 'popup restore' });
  check('再次切换恢复原值', restored.checked === initial.checked, JSON.stringify(restored));
} catch (error) {
  check('popup 浏览器流程', false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed ? 1 : 0;
