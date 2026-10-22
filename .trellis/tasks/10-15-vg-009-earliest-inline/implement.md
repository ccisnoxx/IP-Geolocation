# VG-009 执行证据

2026-10-15，分支 stabilize/VG-009，HEAD 5701b55。已执行 pwd、git status --short、git branch --show-current、git log -1 --oneline；大量前序稳定化未提交改动与图标保留。系统临时目录快照仅用于增量复核，收尾删除。

已读取适用 AGENTS（目标路径无额外文件）、RTK、稳定化 README/manifest/完整矩阵、Trellis workflow/有效目录/质量规范、依赖任务状态与相关记录、README/PRIVACY/PERMISSIONS/package/manifest/Vite、完整诊断采集/生命周期/报告/路由/验收脚本及相关实现/测试。向用户输出13项preflight，不等待确认。

基线命令：`npx tsx --test tests/diagnostic-report.test.ts tests/diagnostic-report-ui.test.ts tests/extension-wiring.test.ts`，exit0，34/34，0fail/skip。现有采集只观察加载后，临时帧 load 后250ms，不能证明首脚本时序。无阻塞基线失败。

实施顺序：标准 task.py create/start；manifest 范围校准并 planned→in_progress；fixture/时序报告/自动Chrome；定向测试与最低门禁；实际diff、临时资源与独立复核；记录结果并 review。人工验收 pending。


## 实现摘要与合同

新增 fixtures/injection/earliest-inline.html、child.html 和 README。head首个inline同步捕获language/languages/locale/timezone、固定日期offset、readyState/scriptIndex/inline/capturedAtMs，load回调保存独立快照。srcdoc和先创建about:blank再document.write的文档执行自己的首脚本；不以父页延迟读取模拟最早时序。Chrome中document.write后空白帧URL可继承父页，frameSource只作描述标签，不能用于授权。

collectInjectionTiming是无参数自包含MAIN函数，只读fixture实际JSON，校验长度/版本/字段并仅返回规定字段，补采postLoad实际API。缺失/非法为UNKNOWN；无生产页面写入、配置桥或runtime marker。ISOLATED的URL/有效origin用于独立文档诊断解析；opaque/null来源不执行MAIN采样。生产sender逻辑不变。

新增executeInjectionTimingRun仅允许requireDiagnosticReport的精确报告文档调用。与full execute共享同一prepare run、owner/documentId/TTL/消费一次、取消、导航与配置复核及finally释放。后台不保存第二份配置，预期仍由现有resolver解析；三阶段在扩展报告独立比较，later PASS不能覆盖earliest FAIL。私有report模块导出run供本地CDP自动化返回同一次evidence/rows，不设web accessible。

自动Chrome使用Node24.16.0原生WebSocket、子进程、HTTP/CDP及现有本地server，无新dev/生产依赖。运行时读取Chrome自身协议确认Extensions.loadUnpacked，再加载最新dist。先采无规则对照，在临时扩展内部保存合成语言/手动时区（位置关闭、WebRTC default），重复导航3次。导航前启用并缓存lifecycle，以本次loaderId确认load；只取回首脚本已存值，不推迟earliest捕获。证据、比较、渲染、分类/计数/退出码来自同一次run；取消/过期/失效空返回拒绝保存。

schema/storage/key/迁移、manifest/MV3/host scope/权限、DNR、verified事务、content通知和生产runtime没有本任务增量。services/router只新增受保护时序动作接线。构建配置/package/lockfile保持任务前内容；dist只由Vite生成，现有fixtures复制覆盖新页面，私有模块导出由preserveEntrySignatures保留。MAIN/ISOLATED和top/iframe授权边界不放宽；worker/未接管浏览器API原生透传未改。

## 定向验证与审查修正

首轮定向39项中38pass/1fail，原因为新测试正则将注释中的DOMContentLoaded误作等待逻辑；strict测试类型发现新VM输出变量的控制流缩窄标注问题。按精确证据修正测试，随后39/39和strict类型通过；不是既有基线失败。

第一次Chrome探索采样发现earliest/load原始值，但尚无postLoad且about:blank写入后URL继承被误标iframe。补独立ISOLATED描述标签及postLoad后再次观测原始→伪装变化。前两次探索结果不作为最终正式证据，正式chrome-evidence.json已经由最终候选单run/loaderId脚本重新生成。

