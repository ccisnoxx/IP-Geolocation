# VG-006 执行证据

2026-10-14，分支 stabilize/VG-006，基线 5701b55。已运行 pwd、git status --short、git branch --show-current、git log -1 --oneline；大量前序未提交改动及图标保留。已读取适用 AGENTS/RTK、workflow、目录/质量/状态规范、稳定化 README/manifest/矩阵、VG-005 验收记录和相关代码/测试/公开文档。仅根 AGENTS 适用，未发现下级 override。

按用户本次请求校准旧 VG-006 iframe 计划为 R2 reconciliation，依赖 VG-005 done；旧 A06 缺口保留。标准 task.py create 建立记录，manifest planned→in_progress；已输出13项 preflight，不等待确认。

基线精确命令：`npx tsx --test tests/background-services.test.ts tests/dnr.test.ts tests/webrtc.test.ts tests/rule-list-ui.test.ts tests/extension-wiring.test.ts`，exit 0，41/41。没有阻塞性基线失败。

实施：主代理持有实现；候选完成后独立只读 critical_reviewer 复核 session/保存中断、串行化、失败传播与 API/UI 合同。最终命令/结果与已知缺口在交付前追加。公开记录只使用相对路径。

## 实现与契约

新增 RuntimeSyncReport：配置摘要、contentScripts/dnr/webrtc/tabReload 的 ok/failed/partial、固定错误，以及 metadataError/提交后清理 warning。所有配置修改返回 {config,syncReport}；消息保持 config 字段并新增 saved:true，完整同步为 status:ok，否则 partial；新增仅扩展管理页可调用的 reconcileRuntime。读取管理配置也返回同一队列内的配置和报告。Popup/Options 常驻状态及重试按钮，保存/导入/重置/确认等都读取报告，错误有可见反馈。

services 的配置修改、初始化、候选最终发布/确认/取消/清理使用串行队列；网络检测在队列外。对账直接读取实际 Chrome registration/dynamic rules/privacy，不信任 metadata 充当实际状态。脚本 update 替换不留 unregister 间隙，DNR 只改1100–2099，WebRTC 检查支持/控制权和实际状态。default/禁用以 own clear 确认允许同一签名跳过，不能由被遮蔽的 effective 状态推断释放。

配置仍是 local siteSpoofConfig/schema v2，config-model/resolver 和匹配未改。storage 新增 session runtimeSyncMetadata：版本、SHA-256、四组件状态/固定错误、tab ID/URL 摘要、预写旧摘要欠账及已确认候选待清理 ID。无第二份配置、原始 URL/IP/坐标或 API 原始错误；不进入导出。旧 metadata 在浏览器/扩展会话结束时清空；无迁移或权限扩大。

保存前 validateConfig、DNR托管ID/regex/dynamic/unsafe/旧Chromecombined-session额度及tab快照/恢复记录预写；这些准备失败拒绝写入。local 写失败恢复旧记录；已保存后不回滚配置。副作用全收敛后四并发刷新，单 tab 失败为 partial，失败欠账跨worker/后续保存保留，关闭/导航目标剔除；每批 checkpoint。API ack 后checkpoint前的极窄中断允许一次重复刷新（至少一次）。worker顶层、onInstalled/onStartup及管理页读/重试共用路径，没有alarm。

源码为src，未直接改dist。manifest、权限/host scope、package/lock、Vite入口、config模型/解析器、content/runtime均与开始快照相同。更新隐私、配置指南、权限用途、状态spec和同一稳定化清单；保留旧iframe矩阵缺口，不启动后续任务。

## 验证与修正历史

- 基线41/41通过。首次完整检查 source/test typecheck通过，116项中113通过/3失败：新增DNR夹具没有启用语言，两项未生成规则；WebRTC夹具未声明本扩展控制，却要求clear。修正夹具后DNR/WebRTC9/9通过，后台/UI29/29通过。
- 预写新签名可能在local之前中断，因此增加previous旧摘要欠账；定向分别模拟local写前/写后的恢复。后续深拷贝storage mock模拟Chrome序列化边界。
- 首次独立critical_reviewer发现WebRTC遮蔽下跳过clear和confirm提交后候选remove丢失saved结果。主代理修复并补37/37定向。遮蔽回归在旧实现实跑预期失败（clears=0而期望1）；修正后通过。候选提交后remove失败保留saved/partial，待清理ID恢复，同一检测ID不重复创建。
- SHA-256等待造成正常并发reload完成顺序变动；旧重检测试偶尔返回[3,1]而期望[1,3]。真实合同是目标集合及四并发，不承诺完成顺序；改为集合排序比较，37/37及strict测试类型通过。
- 第二fresh独立审查发现确定性ID与导入降级交错的碰撞反例，最终守卫与验证在后续追加。

## Chrome 定向证据

用一次性 Node/CDP harness 加载本地 dist，Chrome/155.0.8059.40 headless、独立临时profile和localhost合成页面；不操作用户日常profile。命令形式为 `node "$VG006_TEMP/chrome-runtime-sync-smoke.mjs"`，VG006_TEMP仅代表本任务系统临时目录，公开记录不保存个人绝对路径。脚本基于现有chrome-diagnostic-smoke的连接/加载/清理机制，测试结束删除，不新增维护入口或依赖。

