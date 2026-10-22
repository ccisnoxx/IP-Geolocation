# VG-030 字体故障恢复重载提示修复

用户于2026-10-22授权继续修复VG-029提交复核时确认的既有P2：字体注册成功→启动读取local/session失败清理字体namespace→故障窗口打开普通HTTP(S)文档→恢复注册，fontRuntime ready却reloadRequired=false。

依赖VG-025、VG-029均done。实施只改变字体注册变更前的恢复预写和补录语义；不改配置schema、权限、host scope、固定名单/测量策略、定位、语言/时区、WebRTC或暂停Worker。现有未提交的VG-026/027、右键菜单及用户文档保持。

验收：
- 未修改配置也按实际字体注册差异先预写pendingFontScopeChange；预写失败不撤销/新增注册。
- 读取失败的fail-closed清理不依赖storage可用；恢复后补录故障窗口普通HTTP(S)标签页，包括未匹配顶层含匹配iframe。
- 实际注册幂等时不重复预写；同步/查询/checkpoint失败不丢失跨worker重启的补录义务，不自动reload。
- 针对性Node测试和真实Chrome故障注入、重载前后字体对照；另用真实dist回归定位get/watch/权限、语言、时区和字体。
- 完整本地检查及独立只读复核；本地完成仅review，人工验收通过后才可done。不提交、push或发布。

## 2026-10-22 验收状态

用户已在本会话明确确认验收通过并要求收尾；manifest现为done，Trellis为completed，human_acceptance为accepted。验收覆盖本任务已执行的字体故障恢复、针对性测试及真实Chrome定位/语言/时区/字体回归，既有未验证边界保持。人工确认原文及证据见[执行记录](./implement.md#2026-10-22-人工验收确认)。保留其他未提交改动，不提交、push或发布。
