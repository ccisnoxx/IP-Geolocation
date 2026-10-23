# VG-038 审计与清理证据

## 基线与范围

- 2026-10-23 开始时工作区干净，VG-037 状态为 done。
- `npm test`：295 项，293 通过、2 失败，均为 extension-wiring 中 PERMISSIONS 文本断言；保留失败测试，核实合同后修复。
- 额外开启 `--noUnusedLocals --noUnusedParameters` 的源码和测试 TypeScript 检查均通过；该结果不足以证明导出 API 已无消费者。
- `.trellis/workflow.md`、`get_context.py` 和 frontend spec 正文实际缺失；使用 AGENTS.md、当前实现及任务设计核实合同，不据失效路径推定已读规范。
- 运行时、后台及工具链由三个只读子代理分别审计；主代理负责 UI、清理及证据核验，两个实现代理分别独占 Intl/Date 与后台恢复四文件组，另由独立只读代理复核候选。

## 删除前证据

以下证据在对应删除前建立；行号以本轮修改前源码为准。三个只读子代理与主代理分别核实，检索覆盖 src、tests、build、scripts、experiments、fixtures、工作流、文档和任务记录；没有把测试自身调用误认为生产消费者。

| 编号 | 删除候选与失效证据 | 保留的有效覆盖 |
| --- | --- | --- |
| D01 | `src/shared/defaults.ts:1–11` 无模块导入者，仅旧转导出；`config-model.ts:92–117` 的 LANGUAGE_PRESETS/TIMEZONE_PRESETS 仅定义与该文件重导出，无其他引用。真实默认配置仍由 config-model 拥有。历史 VG-028 文件清单不是可执行消费者。 | config/profile/UI 的真实默认值、归一化、语言列表及时区测试均保留。 |
| D02 | `src/shared/diagnostic.ts:1–5,56–194` 的旧 header 解析及 frame/worker/geolocation snapshot helpers 仅由 `tests/diagnostic.test.ts:16–68` 四项测试调用。现行采集在 `background/diagnostic-probe.ts`，run 在 `diagnostic-runs.ts`，比较在 `shared/diagnostic-report.ts`；无构建、脚本、页面或文档消费者。删除实现后删除其专用测试，不能把它们算作现行合同的覆盖。 | `diagnostic.ts:7–54` WebRTC 分类与 snapshot 仍由 leak-test 使用，保留其测试及 locale 测试；现行 diagnostic-report 全部比较、授权、TTL、取消及采集测试保留。 |
| D03 | `background/webrtc.ts:139–143` 的 resetWebRTCPolicy 仅由 `tests/webrtc.test.ts:80` 调用，生产统一经 applyWebRTCPolicy 释放并读回。删除该 helper 与测试内两行重复调用断言，不删除整个测试。 | 同一测试 :65–78 对生产 clear、requested/actual policy 与保护状态的断言保留。 |
| D04 | `test-language.html` 无全库文件名消费者、不在 Vite/acceptance 链；:21 的 `(navigator as any)` 在原生 inline JS 中使整个脚本 SyntaxError，已用 vm.Script 复现。 | leak-test 的语言/locale 观测、injection 首读 fixture、navigator-contract 的 getter/反射测试保留。 |
| D05 | `RuntimeState.values.geolocation` 仅 types:57 声明、registry:28 初始化、geolocation-permissions:101 写入；全库无读取及动态 values 下标读取。真实交付从 :100 建立的私有 snapshot 闭包读取。 | 保留 geolocationCoordinate 及定位快照、随机坐标、权限、BFCache/退出测试。 |
| D06 | `fixtures/geolocation/top.html:72–74,128–145` 读取的 __ipGeoGeolocationController 在全库没有写入者，forced-error 按钮只产生 missing controller，不能验证定位错误。删除按钮、控制器函数、强制错误函数、唯一调用/监听和 README 覆盖承诺。 | 整页及真实 success/watch/clearWatch/error callbacks 保留；geolocation-runtime 的 timeout、权限撤销、Permissions Policy 等错误覆盖保留。 |
| D07 | runtime-build:70–71 的 disabled-document Symbol 已不来自任何运行时参数；生成器仅接受 payload。先用安装前后完整 Reflect.ownKeys 快照替换其覆盖，再移除两条旧特定 Symbol 断言；runtime-build 的 synthetic-document/worker-document 及 intl-mode 的 intl-test 额外实参不参与执行。 | 同一 disabled/null/undefined 用例检查所有全局键无变化，并继续检查 controller.update 不热更新。 |

