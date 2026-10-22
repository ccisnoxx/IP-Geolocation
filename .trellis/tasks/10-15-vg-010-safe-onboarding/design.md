# 设计与回滚

config-model 增加显式 createInitialConfig 安全初始值，历史 DEFAULT_CONFIG/normalizeConfig 的缺省含义保留用于既有数据兼容。config-resolver 根据已知当前/旧配置键与初始化标记区分 fresh 与 upgrade；v2 不再适用历史空规则修补。storage 对既有 v2 不做配置重写，只补必要标记、清理旧键；首次写入配置和标记仍为同一次 local.set。

无 schema 变化、无引导进度存储。安装事件仅 install 打开现有 Options（且当前仍安全空配置）；update、startup、worker 唤醒只对账。引导状态由配置与同步报告派生，共享 ui-state 拥有投影并调用既有 resolver 检查规则。

Options 原生 DOM 增加三步区域，复用现有检测确认。后台窄动作 completeOnboarding 接收站点文本、已验证档案 ID、显式 WebRTC 选择，使用当前配置串行合并，不接受网页 verified 身份；选择站点明确切换为继承全局、全局位置/时区为 auto，保留其他设置与其他规则。skipOnboarding 只关闭总开关并释放本扩展 WebRTC。reset 清候选并递增后台检测代际，使重置前在途响应不能发布。

失败沿用 persistConfig 的预写/session 欠账与 saved/partial 对账，不静默回滚已保存配置。非法输入/未验证或已删除档案拒绝写入；重复提交保留规则 ID，相同配置不重复刷新。UI 错误不宣称启用成功。

回滚仅撤销本任务增量，保留任务前全部未提交成果，重建 dist。不执行 reset --hard/clean、历史重写、push/merge/tag/release。无破坏性迁移；旧版本可读取 v2，但旧版 reset 及空存储默认行为会恢复旧语义。需要恢复用户 reset 前数据时由用户管理完整导出（含敏感数据），代码回滚不能恢复已清空数据。
