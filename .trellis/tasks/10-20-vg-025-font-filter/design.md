# 设计

复用维护源过滤器与 registry 原生代理，构建独立自包含固定函数并输出 font-exposure/filter.js。配置只决定启用allowlist范围，不进入脚本。复用config-resolver的matches/domain优先级。scripting.registerContentScripts 使用MAIN/document_start/allFrames，禁止origin fallback；Chrome文档身份由声明式注册选址。后台现有配置队列拥有对账，先撤销失效或变化scope再注册并回读。字体资格门禁默认关闭，未人工接受不得启用生产；候选Chrome harness直接验证同一编译结果及包内文件，不把隔离结果写为生产验收。

## 原生CSS解析与对账边界补充

FontFaceSet.check 由原生方法先完成转换/异常，再通过闭包持有的、未连接DOM的原生CSSStyleDeclaration解析font-family；不用正则复制合法shorthand语法。捕获setProperty/getPropertyValue引用，不在每次检查时读取页面可改写的方法。measureText依旧使用Canvas原生font序列化结果及转换观察器。

syncFontScriptRegistration只拥有已编译注册的观测/撤旧/新增/读回；不拥有配置或队列。生产wrapper与资格控制面共用它，生产门禁仍由wrapper执行。保存配置至Chrome对账完成有可观察窗口，旧注册/旧文档不等于已按最新配置撤回；UI与最终生产集成必须报告该边界。


## 独立字体状态与重载债（正式接线）

font-scripts 的生产 wrapper 返回 fontRuntime：ready/disabled/paused/custom-paused/sync-failed；只有实际撤旧/注册/回读完成后才给出注册数量，失败为null。FONT_FILTER_PRODUCTION_APPROVED 是唯一人工恢复门禁，已于2026-10-20获用户授权置true；custom永不编译派发。services在既有配置队列中调用，不增加消息action、配置来源或权限。旧初始化路径撤销不确定时不新增字体，仍尝试清理字体命名空间并明确失败。

RuntimeSyncMetadata version1 的同一 pendingReloads 列表增量增加可选 surfaces（page/font），只保存tabId、URL摘要与表面标签；旧无标签记录仍仅代表当时已恢复的语言/时区。字体启用/关闭、vendor切换custom或启用allowlist改变有效字体活动时才增加font债；未恢复custom名单编辑不新增债。复用resolver匹配，不复制匹配器。预写回滚的oldPending与待合并记录深拷贝隔离，保留各自签名恢复语义。字体和语言成功/重载各自判断，单独语言权限失败不抹去字体成功；不自动刷新或清除旧hook。

Popup/Options 使用同一fontRuntimeMessage和renderer，独立显示字体状态、有限API覆盖及旧文档/BFCache快照；未知报告不沿用“已应用”。当前站点仍单独说明语言/时区，其字体详情由独立报告附加。普通字体、绘制/像素/导出、OffscreenCanvas/DOM/local()/Worker边界不扩大。


独立复核发现并修复两项重载债遗漏：保存/注销窗口内新开的文档，以及只有iframe命中的顶层页面。字体注册范围变化现在直接比较同一compiler结果，对所有普通HTTP(S)标签页保守记font债（顶层URL无法排除iframe）；UI明确保守提示。预写pendingFontScopeChange保存窗口补录义务，reconcile完成注册后再次query合并窗口新页，字体失败或查询失败保留marker跨中断恢复；成功才清除。previous同时保留旧签名marker，任意后续保存不能丢失尚未完成的补录义务。pendingForSignature深拷贝防止合并污染旧记录。无新增权限或页面文档观察桥。


## 授权后的正式构建验证

用户授权仅解除固定内置名单生产门禁，compiler/队列/对账/窗口marker不变。正式--production模式复制实际dist并只新增空白扩展管理驱动页，通过真实runtime.sendMessage及后台router保存/对账；不直接调用helper或替换审批常量。生产manifest、worker和字体资产原样加载；扩展update验证只在临时副本更改合成版本号，不改仓库版本。新安装仍默认关闭且不调用provider。字体无需Allow User Scripts，语言/时区仍独立依赖该正常用户开关。
