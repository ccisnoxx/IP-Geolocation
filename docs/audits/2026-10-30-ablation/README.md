# 逐项消融记录（2026-10-30）

本轮以进入任务时的 dirty 工作区为基线，不将此前删除重复计入。完整字节备份位于本机临时目录 `vanishgeo-ablation-20261030-m0yg_pqy/baseline.zip`；本目录保存基线状态、SHA-256、已有 diff 与本轮涉及文件的删除前副本。旧 `2026-10-30-p1-bridge-cleanup/` 归档与 `REVIEW-P1-BRIDGE.md` 不改写。

已读取用户提供的全局 AGENTS.md 和 `/Users/sc/.codex/RTK.md`。仓库及其父目录没有额外 AGENTS.md，维护目录也没有子目录规则。最新依据为 `REVIEW-P1-BRIDGE.md` 的遗留清理追加记录、旧归档的独立审查、647 项门禁及两版浏览器 168 项普通回归；这些是历史证据，本轮执行结果另记。

## 候选与验证设计

按结构收益及风险排序：A 收敛并发所有者，风险为中等，需覆盖失败恢复；B 删除两个无额外合同的转发层，风险低；C 缩短纯调试状态的生命周期，风险低；D 收益仅为少一次检查，边界差异值得保留。开始编辑前，当前代码 build（含 typecheck）、lint、核心覆盖率门禁均通过；原测试和有效断言保留。

| 候选 | 删除假设与最小方案 | 必须保留的合同 | 验证及决策 |
| --- | --- | --- | --- |
| A 注册的第二条 Promise 队列 | `registerSpoofContentScripts` 私有且仅由 `applyRuntimeSideEffects` 调用，后者仅由 `applyConfigNow` 调用；唯一入口 `applyConfig` 已经通过 `applyChain` 串行化且等待整次注册。去掉 `registerInFlight` 和纯排队包装，保留原 async 注册实现 | 并发应用按顺序执行；失败向调用者传播，后续应用可恢复；Duplicate ID 转 update、存在项 update、空规则注销均保留 | 先对原代码增加延迟注册/排队/失败恢复行为测试，再消融；定向测试、核心门禁、真实 frames/BFCache/cold-save |
| B 两个无独立合同的转发函数 | 将 `markDocumentInjected` 与 `noteDocumentInjected` 合为保留同名接口的一份实现；将 `upsertDomainRule` 直接命名为 `setDomainRuleEnabled`，`addDomainRule` 仍传 true | 可选 documentId 的 no-op、账本 session 恢复/容量/幂等；规则创建/修改、frozen no-op、保存后重载、域名错误均保留 | injection-idempotency、router、真实 frames/opaque 恢复与清除 |
| C `RuntimeState.debug` | 该字段只在 `applySpoof` 开始赋值、末尾读取，uninstall 仅清零；改为同一位置求值的局部常量，去掉跨调用初始化/清理状态 | 每次 payload 自己决定是否输出调试日志，clear 不输出 applied；其他 runtime 状态不变 | 构建、注入相关测试；浏览器 frames/workers/baked-clear |
| D 内容桥重复 hostname 检查 | 初始假设两次判断完全相同，尝试只删除拉取回调中的检查。独立复核指出 `deliver` 对显式 clear 有例外，等价前提不完整 | 保留原拉取路径先拒绝异域 hostname 的行为，保留 clear 特例所在的其他投递路径 | 撤回：一次性 Node 替身响应组合 `{ clear: true, hostname: 'parent.localhost' }`，原代码1/1通过，候选0/1失败（多投递一次），恢复后1/1通过；content 文件已逐字恢复。当前后台不生成该组合，不宣称真实网页可触发 |

## 已调查并决定保留

- `applyChain`、注册 Duplicate ID 恢复、缓存代际与种子守卫：分别维护跨副作用串行化、浏览器重载注册恢复和保存竞态，不能因另一条队列多余而连带删除。
- 注入账本、两个有界父链集合、文档自持凭证及 ACK：承担同文档安装、导航缺失、SW 重启、淘汰/满额下恢复的不同合同；不是重复配置状态。
- `getPayloadForUrl` 的公开一参包装与内部带 override 的 builder：两者参数合同不同，不直接暴露内部 override 能力。
- DNR 导出的 `lastLocation` 参数：实现已经不依赖定位，但现有测试/调用合同仍接受该参数；本轮不以改写合同换取删参。
- 各层 normalize/校验、安装标志及描述符恢复：涉及原始配置、存储旧数据、页面可变原型或反复安装边界；尚无等价删除证据。
- content 的 referrer 地址提示与旧无 hostname payload：已有兼容要求；本轮不改变支持版本或兼容语义。

## 结果

保留 A/B/C，撤回 D。没有删除或放宽原有测试；新增一个注册排队/失败恢复用例，在删除队列前先通过。A 定向77/77，B 117/117，C 70/70；D 的普通定向77/77未发现区别，但独立复核加差异反例否定了完全等价假设。反例仅在本地 Node 的原有替身 harness 中执行，没有真实浏览器攻击握手。

