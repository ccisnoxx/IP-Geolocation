# VG-032 执行记录

> 当前候选已按用户追加授权改为dynamic持久投影，最终结果见末尾“正常安装冷启动补充”。前面的session-only实现及其当时验证保留为阶段历史，不代表最终存储合同。

## 授权与依赖

2026-10-22 用户明确授权：“那就恢复必要的 DNR 权限，让 Accept-Language 也按站点和页面语言同步，先处理旧规则残留和迁移，再做真实 Chrome 验证。”本次授权取代此前仅保持原生请求头的约束，限于语言头同步及必要迁移；未授权提交、推送或发布。

实施前核对 VG-023、VG-024、VG-028 均为 done。VG-031 语言列表候选保留 review，其后续请求头授权在本任务单独记录。

## 实现与所有权

- 仅恢复 `declarativeNetRequestWithHostAccess`；host scope 和最低 Chrome 138 不变，不增加普通 DNR、Feedback、webRequest、debugger 或 optional 权限。
- 新 `header-rules.ts` 只编译、隔离、迁移和核验 DNR。配置归一化、域名与有效 payload、存储仍分别由 config-model、config-resolver、storage 所有；无单独 Accept-Language 配置。
- 新规则仅保存在 session 的 30000..39999。每个有效语言域生成导航与子资源两条规则：导航按目标域，子资源按 initiator 域（覆盖跨源资源）。更具体启用域即使关闭语言或没有有效 payload，也排除父域。
- 语言标签在配置入口按 BCP 47 校验，拒绝换行注入；从页面同一语言列表生成严格递减且为正的 q 权重，最多1000项。主语言切换重建列表及主语言首位沿用 VG-031。
- 修复 resolver 的 localhost 特例：原逻辑匹配已含子域，userScripts matches 却排除其子域；现在两者统一为本域及子域。具体关闭子域仍排除父域，未扩展 host 权限。
- 请求头与页面注册复用后台配置串行队列。预写页面恢复窗口，先隔离再注册/核验，页面语言就绪后核验新头，再解除隔离；恢复后对可能含匹配 iframe 的 HTTP(S) 标签页保守补录重载提示。
- DNR 故障独立显示 headers 失败/部分同步，隔离并撤销所属新头；既有语言/时区、定位、字体继续按各自状态运行。历史报告缺少 headers 时显示未确认，不能当作成功。
- Options、Popup、诊断和 leak-test 的旧原生头提示已更新；主动诊断在站点语言启用时比较实际头与预期列表，未启用或未观测为 UNKNOWN。同步更新权限、配置和隐私说明，无新增 provider 请求或转发服务。

## 旧规则迁移与隔离

历史实现存在全局 dynamic 1001、按标签 session 1002，以及站点规则 1100..2099。此前只考虑站点范围会漏掉前两项。本轮同时检查两个存储，删除这些已确认历史 ID，并实际读回；旧 `legacyDnrCleanupV3Complete` 不作为成功依据。

静态 `header_migration_guard` 随包默认启用，最高优先级普通 allow，覆盖 HTTP(S) 全部当前资源类型（显式包含 main_frame、webtransport、webbundle）。独立只读迁移审计核对了 Chromium 138 初始 matcher 装载先于 worker 清理 API 的窗口，因此单靠启动时清理不够。真实 Chrome 验证进一步暂停候选 worker，确认隔离在后台执行之前已生效。

范围外规则保留。未知 Accept-Language 改写触发冲突并保留隔离；dynamic 中恰好使用新 session ID 的规则仍视为未知，不能误当已拥有。静态 enabled 状态跨浏览器会话保留，扩展更新按 manifest 默认重置；不能假定每次 worker 唤醒都重新默认隔离。固定 JSON 损坏不在可证明范围，已检查构建复制与真实 Chrome 加载。

## 本地验证

最终执行 `npm run check`（源码 typecheck、测试 typecheck、完整 npm test、typecheck + Vite build），全部通过；测试 **274/274**，无跳过。`node --check scripts/chrome-header-sync-smoke.mjs`、`git diff --check` 通过。dist 仅由构建产生，未直接编辑；仓库 manifest 仍为 2.1.1，测试版本更新只写临时副本。

