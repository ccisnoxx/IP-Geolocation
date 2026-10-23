# VG-040 实施与核验记录

2026-10-23启动，2026-10-24完成本地实施；当时主清单与任务为review，人工验收pending；最终状态见文末。依赖VG-025、VG-032、VG-038启动时均为done；VG-039仍为review，不改变其历史未完成项。

## 修改与所有权

- 用户明确选择既定43项名单；移除顶层三通用字体允许名单，顶层与普通iframe共用字体surface。修正字体名空白归一化，保留名单外名称、引号内空白、NBSP与转义产生的空格；普通分隔空白按CSS规则归一化。绘图、像素、OffscreenCanvas及Worker范围不变。
- Popup与右键菜单用现有setDomainRuleEnabled关闭当前域名。继承父域时建立禁用子规则并复制原出口绑定／覆盖；保留父域和兄弟域。共享config-resolver按最长域名决定是否启用，页面语言、定位、字体和DNR均排除禁用子规则。更具体启用规则仍可恢复自己的范围。
- Options检测确认后精确选择本次detectionId对应的后台verified档案；不预选站点、不自动勾选启用。不增加配置事实来源、权限或网络调用。
- README、CONFIG_GUIDE、Options说明及AGENTS同步现行契约；历史验收保留。已有Chrome字体runner更新合同断言，未声称实际运行。
- Trellis skill所指的本地scripts、workflow和spec在当前checkout缺失；只按现有manifest/源码合同记录本任务，未改装框架。

## 验证与独立复核

最终 `npm run check` exit0：源码typecheck、测试typecheck、342/342单测与Vite build通过。`node --check scripts/chrome-font-filter-smoke.mjs`、定向wiring及`git diff --check`通过。

定向首次新增后台测试误用服务构造签名，修正后通过。字体key合同调整后旧手写测试key同步保留空格，之后完整门禁通过。未删除或跳过失败用例。

独立critical_reviewer只读复核确认两个问题并在修复后重验：多Options窗口差集选错出口；字体名去空格扩大43项范围（含CSS分隔/转义空白边界）。独立执行父/子/孙嵌套禁用及重新启用的11个场景，解析器与四投影一致；追踪队列、写前隔离、注册顺序与恢复，未确认其他可触发缺陷。对最终dist顶层/iframe VM执行43项名单与9项名单外/转义反例通过。该证据为Node/VM，不是真实Chrome验收。

新候选ZIP与dist50个文件逐字节一致；独立审查再次核对ZIP SHA、无重复文件和证据库存。详见[本轮候选](../../../docs/stabilization/release-candidate/vg040/README.md)和[机器证据](../../../docs/stabilization/release-candidate/vg040/artifact-evidence.json)。源码输入摘要绑定当前未提交工作区，不冒充最终commit。

## 现场与剩余边界

按用户要求只读查看已有Chrome检测站，旧文档重新扫描及新文档开始检测均完成，所捕获VanishGeo/CSP警告为空；未绑定新候选构建，且底层响应取证有截断／API不可用。只记录“本次未复现”，不判定Worker全面通过或CSP/URL/XHR根因已消除。详见[调查记录](../../../docs/stabilization/release-candidate/vg040/blob-investigation.md)。

前一轮只读调查没有改动个人Chrome配置或权限，没有重载扩展，没有建立临时profile或服务器。保留用户原标签；诊断只读工具的raw CDP结束调用也受响应解析限制，未采用其他机制绕行。完整网络正文、精确IP／位置、Blob URL及配置均未写入仓库。

下述后续验收补齐新字体与关闭当前域名行为的绑定候选真实Chrome证据；用户已于2026-10-24确认任务人工验收通过。最终v2.1.1提交级RC需先确定实际提交，再按输入摘要复用或补跑门禁并绑定ZIP。本次不暂存、不提交、不推送、tag或发布。


## 2026-10-24 当前 Chrome 候选验收

