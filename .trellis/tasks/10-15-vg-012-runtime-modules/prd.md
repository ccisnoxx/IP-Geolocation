# VG-012：按批准 RFC 实施运行时模块化

日期：2026-10-15。R3，依赖 VG-011 人工 done。按本次明确授权校准旧出口事务计划，不实施后续任务。

## 目标与验收

按 `docs/stabilization/runtime-modularization-rfc.md` 的静态生成方案拆分 registry、payload、navigator、Intl/Date、geolocation/permissions、Canvas、worker 与唯一 apply 调度。保持行为、隐藏状态、安装顺序和两层序列化合同；所有模块可直接导入单测，不在 import 时探测或修改浏览器。

VG-011 已验收安全暂停继续有效：后台在配置读取和派发前拒绝，注销旧初始化脚本；本任务不恢复生产注入。schema/storage/迁移/message/manifest/权限/DNR/verified 不变。无新增依赖、伪装面、配置桥或外部请求。

构建强制两层单函数/单 chunk/无外部引用；source map 与 watch 可验证，生成失败中止。原有全测试、最终二次打包/worker 脱离闭包、真实 Chrome 定向旧新等价与安全暂停、earliest 三阶段分别保留证据。Node/VM/dry-run 不等于浏览器验收。实现及本地验证完成仅 review，completedAt=null，等待人工验收。

## 基线与回滚

分支 stabilize/VG-012，HEAD 5701b55 加现有未提交前序成果。只撤销本任务可归属改动，恢复任务前 runtime 后重建；不 reset HEAD，不改数据或历史。无可靠生产文档绑定恢复授权；保留 VG-009/VG-011 的正式 FAIL 证据。