第一次fresh critical_reviewer确认自动脚本把第一次run的evidence与第二次run的rows拼接，可在初始化期间制造假PASS；还发现child.html模板裁剪误中了字符串内的body结束标签，留下可见代码文本。均已修正：report.run单次返回、渲染一致性断言；child清除残段。主代理另外修正旧文档JSON可能满足重复导航等待的问题。已有报告UI VM回归现在断言只执行一次、返回同一evidence及比较结果；真实Chrome对实际渲染与保存行逐项相等。

第二次fresh只读复核未确认新阻断，补充4个VM场景通过（正常、prepare取消、execute取消、交付时过期），对正式JSON重新调用维护源comparator核对全部rows/counts/总结果一致；这不是第二位审查者重新启动Chrome。两次审查候选期间内容集合/摘要保持，未观察到审查者写入。正式SUBAGENT_EXECUTION_DIGEST由work-plan验证生成，audit已closed/verified、无异常，audit_id=20261014T230907Z-vg-009-timing-review-d5128230，90天保留。审查交付通过不表示首脚本时序或人工验收通过。

## 最终验证（2026-10-15）

| 精确命令 | 实际结果 | 范围与限制 |
|---|---|---|
| npx tsx --test tests/diagnostic-report.test.ts tests/diagnostic-report-ui.test.ts tests/extension-wiring.test.ts | 基线34/34；最终39/39，exit0 | Node/VM/mock/静态，不代替Chrome |
| npm run typecheck | exit0；最新npm run build内再次实际执行 | src静态类型 |
| npm run typecheck:tests | 最新exit0 | strict测试类型 |
| npm test | 最新exit0，144/144，0fail/skip/cancel | 完整本地Node门禁，非Chrome |
| npm run build | 最新exit0，Vite5.4.21、30modules、13copied targets | 六入口、共享chunks、fixtures/README；未直接改dist |
| npm run test:e2e:chrome -- --dry-run | 最新exit0，明确列VG-009 fixture/自动命令/阶段语义 | 只核入口/清单，未执行浏览器 |
| npm run test:e2e:chrome -- --injection --runs=3 --output .trellis/tasks/10-15-vg-009-earliest-inline/chrome-evidence.json | exit1，真实Chrome155.0.8059.40，自动化完成，实际结果FAIL | 首脚本竞态已复现；不是harness异常，也不是浏览器通过 |
| npm run test:e2e:chrome -- --injection --runs=0 | exit2，明确拒绝runs范围，未启动Chrome | 输入错误与观测FAIL分开 |
| git diff --check | exit0 | 收尾记录同步后再校验；新文件单独检查 |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-15-vg-009-earliest-inline | exit0，implement/check各3条 | 标准任务上下文 |
| work-plan plan/validate/guard-dispatch/summary/digest/audit-finalize/audit-verify | exit0，无异常 | 2次fresh只读审查交付，不代表人验 |

最近一次build仅为将新增fixture README复制到dist，源码/测试/脚本/依赖和已测HTML未变，复用已有Node及真实Chrome证据，不重复浏览器。

## 正式真实Chrome证据

基线提交5701b55、分支stabilize/VG-009及本任务29文件未提交增量；机器版本Node24.16.0/npm11.13.0，Chrome155.0.8059.40。使用独立临时headless profile，不接触用户日常Chrome。正式原始结果见[chrome-evidence.json](chrome-evidence.json)。采样固定epoch=1768478400000；未启用对照为zh-CN、languages[zh-CN,zh]、locale zh-CN、Asia/Shanghai、offset -480；扩展内部合成预期为ja-JP、[ja-JP,ja]、locale ja-JP、Asia/Tokyo、offset -540。没有精确位置或公网IP。

| 场景 | earliest三次 | load三次 | postLoad三次 |
|---|---|---|---|
| top | 全部FAIL/original | 第1/3次FAIL/original，第2次PASS/spoofed | 全部PASS/spoofed |
| same-origin iframe | 全部FAIL/original | 全部FAIL/original | 全部PASS/spoofed |
| srcdoc | 全部FAIL/original | 全部FAIL/original | 全部PASS/spoofed |
| about:blank→document.write | 全部FAIL/original | 全部FAIL/original | 全部PASS/spoofed |

