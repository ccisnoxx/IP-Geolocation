# VG-025 字体固定候选与恢复门禁

## 当前人工验收阻断：停用后新文档仍过滤（2026-10-20）

真实用户 Chrome 的关闭基线尚未通过，VG-025 保持 `review`、人工验收 `pending`，暂停继续后续验收，不提交或发布。本段是当前现场调查状态；下方已通过的隔离验证不能替代本次人工关闭基线。

- 用户已确认扩展 ID 与当前 `dist` 一致，并通过探针随机文档标识确认人工操作和自动化观测对应同一测试配置文件、同一文档。
- 重启前 Chrome **153.0.8010.55**：普通 `localhost` 新文档在首 inline 前已出现过滤；同一浏览器的 IP 源对照保持原生。新端口 `localhost` 的 `crossOriginIsolated=true` 文档同样出现过滤，且没有页面 Service Worker 控制。调用栈指向本构建的 `font-exposure/filter.js`。
- 用户报告已完全退出并重启 Chrome、扩展仍停用。实际重启后版本为 **155.0.8059.80**；首 inline 和已加载的合成目标字体别名仍返回过滤结果，借用空白 iframe 的原生 API 对照正常。普通别名不受影响。冷启动和版本变化未消除现象，不能再仅以旧页面或旧会话内存残留解释；也不能把这次跨版本操作当作同版本冷启动对照。
- 重测中的健康检查发现原本机探针服务已退出，未假定已有页面来自新 HTTP 响应。恢复 loopback 服务后，浏览器完整刷新所见的一次性服务器响应标识与服务端记录一致；该新文档的首 inline、完整版本和字体对照结果仍如上。最终现场结论以这份已确认新响应的结果为准，未把服务退出直接归因于 Chrome，也未以原页面快照证明冷启动行为。
- 正式脱敏记录：[manual-cold-restart-investigation.json](manual-cold-restart-investigation.json)。本轮仅更新调查记录和临时本机探针，没有修改生产实现或增加权限；未访问扩展管理页、扩展存储或注册列表。用户确认的停用状态已记录，但浏览器实际注册及停用／卸载路径尚无运行时证据，不能把调用栈标签单独作为已确认 Chrome 缺陷的证据。
- 用户明确不提供截图，停止重复请求；此前“只差截图即可区分原因”的说法已纠正，截图也只能确认可见开关，不能证明注册已撤销或直接定位注入路径。当前工具对扩展内部页的访问限制未确认解除，不通过桌面点击、CDP 或其他通道绕过已拒绝的访问；将根因调查记为访问边界阻断，保留 `review` / `pending`，不继续验收或进行推测性修补。

### 本轮执行停止点：重新授权后的能力核验仍受阻（2026-10-21）

用户在本聊天要求“接下来按照推荐的执行顺序实现”，本轮据此执行保持生产代码不变、先核验正式工具能力、具备接口后才进行一次最小 G05 查询的顺序；不将该授权扩大为 G07、字体生产门禁关闭或替代通道取证。记录时间为北京时间 2026-10-21 11:19:28；这是记录时间，不是 G05 状态采集时间，本轮没有取得 G05 快照。

- **能力核验结果仍为受阻**：通过 `cua.getState()` 取得工具文档和可用连接清单，再选择 Chrome 连接仅读取正式浏览器文档、命名工具会话并调用 `capabilities.list()`。实际返回仅 `viewport` 与 `management`；后者的正式范围为窗口、标签、分组和书签组织，没有原生单扩展状态接口或受支持的扩展管理上下文。
- **停止在查询之前**：没有打开、认领、导航、刷新或关闭任何标签，没有获取原生应用窗口或操作桌面，没有调用 `getExtensionInfo`、执行页面脚本或发送 CDP 命令。可用 Chrome 连接仅用于接口能力核验，未证明其与原现场 profile／目标扩展绑定；目标扩展状态、停用原因及派发归属均未取得。连接／标签／应用清单不复制入任务证据，不落盘实际标识、URL 或个人配置。
- **G05／G07 继续 `UNKNOWN`，现场根因继续 `UNCONFIRMED`**。本轮重新授权已用于上述一次能力核验；所需工具能力仍未具备，即按顺序停止，不自动重连、轮询、重试或恢复隔离实验。后续只有在工具能力发生可确认变化、能够绑定目标且获得指定阶段授权后才继续；G07仍须独立授权。
- **没有据推断修补生产代码**：不移植 VanishMe 的全域静态脚本、页面桥或缓存，不改变 `persistAcrossSessions` 或字体 Hook，不关闭当前生产门禁。VG-025保持 `review`／人工验收 `pending`；VG-026／VG-027人工验收继续暂停。未修改生产源、权限或 dist，未启动测试、浏览器或探针服务，未暂存、提交或发布。

本轮仅更新本执行记录与 `task.json` 的最新核验元数据。JSON／状态一致性及 `git diff --check` 已核验；生产输入未变，既有224项测试、类型检查和构建仅保留为历史证据，不宣称本轮重新执行或取得新的 Chrome 验收。能力检查未启动后台进程、监听器或临时文件，无新增运行资源需要回收。此前自动现场取证停止点及原始诊断证据保留如下。

### 当前停止点：G05 查询受阻，停止自动现场取证（2026-10-21）

用户曾单独授权第一段：仅通过工具正式支持的原生管理上下文读取目标扩展当前 G05，允许查询间接读取目标扩展关联偏好，不读取或复制配置文件；工具不支持即停止，不绕过、不启用／重载扩展、不重启、不执行 G07。随后明确要求补记结果并停止自动现场取证、不再重复隔离测试。本段记录最新停止点，不覆盖或回填旧案例与既有证据。

**实际结果：在工具能力核验阶段停止，G05 原生查询未执行。** 上一轮仅选择已确认的测试浏览器连接、读取正式工具文档和 Browser 能力声明，并设置工具会话名称；没有打开、认领、导航或刷新任何标签，没有进入原生扩展管理上下文。返回的能力只有 `viewport`（视口控制）与 `management`（窗口、标签、分组和书签组织）；后者不包含扩展管理。未提供可调用 `chrome.developerPrivate.getExtensionInfo(id)` 的正式管理上下文或等价的单扩展状态读取接口。未调用该查询，未取得浏览器原生状态响应，未发送 CDP 命令，未进行 G07 或 trace 采集。能力核验发生于 2026-10-21，精确时刻未留存，记为 `UNKNOWN`；不存在本次 G05 状态采集时刻。

- **G05 保持 `UNKNOWN`**：当前 state、当前 disableReasons 与派发时历史状态均未取得。不能把工具能力查询结果或历史用户停用确认写成当前浏览器状态，也不能把未执行查询写成浏览器拒绝了该查询。
- **G07 保持 `UNKNOWN`**：本轮没有原生 owner、注册身份、派发通道或相关时序证据。H1／H2 继续未确认，现场根因 `UNCONFIRMED`；既有独立启动读取失败修复与现场归因保持分开。
- **具体缺口是工具访问能力**：源码存在管理 API 不等于当前工具暴露该上下文。未改用内部诊断页全量输出、HTTP origin 跨域调用、外部 CDP、桌面点击或其他通道绕过限制；未读取或复制 Chrome 配置文件、打开 Options、附加 Worker、改变权限或注册。

