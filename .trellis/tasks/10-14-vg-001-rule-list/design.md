# VG-001 设计与边界

## 当前状态

VG-000 已由用户人工验收，manifest 为 done；VG-001 已解除阻塞并实施下列合同。本任务本地验证和独立复核完成后停在 review；2026-10-14 用户确认 Options 和 Popup 真实 Chrome 人工验收各项通过，manifest 为 done、Trellis 为 completed。此次状态提升依据用户明确确认，证据见 implement.md 的“人工验收”。

## 规则文本合同

文本表达启用规则的域名集合，不能据此推断未显示的禁用规则应删除。共享纯函数在 src/shared/rule-list.ts：ruleListToText(rules: readonly SiteRule[]): string 和 rulesFromText(value: string, existingRules: readonly SiteRule[]): SiteRule[]。复用 config-model.ts 的 normalizeDomain/normalizeRule，不新增域名匹配器或配置来源。

- 用现有归一化处理文本中的空白、大小写和 URL，对归一化域名去重。
- 保留未重新启用的禁用规则；重新启用时复用原规则的 ID、overrides 和出口档案绑定。
- 删除文本中移除的启用规则；新增域名通过 normalizeRule 取得原有默认值，出口绑定为 null、overrides 为 inherit。
- 相同启用集合的保存保持现有完整规则数组及顺序；测试覆盖禁用与启用规则交错排列。
- 不修改输入；相同文本重复合并应具有幂等结果。

已有规则按原数组顺序保留，重新启用原位替换，新域名按文本首次出现顺序追加。文本重排不重排已有规则，避免无关保存改变数组。

新规则 ID 使用 rule-<归一化域名>，与已有 ID 冲突时选择最小可用数字后缀；删除的规则 ID 在同次编辑也保持保留。使用显式 ID 的 normalizeRule 保持配置模型默认值且避免 Date.now/Math.random，使相同输入结果确定。已有规则 ID 完全保留，ID 仅为内部身份，不用于匹配或 verified 认证；没有 schema/迁移变化。

## 修改范围

src/popup/popup.ts、src/options/options.ts、共享 rule-list 模块、tests/rule-list.test.ts、tests/rule-list-ui.test.ts 及现有 wiring 测试。config-model/resolver/storage、schema v2、迁移、runtime message、manifest、DNR、权限和 Vite 配置没有修改。dist 只由正常构建生成，管理页共用新 rule-list chunk，不直接编辑产物。

## 执行环境与隐私

改动限于扩展管理页表单数据转换。保持可信 MessageSender/documentId 注入、自包含 MAIN runtime、ISOLATED 初始化、独立 frame 授权和 worker/browser API 边界。没有新页面配置桥、外部请求或敏感数据记录；测试与诊断只用合成数据。PRIVACY.md 当前不存在，隐私整改属于 VG-002。

## 并发、恢复与回滚

不改变后台配置写入队列、多窗口冲突、持久化失败恢复或迁移。不能由纯函数测试宣称这些边界通过。实施后的回滚只撤销本任务源码与治理记录，不重写 Git 历史、不覆盖用户改动、不清理浏览器数据。

当前阻塞记录的回滚只撤销 VG-001 manifest 元数据和新增任务文件、精确 ignore 例外；VG-000 和所有既有工作保留。