单元/集成覆盖迁移漏项、未知范围保留及冲突、dynamic/session 同 ID 边界、删除/安装读回不一致、页面未就绪撤销、权限失败、配置权重、最长域名排除、串行保存、恢复窗口跨 worker/最终 checkpoint 故障，以及 DNR 启动冲突时保留其他页面能力且替换旧成功报告。

最终文案核对发现 Options 和诊断仍有“请求头原生”提示，统一更新；对应历史状态 UI 测试原先固定断言旧文案，更新为各组件独立报告及历史 headers 未确认后，完整检查重新通过。

## 真实 Chrome

命令：`node scripts/chrome-header-sync-smoke.mjs --output .trellis/tasks/10-22-vg-032-header-sync/chrome-evidence.json`。使用最终实际 dist、Chrome **155.0.8059.86**、独立临时 profile 和映射到 loopback 的合成 HTTP 站点。未访问个人 profile，测试请求不调用真实 provider、精确位置或公网回显；临时目录、浏览器进程和 HTTP server 均清理成功。

主证据12项通过，行为范围包括：

1. 合成旧包预置的 dynamic 1001/1100/2099、session 1002 确实改变导航及同源/跨源请求；无 DNR 中间版本恢复原生。
2. 恢复权限后候选 worker 在执行前暂停，旧 dynamic 三项仍在、默认 guard 已启用；顶层及两个 iframe 的导航/同源/跨源头均原生。
3. 迁移无视旧成功标记、读回只保留范围外 2100，并完成 schema v3 旧 acceptLanguage 字段删除。
4. 正常点击 Allow User Scripts 后，日语页面、导航、iframe、同源/跨源资源一致；更具体法语子域、关闭语言子域和未匹配站点的正负对照通过。
5. 改为德语、禁用/恢复、localhost 及其子域与关闭子域通过。旧页面继续返回日语 JS、随后请求变为德语；报告提示完整重载，重载后 JS/头均德语。
6. 故意重种 session 1002 后，先清理读回再解除隔离。
7. 关闭管理页、删除新 session 规则、停止后台后唤醒，不发送管理消息即重建；真实临时版本更新也在清空规则并停止旧 worker 后重建，实际新文档通过。

独立证据复核发现早期 fixture 的历史头与原生头恰好相同，导致前三项无法构成差分证据。本轮已修正并重跑最终 dist：历史头固定 `zh-CN,zh;q=0.7`，显式断言不同于实测原生 `zh-CN,zh;q=0.9`；JSON 同时保存历史生效和 paused-worker 原生观测。旧值相同的轮次不计入这三项验收。

## 早期主runner的未验证边界（冷启动已由后文补充）

- 整个 Chrome 进程退出后再启动是额外探查，未完成。临时 CDP 加载包显式重载/唤醒后，调试读取出现 `ReferenceError: chrome is not defined`，未取得正确扩展上下文就绪证据。`chrome-cold-restart-evidence.json` 保留 BLOCKED；不能据此宣称生产故障、fail-closed 已通过或普通 profile 自动恢复已通过。该旧轮次的前三项相同值缺口已在 scope 明示。
- 脚本默认覆盖主场景，`--cold-restart` 执行额外探查，失败仍退出2；不反复重跑相同环境阻塞，不以主 PASS 掩盖冷启动 BLOCKED。
- Chrome138、其他操作系统、真实 TLS 站点、普通用户 profile 的加载及 Allow User Scripts 开关持久性未在本次实测。测试使用实际 Chrome headless 模式；没有将 Node/VM 当成 Chrome。
- 页面 userScripts 与 DNR 不是原子事务。同步窗口、已有文档和 BFCache 可能不一致，须确认同步完成后完整 reload 或关闭重开；不热更新、不自动刷新。Worker/SharedWorker 的 JavaScript 语言继续原生，其他扩展的请求头改写未覆盖。

## 独立复核与交付