恢复采集须同时满足以下条件，在满足前不得自动重连、轮询能力、重试查询、创建探针或重复已通过的隔离测试：

1. 用户重新明确授权恢复指定采集阶段；上一轮第一段授权的执行已在能力核验处停止，不作为今后自动继续的许可。
2. 工具正式提供受支持的原生管理上下文或等价的单扩展只读接口，且能可靠绑定已确认的测试浏览器与目标扩展；仅用户同意不能解除工具限制。能力仍不足即交付受阻结果并停止。
3. G05 仍限目标扩展、一次当前快照和白名单脱敏；允许的间接偏好读取不扩展为配置文件访问、全 profile／其他扩展枚举或 `extensions-internals` 全量输出。记录来源、采集时间和未知项，当前快照不回填历史派发状态；接口未提供用户操作停用原因时继续记 `UNKNOWN`。
4. G07 必须另获独立授权，且在采集前核实原生接口可用性、数据范围与落盘方式、文档关联、会话归属及有界停止／清理条件；不随 G05 自动启动，不预先承诺取得注册 ID 或确认旧案例根因。若需扩大读取范围、启用／重载扩展、改权限或配置、重启，或工具仍拒绝，则停止并另行说明，不自行扩大范围。

**自动现场取证已按用户要求停止。** VG-025 保持 `review`、人工验收 `pending`，VG-026／VG-027 人工验收继续暂停；不提交、暂存、发布或安排自动重试。本次补记只修改任务记录，不连接或操作 Chrome、不执行测试或读取配置；原诊断包、旧有界增量、新案例 JSON 与运行时源码原样保留。记录完成后停止本项工作。

### 独立新HTTP案例：G01源码取得，G05/G07仍缺证（2026-10-21）

用户另行授权同一测试Chrome中新建一个HTTP标签，旧探针完全不动，不回填旧案例。只在新标签先导航同源无探针准备页以满足工具前置条件，启用Runtime/Page/Debugger事件采集，再进入独立探针文档；未暂停、设断点或注入新文档hook。新探针新交付标识与服务端一致，首inline check=false，栈含目标资产。共49事件、无截断，当前frame/loader/context关联后仅1个顶层字体源码候选。通过真实Debugger.getScriptSource取得完整9815字节UTF8运行时源码，CDP摘要/本地原文摘要/当前dist完全一致，无trim或行尾改写；完整源码作为正式证据保留。

独立记录 [newcase-source-collection-2026-10-21.json](newcase-source-collection-2026-10-21.json) 及 [运行时源码](newcase-runtime-font-source-2026-10-21.js)。G01仅对新案例已取得运行时源码；原始网络/磁盘字节仍UNKNOWN。G04取得新文档frame/loader/context链，但进程/profile身份仍UNKNOWN。G05合规可用性核对发现Browser只提供viewport及标签组织能力，tab CDP限HTTP origin，无扩展状态读取接口，未发跨域特权调用或绕过管理面限制，当前状态仍UNKNOWN。已有脚本解析事件无原生owner/注册身份/parse initiator stack，G07无同文档原生派发证据即停止；不把来源URL、相同源码或传输extensionId当派发owner，也不把本轮执行称为已证实停用后派发。

只缩小新案例的字体源码身份差异，不确认H1/H2，后台/浏览器构建差异仍缺证。旧诊断包、旧有界增量、旧原始证据保持不变。Debugger已disable，仅新标签关闭；本次loopback服务正常退出，准备/探针各一次响应，无其他临时文件。未启用扩展、改配置/权限/dist、启动或重启浏览器、附加Worker、重复隔离矩阵或提交发布。源码/摘要/事件关联、隐私、旧证据未变、JSON/状态和diff检查通过；现场UNCONFIRMED及review/pending保持。

### 一次有界只读取证增量（2026-10-21）

按本轮授权绑定现存探针，未创建/导航/刷新。可见文档标识和服务器交付标识均与F01旧案例一致：G04文档级已关联，但底层进程/profile及frame/loader/context链未取得，整体仅PARTIAL。现有结果表是既有历史观测，本次未点击诊断按钮或调用字体API，不把它当新测结果或当前进程版本。

受支持Tab CDP能力明确要求首次命令前导航新标签，与本轮保留现场范围冲突；未发送显式CDP命令/启用Debugger，也未用外部CDP或原生UI绕过。G01源码/摘要仍UNKNOWN；当前G05未取得，历史用户停用确认保留但不冒充当前或派发时内部状态。仅核对基础诊断包及F01～F04原始留存JSON，未提供同文档原生派发记录，G07仍UNKNOWN；不将缺记录解释为没有派发或其他注入者。

正式增量见 [bounded-readonly-collection-2026-10-21.json](bounded-readonly-collection-2026-10-21.json)，分字段记录来源、时间精度、晚附加是否执行及停止原因。原两文件诊断包和原始证据保持不变。结束本次取证，不保留handoff，不关闭用户原标签；未读/复制Chrome配置、打开Options/管理页、启用扩展、附加Worker、重启浏览器或重复隔离测试。JSON/标识脱敏/来源摘要/包未变/状态与diff检查通过；未改生产/权限/dist，现场UNCONFIRMED及review/pending不变，未提交发布。

### 最小脱敏现场诊断包（2026-10-21）

按本轮授权，仅从留存现场记录、既有隔离JSON和仓库参考源整理 [两文件诊断包说明](diagnostic-package/README.md) 与 [结构化证据](diagnostic-package/evidence.json)。18个输入快照摘要，11项缺证全部明确为UNKNOWN，逐项对应H1关联原生派发异常、H2其他执行通道、H3实际构建/环境差异及结果分支；H3是可并存核实项。保留用户已确认的停用/同profile事实，与未取得的内部运行时关联分层，不把UNKNOWN写作false/0/空注册。当前参考资产/后台摘要不冒充现场加载摘要，5个栈行位置相符不冒充完整字节相同。

只白名单摘取关系、匿名别名和来源摘要，不复制截图、完整栈、实际ID/nonce/URL/端口、度量原值、配置或凭据；原始证据保留原位且未修改。诊断包JSON/来源快照/缺证引用/脱敏/状态和差异检查通过。未读取或复制Chrome配置，不启动/操作浏览器、不重跑隔离或回归套件，不改变生产源、权限、dist或撤销命名空间。现场UNCONFIRMED、VG025 review/pending、VG026/027人验暂停不变，未提交发布或外传。

### 最新隔离补证：自动恢复 HTTP 标签首读（2026-10-21）

有界面 CfT155.0.8059.80、独立临时 profile、正常原生目录加载未插桩当前 dist，并在设置 UI 选择继续上次会话。开启正对照、内部关闭、卡片停用连续三次正常冷重启，均不传启动 URL、不在首读前连接 CDP/暂停 renderer/驱动导航；唯一活动 HTTP 标签自动恢复，首 inline 新响应报告在 CDP 连接前收到。完整刷新和新建文档采集也先于管理页/Options。**23 项 PASS**；两条关闭路径保持原生且无首读字体来源栈，状态/规则保留；重新启用后过滤恢复。生产、权限及 dist 48 文件摘要均未改变。

