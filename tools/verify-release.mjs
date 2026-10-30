#!/usr/bin/env node
/*
 * 验证一个已发布的 zip 真的没有首屏窗口。
 *
 *   node tools/verify-release.mjs --zip=release/vanishgeo-1.2.1-us-west.zip
 *   node tools/verify-release.mjs --dir=release/.build/uscheck
 *
 * 为什么必须真开浏览器：release.mjs 只能证明"产物里写着目标时区"，证明不了
 * "页面的第一个内联脚本就已经看到它"。这两件事在开发构建里恰好会分叉 ——
 * 配置经异步 IPC 进页面，第一个内联脚本可能先跑，于是读到原生值。那个窗口
 * 没法在运行时关掉，只能靠构建期烘焙；所以这里量的是**页面实际读到的值**。
 *
 * 做法：用包自己的 baked-language.json 取一个域名，把它映射到本地 https 服务器，
 * 页面在 document_start 用内联脚本抓一份快照，再看快照里的时区/语言/偏移。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evaluate, killChrome, launchChrome, sleep } from './lib/cdp.mjs';
import { ensureCerts } from './lib/certs.mjs';
import { resolveExpectations, ruleDomains } from './lib/release-expectations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>bake check</title>
<script>
// document_start 的第一段脚本：这一刻读到的应该是目标值，不是原生值。
(function () {
  var jan = new Date(2026, 0, 1, 0, 0, 0);
  window.__first = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    numberLocale: (function () {
      try { return new Intl.NumberFormat().resolvedOptions().locale; } catch (error) { return 'ERR:' + error.message; }
    })(),
    lang: navigator.language,
    langs: Array.prototype.slice.call(navigator.languages || []),
    langFrozen: Object.isFrozen(navigator.languages),
    offset: new Date().getTimezoneOffset(),
    janOffset: jan.getTimezoneOffset(),
    dateStr: jan.toString(),
    at: Date.now()
  };
})();
</script></head><body><h1>first paint</h1></body></html>`;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------- 取包 ----------

let bundleDir = null;
let workDir = null;
let summary = null;

if (argv.dir) {
  bundleDir = resolve(ROOT, String(argv.dir));
  if (!existsSync(join(bundleDir, 'manifest.json'))) fail(`不是扩展目录：${bundleDir}`);
} else if (argv.zip) {
  const zipPath = resolve(ROOT, String(argv.zip));
  if (!existsSync(zipPath)) fail(`找不到：${zipPath}`);
  workDir = mkdtempSync(join(tmpdir(), 'vanishgeo-verify-'));
  execFileSync('unzip', ['-q', zipPath, '-d', workDir], { stdio: 'inherit' });
  bundleDir = workDir;
  const summaryPath = zipPath.replace(/\.zip$/, '.json');
  if (existsSync(summaryPath)) summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} else {
  fail('需要 --zip=<file> 或 --dir=<扩展目录>');
}

const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
const rulesPath = join(bundleDir, 'rules', 'baked-language.json');
const rules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : [];
const firstDomain = summary?.domains?.[0] || rules[0]?.condition?.requestDomains?.[0];
if (!firstDomain) fail('包里没有启用域名，无法验证');

// ---------- 期望值 ----------
//
// 期望值有两个来源：发布时记下的清单（--zip 旁边的同名 JSON），和**包本身**。
// 后者是必须支持的 —— 发布附件里往往只有 zip，用户拿到的就是 zip。旧版本在这里
// 写 `first.tz !== 本机时区 || true`：拿不到清单时断言恒真，于是"通过"不代表
// 任何事。现在改成"从包里推断，推不出来就判失败"（fail-closed）。

/** 注入层的烘焙配置就在 content_scripts 的 js 里：`{ config: { ... } }` 字面量 */
const injectedSource = (() => {
  let source = '';
  for (const entry of manifest.content_scripts || []) {
    for (const file of entry.js || []) {
      const path = join(bundleDir, file);
      if (existsSync(path)) source += readFileSync(path, 'utf8');
    }
  }
  return source;
})();

const { expectTz, expectLocale, bakedLocale, headerLocale, bakedLanguages, headerValue } = resolveExpectations({
  summary,
  source: injectedSource,
  rules
});

