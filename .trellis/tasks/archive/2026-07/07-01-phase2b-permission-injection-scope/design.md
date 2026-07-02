# Phase 2B 设计

## Summary

本阶段采用“保留安装时权限、收缩实际触达面”的方案。`host_permissions` 继续保留 `<all_urls>`，避免引入新的授权流程；实际收缩点落在三处：动态 content script `matches`、程序化 reinjection 目标、`web_accessible_resources` 暴露面。白名单解析和 `matches` 派生统一由共享 config helper 提供，background 和测试只消费这套结果。

## Architecture And Boundaries

### 1. Shared boundary derivation

- 在 `shared/config-profile.js` / `IPGeoConfig` 内增加边界派生 helper，而不是在 `background/services.js` 中重新拼装域名模式。
- 共享 helper 至少覆盖：
  - 当前启用规则的规范化域名列表
  - 每个域名对应的 content script `matches`
  - URL 是否命中启用白名单规则
- background 的 content script 注册和 reinjection 目标筛选都只依赖这些 helper。

### 2. Dynamic content script registration

- `registerSpoofContentScripts(config)` 改为消费共享 helper 派生的 `matches`。
- 当 `matches` 为空时，只执行注销，不继续注册空范围或 `<all_urls>` 范围的脚本。
- 两组注册脚本仍保持现有职责：
  - main-world spoof: `spoof/date-time.js`、`spoof/worker-hooks.js`、`spoof/apply.js`、`main_spoof.js`
  - isolated bridge: `shared/config-base.js`、`shared/config-profile.js`、`config.js`、`content.js`
- `runAt: "document_start"`、`allFrames: true`、`world: "MAIN"` 不变，避免收边界时顺手改变白名单页面生效时机。

### 3. Programmatic reinjection

- `injectScript(tabId, url)` 保持“background 直接算 payload，再投递到页面”的模式，但只对 `http/https` 且命中启用白名单规则的 URL 生效。
- 为了支持“规则刚启用时让已开页面立即生效”，程序化注入不能只发 payload；它还需要确保 main-world listener 已在目标页存在。
- 因此程序化路径会先注入 main-world spoof 文件，再发送 payload；自动注册路径仍使用 bridge content script 在导航时自行发 payload。
- `updateAllTabs()` 在一次配置变更中只读取一次 config / lastLocation，并只遍历白名单脚本化 tab。

### 4. Diagnostic chain

- 诊断页的 live probe 仍只要求目标页是 scriptable `http/https` 页面，不要求它命中白名单。
- 这样非白名单站点仍可作为“隔离未被破坏”的证据来源。
- `getDiagnosticState()` 的 `matched` / `rule` / `effective` 继续沿用 `getCurrentTabState()`；不要为诊断另做一套白名单判定。

### 5. Resource exposure

- `test.html` 通过 `chrome.runtime.getURL()` 作为扩展页打开，不需要对网页公开。
- `map.html`、`images/*.svg` 当前只在扩展页内部引用，也不需要留在 `web_accessible_resources`。
- 如果实现中发现确有网页侧引用，再按具体消费者恢复，不回到 `<all_urls>` 全公开。

## Contracts And Compatibility

- `IPGeoConfig` 保持现有公共出口；新增 helper 作为向后兼容扩展，不改已有函数签名。
- `background/message-router.js` 中的 action 名和响应顶层结构保持兼容。
- `popup.html`、`options.html`、`test.html` 路径和入口文件名不改。
- `manifest.json` 保留现有 `permissions` / `host_permissions`，只改运行边界相关字段。

## Testing Strategy

- 继续用 Node 内建 `node:test`。
- 新增/增强测试覆盖：
  - content script `matches` 派生
  - 启用/禁用规则对白名单 URL 判断的影响
  - `manifest.json` 的资源暴露面收缩
  - `background/services.js` 注册脚本不再出现 `<all_urls>`
- 手工 smoke 重点验证：
  - 白名单页面仍在加载时生效
  - 非白名单页面不接收 spoof
  - 诊断页对非白名单站点仍能读到原生 live 值

## Risk Notes

- 最大风险是“把自动注册范围缩小后，已打开白名单页失去即时生效能力”。程序化 reinjection 需要显式补上 main-world listener 注入，不能只沿用旧的 payload postMessage。
- 第二个风险是“为了收边界误把非白名单诊断也关掉”。诊断页必须继续允许对非白名单 scriptable 页面做 live probe。
