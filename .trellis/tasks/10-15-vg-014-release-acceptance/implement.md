# VG-014 执行记录

2026-10-15：已读取根/父路径规则（只有根 AGENTS 适用）、RTK、Trellis workflow、前端目录/质量合同、稳定化三入口、VG-013 当前记录、README/PRIVACY/PERMISSIONS/package/manifest/Vite、RELEASE/CI/release workflows 及验收 runner。13 项 preflight 在编码前输出，见 design.md。

基线：stabilize/VG-014，HEAD 5701b55，前序工作树有大量未提交修改，323 个文件已暂存副本用于本任务增量核对。无覆盖、清理前序文件或 Git 提交。依赖 VG-001～VG-013 全部 done。

| 命令 | 结果 | 证据层级 |
|---|---|---|
| `pwd`、`git status --short`、`git branch --show-current`、`git log -1 --oneline` | 已确认当前仓库、脏工作树、分支与基线 | Git/文件状态 |
| `npm ci` | exit 0，安装 50 packages | 锁文件依赖安装，未新增/升级依赖 |
| `npm test` | exit 0，170 tests /170 pass /0 fail /0 skipped | 本任务修改前基线，Node/VM/mock/静态，非 Chrome |

任务记录通过 task.py create/start 建立；manifest planned→in_progress，按用户请求校准为 R4 集成验收。后续结果在此追加，不改写历史负向证据。

## 实现与实际变更

没有确认需要修复的 P0/P1 产品回归；生产 src、tests、构建配置、manifest、package/lock、权限和 CI/release workflow 均保持任务前字节。新增两个独立维护脚本：

- scripts/chrome-integration-smoke.mjs：真实 Chrome 正式 dist 的11组集成场景，临时 profile/server、本地.test映射、provider发出前合成拦截、拒绝原生位置、诊断隐私与实际TTL。PASS表示当前暂停合同；JSON仍保留完整伪装FAIL、ICE UNKNOWN，releaseReady=false。
- scripts/audit-release.mjs：只读核查dist/ZIP、版本、权限、入口与共享chunk、静态资源、远程可执行代码/运行期编译/map/敏感模式和ZIP逐字节一致。不是CI新增发布门禁，不声称证明所有任意秘密或计算URL不存在。

更新稳定化manifest/矩阵/README、release-readiness与README/RELEASE的证据入口及失实的runtime打包描述；.gitignore只放行本任务正式记录/JSON。public输出均仓库相对路径，未记录个人目录、真实IP、位置或凭据。

## Chrome runner 失败与诊断

1. 初次新runner onboarding通过，在disabled-rules-ui等待超时：错误复用了Options的webrtcPolicyStatus，Popup没有该控件。读取Popup实际loadConfig/populateForm路径，改等其真实runtimeSyncStatus；产品未改。
2. 第二次在重新启用规则的CDP表达式失败：JS字符串内换行未双层转义，Runtime.evaluate语法错误。改为String.raw，并用已安装TypeScript AST与Node vm.Script解析39个静态CDP表达式；无真实产品失败。
3. 此后配置/DNR/WebRTC及DNR故障恢复成功，但新runner真实worker停止后的第一次getSiteConfig在Runtime.evaluate 20秒超时。增加调用位置和协议方法证据，确认仅重启段失败；waitForDebuggerOnStart改false仍超时。调试器自动附加路径的内部原因未确定，未把它归为产品缺陷，也未延长超时/加入重试制造通过。
4. 按trellis-break-loop与lean-mode停止重复这个调试路径；新runner不重复stop/wake，采用本轮已通过的chrome-safety-gate独立证据（同候选生产worker/content字节一致、副本仅增加计数wrapper、真实停止/唤醒、重新通知、零派发）。新runner保留独有的DNR故障注入、saved/failed、实际header恢复及幂等，不从其结果推断后台重启通过。
5. 调整后完整新runner exit0，11组PASS；报告实际70行为12 PASS /54 FAIL /4 UNKNOWN，ICE UNKNOWN。54 FAIL属于生产暂停下相对伪装预期的实际不匹配，保留并阻断完整功能发布。实际两分钟TTL结束后清空报告，无晚到重新显示；provider主动合成请求1次、自动请求0，Runtime exceptions=0。
6. 产物脚本初次语法检查从错误的dist工作目录执行，MODULE_NOT_FOUND；同批误建空dist/release目录。已删除仅本任务空目录/新归档，回到根目录检查并从空归档重打包。不是build或产品失败；最终产物审查通过。

