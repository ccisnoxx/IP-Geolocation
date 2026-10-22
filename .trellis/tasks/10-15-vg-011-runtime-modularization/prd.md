# VG-011：运行时模块化设计与可行性验证

用户于 2026-10-15 明确授权本任务，阶段 R3，依赖 VG-010 done（manifest 与人工记录已核验）。旧 VG-011 迁移/导入导出是初始路线，本次校准同一记录；原验收缺口保留。

## 交付与验收

- RFC 比较保留单文件内部生成、构建期生成自包含函数、受控文件注入，覆盖 CSP/WAR/MAIN/documentId/构建/测试。
- 选择方案并给出目录、产物、注入 API、source map、测试、回滚和停止条件。
- 隔离最小 spike：多模块编译后的函数脱离扩展闭包执行；可能时真实 Chrome 最小 surface 注入。
- 给出 VG-012 文件级实施清单和等价性测试矩阵，仅作提案，不修改该任务或启动实现。
- 不全面迁移 timezone/geolocation/canvas/worker，不实施 compatibility mode。
- schema/storage/消息/manifest/DNR/权限/verified/隐私边界及生产行为保持；不加生产依赖，不提交或发布。
- 最低门禁：diff check、源码类型、npm test、build、Chrome dry-run；增加测试类型与定向 spike 检查。Node/VM/dry-run 与真实 Chrome 分开记录。
- 本地完成仅 review，人工验收 pending，不归档。

## 后续明确授权：documentId 安全暂停

用户在调查及方案后接受功能代价，授权后台在任何 payload 解析/派发前暂停所有未证明安全的 MAIN 页面伪装，并撤销初始化脚本。语言、时区、位置、Canvas、worker 暂停，DNR/WebRTC 按实际状态报告；不静默降级、不改 schema/权限/桥/匹配器。验收覆盖 BFCache、跨 origin、同 URL reload 的零生产派发和原生 API，后台重启/保存/同签名重试不可绕过，保留原生缺陷对照，独立安全复核后待人工验收。VG-011 保持 review，VG-012 不启动；可靠绑定/上游修复的功能恢复单独研究，不在本轮实施。已有 hook 和旧 BFCache 文档需重建，闸门不撤销旧代码。
