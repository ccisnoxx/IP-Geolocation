# VG-033 Blob Worker 语言时区同步

2026-10-23 用户明确选择仅先修复页面创建的 Blob Worker，并用当前 Chrome 验证美西配置。前置 VG-023、VG-032 均 done。

复用每文档最小 payload 与页面 navigator/Intl/Date 实现，不硬编码语言和时区。支持本 realm 安装后创建的 Dedicated Blob classic/module Worker；不恢复历史 HTTP(S)/SharedWorker/嵌套包装器，不新增权限或设备表面。

验收覆盖业务首段及模块依赖、原 URL 立即撤销、消息、错误、terminate、选项 getter 和禁用/未匹配行为。使用当前 Chrome 的现有站点配置；不保存原始 IP、位置、凭据、完整配置或个人路径。正式记录只保留合成场景、语言时区值及结论。
