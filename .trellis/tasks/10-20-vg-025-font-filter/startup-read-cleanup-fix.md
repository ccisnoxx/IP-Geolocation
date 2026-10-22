# VG-025 启动读取失败字体清理修复

2026-10-20，用户明确授权修复已复现的启动读取失败路径，补充定向回归，不扩大权限或撤销命名空间。该修复与 [现场冷启动调查](manual-cold-restart-investigation.json)、[修复前源码诊断](source-lifecycle-investigation.json) 分开记录。任务保持 `review`、人工验收 `pending`，未提交或发布。

## 已复现问题与修复边界

修复前，`initializeExtension()` 在字体对账前读取 local 配置或 session metadata；读取拒绝会直接终止初始化，所属持久字体注册未被清理。新增测试先在修复前执行：首次 local、配置 local、session 三个读取阶段均因旧字体项仍存在而失败；清理双重失败用例也因缺少清理失败状态而失败。

本次仅修改 `src/background/services.ts` 的启动异常处理，并复用现有 `syncFontScriptRegistration([])`：

- 在原配置队列内部等待清理完成，再允许后续配置事务执行。
- 不依赖读取成功的配置，不重新读取 storage，不新增或修改配置、权限、匹配器或注册命名空间。
- 只撤销 `vanishgeo-font-exposure-` 前缀，沿用现有回读确认；其他 ID 即使引用相同字体资产仍不撤销。
- 清理成功后原样抛出启动错误，保持错误对象身份；清理也失败时抛出现有 `RuntimeSyncOperationError`，代码为 `font-scripts-sync-failed`，消息包含原启动原因及“清理未确认”，`cause` 保留原错误。不返回成功报告或伪造残留数量零。
- 正常初始化仍按已保存配置恢复；无页面桥、脚本内 storage 检查、自动刷新或旧 hook 热更新。未改字体过滤资产本身、custom／位置／Worker 暂停边界。

本补丁处理已拒绝／抛错的启动操作，不增加超时，也不声称能在 worker 未运行、被终止或 API 永久挂起时执行清理。

## 定向回归与本地验证

`tests/background-services.test.ts` 新增三个顶层回归（含三个读取阶段子用例）：

1. 首次 local／配置 local／session metadata 读取失败后，仅所属字体项被撤销，其他同资产 ID 保留；原始错误身份、配置与 session 数据保持，未新增脚本或刷新；读取恢复后可以再次正常对账。
2. 读取和字体撤销双重失败时，清理未确认与原始 cause 可见，不伪报成功；API 恢复后同一 services 实例可清理残留。
3. 人为暂停字体撤销时，后续关闭配置事务仍在队列中，不能提前读取或写入配置；撤销完成后正常放行，最终字体注册为空。

实际执行：

- 修复前定向回归为 RED；修复后前两个顶层用例及读取子用例通过。随后补齐队列回归，一并由最终全套覆盖。
- `npm run typecheck:tests`：最终通过。首次发现新增测试钩子的 Chrome API 重载类型推断问题，仅修正测试参数标注和 cast 后通过。
- `npm test`：**224/224 通过，0 失败、0 skip**，包含上述全部新回归。
- `npm run build`：通过；其中执行的 `npm run typecheck` 通过。`dist/` 由维护源正常重建，没有手改构建产物。
- `git diff --check`：通过；新增正式记录另检查解析、空白及状态一致性。

fresh `critical_reviewer` 独立只读复核已完成，未确认本补丁存在阻断问题。核对精确 before/current 增量、异步 reject 的 `return await`、前缀与回读边界、原错误／cause、队列释放和最终验证日志；未修改文件或重复执行测试。审计 `20261020T133909Z-vg025-startup-read-cleanup-36ff5feb` 已关闭且 `audit-verify` 通过，无异常；本轮仅包含该次复核，不混入历史统计。

源码修复阶段未操作用户 Chrome，当时也未运行新的真实 Chrome 故障注入或冷启动验证；此历史缺口由下节单独补充。既有 Chrome PASS 继续保留原有范围，不能当作新后台补丁的完整浏览器验收。源码修复阶段的临时快照、增量 patch 和验证日志已在记录及审计闭合后清理，标准忽略的 `dist/` 保留供 review；此前现场探针与原始证据不删除。

## 独立临时 Chrome 启动读取故障定向验证

2026-10-20，用户另行授权使用独立临时 Chrome 配置文件补充浏览器验证。实际 **Chrome/155.0.8059.85，6 项 PASS，failure=null，cleanup=PASS**。正式脱敏证据：[chrome-startup-read-failure.json](chrome-startup-read-failure.json)。