开启恢复正对照首 inline 捕获过滤及当前字体来源栈，但稍后附加 Debugger 不回放顶层字体脚本；恢复首文档完整源码未捕获。已确认采集盲点，不能用晚附加缺事件证明未注入；完整刷新/新建正对照仍取得与 dist 一致的完整源码。详见 [正式23项JSON](chrome-http-session-restore-155.0.8059.80.json) 和 [方法/范围记录](browser-card-disable-verification.md)。单一活动 HTTP 正常恢复不代表后台惰性/崩溃/HTTPS/所有历史状态或用户现场因果证明。

`node --check`、真实浏览器定向检查、记录/隐私/状态与 `git diff --check` 通过；生产输入未变，复用224测试/类型/build。当前临时进程、profile、服务、包、信号及日志回收，不操作用户 Chrome，不请求截图或重启；现场 **UNCONFIRMED**、`review/pending`、VG026/027人验暂停及不提交发布保持。独立启动读取失败修复仍分开记录。

### 独立修复：启动读取失败后的所属字体清理（2026-10-20）

用户另行明确授权修复下述源码诊断已复现的清理遗漏。已在启动配置队列内补充失败清理，复用原字体对账原语及原前缀，不依赖 storage 可读、不扩大权限／撤销范围，保留原始错误及双重失败可见性。定向回归先红后绿，最终 Node 全套 **224/224**、源码／测试类型、构建通过。独立修复、验证及剩余浏览器缺口详见 [startup-read-cleanup-fix.md](startup-read-cleanup-fix.md)。

这项修复不等于现场根因确认；下方 6 项诊断属于修复前快照，不再表示当前读取失败仍跳过清理。现场调查继续 **UNCONFIRMED**，VG-025 保持 `review` / 人验 `pending`，未提交或发布。

### 独立临时 Chrome 补充验证（2026-10-20）

