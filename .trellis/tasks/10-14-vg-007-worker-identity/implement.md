# 执行证据

开始日期：2026-10-14；本地验证日期：2026-10-15。分支 stabilize/VG-007，HEAD 5701b55（feat: add explicit exit location profiles）。工作树包含 VG-000～VG-006 的大量修改；初始 228 个可见文件快照保留于系统临时目录用于增量核对，交付前删除。不提交、push、merge、tag、发布或启动后续任务。

## Preflight

依赖 VG-005 与既有 VG-000 均 done。原 manifest VG-007 为 planned/R1/宽泛 Worker 一致性初始计划；本次用户明确校准为 R2 SharedWorker 身份与 URL 生命周期，更新同一 manifest。无已接受合同冲突。已读根 AGENTS、Trellis workflow/前端规范、稳定化 README/manifest/matrix、README/PRIVACY/PERMISSIONS、package/manifest/Vite 以及 runtime/tests/worker fixtures/Chrome 脚本。项目内无更深层 AGENTS。

现状：每次构造都 createObjectURL，无 revoke；共享 fixture 无计数。只改 worker 包装与验收；schema/storage/迁移/runtime message/manifest/DNR/权限/生产依赖不变。MAIN 文档隐藏状态独立于 iframe；ISOLATED/可信 sender/documentId 授权不变。只处理现有语言/时区，保留未接管浏览器 API 透传。

## 基线

`npx tsx --test tests/anti-detection-runtime.test.ts tests/extension-wiring.test.ts`：exit 0，24/24，无失败。现有测试不保护相同 SharedWorker URL/scope 或 URL 回收。

## 验证与结果

实现已完成；源码/测试/fixtures/Chrome 脚本维护源改变，实际生成 dist（未直接编辑）。最终范围包括稳定 Shared URL key、options 单次快照、Dedicated/嵌套 revoke、Shared 同步失败清理/pagehide、原生构造器 Proxy，以及由 Chrome 暴露的 module Shared 早期 connect 丢失修复。

## 回归、诊断与失败分类

- `npx tsx --test --test-name-pattern='相同 SharedWorker key' tests/anti-detection-runtime.test.ts`：修复前 exit 1，1 fail；实际为 blob:worker-2，预期 blob:worker-1。这是缺失的身份合同证据，不是既有全局门禁失败。
- 第一轮候选定向 27/27 通过；最终 Node 总数 126（原 121 + 5 个外部行为回归）。增加实际 fixture scope 计数、name/URL/type/credentials/config 隔离、options 单读/null 名称、Object.prototype 默认值、URL 回收与 native shape/派生类证据。
- 首次测试类型检查暴露 MockURL.createObjectURL 参数窄于原生 Blob|MediaSource，改为原生签名+明确 MockBlob 转换后通过；没有放宽 tsconfig/校验。
- 首次 Chrome 配置拒绝来自 smoke 的 disabled manual geolocation 缺少必需合成字段；补齐测试输入后原生配置校验保持原样。
- module Shared 初始连接 timeout：直接 native module fixture 可连接、延迟同 key 的第二连接能返回，所有包装 scope 最终 handler 已安装。无补丁最小缓冲对照记录 collected=1/replayed=1 仍 timeout，区分了 URL key 与事件交付问题；旧动态 import 启动及停止传播的旧 event 不能直接充当新交付。
- 第一轮独立复核发现 options 多次转换导致 key/native 身份不一致和 null name 错误，已以单次快照修正，getter 抛错只读一次；非法 credentials 保留原生 TypeError，不提前读取后续成员。
- 最终独立复核发现 capture listener 提前处理导致重复交付、同步批量 replay 合并 connect task、字符串 name/非法枚举部分快照继承 Object.prototype 污染；已改为 capture=true、逐个 timer task/pump/排空前收集迟到连接、完整 own 默认字段。新 delayed module fixture 包含 capture listener、100ms 顶层 await 与 callback 微任务计数，真实 Chrome 1→2/不同 name 隔离通过。
- Chrome pagehide 的首次 CDP binding 观测未收到回调，属于测试传输路径而非据此认定生产清理失败；改用临时 localhost 同源 beacon，仅发送 created/revoked/unique 数量，实际导航验证所有 URL 各回收一次。它不是生产外部调用。

## 最终实际验证