迁移审计与安全复核均只读。已修复审查发现的 dynamic/session 所有权混淆、早期迁移错误中断其他能力、localhost 范围不一致，以及真实 Chrome 差分证据缺口。最终候选仍需人工验收，不自动标记 done。

交付状态为 review，VG-031 保持 review。未提交、推送、合并、打标签或发布。

## 2026-10-22 正常安装冷启动补充

用户要求通过独立测试配置正常加载扩展，完整退出Chrome后再次启动，确认自动恢复和页面/头一致。首次按该方式实测发现真实缺陷，不能继续归因于CDP临时加载：session规则冷启动清空，持久userScripts已提供日语/法语，但首批导航、同源及跨源头仍为中文。随后无管理消息也会自动恢复，确认是异步重建窗口。两轮修复前证据见 `chrome-normal-ui-cold-start-before-fix.json`，整体FAIL，首请求失败和后续收敛分别记录。

向用户说明现有AGENTS/PRD的session-only合同后，用户明确选择“授权按持久规则方案修复（推荐）”，授权持久化、写前隔离、旧session迁移及中断恢复。方案依据见 `cold-start-followup.md`。

最终实现：

- 新dynamic投影使用40000..49999；旧session30000..39999单独隔离清理和读回。dynamic30000及session40000继续为未知规则，不能凭相同ID接管。
- local `headerRulesDynamicOwnerV1=1` 仅记录命名空间所有权版本，不保存语言副本。首次接管须在guard已确认且新dynamic范围实际为空后建立并读回；未接管而已有任意该范围规则时保留并报告冲突。所有权记录不代替历史规则实际核验。
- 影响投影的配置保存先确认持久guard，再写恢复记录/配置，提交页面和规则后核验并解除。正常稳态启动沿用已确认投影，不重新开guard制造空窗。
- 独立复核发现配置丢失后的迁移及域名修复也会写配置：公开getSiteConfig和诊断回调现连读取快照一起入同一队列；内部已入队路径使用readSiteConfig避免嵌套死锁；storage迁移callback和修复均在写前隔离。原清空local后读取保存关闭配置、旧dynamic仍放行的反例已消除。
- 所有权存储读写失败有专用错误码、固定存储上下文及cause；错误不会被误归为权限问题。未知所属动态规则保留，guard持续开启。

最终本地门禁：`npm run check`全部通过，含源码/测试typecheck、**280/280**测试、生产构建；两个Chrome runner的`node --check`和最终`git diff --check`通过。新增回归覆盖关闭/删除写后中断、写前guard失败拒绝配置、配置丢失迁移与并发保存不覆盖，以及单独所有权读取失败。Chrome实际生成的dist/_metadata是浏览器DNR索引，资产指纹排除此管理目录；维护资产未插桩，dist始终只由构建产生。

真实Chrome最终证据分开保存：

| 证据 | 实际环境与结论 |
|---|---|
| `chrome-evidence.json` | Chrome155.0.8059.86，最终dynamic构建的12项升级/迁移/站点范围/重载/worker与版本更新通过；真实重种旧session1002及30000、39999后清理并读回 |
| `chrome-normal-ui-cold-start-evidence.json` | 有界面Chrome for Testing149.0.7827.55，原生扩展管理页+文件夹选择器加载当前dist，正常用户脚本开关；两轮稳定设置冷启动首HTTP一致，另有中断及关闭开关负例 |
| `chrome-normal-ui-cold-start-before-fix.json` | session-only修复前真实首请求FAIL，保留而不覆盖 |
| `chrome-cold-restart-evidence.json` | 更早的临时CDP加载探查BLOCKED，仍为历史失败记录；不代替正常安装结论 |

正常安装冷启动的两轮分别为日语、保存修改后的德语，每次正常Browser.close确认主进程及9个观测进程树成员全部退出，再spawn同profile；没有load-extension/不安全扩展调试开关、Extensions.loadUnpacked、显式startWorker或重启后的管理消息。首HTTP采样在任何worker附着/管理页之前，父域、法语子域、关闭子域、未匹配域的JS、导航头、同源/跨源头均正确。随后只读看到dynamic四条、session为空、guard关闭、当次headers报告ok、配置结构未变及两条语言注册；正常两轮无运行时插桩。