每阶段6行（capture、language、languages、locale、timezone、Date offset）；每轮4文档×3阶段×6行=72行。三轮PASS/FAIL/UNKNOWN分别32/40/0、37/35/0、32/40/0。12份earliest的五个配置字段都与未启用对照一致，capture全部证实loading/first-inline；load受调度影响（11原始、1伪装）；12份postLoad五字段均与扩展预期一致。监测的top/report Runtime exception为0。server断言所有目标请求仅为固定fixture或favicon路径，无配置query、header echo/provider/STUN请求；系统Chrome自身后台行为不由该断言扩展为全网络审计。

明确结论：当前异步document_start初始化链路没有在首个inline之前完成。仅检查DOMContentLoaded/load之后可能漏报，postLoad全PASS不能把earliest判为PASS。生产入口已injectImmediately:true；仍需消息跨界、配置读取和MAIN派发，缓存或减少一次读取不能建立同步先于页面脚本的保证。本任务未重写runtime；在长期不变量内没有可声称保证该时序的局部修复，保留这项已证实限制，后续同步方案需独立授权和设计。

## 安全、隐私、生命周期与回滚

预期不进入目标URL/DOM、cookie、站点storage或页面消息，fixture只存实际API值，生产页面无采样marker。时序入口不读精确位置、不请求外部provider/STUN，不写配置或诊断持久化；JSON仅包含选定语言/时区、固定日期offset、页面采样毫秒及判定，无run/documentID、凭据、真实个人路径或IP。输出/后台错误不吞未知状态，缺失与不可授权为UNKNOWN。

新增动作消费同一run，不可重复消费；取消/TTL/导航/owner变更使晚到结果不可交付，配置/子文档变化复核后拒绝，失败可重新prepare，不做静默fallback。无迁移或数据恢复变更。回滚只撤销本任务29文件增量并重建dist；共享文件须按VG-009补丁归属，保留VG000-008与用户图标，不reset/clean、不清用户Chrome资料、不改历史。

## 人工验收、未运行与限制

人工验收pending，未将本任务done。人工步骤：构建并重载dist；启动npm run serve:leak-test；给localhost配置有效合成语言/手动时区并关闭位置或设置合成有效位置；刷新固定fixture；从Popup/Options进入扩展报告选择对应tab，点击VG-009按钮，逐帧看三个阶段及实际/预期。真实结果应如实显示earliest失败、后阶段另判，不将红色FAIL改成通过。可运行上述自动命令并检查退出1和JSON的一致性。

未执行人工有头UI、Chrome119/其他浏览器矩阵、跨源/sandbox/广泛about:blank生命周期、冷service-worker/浏览器重启和BFCache时序故障注入；这些不由本次本地热运行重复导航证据覆盖。未重跑完整VG-003含STUN诊断或VG-007 worker smoke（生产边界未改，当前定向证据与现有本地门禁覆盖修改）；未运行出口检测、远端workflow/发布、npm ci或大版本升级。页面实际快照可能受目标页干预；配置在捕获前曾变化无法追溯，本次自动化通过先完成合成配置再重新导航控制这一前提，报告只比较当前扩展预期。

## 状态与交付

manifest仅VG-009从planned→in_progress→review，范围按本次请求为R3，依赖VG006/007/008均done。Trellis planning→in_progress→review，completedAt:null、human_acceptance:pending。其他manifest任务块逐字不变；原A09位置/权限缺口保留，未因本次范围校准启动其他任务。

修改文件全量29项见task.json relatedFiles。临时脚本/快照、Chrome profile/server/监听端口收尾清理，正式JSON是要求保存的浏览器证据而保留，dist为人工验收候选，受控审计Bundle保留90天。没有stage、commit、push、merge、tag、发布或归档。

后续仅列：经独立授权的同步注入时序方案；VG-010～VG-014按未来明确授权核对范围；矩阵中待分配的Geolocation/Permissions及其他旧领域缺口。本次均不实施。

建议commit message：test: add earliest inline Chrome acceptance evidence (VG-009)

## 候选维护源摘要