保留完整 runtime、HTTP(S)/SharedWorker 维护 graph 和 runtime modularization spike：AGENTS 约束、构建自包含守卫、Chrome 手动脚本或 RFC 明确消费它们。`getContentScriptMatches` 虽仅单测调用，但现有用例独立覆盖多个域名边界，本轮保留该覆盖和接口，不为增加删除量而迁移测试。

## 已确认缺陷与修复责任

- F01：PERMISSIONS 文档整理后，两项 wiring 测试硬编码旧措辞而失败。现行文档的 host 范围、未申请权限及指向迁移实现记录的链接仍完整；保留两项测试，更新为当前语义并核验链接目标，而非删除门禁或恢复过时产品说明。
- F02：生产 page/Blob 共用 Intl/Date 包装器丢失 new.target，且错误放宽部分 Intl 必须 new 的合同；古年份 0–99 又被 Date.UTC 二次映射。修复两个现有 Intl 模块并增加构造/日期回归，保留 strict/compatible 行为。
- F03：初始化读取失败未撤销所属语言/时区脚本；页面注册没有 beforeChange 恢复钩子，漏掉时区 iframe 或模板升级的旧文档债。复用现有队列及 pendingPageScopeChange，保留其他命名空间及错误原因。
- F04：本地服务 decodeURIComponent 处理 `/%FF` 抛 URIError，真实请求可结束进程。仅在不可信 URL 解析边界返回 400；补实际请求后仍可继续服务的回归。
- F05：出口档案坐标格式化把 null 经 Number 强制转换成 0，错误显示已知零坐标。合法零值与缺失值分开处理，并保留既有小数精度。
- 主代理在修复 F04/F05 前执行新增回归：12 项中 2 失败，分别为 URI malformed 与 `'0' !== ''`，其余 10 项通过；随后才改实现。
- F02 修复前新增 24 项回归全部失败、原有 7 项通过；古年份字符串补充断言修复前对应 6 项失败。修复后 Intl 与 runtime-modules 定向 33/33 通过。
- F03 修复前新增/增强定向回归 17 项失败；修复后两个目标测试文件 87/87 通过。新增 page 回调还暴露同配置模板升级的 checkpoint 比较基线问题：以最近成功预写快照比较，避免最终状态恰等于启动快照时跳过收尾持久化。
- 独立复核追加发现已修复：初始化异常也撤销并读回确认所属旧 bootstrap；正常对账的旧 bootstrap 撤销失败分支先持久预写再撤既有 page 注册，继续清理其他组件并保留失败原因。追加回归修复前 10/10 失败，修复后两个后台目标文件最终 93/93 通过，不扩大命名空间。

## 验证与未解决项

- 清理、服务与 UI 定向：48/48 通过；两项原基线失败均保留并修复。定位 fixture 额外 VM 检查 success/watch/clearWatch 与 error callback 均通过；首次手工检查把原有空值显示 `-` 错认为空串，校准断言后通过，未改产品行为。
- 第一轮完整 `npm run check` 通过（330/330）；旧 bootstrap 修复定稿并停止编辑后，再执行最终完整门禁，结果如下。没有整份删除自动化测试文件，没有 skip/todo，也没有以删除测试掩盖最初的两项失败；删除的 HTML 仅为 D04 已失效的手工旧页。

| 最终检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（由 check 执行） |
| `npm run typecheck:tests` | 通过（由 check 执行） |
| `npm test` | 336/336 通过，0 失败、0 skipped、0 todo（由 check 执行） |
| `npm run build` | 通过（由 check 执行）；只修改维护源，dist 由 Vite 重建 |
| `git diff --check` | 通过 |
| `npm run test:e2e:chrome -- --dry-run` | 通过，仅构建文件与入口检查 |
| 删除符号及旧参数引用检查 | 通过；历史 runtime modularization spike 自身仍消费 synthetic-document，明确保留，未因字符串相同误删 |

