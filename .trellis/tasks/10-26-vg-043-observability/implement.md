# VG-043 本地交付记录（review）

2026-10-26，基线 HEAD `9b5d9be6205c4098ec75dc7338be767e6dd87536`。初始工作区干净；未回退、提交、推送、修改版本或权限。唯一清单中 VG-040／VG-042 已 done，开始记录 in_progress，本地交付后转 review，人工验收 pending。

已读 AGENTS.md、README、PRIVACY、PERMISSIONS、CONFIG_GUIDE 和浏览器验证指南。当前本地 `.trellis/workflow.md` 及引用的 frontend spec 文件不存在；按实际共享配置、编译器、串行服务、UI、测试和现有脚本定位合同，没有创建替代规范。使用 trellis-before-dev、clean-code-design；对配置持久化与投影执行独立只读 critical review，没有遗留确认的候选阻断缺陷。

## 实现

- `compatibilityPreset` 为 SiteRule 可选字段，归一化缺省 full，外部边界严格接受 native／consistency／full。现有 schema v3、版本 2.1.1、存储事实所有者与可信出口事务不变。高级覆盖、退出档案绑定和全局信号不因切换被删除。
- native 不派生页面、定位、字体、DNR 语言头；consistency 只保留已有有效语言／Accept-Language 和时区；full 沿用完整原配置。完整子规则集仍参与父域排除，更具体 full 可重新启用；WebRTC 继续全局管理。
- Options 与 Popup 提供选择、说明重载及 WebRTC 全局边界。Popup 从父域继承时建立当前域名子规则，复制覆盖与绑定；实际 action Popup 保存链已验证。
- `fixtures/observability`、`serve-observability.mjs` 与 `chrome-observability-audit.mjs` 使用本机页面和临时 Profile，比较七阶段及预设／再次关闭。每轮33个页面realm和55个Worker样本；状态限四种。无产品页面标记、配置桥、extension URL 插入、management 权限或反检测分支。
- manifest WAR 空、externally_connectable 缺省的已有边界保持，并增加 wiring 断言。完整审计范围和外部合同引用在 `docs/development/observability-audit.md`。

## Helium 先行控制实验

先检查用户的 Helium 0.20.1.1（Chromium 156.0.8078.47）原有新 Profile：uBlock 和 Bitwarden 关闭，VanishGeo／ChatGPT 启用。仅临时停用 VanishGeo、新建 localhost 被动观测，取得 zh-CN、Asia/Shanghai、offset -480、语言头 zh-CN,zh;q=0.9；不调用真实位置或主动 ICE。随后恢复 VanishGeo 启用。未保存、导入或替换其真实出口档案／站点配置，没有在真实检测服务点击检测或实现特定服务逻辑。

正式七阶段先在 Helium 临时 Profile 跑完，再运行 Chrome。临时 Helium 原生管理页必须先出现 uBlock，再正常关闭并读回；不安装 ChatGPT，避免控制扩展干扰。最终已重新确认个人 Profile 仅 VanishGeo 和 ChatGPT 开启，uBlock／Bitwarden 关闭，保留原有网页，关闭本次新增页面和本机服务。未宣称取得个人配置前后完整哈希恢复证明。

## 实际观测

- 两浏览器的顶层、同源／跨源 iframe：开启语言、时区、定位和字体有 OBSERVABLE 差异。函数名称、length／toString 也有区别，不仅是返回值变化。
- strict 覆盖显式 locale／timeZone，部分非法显式参数不再触发原生错误；这是现有产品合同，未新增掩盖层。
- 合成位置自有属性、合成权限状态可观察，原生 GeolocationPosition.coords getter 拒绝合成对象，品牌检查 OBSERVABLE。未取得原生位置对象的完整对照为 UNKNOWN。
- 字体阶段固定43项 check 全为 false，原生对照均为 true；其中7项的测量宽度与原生不同。fonts／webrtc／full 重复阶段的向量完全一致。它是稳定行为签名，不是唯一产品身份或所有字体已隐藏的证明；未随机扰动结果。
- Blob classic/module 语言时区跟随；HTTP classic/module 和 SharedWorker 保留原生。已支持/未支持API及具体值分开记录。
- 未观察到产品全局键、扩展 URL、DOM 标记或新增节点／属性结构差异；只能说明本探针覆盖的样本。
- native／总开关关闭的新文档已采字段保持 NATIVE，注册及所属语言头为空。consistency 的定位／字体回到原生，语言时区仍 OBSERVABLE。native 期间全局严格 WebRTC policy 保持；没有把它误归成站点级释放。
- Chrome 无 STUN/TURN 时原生可出现 host 候选；strict 后空候选保持 UNKNOWN。Helium 的空候选也为 UNKNOWN。没有网络无泄漏结论。

