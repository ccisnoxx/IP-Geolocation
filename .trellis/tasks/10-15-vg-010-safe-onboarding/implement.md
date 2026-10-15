# 执行证据

## Preflight 与基线（2026-10-15）

已执行 pwd、git status --short、git branch --show-current、git log -1 --oneline。分支 stabilize/VG-010，HEAD 5701b55 feat: add explicit exit location profiles。工作树已有 VG000-009 大量改动及图标，任务前已在系统临时目录保存内容快照用于增量审查与保留核对；不把本机路径写入仓库。

读取根 AGENTS/RTK、适用路径（无额外 AGENTS/override）、稳定化 README/manifest/矩阵、Trellis workflow/有效前端规范及 VG-008/009 记录、README/PRIVACY/PERMISSIONS/package/manifest/Vite 和本任务实现/测试。按用户要求输出13项 preflight 后继续，不等待确认。

基线精确命令：`npx tsx --test tests/config.test.ts tests/background-services.test.ts tests/webrtc.test.ts tests/ui-state.test.ts tests/runtime-sync-ui.test.ts tests/extension-wiring.test.ts`；exit 0，73/73 pass，0 fail/skip。源码显示空存储生成开启总开关/13规则/strict；初始化不联网已有 mock 证据。v2 空规则缺标记会被补回默认规则。无阻塞性基线失败。

任务使用标准 task.py create/start；manifest 仅校准 VG010 为 R3、依赖 VG009、planned→in_progress。实现/最终验证/独立复核及人工验收状态待后续追加。

## 实现与最终合同

- config-model.createInitialConfig 明确 fresh/reset 的 master=false、rules=[]、WebRTC=default；历史 DEFAULT_CONFIG/normalizeConfig 缺省继续兼容升级。config-resolver 按已知配置键/标记存在性区分 fresh 与 upgrade，v2 空规则不再触发历史修补。
- storage 对已有 v2 仅补初始化标记，不重写原配置；新建/旧格式迁移继续一次 local.set 写配置与标记。没有 schemaVersion 或 storage key 变化，没有迁移回滚数据格式要求。
- install 且当前安全空配置才打开已有 Options；update、startup、worker 唤醒只对账，不使用事件覆盖配置。引导无第二份配置/进度，状态由配置与同步报告派生。
- completeOnboarding 在当前后台事务队列读取 verified 档案并验证站点/明确 WebRTC 选择；router 要求 confirmed=true。选择站点保留已有 ID、改为继承并绑定出口；全局位置/时区切 auto，清旧手工字段，保留历史/其他规则/其他信号/环境方案。总开关启用会恢复其他启用规则，UI 已明说。
- skipOnboarding 设置 master=false/WebRTC=default，保留已保存内容；reset 明确确认后清全部配置/规则/方案/出口/历史并安全关闭，先清候选、代际拒绝旧网络响应。选择清空以避免重置后误用旧出口；下载文件与外部站点数据不删除。
- Popup/Options 共用未配置、部分配置、已配置关闭、已启用投影；同步状态独立，saved/partial 不当作全部生效。无 MAIN/ISOLATED、top/iframe、worker 或未接管 API 的新接管；动态 allowlist、documentId、DNR 算法、privacy控制、权限与host scope保持。manifest、types/schema、Vite入口、package/lockfile无VG010增量，无新依赖。

## 定向验证、独立审查与修正

首轮定向命令 `npx tsx --test tests/config.test.ts tests/background-services.test.ts tests/ui-state.test.ts tests/onboarding-ui.test.ts tests/runtime-sync-ui.test.ts tests/rule-list-ui.test.ts tests/profile-ui.test.ts tests/extension-wiring.test.ts`：82/82 pass，exit0。`npm run typecheck:tests` 同时通过。

第一次 fresh critical_reviewer 找到两项 P2：getWebRtcConfig.state.config 的局部结构被当完整配置投影；以及旧 manual 值在引导切 auto 后被普通表单保存恢复。均已修正。UI mock 改用真实 WebRTC 响应；新增后台真实引导→Popup/Options维护源populate/read→普通后台save回归，以与旧手工值不同的合成出口证明持续 auto。首次新回归因 history.label 为 undefined 与省略字段的夹具断言差异失败，补显式合成标签后通过，不是生产代码失败或既有基线失败。

修正后命令 `npx tsx --test tests/background-services.test.ts tests/onboarding-ui.test.ts tests/runtime-sync-ui.test.ts`：39/39 pass，exit0。最终第二位 fresh critical_reviewer 未确认新增阻断，另执行9项定向Node/VM测试通过；未独立运行Chrome。审查期间 src/tests 内容保持，审查未观察到写入。只读审查交付验收不等于任务人工验收。

持久化 SUBAGENT_EXECUTION_DIGEST 已生成且 audit-finalize/audit-verify 通过：audit_id `20261015T014001Z-vg-010-safe-onboarding-bcd4c378`，2次 fresh critical_reviewer，2份审查交付验收、2次独立只读复核，closed/verified、无异常，按高风险保留90天。模型/档位为Agent TOML配置证据；不当作运行时遥测。