中断负例只临时阻塞worker的updateDynamicRules Promise，等待实际配置已关闭、旧dynamic四条尚在且guard已持久确认，再退出观测到的10个进程。重启首批请求已原生，随后无需管理消息自动清空旧头、页面注册关闭、配置保留关闭。该运行时故障注入单独标注，不冒充无插桩的正常启动。

用户脚本关闭负例在正常Chrome UI关闭开关，再完整退出12个观测进程后重启。**首请求实际为原生JS、旧德语头，firstRequestConsistency=FAIL**；后台核验后自动撤销dynamic、保留guard、headers报告header-page-not-ready，后续新文档完全原生。整体PASS仅指脚本列出的稳定设置冷启动、中断隔离恢复及“开关核验后撤销”，绝不扩展为该开关过渡窗口的首请求原子一致；README、PERMISSIONS、PRIVACY、CONFIG_GUIDE均披露。需要关闭保护时应先使用插件总开关并确认同步。

上轮冷启动从about:blank开始，首HTTP在CDP连接后创建；自动恢复旧HTTP标签的更早启动时序由下一节单独补充。Chrome138、其他OS、真实TLS及个人profile未实测；个人Chrome配置未修改。仅合成loopback站点，不请求真实provider；浏览器自身后台网络未全量监控。临时浏览器、profile及server清理通过。

独立只读安全复核已确认核心持久性/所有权/队列修复，并核对正常冷启动JSON及脚本，未发现剩余已确认代码缺陷或证据阻断。升级主runner补种旧session范围后也重新通过。测试曾出现合成旧worker上下文尚无chrome namespace的自动化故障，改为仅对只读API就绪作版本和能力确认后再执行种规则；不重试已派发的变更，不将该故障归为产品问题。

最终状态仅review，等待人工验收；VG-031仍review。没有提交、推送、合并、打标签或发布。

## 2026-10-22 自动恢复旧HTTP标签的首请求补验

用户继续要求验证Chrome自动恢复上次HTTP标签的最早启动时序。本轮仅扩展维护测试脚本和记录，未改生产源码、权限或构建资产；沿用当前dynamic方案与上轮完整门禁。运行 `scripts/chrome-header-cold-start.mjs`，传入独立临时UI信号目录、输出文件和 `--http-session-restore`，`CHROME_BIN` 指定已有的有界面Chrome for Testing **149.0.7827.55**。

新建临时profile，原生扩展管理页和文件夹选择器正常加载当前dist，正常开启用户脚本。正常设置页可见“继续浏览上次打开的网页”选中，脚本只读实际 `session.restore_on_startup=1`；没有写偏好文件、load-extension、Extensions.loadUnpacked或强制恢复参数。测试请求只到合成域映射的HTTP loopback，不访问个人profile。

每轮退出前仅保留一个活动HTTP顶层标签，内含法语覆盖及关闭语言的两个子iframe，关闭全部Options/扩展管理/设置页。正常Browser.close后，确认主进程和观测到的全部进程树成员退出，再用相同临时profile启动；重启命令不带启动网址。服务器保存该路径重启后的**第一份**新响应及实际Accept-Language，响应内的首段inline同步读取navigator.language/languages，并立即自报该响应的唯一nonce。先收到自报，再建立CDP连接；之后核对实际恢复目标、同一nonce和仅一份新顶层响应。不会跳过首失败文档选取后续重试，也不reload后替代首读。

正式证据 `chrome-http-session-restore-evidence.json`：**11项PASS，cleanup PASS**。两轮结果为：

| 退出前配置 | 恢复首inline语言列表 | 首导航实际Accept-Language | 首导航/自报距新进程启动 | 完整退出 |
|---|---|---|---|---|
| 日语 | ja-JP, ja, en | ja-JP,ja;q=0.9,en;q=0.8 | 528 / 661 ms，均在CDP前 | 9个观测进程全部退出 |
| 管理事务保存改为德语 | de-DE, de, en | de-DE,de;q=0.9,en;q=0.8 | 409 / 547 ms，均在CDP前 | 8个观测进程全部退出 |

