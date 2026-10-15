# VG-003 执行证据

## 基线

2026-10-14；分支 stabilize/VG-003；提交 5701b55。已有 VG-000～VG-002 未提交改动和图标，保留。根 AGENTS 是目标路径唯一项目 AGENTS；已读取 Trellis 工作流、前端目录/质量/状态规范、稳定化文档、README/PRIVACY/PERMISSIONS、构建配置及相关实现/测试。以已安装 @types/chrome 的 InjectionTarget/InjectionResult 核对 documentIds 与 documentId API。

精确基线命令：`npx tsx --test tests/background-services.test.ts tests/diagnostic.test.ts tests/extension-wiring.test.ts tests/leak-test-observation.test.ts`，38/38 通过，无失败。

## 实施计划

1. 建立内存 run 和诊断采集/比较合同，接入受信任报告 actions。
2. 增加扩展报告入口和 hosted/localhost/已有 tab 工作流。
3. 增加生命周期/比较/隐私测试与 Chrome 定向验收入口。
4. 独立只读复核、实际验证、文档与状态同步至 review。

## 最终实现

- 扩展 launcher 打开 diagnostic/report.html。报告支持固定 hosted、可选 localhost 端口及已有 HTTP(S) tab 选择；不自动加规则、不申请权限。
- diagnostic-runs 作为唯一 run 状态所有者，后台 getSiteConfig/config-resolver 提供配置事实。最小预期值、随机 run ID、两分钟 TTL、ready/running、报告 owner tab/document 与目标 top documentId 仅内存。一次消费，重复执行拒绝；后台终止后失效。结束/过期/取消/导航/关闭删除敏感状态，少量有上限的终态仅含原因/owner。
- MAIN 自包含实际采集无预期参数，ISOLATED 文档身份与同文档设备参考；header fetch 从目标同源 /headers.json 发出，no-referrer/omit credentials/禁止重定向/五秒超时。Chrome policy 实际状态和 ICE 独立报告；IPv4/IPv6 地址仅窗口内去重后归纳数量，无地址快照。
- 临时 iframe 仅固定同源 observation URL，无 run/config 参数；子帧独立通过 documentId 和现有 resolver 授权。采样前重读配置，交付及清理后校验子帧 config/URL/document；未授权、来源未知及缺失观测 UNKNOWN。classic/module/SharedWorker 使用已有同源 fixtures。
- 比较只在扩展报告页，language/languages/header/timezone/locale/固定 Date 示例/位置和精度/权限/policy/ICE/realm/透传分别显示 PASS/FAIL/UNKNOWN。时区别名同一原生 Intl 规范化；位置按随机半径比较；空 ICE 为 UNKNOWN。设备参考只证明当次 MAIN/ISOLATED 观测，不新增任何伪装。
- 每次异步采样后检查状态；取消/过期及时拒绝 execute，已派发的页面采样依赖自身有界超时收尾，不再启动下一阶段。旧文档采集或清理先失败于 onUpdated 时，统一用可信 tab/ISOLATED identity 分类为 navigated/target_closed，否则保留 injection_failed；不透出网页异常文本。
- ChromeSetting 既有 length 猜测完成缺陷由真实 Chrome 暴露，移除微任务提前成功分支，只等待回调/Promise，保留异步 lastError。未改变 WebRTC 模式映射、权限或策略生命周期范围。
- 成功响应前后台已消费 run，报告释放 active；后续本地 TTL/清除不依赖后台仍存在。页面只在内存/扩展 DOM 展示，离开/清除/TTL 释放。报告无 WAR，无诊断持久化或导出。

## 回归与故障分类

1. 初始定向 25/26：tsx keepNames 产生 __name，VM 序列化测试失败。改用维护源普通 TS 编译后的自包含函数；Vite 实际输出及真实 Chrome 注入随后通过，不向注入函数补隐藏外部依赖。
2. 首次 Chrome smoke 因 WebRTC policy UNKNOWN 失败。新增零 length 异步 callback 回归先得到 actualPolicy=null 的预期失败；修复权威 API 包装后，异步成功/lastError 与 Chrome 实际 policy 通过。
3. 独立复核发现子帧撤销后使用旧配置采样、有效时区别名假 FAIL；修复并增加 before/after 子帧撤销/覆盖和别名等价回归。mock 配置需按 Chrome storage 语义返回独立快照，避免测试自己修改首次配置引用。
4. 第二轮复核重放 MAIN pass-through 等待期间取消/撤销仍启动 actual 的反例。增加 await check，独立重放调用数为 0，定向测试通过。
5. Chrome UI 导航附加检查曾超时，精确状态是 injection_failed；Chrome 可先拒绝旧 document executeScript 再送事件。增加可信导航分类，后续独立复核指出 cleanup 同根路径，统一 failureCode 并覆盖 actual/cleanup 两种交错。
6. Chrome virtual time 未触发报告定时清除，不能算 TTL 通过。停止扩展 Emulation 调试，最终 smoke 激活临时报告 tab 并等待实际两分钟生产定时器；该项最终通过。
7. 真实报告脚本 VM 回归确认：消费后保留 active 会在后台重启时把本地过期提示覆盖为 missing。测试先失败、成功 render 后释放 active 的修复使其通过。
8. 一次会话中断导致旧 unified exec ID 不可恢复，进程核查已结束、无遗留 Chrome/Node；未推断遗失调用通过。最终 Chrome 输出另存任务临时日志并取得明确 exit 0。

