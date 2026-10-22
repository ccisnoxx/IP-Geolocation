# 实施与验收记录

## 当前范围

2026-10-16 用户授权仅修复 userScripts document_start 实验启动并运行真实 fixture。未修改生产源码、正式 manifest、依赖或构建输入；保留开工前所有修改。不恢复任何生产页面 surface，不提交、push、tag 或发布。

## 已实施

- 原 macOS Seatbelt 后端和历史 BLOCKED 记录保留，新增显式 --linux-vm 后端，不做自动回退。
- 本任务独占 Debian13 ARM64 Lima/VZ VM，不挂载宿主文件系统、不使用容器运行时；准备阶段安装官方 Chrome155.0.8059.84 和 Node24.16.0。
- VM root 协调器建立全新仅 lo 的网络命名空间，IPv4/IPv6 prohibit default；collector/Chrome 降权为普通用户。fixture 及 CDP 都在同一 namespace 内走 loopback。
- Chrome 自身 sandbox 从 chrome://sandbox 实际读取；Chrome155 使用 Layer 1 Sandbox=Namespace，PID/Network namespaces 与 seccomp 均 Yes。
- 临时扩展 Allow User Scripts 初始关闭/API 不可用；正常扩展详情页可见开关通过可信鼠标输入开启，再验证 UI 和 API。不修改 prefs、不使用放行 flags 或私有设置 API。
- 仍只测固定 A/B navigator.language，不导入生产 runtime；原16场景/三阶段及独立文档比较保持。
- 新增 namespace/profile/进程组/staging 清理及 SIGTERM 测试；保留真实失败与 UNKNOWN。

## 已执行验证

| 检查 | 实际结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm run typecheck:tests | 通过 |
| npm test | 174/174 通过；Node/VM/mock，不是 Chrome |
| npm run build | 通过；生产输入未变 |
| npm run test:e2e:chrome -- --dry-run | exit0；只检查构建/清单，未执行真实生产验收 |
| node --test experiments/userscripts-document-start/*.test.mjs | 最终宿主19通过、4个环境特定测试skip；下面单独实际执行全部4项 |
| VM 内 sudo node --test linux-netns.test.mjs | 三项实际Linux测试通过：正常降权/网络/清理；初始化await取消；SIGTERM及派生进程清理 |
| 移除中断检查的临时副本反证 | 初始化取消回归测试因collector被错误创建而按预期失败；当前维护版本通过。临时副本已清理 |
| VG_US_TEST_LINUX_VM=1 node --test lima-backend.test.mjs | 宿主runner在真实Chrome已启动后收到SIGTERM；退出2/BLOCKED，跨VM的Chrome、namespace、profile、staging均回收到0 |
| Linux真实 Chrome最终fixture | Chrome155.0.8059.84 Linux ARM64；全部25个必需项PASS，API/A–F16场景与所有earliest/load/postLoad通过；GO/0 |
| git diff --check | 通过；新文件另做whitespace检查 |

源代码/生产检查在实验JS后续调整时输入不变，复用这些成功结果。最终报告 experiments/userscripts-document-start/linux-evidence.json 已在本轮清理修复后重新生成并由同一acceptance.mjs重算GO；cleanup.status/coordinator/staging均PASS，failures=[]。top与iframe本次均实际命中BFCache。宿主原仓库380文件changedCount=0，暂停闸门PASS。随后实际检查VM内Chrome、namespace、profile、staging均为0。

## 独立复核

使用 fresh critical_reviewer，只读检查新网络/Chrome sandbox边界、正常UI开关、GO判定与清理。审计bundle：20261016T124509Z-userscripts-linux-isolation-review-dc8328ab，finalize/verify均通过，SUBAGENT_EXECUTION_DIGEST已生成。

确认的两项P2均由主代理修复并定向验证：

1. 初始化await中收到SIGTERM仍可能启动collector：每个资源初始化await返回后及spawn前检查interrupted；新增故障注入的启动期取消测试，且临时旧行为副本按预期失败。
2. Linux GO未要求新两层清理字段，旧JSON早于清理实现：Linux验收强制coordinator/staging为PASS，缺失或UNKNOWN/失败均不通过；补门禁测试，并重新生成最终真实Chrome JSON。

审查者没有重跑测试；主代理实际执行结果按上表记录。修复后未二次派发独立复核；原覆盖缺口中的VM传输取消和真实Chrome进程回收由新增宿主SIGTERM测试及最终运行后资源检查直接覆盖。

## 清理与状态

本次临时脚本、输出摘要、startup中间JSON及VM测试staging已清理；保留原三份历史BLOCKED证据与最终GO JSON。实验Chrome/fixture/连接、namespace、profile和运行staging均已释放。独占VM停止，保留Debian/Chrome/Node可复用安装供人工复验；没有运行中的端口转发或VM。生产dist仅为本轮必要build的常规忽略输出。

Trellis状态为review，completedAt=null。没有人工验收记录，没有标为done或归档。

## 人工验收（首次交付时）

首次交付时待用户人工验收，自动GO没有提升为done。2026-10-16用户确认已补录如下。

## 2026-10-16 人工验收确认

用户在当前对话明确确认：“userScripts document_start 实验已通过我的人工验收，请同步验收记录并标记 done”。对应最终证据为 experiments/userscripts-document-start/linux-evidence.json，Chrome155.0.8059.84 Linux ARM64，GO/0，25必需项PASS。按仓库映射，清单US-EXP为done，Trellis为completed；该确认不把原macOS启动BLOCKED改为通过。生产实现另建VG-023，验收后仍须独立review。

## 2026-10-17 fixture 提交补充人工验收

用户明确确认 `77790ce`、`fc40299` 两条 fixture 提交已通过人工验收。本任务关联第一组 `77790ce431704942df9a31c03e50e88103ff1615` 的3文件：最小 collector 空 body 等待、回归及 `linux-body-ready-evidence.json`。该报告为真实 Chrome155.0.8059.84 / Linux ARM64 的最小实验 GO/0、25必需项PASS，只证明固定 A/B navigator.language 的最小机制；为保持 pauseGate，实验 JS 在临时 `a4a4055` 暂停基线上运行。它不是生产语言/时区25项，原 `linux-evidence.json` 与首次人工验收不覆盖、不替换。

第二组13文件及独立恢复 GO7 的补充确认同步于 VG-023 执行记录；GO7不代表完整17项生产 smoke 通过，两种报告不合并。完整范围、P2回归、相同 JSON 的仓库外独立执行回执及保留的失败/未知见 [统一补充人工验收记录](../../../experiments/userscripts-document-start/recovery-review.md#2026-10-17-两条-fixture-提交补充人工验收)。

US-EXP维持done / Trellis completed，原完成日期2026-10-16不变，不新建或启动任务。P3暂不扩展；Navigator保持review，其他页面能力继续暂停。仅补记录，保留旧候选树、全部JSON、仓库外执行回执及既有提交；不修改生产代码，不重跑浏览器或构建/测试，不暂存、不提交、不push/tag/发布。
