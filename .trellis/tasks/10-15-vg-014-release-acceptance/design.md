# VG-014 设计与 preflight

日期：2026-10-15；阶段 R4。当前分支 stabilize/VG-014，HEAD 5701b55。工作树包含前序整个稳定化波次；已在系统临时目录保存任务前 323 个文件副本及 SHA-256，不能以 HEAD diff 代表本任务增量。公开记录仅用仓库相对路径。

1. 依赖 VG-001～VG-013 在唯一 manifest 均为 done，并有人工确认引用。按本次明确请求校准 VG-014 的旧 R3 标题、阶段和依赖，不启动其他任务。
2. 当前生产后台保持 VG-011 安全暂停；旧 documentId 错投、earliest-inline FAIL 是已知证据，不能用 done 或后阶段 PASS 覆盖。
3. 目标为完整集成审查与候选报告，逐项给出 PASS/FAIL/UNKNOWN 和证据层级，最终 review、人工验收 pending。
4. 已见文档差异：RELEASE 仍称 runtime 进入后台；旧 Chrome runner 要求保存 ok 与页面伪装匹配，不适用于安全暂停候选。
5. 范围为文档、记录、必要验收脚本和确认的 P0/P1 集成回归；不新增产品功能、不恢复生产注入、不改版本、权限或依赖，不提交/push/tag/Release。
6. 计划修改稳定化三入口、新 release-readiness、Trellis 四文件/索引/证据、.gitignore 精确放行、RELEASE/README 和必要脚本。源码修复先记录具体复现与严重度。
7. schema v2、storage key、迁移、runtime messages、manifest、DNR 所有权和权限默认不变；构建六入口、共享 chunks、无远程代码/map、ZIP 根结构需实际检查。
8. 生产 MAIN/ISOLATED 安全闸门与隔离 runtime 行为分开；top/iframe、Worker/SharedWorker 和 strict/compatible 的测试不恢复生产调用。
9. 临时 Chrome profile、localhost、合成配置；provider 请求在发出前拦截；诊断既有 STUN 若执行需明确。无真实出口检测，无精确 IP/个人路径/位置/凭据的持久证据。
10. 验证幂等、service worker 重启、取消/导航/过期、配置保留和迁移；不声称未执行中断场景通过。
11. 基线 npm ci、npm test；稳定候选执行源码/测试类型、完整测试、build、dry-run、真实 Chrome 集成、安全闸门和隔离模式、dist/ZIP 静态审查。
12. 独立只读复核发布与隐私边界；每项真实证据绑定候选文件摘要。仅因实际修复或诊断新证据重跑相关检查。
13. 回滚仅恢复本任务增量；不得 reset 整个脏工作树或恢复安全暂停前的生产派发。已知功能失败阻断完整发布但不阻断完成报告。仅用户列明的依赖、合同/授权/安全冲突、无法区分的阻塞基线才将任务 blocked。

验收策略：生产候选验证安全暂停的正确性，同时报告页面伪装相对完整产品预期的失败；隔离最小扩展仅用于仍维护的 runtime 行为回归。对不可自动化或环境不可用项明确 UNKNOWN，不生成虚构 PASS。release-readiness 是发布建议与证据索引，task-manifest 仍是唯一跨任务状态来源。
