# 执行记录

2026-10-15，pwd 确认仓库；分支 stabilize/VG-013；HEAD 5701b55。根 AGENTS 为唯一适用项目文件；父路径无附加文件。已读 RTK、workflow、前端目录/质量/状态合同、稳定化三入口、VG-012设计及执行/人工验收、README/PRIVACY/PERMISSIONS/package/manifest/Vite 和相关实现测试。保留大量前序未提交修改，临时任务前副本用于增量核对，不写其个人路径。

依赖 VG-012 done；manifest 旧 R2 集成条目依据本次明确授权校准为 R3 兼容模式，A13原缺口保留。13项 preflight 已在编码前输出，无需等待确认。生产 MAIN 派发保持安全暂停。

基线命令：`npm test` exit0，161 tests /161 pass /0 fail /0 skipped。无基线阻塞。



## 实现与合同

- schema v2 新增全局 intlMode，fresh/reset/旧存储缺字段均 strict；config-model 归一化、resolver校验/生成payload、storage仍唯一存储所有者。已有v2读取不重写raw配置，正常保存/完整导入导出保留模式；非法显式值拒绝。自定义环境方案只改信号，保留全局策略。
- 页面和worker共同使用 runtime-modules/intl-policy.ts；strict保持历史强制覆盖，compatible独立补locale/timeZone的省略/undefined值。显式UTC、空locale数组、继承/不可枚举属性、getter与原生异常保留；compatible resolvedOptions使用真实原生结果，format/Date locale输出同样保留显式参数。
- Date本地getter/offset/本地字符串和多参数构造继续配置时区，两模式相同；不改UTC/epoch路径。已有Intl服务构造器复用locale策略；不扩展Number/String locale方法、Intl.Locale或设备表面。
- 模式进入Worker patch source，SharedWorker同URL/type/name/credentials的不同模式不会错误复用。nested继承相同patch。重复初始化沿用原语义：既有页面值/getter不热更新，仅未来worker使用新payload；存量worker不热更新。
- 后台runtimePayloadSignature在有效语言/时区存在时纳入模式，复用现有配置串行队列/刷新欠账，相同模式重复保存幂等，无信号时模式不产生无意义页面差异。没有新事务、并发层或失败兜底。
- Popup/Options均可保存全局模式，说明一致性/兼容性取舍、Date本地getter及WebRTC独立性、无规避全部检测承诺和生产仍暂停。
- 诊断以无预期入参的MAIN函数采默认/固定en-US+UTC结果；报告分别验证默认locale/时区、NumberFormat、显式locale/时区/Date locale/format hour。top/iframe独立采样，Worker fixture只回实际值，不接受配置。缺显式证据UNKNOWN，默认PASS不掩盖显式FAIL。
- 生产VG011安全暂停保持。services只有payload语义签名增量；可信sender检查、派发前拒绝、旧脚本撤销未改。ISOLATED无模式/config桥；MAIN只在临时最小扩展测试当前documentId，不恢复生产派发。manifest、权限/host/WAR、DNR/WebRTC、verified检测确认边界、消息action、storage key、六入口和依赖均不改。

## 定向回归与失败诊断

- 首次新增 `./node_modules/.bin/tsx --test tests/intl-mode.test.ts` 在任务前实现上退出1：页面compatible仍回fr-FR/Europe/Paris、缺模式仍undefined，证明实际缺口；worker harness最初用第一个importScripts子串截断了内嵌nested函数，出现测试夹具SyntaxError，不将其声称行为回归证据。改为截取最后的顶层importScripts后，页面/序列化worker两模式均实际执行。
- 第一次实现后其他Intl断言因PluralRules('en-US')原生解析为en失败；修正测试为比较接管前原生构造器的协商结果，没有改生产实现迎合硬编码。
- 定向配置/UI/诊断/后台/模式测试69/69通过；后台新增模式变化刷新与同模式重复保存幂等，UI执行真实维护源表单/保存，诊断默认和显式独立判定。
- Chrome首次runner已完成两模式runtime，再在正式Options初始加载读到null控件，退出1；修正为DOM控件出现后再读取并重跑，最终退出0。临时profile/server均finally清理，未把首次失败算通过。

## 真实 Chrome 证据