法语子iframe的首脚本和导航/同源/跨源头均法语；明确关闭语言的子iframe及后采未匹配域均保持实测原生中文。父域的同源/跨源头也与首脚本一致，受保护的日语/德语列表均无中文。首读后只读核验dynamic40000..40003仍在、session为空、guard关闭、两条语言注册和当次headers报告ok、配置结构未变。重启后没有管理消息、扩展reload、显式worker启动或首读前调试暂停。

CDP连接前直接收取并作为最早时序证明的是顶层文档报告；iframe的首inline快照在连接后读取，不声称所有子帧均在CDP连接前完成上报。独立只读复核已核对脚本与正式JSON，确认首响应关联、完整退出、自动恢复顺序可信，未发现阻断性缺口，无需补跑。本轮状态恢复review，等待人工验收。

维护dist指纹与前轮相同：`aa70331e7974bb76114f0ea410ff2b2efb2e67589b4457cef45bc171bc2899d9`，仅排除Chrome生成的_metadata。生产输入未变，复用已通过的 `npm run check`（源码/测试类型检查、280/280测试和构建）；本轮脚本语法检查及diff检查通过。临时profile、浏览器及本地server清理通过。

结论仅覆盖当前macOS/Chrome149、正常退出、一个活动HTTP顶层标签和稳定Chrome开关的自动恢复；多窗口、后台延迟标签、崩溃恢复、Chrome138、其他OS及真实TLS未实测。原有Allow User Scripts关闭后首请求FAIL边界仍有效，不因本轮PASS消失，也不声称跨API原子一致。

## 2026-10-22 总开关可靠关闭入口与真实重启

本轮用户要求继续处理直接关闭Allow User Scripts后的首请求旧语言头。核对Chrome官方userScripts文档和Chromium `UserScriptManager::SetUserScriptPrefEnabled` / developer_private调用路径：用户脚本开关独立停用脚本源、更新renderer可用性，公开userScripts API没有可在开关生效前同步撤销DNR的通知；不能以onStartup或轮询保证任意首请求无窗口。依据：[Chrome文档](https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable_usage_of_the_userscripts_api)、[Chromium源码](https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/user_script_manager.cc)。源码main只用于机制调查，实际运行版本以下方实测为准。

用户明确选择“保留语言头同步，以插件总开关作为可靠关闭入口”。生产后台及权限方案保持；本轮生产增量包含Popup、Options的关闭流程提示及保存确认状态修复：Popup关闭自动保存，Options关闭后点击保存当前配置，等页面/头同步成功，再完整重建旧文档。若还需关闭Chrome开关，则放在同步成功之后。配置指南同步该选择；未把直接关闭Chrome开关的旧窗口宣称为已修复。

测试维护源新增 `--master-off-restore` 与 `--user-scripts-off-restore`。直接关闭Chrome开关的首请求失配现纳入整体FAIL；旧JSON保留旧判据，历史后台恢复PASS不能用作首请求通过证据。后一个负例模式本轮未运行，已知失配仍引用历史真实Chrome记录。

本轮执行 `scripts/chrome-header-cold-start.mjs --output <本任务证据> --ui-signal-dir <本次临时信号目录> --master-off-restore`，CHROME_BIN指向已安装的有界面Chrome for Testing **149.0.7827.55**。正常扩展管理页/原生文件夹选择器加载当前dist，正常启用用户脚本；合成规则由测试管理消息准备。正常设置页确认继续浏览上次打开的网页。测试通过原生UI点击Popup总开关，实际显示“已保存并同步”、语言/时区未启用、Accept-Language已同步；只读核验dynamic/session为空、语言注册0条，随后新顶层、法语子iframe和原生子iframe的页面及导航/同源/跨源头均原生。

然后正常UI关闭Allow User Scripts，仅保留一个活动HTTP标签；Browser.close正常退出，确认主进程及全部**10个**观测进程退出。相同临时profile重启，不传启动URL、强制恢复参数，不reload扩展、不显式startWorker、不发重启后管理消息。服务器先收自动恢复文档的首导航和首inline报告，再连接CDP，响应nonce一致且只发生一次新顶层响应。

