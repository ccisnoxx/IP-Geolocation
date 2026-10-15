# VG-009 设计

fixture 的 head 第一个脚本先同步采集，随后注册 load 回调；实际快照写入 fixture 自身 JSON script 元素，只供观察。无配置、预期、run ID、runtime marker 或生产页面写入。子框架各自运行首脚本，不以父页延迟采样代替。

复用 VG-003 prepare 的 owner/target/TTL，增加受精确报告来源保护的 executeInjectionTimingRun。与 full execute 共用一次消费、取消、导航/配置校验和 finally。专用采集只读取 snapshot JSON，无 provider、STUN、位置/header 或临时 iframe。MAIN 函数无预期参数；ISOLATED 文档身份与有效 origin 用于独立 resolver 判定。fallback 无有效 HTTP(S) origin 则 UNKNOWN，绝不修改生产授权。

shared diagnostic-report 拥有时序证据类型和比较。earliest/load 各有 language/languages/locale/timezone/固定 offset 判定；缺失保留 UNKNOWN，FAIL 不被后阶段覆盖。页面实际数据不可信，限制长度/类型/版本/结构，不把 page 数据作为预期或授权。

Node 原生 WebSocket/CDP 驱动临时真实 Chrome，先采未启用对照，再在扩展内部保存合成配置，等待对账完成后重新导航，重复首脚本实验。输出每帧每阶段状态及原始对照分类；不因测到竞态把 harness 标为通过。进程/profile/server finally 清理，无新依赖。

回滚只撤销本任务增量并重建，不清用户 profile、不降级存储、不重写历史。异步链路若需同步 MAIN 注册/配置桥才能保证首脚本前完成，则记录设计约束，不能在本任务突破长期不变量。


## 实现补充

load为load回调时刻，不代表后台完成；postLoad由无参数MAIN采集函数在报告时直接采样。三阶段独立比较。about:blank经document.write后URL可继承创建页，ISOLATED frameElement声明来源只用于描述标签，不用于预期或授权。

自动化使用私有report模块导出的run()返回同一次execute的evidence和rows，并核对屏幕渲染，不拼接两次run。CDP lifecycle事件在导航前启用并缓存，以本次Page.navigate返回的loaderId等待load，排除旧文档JSON。取消/过期/generation变化的空结果拒绝作为证据。

真实Chrome证明首脚本仍读原始值；现有生产注入已经injectImmediately:true，减少一次读取或缓存配置也不能消除ISOLATED→后台→MAIN的跨进程异步边界。没有满足现行动态allowlist、可信documentId/配置边界且能保证先于所有首脚本的局部补丁。本任务修复的是证据误标/混采，保留生产竞态，不做同步MAIN注册或配置桥等未授权架构改写。该限制是明确验收结果，不是自动化失败或依赖阻塞。
