# VanishGeo 权限边界

> **VG-032（2026-10-22，人工验收通过，未发布）**：仅恢复 `declarativeNetRequestWithHostAccess`，先隔离并迁移历史规则，再以已核验的持久规则按站点同步 Accept-Language；旧文档仍需完整重载。当前状态与实际验证以任务记录为准。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；定位已于 VG-029（2026-10-22）获用户授权恢复，按独立注册状态报告；Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

以当前 [manifest.json](manifest.json) 为准：Chromium Manifest V3，最低 Chrome 138，没有静态 `content_scripts`，`web_accessible_resources` 为空。数据生命周期和外部请求见 [PRIVACY](PRIVACY.md)。

## 必需权限

| 权限 | 当前所有者与用途 |
|---|---|
| `storage` | 后台和管理页保存 schema v3 `siteSpoofConfig`、出口档案/位置历史/方案及迁移标记；local另存DNR命名空间所有权版本，不另存语言配置；session 暂存待确认出口检测，以及按配置摘要关联的运行时同步报告/刷新欠账（无配置副本或原始 URL）。诊断 run 不写 local/session |
| `scripting` | 注销旧 ISOLATED 初始化脚本；按启用allowlist注册包内固定名单字体脚本（MAIN/document_start/allFrames，无动态payload）；现有主动诊断定向采集实际值及文档/设备参考。生产页面语言/时区不使用 executeScript 或 documentId |
| `declarativeNetRequestWithHostAccess` | 仅按启用HTTP(S)站点语言同步Accept-Language；默认静态隔离先保护重授权窗口，历史1001、1002及1100..2099清理读回后才解除；新规则是跨会话持久的dynamic投影，不拦截或读取请求正文 |
| `userScripts` | 后台提前注册扩展固定模板与安全 JSON 最小语言/时区 payload，MAIN / document_start；用户须在详情页正常开启 Allow User Scripts。关闭开关、API 不支持或权限不可用时不注入且不回退 |
| `tabs` | 后台、Popup 和扩展菜单读取当前/全部标签页 URL、选择诊断目标、创建目标/报告，并在有效语言/时区 payload 或固定字体注册范围改变后记录人工重载提示（字体保守覆盖可能含受影响iframe的HTTP(S)标签页），不调用 tabs.reload。没有标签页历史上传流程 |
| `contextMenus` | 提供规则启停、诊断入口和 WebRTC 策略重置菜单 |
| `privacy` | 设置、清除及读取浏览器全局 `chrome.privacy.network.webRTCIPHandlingPolicy` 与 levelOfControl；该作用域不限于站点规则 |

`alarms` 已移除：出口位置只在用户主动检测或重新检测时请求外部 provider，没有后台定时刷新。诊断与候选的 TTL 不等于 alarms 刷新。

## DNR 恢复与升级边界

VG-024曾移除两项DNR权限，磁盘中可能仍保留更早的动态规则。VG-032经用户明确授权仅恢复 `declarativeNetRequestWithHostAccess`，复用已有host权限，不申请普通DNR、Feedback、webRequest或debugger权限。

包内默认启用最高优先级静态allow隔离规则，覆盖普通HTTP(S)全部当前资源类型（含main_frame）。后台在原配置队列清理dynamic/session中的1001、1002及1100..2099并读回。旧marker不作为成功依据。范围外规则保留；未知Accept-Language改写会保持隔离并报告冲突。固定规则文件损坏不属于可证明的隔离范围，须通过构建和真实Chrome加载验证。

页面注册确认后才安装并核验新dynamic投影，再解除隔离。用户已明确授权持久化以消除session清空造成的稳定冷启动首请求窗口；dynamic使用独立40000..49999，旧session30000..39999迁移撤销，dynamic30000和session40000仍不接管。local仅记录命名空间所有权版本，首次接管前必须确认新范围为空；未知占用保留并隔离。所有会改写配置的迁移、修复和变更均进入同一队列，影响投影或无法确认旧配置时先持久隔离再写；稳定冷启动不无条件重新隔离。静态enabled状态跨浏览器会话保留，扩展更新按manifest默认重置；不能用manifest默认推断每次worker唤醒时已经隔离。

导航请求按目标站点语言，子资源按发起域语言（含跨源资源）。只改Accept-Language，其他头保持原生，不经过转发服务器。两个API没有原子提交：同步窗口和旧文档/BFCache可能不一致，提示完整重载；Worker/SharedWorker的JavaScript语言仍原生。新投影安装依赖页面语言注册就绪，稳定冷启动沿用上次确认的投影；若用户在Chrome中关闭Allow User Scripts，后台核验前仍可能发送旧语言头，不能承诺这一开关过渡窗口的首请求一致。核验后撤销受管头、保持隔离并报告失败；DNR失败时同样隔离并报告partial，其他页面能力独立运行。

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
