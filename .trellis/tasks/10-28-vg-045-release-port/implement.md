# VG-045 执行记录

- 基线 `57d42df`，初始工作区干净；源分支固定 `5b61905`。
- 当前分支 `codex/port-release-131-20261028`，不修改主工作区既有运行状态。
- 本 worktree 不含 workflow/spec 正文及项目技能副本；复用已读项目合同、现行源码、测试和分支证据，不将缺失模板当成规范。
- 第4阶段用户已选择以 release 行为为目标，逐项制定迁移。当前开始第1阶段，尚未改变第4阶段默认行为或权限。

## 第1阶段

- 已实现稳定冻结的 languages 快照；增加柏林、上海、纽约，原三项 ID/取值保留。
- 配置体检在扩展诊断页分析；修复只发 finding ID，后台 mutateConfig 重读并串行保存。
- 角标按标签页投影重载欠账，覆盖右键菜单、配置保存及生命周期事件；未知不写为实际生效。
- jsdom 26.1.0 / 类型 21.1.7 为测试依赖，MIT，Node>=18；已核对 npm 元数据和官方 release 文档。真实 HTML 与完整维护源事件/保存路径测试通过，不代表浏览器验收。
- 首次全检433通过、1条旧接线正则失败（总434）；适配接线并补菜单测试后，全检435/435、源码及测试类型检查、构建通过。
- 独立复核发现并修复三项角标P2：未匹配顶层iframe欠账、右键菜单刷新、配置故障被欠账遮蔽。最后定向6/6通过，独立复核确认闭环；总体最终全检仍在后续阶段完成后执行。

## 第2阶段进行中

- 新增共享 Date 墙钟换算，页面/生产Blob/维护Worker复用。保留原生参数转换、子类与 strict/compatible；按ECMAScript UTC规则处理重叠/跳时。
- 依据：https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html#sec-utc-t 。目标时区原生Node Date作为独立对照，不称Chrome验收。
- 仅为固定43族增加显式本地化别名，不引入分支额外平台表或宽泛字重猜测；全部目标被移除时改用合成缺失字体族回退，保留既有转换/重入/恢复顺序。

## 第2阶段本地验证

- Date共享转换覆盖页面、生产Blob和维护Worker；目标时区原生Node作为独立对照，纽约/Lord Howe/Apia包含DST重叠、跳时、年份、setter、子类及转换异常。显式偏移小数秒、非ISO本地字符串、别名原型污染问题均已修复并复核。
- 运行时相关83项定向通过；后续追加Date/字体定向通过。没有将Node/VM写为Chrome验收。

## 第3阶段

- 新增批量普通/persona出包、矩阵、原生形状对照入口、原生环境启动器、Lint/c8；普通包沿用原发布审计，persona独立按明确preset/domain及逐文件字节验证。
- 修复独立复核提出的发布门禁顺序、ZIP目录非法路径、进程组组长先退出仍须回收子进程的问题。复核确认三项闭环。
- 完整覆盖率门禁445/445通过，七个核心模块逐文件分支85%门禁通过。总lines60.55%、branches86.52%；VM/生成函数/DOM代码归因不完整，不当作Chrome覆盖率。
- 普通包首次实际准备经过445测试与构建后，在原审计器误把夹具模板字符串的import当模块依赖处停止。已改用TS AST，拒绝所有不能静态确认的真实动态import，并补正负例；尚待最终实际出包复跑，不标该ZIP通过。

## 第4阶段 C1-C4

- 用户选择release行为目标，逐项迁移见docs/development/release-131-contract-migration.md。
- C1原生fonts.check及授权后queryLocalFonts结果过滤；C2三层字体、schema2/3及release4到5、参数化模板与Blob名单；C3定位私有WeakMap/原型getter/toJSON零ownKeys。
- 独立复核发现并修复popup无关保存覆盖layers、固定/参数化反向切换双重安装窗口、AST非字面量import漏检；111/111定向通过，复核确认闭环。补schema5模板重复启动零写回/欠账、双向撤旧先行和真实DOMnone/false保留。
- 用户于2026-10-28另行明确接受release自动真实定位授权和spoofPermission=false原生传感器委托，C4已接入contentSettings与原队列。旧授权先撤，新模板确认后授予，授权或模板失败分别撤销；allow/block/ask清理+重建+读回，失败可见。位置不可解析下发unavailable拒绝，不落回原生。
- 定向119/119通过；独立复核C4未发现确定新阻断，真实Chrome授权/旧用户设置/升级/策略优先级仍未验收。
- C4首轮定向遇到权限通配读回探针循环：将祖先误作更具体子规则，已限定只检查后代；停止本次卡住测试进程，修复后119/119通过。

## 第4阶段 C5