中间四项候选通过完整648项门禁与185项普通浏览器检查（168项两版核心回归、14项Workers、3轮cold-save）；这些运行的原始文件名为 `final-*`，属于撤回D之前的候选，不能冒充最终三项包。撤回后的门禁、产物指纹和浏览器记录采用 `accepted-*` 命名。

最终代码修改仅为 `src/background/services.ts`、`src/injected/runtime.ts`；测试仅在 `tests/injection-idempotency.test.ts` 新增一个用例。结构收益为去掉一个重复的 Promise 队列及其包装/不可达缺省分支、两个纯转发函数、一个不需要跨调用保存的 debug 字段；没有新增抽象、依赖、配置或替代状态，没有改权限、最低版本、存储键或失败合同。不主张运行性能提升。

TypeScript AST 核对：原测试文件76条顶层语句全部逐字保留，当前77条，仅增加1条；services 中另外45个函数逐字不变，两个重命名/合并后的函数主体与原实现逐字一致。基线267个路径中264个逐字不变，另外3个为上述明确路径；原暂存 diff 未变。`content-bridge.ts` 和整个旧证据归档已保持原始字节。详见 `structure-verification.json`、`preservation.json` 和 `accepted.patch`。

| 最终检查 | 实际结果 |
| --- | --- |
| Node v24.16.0，build（含 typecheck）、lint、diff whitespace | 全部退出码0 |
| 完整测试及核心覆盖率门禁 | 648/648；失败/取消/跳过均0；指定八文件分支89.35%，每文件至少85% |
| 横幅渲染校验 | 退出码0；该输入在撤回D前后未变，复用同一次成功结果 |
| Chrome119.0.6045.105 / 155.0.8059.86 frames | 各19/19 |
| 两版 BFCache | 各11/11 |
| 两版 opaque-recovery | 各33/33，含真实SW重启、505文档淘汰、10MB配额拒绝后的更新/恢复/clear |
| 两版 bridge/frozen baked-clear | 各21/21，临时构建包，保留原清除/冻结合同 |
| Chrome155 Workers / cold-save | 14/14 / 3轮全通过 |
| Chrome155 debug 行为对照 | 基线5/5、最终5/5；普通扩展UI消息切换 false→true→false→true→总关，验证日志、时区更新和clear |

最终十次项目 smoke 合计185/185，另加最终 debug 5/5；没有把基线debug或中间候选重复计入最终结果。所有普通构建检查期间，46个dist文件的指纹均保持一致。没有基线门禁失败或最终新增门禁失败；唯一预期失败是已撤回D的一次性差异反例，原失败日志保留，没有删断言或改预期。

独立只读审查核对了实际候选、调用链、错误传播及最终A/B/C子集，没有确认最终子集新增的可行动缺陷；范围与D反馈记录于 `review.md`。审查者未运行浏览器或重审完整安全协议。

## 证据、清理与覆盖边界

- `checks/` 保存基线、逐批定向、中间候选、最终门禁/浏览器及反例的原始日志；`verification-summary.json` 汇总实际退出码和覆盖范围。`accepted-browser.json` 保存十次最终项目smoke，`accepted-opaque-recovery-{119,155}.json` 保存原始运行身份/生命周期/配额观察。
- `before/`、`candidate.patch`、`accepted.patch` 区分本轮前、包含D的中间候选和最终保留项；`git-diff.patch` 是进入任务时已有差异，不是本轮成果。`probes/` 是本地一次性对照材料，不进入项目编译/测试入口；其绝对路径保留当时环境，不承诺跨机器直接运行。
- 核心覆盖率只统计项目配置的八文件，不包含 runtime、blob resolver 或凭证codec；分母因删除分支改变，89.35%不能作为安全覆盖提升的证据。
- 浏览器均为本任务临时隔离profile，未读写日常浏览器配置；结束后核对无本任务浏览器进程，再删除本轮runtime临时目录。没有暂存、提交、推送、合并或发布。
- filesystem在裸浏览器/扩展环境中仍被浏览器拒绝，拒绝对照不等于文档内生命周期覆盖；frozen opaque首脚本值、真实日常profile、跨版本升级、完整Chrome119 API兼容及完整Node22 CI/发布门禁未执行。
- 原MAIN握手/载荷认证P1继续开放；没有运行真实攻击复现。父链首次建key即满额、未持已ACK凭证且父边已缺失、跨源/SOP不可读链等既有边界不在本轮解决；普通功能与只读审查不构成安全或发布验收。

本目录新增材料均为本地未提交证据。可在本目录运行 `shasum -a 256 -c SHA256SUMS` 核对完整性；校验清单不递归包含自身。

普通功能通过不代表安全或发布验收，原 MAIN 消息桥认证 P1 保持开放。
