# 设计与 Preflight（2026-10-20）

## 当前基线

分支起点 experiment/userscripts-document-start，HEAD de85aea；实施分支 codex/vg-028-header-font-contract。仅一个工作树，无 VG-022 未提交源码。预存在 docs/vanishgeo-codex-task-prompts.md 删除及两份用户新增任务文档，均保留。VG-014 done；原 VG-023 done；VG-022 in_progress 不在本任务内。

当前 schema v2，config-model 唯一拥有归一化，resolver 唯一拥有匹配/有效 payload，storage 唯一拥有读取迁移写回；services 串行拥有配置与副作用。dnr 仍生成 Accept-Language，runtime sync 为 dnr。完整隔离 runtime 有 canvas-fonts，其 getContext 包装仅转发。生产已独立恢复语言/时区 userScripts，因此用户最新确认覆盖输入文档的“语言/时区继续暂停”旧基线假设。

## 目标边界与文件

共享模型：types/config-model/config-resolver/defaults/storage/profile 及迁移测试。网络与对账：legacy-dnr-cleanup/services/runtime-sync；诊断报告、leak-test 与原生 header 文案。字体：runtime-modules surfaces/entry/types/registry、构建接线与原生合同测试。UI：options/popup 及真实表单 VM 与 wiring。文档及任务记录按 PRD。

storage key 仍 siteSpoofConfig；schema v2→v3 单向写回，v3 稳态不重写。原 acceptLanguage 在所有可持久化位置丢弃；旧宽名单仅为迁移识别数据，不再是默认阻断名单。自定义集合按与运行时一致的规范键去重，保留首次显示值。导入继续降级 verified 并清空绑定，不更改确认事务。

manifest 权限集合、最低 Chrome138、MV3、host scope 与版本不变。runtime messages 动作与来源验证不变，仅返回配置结构/同步组件升级。输出仍仅由 TypeScript/Vite 生成到忽略的 dist，不手改。

## 页面、安全与隐私

MAIN 生产仅已授权的语言/时区；普通 HTTP(S) 顶层/iframe 自身 URL 匹配。特殊文档 unsupported/UNKNOWN，无 ISOLATED 配置 broker、页面桥、documentId 回退。字体/位置/Worker 仍不进入生产 graph。WebRTC privacy 策略不变；不增加 WebGL/GPU/UA/硬件/Canvas 图像接管。

没有新增外部请求或预期配置传输，header echo 只观测原生值，不记录完整 header；真实 Chrome 探针仅 loopback、合成配置，证据布尔/计数摘要。无真实公网 IP、位置、凭据或个人路径写入仓库。

## 幂等、并发与失败恢复

services 现有队列继续串行；旧规则清理不构造新规则，读→按范围删除→回读，核验后才 marker。marker 不替代实际复查，API/回读/写 marker 失败进入 failed 报告，下次 reconcile 可收敛。副作用失败不回滚已保存 desired state；不扩大未完成能力。

## 风险、验证、回滚与停止

重点风险为自定义名单/规则/档案丢失、遗留规则残留、误删范围外规则、旧同步 metadata 兼容、字体 hook 异常/descriptor 退化、误恢复暂停表面或改变已验收 userScripts。使用定向行为测试、完整本地最低门禁、独立只读复核；真实 Chrome 升级证据独立分类。

回滚只撤销本任务明确拥有的 diff，不 reset/stash/覆盖用户工作。v3 导出须先备份；回旧版本可能恢复请求头修改，不能把回滚视为安全不变量。若遇需新增权限/host/完整 runtime 恢复、不可保留数据或无法隔离用户工作，则停止并说明，不擅自实施。
