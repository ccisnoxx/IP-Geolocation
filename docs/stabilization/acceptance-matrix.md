# 稳定化验收矩阵

候选基线：`5701b55`，日期：2026-10-14。VG-000 只建立矩阵，不执行后续功能修复。任务状态和依赖只读取 [manifest](./task-manifest.yaml)。


## VG-014 当前集成结论（2026-10-15）

本次R4依赖VG001～013全部done；其各自done只表示各任务人工验收范围。**完整功能仍不具备release-ready条件**：VG011生产派发安全暂停，旧documentId及earliest负向证据未修复。VG014本地交付时为review；用户于2026-10-15确认人工验收通过，接受当前安全暂停和已知限制，manifest现为done，见[人工验收记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md#人工验收)。生产伪装继续暂停，任务完成不构成发布批准。

本轮当前dist：完整本地170/170、源码/测试类型、build/dry-run通过；真实Chrome155集成11组PASS，报告实际12 PASS/54 FAIL/4 UNKNOWN（伪装FAIL和ICE UNKNOWN均保留）；正式安全闸门零派发PASS；隔离strict/compatible与旧新runtime等价PASS。完整A01～A16逐项执行、环境、命令、覆盖缺口、构建/ZIP清单、阻断与回滚见 [release-readiness](./release-readiness.md)，正式证据及runner失败分类见 [VG-014执行记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md)。下面旧表的“待分配/尚无”是原任务阶段历史，不覆盖此处最新集成结果，也不将未验证子项升级为PASS。

## R5 恢复研究证据（2026-10-15）

VG-015/VG-017是用户本轮获授权研究，当前状态只读取manifest。[文档绑定研究](./document-binding-research.md)补充本轮原生旧ID错投FAIL与生产暂停PASS、上游固定源码；[时序可行性研究](./earliest-inline-research.md)补充异步冷/热/受控窗口反例及固定MAIN脚本对照。两项NO_GO针对恢复能力，不改变VG-014已接受安全暂停的done，也不改写历史负向结果；正式生产仍暂停。研究没有覆盖恢复候选完整功能，A05/A13恢复验收仍待新机制和明确授权。

2026-10-15，用户确认两项研究验收通过并接受NO_GO及已知限制，manifest均为done；见[VG-015人工验收](../../.trellis/tasks/10-15-vg-015-document-binding-research/implement.md#人工验收)和[VG-017人工验收](../../.trellis/tasks/10-15-vg-017-earliest-inline-research/implement.md#人工验收)。生产暂停及原始FAIL/UNKNOWN保留，不启动恢复实施；研究done不表示恢复资格或发布批准。

VG-020的[替代注入RFC](./alternative-injection-rfc.md)只提出无新增权限方案、合同取舍和P0～P4验证计划；全部新机制实验待执行，不提升A05/A13恢复验收状态。当前生产暂停及VG-015/017已接受NO_GO保持。用户于2026-10-15确认VG-020 RFC验收通过，manifest现为done，见[人工验收记录](../../.trellis/tasks/10-15-vg-020-alternative-injection-rfc/implement.md#人工验收)；候选机制仍待验证，当前NO_GO和暂停不变，不启动恢复实施。

## 证据规则

- **现有本地证据**：VG-000 基线 58 项、VG-001 修复后 71 项、VG-002 最终 75 项、VG-003 最终 96 项 Node 测试，以及各自 typecheck/build；按 Node/VM/mock/静态边界描述。
- **后续通过条件**：需要执行后才能报告通过。VG-001 规则编辑场景、VG-002 诊断隐私场景与 VG-003 hosted、localhost、导航、取消和过期场景已有用户明确确认的 Chrome 人工验收通过结果，见各自人工验收记录；其他浏览器/故障场景不能由局部测试或这些确认推断通过。
- **人工浏览器证据**：记录候选提交、Chrome 版本、安装/规则/手动合成配置、操作、预期/实际、结论和脱敏证据。UNKNOWN 是未验证或不可观察，不等于 PASS。
- **发布证据**：稳定候选构建/打包清单、权限/隐私说明和人工验收记录；dry-run、成功构建、任务状态不能替代。

## 场景、覆盖与缺口

| ID / 领域 | 必须验收的场景与通过条件 | 现有证据 | 尚待验证的边界 | 负责任务 |
|---|---|---|---|---|
| A01 规则编辑保存 | Popup/Options 无关保存保留禁用规则；重新启用保留 ID/overrides/出口绑定；移除启用域名只删除该规则；两页共用文本语义 | 本地 71/71、规则/表单/wiring 测试；2026-10-14 用户确认真实 Chrome Options/Popup 各项通过，包括保存后读取及扩展重载后读取，见 VG-001 implement.md“人工验收” | Chrome 具体版本、截图与逐步 JSON 未提供；多窗口并发、storage 写失败与广泛重启恢复未在本任务实施或验收 | VG-001（规则编辑范围） |
| A02 诊断隐私 | launcher URL 无任何 expected* 或其他敏感预期载体；普通 HTTP(S) 页固定 observation mode，保留实际 API/header echo，不接收扩展配置或提供配置 PASS/FAIL | VG-002 后台 URL 白名单/配置无读取测试、实际页面 VM 旧 query 忽略及 header/API/ICE 观测、静态无桥约束与 runtime debug 日志 VM 回归；普通页面内置浏览器渲染/header/UI 切换与合成旧 query 检查通过，控制台无 error/warn；2026-10-14 托管页面部署后的 HTTPS 哈希/资源/header echo 和线上渲染通过，用户确认 Chrome 人工验收通过，见 [人工验收](../../.trellis/tasks/10-14-vg-002-diagnostic-observation/implement.md#人工验收)；PRIVACY.md 描述数据流 | Chrome 具体版本、逐项网络/Referer 记录与用户截图未提供；完整扩展侧验证及其他浏览器生命周期合同属于后续任务，不能由本次确认推断通过 | VG-002 |
| A02b 扩展报告 | 内存一次性 run、受信任报告比较、定向实际值/普通 origin header echo、policy/ICE 分离与 realm/透传；取消/过期/导航/失败清理 | VG-003 Node/mock/VM/wiring 96/96；真实 Chrome155 临时headless profile：41 PASS/1 UNKNOWN、0 Runtime exception，localhost信号/header/policy/iframe/worker/透传/隐私/导航/取消/实际报告TTL通过；2026-10-14 用户确认 hosted、localhost、导航、取消和过期场景的 Chrome 人工验收通过，见[人工验收](../../.trellis/tasks/10-14-vg-003-diagnostic-report/implement.md#人工验收)；当前状态以 manifest 为准 | 人工验收具体 Chrome 版本、截图与逐项报告未提供；CSP、跨源和 origin fallback 边界、广泛重启和权限矩阵未由定向 smoke 或本次五场景确认覆盖 | VG-003 |
| A03 DNR | 有效 Accept-Language 与 navigator/worker 语言一致；域名/子域作用域、禁用、删除、容量和替换失败；只管理规定 ID | dnr 规则生成与静态 wiring；background 副作用 mocks | Chrome 实际请求头、优先级、rule limit/API 错误和重启规则恢复；VG-003 已由用户改为诊断报告，报告提供当次 header 证据但不验收完整 DNR 生命周期 | 待用户重新分配 DNR 生命周期范围 |
| A04 WebRTC | strict/compatible/default、主开关禁用、受其他设置控制、不支持与失败；期望和实际 policy 分开，ICE 泄露单独报告 | webrtc policy/clear/get mocks，diagnostic ICE 分类；VG-003 有当次 policy/ICE 分离的报告证据 | Chrome 完整 levelOfControl、真实 ICE candidate、策略清理/重启行为；VG-004 已由用户改为文档任务，文档不能代替这些验收 | 待用户重新分配 WebRTC 生命周期范围 |
| A05 MAIN-world 注入 | 动态 allowlist、可信 sender、当前 documentId、未匹配页、非法管理来源、重复初始化/导航及配置刷新 | background sender 注入 mocks、wiring、VM 直接调用 | Chrome MV3 时序、导航竞态、MAIN 执行与 ISOLATED 通知、API 失败和 worker 重启 | 待用户重新分配注入生命周期范围 |
| A06 iframe | top frame、同源/异源 allowlist 与 nonmatch、动态 iframe、about:blank/srcdoc、导航；每个文档独立授权，错误不能跨帧扩散 | VM 直接 frame 调用，注册 allFrames/fallback 静态约束；fixtures/iframe | Chrome origin fallback、子帧自身匹配与动态文档；不能用父页面遍历模拟授权 | 待用户重新分配 iframe 边界范围 |
| A07 Worker/SharedWorker | 同文档相同 URL/type/name/credentials/补丁配置复用 URL/scope，name 隔离；classic/module 依赖执行前补丁，Dedicated/Shared 回收，原生 fallback/反射与错误 | VG-007 Node/VM 回归含实际共享计数 fixture、options 单次快照/null name、失败清理与 pagehide；126/126 Node 与源码/测试类型/build/dry-run；Chrome155.0.8059.40 临时 profile 实测 classic/module/shared/nested、计数 1/2/name 隔离、module 依赖顶层、revoke 后加载、反射/跨源/非法 credentials/异步错误/CSP、顶层 await capture/微任务顺序和实际导航回收，0 Runtime exception；用户于 2026-10-15 确认 SharedWorker 复用、不同 name 隔离、Blob URL 回收和 module 时序的 Chrome 人工验收通过，见[人工验收确认](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md#人工验收)；见 [执行证据](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md) | Chrome119、真实 BFCache 恢复、跨文档共享、新浏览器额外选项完整矩阵和更广 CSP/credentials 网络场景未覆盖。module Shared 缓冲阶段 connect 为 synthetic/isTrusted=false，队列排空后原生；用户已接受此限制；ServiceWorker/Worklet 范围外 | VG-007（身份与 URL 生命周期）；其他边界需另行授权 |
| A08 Intl/Date | locale/timezone、DST、显式调用选项、禁用信号、异常/descriptor/原生函数语义；无关设备表面透传 | anti-detection-runtime VM Intl/Date 与透传测试 | Chrome 原生对象、不同调用选项、跨 realm 时区行为；现有通过仅限 VM 场景 | VG-013（仅模式与定向跨 realm）；VG-008 只覆盖下述配置/UI 合同 |
| A09 Geolocation/Permissions | getCurrentPosition/watchPosition/clearWatch、随机半径、非法坐标、权限、禁用和回调清理；不伪造 verified 档案 | config 校验，runtime VM 位置/权限测试；fixtures/geolocation | Chrome 原生权限/回调/导航生命周期、真实 watcher 清理和禁用透传 | 待用户重新分配 Geolocation/Permissions 范围 |
| A10 首次安装/启动 | fresh 空 storage 安全关闭/空规则/WebRTC default；主动引导、跳过/reset 与 v2 upgrade 保留；不自动定位 | VG-010 配置/后台/UI定向回归；真实Chrome证据以执行记录为准 | 人工 action Popup、Chrome119、完整浏览器冷启动/中断恢复及DNR/WebRTC生命周期矩阵不由局部smoke补足 | VG-010（本次安全默认与引导）；其他领域保持缺口 |
| A11 迁移/导入导出 | 旧键/标记、已有 v2、重复迁移、中断恢复、非法数据；旧 lastLocation 为 unverified，规则不绑定；导入降级 | config 迁移转换、background 旧键迁移/导入降级 mocks | 真实 chrome.storage 中断/旧版本升级/重复读取的数据完整性，导出敏感字段边界 | 待用户重新分配；VG-011 已按本次请求校准为模块化设计，不表示迁移验收完成 |
| A12 出口档案事务 | 主动检测、同次响应身份、候选确认/取消/过期、重检冲突、引用删除和有效 payload 精确刷新 | background provider timeout/fallback、确认、重检、删除阻断、刷新 mocks | Chrome session 生命周期、并发管理页、失败后的候选/配置恢复；真实 provider 只能在对应授权中验证 | 待用户重新分配；VG-012 已校准为运行时模块化 |
| A13 集成验收 | 使用同一候选和脱敏 fixture，串联配置/网络/realm/重启；每个必须场景有明确结论 | 本地测试 + build；现有半自动 Chrome 脚本入口；A01 有用户人工确认的规则编辑结果 | 尚无跨领域真实 Chrome 集成结果；需整合 A01–A12，不以局部规则验收、启动或 dry-run 算通过 | 待用户重新分配集成范围；VG-013 已校准为兼容模式 |
| A14 发布流程 | 稳定候选、版本/manifest 一致、完整 dist 入口/chunk/静态资源/许可证、隐私/权限说明、审批及回滚 | VG-000 build 实际输出与入口静态检查 | 干净候选打包清单、人工浏览器记录、发布授权和恢复演练；本次不发布 | VG-014 |
| A15 runtime 模块化设计 | 三方案、闭包/worker 二次序列化、静态构建最小 spike、后续文件清单与等价性矩阵 | [RFC](./runtime-modularization-rfc.md)；Node 生成/二次打包独立函数检查；真实 Chrome155 当前 top/iframe MAIN 与 ISOLATED 隔离最小验证通过 | 旧 documentId 负向 FAIL；专项调查排除生成/CDP并在受控生产路径复现；未证明完整生产等价、worker 生成、source map 组合/watch 或 Chrome119；安全暂停已获用户人工验收，原生 FAIL 保留 | VG-011（设计与隔离 spike）；生产迁移须后续单独授权 |

| A16 runtime 模块化实施 | 页面/worker两层自包含、单一registry、首次/重复语义、六入口/WAR、source map/watch及可观察等价 | VG-012 模块/VM/最终构建守卫与Chrome155旧新等价；用户于2026-10-15确认当前dist可加载、模块化前后行为等价、VG-011安全暂停保持，见本页末节及任务人工验收记录 | 生产仍安全暂停；人工验收未提供版本/截图/逐项日志，Chrome119/其他浏览器、广泛权限/网络/CSP矩阵、stale documentId修复及功能恢复未覆盖 | VG-012 |

## 当前基线结论

VG-000 的 `npm run typecheck`、`npm test`（58/58）、`npm run build` 已实际通过；2026-10-14 用户明确确认其治理基线人工验收通过，manifest 同步为 done。此确认不补足 A01–A14 的功能浏览器证据。

VG-001 按用户明确的 R1 规则编辑范围细化，本地 typecheck、npm test（71/71）与 build 已通过；本地交付先停在 review。2026-10-14 用户确认已按提供步骤通过真实 Chrome 人工验收，Options 和 Popup 各项均通过；manifest 据此更新为 done，记录见 [人工验收](../../.trellis/tasks/10-14-vg-001-rule-list/implement.md#人工验收)。A01 原有宽泛配置持久化中的并发编辑、写失败和广泛重启恢复仍是未验证事项，不自动扩大 VG-001 或授权新的任务，后续须另行分配。

VG-002 本地 typecheck、npm test（75/75）、build 和 Chrome dry-run 已通过，新版托管诊断页已部署并核对。2026-10-14 用户明确确认 Chrome 人工验收通过，manifest 据此从 review 更新为 done，Trellis 同步 completed，记录见 [人工验收](../../.trellis/tasks/10-14-vg-002-diagnostic-observation/implement.md#人工验收)。这项确认只完成本任务验收，不补足其他领域的浏览器证据。

VG-003 本地 typecheck、npm test（96/96）、build、Chrome dry-run 与真实 Chrome155 定向 smoke 已通过。2026-10-14 用户明确确认 hosted、localhost、导航、取消和过期场景的 Chrome 人工验收通过，manifest 从 review 更新为 done，Trellis 同步 completed，记录见 [人工验收](../../.trellis/tasks/10-14-vg-003-diagnostic-report/implement.md#人工验收)。用户确认与此前自动化 Chrome smoke 分别记载；该确认不补足 A03 或其他任务的完整生命周期、CSP、跨源、重启及权限矩阵。

Chrome 入口为构建后的 `npm run test:e2e:chrome`。优先使用脚本提供的 localhost server 与 dist fixtures，手动使用合成配置；正常 web origin 页面需要 allowlist，扩展页面只能用于 launcher/状态读取。真实 profile、server、截图/trace 等临时资源在验收后清理，只留必要脱敏证据。每个后续任务按其具体变化选择最小可靠检查，不因本矩阵存在而重复运行无关场景。

## VG-003 范围校准

2026-10-14 用户明确将 VG-003 指定为 R1 扩展侧诊断报告，依赖 VG-002。旧 DNR 条目为初始计划，没有已接受实现合同与当前请求冲突；更新同一 manifest 记录。A03 完整生命周期仍未验收，不创建第二份 backlog、不自动启动其他任务；未来开始 VG-010/VG-013 时须重新检查其 DNR 验收前提，不能因 VG-003 报告完成推断 DNR 生命周期通过。

## VG-004 文档验收与范围校准

2026-10-14 用户明确将 VG-004 指定为 R1 文档、隐私和旧项目信息清理，依赖已人工验收的 VG-003。更新同一 manifest 的范围，不改其他任务块；旧 WebRTC 初始计划没有已接受实现合同。A04 缺口继续保留，未来 VG-010/VG-013 启动前须核对 DNR/WebRTC 验收前提，不能以诊断或文档完成替代。

文档验收要求：README/INSTALL/CONFIG_GUIDE/PRIVACY/PERMISSIONS 与维护源一致；本地链接、npm scripts、完整 dist/ZIP 命名及 Actions 行为可核验；没有错误旧项目操作、个人绝对路径和真实公网 IP 示例；必要许可证来源归属保留。历史敏感值只记录待批准方案，repository 元信息只给人工建议。具体本地结果见 [VG-004 implement](../../.trellis/tasks/10-14-vg-004-documentation-privacy/implement.md)。2026-10-14 用户明确确认文档人工验收通过，manifest 从 review 更新为 done，Trellis 同步 completed，见[人工验收](../../.trellis/tasks/10-14-vg-004-documentation-privacy/implement.md#人工验收)；该确认不扩大为运行时、历史清理或发布验收。

## VG-005 CI 与发布门禁范围校准

2026-10-14 用户明确将 VG-005 指定为 R1 CI 与发布测试门禁，依赖已人工验收的 VG-004。更新同一 manifest，其他任务范围/依赖不变；A05 的 Chrome 注入生命周期仍未验收。未来依赖 VG-005 的浏览器任务及 VG-013 开始前须重新核对实际注入验收前提，不因 VG-005 门禁完成推断注入时序已通过。

VG-005 验收：push/PR 与 tag release 均执行锁文件安装、源码/测试类型、单元测试与构建；失败阻止下游产物和发布；changelog 使用完整历史而非静默通用文本；Actions 默认只读、release job 才可写；Chrome dry-run 只核验入口。实际本地命令和失败注入证据见 [VG-005 implement](../../.trellis/tasks/10-14-vg-005-ci-release-gates/implement.md)。A14 仍缺真实远端 workflow/Release、版本一致性、候选人工验收和恢复演练；本任务不触发发布。

VG-005 本地证据：strict 测试类型通过，最新100/100测试、源码typecheck/build及Chrome dry-run通过；四项门禁定向检查含真实失败测试阻断build、第二父提交已发布tag、HEAD多个轻量/附注tag和shallow拒绝。独立审查发现的合并历史范围问题已修复并经fresh复核。2026-10-14 用户明确确认VG-005本地人工验收通过，manifest由review更新为done，Trellis同步completed，见[人工验收](../../.trellis/tasks/10-14-vg-005-ci-release-gates/implement.md#人工验收)。该确认不代表远端Actions/Release、Node20环境或真实Chrome验收通过；原注入生命周期与A14其他缺口仍保留。

## VG-006 运行时副作用对账范围校准

2026-10-14 用户明确将 VG-006 指定为 R2 运行时副作用对账和可见同步状态，依赖已人工验收的 VG-005。更新同一 manifest；旧 iframe 初始计划无已接受实现合同，A06 缺口继续保留待分配。本次仅补 A03/A04/A05/A10 中对账、失败恢复及可见状态的具体范围，不代表完整 DNR、WebRTC ICE、注入/迁移生命周期或 iframe 验收通过。

验收：四组件状态/错误可见，部分失败已保存但未完全生效；配置唯一 desired state，session 欠账按摘要关联；容量预检、单 tab 隔离、后台再启动恢复和收敛幂等。实际命令、Chrome 定向证据与独立审查见 [VG-006 implement](../../.trellis/tasks/10-14-vg-006-runtime-reconciliation/implement.md)。本地交付时先为 review；用户于 2026-10-14 确认四组件失败与恢复、service worker 重启重试、同签名幂等及 UI 同步状态人工验收通过，见[人工验收确认](../../.trellis/tasks/10-14-vg-006-runtime-reconciliation/implement.md#人工验收)。当前 manifest 为 done，Trellis 为 completed。

VG-006 本地结果：121/121、源码/测试类型、build及dry-run通过；真实Chrome155定向覆盖四组件失败/恢复、相同签名无重复修改、实际worker停止/唤醒、两页状态、第二扩展策略遮蔽释放与候选碰撞守卫。独立审查发现的三项具体问题已修复，最终守卫fresh复核未确认新问题。以上 Chrome155 为实施阶段定向证据；本次用户确认未提供浏览器版本或截图，不扩大为旧A06、完整ICE/迁移/浏览器重启等缺口通过。

## VG-007 范围校准

2026-10-14 用户将 VG-007 明确指定为 R2 SharedWorker 身份语义与 Blob URL 生命周期，依赖已 done 的 VG-005；更新同一 manifest，不启动其他任务。包装仍限同源 HTTP(S)，配置/消息/MV3/DNR/权限/verified 边界不变。module Shared 初始连接丢失由真实 Chrome 对照确认；补发使用同一 ports 的合成 MessageEvent，isTrusted=false 的边界保留为人工验收关注点，不伪造原生信任值。

2026-10-15 用户明确确认 SharedWorker 复用、不同 name 隔离、Blob URL 回收和 module 时序的 Chrome 人工验收通过，并接受缓冲阶段 `connect.isTrusted=false` 的限制，见[人工验收确认](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md#人工验收)。当前 manifest 为 done，Trellis 为 completed；其他未覆盖边界继续保留，不据此启动后续任务。

## VG-008 范围校准与验收

2026-10-15 用户将 VG-008 明确校准为 R2 配置迁移、Profile 校验和 UI 正确性，依赖已 done 的 VG-001、VG-005。更新同一 manifest，不实施原 A08 Intl/Date 注入/反射/跨 realm 审查；A08 原浏览器缺口继续保留。仅补 A11 中零坐标和自定义 Profile 输入正确性，完整迁移中断恢复、出口事务和 Chrome 集成仍归后续范围。

| 场景 | 本任务通过条件 | 本地证据与人工缺口 |
|---|---|---|
| 零坐标迁移 | bpg_config 的 0/0、0/120、-30/0 为 manual，重复运行保留数值 | config 定向回归及Chrome155合成旧键真实storage迁移/重复读取；真实旧版本升级/中断恢复未验收 |
| Profile 字段及 ID | 有限坐标与范围、正 accuracy、IANA timezone、非空名称及唯一 ID；非法方案不进入有效配置 | profile/config纯逻辑、后台零写入/清理mocks、Chrome155字段拒绝和旧键保留；用户确认本任务Chrome人工验收通过 |
| 导入错误 | 指出条目和字段，失败不替换原配置、不显示成功；有效导入仍降级出口并清空绑定 | 后台mocks、Options维护源VM及Chrome155实际文件导入失败且配置保持；用户确认Chrome人工验收通过 |
| Unicode/同名另存 | UUID 非空唯一，两个中文同名方案均保存，失败重试不重复添加 | 纯逻辑/Options VM及Chrome155保存/重载、500ms响应延迟下确认/取消/遮罩/保存/字体重置保护；用户确认Chrome人工验收通过 |
| Popup 偏移 | 按目标 IANA timezone/日期显示，含 DST 和半小时时区 | 纯函数/VM覆盖DST；Chrome155扩展Popup文档目标/半小时/空/非法保存显示通过；用户确认真实action popup人工验收通过 |

实际命令及结果见 [VG-008 执行证据](../../.trellis/tasks/10-15-vg-008-config-profile-ui/implement.md)。本地交付时停在 review；用户于 2026-10-15 明确确认 Chrome 人工验收全部通过，manifest 更新为 done、Trellis 为 completed，见[人工验收](../../.trellis/tasks/10-15-vg-008-config-profile-ui/implement.md#人工验收)。确认覆盖真实 Popup 时区偏移、中文同名保存后重载、非法 Profile 导入保留原配置及另存期间并发保护；未提供人工浏览器版本、截图或逐项日志，保留本节其他缺口。Node/VM/mock、此前自动化 smoke 与用户人工确认分别记录，不推断 Chrome119、跨窗口或真实迁移中断恢复通过。

## VG-009 范围校准与最早脚本证据

2026-10-15用户明确将VG-009校准为R3注入时序验收，依赖done的VG-006/007/008。A09原Geolocation/Permissions契约缺口保留，不因时序fixture覆盖语言/时区而推断位置/权限已验收。A05/A06仅补首个inline的具体证据，不代表完整注入/跨源/导航授权矩阵通过。

fixture在每个文档自己的head首个inline script同步记录language/languages/locale/timezone/固定日期offset，load回调保存独立快照；扩展报告另采postLoad实际值并分别比较。top、same-origin iframe、srcdoc、先创建about:blank再document.write四种场景各有行。about:blank写入后Chrome可继承父文档URL；该场景不表示所有空白帧生命周期已验收。MAIN没有预期参数，ISOLATED有效origin无法确定时UNKNOWN，生产页面无新增marker。

实际Chrome版本、重复次数、原始/伪装值对照、阶段结果及退出码见[VG-009执行记录](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)；任务状态只读取manifest；本地交付时停在review，当前人工确认见本节末尾。首次真实Chrome155三次导航确认earliest及load回调仍为原始值，后续postLoad补充证据以执行记录最终节为准。该FAIL不得用Node/VM、dry-run或postLoad通过掩盖。

VG-009最终候选：本地144/144、源码/测试类型/build/dry-run通过；真实Chrome155.0.8059.40三次同loader文档导航、同run报告/渲染/保存一致，12/12 earliest原始（FAIL）、11/12 load原始、12/12 postLoad伪装（PASS），无UNKNOWN，监测页无Runtime exception。逐轮计数32/40/0、37/35/0、32/40/0，退出1。正式[JSON](../../.trellis/tasks/10-15-vg-009-earliest-inline/chrome-evidence.json)及执行记录保留竞态；本地交付时为review；当前状态依据下述用户人工验收确认。不扩大为Chrome119、冷启动/重启或跨源/sandbox完整时序通过。

2026-10-15，用户明确确认VG-009 Chrome人工验收通过，三阶段证据与报告一致，并接受首脚本异步注入竞态仍为已知限制，见[人工验收](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md#人工验收)。manifest为done，Trellis为completed；done仅表示验收能力及证据交付完成，不表示竞态已修复。正式自动化FAIL、退出1及原始JSON保留；用户此次未提供浏览器版本、截图或逐项日志，不与此前Chrome155自动化环境混同，不扩大现有覆盖边界，不启动后续任务。

## VG-010 首次安装与安全默认

本任务校准为 R3、依赖 VG-009 done。fresh/upgrade/reset 的数据与行为定义见 [配置指南](../../CONFIG_GUIDE.md#首次配置升级与重置) 与 [设计](../../.trellis/tasks/10-15-vg-010-safe-onboarding/design.md)。已有 v2 不套用新默认；reset 明确清空并安全关闭。引导无独立持久化进度，复用 verified 确认事务和配置队列。Node/VM/dry-run 不是 Chrome，通过状态与实际命令见 [执行证据](../../.trellis/tasks/10-15-vg-010-safe-onboarding/implement.md)；本地交付时人工验收 pending，当前用户确认见下文。未实施 VG-011～014。

VG-010 最终本地151/151、源码/测试类型/build/dry-run通过；Chrome155两个临时profile完成fresh关闭/空规则/default、引导确认绑定与postLoad、跳过/reset、旧实现v2跨测试版本更新（同ID、缺标记仍逐字段保留、strict实际控制），正式[JSON](../../.trellis/tasks/10-15-vg-010-safe-onboarding/chrome-evidence.json)为PASS。主动provider由CDP发出前拦截，未检验外部服务可用性；真实action Popup、Chrome119和全生命周期未覆盖。最终独立复核未确认新阻断；本地交付时人工验收pending、manifest为review，当前结论见下文。

2026-10-15 用户明确确认 VG-010 Chrome 人工验收通过，全新安装、已有 v2 升级、引导启用、跳过和重置均符合预期，见[人工验收记录](../../.trellis/tasks/10-15-vg-010-safe-onboarding/implement.md#人工验收)。manifest 当前为 done，Trellis 为 completed；本节前文关于真实 action Popup 等未覆盖的描述属于此前自动化证据范围，不代表本次用户没有执行相关操作，也不据概括确认补写未提供的可选步骤结果。本次用户未提供浏览器版本、截图或逐项日志；Chrome119/其他浏览器、完整生命周期及 VG009 首 inline 竞态等缺口保持。不启动 VG011～014 或其他任务。

## VG-011 范围校准与负向证据

用户于 2026-10-15 明确指定 VG-011 为 R3 runtime 模块化设计与可行性验证，依赖已 done 的 VG-010。更新同一 manifest；原 A11 迁移完整性缺口继续保留，不创建第二套任务状态。VG-012 原事务范围与状态未改，RFC 中的文件级清单仅是后续提案，不启动实施。

A15 的真实 Chrome 最小编译/注入机制通过，但 smoke 整体 FAIL、退出 1：Chrome155.0.8059.40 中旧 documentId 的生成函数及独立手写 control 都执行到了导航替换文档。A05/A06 因此新增该版本/模式的实测负向缺口；不推断生产已复现，也不推断 Chromium 内部根因。正式 [Chrome JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/chrome-evidence.json)、失败诊断与完整门禁见 [执行记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md)。生产 runtime、后台授权与 manifest 保持，人工验收 pending。

### VG-011 documentId 专项调查补充

2026-10-15 用户授权先调查、保持 review。新增[报告](./document-id-investigation.md)与[脱敏证据](../../.trellis/tasks/10-15-vg-011-runtime-modularization/document-targeting-evidence.json)：无打包器且断开 CDP 的原生探针仍错投；真实生产 content sender/原后台函数在受控导航窗口将旧语言 payload 应用到 resolver 判定 nonmatch 的 loopback 新 origin。禁用 BFCache 后两层均拒绝旧 ID；对应 Chromium155 源码支持文档身份经 frame ID 重新解析而丢失的根因。原文“生产未复现/内部根因未知”属于初次 spike 证据边界，本补充更新 A05/A06 的具体结论，不据此补齐其他生命周期或自然竞态频率。生产代码/权限不变，VG-011 仍 review，VG-012 未启动。

### VG-011 已授权安全暂停（本地交付记录）

后续用户明确接受功能代价并授权：后台在可信 sender 校验后、payload 读取/派发之前拒绝所有页面伪装，注销旧初始化脚本；语言/时区/位置/Canvas/worker 暂停，DNR/WebRTC 独立实际报告。schema、storage、消息动作、manifest/权限/resolver 不变。此处更新前述“未修复生产”的阶段状态，原始 spike/调查 FAIL 原样保留。

真实 Chrome155 定向安全闸门 PASS：BFCache 恢复 pageshow.persisted=true、跨 origin 新文档、同 URL 重载均生产派发 0，top/iframe API 原生；真实 worker 停止/唤醒、保存/同签名重试不能绕过，旧注册已撤销，Options/Popup 暂停可见。独立运行的 native-only 对照仍错投、documentTargetSafety=FAIL，浏览器并未修复。详见[调查与实施](./document-id-investigation.md)及[正式 JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/safety-gate-evidence.json)。新闸门不撤销已执行 hook，旧 BFCache 文档需关闭并重建。本地完整门禁与独立复核结果见任务 implement；VG-011 保持 review，VG-012 不启动。

### VG-011 安全暂停人工验收

2026-10-15 用户明确确认安全暂停人工验收通过；manifest 当前 done、Trellis completed，见[人工验收记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md#人工验收)。本节前文 review/pending 为历史交付状态。A05/A06/A15 的证据分开解释：Chrome 原生旧 ID 错投仍 FAIL；扩展不派发 runtime 的阻断 PASS；人工确认通过的是安全暂停交付，不是完整伪装恢复或 Chrome 缺陷修复。正式 JSON 不改，不以概括确认补写浏览器版本、截图、逐项数据或其他版本/ICE/完整生命周期覆盖。VG-012 保持 planned、未启动，不提交或推送。

## VG-012 范围校准与等价证据

2026-10-15 用户明确指定 R3“按批准 RFC 实施运行时模块化”，依赖 VG-011 done；manifest 同一条目的旧出口事务计划校准，A12缺口保留待分配。前文VG-012未启动属于VG-011历史记录。本任务仅拆分维护源和构建验证，不恢复VG-011已暂停的页面派发，不实现VG-013兼容模式或后续任务。

逐项行为矩阵、真实命令、失败诊断及证据边界见 [VG-012 implement](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md)。[Chrome旧新等价](../../.trellis/tasks/10-15-vg-012-runtime-modules/chrome-evidence.json)与[正式dist安全闸门](../../.trellis/tasks/10-15-vg-012-runtime-modules/safety-gate-evidence.json)分别解释；后者复用VG-011 runner，JSON的task仍标VG-011，属于本次候选的重新执行，不能改写原任务证据。47份dist文件与任务前构建逐字节一致，无新增chunk/WAR/入口。Node/dry-run不作为Chrome证据；本地交付时人工验收pending，当前确认见下文。

2026-10-15，用户明确确认VG-012人工验收通过，范围为当前dist可加载、模块化前后行为等价、VG-011安全暂停保持，见[人工验收记录](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md#人工验收)。manifest当前done，Trellis completed；用户未提供本次浏览器版本、截图或逐项日志，既有Chrome155定向自动化与本次人工确认分别记载。原documentId错投FAIL、earliest-inline竞态及暂停下时序FAIL不改，不补足其他浏览器/广泛生命周期缺口，不授权生产恢复，不启动VG-013/014，不提交或推送。

## VG-013 范围校准

2026-10-15 用户明确指定 R3“增加时区与 Locale 兼容模式”，依赖 VG-012 done。同一 manifest 旧 R2 集成验收计划据此校准；A13 跨领域集成及 A03/A04/A05/A06/A11/A12 原缺口保留，不能从本任务推出这些领域通过。A08 本次只覆盖 strict/compatible 的默认/显式参数、Date 本地 getter、已有 Intl 构造器、top/iframe/Worker 模式传播与配置兼容。

生产 MAIN 派发仍按 VG-011 暂停；真实 Chrome 模式验证使用临时最小扩展调用当前文档，不能当生产派发恢复或 stale documentId/earliest 竞态修复。正式 dist 的配置/UI 与安全闸门分别记录。实现及实际命令见 [VG-013记录](../../.trellis/tasks/10-15-vg-013-intl-compatible/implement.md)，任务状态只读 manifest；本地结束 review，人工验收 pending。

VG-013 本地完成：170/170、源码/测试类型、build/diff/dry-run通过；真实Chrome155两模式top/iframe、ISOLATED隔离、classic/module/shared/shared-module/nested及正式dist模式保存/旧v2幂等与raw不重写通过；正式dist暂停闸门PASS、派发0。独立只读审查两项P2已修正并经主代理定向/完整门禁与Chrome复验；无第二次独立复核。本地交付时manifest/Trellis为review、人工验收pending；该阶段未覆盖真实action Popup、Chrome119/其他浏览器、完整集成和生产派发恢复，当前确认见下文。

2026-10-15，用户明确确认VG-013人工验收通过，范围为strict、compatible、旧配置迁移符合预期，VG-011生产安全暂停保持，见[人工验收记录](../../.trellis/tasks/10-15-vg-013-intl-compatible/implement.md#人工验收)。manifest当前done，Trellis completed；用户未提供本次Chrome版本、截图或逐项日志，不据概括确认补写具体子项结果，也不把此前Chrome155自动化结果当作人工版本。生产派发继续暂停，旧documentId/earliest负向证据保持；Chrome119/其他浏览器、原A13完整集成等缺口保留。VG-014不启动，不提交或推送。

## VG-021 P0-F：有限表达与安全资格分开

Chrome155.0.8059.40真实隔离实验20场景，见[报告](./registration-sequence-research.md)和[证据](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/chrome-evidence.json)：位置专属global/lexical四类文档三阶段4/4、切换1001为4/4、严格CSP1/1；重复4/32位列表仅实际01，不完整序列无hook。微任务允许在位片段前运行。原生注册的父页抢占未成功，安全性仍NOT_ESTABLISHED；页面eval正向攻击能翻转组装。storage禁用与注销间隙仍执行旧A、注销不撤销存量hook；完成后的新文档和响应头前更新对照有效。有限表达GO、安全恢复NO_GO；未覆盖完整payload、容量上限、P2/BFCache或生产runtime，不替代VG-015/017负向证据。本地交付时manifest/Trellis均review，待人工验收；用户于2026-10-15确认隔离验证验收通过并接受有限表达GO、安全恢复NO_GO及已知限制，manifest现为done、Trellis为completed，见[人工验收记录](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/implement.md#人工验收)。生产暂停保持，不启动恢复实施；任务完成不构成发布批准，不改版本、不提交、推送或发布。

## 本地分任务提交范围（2026-10-22）

本次仅按用户授权整理必要前置任务和VG-029为本地提交；不push、不发布，其他任务保持未提交。任务状态以manifest为准；旧阶段的暂停、测试数量和未提交描述保留历史含义。

- VG-028：schema v3、原生请求头、16项字体配置与维护源；DNR仅清理历史1100至2099，语言/时区保持，字体/位置/Worker生产暂停。 [执行记录](../../.trellis/tasks/10-20-vg-028-header-font-contract/implement.md)。
- VG-024：移除两项DNR权限和过渡清理；已清理VG028与旧v2跳级升级分别保留真实Chrome证据。无权限下磁盘残留状态不承诺已清除。 [执行记录](../../.trellis/tasks/10-20-vg-024-remove-dnr-permissions/implement.md)。
