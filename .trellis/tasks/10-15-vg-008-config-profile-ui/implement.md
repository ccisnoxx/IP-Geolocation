# VG-008 执行证据

## 基线与 preflight

2026-10-15，分支 stabilize/VG-008，提交 5701b55。已执行 pwd、git status --short、git branch --show-current、git log -1 --oneline。工作树包含 VG-000～VG-007 未提交工作及既有图标；任务前内容快照保存在系统临时目录，用于增量复核，收尾删除。

读取根及目标路径适用 AGENTS（无额外 override）、RTK、稳定化 README/manifest/矩阵、Trellis workflow/目录/质量/状态规范、依赖记录、README/PRIVACY/PERMISSIONS、package/manifest/Vite，以及完整相关模型、解析器、storage、profile、Options/Popup、后台持久化入口和测试。已向用户输出13项 preflight。没有不可消解合同冲突；按当前请求校准同一 manifest 的 VG-008 块，不实施旧 Intl/Date 范围。

基线命令 `npx tsx --test tests/config.test.ts tests/background-services.test.ts tests/rule-list-ui.test.ts tests/ui-state.test.ts tests/runtime-sync-ui.test.ts`：exit 0，49/49，0 failed/skipped。直接 tsx 合成复现：0/0、0/120、-30/0 迁移为 auto；纬度95、accuracy0、Mars/Base 方案被 validateConfig 接受；中文名称生成空 ID。源码确认同名 ID 替换和 Popup 本机 offset。

## 实施顺序

1. 标准 task.py create/start，manifest planned→in_progress。
2. 增加缺失合同回归，确认旧行为失败；实现统一校验与后台原始输入检查、零坐标迁移、UUID 和 Popup 偏移。
3. 定向测试、最低门禁、独立只读复核，检查本任务增量与临时资源。
4. 保存实际验证证据，manifest/Trellis 为 review、completedAt:null；人工验收后才可 done。

## 回归与独立审查修正

首轮新增合同回归命令 `npx tsx --test --test-name-pattern='零坐标|Profile|存量方案|目标时区' tests/config.test.ts tests/profile.test.ts tests/background-services.test.ts` 在旧实现 exit1，7项中6项按预期失败（另1项为匹配到的既有有效解析测试）：零坐标 auto、范围/重复ID/非法存量方案被接受、后台未拒绝、epoch被当当前时间。修复后相关52/52通过；补UUID/实际Options/Popup流程后定向54/54通过。

首轮完整门禁：源码类型与测试类型exit0，npm test136/136，build exit0（Vite5.4.21/30modules/13 copied items）。Chrome155.0.8059.40 临时headless profile通过三组零坐标真实storage迁移/重复读、中文同名UUID保存/页面重载、真实JSON文件导入错误且原存储保持、后台越界/accuracy拒绝、Popup文档目标时区和空值，0 Runtime exceptions。Popup作为扩展标签页打开，不是action popup人工验收。

fresh critical_reviewer 首轮确认3项缺陷：同页双击另存候选覆盖；旧存储上非法导入先迁移写入再报错；Popup保存拒绝保留旧offset且固定偏移未按IANA合同拒绝。均接受为范围内修正。审查期间全部任务候选文件集合/摘要未变，审查者只读；主代理按结论修改。

三项回归命令 `npx tsx --test --test-name-pattern='pending|Popup 实际|旧存储未初始化' tests/profile-ui.test.ts tests/background-services.test.ts`：修正前3/3预期失败（local set计数2、pending未禁用、非法时区旧offset），修正后exit0、3/3。修正：save/import原始验证移到事务读取前；另存pending按钮guard/finally恢复；Popup保存开始即计算offset，计算复用validateTimezone。追加全量证据和最终fresh复核如下。

