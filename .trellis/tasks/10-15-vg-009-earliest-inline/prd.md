# VG-009 最早内联脚本时序验收

当前授权将初始 Geolocation/Permissions 计划校准为 R3 注入时序证据，依赖 VG-006/007/008 均 done。原领域缺口留在验收矩阵，不实施其他任务。

必须在 head 首个 inline script 同步捕获 language/languages/locale/timezone/固定日期 offset，不查询 runtime marker。top、same-origin iframe、srcdoc 和脚本写入 about:blank 分别捕获 earliest 与 load。扩展报告依据现有 resolver 的预期分别比较；不可观察或未授权为 UNKNOWN。增加可重复真实 Chrome 自动返回，Node/dry-run 不代表浏览器通过。

保持 MV3、动态 allowlist、可信 sender/documentId MAIN 注入、ISOLATED 通知、配置唯一所有者、DNR、权限和 verified 边界。不向普通页面传预期；不增加生产依赖或 spoof surface。若出现竞态如实记录，不能推迟首脚本读值以换取 PASS。

实现及本地验证后状态 review，人工验收后才可 done。不提交、push、merge、tag 或发布。