`node --import tsx scripts/chrome-intl-smoke.mjs --output .trellis/tasks/10-15-vg-013-intl-compatible/chrome-evidence.json`：真实Chrome155.0.8059.40。临时最小扩展由同一生产facade/生成插件二次bundle，通过Chrome scripting.func/args、MAIN和当前documentId执行合成fr-FR/Europe/Paris配置；每模式使用新文档，先iframe后top检查独立性，ISOLATED保持原生；默认/显式实际格式化、Date DST、原生显式错误、其他Intl构造器、classic/module/shared/shared-module/nested均验证。另加载正式dist在Options文档保存compatible、Popup文档读回并保存strict，以及旧v2缺字段strict/重复读取/raw配置不重写。Popup为扩展文档，不是action弹出窗口人工验收。证据只留模式/布尔/场景名称/浏览器版本，不含真实API设备值、IP/坐标/个人路径/扩展或文档身份。

`node scripts/runtime-modularization/chrome-safety-gate.mjs --output .trellis/tasks/10-15-vg-013-intl-compatible/safety-gate-evidence.json`：exit0，真实Chrome155；extensionGate PASS、productionRuntimeDispatches=0。正式dist临时副本的业务worker/content与当前候选逐字一致，测试wrapper只计数/延迟可信通知；manifest权限/host/WAR相同。BFCache persisted、跨origin、同URL reload、真实service-worker重启、保存/同签名重试均不能恢复派发，旧初始化注册撤销、top/iframe API原生、Options/Popup暂停可见；DNR/WebRTC各自ok。复用VG011 runner所以JSON task仍标VG011，属于本候选重新执行，原VG011证据不改。

## 安全、隐私与回滚

无新增外部服务、生产网络请求或设备伪装；诊断新增的固定Intl/Date调用无网络，预期/模式留在扩展内存，现有run owner/TTL/导航/取消复核不变。Chrome模式smoke只请求本地fixture，无provider/真实位置/ICE/STUN。Chrome本身后台网络未全面拦截，不能宣称浏览器绝对离线。配置导出仍是用户主动未脱敏文件，原PRIVACY边界不变。

回滚仅本任务可归属增量并重建，不reset到HEAD、不清空浏览器数据、不回滚VG011暂停。schema v2旧版可读取并忽略intlMode，保存可能删除字段；兼容模式需重新选择。已执行hook不能即时撤销，旧页面/BFCache/存量worker需关闭重建；当前生产继续暂停。原stale-documentId/earliest-inline负向证据和广泛生命周期缺口保持。

未运行Chrome119/其他浏览器矩阵、真实action Popup、完整人工验收、远端CI/发布、真实provider/ICE和生产功能恢复：本次有界模式修改不授权扩大这些领域，生产恢复还需要可靠最终文档绑定及独立授权。VG014仅列为后续任务，未实施；A13集成验收仍待用户重新分配。未commit/push/merge/tag/release。


## 独立复核及修正

依据项目要求，使用 fresh critical_reviewer，只读隔离上下文。其原候选审查确认两项 P2：

1. compatible 缺省 options 返回普通对象，会继承 Object.prototype.hour 等额外属性；审查独立反例中原生调用成功而候选抛 RangeError。修正为 null-prototype 默认 options，页面/序列化 worker 回归及最终真实 Chrome 中同一反例通过，strict 保留历史路径。
2. 合法语言 fr-fr 的原生 Intl 协商返回 fr-FR，而新报告直接比较配置原文会假 FAIL。修正 NumberFormat 的默认/显式及 compatible DTF 默认 locale 预期为对应原生构造器结果；strict DTF 仍保留旧原文回报，navigator 原文比较独立。完整报告和 earliest 比较复用同一默认 locale 预期，新增回归通过。

审查另以只读内存 mock 实际确认：旧 v2 连续读取无 local set/remove，非法模式 typo/null/3 的保存/导入在 storage 读取前拒绝。未确认新的配置、Worker传播、签名或安全暂停绕过。最终五个修正路径由主代理实现并验证，没有将其自查称为第二次独立复核。Audit Bundle `20261015T043919Z-vg-013-intl-review-0c13ced2` 保存原候选diff、修正diff、写入观察和validated SUBAGENT_EXECUTION_DIGEST；1次只读审查交付已验收，无未知写入证据。模型/effort为Agent TOML配置证据，不冒称运行时遥测。

最终Chrome重验中，runtime两模式已通过，但Options保存曾因只等静态控件出现而超时；静态select默认strict早于module监听器及异步populateForm。按trellis-break-loop核对初始化调用链，将runner等待点改为loadConfig末步的WebRTC状态完成（控制级别已显示）后再编辑保存。修正只在runner，不在产品加入等待/重试或放宽校验；最终同一命令退出0。这些失败及修正均按实际原因记录，不用盲目重跑掩盖。

## 最终本地验证