沿用用户已打开的真实Chrome。先通过普通Options导出原始配置到仓库外私有备份，再从扩展详情确认已加载dist、版本2.1.1、Allow User Scripts已开启，正常点击重新加载。重载后导出与基线全量相等，未修改权限。维护源和ZIP与上述候选库存一致；本轮只增加观测夹具和证据，没有生产源码变动。

- [观测夹具](chrome-fixture.mjs)只监听IPv4回环，页面加载43个名单FontFace别名和6个名单外别名；名单别名与原生serif有可观察的宽度差，避免未安装字体造成假通过。探针读取真实页面API和本机服务器收到的Accept-Language，不注入扩展代码或预期值。
- 未启用对照：顶层／普通同源iframe的43项均可check且测得等宽字体原生宽度。启用localhost父规则后，父域、a.localhost、b.localhost各自顶层／iframe均43/43被check和measureText过滤，6个名单外字体保持原生，ctx.font恢复和TextMetrics类型均通过。
- 在a.localhost实际打开Popup，界面显示继承localhost；点击“关闭 a.localhost”并等待同步后完整重载。a顶层／iframe字体回原生43项可见，语言／时区首读及Accept-Language恢复原生；b和父域仍43项过滤且语言／时区／请求头保持配置值。[现场JSON](chrome-current-evidence.json)及[兄弟域截图](chrome-sibling-preserved.png)。本轮未实测右键菜单或跨源嵌套iframe。
- 首次检测用户确认曾手动选档，不计入自动选中证据。第二次由代理连续点击检测、确认并命名“VG040 自动选择验收”，未操作下拉框，界面立即选中新档案；站点输入仍空、启用确认仍未勾选。随后仅向localhost执行一次明确勾选的一键配置，临时规则正确绑定该verified档案。
- 清理已删除本次两个临时出口和localhost/a.localhost规则；保存后原三个站点与绑定完整相等、所有全局字段相等。重载b已恢复原生，四个临时页面关闭、回环服务器停止。

恢复比对通过（保留用户主动调整）：第一次检测后私有导出仍包含两个原档案，清理前导出少了一个未被任何规则引用的原档案。2026-10-24用户明确确认“是，主动删除，请保留这项调整”。清理后全量配置严格等于验收前基线仅删除该未使用档案，故按用户调整后的基线完成恢复，不重新创建该档案。保留所有私有原始导出。没有通过普通导入降级verified身份或覆盖绑定，也没有绕过后台验证。原始IP、坐标、档案ID未写入仓库证据。

本轮不提交、不推送。最终提交级RC和VG-039历史未验收项保持独立待办；上次342项门禁输入未变可复用，不重复执行全套测试。


## 2026-10-24 人工验收与本地提交

用户明确表示“验收通过，完成 VG-040 本地提交，并在最终提交上完成 v2.1.1 发布候选审查，确认构建、测试证据和 ZIP 对应同一版本，先不推送”。主清单标记done，Trellis标记completed；本地提交获授权，push/tag/发布未授权。用户主动删除的未使用旧档案已保留，恢复比对通过。

提交纳入本任务维护源、回归测试、说明、Chrome脱敏证据和候选库存；生产／测试输入保持已通过342项门禁时的摘要。提交后审查使用实际HEAD逐文件比对源码库存、dist和ZIP，复用输入未变的类型／测试／构建及Chrome证据，并重新执行版本和产物审查。最终完整commit、树摘要、检查复用依据和ZIP摘要记录在仓库忽略目录`release/vg040-final-commit-rc.json`；该文件在最终提交后生成，避免把包含自己commit哈希的报告反复提交。此处不预先编造commit或后置检查结果。

最终提交级审查结果以该本地报告为准；VG-039遗留验收、Blob现场未复现限制和HTTP(S)/SharedWorker暂停范围不随本任务完成而改变。未重跑无需变化的浏览器流程，未改动真实Chrome配置。
