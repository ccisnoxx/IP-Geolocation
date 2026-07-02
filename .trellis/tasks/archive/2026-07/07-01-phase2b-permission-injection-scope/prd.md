# Phase 2B 权限与注入边界收缩

## Goal

在 Phase 2A 已完成模块边界拆分的前提下，收缩扩展的实际运行边界：只让白名单站点注册和接收页面级 spoof 脚本，只让白名单站点参与运行时 reinjection，同时缩小不必要的 `web_accessible_resources` 暴露面；整个过程中不能破坏白名单行为、非白名单隔离和现有诊断链路。

## Confirmed Facts

- `manifest.json` 仍保留 `host_permissions: ["<all_urls>"]`，`permissions` 包含 `scripting`、`tabs`、`privacy`、`declarativeNetRequest`。
- `background/services.js` 当前通过 `chrome.scripting.registerContentScripts()` 注册两组动态 content scripts，但 `matches` 已由 `IPGeoConfig.getContentScriptMatches(config)` 派生，而不再硬编码为 `<all_urls>`。
- `content.js` 仍在运行时根据白名单判断是否 `postMessage` payload，但在当前实现里其前置注入范围已经由动态 `matches` 收缩，不再是全部站点。
- `background/services.js` 的 `updateAllTabs()` / `injectScript()` 已结合 `diagnostic.isScriptableTabUrl(tab.url)` 与 `IPGeoConfig.isUrlMatchedByEnabledRule(config, tab.url)` 过滤目标，而不是对全部网页发 payload。
- `shared/diagnostic.js` 和 `pages/test-page.js` 已形成诊断链路：popup 保存目标 tab，诊断页读取解析后的有效配置，再用 `chrome.scripting.executeScript()` 到目标页面 main world 读取 live 值。
- 诊断页当前不仅要验证白名单生效，也要验证“未命中白名单时保持浏览器原生值”，因此非白名单站点的 live probe 不能被一并禁用。
- `manifest.json` 当前 `web_accessible_resources` 已为空，扩展内部资源不再对网页公开。
- Phase 2A 的模块化重构已落到当前工作区：`background.js`、`config.js`、`popup.js`、`options.js`、`test.js` 已变成装配层，`shared/`、`background/`、`pages/`、`spoof/` 已成为可复用边界。
- 当前已有 Node 测试基线：`npm test` 覆盖 config、diagnostic、runtime、extension wiring；最近一次本地运行通过。
- 你已确认本阶段采用“运行边界优先”，不在 Phase 2B 引入 `optional_host_permissions`、`activeTab` 或新的安装时授权交互。

## Requirements

- R1: Phase 2B 必须建立在 Phase 2A 的模块边界之上，不回退到旧的大文件结构中实现第二套域名/边界逻辑。
- R2: 安装时权限模型保持不变；`host_permissions` 不从 `<all_urls>` 切到 `optional_host_permissions`，也不引入 `activeTab` 驱动的新交互。
- R3: 动态 content scripts 的 `matches` 必须从 `<all_urls>` 收缩为“当前已启用白名单规则”的精确模式集合。
- R4: 当总开关关闭或没有启用规则时，不应继续保留页面级 spoof content scripts 注册。
- R5: `tabs.onUpdated`、`updateAllTabs()` 和任何程序化 reinjection 只应触达白名单且 `http/https` 的目标页面。
- R6: 不能把白名单匹配、content script `matches` 派生和 reinjection 目标筛选分散成多套近似逻辑；必须有一个共享的 authoritative helper。
- R7: 白名单站点仍必须保持 `document_start` 级别的页面 spoof 行为，不能因为边界收缩而降级成仅 popup 点击后才生效。
- R8: 非白名单站点必须继续保持页面级隔离，不注册页面级 spoof，不参与 reinjection，不因诊断工具而收到 spoof payload。
- R9: 诊断链路必须保持可用：popup 仍可打开诊断页，诊断页仍可读取白名单和非白名单站点的 live page 值，并能区分“未命中白名单”和“命中但配置错误/未生效”。
- R10: `web_accessible_resources` 只保留真实需要对网页公开的资源；仅扩展内部导航/资源引用使用的文件应移出暴露清单。
- R11: 本阶段不新增用户配置字段、不改变 `siteSpoofConfig` 语义、不改变 runtime message action 名或响应结构。
- R12: 本阶段不处理更深入的权限最小化议题，例如 `tabs` / `privacy` / `declarativeNetRequest` 的进一步拆分，或站点级按需授权 UX。

## Acceptance Criteria

- [x] 动态 content script 注册不再使用 `<all_urls>`，而是由当前启用白名单规则派生出的精确 `matches` 列表。
- [x] 总开关关闭或没有启用规则时，页面级 spoof content scripts 会被注销，而不是继续全站待命。
- [x] 运行时 reinjection 不再遍历后尝试全部网页；只有白名单 `http/https` tab 会成为注入目标。
- [x] 白名单命中逻辑、`matches` 派生和 reinjection 目标判断复用同一套共享 helper，没有新增第二套域名判定实现。
- [x] 白名单站点的现有 spoof 行为保持兼容，非白名单站点仍保持原生值，不因 Phase 2B 引入误注入。
- [x] 诊断页仍能对白名单站点看到生效值，也能对非白名单站点看到原生 live 值并显示 `matched=false`。
- [x] `manifest.json` 的 `web_accessible_resources` 暴露面已收缩到真实必需范围，不再公开只供扩展内部页面使用的资源。
- [x] 现有 Node 测试继续通过，并新增覆盖边界派生/manifest/wiring 收缩的针对性断言。

## First-Round Conclusion

本阶段定义的“运行边界优先的权限与注入边界收缩”目标已经完成：

- 动态 content scripts 已由启用白名单规则精确派生 `matches`
- 总开关关闭或无规则时不会继续保留全站待命的页面级 spoof 注册
- reinjection 已只触达白名单 `http/https` 目标
- 诊断链路仍能同时服务白名单与非白名单验证
- 扩展内部资源不再通过 `web_accessible_resources` 向网页暴露

因此，`Phase 2B` 可以按“运行边界已收缩且兼容性保持”收口。

## Out Of Scope

- 把安装时权限从 `<all_urls>` 改成 `optional_host_permissions` / `activeTab` 工作流。
- 新增 popup/options 交互、授权弹窗或新的权限请求 UX。
- 更改白名单配置结构、规则语义、导入导出格式或 runtime message 契约。
- 处理页面级 spoof 的“关闭后即时撤销”问题；该能力目前没有现成 uninstall 机制，不在本阶段扩展。

## Open Questions

None currently blocking.
