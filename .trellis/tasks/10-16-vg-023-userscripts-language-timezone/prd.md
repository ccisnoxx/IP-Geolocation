# VG-023：userScripts document_start 语言与时区

2026-10-16 用户在确认 US-EXP 人工验收后授权生产实施。依赖 VG-013、US-EXP 均为 done。原始用户需求为本任务验收合同：Chrome138+、userScripts权限、Allow User Scripts正常开关、每文档快照、HTTP(S)顶层/普通iframe；其他类型unsupported/UNKNOWN。只恢复navigator.language/languages、Intl默认locale/timeZone及Date配置时区，保留strict/compatible。

配置模型/resolver/storage继续唯一拥有配置；编译最小payload与仓库静态自包含模板。注册串行，先撤销失效范围，再更新保留项，最后新增，读回验证。所有API失败进入RuntimeSyncReport；API/权限/开关不可用fail closed，不回退content消息/documentId executeScript。worker初始化与onInstalled(update)均幂等恢复。

已有/BFCache文档不热更新、不自动刷新，不尝试撤销旧Hook。同步完成后UI提示完整reload或关闭重开；新文档使用当前注册快照。DNR/WebRTC语义不变。Geolocation/Permissions geolocation、Canvas、Worker/SharedWorker继续暂停，无其他设备表面变更，无第三方测试网站。

最低验证：diff check、源码/测试typecheck、npm test、build、Chrome dry-run；复用已验收实验JSON，新增真实Chrome生产语言时区smoke。覆盖新安装关闭、开关后保存、首inline/iframe、原生origin、最长域名、A→B旧文档与reload、禁用后reload、worker重启与扩展update恢复、无旧生产回退、DNR/WebRTC及暂停表面。

交付仅review，人工验收前不得done；不提交/push/tag/发布。