## 最终本地门禁（2026-10-15）

| 实际命令 | 结果 | 层级 |
|---|---|---|
| git diff --check | exit0，记录同步后再执行 | whitespace；新文件另检查 |
| npm run typecheck | 在最新 npm run build 内实际执行，exit0 | src静态类型；复用成功证据 |
| npm run typecheck:tests | 最新exit0 | strict测试类型 |
| npm test | exit0，151/151 pass，0 fail/skip/cancel | Node/VM/mock/静态，不替代Chrome |
| npm run build | 最新exit0，Vite5.4.21、30 modules、13 copied items | 六入口/共享chunks；dist仅由构建生成 |
| npm run test:e2e:chrome -- --dry-run | exit0，列出VG010清单 | 只检查入口/清单，不执行Chrome |
| node --check scripts/chrome-onboarding-smoke.mjs | exit0 | Node脚本语法 |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-15-vg-010-safe-onboarding | exit0，implement/check各3条 | 标准context |

上述最终源码/测试证据在独立复核和Chrome脚本调试期间输入未变，未重复完整门禁。没有运行远端CI、发布、旧任务完整诊断/STUN、worker全套或无关浏览器矩阵。

## 真实Chrome fresh / upgrade smoke

正式结果 [chrome-evidence.json](chrome-evidence.json)：真实Chrome155.0.8059.40、Node24.16.0/npm11.13.0，两个独立临时headless profile，联合smoke exit0/PASS。公开记录不保存本机临时绝对路径；以下命令用变量表示实际参数：

`node scripts/chrome-onboarding-smoke.mjs --upgrade-from "$VG010_OLD_DIST" --output "$VG010_EVIDENCE"`

VG010_OLD_DIST 为实施前保存的真实dist副本（VG009后的旧实现），VG010_EVIDENCE 为系统临时JSON；通过后逐字复制到本任务正式JSON。旧/新测试副本的manifest版本分别为2.0.9/2.1.1，仓库/dist manifest仍为2.1.0。通过 Extensions.loadUnpacked 同目录更新，确认扩展ID保持、Chrome实际加载2.1.1。

- fresh：自动打开Options；总开关false、空规则、WebRTC default且本扩展未控制、无动态content/DNR规则；未勾选不启用，跳过仍关闭；Popup文档为未配置（380×600模拟视口，无水平溢出）。
- 主动引导：真实点击检测、确认/prompt并选档案/localhost，勾选启用；后台原检测/确认事务建立verified并绑定。WebRTC按显式default保持，脚本仅localhost注册；普通fixture的postLoad时区来自合成出口。reset之后再次安全关闭并清空档案/规则。
- provider：fresh/upgrade自动请求计数均0；主动点击仅1次，由CDP在请求发出前拦截并返回合成响应（保留IP网段与0/0合成坐标），未联系真实provider。系统Chrome自身网络不属于该断言，不声称全网络审计或真实provider可用性通过。
- upgrade：旧实现真实storage写入已存在v2，含开启/strict、规则、verified出口及自定义方案，故意缺旧初始化标记；更新后逐字段完整保留，无自动Options；实际Chrome strict值disable_non_proxied_udp且controlled_by_this_extension。Node另外覆盖开关×3策略×空/非空规则的12种v2组合。
- 两个profile被监测的Runtime exception均0。JSON只含状态/计数/版本/边界说明，无IP、坐标、配置副本、URL、个人路径或凭据。

探索脚本先修正普通tab默认宽度并明确设置Popup文档380×600；其后runtime.reload方式使远程加载扩展原ID不可访问，不能把新worker调试会话缺失判作配置失败。使用trellis-break-loop收窄到实际页面身份/manifest/ID后，改同目录加载接口更新。JSON.stringify的键顺序哈希曾误判Chrome storage对象顺序变化，改逐字段deepEqual后定向upgrade通过；最终联合smoke重跑并增加实际strict控制验证，最终PASS。探索失败不覆盖或替代正式证据。

## 安全、恢复与回滚

生产外部请求仍只有用户点击原provider检测链；安装/升级/打开UI/跳过/对账无新外部请求，确认现存档案不重新联网。没有页面可控payload/配置桥、第二域名匹配器、verified身份来源或新设备伪装面。reset只修改扩展自身local/session并按既有副作用路径清策略/脚本/规则；刷新页面仍可产生站点正常请求。

配置修改继续既有串行事务、DNR容量预检、session预写与saved/partial恢复；失败不抹掉已保存desired state，不吞错误。重复引导保留规则ID且不重复刷新，reset后的旧候选无法确认/发布；候选清理失败拒绝reset，清理成功但后续local写失败保持显式错误/旧配置，已清候选需重新检测。