- 独立只读复核确认 D01–D07 消费者与保留覆盖充分；Intl/Date 未发现阻断，额外 VM 检查 UTC/Europe/Paris、BCE、闰日、year 10000 与自定义 NewTarget 通过。旧 bootstrap 补充已完成增量复核，队列、预写、错误聚合及命名空间边界未发现剩余阻断。
- 审计实现阶段尚未运行真实 Chrome；该阶段的 Node/VM/mock、构建或 Chrome dry-run 均不代表真实 Chrome 验收。后续追加的当前源码真实 Chrome 回归见下节，历史候选 ZIP/Chrome 证据不自动覆盖本轮源代码。
- 既有 workflow/spec 引用缺失不在本轮修复；HTTP(S)/SharedWorker 暂停与既有 Blob 源核验警告未确认状态保持。
- 审计通过消费者追踪及定向行为验证收敛，未逐行证明所有大型历史 Chrome runner 都正确；未采集行覆盖率百分比，不将测试数量当作覆盖率。
- 审计实现阶段结束时，manifest 和 task.json 均为 review，等待人工验收；该阶段未提交、推送、打 tag、重建发布 ZIP 或发布。

## 追加真实 Chrome 回归

- 用户于 2026-10-23 明确授权继续实测 Intl/Date、Blob Worker、关闭配置后的注册清理和 iframe 重载提示，要求先汇总、暂不提交或推送；后续选择先汇总 Chrome138。
- 使用独立临时 profile，正常 UI 安装当前 dist 并开启 Allow User Scripts；未通过调试接口装载扩展，未在观测页面或 Worker 显式注入运行时。新增维护采集器 `scripts/chrome-audit-regression.mjs`，没有新增生产源码修改。
- Chrome for Testing 138.0.7204.183／macOS arm64 有界面实测 774/774 通过，覆盖三组语言／时区的页面首读、36 个三层 Blob Worker 入口、18 个 module 依赖首读、生命周期、Intl/Date 构造语义与古年份、注册所属范围清理和 iframe 重载 UI。独立只读复核确认原始观测与断言吻合。
- 当前 Chrome155 临时实例因电脑控制工具不能准确选中而未正常安装扩展，最终 BLOCKED；仅原生基线及 dist 不变检查，无产品断言，不计入产品通过或失败。用户选择先汇总 Chrome138 后停止补验，两个浏览器的临时 profile、进程及回环服务均已清理。
- 本轮 build、采集器语法检查和 diff 检查通过；源码／测试／构建输入摘要未变，复用上节 336/336 及类型检查证据。完整观测、构建身份、限制与原始 JSON 链接见 [真实 Chrome 回归记录](chrome-regression.md)。
- 真实 Chrome 汇总时任务恢复 review，等待人工验收；截至该次汇总未提交、推送、打 tag 或发布。

## 人工验收与本地提交范围

- 2026-10-23 用户确认 Chrome138 验收通过，要求整理审计、修复和回归记录后本地提交，明确不推送；同时要求 Chrome155 如实保留未完成项。任务按此授权转为 done，acceptance 为 accepted，允许本地提交，不允许推送、tag 或发布。
- 本次提交包含 D01–D07 的证据充分清理、F01–F05 及旧 bootstrap 恢复修复、保留和新增的有效回归、真实 Chrome 维护采集器、两份正式原始 JSON、完整任务和验收记录。没有删除失败测试掩盖 Bug，也没有把暂停维护源当作失效代码清除。
- 提交前复核源码／测试／构建输入和关键源码摘要，复用输入未变的 336/336、类型检查和构建通过证据；dist 摘要和 Chrome138 采样时一致，774 项断言及清理标记全部通过。暂存检查发现新采集器末尾多余空行，仅移除一个换行字节，并核实可精确复原采样脚本；两个摘要及关系见 Chrome 回归记录。修正后采集器语法和最终暂存 diff 检查通过，原始 JSON 未作改写。
- Chrome155 保持 BLOCKED、completed=false、无产品断言；只有原生基线及一个 dist 不变检查，不计入通过或产品失败。HTTPS、完整浏览器重启／BFCache、故障注入和完整 CSP 矩阵仍是本轮未覆盖项；既有 workflow/spec 缺失与暂停范围保持原记录。
- 不重建发布 ZIP，不更改版本，不归档其他任务；本地工具配置、缓存和首次 Chrome155 准备记录不纳入提交。正式 Chrome155 未完成证据保留在 `chrome-current-evidence.json`。
