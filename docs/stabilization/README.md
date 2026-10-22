# VanishGeo 稳定化执行基线

本目录管理稳定化 R0–R5 的范围、依赖、状态和验收证据。VG-000 与 **VG-001：保留已禁用站点规则并统一规则编辑语义** 均已于 2026-10-14 由用户确认人工验收通过；VG-001 的确认覆盖真实 Chrome Options/Popup 规则编辑保存与重新读取。具体状态只读取 manifest，VG-002 已完成本地实现、验证和托管诊断页部署，用户于 2026-10-14 确认 Chrome 人工验收通过，状态为 done；VG-003 已完成用户指定的扩展侧诊断、本地96项验证及Chrome155定向smoke，用户于 2026-10-14 确认 hosted、localhost、导航、取消和过期场景的 Chrome 人工验收通过，状态为 done。VG-004 已完成文档清理和本地核验，用户于 2026-10-14 确认文档人工验收通过，状态为 done，记录与证据见下方入口；VG-005 按用户授权校准为 CI 与发布测试门禁，已完成本地实现、验证和独立审查，用户于 2026-10-14 确认本地人工验收通过，状态为 done，记录见下方；VG-006 已按用户请求校准为 R2 运行时副作用对账，完成本地实现/121项测试/定向Chrome155与独立审查；用户于 2026-10-14 确认四组件失败与恢复、service worker 重启重试、同签名幂等及 UI 同步状态人工验收通过，状态为 done；VG-007 已完成 SharedWorker 身份缓存与 Blob URL 生命周期修复、本地验证和 Chrome155 定向 smoke，最终独立复核通过；用户于 2026-10-15 确认 SharedWorker 复用、不同 name 隔离、Blob URL 回收和 module 时序的 Chrome 人工验收通过，并接受缓冲阶段 connect.isTrusted=false 的限制，状态为 done；VG-008 已按用户请求校准为 R2 配置迁移、Profile 校验与 UI 正确性，完成本地实现、139项测试、Chrome155定向smoke与独立复核，用户于 2026-10-15 确认 Chrome 人工验收全部通过，状态为 done；VG-009 已完成首个 inline script 时序验收实现、144项Node门禁和真实Chrome155三次定向观测，确认earliest原始值竞态；用户于2026-10-15确认三阶段证据与报告一致并接受该已知限制，当前为done（仅验收能力及证据交付完成，竞态未修复）；VG-010 已按用户请求校准为 R3 首次安装引导与安全默认值，已完成本地实现、151项测试、真实Chrome155 fresh/upgrade定向smoke与最终独立复核；用户于2026-10-15确认全新安装、已有v2升级、引导启用、跳过和重置的Chrome人工验收通过，当前done；VG-011 已完成 R3 运行时模块化设计、最小 spike 与安全暂停，用户于2026-10-15确认安全暂停人工验收通过，当前 done；原生错投 FAIL 与扩展阻断 PASS 分开保留，具体证据见下方；VG-012 已完成运行时模块化，用户于2026-10-15确认当前dist可加载、模块化前后行为等价且VG-011安全暂停保持，当前done，记录见文末；VG-013 已于2026-10-15由用户确认 strict、compatible、旧配置迁移及 VG-011 生产安全暂停人工验收通过，当前done，见文末；VG-014 已按用户请求进入 R4 集成验收，当前状态只读取 manifest；最新结果见 [发布候选报告](./release-readiness.md)。

## 权威入口