第一次harness因直接调用ES module私有loadConfig而失败，生产代码无改动；改为Page.reload和真实重试按钮后通过。修正后的候选再次真实验证通过：初始registration/DNR/privacy同步、普通origin MAIN语言随reload更新、同签名无重复修改API、四组件失败可见及恢复、单tab失败不阻断另一tab、真实ServiceWorker.stopWorker后消息唤醒恢复DNR/刷新、Popup/Options状态，管理页Runtime exception为0。

额外实际验证：临时第二个MV3 privacy扩展覆盖本扩展strict；禁用VanishGeo后清除第二扩展设置，浏览器回default且本扩展未控制，旧strict没有恢复。候选清理失败保留saved/partial、两次确认只有一个档案，恢复后候选删除通过。只用合成档案/保留文档IP，无出口provider或STUN主动调用；Chrome自身内部网络不能由此声称完全离线。两个扩展、profile/server在finally清理。

## 不变量与限制

动态allowlist、ISOLATED通知、可信sender/documentId定向MAIN、top frame/iframe/worker、设备API透传、verified后台确认和导入降级均保留。报告证明当前API观测/操作确认，不保证每个文档的MAIN hook已执行、reload页面加载完成或ICE网络防护。精确任意中断、真实Chrome119配额、浏览器完整重启/迁移、广泛iframe/worker/权限/策略矩阵和action popup原生容器尚未本次完整验收；候选碰撞守卫后的最终证据在后文补充。

回滚仅撤销VG-006可归属的35文件增量（共享文件按补丁），保留前序工作/图标及浏览器配置。旧版本可忽略session metadata；不进行破坏性迁移、Git历史操作、staging/commit/push/merge/tag/Release或外部部署。后续仅列VG-007至VG-014及待分配iframe缺口，不实施。

## 最终碰撞守卫证据

在精确已提交verified身份幂等比较后，新增新建档案ID已存在的提交前拒绝；不覆盖unverified、不追加重复ID、不删除候选。命令 `npx tsx --test --test-name-pattern='同检测 ID 碰撞' tests/background-services.test.ts` 在守卫前exit1，Missing expected rejection；守卫后 `npx tsx --test --test-name-pattern='同检测 ID 碰撞|确认已保存后的候选' tests/background-services.test.ts` exit0，2/2。

最终守卫还经一次性 `node "$VG006_TEMP/chrome-collision-smoke.mjs"` 真实Chrome155定向验证：实际确认提交后的remove失败→import降级→restore remove→同检测ID拒绝；唯一档案仍unverified，候选保留，管理页Runtime exception=0。没有重跑不受守卫影响的完整Chrome场景；上一候选的四组件/双扩展/workerstop证据只用于对应未改变路径，guard实际边界由该最新定向补齐。

## 最终验证命令（2026-10-14）

Node v24.16.0、npm11.13.0；未在独立Node20环境执行。

| 命令 | 结果 | 层级 |
|---|---|---|
| git diff --check | 最终exit0 | tracked whitespace；35任务文件另查新文件 |
| npm run typecheck | 最新npm run build内实际执行，exit0 | src静态类型 |
| npm run typecheck:tests | 最新守卫后exit0 | strict tests及引用源码 |
| npm test | 最新守卫后exit0，121/121，0 fail/skip | Node/VM/mock/静态wiring，包含深拷贝storage与故障恢复 |
| npm run build | 最新守卫后exit0，Vite5.4.21，30modules、13复制项 | 六入口及共享chunks，真实dist |
| npm run test:e2e:chrome -- --dry-run | 最新构建后exit0 | 必需产物与清单；未启动浏览器 |
| npx tsx --test tests/dnr.test.ts tests/webrtc.test.ts | 修正首次夹具后exit0，9/9 | DNR额度/托管ID和privacy API mocks |
| npx tsx --test tests/webrtc.test.ts tests/background-services.test.ts tests/runtime-sync-ui.test.ts | 修正后exit0，37/37；之后新增guard由最终121项覆盖 | 定向副作用、存储/队列/清理及两页实际脚本VM |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-006-runtime-reconciliation | 实施中exit0，implement/check各3条引用；交付前复核 | Trellis context，不代表运行时 |
| 临时Chrome runtime sync / collision harness | 两种最新对应候选均exit0，Chrome155，管理页异常0 | 临时真实Chrome/CDP/localhost，具体边界见上文 |

未执行完整npm run test:e2e:chrome人工清单、真实出口provider/STUN、全浏览器/版本矩阵、远端CI、安装升级/完整浏览器重启和任意中断故障注入。原因：不属于VG-006当前具体变更验收；本次已对实际改变的API/UI/worker边界取得定向Chrome证据，storage/额度/并发等由直接合同测试覆盖。dry-run、Node/VM不能表述为真实Chrome验收；用户人工验收仍pending。

## 文件增量与建议提交

