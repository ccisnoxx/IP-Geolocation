# VG-010：首次安装引导与安全默认值

发布阶段 R3；唯一跨任务状态以 docs/stabilization/task-manifest.yaml 为准。依赖 VG-009 已由用户于 2026-10-15 人工验收为 done（首脚本竞态仍是已知限制）。只实施 VG-010，本地完成后 review；人工验收前 completedAt 为 null。

## 验收

- fresh install：无当前/旧配置及初始化标记时建立安全关闭配置；空规则、WebRTC browser default，不自动检测。
- upgrade：已有 v2（包括 masterEnabled=false、空规则和缺少旧标记）保留原有效设置、规则、环境方案及出口档案；旧格式保持既有迁移兼容，不套用 fresh 默认。
- reset：用户明确确认后清空配置、规则、环境方案、出口档案和历史，取消未确认检测，回到安全新默认。选择清空是为了避免重置后保留旧出口被误认为仍有效；下载文件与外部站点数据不删除。
- Options 提供检测/确认出口、选择站点、明确启用三步流程；可跳过并保持 master=false/WebRTC=default。Popup/Options 区分未配置、部分配置、已配置关闭、已启用、同步未确认。
- 保持 schema v2、单一配置所有者、verified 事务、MV3/allowlist/documentId/DNR/privacy/权限及现有 realm 边界；无新依赖、云账户、自动能力或发布。

## 最低验证

定向配置/后台/UI 测试；git diff --check、npm run typecheck、npm run typecheck:tests、npm test、npm run build、npm run test:e2e:chrome -- --dry-run。环境允许执行独立临时 profile 的 fresh/upgrade Chrome smoke。dry-run/Node/VM 不代表真实 Chrome。
