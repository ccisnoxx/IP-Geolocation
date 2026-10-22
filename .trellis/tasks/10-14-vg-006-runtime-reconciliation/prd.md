# VG-006：运行时副作用对账与可见同步状态

本次用户明确校准 VG-006 为 R2，依赖已人工验收的 VG-005（done）。manifest 是唯一状态来源；本地完成为 review，人工验收前 completedAt 为 null。

目标：siteSpoofConfig 是唯一 desired state。配置保存后的脚本、DNR、WebRTC、reload 失败必须在 API/UI 可见并可恢复；不回滚用户配置。返回按配置摘要绑定的四组件 ok/failed/partial 和固定可展示错误。保存前预检 DNR 容量，单 tab 错误不阻断其他 tab，后台再启动重试。已收敛重复执行只观测，不重复修改。

范围：后台事务/对账、消息、两处管理页状态、storage session metadata、失败恢复测试与必要合同文档。保持 schema v2、权威解析器、动态 allowlist、documentId MAIN、ISOLATED 通知、verified 身份、权限、host scope 与现有构建。

范围外：iframe/worker 匹配调整、设备指纹新增、alarm、配置业务语义、依赖升级、远端操作、发布及后续任务。旧 A06 iframe 缺口保留待分配。

验收：四组件失败与恢复、重复执行和并发、容量拒绝、UI partial；最低 diff/typecheck/test/build/Chrome dry-run，测试类型及独立只读复核。Node/mock/VM/dry-run 不等于真实 Chrome。