正式证据 `chrome-master-off-restore-evidence.json`：**9项PASS，cleanup PASS**。

| 观测 | 实际结果 |
| --- | --- |
| 启用基线 | 页面ja-JP/ja/en，头ja-JP,ja;q=0.9,en;q=0.8 |
| 总开关同步关闭后 | 顶层和两子iframe语言zh-CN，导航/同源/跨源头zh-CN,zh;q=0.9，与安装前原生基线一致 |
| 重启自动恢复首文档 | 语言zh-CN，languages=[zh-CN]；首导航/同源/跨源头zh-CN,zh;q=0.9 |
| CDP连接前取证 | 首导航距spawn 527ms，首inline报告610ms |
| 重启后只读核验 | 保存配置仍关闭；dynamic/session均空，headers=ok；用户脚本API不可用，页面状态如实为switch-required |

关闭Chrome开关后无法读回userScripts注册，因此后台会提示switch-required；本轮不把该提示当作旧语言头残留，也不把headers=ok扩展成所有组件均ok。已观测的新文档语言为原生。测试范围仅当前macOS/Chrome149、正常退出、一个活动HTTP顶层自动恢复和HTTP loopback；未验证Chrome138、其他OS、真实TLS、多窗口、延迟标签、崩溃恢复。没有访问个人Chrome配置，合成站点请求仅loopback；Chrome自身后台网络未全量监控。

最终候选 `npm run check` 通过：源码和测试类型检查、280/280测试、构建。测试进一步明确失败时的关闭意图后，`npm test` 再次280/280通过；`node --check scripts/chrome-header-cold-start.mjs` 和 `git diff --check`通过。dist SHA256：`c659b709bcdaae0c716bbd5e6f318d85dc7a3afe46d74479be2f10f0038fd0ba`，排除Chrome生成的_metadata。没有新增后台轮询、权限、桥接或注入路径。

独立复核发现并修复两处关闭确认缺口：保存在途期间旧同步成功文字未清除；保存失败后对账旧配置可能覆盖失败提示。两页现在发出配置保存即显示pending，所有在途保存结束前旧回包不能提示成功；自动保存toast/Options成功弹窗同步处理。保存失败状态保留至重新保存成功，对账旧配置不能作为本次关闭成功。维护源VM覆盖双保存延迟、失败后重试与重新保存恢复；抽取函数的旧测试夹具补齐状态依赖。首轮测试失败为该新增失败场景的站点徽标预期及VM未注入新依赖，修正后重新完整验证，不把失败轮次记作通过。

最终候选再次使用全新临时profile完整运行正常安装、Popup关闭、Chrome开关关闭及完整重启流程，上述正式JSON及SHA256均已更新为最终候选。独立critical_reviewer以维护源内存VM验证关闭保存失败与排队重试的交错，确认原P2已关闭，当前增量无新的具体阻断；这份VM复核与真实Chrome证据分别报告。最终 `git diff --check` 通过，状态仅review，等待人工验收；无提交、推送或发布。

## 2026-10-22 人工验收确认

用户明确确认：“这轮验收通过，把 VG-032 标记为 done，整理并提交相关改动，先不要 push。”据此将唯一跨任务清单和本任务状态同步为done，授权整理本地提交，不推送、不打tag、不发布。

验收覆盖前述DNR安全迁移、持久投影与恢复，以及最终总开关可靠关闭流程；正式重启证据为 `chrome-master-off-restore-evidence.json`（9项PASS、cleanup PASS）。先关闭插件总开关、等待保存及同步成功、完整重建旧文档，再关闭Allow User Scripts；直接关闭Chrome开关的跨API首请求窗口仍是已知限制，不因人工验收而改变。

本次收尾仅更新状态、文档和证据跟踪规则，生产及测试输入未变，复用上文最终候选的完整本地门禁、280/280测试、独立复核及真实Chrome149完整退出重启证据。前续VG-031语言列表修复是本轮一致性实现的相关基础，随相关改动整理提交；用户本次仅明确验收VG-032，VG-031继续保留review。