本任务35文件：后台services/dnr/webrtc/message-router/service-worker；shared types/storage/runtime-sync；Popup/Options各ts/html/css；background-services/dnr/webrtc/extension-wiring/rule-list-ui/runtime-sync-ui测试；README/CONFIG_GUIDE/PRIVACY/PERMISSIONS、稳定化README/矩阵/manifest、state-management spec、gitignore和标准Trellis六文件。完整relatedFiles存于task.json。

建议commit message：`feat: reconcile runtime side effects and expose sync status (VG-006)`。未获提交/发布授权，不stage或commit。

## 独立审查、状态与收尾

三个fresh critical_reviewer交付均经WorkPlan/dispatch/execution/summary/digest校验：首次确认WebRTC遮蔽/提交后清理；第二次确认ID碰撞；最后一次只读复核最终守卫，未确认新增可行动问题。三次“accepted”只代表审查交付验收，不代表三轮候选都无缺陷或用户人工验收。最后审查的5个输入文件摘要未变，所有源码修正由主代理在前序审查完成后执行。无残留活跃Worker或未知写入。Bundle关闭及audit-verify通过；audit_id为20261014T145808Z-vg-006-runtime-reconciliation-2f14aa2a，保留90天。工具只提示五个额外diff/发现文件未分类，未出现完整性错误/异常。

manifest planned→in_progress→review；Trellis planning→in_progress→review，completedAt:null、human_acceptance:pending。依赖VG-005保持done，其他14任务块逐字保持初始内容。旧iframe缺口保留待分配。未调用archive/finish、staging/commit/push/merge/tag/Release或远端设置/部署。

完整35文件增量及工作树已检查；未出现新个人绝对路径、原始敏感值、无关格式或生产依赖变化。基线非本任务文件保留。任务一次性临时Chrome/CDP脚本、红灯探针、diff/内容快照均在最终结果归档后删除；临时两个扩展/profile/server已finally清理，无任务进程/端口残留。保留原ignored dist为本地可加载构建、原依赖/缓存和受控正式审计Bundle，不将其误当源码或已发布产物。

人工验收尚未完成；没有把review或自动化Chrome定向等同done。后续仅列VG-007（Worker）、VG-008（Intl/Date）、VG-009（Geolocation/Permissions）、VG-010（安装/启动）、VG-011（迁移/导入导出）、VG-012（出口事务）、VG-013（集成Chrome）、VG-014（发布）及待分配iframe边界，需分别获授权并重新检查依赖。

最终收尾核验：git diff --check exit0，task.py validate exit0，YAML/JSON review与completedAt:null一致；35任务文件的相对链接/whitespace/敏感路径检查通过，196个基线非任务文件逐字保留，其他14manifest任务块不变，暂存区为空。收窄进程查询以排除查询自身命令后，任务Chrome/Node进程为0；唯一系统临时目录已删除。仅保留ignored dist、原依赖缓存和正式审计Bundle。

## 人工验收

验收日期：2026-10-14。验收人：用户。本节记录用户明确确认；上文 review、completedAt:null 和人工验收 pending 均为实施阶段历史状态，当前状态以本节及 manifest 为准。

用户原话：

> VG-006 的人工验收已通过，四组件失败与恢复、service worker 重启重试、同签名幂等及 UI 同步状态均符合预期。请将状态从 review 更新为 done，并同步 manifest 和 Trellis 验收记录；不启动后续任务，不提交、push、打 tag 或发布。

本次确认覆盖 content scripts、DNR、WebRTC、tab reload 四组件的失败与恢复，以及 service worker 重启重试、相同配置签名幂等和 UI 同步状态。用户未提供本次验收的具体浏览器版本、截图或逐项命令，不将实施阶段 Chrome155 定向证据冒充本次人工验收环境。未扩大为完整 DNR/WebRTC ICE、iframe/worker、Chrome119、完整浏览器重启/迁移、远端 CI 或发布通过。

状态同步：`docs/stabilization/task-manifest.yaml` 中 VG-006 从 review 更新为 done，新增验收人、日期及本节证据引用；本目录 task.json 从 review 更新为 Trellis 原生 completed，completedAt 与验收日期一致，human_acceptance 为 passed。稳定化 README 和 acceptance-matrix 同步当前结果；其他任务状态保持原样。

本轮仅修改上述五个状态与证据文件，源码、测试、依赖、manifest.json、权限及构建输入保持原样；复用实施阶段已记录的类型检查、121/121 测试、build 和 Chrome dry-run 成功证据，没有重新运行或声称新增浏览器验收。保留全部前序工作，不调用 archive/finish，不提交、push、merge、打 tag、发布或启动后续任务。

本轮核验：`git diff --check` exit 0；`python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-006-runtime-reconciliation` exit 0，implement/check 各 3 条引用有效。一次性 Python/Ruby 核对 exit 0：JSON/YAML 状态、验收人、日期和证据引用一致；新增相对链接及章节锚点有效，无新增个人绝对路径或行尾空白；仅五个授权文件变化，其余 223 个文件及其他 14 个 manifest 任务块未变；HEAD、分支、tags 与空暂存区保持原样。