失败期间均未修改原任务证据。最终JSON是修正后的实际执行结果；上述文字保留失败经过，不把历史失败静默抹除。

## 最终验证

环境：macOS27.0.1、Darwin arm64、Nodev24.16.0、npm11.13.0、Vite5.4.21、Chrome155.0.8059.40。详细逐项矩阵、精确命令和未验证范围见 docs/stabilization/release-readiness.md；本任务完整本地门禁为：

- npm ci exit0，50 packages；npm run typecheck exit0；npm run typecheck:tests exit0。
- npm test exit0，170/170、0 fail/skip。本任务没有改变其源码/测试/依赖输入，最终复用该成功证据。
- npm run build exit0，29 modules、静态复制13项、47文件；无直接修改dist。
- npm run test:e2e:chrome -- --dry-run exit0，仅入口/清单。
- node scripts/chrome-integration-smoke.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/chrome-evidence.json 最终exit0，11场景；正式dist、localhost、合成provider、原生位置拒绝、既有STUN。
- node scripts/runtime-modularization/chrome-safety-gate.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/safety-gate-evidence.json exit0，extensionGate PASS，派发0；无provider/位置/STUN。
- node --import tsx scripts/chrome-intl-smoke.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/intl-evidence.json exit0，两模式top/iframe/五类worker、ISOLATED隔离及正式dist配置/UI通过。
- VG-012 baseline-runtime.ts.gz 解压到本任务系统临时目录，运行 node --import tsx scripts/runtime-modularization/chrome-equivalence.mjs --baseline-runtime <临时baseline-runtime.ts> --output .trellis/tasks/10-15-vg-014-release-acceptance/runtime-evidence.json exit0；合成geo/watch/permission、Canvas、反射、原生设备透传、SharedWorker身份/模块顺序、重复注入未来worker语义、严格CSP/frame等价。仅隔离runtime，不恢复生产。
- (cd dist && zip -qr ../release/vanishgeo-v2.1.0-vg014-candidate.zip .) 成功；node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.0-vg014-candidate.zip --output .trellis/tasks/10-15-vg-014-release-acceptance/artifact-evidence.json exit0，47文件/4共享chunk、全部字节相同、版本2.1.0。
- node --check scripts/chrome-integration-smoke.mjs 与 node --check scripts/audit-release.mjs exit0；独立审查 bash -n scripts/release-changelog.sh exit0。
- git diff --check exit0；新文本空白、JSON/链接/记录状态和任务增量在交付前另核验。

dist摘要36873ecb6b27a39830daa44b404fceef38eab629bfd9c0f5dbaaf631207bd3f0；ZIP摘要35e9e7b3b4bb1eed32450b7a0cdc2194ec3c7254e6da50a05b3387b358ea0b5a。产物JSON保存完整清单；Chrome集成JSON绑定同一dist摘要。复用runner的JSON task保留VG-011/012/013，它们是VG014本轮重新执行，不修改原任务JSON。

## 独立审查与证据边界

两位fresh critical_reviewer分别只读检查发布/构建/权限和诊断/配置/verified/迁移恢复。未确认新增P0/P1或足够证据的P2产品回归；文档过期描述已由主代理修正。源码、测试、workflow与构建输入相对任务前未变，审查结论适用于当前生产候选；新runner/审查器由主代理编写和实际执行，不冒称独立代理复核了这些新增脚本。

