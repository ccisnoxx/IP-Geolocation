# VG-028：产品契约 v3、请求头停用与字体暴露模型

## 授权与编号

用户于 2026-10-20 要求依据 `docs/VanishGeo_实施计划_出口环境与字体暴露过滤.md` 和 `docs/VanishGeo_Codex_Prompt_VG-023.md` 实施，并明确确认：使用新编号，保留已验收的语言／时区 userScripts；本次仅停止请求头修改并重构字体配置。原 VG-023 done 及 VG-022 记录不变；VG-024～VG-027 留给原计划后续任务，本次使用 VG-028。两份原始输入文档不覆写。

## 范围与验收

- schema v3：删除 language/profile/override 的 acceptLanguage；canvas 替换为 fontExposure(enabled/mode/blockedFamilies)。兼容 v2 默认宽名单与自定义名单，确定、幂等，保留规则、禁用规则、verified 档案、WebRTC、位置、时区与 intlMode；非法输入写前拒绝。
- 停止生成请求头规则；仅清理并回读验证 1100..2099，保留范围外规则，成功后写迁移标记，每次 reconcile 仍实际检查；失败可见并可重试，不以标记跳过。
- dnr 同步组件改为 legacyDnrCleanup，仅表示旧规则不存在。保留 DNR 权限至 VG-024；无新权限/host scope/生产依赖/版本变化。
- 字体维护源改名为 font-exposure，默认仅指定 16 种厂商／软件字体。只处理目标 measureText/FontFaceSet.check，非目标原生透传；移除无行为价值 getContext wrapper；保留 descriptor/native proxy 合同；关闭零 hook。
- 保留原 VG-023 已验收的语言／时区 MAIN/document_start userScripts 和快照、最长域名规则、fail closed、更新/撤销顺序。Geolocation/字体/Worker 生产仍暂停，无旧 documentId 派发或配置桥。
- Options/Popup 新字体模式保存/加载/导入/导出；删除请求头编辑与保护状态；字体显示已配置但当前未应用。诊断 header 仅原生观测，UNKNOWN 不变成保护失败。
- 同步 README/CONFIG_GUIDE/PERMISSIONS/PRIVACY/RELEASE/AGENTS、稳定化 README/验收矩阵/清单及确实过期的规范。保留历史负向证据。
- 完成后 manifest 与本任务仅 review；不 commit/push/merge/tag/发布，不实施后续任务。

## 验证

基线 npm test：185/185 通过（首次预检实际执行，源码未变）。最终执行 git diff --check、npm run typecheck、npm run typecheck:tests、npm test、npm run build、npm run test:e2e:chrome -- --dry-run，并按变更边界验证迁移、清理、字体原生合同及 UI。持久化迁移与清理需独立只读审查。真实 Chrome 升级定向验收按本机可用能力执行，未运行须记录原因，不以 VM/Node/dry-run 冒充。