- `src/content/content.ts` SHA-256 `e9154800c27f39c229d651a5e898db0aaa018bd2ad5a02efdfa0fa74a42679d1`
- `src/injected/runtime.ts` SHA-256 `804c2b774ccc77b39c051c1b067e28a513a4416e4690ac40a648fe617a95955d`
- `src/background/services.ts` SHA-256 `9d25fcbe2ac70bccd29b548ad41868a02544b3a5cca8337bf7d1de8616abbd8a`
- `src/background/diagnostic-runs.ts` SHA-256 `8918cc9851fabbff01f41cedd87dd6b160fe62631d3c62d55d12b942b9f8f713`
- `src/background/diagnostic-probe.ts` SHA-256 `ac327f0f9188dcd5a80bc5ecb4e76e448b8eb2fcb5906f620d0d2151c170a781`
- `src/shared/diagnostic-report.ts` SHA-256 `3c35bd283c42b87627987ba2b345d19d2595aeb06e6cd8204ff1124b1d7285d6`
- `src/diagnostic/report.ts` SHA-256 `6de2ecce7ccc34b2c5dedf8279675dea30d88be09fe2ab72f13fc8d6bcee957f`
- `scripts/chrome-injection-smoke.mjs` SHA-256 `ea4828229b1c7b1816da2ad1c0cb442e8b2dc757e08c6059b4b96a9b956260c0`
- `fixtures/injection/earliest-inline.html` SHA-256 `4df43e39f67c14bb5fc309244fb38aa129241cd5286114cf694567d529790964`
- `fixtures/injection/child.html` SHA-256 `ebfcffbd92283b298265005bafe3a9beee16817a4430d43688512d6f06cabcff`

收尾核验：git status --short已检查，29项任务交付清单准确，157个非本任务既有文件内容保持、其他manifest块逐字不变，暂存区为空。新旧文件空白/敏感值/本地链接、JSON/YAML状态与标准context校验通过；最终候选与第二次独立审查摘要保持。三个真实Chrome调用均已结束，任务profile/server无残留；系统临时内容快照及探索JSON已删除，未删除任何前序任务、用户文件或依赖缓存。


## 人工验收

验收日期：2026-10-15；验收人：用户。用户在本会话明确确认：

> VG-009 的 Chrome 人工验收已通过。我确认三阶段证据与报告一致，接受首脚本异步注入竞态仍为已知限制；done 仅表示验收能力与证据交付完成，不表示竞态已修复。请将 manifest 更新为 done，并同步 Trellis 人工验收记录；不启动后续任务，不提交、push、merge、打 tag 或发布。

依据这次确认，将VG-009验收能力与证据交付的人工验收记为passed：earliest、load、postLoad三阶段证据与报告一致，接受首脚本异步注入竞态仍为已知限制。manifest从review更新为done；Trellis从review更新为completed，completedAt:2026-10-15、human_acceptance:passed。本文件前文的review、pending、completedAt:null及未执行人工验收是本地交付时的历史状态，由本节记录当前结论。

此次done仅表示本任务的验收能力及证据交付完成，不表示生产竞态已修复。正式chrome-evidence.json原样保留：真实Chrome自动验收结果FAIL、退出码1，12/12 earliest原始值、11/12 load原始值、12/12 postLoad伪装值。不能把人工验收通过改写为首脚本时序PASS，也不要求红色报告全绿。

用户未提供此次人工验收的Chrome版本、截图或逐项日志，不编造这些信息。此前Chrome155.0.8059.40临时profile自动化证据与本次用户确认分开记录；不扩大为Chrome119、冷启动/重启、跨源/sandbox/BFCache、广泛空白帧或原Geolocation/Permissions领域已验收。

本轮只同步manifest、本task.json/执行记录、稳定化README及验收矩阵五个记录文件。没有源码、测试、脚本、依赖、构建配置或正式Chrome JSON变化；复用前文已通过的源码/测试类型、144/144 Node测试、build/dry-run与已保存的真实Chrome观测，不重新运行浏览器或这些门禁。按用户授权不启动后续任务，不调用archive/finish、不暂存、提交、push、merge、打tag或发布。

本轮验收记录校验：git diff --check、标准Trellis context、JSON/YAML状态/日期/依赖/证据引用、本地Markdown链接与空白检查通过。仅上述5个记录文件变化，其他文件和manifest任务块、正式Chrome JSON、分支、HEAD及暂存区保持；已保存的候选维护源摘要核对一致。本轮未创建临时文件或后台资源，未重新执行源码/测试门禁或Chrome验收。