## 最终验证（2026-10-14）

| 精确命令 | 实际结果 | 边界 |
|---|---|---|
| `npx tsx --test tests/background-services.test.ts tests/diagnostic.test.ts tests/extension-wiring.test.ts tests/leak-test-observation.test.ts` | 基线 38/38，exit 0 | Node/VM/mock/静态 |
| `npx tsx --test tests/diagnostic-report-ui.test.ts tests/diagnostic-report.test.ts tests/webrtc.test.ts` | 最后局部 22/22，exit 0 | owner/TTL/撤销/异步/比较/真实页面脚本 VM |
| `npm run typecheck` | exit 0；最新 build 再调用同一 typecheck 并通过 | src 静态类型 |
| `npm test` | 最终 96/96，0 fail/skipped，exit 0 | Node/VM/mock/wiring；不是 Chrome 验收 |
| `npm run build` | 最新候选 exit 0，Vite 5.4.21，29 modules、13 copied items | 六入口和共享 assets chunks、静态资源 |
| `npm run test:e2e:chrome -- --dry-run` | 最新构建后 exit 0，检查 report HTML/JS/CSS 存在并列出人工清单 | 不安装扩展、不执行浏览器断言 |
| `node scripts/chrome-diagnostic-smoke.mjs` | 最终 exit 0，Chrome/155.0.8059.40，41 PASS / 1 UNKNOWN / 0 FAIL，report Runtime exceptions=0 | 实际 Chrome headless、独立临时 profile、合成配置与 localhost |
| `git diff --check` | 已执行通过；最终文档收尾再核对 | tracked whitespace；新文件另外检查 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-003-diagnostic-report` | exit 0，implement/check 各 3 个有效引用 | Trellis context 格式 |

真实 Chrome 验证包括报告页身份/非空/交互、未 allowlist 拒绝、MAIN language/languages/locale/timezone/Date/geolocation/watch、普通 origin Accept-Language echo、privacy policy 与控制权、同源 iframe、经典/module/SharedWorker、MAIN/ISOLATED 透传、目标 URL/DOM/request/Referer 无额外预期坐标、临时 iframe 清理、API 与 UI 导航、取消与晚到响应、后台时钟推进后的 expired 拒绝、实际等待两分钟后的报告 DOM 清除。唯一 UNKNOWN 为零 ICE，不把无候选判 PASS。Chrome 输出只保存浏览器版本、状态、行数和场景，无候选 IP、实际个人坐标或用户 profile 路径。

已查看一次实际 Chrome 报告截图，目标选择、按钮、说明、summary 和行结果正常显示，无空白/覆盖/裁切证据；截图为本任务临时复核资源，交付前删除。只记录 Runtime exceptions=0，没有把它扩充为所有 Chrome console warn 均为零。

## 合同与交付边界

schema v2、配置/迁移/storage key、正常 content initialize message、verified 档案、DNR、MV3 manifest/权限/host scope与现有 runtime 伪装不变。新增报告管理 actions，所有入口受精确扩展报告文档校验；service-worker 监听 tab 更新/关闭使 run 失效。Vite 增加第六个 report 入口与静态 HTML/CSS，共享 chunks 仍须完整交付。没有生产依赖。未修改外部 observation 页面或 localhost echo 服务，因为它们已满足实际观测合同。

外部流量仅目标页面/同源 header/iframe/worker 的正常请求和既有 Google STUN；这些 origin 能看到正常出口和浏览器实际请求头。未运行真实出口定位 provider、未部署 hosted 文件或扩展。synthetic 坐标只在临时配置和扩展报告比较中，网络、目标 DOM 与 URL 无额外预期载体。实际 API 的可见伪装值不是额外预期配置桥。

回滚：仅反向本任务可识别补丁并重建 dist，保留 VG-002 的不传预期边界；无数据迁移、Git reset/clean、远端操作。失败之后重建 run/刷新目标即可恢复，不复用过期证据；并发 prepare 只保留同报告最新请求。

## 未运行与已知限制

- hosted 在线端到端、远端 fixture 部署、CSP/跨源/blank/srcdoc origin fallback、嵌套/service worker、host 权限撤回矩阵、后台广泛重启、真人原生位置与公网 IP ICE 等未做完整 Chrome 验收。hosted/localhost URL 与拒绝逻辑有本地证据；本次真实 Chrome 为 localhost，同源 fixtures。
- 后台过期的 Chrome 负例使用受信任 service-worker Date.now 推进；报告清除另用实际两分钟定时器，不把前者当真实墙钟等待。权限/执行失败、目标关闭、子帧撤销与过期晚到等更多反例是 Node/mock/VM，不能扩充为真实 Chrome。
- report 完成后后台已释放；对结果保存仅限当前扩展 DOM 的 TTL。MAIN 值可被页面干预，PASS只证明当次可观测行。设备透传不是完整启用前基线；空 ICE 保持 UNKNOWN。
- 用户人工验收尚未完成，状态只能 review，不标 done。A03完整 DNR 生命周期已从旧 VG-003 计划中移出，仍待用户重新分配；不自动启动后续任务。

## 独立复核与审计

首次 critical 复核发现 3 项，第二次复核关闭原问题并发现采样间隙/清理分类；全部按实际反例修正。普通 reviewer 的局部收尾派发因 run 异步生命周期属于 critical 角色返回 ROLE_MISMATCH，只完成角色适配检查，不算正确性复核通过；随后以 fresh critical 重派相同有限范围。最终独立结论与 audit digest 在收尾补充，不以自查替代独立复核。

Audit ID：20261014T093009Z-vg-003-diagnostic-review-a9a5e238。审计是仓库外持久化交付，不是临时资源；模型/推理字段来自 Agent TOML 配置而非运行时遥测。节点测试、Chrome、独立审查和用户人工验收分别记录。

## 最终独立结论、状态与清理

最终 critical 收尾复核未确认新问题：采集/清理/最终 check 共用可信 failureCode，旧文档不能交付报告；完成后 active 释放、本地 TTL 不依赖后台 run。该审查者报告执行了两个现有定向回归与18项内存反例；属于其 Node/mock/VM 审查证据摘要，不是主代理重复执行或真实 Chrome，范围仅最后两个合同。

四阶段审计 plan/summary/digest 已生成；audit-finalize 与 audit-verify passed，closed。唯一异常是一次普通 reviewer 的 ROLE_MISMATCH，已以 fresh critical 重派并通过；审计的“独立复核”计数包含该派发，不能表示四次正确性审查都完成。审查任务 accepted 也不等于用户人工验收 done。没有未执行 ready task、残留活跃 worker 或未知写入证据；最后五文件审查窗口 SHA 对比未变，既有工作与本任务增量实际 diff 已核对。

manifest VG-003 planned → in_progress → review；Trellis planning → in_progress → review，completedAt=null，human_acceptance=pending。依赖 VG-002 保持 done；未启动后续任务、归档、提交、push、merge、tag 或发布。task.json 记录本任务33个文件（包含6个任务记录），与整个脏工作树区分；既有图标与VG-000～002改动继续保留。

真实 Chrome 进程、临时 profile 和 localhost server 均由smoke finally释放，收尾查询无任务进程/临时profile。基线副本、一次性调试脚本、临时截图、日志和源快照仅在系统临时目录，最终状态核对后删除；dist 保留为生成交付，仓库外关闭审计保留为正式证据。

建议 commit message：`feat(diagnostics): add trusted extension reports (VG-003)`。

## 人工验收

验收日期：2026-10-14。验收人：用户。用户在本会话明确确认：

> VG-003 的 Chrome 人工验收已通过，hosted、localhost、导航、取消和过期场景均符合预期。请将状态从 review 更新为 done，并同步 manifest 和 Trellis 验收记录，不启动后续任务。

| 用户确认的 Chrome 场景 | 结果 |
|---|---|
| hosted | 人工验收通过，符合预期 |
| localhost | 人工验收通过，符合预期 |
| 导航 | 人工验收通过，符合预期 |
| 取消 | 人工验收通过，符合预期 |
| 过期 | 人工验收通过，符合预期 |

用户未提供此次人工验收的具体 Chrome 版本、截图或逐项报告行数。此前 Chrome/155.0.8059.40、41 PASS / 1 UNKNOWN 的记录属于代理定向自动化 smoke，不作为用户此次环境或逐项结果。五场景确认不扩充为完整 CSP、跨源/origin fallback、广泛重启、权限或 DNR 生命周期验收。

根据本次确认，manifest 的 VG-003 从 `review` 更新为 `done`，添加验收人、日期和本节证据引用；Trellis 按仓库映射从 `review` 更新为 `completed`，`completedAt` 为 `2026-10-14`，`meta.validation.human_acceptance` 为 `passed`。上文 review/pending 及未完成人工验收的描述保留为交付时的历史记录，当前验收结论以本节和 manifest 为准。同步稳定化 README 和验收矩阵 A02b。

此次只更新状态与验收文档，源码、测试、依赖、构建配置和运行时输入没有变化；复用上文已通过的 typecheck、96/96 Node 测试、build、Chrome dry-run 与真实 Chrome 定向 smoke 证据，不重复运行这些检查。

本次收尾核对（2026-10-14）：`git diff --check` exit 0；`python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-003-diagnostic-report` exit 0，implement/check 各 3 个有效引用。Python 对更新前后快照的校验通过：五个目标文件无尾随空格；task.json 可解析；状态、日期、五场景和证据锚点一致；其他 manifest 任务块逐字未变；其他 198 个仓库文件的集合与内容摘要未变。实际增量 diff 已核对，只涉及本次五个状态与验收文件。

依赖 VG-002 保持 `done`，VG-004 至 VG-014 保持 `planned`。未启动后续任务；没有归档、提交、推送、合并、tag 或发布。既有工作树改动继续保留。