| 精确命令 | 结果与边界 |
|---|---|
| `git diff --check` | exit 0；最终文档写完再核验；新文件单独 whitespace 检查 |
| `npm run typecheck` | exit 0；独立运行及最终 `npm run build` 内同命令均通过 |
| `npm run typecheck:tests` | exit 0，strict 测试类型；最后整改后重新运行 |
| `npx tsx --test tests/anti-detection-runtime.test.ts` | 12/12；最终全套也覆盖这些测试 |
| `npm test` | 最终 exit 0，126 tests/126 pass/0 fail/0 skipped |
| `npm run build` | 最终 exit 0，tsc + Vite 5.4.21，30 modules，复制13 items；含新增 worker fixture 与共享 assets chunks |
| `npm run check` | 中间稳定候选 exit 0（125/125）；之后根据新复核问题只重跑受改动影响的类型、test、build 与 Chrome 边界，不把该中间计数充当最终计数 |
| `npm run test:e2e:chrome -- --dry-run` | 最终 exit 0；只检查入口/清单，未执行浏览器验收 |
| `node scripts/chrome-worker-smoke.mjs` | 最终 exit 0，真实 Chrome/155.0.8059.40，临时profile+localhost+合成配置，0 Runtime exception |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-007-worker-identity` | implement/check 各3条引用有效；最终记录写完再核验 |

Chrome 最终逐项结果：classic/module Dedicated、classic/module Shared、delayed module Shared、嵌套加载均成功；Shared 同 key scope/count 1/2、不同 name 计数1；依赖模块顶层语言/时区已打补丁；Dedicated/嵌套 revoke 后仍加载；native prototype/name/length/toString/newTarget/无new、cross-origin 原生行为、非法 credentials（后续 getter 0次）、异步缺失脚本和 CSP error 均通过；真实 pagehide 回收所有创建的包装 URL，且每个一次。原始脱敏汇总留在独立审计 Bundle（audit_id 20261014T160506Z-vg-007-worker-identity-review-e00a9574），不存 Blob URL、完整配置、请求头或个人路径。

## 行为、边界与限制

缓存属于既有隐藏 AntiDetectionState，只有同一文档内 key 相同才复用；重复注入保持 hook/cache，更新未来 worker 补丁来源；返回原配置可复用旧 key/存量 scope。Shared 新建包装同步失败才删除/revoke 该项，复用项单次失败不会驱逐；Dedicated URL 在原生构造器捕获后/失败时释放。异步 CSP/加载失败保留 error，不重试正常脚本请求。

module Shared 在动态 import 期间及缓冲队列排空期间收集 connect，按独立 task 携带同一 ports 的合成 MessageEvent 交付；这些事件 isTrusted=false。队列排空/collector移除后的连接原生交付。import失败清空队列/移除collector。这个限制已写入 design、规范、fixture说明和矩阵，不增加 Event API 伪装隐藏它。

schema/storage/local-session迁移/runtime message/manifest/DNR/权限/host scope/生产依赖不变。MAIN runtime 的页面/worker边界改变；ISOLATED只通知、后台可信sender/documentId、top/iframe各自授权、配置与verified出口所有者不变。未接管设备API保持透传，不加ServiceWorker/Worklet或新指纹面。Worker bootstrap仍classic prelude→importScripts、module prelude→动态import业务图；普通业务脚本仍请求原origin。

本任务不调用出口provider、位置权限或STUN，不记录精确公网IP/真实位置/凭据。smoke只在临时profile写合成语言/时区和合法但禁用的位置字段，localhost仅接收fixture请求与回收计数beacon。Chrome背景网络已禁用；不把这表述为所有浏览器内部网络绝对离线。

未运行人工验收、Chrome119/其他浏览器矩阵、真实BFCache恢复、跨文档共享和新浏览器额外options/完整credentials/CSP网络矩阵；它们不属于本次定向smoke的通过范围。pagehide包含BFCache时清空，恢复后为新缓存周期；既有worker保留启动配置，跨文档共享不承诺。fixture/自动化smoke不等于人工验收。

回滚只撤销VG-007文件/片段并重新构建、刷新受影响页面；不恢复/迁移浏览器数据、不撤销前序任务。无提交、push、merge、tag、发布或后续任务实施。

## 收尾状态

最终独立只读复核未确认未解决阻断。两个 fresh critical_reviewer 审查任务的发现由主代理修复；第二轮核验 options、capture/逐task/own defaults 闭环及 Chrome 脱敏原始日志。SUBAGENT_EXECUTION_DIGEST 已由本机工具生成并通过 audit-finalize/audit-verify；audit_id 为 20261014T160506Z-vg-007-worker-identity-review-e00a9574，高风险正式审计保留90天。2次审查任务验收通过不表示VG-007人工验收；Agent TOML模型配置不充当运行时遥测。没有观察到reviewer写入，未遗留活跃Worker。

manifest planned→in_progress→review；Trellis planning→in_progress→review，completedAt:null、human_acceptance:pending。只有VG-007任务块改变，其他任务状态/块保持初始内容；未调用archive/finish、staging/commit/push/merge/tag/Release或远端设置。

任务增量22文件，清单见task.json。最终增量检查：22个任务文件（12个既有文件增量、10个新文件）均归属本任务；216个基线非任务文件逐字保留、其他14个manifest任务块不变，HEAD 5701b55/分支stabilize/VG-007/空暂存区保持。最终12个代码审查输入未变，fixture README 只同步审查要求的排空时点。新文件whitespace、相对链接和个人路径检查通过；git diff --check与task.py validate均exit0。正式audit校验通过，七个补充diff/hash/Chrome汇总文件仅有未分类artifact提示，没有完整性错误或digest异常。

每次smoke的Chrome/profile/server均由finally关闭；最终任务Chrome/Node进程和临时worker profile为0。开始快照、一次性diff和命令log均属系统临时目录，证据摘要已归档后删除。保留ignored dist作为可加载候选，以及原依赖/缓存和正式审计Bundle；它们不是已发布产物。后续仅列VG-008 Intl/Date、VG-009 Geolocation/Permissions、VG-010 安装/启动、VG-011 迁移/导入导出、VG-012 出口档案事务、VG-013 集成Chrome、VG-014 发布；未实施。建议commit message：fix: preserve SharedWorker identity and reclaim worker blob URLs (VG-007)。

## 人工验收

验收日期：2026-10-15；验收人：用户。用户在当前会话明确确认：

> VG-007 的 Chrome 人工验收已通过：SharedWorker 复用、不同 name 隔离、Blob URL 回收和 module 时序均符合预期，我接受缓冲阶段 connect.isTrusted=false 的限制。请将状态从 review 更新为 done，同步 manifest 和 Trellis 验收记录；不启动后续任务，不提交、push、打 tag 或发布。

确认范围为 SharedWorker 复用、不同 name 隔离、Blob URL 回收和 module 时序。用户接受 module SharedWorker 在动态 import 和缓冲队列排空阶段由合成 connect 事件交付、`isTrusted=false` 的已声明限制；队列排空并移除 collector 后恢复原生交付，不伪造事件信任值。

本次人工确认与此前 Chrome155.0.8059.40 自动化定向 smoke 分别记载。用户未提供本次人工验收的浏览器版本、截图或逐步日志；不据此前自动化记录推断人工验收环境，也不扩大为 Chrome119、其他浏览器矩阵、真实 BFCache 恢复、跨文档共享或更广 CSP/credentials 网络场景的通过证据。

当前状态以 manifest 为准：VG-007 从 `review` 更新为 `done`；Trellis 按原生格式从 `review` 更新为 `completed`，`completedAt` 为 `2026-10-15`，人工验收结果为 `passed`。本文件前文的 review、pending、completedAt:null 和“未运行人工验收”保留为本地实现交付时的历史状态，由本节记录当前人工验收结论。

本轮只同步 manifest、Trellis task.json/本执行记录、稳定化 README 和验收矩阵。源码、测试、fixture、构建配置和既有本地验证输入未改变，复用前文已通过的类型检查、126/126 Node、构建、dry-run 和实际 Chrome smoke 证据；本轮未重新执行这些命令或浏览器验收。保留既有工作树改动，不启动后续任务，不调用 archive/finish，不暂存、提交、push、merge、打 tag、发布或修改远端设置。

本轮记录核验：`git diff --check` 和 `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-007-worker-identity` 均 exit 0；JSON 状态、日期、人工验收结果、证据引用与 Markdown 相对链接/空白检查通过。相对本轮开始快照，仅上述 5 个记录文件改变，其他 233 个可见文件及其余 14 个 manifest 任务块保持不变；HEAD、分支和空暂存区保持。一次性核对快照在最终检查后删除，本轮未创建后台运行资源。
