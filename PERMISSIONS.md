# VanishGeo 权限边界

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；定位已于 VG-029（2026-10-22）获用户授权恢复，按独立注册状态报告；Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

以当前 [manifest.json](manifest.json) 为准：Chromium Manifest V3，最低 Chrome 138，没有静态 `content_scripts`，`web_accessible_resources` 为空。数据生命周期和外部请求见 [PRIVACY](PRIVACY.md)。

## 必需权限

| 权限 | 当前所有者与用途 |
|---|---|
| `storage` | 后台和管理页保存 schema v3 `siteSpoofConfig`、出口档案/位置历史/方案及迁移标记；session 暂存待确认出口检测，以及按配置摘要关联的运行时同步报告/刷新欠账（无配置副本或原始 URL）。诊断 run 不写 local/session |
| `scripting` | 注销旧 ISOLATED 初始化脚本；按启用allowlist注册包内固定名单字体脚本（MAIN/document_start/allFrames，无动态payload）；现有主动诊断定向采集实际值及文档/设备参考。生产页面语言/时区不使用 executeScript 或 documentId |
| `userScripts` | 后台提前注册扩展固定模板与安全 JSON 最小语言/时区 payload，MAIN / document_start；用户须在详情页正常开启 Allow User Scripts。关闭开关、API 不支持或权限不可用时不注入且不回退 |
| `tabs` | 后台、Popup 和扩展菜单读取当前/全部标签页 URL、选择诊断目标、创建目标/报告，并在有效语言/时区 payload 或固定字体注册范围改变后记录人工重载提示（字体保守覆盖可能含受影响iframe的HTTP(S)标签页），不调用 tabs.reload。没有标签页历史上传流程 |
| `contextMenus` | 提供规则启停、诊断入口和 WebRTC 策略重置菜单 |
| `privacy` | 设置、清除及读取浏览器全局 `chrome.privacy.network.webRTCIPHandlingPolicy` 与 levelOfControl；该作用域不限于站点规则 |

`alarms` 已移除：出口位置只在用户主动检测或重新检测时请求外部 provider，没有后台定时刷新。诊断与候选的 TTL 不等于 alarms 刷新。

## 已移除的 DNR 权限与升级边界

VG-024 不再申请 DNR 权限：`declarativeNetRequest`、`declarativeNetRequestWithHostAccess` 均已从 manifest 删除，生产代码没有 DNR API 调用，也不提供 optional 权限或动态重新请求路径。过渡清理模块、同步组件及成功标记写入已删除。

VG-028 已人工验收并保留真实 Chrome 受管范围清理证据。从该前置升级不再需要继续清理。旧 v2 跳过该前置直接升级时，历史动态规则可能仍有磁盘残留；缺少权限时不会启用，本版本不宣称已读取或删除这些残留。以后重新引入 DNR 必须先设计独立清理迁移，不能直接重授权限而恢复旧规则。当前候选只做本地验证，不发布。

## Host 权限与文档边界

`host_permissions` 为 `<all_urls>`：用户可在运行时添加任意规则域名，扩展需要按规则提前注册语言/时区userScripts和包内固定字体脚本、现有诊断定向采样；后台主动出口检测也需要访问其 HTTPS provider。这是宽 host 授权，当前实现用 allowlist 和可信来源检查限定使用方式。

扩展不静态注册 `<all_urls>` content script。`page-scripts.ts` 从 config-model/resolver 的启用规则生成 HTTP(S) matches / excludeMatches，保持最长域名优先级。Chrome 直接在新文档执行 `MAIN` / `document_start` / `allFrames` 脚本；没有 content 初始化消息、页面配置桥、origin fallback 或 documentId 注入回退。about:blank、srcdoc、data、blob 与特殊 sandbox 文档保持 unsupported / UNKNOWN，运行时拒绝非 HTTP(S) 与 opaque origin。

代码仅由仓库固定构建模板及经过 validateConfig/resolver 的最小 payload 组合；值安全 JSON 序列化，不接受用户 JavaScript、不下载代码、不用 eval/new Function。payload 不含 publicIp、provider、完整规则/档案、未启用信号或暂停 surface。报告资源不对网页公开；管理消息仍校验扩展页面来源。

把 `<all_urls>` 改为逐站点申请的 optional host permissions 暂不处理：需要独立设计请求、拒绝、撤销、重新注册和失效处理。VG-004 只校准本说明，不修改权限或 host scope。

## 未申请与避免的权限

`activeTab` 不申请；当前 tabs 用于标签页读取、比较、人工重载提示和诊断入口，增加 activeTab 不会缩小现有 host 边界。

不会为了 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、font 或 WebGPU 等无证据设备伪装扩大权限。选择性字体暴露过滤维护源不表示授权新增这些伪装面。WebRTC 实际 policy/控制权与 ICE 证据分别验收，不能把期望设置当成功。


VG-025（2026-10-20）已获用户授权恢复固定内置名单字体过滤；仅启用的HTTP(S) allowlist生效，custom和Worker继续暂停；位置恢复见VG-029。注册成功只代表匹配新文档就绪，旧hook/BFCache须完整重建；恢复授权不等于人工验收通过。详见 [配置指南](CONFIG_GUIDE.md)。


VG-029复用已有userScripts权限与host scope，未增加geolocation或其他扩展权限。定位仅返回用户配置的合成坐标，不读取传感器，不更改Chrome站点授权。需要正常开启Allow User Scripts；权限/用户开关/注册读回故障均报告未确认，不能回退到页面消息或documentId注入。位置和语言/时区的注册及失败状态分别报告。
