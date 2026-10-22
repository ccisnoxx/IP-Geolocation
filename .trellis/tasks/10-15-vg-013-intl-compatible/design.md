# 设计

## 配置与迁移

schema v2 添加全局 intlMode，不把策略塞入只负责时区来源的 timezone.mode。config-model 归一化缺失为 strict，保存校验显式非法值；resolver 将模式加入有效 payload，原签名/刷新和后台队列自然消费。storage 不新增键、不强制重写已有 v2；下一次正常保存持久化模式。环境方案只拥有信号值，应用方案保留全局 intlMode。

## 精确语义

strict 是升级兼容与一致性优先默认，保持现有显式覆盖与 resolvedOptions 回报。compatible 中 locale !== undefined 原样传递，包括空数组、null 和非法值；undefined 才补已启用语言。options 的 timeZone 经原生读取时值为 undefined 才补已启用时区；显式 UTC、继承/不可枚举属性、getter、null/非法时区均交原生处理。null options 保留原生错误。省略 options 创建无原型默认对象，避免读取 Object.prototype 的额外选项；该约定对照 [ECMA-402 CoerceOptionsToObject](https://tc39.es/ecma402/#sec-coerceoptionstoobject) 和当前原生 API 反例验证。独立判断 locale 与 timeZone，未启用的信号不注入。

共用 intl-policy.ts 由页面/worker 静态 graph 引入；兼容 options 代理空对象，按需转发原对象属性读取及 receiver，不提前读取 getter、不克隆/修改原对象，避免冻结属性代理不变量问题。resolvedOptions 在 compatible 直接返回原生真实结果，格式化与报告一致。Date 本地 getter/构造/字符串无调用级时区参数，继续有效配置时区；UTC getter/epoch/显式 offset 字符串保持原路径。既有其他 Intl 服务构造器复用 locale 策略，不新增 Number/String locale 方法或 Intl.Locale 表面。

## realm、生命周期与安全

每个文档独立 registry；首次初始化固定模式，重复调用保持既有页面不变，仅未来 worker 更新；已启动 worker 不更新。模式进入完整 worker patch source 与 SharedWorker 缓存身份。切换模式通过既有 payload 签名刷新文档；不新增热切换协议。后台 VG-011 暂停不改，不通过页面桥接配置。ISOLATED 不伪装，MAIN 测试仅在临时最小扩展中调用当前文档。

诊断固定 en-US/UTC 调用，并增加 NumberFormat 和 Date locale 实际值；默认与显式各自比较，预期留在扩展内部。fixture 只回传实际值、不接收模式。无新网络、权限、storage 来源或敏感日志。

## 验证与回滚

任务前 npm test 161/161。新增行为测试先红后绿；最终源码/测试类型、全套、build、diff、dry-run；定向 Chrome 两模式与正式 dist 安全闸门分别记录。独立只读复核兼容参数/配置无损/安全暂停。回滚仅本任务增量并重建，保留前序工作，v2 旧版可读但会忽略新模式；已有 hook 需要关闭重建文档，不回滚浏览器数据。
