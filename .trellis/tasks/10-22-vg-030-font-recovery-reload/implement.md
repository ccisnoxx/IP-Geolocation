# VG-030 执行记录

当前状态：2026-10-22用户人工验收通过，manifest done、Trellis completed；确认原文见[人工验收确认](#2026-10-22-人工验收确认)。

## 开始

- 2026-10-22用户明确授权修复并真实Chrome验证，依赖VG-025/VG-029已done。
- 根因：persistConfig只按配置变化预写字体窗口；正常reconcileFontScripts未在实际注册漂移前通知services。恢复时配置不变也会新增字体注册，故障期间文档遗漏重载债。
- 计划沿用既有session metadata字段及services队列，字体对账提供变更前回调；不新增平行事实来源。
- 原工作树脏改动已逐文件哈希及共享文件备份至系统临时目录；本任务不暂存或提交。

## 修复

- font-scripts在实际撤销或新增注册前await可选beforeChange；无实际差异不调用。services队列提供预写pendingFontScopeChange的回调，普通对账和legacy清理失败分支接入。
- 启动读取失败时仍直接清理所属字体namespace，不依赖local/session可读写；恢复新增注册前再持久化窗口，补录普通HTTP(S)标签页。权限、注册范围、配置schema和字体资产未变。
- 新增9项定向检查，修复前9项失败、修复后9项通过。覆盖local/session读取失败、匹配顶层/仅iframe命中、预写失败零变更、注册/查询/最终checkpoint失败跨services重启补录和幂等。

## 本地验证

- npm run check：源码typecheck、测试typecheck、257/257 Node测试、Vite构建全部通过。
- runner补证修改后node --check及定向extension-wiring测试通过；生产源码/测试未再改，复用上述完整门禁。
- git diff --check通过；本轮仅修改字体注册恢复所有者及测试/runner/规范/任务记录，未暂存或提交。

## 真实Chrome验证（2026-10-22）

Chrome155.0.8059.86、macOS arm64、headless、独立临时profile，均cleanup PASS；未访问或修改用户个人Chrome/profile。不请求出口provider、真实定位或STUN，Chrome自身后台网络未全量监控。

| 验证 | 结果 | 实际范围 |
|---|---|---|
| 字体启动故障与恢复 | 12项PASS | 真实MV3 worker stop/wake；临时worker副本合成local-first/local-config/session读取拒绝、预写/最终checkpoint拒绝；成功注册、撤销、回读和HTTP文档执行使用Chrome原生API |
| 固定字体正常生产接线 | 15项PASS | 原dist worker/字体资产保持，仅临时副本增加空白管理驱动页；43项字体加载正对照、存在性/宽度过滤、三种通用字体、顶层允许名单与iframe既有策略、注册/撤销/update |
| 定位及联合回归 | 30项PASS | 未改写的实际dist；定位首读/get/watch/clear/重入/权限/策略、坐标A→B旧快照与重载、BFCache、worker/update、撤销及语言/时区/字体回归 |

字体恢复三种读取故障均验证：清理后新开匹配顶层和未匹配顶层含匹配OOPIF→恢复注册且reloadRequired=true→两标签都持有font债→旧文档保持原生→完整reload后顶层/iframe字体过滤，未匹配顶层仍原生。通用字体完整metrics和普通字体check与原生对照相等。prewrite失败无实际注册；最终checkpoint失败保留真实session marker，worker重启后补录新页。

实际原dist48文件SHA256为`3fbb0da2b07cd2b4e30791f7c1fdd3a5a6828fa713fbc26362a7343a5ecccf3c`；字体故障runner在复制/插桩前锁定该指纹，worker与字体资产SHA单独记录。合成存储API拒绝不等同真实磁盘损坏；未验证Chrome138、其他OS、所有冷启动/故障组合或用户个人Chrome本轮现场。合成定位对象的既有兼容边界保持。

### 首轮未通过记录

chrome-font-recovery-attempt1.json保留BLOCKED：旧runner未启用Allow User Scripts，定位namespace清理按既有fail-closed合同报geolocation-scripts-sync-failed，与旧runner期待原始读取错误的断言不符。通过临时Chrome正常扩展详情页可信鼠标点击启用开关后补验，无prefs写入或权限绕过。跨源iframe使用独立type=iframe、精确URL的CDP目标采样，不从顶层跨源读属性，也不将异常当作通过。

### 独立只读复核

critical_reviewer已独立复跑原反例并加入已有page/geolocation债：恢复后正确合并font债，未匹配顶层标签仅新增font。源码无确认阻断；又核对最终12项故障JSON与30项回归JSON、当前48文件指纹、真实worker/iframe与reload前后对照。旧问题已在源码及本轮浏览器范围关闭，不替代人工验收。

## 本地交付状态（人工验收前的历史记录）

本地实施和验证完成，manifest及Trellis为review，human_acceptance pending；VG-025和VG-029原done不改。本轮未提交、push、merge、tag或发布；其他未提交修改保留。原VG-029记录中字体故障限制属于修复前历史，本轮修复及证据以VG-030为准。

- `chrome-font-recovery-evidence.json` SHA256：`670701c5d4001a20fd0c8f3e62ca8c8e6330e1aae36b13fd121e3bb1556b4ede`

- `chrome-font-production-evidence.json` SHA256：`5a1c75e522ace57f6865d33f0d5b8686a3d005e83987c94d693d5f276058bc25`

- `chrome-geolocation-evidence.json` SHA256：`777c07701e88b3d1a2abd619f4108a9fafe7ca9bd811e5ae053dc62a9793051d`

- `chrome-font-recovery-attempt1.json` SHA256：`cfd93b991091f66a5cf420f48ec7067332a55e1bac9cafce375f0512ac01130c`

## 2026-10-22 人工验收确认

验收人：用户；日期：2026-10-22（Asia/Shanghai）。用户在本会话明确确认：

> 验收通过，把 VG-030 标记为 done，同步任务清单和验收记录，完成收尾。保留其他未提交改动，不 push 或发布。

本次签收覆盖字体实际注册恢复的重载补录、匹配顶层及iframe故障窗口、预写和后续失败跨worker恢复、针对性测试，以及已报告的真实Chrome定位、语言、时区与字体回归。257项本地检查、Chrome字体故障12项、正常字体15项及定位联合30项的原始结果和限制继续有效。合成API拒绝不等同真实磁盘损坏，Chrome138、其他OS及全部冷启动/故障组合等未实测项不因签收提升为PASS。

稳定化任务清单已从review更新为done，Trellis从review更新为completed，human_acceptance为accepted，完成日期为2026-10-22；VG-025/VG-029及其他任务状态保持。原始成功证据和首轮BLOCKED JSON逐字保留。此次收尾只更新任务状态与验收文档，不修改源码或测试；不新增提交、push、merge、tag或发布，保留其他未提交改动。任务资料保留在原路径，使用task.py finish仅清除本会话任务指针。

## 2026-10-22 本地提交范围

用户授权将VG-030相关改动整理成一次本地提交，仅提交本任务，保留其他未提交改动，不push或发布。前文“不提交”描述对应此前实施和验收收尾阶段，本次按后续明确授权执行。

独立差量以VG-030开始时的工作文件备份为基线，直接应用于`838c301`；未纳入VG-026推荐/countryCode、VG-027研究、右键菜单或用户文档删除等其他改动。字体实现、字体用例和Chrome runner与已验收工作版本逐字一致，services只纳入字体注册预写回调的8行相关差量。

剥离无关内容后的独立提交树执行npm run check：源码/测试类型检查、246/246 Node测试、Vite构建PASS。测试数量与原工作树257项不同，因为其他未提交任务的11项检查没有进入本次提交。原257项验证和原始Chrome JSON/首轮BLOCKED保持原样；新构建的浏览器结果与产物摘要独立保存，不复用原dist指纹冒充新构建。

独立提交树的实际48文件构建SHA256为`a73c029743e36d34d2a5063993fa8ebfeb133fcca6b7bfefcb5d7ffa248d8ca3`。Chrome155.0.8059.86/macOS arm64/headless临时profile补验：字体故障恢复12/12 PASS，未改写实际dist定位/语言/时区/字体联合30/30 PASS，cleanup均PASS；使用与此前相同的合成故障与隐私边界，未操作用户个人Chrome。新证据见[字体故障](./commit-scope-font-evidence.json)和[定位联合回归](./commit-scope-geolocation-evidence.json)。

- `commit-scope-font-evidence.json` SHA256：`1cea990c75b92a2fe7866e523867a1b3b2f4905b84c9736b6dddf794ba2477a9`

- `commit-scope-geolocation-evidence.json` SHA256：`ef36d5a41c024dbbaade05053859a4cd30b92e708e8ee640fc694d9418e6128b`