第二次 fresh 复核确认另存pending期间关闭弹窗后普通保存会提交旧列表，独立VM复现候选/保存数[1,0]并最终丢失新方案。主代理用同页现有pending状态阻断其他完整保存，不新增队列或改变后台事务：确认/取消/主保存/底保存/重置字体禁用，遮罩关闭和saveSettings/handleResetFonts入口guard，finally恢复后才关闭成功弹窗。

`npx tsx --test --test-name-pattern='另存期间取消' tests/profile-ui.test.ts` 修正前exit1，修正后由下述11项UI测试覆盖通过；新回归同时断言取消无关闭、其他保存无提交、最终方案保留、首次失败恢复原列表及所有控件。首次UI联合检查9pass/2fail仅为旧rule-list VM夹具未提供新读取的confirmSaveProfileBtn；补齐该DOM状态后 `npx tsx --test tests/profile-ui.test.ts tests/rule-list-ui.test.ts tests/runtime-sync-ui.test.ts` exit0、11/11，生产guard不放宽。lean-mode用于选择局部最小保护机制，没有无依据升级验证范围。

## 最终实现与边界

- config-model 统一原始自定义Profile字段/ID唯一性校验。纬度[-90,90]、经度[-180,180]、有限accuracy>0、IANA时区、非空字符串ID/名称、完整语言。旧存储归一化过滤无效/重复ID，清悬空选择，不将null坐标或非法accuracy修成有效方案。配置保存/导入在读取及迁移storage前检查原始方案；错误含profile.profiles[index]与字段，非法导入不写配置/旧键。合法导入仍将出口档案降unverified/清IP-provider-verifiedAt与规则绑定，普通save仍保留当前出口档案。
- resolver以Number.isFinite判断bpg_config手工坐标，0/0、0/120、-30/0均manual，重复迁移保留数值；没有第二套matcher。Profile使用crypto.randomUUID，与Unicode/重名解耦，不在归一化/保存中重生。Options候选成功后更新，pending期间禁止重复确认及其他完整旧列表提交，失败finally恢复控件。
- Popup使用同一目标时区offset函数，按日期含DST/半小时，显式0日期为epoch；显示在保存前更新，失败/无效/固定偏移不保留旧值。IANA判定仍由config-model拥有。
- schemaVersion=2、storage键/迁移标记/持久化事务、runtime消息格式、MV3 manifest、DNR/权限/host scope保持。MAIN自包含documentId注入、ISOLATED通知、top/iframe独立授权、worker包装、privacy和其他浏览器API原生透传不变；未改runtime或设备指纹。构建配置与依赖/lockfile无本任务增量；dist只经正常build生成，共享chunk哈希变化，不直接维护产物。

## 最终验证（2026-10-15）

本地Node v24.16.0、npm11.13.0。所有最新候选检查之后生产源码/测试/依赖/构建输入未变；后续只同步记录，复用成功证据。

