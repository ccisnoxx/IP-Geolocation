# VanishGeo 权限边界

> **VG-011 安全暂停（2026-10-15 用户确认人工验收通过）**：Chrome 155 已证实旧 `documentId` 可错投替换文档。当前后台在读取 payload 和派发前拒绝所有页面伪装初始化，并撤销动态初始化脚本。语言、时区、位置、Canvas 及 Worker/SharedWorker 伪装暂停；配置仍可保存。DNR 请求头规则、WebRTC 继续各自执行并按实际同步结果报告；二者不补偿页面 API 伪装。重试同步、保存或后台重启不会恢复页面伪装。新闸门不撤销旧 hook，已加载页面及旧 BFCache 文档需关闭并重建；无法确认清理时需自行重启浏览器。恢复完整功能前须验证可靠最终文档绑定或浏览器上游修复。详情见 [调查与实施证据](docs/stabilization/document-id-investigation.md)。

以当前 [manifest.json](manifest.json) 为准：Chromium Manifest V3，最低 Chrome 119，没有静态 `content_scripts`，`web_accessible_resources` 为空。数据生命周期和外部请求见 [PRIVACY](PRIVACY.md)。

## 必需权限

| 权限 | 当前所有者与用途 |
|---|---|
| `storage` | 后台和管理页保存 schema v2 `siteSpoofConfig`、出口档案/位置历史/方案及迁移标记；session 暂存待确认出口检测，以及按配置摘要关联的运行时同步报告/刷新欠账（无配置副本或原始 URL）。诊断 run 不写 local/session |
| `scripting` | 当前后台注销旧 ISOLATED 初始化脚本，拒绝页面伪装派发；权限保留供现有主动诊断定向采集实际值及文档/设备参考。恢复伪装须另行验证文档绑定 |
| `tabs` | 后台、Popup 和扩展菜单读取当前/全部标签页 URL、选择诊断目标、创建目标/报告，并在有效 runtime payload 改变后尝试刷新受影响标签页。没有标签页历史上传流程 |
| `contextMenus` | 提供规则启停、诊断入口和 WebRTC 策略重置菜单 |
| `privacy` | 设置、清除及读取浏览器全局 `chrome.privacy.network.webRTCIPHandlingPolicy` 与 levelOfControl；该作用域不限于站点规则 |
| `declarativeNetRequest` | 后台管理动态 Accept-Language 请求头规则，从同一配置解析有效语言 |
| `declarativeNetRequestWithHostAccess` | 在 host 权限覆盖的匹配 HTTP(S) 站点修改请求头；不提供网络代理或请求体上传 |

`alarms` 已移除：出口位置只在用户主动检测或重新检测时请求外部 provider，没有后台定时刷新。诊断与候选的 TTL 不等于 alarms 刷新。

## Host 权限与文档边界

`host_permissions` 为 `<all_urls>`：用户可在运行时添加任意规则域名，扩展需要动态脚本注册、定向注入和 DNR 请求头处理；后台主动出口检测也需要访问其 HTTPS provider。这是宽 host 授权，当前实现用 allowlist 和可信来源检查限定使用方式。

扩展不静态注册 `<all_urls>` content script。恢复前的动态 matches 只允许来自 config-resolver 已启用规则，ISOLATED content 只能通知初始化；当前固定初始化脚本只注销，top frame/iframe 通知在可信 sender 校验后均拒绝。`allFrames` 和 origin fallback 不授权任何旁路。普通页面不能提交可信配置或调用仅报告文档可用的诊断动作。

报告 HTML/JS/CSS 不对网页公开。Worker/SharedWorker 仅沿用已有 runtime 包装；不申请 service worker hook 或新的设备伪装权限。

把 `<all_urls>` 改为逐站点申请的 optional host permissions 暂不处理：需要独立设计请求、拒绝、撤销、重新注册和 DNR 恢复。VG-004 只校准本说明，不修改权限或 host scope。

## 未申请与避免的权限

`activeTab` 不申请；当前 tabs 用于标签页读取、比较、刷新和诊断入口，增加 activeTab 不会缩小现有 host 边界。

不会为了 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、font 或 WebGPU 等无证据设备伪装扩大权限。现有 Canvas 字体功能不表示授权新增这些伪装面。WebRTC 实际 policy/控制权与 ICE 证据分别验收，不能把期望设置当成功。
