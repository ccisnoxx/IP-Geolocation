import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentScriptRegistration,
  getEffectiveProfile,
  getExcludedRuleDomains,
  isUrlMatchedByEnabledRule,
  resolveRuleMatch
} from '../src/shared/config-resolver';
import { buildAcceptLanguageRules } from '../src/background/dnr';
import { normalizeConfig } from '../src/shared/config-model';
import { ruleLines, rulesFromText } from '../src/shared/rule-text';
import { describeSiteStatus } from '../src/shared/site-status';
import type { LastLocation } from '../src/shared/types';

const lastLocation: LastLocation = {
  latitude: 34.0522,
  longitude: -118.2437,
  country: 'United States',
  timezone: 'America/Los_Angeles',
  updateTime: '2026-01-01 00:00:00'
};

function config(rules: Array<{ domain: string; enabled: boolean }>) {
  return normalizeConfig({ masterEnabled: true, rules } as any);
}

test('disabled 规则命中时整站排除，不回落到父域配置', () => {
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false }
  ]);

  assert.equal(resolveRuleMatch(cfg, 'google.com').excluded, false);
  assert.equal(resolveRuleMatch(cfg, 'drive.google.com').excluded, false, '子域继承父域的启用');
  assert.equal(resolveRuleMatch(cfg, 'mail.google.com').excluded, true);
  assert.equal(resolveRuleMatch(cfg, 'a.mail.google.com').excluded, true, '排除覆盖整棵子树');

  const excluded = getEffectiveProfile(cfg, 'mail.google.com', lastLocation);
  assert.equal(excluded.matched, false);
  assert.equal(excluded.payload, null, '被排除的站点不能拿到任何 payload');
  assert.equal(excluded.excluded, true);

  const inherited = getEffectiveProfile(cfg, 'drive.google.com', lastLocation);
  assert.equal(inherited.matched, true);
  assert.ok(inherited.payload, '未排除的子域照常生效');
});

test('排除影响 URL 判定与内容脚本注册范围', () => {
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false }
  ]);

  assert.equal(isUrlMatchedByEnabledRule(cfg, 'https://drive.google.com/x'), true);
  assert.equal(isUrlMatchedByEnabledRule(cfg, 'https://mail.google.com/u/0'), false);

  const { matches, excludeMatches } = getContentScriptRegistration(cfg);
  assert.deepEqual(matches, ['*://google.com/*', '*://*.google.com/*']);
  assert.deepEqual(excludeMatches, ['*://mail.google.com/*', '*://*.mail.google.com/*']);
  assert.deepEqual(getExcludedRuleDomains(cfg), ['mail.google.com']);
});

test('排除项也会从 Accept-Language 规则里挖掉', () => {
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false }
  ]);

  const rules = buildAcceptLanguageRules(cfg);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.requestDomains, ['google.com']);
  assert.deepEqual(rules[0].condition.excludedRequestDomains, ['mail.google.com']);
});

test('更深层还有启用规则时不做浏览器级排除（否则会连带挡掉它）', () => {
  // 已知限制：浏览器级的 excludeMatches / excludedRequestDomains 表达不了
  // "排除里再放行"，所以这种三层结构里被排除的中间域名在请求头上仍会跟着父域走。
  // 页面侧的排除由 payload 解析兜底（getEffectiveProfile 会返回 excluded）。
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false },
    { domain: 'inbox.mail.google.com', enabled: true }
  ]);

  assert.deepEqual(getExcludedRuleDomains(cfg), []);
  const { excludeMatches } = getContentScriptRegistration(cfg);
  assert.deepEqual(excludeMatches, []);
  assert.equal(getEffectiveProfile(cfg, 'mail.google.com', lastLocation).excluded, true);
});

test('站点状态能把"被排除"和"不在白名单"区分开', () => {
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false }
  ]);

  const excluded = describeSiteStatus(getEffectiveProfile(cfg, 'mail.google.com', lastLocation));
  assert.equal(excluded.reason, 'excluded');
  assert.equal(excluded.active, false);
  assert.equal(excluded.broken, false, '排除是用户意图，不算"坏了"');

  const notListed = describeSiteStatus(getEffectiveProfile(cfg, 'example.com', lastLocation));
  assert.equal(notListed.reason, 'not-allowlisted');
});

test('规则文本往返：disabled 规则带 ! 前缀，保存一轮不丢', () => {
  const rules = rulesFromText('google.com\n!mail.google.com\nchatgpt.com', []);
  assert.deepEqual(
    rules.map((rule) => [rule.domain, rule.enabled]),
    [['google.com', true], ['mail.google.com', false], ['chatgpt.com', true]]
  );

  assert.equal(ruleLines(rules), 'google.com\n!mail.google.com\nchatgpt.com');

  // 往返两轮必须完全一致（旧实现第一轮就把 !mail 丢了）
  const second = rulesFromText(ruleLines(rules), rules);
  assert.equal(ruleLines(second), ruleLines(rules));
  assert.deepEqual(
    second.map((rule) => [rule.domain, rule.enabled]),
    rules.map((rule) => [rule.domain, rule.enabled])
  );
});

test('规则文本保留已有规则的 id 与 overrides', () => {
  const existing = normalizeConfig({
    masterEnabled: true,
    rules: [{
      id: 'keep-me',
      domain: 'claude.ai',
      enabled: true,
      overrides: { language: { mode: 'override', value: { language: 'ja-JP' } } }
    }]
  } as any).rules;

  const [rule] = rulesFromText('claude.ai', existing);
  assert.equal(rule.id, 'keep-me');
  assert.equal(rule.overrides.language.mode, 'override');
});

test('规则文本忽略空行、注释与重复域名', () => {
  const rules = rulesFromText('\n# 注释\nGOOGLE.com\n  google.com  \n\n!MAIL.Google.com\n', []);
  assert.deepEqual(
    rules.map((rule) => [rule.domain, rule.enabled]),
    [['google.com', true], ['mail.google.com', false]]
  );
});