| 精确命令 | 实际结果 | 边界 |
|---|---|---|
| `git diff --check` | exit0 | 跟踪diff空白；新文本另检查 |
| `npm run typecheck` | exit0；最终build内实际调用同一命令 | src静态类型 |
| `npm run typecheck:tests` | exit0 | tests及引用源码strict类型 |
| `npm test` | 最终exit0，170/170，0 fail/skip | Node/VM/mock/wiring，非Chrome |
| `npm run build` | 最终exit0，Vite5.4.21，29modules | 六入口与共享assets，静态复制13项；未手改dist |
| `npm run test:e2e:chrome -- --dry-run` | 最终exit0 | 入口/产物清单，未执行浏览器 |
| `./node_modules/.bin/tsx --test tests/intl-mode.test.ts tests/rule-list-ui.test.ts tests/diagnostic-report.test.ts tests/background-services.test.ts` | 初次实现69/69通过 | 模式、UI、诊断与配置事务定向 |
| `./node_modules/.bin/tsx --test tests/intl-mode.test.ts tests/diagnostic-report.test.ts` | 两项修正后29/29通过 | 原型污染、原生协商及三种Date locale方法真实比较 |
| `node --check scripts/chrome-intl-smoke.mjs` | exit0 | runner语法 |
| 上节两模式Chrome命令 | 最终exit0，Chrome155.0.8059.40，PASS | 真实headless隔离runtime与正式dist配置/UI，不是人工验收 |
| 上节正式dist安全闸门命令 | exit0，extensionGate PASS、派发0 | 真实Chrome；后续只改独立runtime、报告比较和runner；暂停、消息与配置事务逻辑未改，共享诊断chunk哈希随报告修正变化，最终模式smoke已确认正式dist加载/无初始化注册；复用不受影响的闸门行为证据 |

最终两模式Chrome还验证省略options在Object.prototype.hour污染下的差异：compatible正常保持配置时区，strict继续旧原生错误路径。固定语言/时区的原生错误及冬夏偏移分别检查；未把dry-run/Node VM写为真实Chrome。

## 状态、文件和清理

manifest VG-013 依据本次授权从旧planned集成条目校准为R3兼容模式，planned→in_progress→review；Trellis由工具planning→in_progress，最终review、completedAt=null、human_acceptance=pending。VG012保持done、VG014块保持不变。A13原集成缺口明确保留。

完整修改文件清单在task.json relatedFiles。仅本任务增量进入交付；前序脏工作树保留，Git暂存区为空。任务前副本、一次性日志/草稿和Chrome临时profile/server清理；正式保留两份脱敏Chrome JSON、持久化审计bundle以及忽略的dist构建候选供加载。没有生成维护树中间源码或额外发布产物。

建议commit message：`feat: add strict and compatible Intl modes (VG-013)`。不自动提交；人工验收后才可done。

工具创建的implement/check JSONL已去除_example模板，填入实际已读的目录/质量/状态合同并精确放行版本控制；共41个任务路径。审计关闭后仅完成这些索引及清单/收尾文档，无源码或浏览器验证输入变化；Bundle中的快照保留关闭时内容，Digest及其immutable inventory不修改。最终task.py validate、JSON/相对链接/空白/状态与暂存区检查通过，任务Chrome/node资源为0。

## 人工验收

2026-10-15，用户明确确认：

> VG-013 人工验收通过：strict、compatible、旧配置迁移均符合预期，VG-011 生产安全暂停保持。请将 manifest 更新为 done、Trellis 更新为 completed，并记录验收结果；不要启动 VG-014，也不要提交或推送。

依据该确认，manifest 的 VG-013 从 review 更新为 done，Trellis 从 review 更新为 completed，completedAt=2026-10-15，human_acceptance=passed。前文 review/pending/completedAt=null 是此前本地交付状态，当前验收结果以本节及 manifest 为准。

本次确认覆盖 strict、compatible、旧配置迁移和 VG-011 生产安全暂停保持。用户未提供本次人工验收的 Chrome 具体版本、截图或逐项执行日志；不把此前 Chrome155 自动化环境当成人工验收版本，不补写未提供的命令退出码、action Popup 或其他浏览器子项结果。Chrome119/其他浏览器、完整集成等既有覆盖缺口保留。

生产 MAIN 派发继续暂停；done 不表示生产伪装恢复、旧 documentId 错投或 earliest-inline 竞态修复。此前两份 Chrome JSON、自动化检查结果及只读审计 Bundle 保持原样。

本轮仅同步本任务状态、验收记录及稳定化索引。源码、测试、依赖、构建和浏览器验证输入未变化，复用已记录的170/170、源码/测试类型、build/dry-run及定向Chrome成功证据，不重复运行；另核验本轮五个路径增量、JSON/状态/日期/引用、空白及暂存区。VG-014 条目和所有其他任务保持不变；不启动后续任务，不归档，不提交或推送。