| 精确命令或检查 | 实际结果 | 证据范围 |
|---|---|---|
| npx tsx --test tests/config.test.ts tests/background-services.test.ts tests/rule-list-ui.test.ts tests/ui-state.test.ts tests/runtime-sync-ui.test.ts | 基线exit0，49/49 | Node/VM/mock基线，无不可区分失败 |
| npx tsx --test tests/profile.test.ts tests/profile-ui.test.ts tests/config.test.ts tests/background-services.test.ts tests/rule-list-ui.test.ts | 首次功能候选exit0，54/54 | 零坐标、原始Profile、UUID、导入/UI；后续guard修正见上文 |
| npx tsx --test --test-name-pattern='pending\|Popup 实际\|旧存储未初始化' tests/profile-ui.test.ts tests/background-services.test.ts | 修正前预期3fail，修正后exit0、3/3 | 延迟另存、旧键零set/remove、非法offset；独立复核再执行3/3通过 |
| npx tsx --test --test-name-pattern='另存期间取消' tests/profile-ui.test.ts | 最后guard修正前预期1fail；修正后由下一项执行通过 | 不同入口候选覆盖和失败恢复 |
| npx tsx --test tests/profile-ui.test.ts tests/rule-list-ui.test.ts tests/runtime-sync-ui.test.ts | 最新exit0，11/11 | pending、取消/遮罩、普通保存/字体重置、失败恢复和既有规则/同步 |
| npm run typecheck | 最新exit0 | src静态类型；build内再次成功 |
| npm run typecheck:tests | 最新exit0 | strict测试类型 |
| npm test | 最新exit0，139/139，0fail/skip/cancel | Node/VM/mock/静态/既有门禁；不冒充Chrome |
| npm run build | 最新exit0；Vite5.4.21，30modules，13copied items | 六入口、CSS、共享chunks/静态资源完整输出 |
| git diff --check | exit0；最终记录同步后再次通过 | tracked whitespace；23个本任务文件另做whitespace/个人路径检查 |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-15-vg-008-config-profile-ui | exit0，implement/check各3条 | 标准有效context引用 |
| Ruby/Psych manifest YAML与依赖检查、本地文档链接目标检查 | exit0 | R2、依赖VG001/VG005 done、文本/路径可恢复 |
| node "$VG008_TMP/chrome-profile-smoke.mjs" | 最新exit0，Chrome155.0.8059.40，PASS，0Runtime exceptions | 真实Chrome临时profile定向，见下文；实际系统临时目录用变量脱敏 |
| work-plan plan/validate/guard-dispatch/summary/digest/audit-finalize/audit-verify | exit0，无异常/未知写入/残留worker | 当前任务正式审计Bundle，不代表人工验收 |

### Chrome定向证据

临时脚本复用scripts/chrome-diagnostic-smoke.mjs的当前CDP连接/等待/清理方式，读取真实Chrome协议确认Extensions.loadUnpacked，加载最新dist，操作真实Options/Popup文档与临时chrome.storage。没有启动完整诊断、provider、STUN或普通站点请求；CDP使用localhost，配置全为合成值。使用独立profile，不接触用户日常Chrome。

最新覆盖：三组零坐标旧键迁移及重复读取；中文同名方案不同UUID、保存与页面重载后两项均存在；实际DOM文件输入导入非法timezone JSON，alert含条目/字段且storage保持；后台越界latitude/longitude/accuracy拒绝；未初始化bpg_config非法导入原键完整保持；Popup目标时区（纽约当前offset、上海、半小时时区）、空值与非法保存清空offset。延迟真实后台保存响应回调500ms，重复确认、取消、遮罩、主/底保存与字体重置期间只产生一次setSiteConfig请求，方案保留，结束后控件恢复。没有截图/trace/精确个人数据留存。

Popup在真实扩展标签页打开，未自动打开action popup；DST春秋切换的明确日期来自Node/VM测试，不能称为真实浏览器时钟切换验收。人工Chrome验收pending；不是dry-run。测试脚本/profile与内容快照收尾删除，只保留本记录结果和正式审计Bundle。

### 独立复核与审计

三次fresh critical_reviewer均只读：前两次确认4条具体缺陷，全部由主代理修正并取得回归失败→通过证据；最后专注同页pending/错误恢复，没有确认新问题。审查期间候选文件集合/内容稳定，无审查者写入。SUBAGENT_EXECUTION_DIGEST由工具校验生成，3个审查交付验收通过，不能解读为VG-008人工验收。audit_id为20261014T171813Z-vg-008-config-profile-review-070e7ab9，closed/verified，无异常，保留90天。

## 幂等、并发、恢复与回滚

已有ID不重生；合法零坐标重复迁移保持。同页另存pending禁止冲突提交，失败不添加候选且恢复操作。后台原串行persist/reconcile和local失败恢复不变；非法原始输入在其前拒绝，包括未初始化旧storage。已有v2读取只过滤有效结果，不额外破坏性重写原始Profile；下一次显式保存才持久化有效结果。