## 验证

| 检查 | 本次结果 |
| --- | --- |
| npm ci | exit 0 |
| npm run check | exit 0；两项类型检查、365/365测试、生产构建 |
| npm run test:e2e:chrome -- --dry-run | exit 0，仅清单检查 |
| git diff --check | exit 0 |
| 新七阶段/预设矩阵：Helium156、Chrome155 | 两者 exit 0；各11场；33页面realm＋55Worker；正式Options及实际action Popup事件链 |
| chrome-onboarding-smoke --config-only | exit 0；6项UI／策略往返、损坏配置及恢复；provider请求0；最终构建再次通过 |
| chrome-navigator-contract | exit 0；维护源隔离函数，不冒充生产恢复 |
| chrome-exit-recommendation-smoke | exit 0 |
| chrome-header-sync-smoke | exit 2；migration-complete超时；未修改HEAD副本同阶段复现 |
| chrome-font-filter-smoke --production | exit 2；registration-matches读回比较；HEAD副本同阶段复现，未确定新增生产缺陷 |
| chrome-geolocation-smoke | exit 1；HEAD副本同样失败；含过期的无DNR manifest断言及后续场景失败 |
| chrome-intl-smoke | exit 1；HEAD副本同样失败；旧v3缺intlMode迁移假设与当前验证不符 |
| chrome-diagnostic-smoke | exit 1；HEAD副本同样拒绝其不完整配置 |
| chrome-integration-smoke | exit 1；两个前置场景已执行，历史DNR场景失败；HEAD副本复现 |

旧脚本失败没有改为跳过或通过，也没有重写历史全能力预期以伪装验收成功。使用 git archive HEAD 的独立源码副本和复用当前依赖，独立构建后复现六类失败；没有切换或回退当前工作区。基线header首次缺参数的尝试不算复现，补齐 --output 后取得相同 migration-complete 超时。相关退出码及精简矩阵在 `evidence.json`，完整原始记录位于忽略的 `release/vg043/`。

本工具开发中的失败尝试保留在 release/vg043：最初缺少Options保存alert处理导致采样后的UI检查超时，之后正常处理仅save alert，补齐各realm断言及真实Popup事件，最终candidate两浏览器均exit0。没有用失败尝试代替最终构建证据。原始candidate JSON含build SHA256，精简归档另保存其文件摘要。

## 边界与收尾

未运行需独立环境、正常UI安装协调或用户输入信号的Chrome138、冷启动／会话恢复和人工升级门禁；未以历史研究脚本作为本轮生产资格。没有补任意CSP、opaque文档、跨站OOPIF、嵌套／外来Blob、BFCache、真实定位、STUN／TURN、代理组合或所有网站。其他设备API、DOM字体／local()／OffscreenCanvas等没有新的接管。

所有临时浏览器／Profile由runner关闭清理，本机两个服务已退出，独立HEAD副本清理后仅保留脱敏证据。构建后的真实个人Helium扩展未由本任务执行升级验收；使用新UI时需在扩展管理页正常重新加载，并按配置重建网页。本任务review不等于人工验收或发布批准。

## 2026-10-28 提交与合并检查

用户明确授权提交、推送本地最新代码并合并分支。保留本任务 review／人工验收 pending，不将提交授权解释为发布授权。上述 2026-10-26 浏览器矩阵只覆盖当时构建，不用于证明后续环境快速设置、语言独立解析、Canvas 平台字体或 Blob Worker 字体改动已通过浏览器验收；本轮没有启动浏览器。

合并前独立只读复核发现，新增文件型 Worker 字体钩子会把 HTTP(S) Dedicated Worker 与 SharedWorker 改成 Blob 入口，与持续暂停合同冲突。生产注册已移除此入口；维护实验生成器保留，旧实验前缀仍纳入读取、撤销和读回确认。回归检查覆盖生产不派发、可选 Canvas 不恢复该钩子及遗留注册撤销；已接管 Blob 链的字体名单传递保留。同步更新界面／配置指南的支持边界，并使用文档网段地址替换测试中的公网地址占位。

当前候选重新执行 `npm run check`：源码与测试类型检查、398/398 测试（0 失败、0 跳过）及生产构建通过。`git diff --check` 与 `npm run test:e2e:chrome -- --dry-run` 通过；后者仅验证清单入口，不是实际 Chrome 验收。独立复核在上述修正后未发现其他已确认的合并阻断。
