# VG-008 设计

当前用户请求将原 R1 Intl/Date 初始计划校准为 R2 配置正确性；依赖 VG-001、VG-005 均已人工验收 done。旧 Intl/Date 注入及跨 realm 浏览器缺口仍在验收矩阵中保留。

## 所有权与失败语义

- config-model 拥有自定义 Profile 的字段校验和归一化；profile 模块复用它并负责创建 UUID 和应用方案，不引入第二套配置模型。
- 原始 Profile 必须具备非空字符串 ID/名称、有限数值纬度 [-90,90]、经度 [-180,180]、accuracy > 0、有效 IANA timezone 和有效语言结构。名称允许 Unicode 与重复；ID trim 后必须唯一。
- normalizeProfiles 对旧存储只返回有效且唯一的条目；不把缺失/null 坐标转成 0，不为非法 accuracy 补默认值。悬空 activeProfileId 清空。原始导入和保存在读取/迁移 storage 前先校验，错误包含条目序号、字段和修正方向，不能以静默过滤宣称成功。
- services 的通用保存保留当前出口档案；导入校验成功后仍降级出口档案并清空绑定。persistConfig 的存储/对账事务不变。
- config-resolver 的 bpg_config 迁移以显式有限数判断 manual；缺失/null/空坐标不视为 0。已有 schema v2 路径不重生 Profile ID。
- Options 创建方案使用 crypto.randomUUID，保留 null 坐标并校验原始表单 accuracy。另存期间禁用确认/取消/主保存/底保存/字体重置并阻止遮罩关闭及旧列表提交，finally 恢复后才关闭成功弹窗。Popup 共用现有目标时区偏移函数，在发送保存前更新并复用 IANA 校验，空/非法 timezone 不显示猜测值；日期测试包含 DST 和半小时时区。

## 边界、风险与回滚

schema v2、storage keys、消息格式、MV3、动态 allowlist、可信 documentId MAIN 注入、ISOLATED 通知、frame/worker、DNR、privacy API 与 verified 出口事务保持原合同；无生产依赖或新增网络。仅源代码构建到忽略的 dist，不直接编辑产物。公开记录使用相对路径，测试使用合成位置。

旧非法方案从有效读取结果中排除，v2 原存储不在读取时额外破坏性重写；下一次显式保存才写入有效配置。导入失败不替换已有配置；串行队列与存储失败恢复保持既有行为。UUID 在创建时生成，保存/归一化不会重新生成。

回滚只撤销 VG-008 相对任务前工作树的增量，不使用 git reset/clean，不删除用户数据。尚未标记迁移完成的旧键可重新走迁移；已经成功迁为 v2 的数据不自动降级。只在用户列明的实际阻塞条件下停止。
