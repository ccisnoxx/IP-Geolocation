# VG-001：保留已禁用站点规则并统一规则编辑语义

## 状态与授权

发布阶段 R1，分支 `stabilize/VG-001`，依赖 VG-000。状态以 [manifest](../../../docs/stabilization/task-manifest.yaml) 为准。

2026-10-14 初次检查：VG-000 在 manifest 和自己的 task.json 中均为 `review`，本任务因此记录为 `blocked`。同日用户明确确认 VG-000 人工验收通过，manifest 同步为 `done`、其 Trellis 为 `completed`；依赖阻塞解除，本任务使用 task.py start 进入 `in_progress`。范围内实现、本地验证与独立复核完成后停在 `review`；用户随后确认 Options 和 Popup 已按给定步骤通过真实 Chrome 人工验收，manifest 同步为 `done`、Trellis 为 `completed`。验收证据见 implement.md 的“人工验收”。

用户本次明确指定的标题、R1 阶段和规则编辑范围替代 manifest 中 VG-001 原有的宽泛配置持久化范围；不因此开展并发写入、失败恢复或迁移改造。验收矩阵 A01 区分本任务的规则保存合同与尚未分配的新范围，不能把广泛配置场景视作本次授权。

## 目标与当前证据

Popup 和 Options 的文本框仅显示 enabled 规则，两处 rulesFromText 只重建文本中的规则，导致不显示的 disabled 规则在无关保存时丢失。

Node 复现提取并执行两处现有函数：合成配置包含 `enabled.example` 和 disabled 的 `disabled.example`，文本保持 `enabled.example`；两处结果均从 2 条变为 1 条。此证据只证明函数边界，不代表真实 Chrome 保存验收。

## 必须交付（依赖解除后）

- 提取共享文本解析/合并纯函数，Popup 与 Options 使用同一实现。
- 文本继续表示当前启用规则域名集合；未显示的禁用规则保留。
- 禁用域名重新写入文本时，复用原 ID、overrides、出口档案绑定并启用。
- 从文本移除启用域名时删除该启用规则，保留其他禁用规则。
- 保存语言、时区、画布、坐标等设置时，不意外改变规则数组。
- 覆盖重复域名、空行、大小写、URL、禁用规则重新启用及无关保存。

## 验收

- [x] 禁用规则在非规则设置保存后仍存在且保持 disabled。
- [x] 重新启用保留规则 ID、overrides 和出口档案绑定。
- [x] 移除启用域名只删除该启用规则。
- [x] 相同启用文本的无关保存保持完整规则数组及顺序。
- [x] 两处 UI 使用同一实现，必要的行为和 wiring 测试通过。
- [x] git diff --check、npm run typecheck、npm test、npm run build 有有效实际证据。
- [x] 本地交付时同步 manifest/task.json 为 review，completedAt 保持 null。
- [x] 用户确认真实 Chrome 人工验收通过后，manifest 为 done、task.json 为 completed，completedAt 为 2026-10-14。

## 范围外与停止条件

不重做规则 UI，不改变匹配算法、默认规则、DNR、storage key、权限、verified 边界、注入架构或设备指纹面，不添加生产依赖，不实施后续任务，不提交或操作远端。

仅在依赖未完成、不可消解合同冲突、未批准破坏性迁移/历史重写/权限扩大/外部服务授权、安全隐私边界必须改变，或不可区分的阻塞性基线失败时标记 blocked。初始依赖阻塞已由用户验收解除。
