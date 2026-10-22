# VG-008：强化配置迁移、Profile 校验和 UI 正确性

用户授权仅实施本任务，发布阶段 R2，依赖 VG-001、VG-005（均 done）。本地完成状态 review，人工验收后才可 done，不提交或发布。

## 验收

- 旧配置合法 0/0、0/120、-30/0 为 manual；缺失坐标不伪造 0。
- 自定义 Profile：纬度 [-90,90]、经度 [-180,180]、有限 accuracy > 0、有效 IANA timezone、非空名称、非空且唯一 ID。
- 非法 Profile 不进入有效配置；导入原始数据先校验，返回条目/字段修正错误，失败不替换原配置。
- 中文及同名方案可保存，UUID 与名称解耦，已有 ID 保存时不重生。
- Popup 目标时区 UTC offset 与日期一致，包含 DST、半小时偏移和非法时区空显示测试。

## 约束与验证

保持单一配置模型、schema v2/storage、verified 出口信任、MV3/MAIN/ISOLATED/frame/worker/DNR/权限和隐私边界。无新外部请求、生产依赖、设备伪装、产品模型重设计或后续任务。

运行定向配置/后台/Profile/UI 回归，git diff --check、npm run typecheck、npm run typecheck:tests、npm test、npm run build；独立复核迁移/导入持久化边界。Node/VM 不冒充 Chrome。设计见 design.md，精确命令/实际结果见 implement.md。