- [task-manifest.yaml](./task-manifest.yaml)：唯一跨任务清单。每项包含 id、title、phase、dependencies、branch、status、scope、acceptance；`trellis_task` 在执行记录建立后指向已有 Trellis 目录。
- [acceptance-matrix.md](./acceptance-matrix.md)：场景、通过条件、现有证据层级、缺口和负责任务；它不单独维护任务状态。
- [AGENTS.md](../../AGENTS.md)：长期 MV3、安全/隐私、单一配置模型、验证和状态约束。
- [.trellis/spec/frontend/index.md](../../.trellis/spec/frontend/index.md)：有效规范入口；目录、质量与状态管理合同从当前实现校准。
- [VG-000 记录](../../.trellis/tasks/10-14-vg-000-stabilization-baseline/implement.md)：实际执行、验证和回滚证据。
- [VG-001 记录](../../.trellis/tasks/10-14-vg-001-rule-list/implement.md)：初始依赖阻塞、规则编辑修复、本地验证及真实 Chrome 人工验收确认。
- [VG-003 记录](../../.trellis/tasks/10-14-vg-003-diagnostic-report/implement.md)：一次性扩展侧诊断、隐私边界、Chrome smoke 及[人工验收确认](../../.trellis/tasks/10-14-vg-003-diagnostic-report/implement.md#人工验收)；当前状态以 manifest 为准。
- [VG-002 记录](../../.trellis/tasks/10-14-vg-002-diagnostic-observation/implement.md)：诊断 URL 敏感预期值移除、observation mode、本地验证、托管页面部署及 Chrome 人工验收确认。
- [VG-004 记录](../../.trellis/tasks/10-14-vg-004-documentation-privacy/implement.md)：当前文档、隐私/数据生命周期、历史清理人工方案、本地核验及[人工验收确认](../../.trellis/tasks/10-14-vg-004-documentation-privacy/implement.md#人工验收)；状态只读取 manifest。

- [VG-005 记录](../../.trellis/tasks/10-14-vg-005-ci-release-gates/implement.md)：CI/release 同等门禁、测试类型、失败注入与完整历史 changelog，以及[本地人工验收确认](../../.trellis/tasks/10-14-vg-005-ci-release-gates/implement.md#人工验收)；状态只读取 manifest，不代表远端发布或真实 Chrome 验收。

- [VG-006 记录](../../.trellis/tasks/10-14-vg-006-runtime-reconciliation/implement.md)：四组件对账、可见同步状态、session 恢复、实际验证证据及[人工验收确认](../../.trellis/tasks/10-14-vg-006-runtime-reconciliation/implement.md#人工验收)；当前状态为 done，以 manifest 为准。

- [VG-007 记录](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md)：页面内 SharedWorker 身份缓存、Dedicated/Shared URL 回收、module 初始连接修复、实际验证边界及[人工验收确认](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md#人工验收)；当前状态为 done，以 manifest 为准。

- [VG-008 记录](../../.trellis/tasks/10-15-vg-008-config-profile-ui/implement.md)：零坐标迁移、统一自定义 Profile 校验、UUID 与 Popup 目标时区偏移；用户于 2026-10-15 确认 Chrome 人工验收全部通过，见[人工验收](../../.trellis/tasks/10-15-vg-008-config-profile-ui/implement.md#人工验收)；当前 manifest 为 done。

VG-001 至 VG-014 是 VG-000 根据当前实现与验收领域建立的初始路线。任务标题不表示缺陷已经确认；实施前读取代码/测试并细化自己的 PRD 和设计，更新同一 manifest，不另建 backlog。历史归档任务仅供参考，不能满足这些新任务的依赖。

## 阶段与状态

| 阶段 | 目标 |
|---|---|
| R0 | 治理基线、配置持久化 |
| R1 | 诊断隐私、规则编辑保存、DNR、WebRTC、文档注入、iframe、Worker 与页面 API 合同 |
| R2 | 首次安装、迁移、出口档案事务和集成 Chrome 验收 |
| R3 | 首脚本时序、安全引导、runtime 模块化与 Intl 模式 |
| R4 | 稳定化集成回归与发布候选验收 |
| R5 | 生产恢复前的文档绑定与首脚本可行性研究 |

阶段不代表自动发布许可，也不替代逐项依赖。

| manifest 状态 | 含义与允许动作 |
|---|---|
| `planned` | 未实施；只有全部 dependencies 为 `done` 才可进入执行 |
| `in_progress` | 当前获授权任务正在实施或验证 |
| `review` | 实现与本地验证结束，等待人工验收；不能满足依赖 |
| `done` | 人工验收通过后才能设置，并记录验收人/日期/证据引用 |
| `blocked` | 存在实际依赖、不可消解合同冲突、未批准高风险操作、安全边界冲突或无法区分的阻塞性基线失败 |

验收发现问题时，同一任务从 `review` 回到 `in_progress` 修正，不跳过验收；解除阻塞后按实际进度恢复。复杂度、未执行的非必要浏览器测试或 missing manifest 本身不构成 VG-000 阻塞。

Trellis 不另建任务格式：沿用仓库 `task.py create/start`、task.json、prd.md、design.md、implement.md 和工具生成的 context JSONL。工具规划状态 `planning` 对应 manifest `planned`，`in_progress`/`review` 同步；工具原生 `completed` 只在人验后对应 manifest `done`。未完成人工验收的任务保持 `completedAt: null`；已验收任务的 completedAt 与人工验收日期一致。不调用 archive，任何状态不一致先以 manifest 检查授权/依赖并修复记录，不能由旧 completed 记录推断新任务完成。

## 后续任务执行要求

1. 检查 Git 工作树、分支、基线和适用 AGENTS；保留用户与并发任务已有工作。
2. 读取本 manifest、验收矩阵、相关规范和实现/测试。依赖必须为人工验收后的 `done`；一次只实施当前授权任务。
3. 用现有 Trellis 工具建立/复用记录，保存 PRD、设计、实施计划、基线命令和实际结果；更新 manifest 为 `in_progress`。
4. 输出任务 preflight：当前行为/证据、目标、文件范围、数据/权限/realm/隐私/迁移影响、验证、回滚与停止条件。
5. 完成范围内实现和针对实际风险的验证。失败先分类，只有新证据或相关修正才重跑；不要为稳定化名义扩展指纹伪装面或削弱权限/verified 校验。
6. 检查实际 diff、工作树、敏感数据及临时资源。同步状态为 `review`，报告真实结果和缺口；人工验收后才更新 `done` 并记录证据。不自动提交、push、merge、打 tag 或发布。

## VG-000 实现基线（历史证据）

2026-10-14，分支 `stabilize/VG-000`，提交 `5701b55`（`feat: add explicit exit location profiles`）。初始工作树只有两个既有未跟踪图标文件；VG-000 保留它们且不纳入交付。

- TypeScript ES modules 在 src；Vite 五个入口输出到 dist，静态复制 manifest、HTML、icons、fixtures、LICENSE/NOTICE。当前实际构建包含共享 assets chunks。
- schema v2 的配置来源为 `siteSpoofConfig`；auto 信号必须显式绑定 verified 出口档案。检测由用户主动发起，候选在 session、确认后才写 local；导入降级与迁移不建立 verified 身份。
- 动态 allowlist 注册一个 ISOLATED all-frame 初始化脚本；后台从可信 sender 解析文档，用 documentId 在 MAIN world 执行自包含 runtime。没有静态全站 content script 或页面配置桥。
- DNR、WebRTC、配置事务和标签页刷新由后台拥有；本任务保持现有架构和所有调用不变。

## VG-000 实际基线验证（历史证据）

| 精确命令 | 2026-10-14 实际结果 | 层级与限制 |
|---|---|---|
| `npm run typecheck` | exit 0，`tsc --noEmit` | src 静态类型检查 |
| `npm test` | exit 0，58 tests，58 pass，0 fail，0 skipped | Node/VM/Chrome mocks/静态 wiring |
| `npm run build` | exit 0；Vite 5.4.21，23 modules，静态复制 12 items | 真实构建产物，不能证明 Chrome 运行 |

无基线失败。文档完成后若源码、测试、依赖、构建配置和环境输入保持相同，复用这些成功证据；最终文档/依赖/whitespace/摘要检查和 Chrome dry-run 的实际结果记录在 VG-000 implement.md，不能推断未记录的命令通过。

## 覆盖缺口与隐私待办

VG-001 已有用户确认的真实 Chrome Options/Popup 规则保存、重新读取及扩展重载后读取证据，具体覆盖与未提供的版本/截图信息见其人工验收记录。DNR 请求、WebRTC ICE、frame/worker、完整 MV3 生命周期、storage 中断恢复或发布验收仍无本次通过证据；不能由 VG-000/VG-001 完成状态推断这些领域已通过。`npm run test:e2e:chrome` 是半自动脚本，启动成功仍需要人工逐项观测；`--dry-run` 只检查入口/产物并打印清单。

VG-002 已删除诊断 URL 的预期配置传值，外部页面改为 observation mode，不给出配置 PASS/FAIL。数据流见 [PRIVACY.md](../../PRIVACY.md)；本地构建不会自动部署托管页面；2026-10-14 已经用户单独授权完成诊断站点三文件部署，并取得用户的 Chrome 人工验收通过确认，见 [人工验收](../../.trellis/tasks/10-14-vg-002-diagnostic-observation/implement.md#人工验收)。VG-000 当时记录的传值现状属于历史证据。VG-002 代理未运行真实出口检测或 STUN；部署后已核对公开 HTTPS 资源与普通页面渲染，证据只保留合成/脱敏数据。VG-003 已按用户指定的扩展侧诊断报告范围校准并通过人工验收；完整 DNR 生命周期仍未验收，见验收矩阵 A03，不因 VG-003 完成而启动其他任务。

`.gitignore` 精确放行根 AGENTS、有效前端规范及 VG-000/VG-001/VG-002 的维护记录；本地工具、会话、无关任务、dist 和依赖目录继续忽略。各任务回滚只撤销可归属的修改，不触碰浏览器数据、历史归档或既有未跟踪文件；VG-001 的源码回滚与规则数据恢复限制见其 design/implement。

## VG-009 注入时序

用户于2026-10-15将VG-009校准为R3“增加最早内联脚本注入时序验收”，依赖VG-006/007/008均done。原Geolocation/Permissions领域仍是矩阵A09缺口，未借此实施。使用 `npm run test:e2e:chrome -- --injection --runs=3` 自动采未启用对照与合成配置后的重复导航；`--output` 可保存实际JSON。earliest、load回调、postLoad报告采样独立判定，首脚本失败不能被后阶段通过覆盖。Node/dry-run不证明Chrome通过，实际命令、竞态和覆盖限制见[执行记录](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)。

VG-009最终真实Chrome结果：四种文档×三次共12份earliest均为原始值，load为11份原始/1份伪装，postLoad12份均伪装；自动化完成并退出1，真实结论FAIL。已通过同run证据一致性/loaderId修补与独立复核，正式[JSON](../../.trellis/tasks/10-15-vg-009-earliest-inline/chrome-evidence.json)保留失败，不声称生产时序已修复。本地交付时停在review；用户于2026-10-15确认Chrome人工验收通过，manifest更新为done、Trellis为completed，见[人工验收](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md#人工验收)。done仅表示验收能力与证据交付完成，首脚本竞态及正式FAIL/退出1证据继续保留；不推断竞态已修复。

## VG-010 范围校准

2026-10-15 用户明确指定 R3 首次安装引导和安全默认值，依赖已 done 的 VG-009。旧首次启动宽泛计划收敛到 fresh/upgrade/reset 三种语义、主动引导与安全关闭；完整迁移中断恢复、DNR/WebRTC 生命周期矩阵继续留在原领域。当前执行证据见 [VG-010 implement](../../.trellis/tasks/10-15-vg-010-safe-onboarding/implement.md)，状态只读 manifest；本地交付时为 review，当前人工验收确认见下文。

VG-010 本地结果：151/151、源码/测试类型、build/dry-run通过；两个独立临时Chrome155 profile的fresh/主动引导/跳过/reset及旧实现v2更新保留通过。provider请求在发出前拦截为合成响应，未联系真实服务；Popup仅扩展文档与模拟视口，不代替真实action人工验收。本地交付时状态review、人工验收pending，正式[Chrome证据](../../.trellis/tasks/10-15-vg-010-safe-onboarding/chrome-evidence.json)保留；不扩大其他领域缺口或启动VG011。

2026-10-15，用户明确确认 VG-010 Chrome 人工验收通过：全新安装、已有 v2 升级、引导启用、跳过和重置均符合预期，见[人工验收](../../.trellis/tasks/10-15-vg-010-safe-onboarding/implement.md#人工验收)。manifest 已从 review 更新为 done，Trellis 为 completed。用户未提供本次浏览器版本、截图或逐项日志，不与此前 Chrome155 自动化环境混同；其他浏览器/完整生命周期等缺口继续保留。不启动后续任务，不提交或发布。

## VG-011 运行时模块化设计与可行性验证

2026-10-15 用户将 VG-011 明确校准为 R3、依赖 VG-010 done；旧迁移/导入导出是初始路线，原 A11 缺口保留待重新分配。选择构建期静态生成自包含函数，保留 executeScript.func/args、MAIN 和 documentId 架构。本次没有切换生产 runtime；三方案比较、目标目录、worker 二次序列化、source map、回滚及 VG-012 文件级提案见 [RFC](./runtime-modularization-rfc.md)，实际命令见 [执行记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md)。VG-012 记录与范围保持，后续迁移须重新授权。

Node spike 的生成和二次打包脱离闭包检查通过。真实 Chrome155 的最小当前 top/iframe MAIN surface 与 ISOLATED 隔离通过；旧 documentId 负向检查失败，手写函数对照也执行到替换文档，完整 smoke 退出 1。正式 [JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/chrome-evidence.json) 保留 FAIL；不能把 core PASS、Node、build 或 dry-run 表述为完整 Chrome 定向安全/生产等价/人工验收通过。未改生产授权、权限或配置桥，未实施 VG-012～014。

VG-011 最终源码/测试类型、152/152 Node、build、diff 与 dry-run 通过；manifest 与 Trellis 均为 review，人工验收 pending。正式 Chrome 负向 FAIL 不因本地门禁通过而变为 PASS；生产代码与构建配置保持任务前内容。

VG-011 后续[documentId 调查](./document-id-investigation.md)已排除生成器/Vite、CDP 参数/导航处理，并在断开 CDP 后的原生对照中复现。真实生产 dist 的可信 sender→resolver→原 runtime 调用，在受控延迟后可把旧 payload 应用到未匹配规则的替换文档；BFCache 禁用仅作根因对照，未作为生产修改。正式[调查 JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/document-targeting-evidence.json)保留默认模式安全 FAIL，原 spike JSON 不变。VG-011 仍 review，未修复生产、未启动 VG-012。

### VG-011 已授权安全暂停（本地交付记录）

后续用户明确接受功能代价并授权：后台在可信 sender 校验后、payload 读取/派发之前拒绝所有页面伪装，注销旧初始化脚本；语言/时区/位置/Canvas/worker 暂停，DNR/WebRTC 独立实际报告。schema、storage、消息动作、manifest/权限/resolver 不变。此处更新前述“未修复生产”的阶段状态，原始 spike/调查 FAIL 原样保留。

真实 Chrome155 定向安全闸门 PASS：BFCache 恢复 pageshow.persisted=true、跨 origin 新文档、同 URL 重载均生产派发 0，top/iframe API 原生；真实 worker 停止/唤醒、保存/同签名重试不能绕过，旧注册已撤销，Options/Popup 暂停可见。独立运行的 native-only 对照仍错投、documentTargetSafety=FAIL，浏览器并未修复。详见[调查与实施](./document-id-investigation.md)及[正式 JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/safety-gate-evidence.json)。新闸门不撤销已执行 hook，旧 BFCache 文档需关闭并重建。本地完整门禁与独立复核结果见任务 implement；VG-011 保持 review，VG-012 不启动。

### VG-011 人工验收确认

2026-10-15，用户明确确认“VG-011 安全暂停人工验收通过”，并授权将 manifest 更新为 done、Trellis 更新为 completed；正式[人工验收记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md#人工验收)保存原话与确认边界。前文 review/pending 是此前阶段状态。本次确认不恢复页面伪装：Chrome 原生旧 documentId 错投 FAIL 与扩展派发前阻断 PASS 分开保留，三个正式 JSON 不改；不表示浏览器缺陷已修复、完整功能已恢复或全部版本已验收。用户未提供本次浏览器版本、截图或逐项日志，不补写这些信息。VG-012 未启动，无提交或推送。

## VG-012 按批准 RFC 实施模块化

2026-10-15 用户明确授权R3模块化，依赖VG-011人工done；旧出口事务计划在同一manifest条目校准，原A12缺口保留。`src/injected/runtime.ts` 变为静态生成facade，维护源按registry、payload、页面surfaces、worker及唯一调度拆分；生成器先完成worker自包含，再嵌入page，构建插件校验外部绑定/import/chunk、source map/watch与失败传播。

生产仍保持VG-011安全暂停，services/消息/配置/storage/manifest/权限/DNR未修改。候选47份dist文件与任务前构建逐字节一致；不新增公开runtime文件、chunk或WAR。Chrome155临时扩展的旧/新runtime等价PASS和正式dist的安全闸门PASS分别记录，不表示恢复生产派发。VG-009旧runner因保存返回partial在观测前退出2；仅适配已确认暂停状态后的三次同run采样中，四种文档各阶段均原生、伪装判定仍FAIL，原VG-009证据不改。

实际命令、行为矩阵、独立复核与状态见[VG-012执行记录](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md)，状态只读取manifest；本地交付时人工验收pending，当前确认见下文，不启动VG-013/014，不提交或发布。

2026-10-15，用户明确确认VG-012人工验收通过：当前dist可正常加载、模块化前后行为等价、VG-011安全暂停保持，见[人工验收记录](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md#人工验收)。manifest由review更新为done，Trellis由review更新为completed。用户未提供本次Chrome版本、截图或逐项日志，不与此前Chrome155自动化证据混同；原documentId错投、earliest-inline竞态及暂停下时序FAIL继续保留，不表示恢复生产伪装。不启动后续任务，不提交或推送。

## VG-013 时区与 Locale 兼容模式

2026-10-15 用户明确授权本任务，依赖 VG-012 人工 done；manifest 同条目校准为 R3 模式配置与 Intl/Date 行为，原 A13 集成验收缺口保留待重新分配。新旧用户默认 strict，compatible 逐参数尊重显式值；schema v2 不变，旧数据读取补默认、不强制重写。

生产 MAIN 派发继续安全暂停。临时扩展中的两模式 runtime smoke 与正式 dist 配置/UI/暂停证据分开记录，不改变原 documentId/earliest FAIL。实际变更、验证和限制见 [VG-013 implement](../../.trellis/tasks/10-15-vg-013-intl-compatible/implement.md)；本地实现验证结束为 review，人工验收前不改 done，不实施 VG-014、不提交或发布。

VG-013 本地结果：170/170、源码/测试类型、build、diff与dry-run通过；Chrome155两模式隔离runtime、正式dist配置/UI/旧v2读取以及生产暂停闸门分别PASS。独立复核的缺省options继承污染与locale协商假FAIL已修正，最终由主代理复验，详见任务记录。本地交付时manifest与Trellis均review、人工验收pending；当前确认见下文。未恢复生产伪装、未实施VG014或原A13集成。

2026-10-15，用户明确确认VG-013人工验收通过：strict、compatible、旧配置迁移均符合预期，VG-011生产安全暂停保持，见[人工验收记录](../../.trellis/tasks/10-15-vg-013-intl-compatible/implement.md#人工验收)。manifest由review更新为done，Trellis由review更新为completed。用户未提供本次浏览器版本、截图或逐项日志，不与此前Chrome155自动化证据混同；旧documentId/earliest竞态及其他浏览器/完整集成缺口继续保留，不表示恢复生产伪装。不启动VG-014，不提交或推送。

## VG-014 集成与候选验收

2026-10-15，用户将本任务明确校准为R4，依赖VG001～013 done。本轮完整本地门禁170/170及真实Chrome155集成、安全闸门、隔离模式/等价验证完成；候选dist/ZIP按文件摘要锁定。最新逐项结论与未验证项见 [release-readiness](./release-readiness.md)，执行记录见 [VG-014](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md)。本地交付时为review、人工验收pending，当前确认见下文；完整页面伪装仍因VG011暂停而不具备发布条件，旧documentId/earliest负向证据不改。无生产代码/权限/版本变化，没有提交或远端操作。

2026-10-15，用户明确确认VG-014人工验收通过，接受当前安全暂停和已知限制，见[人工验收记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md#人工验收)。manifest由review更新为done，Trellis由review更新为completed。生产伪装继续暂停，完整功能不具备release-ready条件；任务完成不构成发布批准。未改版本、未提交、未推送或发布，未启动后续任务。用户本次未提供浏览器版本、截图或逐项日志，不与此前自动化证据混同。

## VG-015 / VG-017 恢复前研究

2026-10-15，用户批准拆分并仅授权VG-015、VG-017研究，均依赖VG-014 done；未启动VG-016/018/019。VG-015重新取得Chrome155默认BFCache旧ID错投FAIL、禁用BFCache对照拒绝、生产暂停零派发PASS，并固定官方tag/main源码摘要；[文档绑定报告](./document-binding-research.md)结论为当前恢复资格NO_GO。VG-017真实Chrome五模式对照中，暖/冷/受控延迟异步路径earliest均0/4、postLoad均4/4，固定合成MAIN document_start为4/4；[时序报告](./earliest-inline-research.md)解释动态payload及架构合同尚未解决，完整时序方案NO_GO。两项研究本地交付时为review、人工验收pending，当前确认见下文；研究完成不授权恢复生产或发布。当前生产安全暂停、版本、权限和原证据保持。

2026-10-15，用户确认VG-015、VG-017研究验收通过，接受当前NO_GO结论及已知限制；人工验收记录见[VG-015](../../.trellis/tasks/10-15-vg-015-document-binding-research/implement.md#人工验收)、[VG-017](../../.trellis/tasks/10-15-vg-017-earliest-inline-research/implement.md#人工验收)。两项manifest由review更新为done，Trellis由review更新为completed。NO_GO和生产安全暂停保持，不启动恢复实施，不改版本、不提交、推送或发布。

## VG-020 替代注入架构 RFC

2026-10-15，用户授权评估不扩大权限的替代注入架构，依赖VG-015、VG-017 done。新[替代注入RFC](./alternative-injection-rfc.md)评估动态MAIN bootstrap与同文档ISOLATED broker、私有交接、签名封装、包内固定快照及注册文件序列编码，明确端点身份/跨world信任/首读时序三个门槛。推荐仅做非敏感文件序列编码与broker机制的最小验证；前者的组装/撤销/隐私、后者的私有通道均未证明，完整首读仍未取得资格；固定快照需单独接受产品合同。本轮只交付RFC与验证计划，无新Chrome实验或生产实现。VG-020本地交付时为review、人工验收pending，当前确认见下文；前两项NO_GO与生产暂停保持，不启动恢复或发布。

2026-10-15，用户确认VG-020 RFC验收通过，接受候选机制仍待验证及NO_GO结论，见[人工验收记录](../../.trellis/tasks/10-15-vg-020-alternative-injection-rfc/implement.md#人工验收)。manifest由review更新为done，Trellis由review更新为completed；只验收RFC，不启动恢复实施。生产安全暂停保持，不改版本、不提交、推送或发布。

## VG-021 P0-F 隔离验证

2026-10-15，用户单独授权VG-020 RFC的P0-F实验，依赖VG-020 done。真实Chrome155临时最小扩展证明位置专属文件可表达4位合成数据且四类文档首inline均4/4；重复文件仅组装01、微任务可在位片段前执行。父页攻击未证明提交前篡改成功，也不构成不可篡改证明；storage禁用到注销间隙仍可安装旧序列、注销不撤销存量getter。结论为有限表达GO、安全恢复NO_GO，详见[研究报告](./registration-sequence-research.md)及[正式JSON](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/chrome-evidence.json)。本地交付时为review、人工验收pending，当前确认见下文；生产暂停、版本、权限和旧证据保持，不启动其他阶段或恢复，不提交/推送/发布。

2026-10-15，用户确认VG-021隔离验证验收通过，接受有限同步表达GO、安全恢复NO_GO及已知限制，见[人工验收记录](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/implement.md#人工验收)。manifest由review更新为done，Trellis由review更新为completed。生产伪装继续暂停，不启动恢复实施；研究验收不构成恢复或发布批准。不改版本、不提交、推送或发布，原Chrome证据和未验证范围保持。

## 本地分任务提交范围（2026-10-22）

本次仅按用户授权整理必要前置任务和VG-029为本地提交；不push、不发布，其他任务保持未提交。任务状态以manifest为准；旧阶段的暂停、测试数量和未提交描述保留历史含义。

- VG-028：schema v3、原生请求头、16项字体配置与维护源；DNR仅清理历史1100至2099，语言/时区保持，字体/位置/Worker生产暂停。 [执行记录](../../.trellis/tasks/10-20-vg-028-header-font-contract/implement.md)。