// 主文档真实发出去的 Accept-Language。静态规则改的是网络层，只有服务端收到的那一行
// 才能证明"页面要的值"和"线上请求"不是两套；页面内 probe 读到的 navigator.language
// 只说明注入层改过了。
let documentAcceptLanguage = null;
const certs = ensureCerts([firstDomain]);
const server = createServer({ key: readFileSync(certs.key), cert: readFileSync(certs.cert) }, (req, res) => {
  if (documentAcceptLanguage === null && req.url === '/') {
    documentAcceptLanguage = String(req.headers['accept-language'] || '');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-verify-')),
  headless: true,
  args: ['--ignore-certificate-errors', `--host-resolver-rules=MAP ${firstDomain} 127.0.0.1:${port}`]
});
// 失败路径（fail → process.exit）也要收尾：批量跑六个包时，漏一个 Chrome
// 就会把后面的包拖到超时。
process.on('exit', () => {
  try { killChrome(chrome); } catch { /* 已经退了 */ }
  try { server.close(); } catch { /* 已经关了 */ }
  if (workDir) { try { rmSync(workDir, { recursive: true, force: true }); } catch { /* 先留着 */ } }
});

const cdp = await CDP.connect(chrome.websocketUrl);
await cdp.send('Extensions.loadUnpacked', { path: bundleDir });
await sleep(2600);

const page = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);

// 扩展刚装好时动态规则可能还在落地，在途导航会被 ERR_ABORTED（Chromium 的老毛病）。
// 等一小会儿再开页，并且最多重试两次。
await sleep(1200);
let raw = null;
for (let attempt = 1; attempt <= 3 && (!raw || raw === 'null'); attempt += 1) {
  await cdp.send('Page.navigate', { url: `https://${firstDomain}/` }, sessionId);
  await sleep(2200);
  raw = await evaluate(cdp, sessionId, 'JSON.stringify(window.__first || null)').catch(() => null);
  if (!raw || raw === 'null') {
    const state = await evaluate(cdp, sessionId, 'JSON.stringify({ href: location.href, ready: document.readyState })').catch(() => '"?"');
    if (attempt < 3) console.log(`  第 ${attempt} 次没读到快照（${state}），重试`);
  }
}
if (!raw || raw === 'null') fail(`页面没跑起来（${firstDomain} 加载失败）`);
const first = JSON.parse(raw);

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

console.log(`\n包：${argv.zip || bundleDir}`);
console.log(`版本：${manifest.version} · 验的域名：${firstDomain}`);
console.log(`期望：tz=${expectTz ?? '(推断不出)'} locale=${expectLocale ?? '(推断不出)'}`);
console.log(`首屏读到：tz=${first.tz} locale=${first.locale} lang=${first.lang} offset=${first.offset} jan=${first.janOffset} ${first.dateStr}`);
console.log('');

if (expectTz) {
  record('首屏时区就是烘焙值', first.tz === expectTz, `${first.tz} vs ${expectTz}`);
  // 偏移必须跟着目标时区走，而不是原生时区：这才是 Date 层真的被补过的证据
  const expectedOffset = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: expectTz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(2026, 0, 1));
      const name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
      const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (!match) return null;
      const sign = match[1] === '-' ? -1 : 1;
      return -sign * (Number(match[2]) * 60 + Number(match[3] || 0));
    } catch {
      return null;
    }
  })();
  if (expectedOffset !== null) {
    record('Date 层跟着目标时区（1 月 1 日的偏移）', first.janOffset === expectedOffset, `${first.janOffset} vs ${expectedOffset}`);
  }
  record('Date.toString 带目标时区', /GMT[+-]/.test(first.dateStr), first.dateStr.slice(-12));
} else {
  // 推断不出去就判失败：这条路径以前是 `|| true`，等于把"验证通过"变成一句话而已。
  record('首屏时区就是烘焙值', false, '清单和包内烘焙字面量里都取不到目标时区');
}

