# 设计入口

权威方案与后续清单见 [runtime-modularization-rfc.md](../../../docs/stabilization/runtime-modularization-rfc.md)。本任务只保留隔离测试 fixture 与 spike 构建工具，不改变生产入口。

选择构建期静态生成：Rollup 展平局部模块，banner/footer 将完整编译结果置于具名导出函数内部。运行期无 eval/new Function、远程 import、WAR 或页面配置桥。二次生产打包后仍需对最终函数做脱离闭包测试。Worker bootstrap 是独立序列化边界，不能直接依赖页面模块闭包，后续单独生成。

回滚只撤销本任务新增文件及四个既有治理文件的可识别增量；保留所有任务前改动。无数据迁移。临时生成文件/profile/server 退出时清理，正式 Chrome 证据保留。

## 后续安全暂停设计（已获实施授权）

最小拒绝路径直接留在 services.initializeRuntimeForSender：保留可信 sender 和目标元数据校验后无条件抛固定 RuntimeSyncOperationError，早于配置读取；移除 runtime import 与 executeScript，不留 UA/版本、URL、storage 或页面可开闸的分支。runtime 维护源不改、不迁移。对账仅注销固定 ID 并回读验证；注销失败不影响初始化拒绝。启用规则时以现有 contentScripts.errors 的固定 code 显示 partial/failed，DNR、WebRTC 保留实际组件状态，schema 与消息动作不扩展。注销成功后的原有刷新恢复仍可继续，但不承诺清除 BFCache 或旧 hook。

Popup/Options 的同步详情、设置概览、当前站点和保存提示明确暂停范围，配置开关不冒充生效。无启用规则时无待执行页面伪装，注销成功可报告 ok；后台闸门仍始终拒绝。没有运行期恢复开关。回退 UI 可保留服务闸门，不能直接回退到已证实不安全的旧派发路径；完整恢复需单独授权与证据。