用户授权使用独立临时配置文件补充启动读取失败验证。新增 `--startup-read-failure` 模式，在临时 worker 副本注入读取／撤销拒绝及实际初始化结果观察，实际编译实现、字体资产与 manifest 权限保持，注册／成功清理／回读由真实 Chrome 执行；不附加或改变用户 Chrome。Chrome **155.0.8059.85，6 项 PASS**，正式证据 [chrome-startup-read-failure.json](chrome-startup-read-failure.json)，完整方法、初始执行器断言纠正及覆盖边界见 [startup-read-cleanup-fix.md](startup-read-cleanup-fix.md#独立临时-chrome-启动读取故障定向验证)。

已实测三种读取失败清理、同资产其他 ID 保留与继续执行、双重失败的残留及 code／cause／消息可见性、故障解除后的实际 worker 恢复。新文档反映清理结果，旧 hook 保持快照。该受控 API 拒绝验证不等于完全未改写 dist、实际存储损坏、浏览器冷启动或卡片停用验收，更不证明用户现场根因；后者继续 **UNCONFIRMED**，`review/pending` 不变。生产输入未变，复用上轮 224 测试／类型／构建证据；本轮临时进程与文件按记录回收，未提交发布。

### 未插桩当前 dist：内部关闭与卡片停用对照（2026-10-20）

按用户新授权，在独立临时 Chrome **155.0.8059.85** 直接加载当前 `dist/` 原路径，未新增文件或插桩，加载前后 48 个文件摘要一致。内部总开关关闭与 Chrome 卡片可信点击停用分开执行；后者在新开的管理页确认 `DISABLED/checked=false`，停用前及重新启用后内部总开关均为 true。两种关闭后的新建／完整刷新 HTTP 文档及普通 iframe 均原生，无字体文件解析或调用栈证据；重新启用后过滤恢复。实时 API 确认旧文档停用后仍有 hook，完整刷新后恢复，不以旧快照替代新文档。

正式 [chrome-browser-card-disable.json](chrome-browser-card-disable.json) **9 项 PASS**、cleanup PASS；方法、来源采集资格修正及版本边界见 [browser-card-disable-verification.md](browser-card-disable-verification.md)。这补充了独立环境的浏览器卡片停用覆盖，没有覆盖用户实际配置文件，也没有把先前现场版本155.0.8059.80与本次155.0.8059.85当作同版本对照。现场根因继续 **UNCONFIRMED**，`review/pending` 不变，不请求截图或重启用户 Chrome，未提交发布。

### 155.0.8059.80 同版本对照：签名复核后 9 项 PASS（2026-10-20）

首轮获取时按用户要求检查独立精确版本来源，没有替换、操作或重启用户 Chrome。官方 CfT 索引未收录 `.80`，精确 ZIP 则可从 Google 官方存储下载；包内版本及传输一致性检查通过，但严格代码签名校验失败，缺失资源封印、仅 linker ad-hoc 签名，无发布者 TeamIdentifier。`spctl` 的 accepted 带本机安全 override，未当作签名通过，也未修改系统安全设置或绕过校验执行。

上述停止属于首轮获取的历史事实，原 [chrome-155.0.8059.80-acquisition.json](chrome-155.0.8059.80-acquisition.json) 保留 BLOCKED／NOT_RUN 并追加复核链接。按用户后续要求核实 CfT 维护者说明、精确版本 macOS installer 配置和 Apple linker 签名合同，确认 CfT 不做发布者签名，arm64 实际包采用 linker ad-hoc；缺少 bundle 资源封印的错误本身不构成来源被篡改或必须阻断的结论。首轮把发布者签名当作必要条件，判断过严。

复核重新从官方 HTTPS 下载相同 SHA256 的 `.80` ZIP，核对响应头摘要／长度、CRC 和全部 673 个解压条目；无重签、quarantine 删除、系统设置变更或禁用沙箱。原 bundle 的 codesign 失败如实保留；逐字节相同的独立 launcher 诊断副本通过代码验证但未执行，不将此记为应用发布者签名／公证通过。执行器仅补充显式二进制不存在时不回退及加载扩展前精确版本断言；缺失二进制负对照、`node --check` 通过。

在独立临时 **CfT 155.0.8059.80 / mac-arm64 / headless** 直接加载未插桩当前 dist，正式 [chrome-browser-card-disable-155.0.8059.80.json](chrome-browser-card-disable-155.0.8059.80.json) **9 项 PASS**、failure=null、cleanup=PASS。内部关闭与可信卡片停用分别验证，新建／完整刷新及普通 iframe 均原生且无顶层字体资产／调用栈；新响应标识确认，重新启用后 master 仍 true 且过滤恢复，旧 hook 刷新前仍在。加载前后 48 文件摘要不变，未把 `.85` 证据冒充 `.80`。方法、官方来源与安全边界详见 [browser-card-disable-verification.md](browser-card-disable-verification.md)。

生产代码、权限与 dist 未改，复用既有类型／224 测试／构建证据；记录解析、状态一致性及 `git diff --check` 通过。临时浏览器／profile／CDP／server、ZIP 与副本已回收，未操作用户 Chrome。CfT／headless／新 profile 与现场普通 Chrome 仍有环境差异，未取得现场实际派发路径；现场根因仍 **UNCONFIRMED**，`review/pending` 不变，后续人工验收不推进，未提交发布。

### 155.0.8059.80 有界面隔离对照：与 headless 无观察差异（2026-10-20）

按用户授权补充独立临时 CfT **155.0.8059.80 / mac-arm64 / headed**。执行器新增仅适用卡片停用对照的 `--headed`；启动参数只移除 headless，保留原沙箱／权限边界，探针、配置和断言不变。精确版本及运行时 Browser window 协议确认后，实际取得正常、未最小化的浏览器窗口；只保存状态／布尔结果，不记录其他应用窗口。官方 ZIP 的重复 SHA256、响应头摘要、CRC、673 个解压条目、版本及 launcher 摘要均核对，不重签、删除 quarantine、改变系统安全设置或操作用户 Chrome。

正式 [chrome-browser-card-disable-155.0.8059.80-headed.json](chrome-browser-card-disable-155.0.8059.80-headed.json) **9 项 PASS**，failure=null、cleanup=PASS。内部关闭与卡片可信点击停用分别验证，新建／完整刷新及普通 HTTP iframe 均原生，无顶层字体脚本／调用栈，完整刷新确认新响应；开启及重新启用后过滤恢复、master 仍 true，旧 hook 刷新前仍在。dist 原路径直接加载，加载前后／备份 48 文件摘要一致，与此前 headless 包及 dist 相同。11 组行为／状态／资产字段与已有 headless 记录一致，没有重复运行 headless。

`node --check`、真实 headed 流程、比较／记录／状态检查及 `git diff --check` 通过；生产输入未变，复用既有类型／224 测试／构建证据。临时进程、profile、CDP、server、包、副本和日志已回收。完整方法见 [browser-card-disable-verification.md](browser-card-disable-verification.md)。隔离条件内未发现模式相关差异，不能据此确认现场来源或排除 Chrome 问题；CfT／新 profile、现场构建及派发路径、历史状态／真正冷启动、Chrome 138／其他 OS 与完整人工验收仍未闭合。`review/pending`、现场 **UNCONFIRMED** 不变，不推进后续人工验收，未提交发布。

### 正常 UI 加载与持久化冷启动：17 项 PASS（2026-10-20）

用户授权以独立有界面 CfT `.80` 通过扩展管理页正常加载未插桩当前 dist，并只重启本次子进程。新增 `--persistent-cold`，不用 `Extensions.loadUnpacked` 或 unsafe extension debugging，原生目录选择、卡片停用／重启用由 Native CUA 完成；临时窗口标识及操作确认信号将可见原生操作与运行时记录关联，信号只控制流程，不作为配置判定。初轮缺少原生操作时序确认，其行为输出未作为正式验收；正式轮明确再次选择当前 dist 并看到加载成功后才启动测试，准备期早于明确操作出现的加载来源仍不作归因。

正式 [chrome-normal-ui-persistent-cold-155.0.8059.80.json](chrome-normal-ui-persistent-cold-155.0.8059.80.json) **17 项 PASS**、failure=null、cleanup=PASS，详见 [browser-card-disable-verification.md](browser-card-disable-verification.md)。实际两次 `Browser.close` 后确认旧 PID 正常退出，再用相同临时 profile 启动新 PID／同一版本，扩展均保留。每次重启先确认没有 Options／管理页，再采集首 HTTP 文档和真实完整刷新，最后读管理页及允许读取的配置；没有重新安装、读写偏好或用 worker 重启替代。

内部关闭冷启动后，两个文档均原生且无字体源码／调用栈，之后读得卡片 ENABLED、master=false、字体 disabled/0、字体开关和规则保留。卡片停用冷启动后亦均原生，之后确认卡片仍 DISABLED、worker 不在，停用期间不打开 Options；原生重新启用后 master 仍 true、规则保留、字体 ready 且过滤恢复。dist 原路径加载前后／备份 48 文件摘要不变，官方包与此前模式对照一致，无插桩、权限／系统安全设置或沙箱放宽。

语法、真实 Chrome、顺序／状态／来源／资产与记录检查及 `git diff --check` 通过；仅 UI 读取字段在正式运行后作准确语义更名，未改变行为，不重复浏览器验证。生产输入未变，复用类型／224 测试／build 证据。任务临时资源全部回收，现场原始证据保留。正常加载及冷启动的隔离覆盖已补齐，但现场实际构建／派发与历史状态、自动恢复 HTTP tab 的更早竞态、Chrome 138／其他 OS 及完整人工验收仍未闭合；源代码启动故障修复继续与现场调查分开。`review/pending`、现场 **UNCONFIRMED** 不变，不推进后续人工验收，未提交发布。

### 源码生命周期排查补充（2026-10-20）

用户要求改从源码和现有证据继续调查，不再请求截图或重启。本轮未操作浏览器，也未修改生产实现。正式脱敏记录：[source-lifecycle-investigation.json](source-lifecycle-investigation.json)。**现场根因仍未确认**，`review` / 人验 `pending` 不变。

- **正常路径已确认**：compiler 复用 resolver 的总开关／字体开关／vendor-software／启用 allowlist 门禁；正常关闭对账会撤销所属前缀旧注册并回读，未发现关闭配置正常对账完成后又新增字体注册的分支。配置变更与初始化共用串行队列；worker 求值、onStartup、onInstalled 均调用初始化。当前 dist 的字体 SHA256 与既有生产证据一致，相关生成 worker 路径与维护源一致。
- **条件性残留机制已复现**：注册显式 `persistAcrossSessions: true`，但清理之前先读 local 配置及 session metadata。以当前实际 services 注入读取拒绝时，初始化提前失败，字体对账尚未调用，预置旧注册保留；入口只记录失败。暂停初次读取也能观察到“对账完成前旧注册仍在”的窗口。这证明代码的失败／等待行为，未证明现场实际发生过该异常或浏览器在此窗口的派发行为。
- **错误与计数边界已确认**：字体撤销拒绝会返回 `sync-failed` / 数量未知，不会成功报告 `disabled/0`。正常 userScripts 权限拒绝不阻止字体撤销。计数与撤销只覆盖 `vanishgeo-font-exposure-`；合成的其他 ID 引用同一资产不会被计数或撤销，但当前维护源未找到此类生产创建入口，不能把合成反例当成现场历史事实。Options 正常读取会重新对账，常规加载错误会把字体状态置为未确认，不能仅用“metadata 缓存了成功状态”解释当前现象。
- **已有 Chrome PASS 的关闭层级已校正**：`chrome-production-restored.json` 中的 Disable 实际由 runner 发送 `setExtensionEnabled(false)`，验证的是扩展配置总开关关闭及完整刷新后的原生结果，没有覆盖浏览器扩展卡片停用／卸载。实际 worker stop/wake 与更新证据有效，但不能代替该覆盖；先前冷启动 BLOCKED 继续保留。
- **现场关联仍缺失**：没有实际注册 ID 或后台初始化错误证据把上述机制与用户 Chrome 连起来。它们也不能单独解释“浏览器层面已停用扩展仍向新文档派发”；栈中的资产标签不足以定位浏览器的实际派发／停用路径。不扩大撤销命名空间、不新增页面配置桥、不进行推测性修补，继续暂停人工验收。

本轮直接调用维护源的 Node 模拟诊断 **6/6 断言通过**：关闭正常恢复、local 读取失败、session 读取失败、启动等待窗口、撤销失败、非所属 ID 同资产。它们是源码行为诊断，**不是真实 Chrome 验收**。`git diff --check`、3 份 JSON 解析、4 份变更记录空白及 `review/pending` 一致性检查通过。没有改动生产输入，未重复执行 npm 全套、类型或构建检查；既有通过证据按原范围保留。按本轮仅源码调查的范围停止了先前任务创建的 loopback 探针服务，原始临时证据与探针文件保留供未结案调查使用，未关闭用户浏览器或修改扩展状态。

## 当前：用户授权恢复（2026-10-20）

用户明确授权恢复VG-025固定内置名单，仅启用的HTTP(S) allowlist；custom、位置与Worker继续暂停，暂不提交或发布。此授权已记录task.json.meta.production_restoration_authorization，人验仍pending。生产常量false→true，compiler/注册对账/窗口补录债/旧文档快照不变；默认配置不自动开启。UI、推荐与诊断说明同步，诊断未采样字体仍UNKNOWN，manifest只改description不新增权限。

新增--production真实dist验证：实际worker/router/固定字体资产，不打开内存候选门禁；只额外放置空白扩展管理驱动页。正式结果和独立复核已在下段补充；此处下方授权前记录、18项资格和cold BLOCKED原JSON保留各自历史时间点。

### 授权恢复最终结果

- `npm run typecheck`、`npm run typecheck:tests`、`npm test` **218/218**、`npm run build`、Chrome dry-run、`git diff --check`通过。测试直接执行已批准生产wrapper/services，不再通过内存Vite把false改true；固定名单、custom撤销、独立语言失败、窗口/iframe债与失败恢复回归均保留。
- [chrome-production-restored.json](chrome-production-restored.json)：**真实Chrome155正式dist 9项PASS**，failure=null、cleanup=PASS。只新增空白扩展管理驱动页，实际manifest/worker/font资产原样加载；管理消息经真实router。覆盖固定注册和独立状态、首inline与普通字体/原生Canvas/设备基线、普通iframe及unsupported/CSP、不匹配origin、custom撤销与旧hook保留、实际MV3 worker终止后唤醒、临时副本版本update自动恢复、总开关禁用和同URL reload恢复原生。update未由driver手动register，当前浏览器冷启动仍未验证。
- 最初production runner对Chrome省略的空excludeMatches与compiler的[]严格比较而断言；已在runner按既有生产helper的相同空数组默认语义比较，未改产品匹配边界。最终JSON记录独立page=switch-required/font=ready及数量，不保存原始URL或设备基线。未修改Allow User Scripts开关，不把语言partial掩盖为全面同步。
- [chrome-services-approved.json](chrome-services-approved.json)：**9项PASS**，保留真实注销窗口iframe-only新文档债、注册失败恢复及人工暂停变体负对照；此模式为扩展上下文实际services，不冒充生产worker验证。正式worker资格由上项独立覆盖。
- VG026最终实际Options [chrome-restored-evidence.json](../10-20-vg-026-exit-recommendation/chrome-restored-evidence.json)：**8项PASS**，明确确认后实际字体注册ready、UI一致，无额外provider请求。旧门禁未授权时的JSON保留历史。
- 字体资产SHA256仍`762c2b2fd33232878e748608b455f54100498c950d6383322f6dbad1ad176860`，与既有18项字体surface资格相同，复用该证据；未重新把历史cold BLOCKED当PASS。
- fresh critical_reviewer独立只读确认本次true不扩大allowlist/vendor边界，custom/位置/Worker不生产；实际dist分支无直接helper/变体替代worker，诊断字体仍UNKNOWN。审计`20261020T093155Z-vg025-authorized-restoration-8a059991`已关闭且audit-verify通过，无异常。

VG025本地实施结束为**review**，已记录人工恢复授权，但人工验收仍pending，不标done。VG026/VG027继续review；VG027为研究交付，位置/权限/Worker仍NO_GO。真实浏览器冷启动、Chrome138、其他OS、真实action Popup和完整人工验收未新增覆盖。暂不提交、push或发布。隔离Chrome/server/CDP/profile均清理；正式JSON和标准忽略dist为保留交付物，本轮3个临时日志已删除，确认无本轮隔离Chrome进程残留。

## 授权前阶段：独立运行状态、正式对账与重载语义

已补齐原始目标的正式接线实施：fontRuntime独立状态/数量、Popup与Options动态字体详情、有限API覆盖、旧文档快照/UNKNOWN、page/font分表面重载债。沿用配置队列/恢复metadata与resolver；只增加可选报告及session表面标签，不增加权限、配置schema来源、页面桥或外部请求。生产FONT_FILTER_PRODUCTION_APPROVED仍false，自定义名单仅保存；不会把候选true作为恢复授权。原始生产恢复目标仍in_progress，剩余计划7.4人工授权决定，未把该门禁缩减为候选完成。

真实Chrome155正式接线隔离候选 [chrome-services-integration.json](chrome-services-integration.json) **9项PASS**、cleanup=PASS：native正对照；实际services保存/注册与字体独立重载；新service实例实际读回/恢复债；真实font UI renderer有限覆盖；custom撤销新文档/旧hook保留/不额外制造债；allowlist范围撤销；总开关关闭；未修改的生产false门禁撤销候选注册。临时打包仅改一处审批常量，实际services/config-resolver/storage/UI模块均复用；未授予userScripts，语言状态明确permission-required/partial，字体就绪不抹去该错误。非生产worker生命周期/浏览器冷启动/完整Options验收。字体资产hash仍762c2b2fd33232878e748608b455f54100498c950d6383322f6dbad1ad176860，与上轮18项资格输入相同并复用。

定向Node/VM 78/78，新增实际services候选事务回归覆盖注册失败、债保留、恢复、custom、无自动刷新等；全量npm test **218/218**、源码和测试typecheck、build、Chrome dry-run、git diff --check通过。build生成font资产9.82kB。共享UI输入已变化，VG026实际dist Options8项Chrome重新执行PASS，未复用旧UI证据冒充新源码。额外冷启动BLOCKED原证据继续保留，不重复盲试、不声称Chrome138/其他OS通过。

首轮独立复核确认两项P2：保存/注销窗口新页漏记、仅iframe命中而顶层URL不匹配漏记。已用compiler范围变化+所有HTTP(S)保守font债+预写pendingFontScopeChange窗口marker修复；reconcile注册后补查新页，失败保留marker跨中断恢复，成功才清除，previous保存旧签名marker。新增Node反例通过；真实Chrome在实际services注销前暂停，打开native的127顶层与首inline有hook的localhost OOPIF，注销后确认新父tab的font债及旧hook保留（第9项）。修复前8项不覆盖该窗口，已由9项正式证据替换。第二名fresh独立复核确认两项P2均已闭合，无新增代码阻断；额外只读内存验证覆盖local失败回滚/前签名marker、无关保存保留marker及tab查询失败后恢复，未写文件，不能当真实worker终止证据。未提交、push、发布，未打开生产字体/位置/Worker。当前阶段完成的代码和证据不等于人工验收或恢复已授权。

## 上轮：原生CSS解析与共享对账资格（历史阶段）

当前任务为 **in_progress**，原始目标仍是实施计划第7节的生产恢复。初轮候选review只代表一个已完成阶段，不代表整个VG-025已实施完成。当前尚须完成字体独立运行状态/UI、实际生产集成及字体配置变化的重载提示、对应集成证据，并满足人工恢复门禁。VG-026与VG-027原review状态不变。

- 新真实Chrome反例：六种合法字体shorthand中，原先有2种目标字体检查仍返回原生true；修复前记录shorthandBypassCount=2。FontFaceSet.check现在先执行原生方法，再用安装时捕获的CSSOM setProperty/getPropertyValue解析font-family，避免手写calc/行高/样式语法。解析用span不连接DOM，方法和style对象由闭包持有，页面不能提交配置。对照核验参考 [CSSOM接口工作草案](https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-setproperty) 和真实Chrome；不把草案单独当浏览器行为证据。
- 抽取syncFontScriptRegistration(desired)作为同一内部对账原语，生产wrapper仍由services队列调用并保留FONT_FILTER_PRODUCTION_APPROVED=false；无新增消息action或第二套配置来源。资格扩展控制面打包并调用实际helper，不再用runner自己的register顺序替代对账行为。
- 新增真实Chrome范围扩大/撤回、保存关闭配置到撤销完成的窗口、实际跨站OOPIF首inline及页面fake config/CSSOM方法与工厂替换。禁用窗口实测存在：local关闭配置已写入、尚未对账时新文档仍使用旧注册；对账成功后新文档原生，旧hook仍须重建。这是要明确提示的提交边界，不能声称保存与Chrome注销原子。

正式补充 [chrome-qualification-followup.json](chrome-qualification-followup.json)：Chrome155.0.8059.80，**18项PASS**，shorthandBypassCount=0、failure=null、cleanup=PASS。字体源SHA256为762c2b2fd33232878e748608b455f54100498c950d6383322f6dbad1ad176860，最终dist完全一致。普通字体/Canvas像素图像/设备及原生异常差分保留。首轮13项JSON不覆写，仅作旧源码的历史证据。

**额外冷启动检查未通过资格。** 使用`--browser-restart`真正关闭/重启同一临时Chrome后，transport正常，但Extensions.getExtensions未列出CDP加载的临时扩展，其页面也不可访问。正式 [chrome-cold-start-blocked.json](chrome-cold-start-blocked.json) 保留result=BLOCKED和失败断言；这不能判定字体注册持久化FAIL或PASS。未重新loadUnpacked来伪造恢复，也没有修改真实浏览器profile或私有偏好。后续需要能跨重启保留的正常扩展安装fixture/人工环境。默认18项与显式cold模式分开，不将scope较小的PASS替代冷启动资格。

本轮实际运行：字体VM定向7/7、font-scripts4/4；源码/测试类型通过；最终npm test **216/216**、build、Chrome dry-run、git diff --check通过，新增文件另查whitespace。VM只模拟已有12px样本的CSSOM接口，不用它证明CSS grammar。VG026 UI与推荐事务输入未变化，复用初轮真实Options8项证据，不重复执行。

fresh critical_reviewer独立只读核对新CSSOM入口、原生receiver/参数/异常顺序、闭包状态、对账撤旧及门禁、正式两份JSON与最终SHA；未确认本轮新增代码阻断，明确cold资格未取得。审计已关闭且audit-verify通过：`20261020T085923Z-vg-025-qualification-followup-09cecf33`。此审计只涵盖本轮1次独立复核，不混入初轮统计。

临时Chrome、两轮browser实例、profile、server、CDP均退出/清理。正式18项与冷启动BLOCKED证据保留，临时中间JSON/日志/本轮快照删除；dist保留为标准忽略构建产物。未提交、push、发布或开启生产字体/位置/Worker。

## 初轮候选记录（历史，以下13项/215项不代表当前源码）

2026-10-20，结束review，人工验收pending，**生产字体恢复仍未开放**。前置VG024和历史VG023均done。当前分支沿用 `codex/vg-024-remove-dnr-permissions`，HEAD短号 `de85aea`；开始时有VG028/VG024等累计未提交改动，已按任务前快照区分本轮增量，未reset/stash/改VG022/创建提交或发布。计划中同名VG023实际为VG028，历史语言时区VG023继续保留。

## 实现

- `font-exposure-entry.ts` 固定唯一内置厂商软件名单，无动态payload/storage/页面桥/文档ID；普通HTTP(S)非opaque才安装。
- 构建生成独立自包含 `dist/font-exposure/filter.js`，无import或运行时编译。固定entry从无副作用的 `font-families.ts` 导入名单；config-model import/reexport原符号。发现直接导入config-model会把顶层默认规则初始化一起打包，已移除该无关数据依赖并加生成守卫。
- `font-scripts.ts` 复用resolver的启用allowlist与父子域排除，MAIN/document_start/allFrames、禁止origin fallback、固定一个包内文件。对账由现有services队列拥有，先撤旧/范围变化，再注册并读回。**FONT_FILTER_PRODUCTION_APPROVED=false**：当前实际只撤销该功能旧注册，不派发候选；custom无生产派发。读取/撤销不确定明确失败并合入现有同步报告，不声称旧文档清理成功。
- 不接管getContext/绘制/像素/导出/设备；旧hook无法因注销撤回，旧文档与BFCache须完整重建。首版不承诺OffscreenCanvas、DOM/local()/像素探测或Worker。

## 已定位并修复的候选问题

1. 目标measureText临时切字体后才转换文本，用户toString重入绘图可观察fallback并污染绘制。已先取得同一次原生转换结果后再选择测量字体，保留转换更改的新font。
2. 独立复核指出反向路径：初始普通字体、toString改目标字体可绕过快捷透传。补反向回归并移除该快捷路径。
3. 简单预先模板字符串转换在真实Chrome对象返回Symbol时丢失原生错误前缀。改为observeConversion：空target Proxy把getter/转换方法委托给原对象且保留this/hint，由原方法执行DOMString与错误；只在primitive返回后切fallback，finally恢复。FontFaceSet.check复用同一观察器。
4. 独立复核提出合法CSS escape同名字探测，真实已加载合成MiSans别名证实；增加family escape等价处理及回归。未把这扩写为完整CSS shorthand解析能力。

## 实际检查

- 初始 `page-scripts + runtime-modules`：8/8；字体定向最终7/7；font-scripts3/3；后台集成42/42；wiring/runtime-build定向26/26。
- `npm run typecheck`：通过；最终build内也执行。
- `npm run typecheck:tests`：通过。首次新增后台测试漏传必需模板参数，已补真实构造参数后通过。
- `npm test`：最终215/215，0失败/skip。第一轮发现旧wiring整文件expected[A-Z]把recommendation.expectedVerifiedAt误当诊断泄漏，以及watch临时fixture没复制新增font-families依赖；已将断言限定到实际预期数据字段，并复制真实构建依赖。没有放松权限/verified/原生边界。
- `npm run build`：通过；35模块，固定字体资产9.27kB，六个原入口保留，content空chunk不变。
- `npm run test:e2e:chrome -- --dry-run`：通过，仅构建/清单，非浏览器验收。
- `git diff --check`：通过；新维护源及正式任务文件另检查行末空白。

## 真实 Chrome 资格证据

`node --import tsx scripts/chrome-font-filter-smoke.mjs --output .trellis/tasks/10-20-vg-025-font-filter/chrome-evidence.json`：Chrome155.0.8059.80，最终13项PASS、failure=null、cleanup=PASS。Chrome自身sandbox未关闭，新临时profile，最小MV3权限为已有scripting/localhost子集；直接使用当前compiler及同一生成器，不加载生产worker或用户档案。最终dist资产SHA256与该JSON完全一致。

分别覆盖：原生正对照；顶层首inline；本机Arial/Liberation字体加载为合成MiSans别名后的已存在目标正对照（含CSS escape）；普通中文/拉丁字体完整所测metrics、Canvas绘制像素/图像、语言时区/设备观测和Offscreen函数引用基线；普通HTTP iframe与srcdoc/blank负对照；严格nonce CSP；非匹配origin；document.open保留旧hook；descriptor替换/删除/freeze及realm隔离；注销完成后旧hook保留与同URL reload原生；实际BFCache hit保留旧快照；同路径临时版本update并显式重注册；禁用后的document.open原生。

原生错误全文只在内存差分，含缺参、Symbol、对象返回Symbol、转换抛错、非法receiver及无效shorthand；正式JSON不保存像素/导出/设备原值、IP、位置、个人路径、文档ID或用户配置。只访问loopback，无字体公网下载、provider/STUN；Chrome自身后台网络未全量监控。早期失败采集已由最终完整正式证据替代，原因保留于上文，未改写历史任务证据。

## 独立复核与剩余门禁

fresh critical_reviewer只读检查任务前增量、完整相关源/测试/证据；已报的反向转换与CSS escape均修复，最终observeConversion/错误保持源码再审未确认新阻断。完整CSS shorthand、首次页面篡改、冷启动/跨origin/OOPIF完整矩阵未资格化，Chrome138/其他OS亦未实测。隔离13PASS不能当实际生产恢复、全字体隐藏或已获人工验收。按实施计划7.4保持人工生产恢复门禁，用户审阅此候选后另行确认；不自动把review改done。

临时Chrome/profile/listener/CDP均由runner回收。dist保留供人工加载，是标准忽略构建产物；正式JSON与任务记录保留。其余本轮快照、测试日志和临时文件在复核结束后清理，原有工作树、缓存和依赖不清理。没有提交、push、merge、tag、发布或变更用户日常浏览器。

本轮独立复核与实施的Audit Bundle已关闭且audit-verify通过，无异常：`audit_id=20261020T082834Z-vg-025-027-80abaa21`。摘要仅包含本轮派发，不混入前序任务人工验收；review不代表done或生产恢复。


## 授权前阶段独立复核与清理记录

审计 `20261020T091407Z-vg025-production-integration-8576a36e` 已关闭且audit-verify通过：两次fresh只读critical_reviewer，首轮因两项P2记rejected，修复后第二轮accepted；保留首轮历史异常，不将其改写成一开始通过。无剩余活跃worker。最终218测试及本地门禁、Chrome接线9项、VG026实际最终dist Options8项通过；原字体surface18项输入未变复用。隔离Chrome/server/CDP/profile均清理，本轮4个/tmp临时日志已删除，正式JSON与标准忽略dist保留。实际diff/status检查没有本轮临时仓库产物；累计VG024/VG028等用户改动保留。

当前目标仍未完成生产恢复：计划7.4人工恢复授权尚未取得，常量仍false。当前in_progress，未标review/done，未提交、推送或发布。只需在可审查代码与证据基础上取得具体恢复决定；不以无限加测代替该授权。


## 2026-10-22 简繁中文字体固定名单扩展

### 授权及实际变更

用户明确授权把目标检测站的27项简繁中文字体加入现有生产固定过滤名单，仍然只对白名单生效。实施前确认manifest中的VG-023、VG-024均done；本轮VG-025置in_progress。未继续历史G05/G07现场调查，也未实施VG-026/027后续任务。

`src/shared/font-families.ts`保留单一名单和vendor-software配置键，在原16项厂商/软件之后加入19项简体、8项繁体，共43项。配置、Popup/Options只读列表、推荐和包内生产入口共用该名单；v3内置模式归一化使用新名单，保留原开关和custom名单。v2旧默认集合仍是独立历史识别常量，未改变迁移判定。未修改resolver、注册compiler、权限、host scope、生产hook算法或数据流。目标以外字体及Canvas绘制/像素/导出原生，DOM/local()/OffscreenCanvas/Worker不扩展。同步使用说明、诊断文案与稳定合同。

允许字体名单属于不同设计：当前只在measureText/check两条路径过滤明确目标，网页也可逐个猜字体并通过排版/绘图验证，不能把这次固定过滤扩展解释为完整虚拟字体库存。测量可能与原生绘制不一致，影响依赖文本宽度的排版。

### 本轮验证

- 定向`npx tsx --test tests/config.test.ts tests/font-scripts.test.ts tests/anti-detection-runtime.test.ts`：首次43/44通过，新增matches断言预期顺序与既有resolver输出不符；按实际合同修正后`tests/font-scripts.test.ts`4/4通过。其余相关结果沿用，最终完整套件覆盖。
- `npm run typecheck:tests`通过。
- `npm run build`通过，包含`npm run typecheck`；生成正式font-exposure/filter.js，未手工修改dist。
- `npm test`首次226/228，两项失败为本轮更新诊断标签及UI文案后的旧断言；同步对应期望后228/228通过。没有放宽权限、验证或行为断言。
- `git diff --check`通过；最终任务记录完成后再次核对。
- 真实Chrome：`CHROME_BIN=<本机CfT149二进制> CHROME_EXPECTED_VERSION=149.0.7827.55 node --import tsx scripts/chrome-font-filter-smoke.mjs --production --output .trellis/tasks/10-20-vg-025-font-filter/chrome-cjk-font-expansion.json`，12项PASS。

Chrome证据见[脱敏结果](./chrome-cjk-font-expansion.json)。使用Chrome for Testing 149.0.7827.55及独立临时profile，加载实际dist的manifest/worker/字体脚本，临时副本仅增加空白扩展驱动页。每项目标均通过本机Arial/Liberation Sans加载为合成FontFace别名，43项原生正对照均可探测；完全复现目标站点72px、同一合成测试文本、monospace/sans-serif/serif、差值大于0.5px算法。白名单内全部目标宽度不命中且check=false；白名单外及关闭后新文档全部原生可探测，ctx.font恢复。另有首inline、普通iframe、特殊文档负对照、CSP、非目标字体与像素/图像/设备原生对照、custom不派发、worker唤醒、扩展update、关闭及同URL刷新。

字体产物SHA-256：`5292501be7b4e9f2a4ca9ea2774e575db54077ae8b503b6559c311f11dffc2db`。只访问loopback与本机字体，不请求provider或下载字体；不读取用户profile，不保存字体库存、原始像素/设备值、扩展ID或真实路径。浏览器自身后台网络未全量监控；临时浏览器/副本/profile均已清理。没有在用户当前Chrome或外部目标网站现场运行，不能据此判定现场已更新或分数归零；Chrome138、其他OS、真实action Popup、完整人工验收及实际冷启动不在本轮证据内。

独立critical_reviewer只读复核已完成，无具体可触发缺陷；复核直接核对完整测试日志、Chrome证据及字体产物摘要，未重复运行测试。实现与本地验证结束，manifest/Trellis状态恢复review，人工验收仍pending，不暂存、提交或发布。审计ID：20261022T015835Z-vg025-cjk-font-list-bec30a5f。

## 2026-10-22 顶层 Canvas 测量允许名单（当前增量）

本聊天用户明确授权最小实现，前置 VG-023/VG-024 均 done。仅改变已启用 HTTP(S) 白名单顶层 measureText 的字体选择；允许 monospace/sans-serif/serif，保留允许项顺序及样式，无允许项回退 sans-serif。固定生产 entry 按 window/top 身份传入包内策略；完整维护 runtime 未传该参数时继续旧行为。FontFaceSet.check、iframe、43项原名单、配置 schema、开关门禁、注册范围/权限均不变。复用字体解析、原生 TextMetrics、单次转换观察及 finally 恢复，不添加 DOM/构造器/HTML 写入 hook。Popup/Options 提示测量与绘制差异及排版/导出兼容性。

检查：
- 定向 runtime-build/font-scripts/wiring：31项通过。
- npm run check：typecheck、typecheck:tests、npm test 229/229（无失败/跳过）及生产 build 通过。
- 实际 dist 的 CfT149.0.7827.55，独立临时 profile，`node --import tsx scripts/chrome-font-filter-smoke.mjs --production --output .trellis/tasks/10-20-vg-025-font-filter/chrome-canvas-measurement-allowlist.json`：15项PASS，cleanup PASS。目标包内字体资产SHA-256与证据一致。
- 覆盖真实HTTP首inline、三个允许字体原生、43项已知字体的目标站三基线算法、已加载未知合成别名、顶层/iframe区别、check非目标透传、总开关/字体开关/站点规则/custom/未匹配域、TextMetrics/font恢复、转换和receiver异常、绘图/像素/图像导出透传、严格CSP及实际MV3恢复。只保存布尔和摘要，不记录本机宽度、字体库存或用户配置。
- git diff --check 通过。

证据：[chrome-canvas-measurement-allowlist.json](chrome-canvas-measurement-allowlist.json)。本轮复现已核对的目标站字体算法，没有触发线上网站的完整检测、广告或STUN请求；没有操作用户Chrome，没有进行首读旁路实验，不覆盖Chrome138、其他OS/浏览器冷启动或完整人工验收。生产实现与本地验证完成后维持review/人工验收pending，不提交发布。

独立只读复核：critical_reviewer 未发现本轮可触发缺陷，检查顶层/门禁、字形关键字、原生转换/font恢复及check/iframe旧行为；另以内存write:false产物与dist/Chrome资产hash相符。复核后仅补强执行器的iframe首inline已知字体回退及其他具名字体原生断言，并把历史运行器的测量期望改为允许名单回退，实际Chrome15项重跑PASS；生产源未再变化，本地门禁证据复用。审计Bundle校验PASS：`20261022T051928Z-canvas-measurement-allowlist-review-18823f9e`。本次增量结束review、人工验收pending，未暂存/提交/发布。

## 2026-10-22 真实目标网站两项字体定向验收

用户明确授权直接访问 https://fuck-claude.vercel.app/zh/，只验收本次字体改动。使用真实 CfT149.0.7827.55、独立临时profile，直接加载当前dist原目录与实际worker，通过原有管理消息设置仅该域名的规则及字体开关，语言/时区关闭、WebRTC保持default；没有操作用户Chrome现场或恢复历史G05/G07取证。

关闭过滤和开启过滤分别新建目标HTTPS文档。通过Debugger私有句柄在页面完成加载及document.fonts.ready后调用网站原有注册表中的fonts/vendorFonts两项detect；没有替换网站脚本或检测函数、没有点击会执行全部十项的按钮，也没有调用其余指纹检测。屏蔽第三方广告/统计请求；未存储原生字体名称、宽度或IP。

| 项目 | 字体过滤关闭（原生对照） | 开启新构建并重建页面 |
| --- | --- | --- |
| 中文字体 fonts | 命中，score=1 | none detected，score=0，未命中 |
| 国产厂商字体 vendorFonts | none detected，score=0 | none detected，score=0，未命中 |

厂商字体在该验收机原生状态已无命中，本次不能将其当作从有到无的正对照。两次使用同版真实站点脚本（SHA-256一致）；开启时Chrome实际执行的MAIN字体文件与当前dist及维护源生成结果完全一致。两个文档loader不同，关闭对照无字体文件执行，开启后有同hash文件执行。当前字体资产SHA-256与上一轮本地验收相同。

证据：[chrome-live-site-font-acceptance.json](chrome-live-site-font-acceptance.json)，result PASS、cleanup PASS、verifiedFilesUnchanged=true。没有修改生产代码、权限、配置模型或内核；未拓展旁路实验及其他指纹项。实际网站验收限于上述临时Chrome与两项原检测函数，不是该网站完整十项UI检测或其他OS验收；任务仍review，人工确认状态未擅自改为done。

## 2026-10-22 人工验收与收尾

用户在本聊天明确确认：“本次字体允许名单改动验收通过，更新对应任务记录并收尾。保持当前最小范围，不再增加旁路或其他指纹实验，暂不提交或发布。”据此将稳定化主清单 VG-025 更新为 done、Trellis task.json 更新为 completed，completedAt=2026-10-22；人工验收记录为 accepted，证据与任务路径保留原位。

本次通过的交付范围：仅已启用 HTTP(S) 白名单顶层页面的 measureText 使用 monospace、sans-serif、serif 固定允许名单，无允许项回退 sans-serif；FontFaceSet.check 与 iframe 沿用现有行为，既有总开关、字体开关、规则及模式门禁保持。没有内核、权限或配置项扩展。

复用已完成且生产输入未变化的 typecheck、typecheck:tests、229/229测试、生产build及独立只读复核；真实Chrome定向15项见[本地字体验证](chrome-canvas-measurement-allowlist.json)。[实际站点验收](chrome-live-site-font-acceptance.json)确认当前字体资产已执行、页面已重建，中文字体从命中变为 none detected，厂商字体开启后亦为 none detected（该环境原生对照本来未命中）。两份证据均PASS/cleanup PASS，当前dist字体摘要与证据一致。此次收尾只更新任务记录、核验记录一致性并执行git diff --check，不重跑浏览器、旁路或其他指纹实验，也不重复生产构建测试。

边界：人工通过仅针对本次最小改动；不追认全部iframe首读隔离、其他指纹、Chrome138/其他OS完整验收。历史原用户Chrome现场仍为UNCONFIRMED、G05/G07仍UNKNOWN、自动取证仍停止；其他任务状态和人工验收不变，不启动后续任务。未执行暂存、提交、推送、归档迁移或发布。工作区原有未提交改动保留。
