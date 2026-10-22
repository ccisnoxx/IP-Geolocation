# VG-029 执行与交付记录

2026-10-22。用户明确授权按本会话方案完整恢复地理位置，修复现有问题，完成真实Chrome验证后交人工验收，保留语言/时区/字体，不push、不发布。正式依赖VG-023/VG-024/VG-028均done。保留任务前全部未提交改动，使用仓库外临时基线分离本轮diff；未暂存、提交、push、tag或发布。

## 最终实现

共享resolver新增位置独立最小payload，manual/verified auto仍单一配置所有者；语言时区payload不含坐标。构建新增自包含geolocation入口，复用userScripts内部compiler/reconciler，独立namespace和geolocationRuntime状态，不恢复完整runtime/Worker或页面桥，不增加权限/host scope。

services同一串行队列持有位置注册与重载债。pendingGeolocationScopeChange/previous覆盖保存窗口及iframe；实际注册漂移/首次恢复同样在任何Chrome变更前直接await预写marker，失败不改定位注册；marker跨最终checkpoint失败或worker重启补全部HTTP(S)tabs。启动配置读取失败时清理所属位置namespace，保留其他userScripts及原始错误；无法确认清理则明确报错。

runtime修复选项单次WebIDL转换、receiver/descriptor、task调度、timeout/cache、高精度、取消及success异常，不请求原生定位；同文档位置/随机偏移固定。隐藏/冻结/BFCache暂停与恢复，pagehide退出清理，静态watch不固定轮询。spoof=true合成权限EventTarget保持this/target/currentTarget/onchange一致，不转发原生权限变动；false查询原生且交付前复核granted。合成对象原型兼容但无原生内部slot，不伪装反射或isTrusted。

UI保持短定位状态与“修改后重新加载网页”，完整配置/隐私/权限/当前spec同步恢复合同；历史NO_GO证据和其他任务人工状态不覆写。

## 独立复核与修复

critical_reviewer只读比较任务前基线与候选。发现P1：启动读失败清理定位后，故障期间新网页可能漏重载提示；采用beforeChange可靠预写marker修复。新增读取失败期间新网页恢复、预写失败不改注册、register成功后checkpoint失败与新worker恢复的回归；审查者独立重跑原反例，恢复ready/reloadRequired=true并具geolocation债，确认关闭。

发现P2：watchPosition的options getter重入会重复watch ID并取消错监听。改为先完整转换参数、再同步分配递增ID；新增内外分别取消/恢复回归；审查者独立复验ID不同且只交付未取消对象，确认关闭。最终runtime SHA1 044acaec3b57a76ef7f8ee5fc2903d4190e91d65，源码审查未确认剩余阻断。真实Chrome亦有独立getter重入回归。

## 实际验证

- npm test：248/248，0fail/skip。
- npm run typecheck、npm run typecheck:tests、npm run build与git diff --check均通过；后台/page-scripts定向60/60、runtime定向15/15。
- node scripts/chrome-geolocation-smoke.mjs --output <脱敏JSON>：Chrome155.0.8059.86/macOS arm64/headless，30/30 PASS、exit0、failures=[]、cleanup PASS。
- 原始JSON完整保留chrome-evidence.json（SHA256 0296e3f07385e094798b619210334a66d6ba58c4a35b3bec260b5f938dad9350），实际dist48文件SHA256 a08136c3bd7ed8180da9ae665d1a8c6c73b571e99bbea1751cf078a2741df861。
- 首inline调用、三方法、权限事件、真实BFCache命中、worker stop/wake及扩展update恢复、关闭/删除规则原生负对照、语言时区字体均实际通过。HTTPS origin为本地CDP fixture，不代表TLS传输；Chrome138/其他OS/完整浏览器冷启动和全故障矩阵未验。
- 用户现有Chrome经正常扩展管理UI重新加载，面板定位/语言时区/字体/WebRTC均已同步并提示重新加载旧网页；未改变用户规则、坐标、档案或站点权限，未请求真实位置。这是UI接线证据，不冒充用户页面定位效果人工验收。

验收步骤与范围见acceptance.md。状态仅review、completedAt=null；待用户人工确认，不自动done，不提交发布。

最终独立证据复核确认30项均有实质断言，并独立重算当前dist指纹一致；无剩余已确认阻断，可交人工验收。复核指出旧fixture的nativePositionCalls字段是常量而非测量值，已改名fixtureInvokedNativePosition并明确其仅表示fixture意图；未改通过条件。同一最终dist重采仍30/30 PASS、exit0、cleanup PASS；本realm无原生取位调用由源码/VM计数支持，哨兵仅证明未交付原生结果，不把JSON字段误称浏览器调用计数。

## 当前用户 Chrome 现场验收补充

2026-10-22，按用户指令在现有profile的匹配网站实测。用户在配置页依次保存固定(0,0)、(1,2)，并恢复自动模式和1000米随机偏移；网页端确认get/watch分别匹配两组坐标，保存但未重载时保留旧值，原标签完整导航后切换新值，新文档对照同样通过。语言en-US/en、洛杉矶时区、四项字体check/measureText过滤、通用字体可用及度量区别均通过，网站自身最终扫描一致。配置页受工具协议限制，未自动修改或绕过限制；部分早期工具暂停导航未作为通过证据。恢复阶段原精确坐标脱敏，仅比较原粗略区域与临时坐标退出，未测随机半径。临时标签和DevTools关闭。

正式脱敏证据与截图新增current-chrome-evidence.json、current-chrome-regression.jpg；本轮仅补交付记录，源码未变，复用已有测试构建证据。最终人工签收仍pending、任务review；未提交、push或发布。

## 2026-10-22 人工验收通过与收尾

用户在本会话明确确认“验收通过”，并要求VG-029标记done、同步清单和验收记录、完成收尾，不push或发布。以此将唯一跨任务清单状态改为done，human_acceptance改为accepted并记录用户及2026-10-22日期；Trellis按本项目生命周期约定为completed、completedAt=2026-10-22。此前review/pending是签收前历史状态，以本节与acceptance.md签收记录为当前结论。

本轮仅同步VG-029状态及交付记录，保留原始证据和已知覆盖限制，复用此前248项测试、类型检查、构建、独立复核、真实Chrome30项及当前profile现场验证。任务资料保留原路径，其他任务状态和已有工作不变；未暂存、提交、push或发布。

核对task.py finish及after_finish hooks后执行finish，已清除本会话指向VG-029的活动任务关联；该操作只清指针，无提交hook。任务资料不移动，清单与证据链接保持有效。