if (expectLocale) {
  record('首屏语言就是烘焙值', first.lang === expectLocale, `${first.lang} vs ${expectLocale}`);
  // `navigator.language` 只是首选语言。页面还会读完整 FrozenArray，而"首选一致、
  // 后续项不同"（en-US + ["en-US","fr"] vs ["en-US","en"]）正是 patch-needs 里
  // 踩过的坑，验收必须整串比。
  if (bakedLanguages) {
    record(
      '首屏 navigator.languages 就是烘焙列表',
      Array.isArray(first.langs) && first.langs.join(',') === bakedLanguages.join(','),
      `${(first.langs || []).join(',')} vs ${bakedLanguages.join(',')}`
    );
    record('navigator.languages 仍是冻结数组', first.langFrozen === true, String(first.langFrozen));
  } else {
    record('首屏 navigator.languages 就是烘焙列表', false, '包内取不到 languages 列表');
  }
  // Intl 默认 locale 和 navigator.language 走的是两条不同的代码路径（一个是
  // Intl.DateTimeFormat 的默认值，一个是 Navigator 原型 getter），必须分别断言。
  record('Intl.DateTimeFormat 默认 locale 就是烘焙值', first.locale === expectLocale, `${first.locale} vs ${expectLocale}`);
  record('Intl.NumberFormat 默认 locale 就是烘焙值', first.numberLocale === expectLocale, `${first.numberLocale} vs ${expectLocale}`);
} else {
  record('首屏语言就是烘焙值', false, '清单、烘焙字面量、Accept-Language 里都取不到目标 locale');
}

// 跨层一致性：请求头改的语言和注入层烘焙的 locale 必须是同一个值，
// 否则「站内 JS 说 ja-JP、请求头说别的」本身就是一处可被比对的破绽。
if (bakedLocale && headerLocale) {
  record('Accept-Language 与注入层 locale 一致', bakedLocale === headerLocale, `${headerLocale} vs ${bakedLocale}`);
}

// 静态规则 → 线上请求：主文档实际发出的整串头（含 q 权重）必须等于规则里写的值。
if (headerValue) {
  record(
    '主文档 Accept-Language 就是静态规则值',
    documentAcceptLanguage === headerValue,
    `${documentAcceptLanguage || '(没收到)'} vs ${headerValue}`
  );
} else {
  record('主文档 Accept-Language 就是静态规则值', false, '包内没有 Accept-Language 静态规则');
}

// 静态规则内容本身：域名必须落在包内启用域名里，规则条数为正，否则"规则存在"
// 只是一句空话（早先只比较首段，连规则是否覆盖首个域名都没看）。

const ruleDomainList = ruleDomains(rules);
// "包内域名"有两个来源：发布清单（意图）和 manifest 的 content_scripts（实际注入范围）。
// 不能拿规则自己算 —— 那样恒真。
const summaryDomains = Array.isArray(summary?.domains) ? summary.domains.map((domain) => String(domain).toLowerCase()) : [];
const matchText = (manifest.content_scripts || [])
  .flatMap((entry) => entry.matches || [])
  .join(' ')
  .toLowerCase();
const coveredByBundle = (domain) => (summaryDomains.length
  ? summaryDomains.includes(domain)
  : matchText.includes(domain));
if (ruleDomainList.length) {
  const unknown = ruleDomainList.filter((domain) => !coveredByBundle(domain));
  record('静态规则只覆盖包内域名', unknown.length === 0, unknown.length ? `多出 ${unknown.join(',')}` : `${ruleDomainList.length} 个域名`);
  record('静态规则覆盖首个验证域名', ruleDomainList.includes(String(firstDomain).toLowerCase()), firstDomain);
  record('静态规则逐条都改写 Accept-Language', rules.every((rule) => (rule.action?.requestHeaders || []).some((header) => String(header.header).toLowerCase() === 'accept-language')), `${rules.length} 条`);
} else {
  record('静态规则只覆盖包内域名', false, '包内没有 requestDomains');
}

// 清单里声明的 ruleset 必须真的在包内且 enabled（否则静态规则等于没装）
const declaredRulesets = (manifest.declarative_net_request?.rule_resources || []).filter((item) => item.enabled !== false);
if (declaredRulesets.length) {
  record(
    'manifest 声明的静态 ruleset 都在包内',
    declaredRulesets.every((item) => existsSync(join(bundleDir, item.path || ''))),
    declaredRulesets.map((item) => item.path).join(',')
  );
} else {
  record('manifest 声明的静态 ruleset 都在包内', false, 'manifest 里没有 declarative_net_request 规则集');
}

const failed = checks.filter((item) => !item.ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} 通过`);

await killChrome(chrome);
server.close();
if (workDir) rmSync(workDir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);