- 已接入自有5分钟alarms及后台出口跟随，仅有效auto规则触发；沿用provider顺序与完整结果验证。网络不占配置锁，提交前验证generation及完整配置签名，旧响应不能覆盖新配置；手动规则/原档案/手动候选保留。
- pending/failed/ok状态只保存在session，不写IP或位置到证据；失败保留已验证配置并报告partial，重复唤醒冷却，显式retry及闹钟可force。关闭时reconcile立即取消自有闹钟。
- 相关113/113通过，源码类型检查通过，独立复核中。尚未作真实Chromealarms/网络验收；C6热更新和C7扩大Worker尚未实施。
- 当前所有迁移改动均在工作分支未提交；没有本轮push/tag/Release。最终全检、普通/persona实际出包及真实浏览器定向证据仍待收尾。


## C6/C7候选收口及最终证据

- C6已接入当前文档控制器、descriptor持有/恢复、退休句柄原生透传和独立frame只读桥。后台仅用已确认且对应当前storage签名的快照，网页读取不启动管理队列/策略写入；未知不能当clear。保存通知立即回复，页面独立回读；每frame合并在途请求。首屏与更新使用同一parser，避免同值回拉重装。
- 定位已交付Position寿命与请求hook分开，保留只读WeakMap适配器；同文档更新/关闭的待交付oneshot可见后恰好一次失败，退出不回调。保留隐藏/freeze/BFCache边界。
- C7按用户确认接受Shared跨页实例分离；同源HTTP classic/module、Shared和自身Blob递归使用创建时快照。Window使用baseURI并在选项getter后重算；classic importScripts保留原HTTP基准，模块静态prelude/业务依赖保留相对import与TLA。Shared模块prelude保留整代，extendedLifetime/TrustedScriptURL/外来Blob等保持原生未覆盖。
- 独立复核的保存回读死锁、网页触发全局对账、未知快照误clear、首回拉同值重装、历史Position失效、pending oneshot悬空/可见性交错、Shared prelude早撤、baseURI及importScripts异常合同均修复；复核最后确认无剩余确定代码阻断。关键定向18/18通过。
- 实际Chrome发现空excludeMatches会被省略，桥回读签名已统一空数组并补幂等反例。生产实际font参数传递曾被构建模板遗漏，已修复并由生成函数执行测试保护。
- 最终完整门禁两次均488/488、lint、源码和测试types、build通过；最终core coverage逐文件分支85%通过，总lines62.69%/branches86.21%（生成/VM/DOM归因边界保留）。diff --check通过。
- 正式dist在隔离Chrome155通过10阶段、首inline、同文档更新/关闭、顶层/普通iframe、HTTP/Blob classic/module与Shared、旧formatter/Worker快照、模块依赖/TLA、同页Shared复用/跨页与配置代次分离；Options/action Popup实际保存链通过。矩阵intl/native-parity均PASS，后者状态OBSERVABLE而非不可检测声明。
- Persona固定LT包禁用实时桥并移除普通后台、管理入口及API权限；Chrome只验证Singapore loopback样本，6个ZIP不据此称逐包浏览器验收。
- 普通包现行审计PASS，6个persona独立预期/路径/文件字节审查PASS；都只在本机准备，未发布。最终结果、SHA和原始压缩证据见docs/development/release-131-evidence/。
- **尚待用户选择**：原HTTP入口响应CSP不再作为Blob Worker自身策略。Chrome实测connect-src none：native blocked、wrapped allowed。已提交独立确认；此前Shared身份确认不替代CSP授权。本任务保持in_progress，未提交/推送/合并本轮迁移，不能标review或done。
- 未覆盖：Chrome138、任意CSP/沙箱、完整重启/升级/BFCache、实际传感器委托及外部provider定时网络切换、真实网站。没有改写VG-043/044状态或历史VG-041结论。


## 用户CSP确认与Git收尾准备

2026-10-28用户明确回复“接受release的Blob入口CSP语义，并在文档明确标注”。C7最后一项合同选择已确认，AGENTS/CONFIG_GUIDE/PERMISSIONS及迁移说明已同步。四阶段本地实现与验证结束，VG-045进入review，人工验收仍pending，不标done。

收尾发现Intl runner直接临时加载dist会写Chrome DNR的_metadata索引缓存，使浏览器整体目录摘要与普通ZIP不同。逐文件核对仅该缓存多出，维护产物字节均一致；runner已改为复制到本次临时目录再加载，移除本次写入的dist缓存，重新执行矩阵并核对普通ZIP与正式浏览器的dist指纹。此修复不触及生产runtime。

依据用户最初“提交并推送、有分支合入main”及随后明确要求release功能代码迁移的授权，准备提交全部已审查的任务路径，保持VG-043/044原状态，不打tag或发布。Git实际提交及远端结果以收尾命令为准。


## Git实际收尾

- 功能提交9c4cc578dfc0d69b7dc40cff137f8b996da4dc2f：131个已审查任务路径。
- 主工作区原本clean且位于57d42df；确认新增路径不会覆盖其untracked/ignored文件后，main以--ff-only合入功能分支。origin/main已成功推送至9c4cc57，未使用force、历史ours合并或丢弃主工作区改动。
- 最终普通ZIP与最终Chrome正式dist指纹一致；Intl runner改用临时副本后不再向dist写DNR缓存。7个本地review包保持未发布，未打tag。
- VG-045仍为review，人工验收pending。此处仅补实际Git事实，未改运行时或重复执行测试。
