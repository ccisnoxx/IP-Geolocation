# VG-006 设计

## 所有权与报告

services 拥有串行配置修改及 reconciliation；config-model/resolver/storage 保持各自权威。配置写入原 local 键；session 的 runtimeSyncMetadata 只包含版本、配置 SHA-256、四组件报告及待刷新 tab ID/URL 摘要，不保存第二份配置或原始 URL。报告错误为固定中文类别，不持久化 Chrome 原始错误。

读取实际 content registration / dynamic DNR / privacy 后比较，只有不一致时 register/update/unregister、updateDynamicRules 或 set/clear；随后确认实际状态。DNR 只管理 1100–2099；预检该区间、regex、unsafe/dynamic 配额及旧 Chrome combined session 额度，使用同一规则生成器。

## 保存与恢复

配置写入前校验配置及容量、读取 tab 快照、把按旧/新有效 payload 差异产生的待刷新 ID/URL 摘要与已有欠账合并，预写与新配置摘要绑定的 session 记录，再写 local 配置。预写失败或容量/快照不可读时拒绝保存；local 写失败仍保持旧配置，旧 session 记录恢复。已保存后各副作用独立捕获为报告；metadata 写失败也必须明确可见。

运行副作用全部收敛后才刷新欠账页面，避免加载旧注册/请求头。refresh 四并发，每个 tab 重新核对 URL 摘要；关闭/导航的旧目标不再刷新。成功批次清理欠账并 checkpoint；失败目标留待下一次初始化或显式重试。session 在 worker 暂停后保留，在浏览器重启/扩展重载后清空，避免 tab ID 跨浏览器会话复用。新的页面正常按 desired state 初始化。极窄的 API 成功但 checkpoint 前中断可能产生一次重复刷新，属于至少一次恢复。

入口顶层及 onInstalled/onStartup 使用同一队列；UI 读取/手动重试重新观测。报告与配置在同一串行操作返回，避免读取不同事务的状态。Chrome 控制权被其他扩展/策略接管和不支持必须为失败，不能把期望 policy 当已生效。

## 边界与回滚

runtime/content/匹配/verified/外部检测不改；无新外部请求或权限。MAIN/ISOLATED、iframe、worker 保持现有合同。回滚仅撤销本任务增量，保留配置，session metadata 可被旧代码忽略；不写 dist，不改历史或前序任务。真实 Chrome 生命周期证据单独记录，不由 mock 成功推断。

## 独立审查后补充

WebRTC get 返回按优先级合成的 effective 值，不能证明 own regular override 已释放。default/禁用首次对账必须 clear，只有当前配置摘要下的成功 clear 结果才允许跳过；clear 后仍读取实际状态，不要求其他控制者也返回 default。

确认出口档案已经提交后，候选删除失败不能转成未保存错误。结果保留 saved/config/report，并给出固定 warning；session 记录只增加待清理 detection ID，初始化/重试按 ID 清理，保留新候选。确认创建的档案 ID 从同一 detection ID 派生，同一候选重试不产生重复档案；只有后台已验证 candidate 可建立身份。候选发布/确认/取消/对账清理共享队列，provider 网络请求仍在队列外。此修补只闭合 VG-006 已保存结果及恢复边界，不扩大为 VG-012 完整检测事务验收。

同一派生ID若已存在但不满足精确既有verified身份比较，确认在persist前拒绝并要求重新检测；不追加重复ID、不覆盖或提升导入后的unverified档案，保留候选。
