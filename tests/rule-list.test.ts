import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeRule } from '../src/shared/config-model';
import { validateConfig } from '../src/shared/config-resolver';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';

const enabled = normalizeRule({ id: 'enabled-id', domain: 'enabled.example' });
const disabled = normalizeRule({
  id: 'disabled-id',
  domain: 'disabled.example',
  enabled: false,
  exitLocationProfileId: 'saved-exit',
  overrides: {
    language: { mode: 'override', value: { language: 'ja-JP', languages: ['ja-JP'], acceptLanguage: 'ja-JP' } },
    timezone: { mode: 'override', value: { mode: 'manual', timezone: 'UTC' } },
    geolocation: { mode: 'disable', value: null }
  }
});

test('规则文本只显示启用域名，无关文本保存保留交错的禁用规则及顺序', () => {
  const rules = [disabled, enabled, normalizeRule({ id: 'other-disabled', domain: 'other.example', enabled: false })];
  const text = ruleListToText(rules);
  assert.equal(text, 'enabled.example');
  assert.deepEqual(rulesFromText(text, rules), rules);
});

test('空行、大小写和 URL 归一化后去重，复用现有规则配置', () => {
  const rules = rulesFromText('\n ENABLED.EXAMPLE \r\nhttps://enabled.example/path?q=1\n\t\nNEW.EXAMPLE\nhttps://new.example/\n', [enabled]);
  assert.deepEqual(rules.map((rule) => rule.domain), ['enabled.example', 'new.example']);
  assert.deepEqual(rules[0], enabled);
  assert.equal(rules[1].enabled, true);
  assert.equal(rules[1].exitLocationProfileId, null);
  assert.deepEqual(rules[1].overrides, normalizeRule({ id: 'defaults', domain: 'new.example' }).overrides);
});

test('重新写入禁用域名时原位启用并保留 ID、overrides 和出口绑定', () => {
  const rules = rulesFromText('enabled.example\nhttps://DISABLED.EXAMPLE/path\ndisabled.example', [disabled, enabled]);
  assert.deepEqual(rules, [{ ...disabled, enabled: true }, enabled]);
});

test('从文本移除启用规则时删除该规则，保留其他禁用规则', () => {
  const other = normalizeRule({ id: 'keep-id', domain: 'keep.example' });
  assert.deepEqual(rulesFromText('keep.example', [enabled, disabled, other]), [disabled, other]);
});

test('清空启用文本只删除启用规则，全部禁用或空配置仍保持原集合', () => {
  assert.deepEqual(rulesFromText(' \n\r\n', [enabled, disabled]), [disabled]);
  assert.deepEqual(rulesFromText('', [disabled]), [disabled]);
  assert.deepEqual(rulesFromText('', []), []);
});

test('文本重排不重排已有规则，新域名按文本首次出现顺序追加', () => {
  const other = normalizeRule({ id: 'other-id', domain: 'other.example' });
  const result = rulesFromText('second.example\nother.example\nfirst.example\nenabled.example', [enabled, disabled, other]);
  assert.deepEqual(result.slice(0, 3), [enabled, disabled, other]);
  assert.deepEqual(result.slice(3).map((rule) => rule.domain), ['second.example', 'first.example']);
});

test('合并不修改输入，相同输入和重复编辑结果幂等，新规则 ID 不与已有 ID 冲突', () => {
  const colliding = normalizeRule({ id: 'rule-new.example', domain: 'reserved.example', enabled: false });
  const input = [disabled, enabled, colliding];
  const before = structuredClone(input);
  const text = 'enabled.example\ndisabled.example\nnew.example';
  const first = rulesFromText(text, input);
  assert.deepEqual(input, before);
  assert.deepEqual(rulesFromText(text, input), first);
  assert.deepEqual(rulesFromText(text, first), first);
  assert.equal(new Set(first.map((rule) => rule.id)).size, first.length);
});

test('无效域名继续交给权威配置校验，不静默丢弃或放宽校验', () => {
  const result = validateConfig(normalizeConfig({ rules: rulesFromText('bad_domain', [disabled]) }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' | '), /domain is invalid/);
  assert.ok(result.config.rules.some((rule) => rule.domain === 'bad_domain'));
  assert.deepEqual(result.config.rules.find((rule) => rule.id === disabled.id), disabled);
});