回滚只撤销VG-008的23文件增量，共享文件按任务前快照/补丁归属恢复，保留前序修改与用户图标；不reset/clean、不清Chrome用户数据或重写历史。已迁移成功的v2不会自动回退旧键；源码回滚不构成数据降级工具。跨窗口/其他既有事务冲突和实际storage中断恢复未扩大实施。

## 隐私、未执行与已知限制

无新增生产依赖、网络请求、权限或页面桥；UUID/Intl纯本地。未检测真实公网出口，未请求外部provider/STUN/托管诊断；仓库仅相对路径/合成位置，无真实IP、个人路径、凭据或精确个人位置。未执行npm ci（已有锁定依赖可用且未改依赖）、聚合npm run check（子门禁最新均已实际运行）、Chrome完整E2E/dry-run/浏览器矩阵（定向真实页面及当前改动的纯逻辑证据足够，不重复无关场景）、远端Actions/发布或设备API/frame/worker重新验收（这些边界未改变且本次无发布授权）。Chrome119、真实action popup、人工UI、真实版本升级/中断恢复、跨窗口编辑仍未验证；旧非法Profile被排除有效配置的兼容收紧已在指南说明。

## 状态与后续

manifest仅VG-008 planned→in_progress→review；Trellis planning→in_progress→review，completedAt:null，human_acceptance:pending。依赖仍done，其他任务块逐字保持，不把既有历史归档当当前验收。后续只列VG-009～VG-014及矩阵待分配的Intl/Date等原缺口，不实施。

修改文件见task.json的relatedFiles（23项）：6个生产源、5个测试、6个治理/指南文件、6个标准任务文件。最终增量检查保护223个非本任务的任务前文件；暂存区为空。正式dist保留为人工验收候选，依赖缓存与90天受控审计Bundle保留；无task浏览器/server/端口，系统临时脚本/快照全部删除。没有commit、push、merge、tag、发布或归档。建议commit message：`fix: validate profiles and stabilize config UI (VG-008)`。

## 人工验收

验收日期：2026-10-15；验收人：用户。用户在本会话明确确认：

> VG-008 的 Chrome 人工验收已全部通过。请将状态从 review 更新为 done，并同步 manifest 和 Trellis 验收记录；不启动后续任务，不提交、push、merge、打 tag 或发布。

本次确认对应此前提供的四组 Chrome 人工验收步骤：真实工具栏 Popup 的目标时区偏移与非法输入；中文同名方案保存、页面刷新和扩展重载；非法 Profile 导入错误且原配置保持；另存期间重复确认、取消/遮罩、普通保存和字体重置的并发保护及完成后恢复。依据用户明确的“全部通过”确认记为 passed，不编造逐项日志。

用户未提供本次人工验收的 Chrome 版本、截图或逐步日志；此前 Chrome155.0.8059.40 自动化定向 smoke 保持独立证据，不能据此推断人工环境。此次确认不扩大为 Chrome119、完整 DST 浏览器时钟切换、跨窗口冲突、真实版本升级/迁移中断恢复、原 A08 Intl/Date 注入/跨 realm 或其他未覆盖领域通过。

当前状态以 manifest 为准：VG-008 review→done；Trellis review→completed，completedAt:2026-10-15，人工验收结果 passed。本文件前文的 review、pending、completedAt:null 和未执行人工验收是本地实现交付时的历史状态，由本节记录当前结论。

本轮只同步 manifest、Trellis task.json/本执行记录、稳定化 README 和验收矩阵。没有源码、测试、依赖、构建或运行时变化，复用前文已通过的源码/测试类型、139/139测试、构建及 Chrome 定向证据；本轮未重新执行这些检查或浏览器验收。未调用 archive/finish，不暂存、提交、push、merge、打 tag、发布或启动后续任务。

本轮记录校验：git diff --check、标准 Trellis context 校验、JSON/YAML 状态/日期/证据链接、Markdown 本地链接和空白检查通过；只改变上述5个记录文件，其他文件及其他 manifest 任务块保持原内容，HEAD/分支/暂存区保持。本轮未创建临时文件或后台资源。