审查明确保留：tag与package/manifest没有自动一致性门禁，workflow仍在tag push后创建正式Release，必须未来人工核对批准；完整功能被安全暂停阻断。未执行远端Actions/Release、Chrome119/其他浏览器、真实action窗口、真实provider/hosted部署、真实位置及任意断电/中断/权限矩阵。真实Chrome现有证据不外推这些项。

配置schema/storage/迁移/消息/manifest/host/权限/依赖/生产构建均无变化。保持单一config-model/resolver/storage，verified仅后台检测确认，普通页面无可信配置桥，MAIN生产暂停且ISOLATED不带预期，DNR/privacy仍各自归原所有者；未扩展设备伪装。诊断正常既有STUN可能看到网络出口，证据仅保留分类，不保存原始地址。

## 状态与交付

manifest VG014 planned→in_progress→review，标题/阶段按本次明确请求校准为R4，依赖为VG001～013；Trellis由工具create/start，最终review、completedAt=null、human_acceptance=pending。未归档，不借历史done推断完整功能就绪。

本任务回滚只能撤销自己的脚本/文档/记录增量；不得reset整个脏工作树或恢复VG011前的派发。保留当前dist与release ZIP供人工复核，它们是明确交付物；临时profile/server、测试baseline解压文件、日志/任务前副本在完成增量和审计后清理。前序修改、预存release产物和两图标文件不动。

建议commit message：test: complete stabilization integration acceptance (VG-014)。实际未提交、未push、未改版本、未创建tag/Release或远端设置。建议未来2.2.0须先解决完整功能阻断并获人工批准；其他后续项只见报告，不启动。

正式审计Bundle：20261015T053615Z-vg014-integration-review-4dae141b；WorkPlan/dispatch/两项execution/Summary及SUBAGENT_EXECUTION_DIGEST由本机工具生成验证，2项独立复核交付均按实际范围验收，无未知写入观测。模型/effort仅为Agent TOML配置证据。审计位于本机私有audit根，不把个人路径写入公开记录。Bundle的关闭与完整性校验结果以本机audit-finalize/audit-verify输出为准。

最终卫生核对：任务增量共20个文件，与task.json.relatedFiles一致，暂存区为空；323个任务前文件中除明确文档增量外均保留。任务Chrome/profile进程为0，本轮临时副本、日志、解压baseline和工作目录已删除。dist与候选ZIP及正式证据是保留交付物。完整相对路径增量补丁存入本机审计Bundle，供安全回滚复核。

## 人工验收

2026-10-15，用户明确确认：“VG-014 人工验收通过，接受当前安全暂停和已知限制。”并要求将 manifest 更新为 done、同步 Trellis 验收记录，保持生产伪装暂停，不将任务完成视为发布批准，不改版本、不提交、不推送或发布。

据此 manifest 从 review 更新为 done；Trellis 从 review 更新为 completed，completedAt 为 2026-10-15，human_acceptance 为 passed。该确认接受当前安全暂停及报告中的已知限制，不表示旧 documentId 错投或 earliest-inline 竞态已修复，不改变 release_ready=false，也不授予生产恢复或发布权限。

用户未提供本次浏览器版本、截图或逐项日志；人工确认与此前 Chrome155 自动化证据分别记录。原有 FAIL/UNKNOWN、覆盖缺口、五份证据 JSON 和已关闭审计 Bundle 均保留，不重写为通过。

本次只同步状态、验收记录及当前文档摘要；生产源码、测试、脚本、配置、权限、依赖、版本、dist 和 ZIP 均未改。复用此前输入未变的 typecheck、typecheck:tests、170/170、build 和 Chrome 证据；不因状态登记重复执行这些门禁。本次检查为 git diff --check、Trellis 上下文校验、记录一致性及文件增量核对。未归档、未提交、未推送或发布，也未启动后续任务。
