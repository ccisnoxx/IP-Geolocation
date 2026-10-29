import test from 'node:test';
import assert from 'node:assert/strict';
import { languagesDiffer, needsLanguagePatch, needsLocalePatch } from '../src/injected/patch-needs';

/**
 * 报告里第 3 条：首选语言相同、完整语言列表不同时，语言补丁被整个跳过。
 *
 * 旧代码只比 `state.language !== signals.native.language`，于是
 * `navigator.language` 是 `en-US`、`navigator.languages` 还是 `["en-US","fr"]`，
 * 而请求头已经按 `["en-US","en"]` 改过了 —— 一处就能对上号。
 */

test('首选语言相同但列表不同：必须装语言补丁', () => {
  assert.equal(
    needsLanguagePatch({ language: 'en-US', languages: ['en-US', 'en'] }, { language: 'en-US', languages: ['en-US', 'fr'] }),
    true
  );
});

test('列表长度相同但第二项不同也算不同（逐项比，不只比长度）', () => {
  assert.equal(languagesDiffer(['en-US', 'en'], ['en-US', 'fr']), true);
  assert.equal(languagesDiffer(['en-US', 'fr'], ['en-US', 'en']), true);
});

test('首选语言和列表都一致时不动任何东西', () => {
  assert.equal(
    needsLanguagePatch({ language: 'en-US', languages: ['en-US', 'en'] }, { language: 'en-US', languages: ['en-US', 'en'] }),
    false
  );
  assert.equal(languagesDiffer(['en-US', 'en'], ['en-US', 'en']), false);
});

test('首选语言不同时立即需要补丁（不必再看列表）', () => {
  assert.equal(needsLanguagePatch({ language: 'ja-JP', languages: ['ja-JP', 'ja'] }, { language: 'zh-CN', languages: ['zh-CN', 'zh'] }), true);
});

test('没有目标语言时不装补丁（关掉语言伪装要能真的回到原生）', () => {
  assert.equal(needsLanguagePatch({ language: null, languages: null }, { language: 'zh-CN', languages: ['zh-CN', 'zh'] }), false);
  assert.equal(needsLanguagePatch({ language: '', languages: [''] }, { language: 'zh-CN', languages: [] }), false);
});

test('目标列表为空时不声称有差异（避免"空配置也算改过"）', () => {
  assert.equal(languagesDiffer([], ['en-US', 'en']), false);
  assert.equal(languagesDiffer(null, null), false);
});

test('locale 层独立判定：时区已经对、只有语言要改时仍要装', () => {
  assert.equal(needsLocalePatch({ language: 'en-US' }, { locale: 'en-US' }), false);
  assert.equal(needsLocalePatch({ language: 'ja-JP' }, { locale: 'en-US' }), true);
  assert.equal(needsLocalePatch({ language: null }, { locale: 'en-US' }), false);
});
