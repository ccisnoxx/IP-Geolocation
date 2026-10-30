import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCarveOutDomains,
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

test('三层结构：内容脚本靠 payload 兜底，但 carve-out 必须认出中间那一层', () => {
  // 三层结构 `a.com` / `!b.a.com` / `c.b.a.com`：
  //   - 内容脚本的 excludeMatches 只能表达"整棵子树都不注入"，表达不了
  //     "排除里再放行"，所以这张表**不做 rescue 就会连带挡掉孙域**；
  //   - DNR 和 contentSettings 都有"更具体的规则优先"，可以把中间层挖掉、
  //     让孙域用自己的规则覆盖回来 —— 三层语义因此可以一致。
  // 早先 DNR 直接复用内容脚本那张表，中间层就被父规则重新覆盖了。
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false },
    { domain: 'inbox.mail.google.com', enabled: true }
  ]);

  // 内容脚本：保留 rescue（否则孙域进不来），中间层由 payload 判定为 excluded
  assert.deepEqual(getExcludedRuleDomains(cfg), []);
  const { excludeMatches } = getContentScriptRegistration(cfg);
  assert.deepEqual(excludeMatches, []);
  assert.equal(getEffectiveProfile(cfg, 'mail.google.com', lastLocation).excluded, true);
  assert.ok(!getEffectiveProfile(cfg, 'inbox.mail.google.com', lastLocation).excluded, '孙域仍然生效');

  // carve-out：不做 rescue，中间层必须在表里（DNR / 权限层靠它）
  assert.deepEqual(getCarveOutDomains(cfg), ['mail.google.com']);
});

test('DNR 父规则挖掉被禁用的中间子域，孙域靠自己的规则重新生效', () => {
  const cfg = config([
    { domain: 'google.com', enabled: true },
    { domain: 'mail.google.com', enabled: false },
    { domain: 'inbox.mail.google.com', enabled: true }
  ]);

  const rules = buildAcceptLanguageRules(cfg);
  const byDomain = new Map(
    rules.map((rule) => [rule.condition!.requestDomains![0], rule])
  );

  const parent = byDomain.get('google.com');
  assert.ok(parent, '父域仍要有头规则');
  assert.deepEqual(
    parent!.condition!.excludedRequestDomains,
    ['mail.google.com'],
    '父规则必须挖掉被禁用的中间子域，否则页面原生、请求头却被改写'
  );

  const grandChild = byDomain.get('inbox.mail.google.com');
  assert.ok(grandChild, '孙域要有自己的规则');
  assert.equal(
    (grandChild!.priority ?? 0) > (parent!.priority ?? 0),
    true,
    '孙域优先级必须更高（priority = 域名长度），才能在父规则之后覆盖回来'
  );
});

test('启用但语言不生效的后代也要被父规则挖掉', () => {
  // 子域只关掉语言伪装：它自己不生成头规则，父规则会照着父域语言改写它 ——
  // 于是页面 navigator.language 是原生的，请求头却是伪装值。
  const cfg = normalizeConfig({
    masterEnabled: true,
    rules: [
      {
        id: 'parent',
        domain: 'google.com',
        enabled: true,
        overrides: {
          language: {
            mode: 'override',
            value: {
              enabled: true,
              mode: 'preset',
              language: 'ja-JP',
              languages: ['ja-JP', 'ja'],
              acceptLanguage: 'ja-JP,ja;q=0.9'
            }
          },
          timezone: { mode: 'inherit', value: null }
        }
      },
      {
        id: 'child',
        domain: 'mail.google.com',
        enabled: true,
        overrides: {
          language: { mode: 'disable', value: null },
          timezone: { mode: 'inherit', value: null }
        }
      }
    ]
  } as any);

  const rules = buildAcceptLanguageRules(cfg);
  assert.equal(rules.length, 1, '只有父域生成头规则');
  assert.deepEqual(rules[0].condition!.excludedRequestDomains, ['mail.google.com']);
});

test('carve-out 在 masterEnabled 关闭时为空', () => {
  const cfg = normalizeConfig({
    masterEnabled: false,
    rules: [
      { domain: 'google.com', enabled: true },
      { domain: 'mail.google.com', enabled: false }
    ]
  } as any);
  assert.deepEqual(getCarveOutDomains(cfg), []);
  assert.deepEqual(buildAcceptLanguageRules(cfg as any), []);
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