回滚仅撤VG010增量并重建dist，保留任务前已有全部成果，不reset/clean历史。schema v2可被旧实现读取；旧版fresh/reset默认行为也会回来，缺标记的空规则可能再被旧代码修补。代码回退不能恢复用户明确reset删除的数据；需要备份时由用户妥善管理完整导出（含敏感字段），本任务未导出真实数据。

## 人工验收、限制与未运行

人工验收pending。未操作真实工具栏action Popup、未做用户有头完整引导/真实外网provider检测、Chrome119/其他浏览器、完整浏览器冷启动/迁移中断/跨窗口冲突/全部privacy故障矩阵；原因是本任务已有针对实际变化的Node、真实Chrome临时profile与只读复核证据，不将这些窄证据扩展为广泛通过。reset清候选失败/清候选后local失败只做异常传播审查并复用既有local失败测试，未单独故障注入两种组合。

VG009首inline竞态继续存在，postLoad生效不代表首脚本已修复。引导没有独立持久化进度，重新打开根据保存配置显示；管理页普通完整保存的既有跨窗口覆盖模型未重构，完整事务竞争归VG012/集成任务独立授权。没有推送/提交/merge/tag/Release/远端设置更改，也不启动后续任务。

## 状态与交付

manifest仅VG010校准范围/依赖并planned→in_progress→review；VG009仍done，其他任务块逐字保持。Trellis planning→in_progress→review，completedAt:null、human_acceptance:pending。无归档。

完整修改文件清单见task.json relatedFiles；正式Chrome JSON是交付证据而保留。dist为人工验收构建候选、被忽略；审计Bundle按90天策略保留。系统临时快照/旧dist/探索JSON与Chrome profile/server在最终核对后删除，保留全部用户及前序任务成果。

人工建议：构建并重载dist；用空配置验证关闭/default/无站点与跳过；主动检测确认后选一个测试站点、明确启用；检查实际同步与目标刷新；用已有v2备份的独立profile验证升级不覆盖；确认reset清空语义。真实出口数据仅在个人浏览器查看，不附入仓库。

后续仅列：VG011旧配置迁移/导入导出、VG012出口事务、VG013集成验收、VG014发布门禁，以及单独授权的同步注入时序方案；本次不实施。

建议commit message：feat: add safe install defaults and onboarding (VG-010)

最终收尾核验：git status --short已检查，37文件清单（28个既有文件增量、9个新交付文件）与task.json一致；其余229个任务前已清点文件内容保持、其他manifest任务块逐字保持、src/tests与最终独立复核候选一致，暂存区为空。YAML/JSON状态、标准context、空白及新文件个人路径检查通过；任务Chrome profile进程残留为0。系统临时快照/旧dist/探索JSON已删除；正式JSON、忽略的dist验收候选及90天审计Bundle按前述理由保留。


## 人工验收

验收日期：2026-10-15；验收人：用户。用户在本会话明确确认：

> VG-010 的 Chrome 人工验收已通过，全新安装、已有 v2 升级、引导启用、跳过和重置均符合预期。请将 manifest 更新为 done，并同步 Trellis 人工验收记录；不启动后续任务，不提交、push、merge、打 tag 或发布。

依据此确认，将五个流程的 Chrome 人工验收记为 passed：全新安装的安全默认值、已有 v2 升级保留、主动引导启用、跳过关闭和重置清空均符合预期。manifest 从 review 更新为 done；Trellis 从 review 更新为 completed，completedAt:2026-10-15，人工验收证据指向本节。本文件前文 review、pending、completedAt:null 及未执行人工验收的表述，均为本地交付时的历史状态，当前结论以本节及 manifest 为准。

用户未提供本次人工验收的 Chrome 版本、截图或逐项日志，不编造这些信息，也不据概括确认推断全部可选检查均已执行。此前 Chrome155.0.8059.40 临时 profile 自动化 smoke、合成 provider 拦截、Popup 扩展文档/模拟视口证据与本次用户人工确认分别记录；正式 chrome-evidence.json 保持原样。不将本次确认扩大为 Chrome119/其他浏览器、完整冷启动/中断/并发/外部 provider 矩阵已验收。VG009 首 inline 异步注入竞态及其他任务既有缺口继续保留。

本轮仅同步 docs/stabilization/task-manifest.yaml、docs/stabilization/README.md、docs/stabilization/acceptance-matrix.md、本任务 task.json 与本文件五个记录文件；源码、测试、脚本、依赖、构建配置和正式 Chrome JSON 未变。复用此前已记录的151/151、源码/测试类型、build/dry-run及已保存的 Chrome 自动化证据，本轮不重新运行这些门禁或浏览器验收。

收尾验证：git diff --check、标准 Trellis context、JSON/YAML 状态/日期/依赖/证据引用、修改文件空白及本地 Markdown 文件链接检查通过。仅上述五个记录文件变化；其他文件、manifest 其他任务块、分支、HEAD 与暂存区保持。没有创建临时文件或后台资源，没有归档或启动后续任务，也没有暂存、提交、push、merge、打 tag、发布或修改远端设置。