执行命令：

```bash
node --import tsx scripts/chrome-font-filter-smoke.mjs --startup-read-failure --output .trellis/tasks/10-20-vg-025-font-filter/chrome-startup-read-failure.json
```

新增模式复用仓库隔离 CDP 执行器，只连接本次启动的 Chrome 子进程与随机临时 `user-data-dir`，没有附加、读取、重启或改变用户 Chrome。临时复制当前 `dist/`，保持 manifest／权限和字体文件不变；只在临时 worker 副本前加入故障注入，并在实际 services 创建后包装初始化返回结果以观察错误／cause。剥离插桩后实际编译 worker 内容与原文件完全一致；正式 JSON 保存两项资产 SHA256。该模式是**真实浏览器中的受控 API 拒绝资格验证**，不称为完全未改写的生产 dist 或真实磁盘／存储损坏复现。

准备阶段通过临时扩展控制页的原生 API，写入合成关闭配置，预置 compiler 派生的所属字体注册，以及一个非所属 ID、引用同一字体资产但匹配另一 loopback 源的对照。故障只作用于实际 worker 的 storage 读取／撤销包装，成功的注册、撤销与回读仍调用 Chrome 原生 API。每个失败场景均确认新 worker 清理前实际读到了预置注册，避免将注册自行消失误判为清理成功。

| 检查 | 实际结果 |
|---|---|
| 原生正对照 | 首 inline 字体检查与测量保持原生 |
| 首次 local 读取拒绝 | 所属旧注册由原生 API 撤销；其他 ID／签名保留；新文档恢复原生；抛出原错误 |
| 配置 local 第二次读取拒绝 | 同上；配置与同步 metadata 未被失败清理改写 |
| session metadata 读取拒绝 | 同上；字体清理不再依赖 session 读取成功 |
| 读取＋撤销双重失败 | 所属残留仍存在，新文档仍受过滤；实际错误代码 `font-scripts-sync-failed`、原始 cause 和“清理未确认”均可观察，没有成功报告 |
| 解除故障后再次启动 | 实际 worker 自动清理所属残留，返回字体 `disabled/0`，新文档恢复原生；非所属 ID 继续保留 |

三个成功清理场景均观测到一次原生撤销完成，且没有新增注册；非所属 ID 不仅保留原始签名，其匹配新文档仍实际执行同一字体文件。旧文档中的 hook 均保持旧快照，没有把注册清理误写为旧页面热恢复。

共五次实际 MV3 worker stop/wake。最初两次执行止于执行器的“Target ID 必须改变”断言，未形成字体清理 PASS；补充诊断确认本 Chrome 构建会复用 opaque Target ID。执行器已改为同时确认旧目标消失，以及唤醒后启动闭包随机标识变化。最终五次均满足此判据，并记录 `targetIdReused=true`；未放宽字体注册、撤销和错误传播断言，也未以重试本身作为修复证据。随机标识和 Target ID 原值不写入正式记录。

本轮 `node --check`、真实 Chrome 新模式、`git diff --check` 及证据解析／状态检查通过。本轮只修改浏览器执行器及记录，生产源码、权限、构建配置和单元测试输入未变；复用上轮源码／测试类型、224/224 测试及 build 证据，没有重复全套或重新构建。未取得浏览器真正冷启动、浏览器扩展卡片停用／卸载、Chrome 138／其他 OS 或完整 Options 人工验收；旧 cold `BLOCKED` 不改写。

三次独立启动的临时 Chrome／profile、扩展副本、CDP、loopback server 均已回收，执行器快照与中间失败 JSON 在记录完成后清理。只访问 loopback 和合成配置，不请求 provider；页面度量／像素／设备原值只在临时进程内，正式 JSON 仅保存结论、次数及资产摘要，Chrome 自身后台网络未全量监控。未请求截图或重启用户 Chrome，任务仍 `review`／人验 `pending`，未提交发布。

后续另行补充了 [未插桩当前 dist 的卡片停用对照](browser-card-disable-verification.md)，独立 Chrome155.0.8059.85 的 9 项通过；不扩写本节 6 项故障注入证据的含义，也不代替用户现场根因或真正冷启动验收。

## 与现场根因调查的区别

此处修复的是代码与模拟故障已确认的清理遗漏。仍无现场后台读取错误或实际注册 ID 证据，能把该路径与用户报告的“浏览器扩展停用后新 HTTP 文档仍过滤”建立因果关系；现场根因继续为 **UNCONFIRMED**。本地修复和自动测试通过不解除人工关闭基线阻断，不把任务标记为 `done`，不推进 VG-026／VG-027 人工验收。
