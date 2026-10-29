#!/usr/bin/env node
/*
 * 冷启动窗口内保存配置的回归。
 *
 *   node tools/smoke-cold-save.mjs                 # 跑 dist
 *   node tools/smoke-cold-save.mjs --extension=... # 跑烘焙包
 *
 * 盯的是一个真实事故：`bootstrap()` 先读配置再应用，两次之间用户可能已经保存 ——
 * 旧实现会把读到的旧快照在保存之后应用回去（DNR 规则与 payload 全变回默认，
 * storage 里却是用户配置，界面还显示"已保存"）。修复前实测 3 轮里 2 轮不一致，
 * 修复后 5 轮全一致；这里每轮都用全新 profile，因为冷启动窗口只在第一次出现。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}


async function attempt(index) {
  // 每轮都用全新 profile：冷启动窗口只在 SW 第一次起来时存在
  const chrome = await launchChrome({ userDataDir: mkdtempSync(join(tmpdir(), `cold-save-${index}-`)), headless: true, args: [] });
  const cdp = await CDP.connect(chrome.websocketUrl);
  const id = await loadExtension(cdp, ROOT + '/dist');
  const options = await openPageStable(cdp, `chrome-extension://${id}/options/options.html`);
  // 故意不等待：在 bootstrap 还没跑完时保存
  const base = (await sendRuntimeMessage(cdp, options.sessionId, { action: 'getSiteConfig' })).config;
  const marker = `race-${index}.example`;
  const saved = await sendRuntimeMessage(cdp, options.sessionId, {
    action: 'setSiteConfig',
    config: {
      ...base,
      masterEnabled: true,
      globalProfile: {
        ...base.globalProfile,
        language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' }
      },
      rules: [{ id: 'r1', domain: marker, enabled: true }]
    }
  });
  // 不再只睡 3 秒看一眼：CI 上这一关曾经 0/3，需要分清是"慢"还是"没生效"。
  // 轮询到一致或超时，并把 setSiteConfig 的响应一起打出来。
  const readState = async () => JSON.parse(await evaluate(cdp, options.sessionId, `(async () => {
    const stored = (await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig;
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return JSON.stringify({
      storedDomains: (stored.rules || []).map((r) => r.domain),
      storedLanguage: stored.globalProfile && stored.globalProfile.language && stored.globalProfile.language.language,
      dnrDomains: [...new Set(rules.flatMap((r) => r.condition.requestDomains || []))],
      dnrValue: [...new Set(rules.flatMap((r) => (r.action.requestHeaders || []).map((h) => h.value)))],
      dnrCount: rules.length
    });
  })()`, { awaitPromise: true }));

  const matches = (state) => state.storedDomains.includes(marker)
    && state.dnrDomains.includes(marker)
    && state.dnrValue.length === 1
    && state.dnrValue[0] === 'ja-JP,ja;q=0.9';

  const startedAt = Date.now();
  let state = await readState();
  while (!matches(state) && Date.now() - startedAt < 12_000) {
    await sleep(250);
    state = await readState();
  }
  const elapsed = Date.now() - startedAt;
  const consistent = matches(state);
  const savedNote = saved && saved.status ? `save=${saved.status}` : `save=${JSON.stringify(saved)}`;
  check(
    `第 ${index} 轮：storage 与 DNR 规则一致（${state.storedDomains.join(',')}）`,
    consistent,
    `${savedNote} 等了 ${elapsed}ms ${JSON.stringify(state)}`
  );
  cdp.close(); killChrome(chrome.child);
  return consistent;
}

const outcomes = [];
for (let i = 1; i <= 3; i += 1) outcomes.push(await attempt(i));
const failed = outcomes.filter((ok) => !ok).length;
console.log(`\n${outcomes.length - failed}/${outcomes.length} 通过`);
process.exitCode = failed ? 1 : 0;
