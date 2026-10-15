# 状态管理

> VG-011 安全暂停：后台已删除对页面伪装 runtime 的 import/executeScript 路径，所有 initializeRuntimeForSender 在可信 sender 校验后、配置读取与派发前拒绝。对账只撤销 vanishgeo-runtime-init；有启用 allowlist 时 contentScripts 报 runtime-injection-paused / partial，注销失败仍 failed；DNR/WebRTC 独立报告。保存、重试、后台唤醒都不能恢复。下文原直接 MAIN 注入描述是恢复前的架构合同，当前不执行；恢复须取得可靠最终文档绑定并另获授权，不能用 URL、时间戳、nonce 或事后 ID 检查代替。已执行 hook/BFCache 文档需关闭并重建。证据见 [调查](../../../docs/stabilization/document-id-investigation.md)。

## 场景：出口位置档案与页面运行时一致性

### 1. Scope / Trigger

- 当站点规则、出口位置检测、配置迁移或页面可见伪装值发生变化时，必须遵守本契约。
- `siteSpoofConfig` 是持久化配置的唯一来源；页面 runtime payload 是按 URL 从该配置派生的瞬时结果。
- 公网 IP、坐标、国家和时区必须来自同一次 IP 定位服务响应，不能由管理页直接写入 verified 档案。

### 2. Signatures

```ts
interface SiteRule {
  exitLocationProfileId: string | null;
}

interface ExitLocationProfile {
  id: string;
  name: string;
  verification: 'verified' | 'unverified';
  publicIp: string | null;
  latitude: number;
  longitude: number;
  country: string;
  timezone: string | null;
  provider: string | null;
  verifiedAt: number | null;
}

detectExitLocation(profileId?: string | null): Promise<ExitLocationDetectionPreview>;
confirmExitLocationDetection(detectionId: string, name: string): Promise<ConfigSaveResult>;
cancelExitLocationDetection(detectionId: string): Promise<void>;
deleteExitLocationProfile(profileId: string): Promise<ConfigSaveResult>;
```

### 3. Contracts

- `SiteSpoofConfig.schemaVersion` 固定为 `2`。
- auto 地理位置或时区只能解析规则显式选择的 verified 档案；`null`、悬空引用和 unverified 档案都不能产生有效 payload。
- 旧 `lastLocation` 迁移为一个可见的 unverified 档案，所有规则保持 `exitLocationProfileId: null`。
- `detectExitLocation` 只产生 `chrome.storage.session` 中的短期候选；确认前不得写入 local 配置。
- 重检确认保留档案 ID，并以 `baseVerifiedAt` 检测并发修改；引用该 ID 的规则继续跟随更新后的档案。
- 完整配置导入必须把出口档案降级为 unverified，并清空规则绑定。
- 配置写入前后按 URL 比较有效 runtime payload 的语义签名，只刷新签名变化的已打开标签页；时间戳、错误文案和管理元数据不得触发刷新。
- content 初始化请求只能携带 `action: 'initializeRuntimeForSender'`；后台必须使用可信 `MessageSender` 定位文档并在 MAIN world 直接执行 runtime，页面不能提交 payload。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| auto 规则未选择档案 | `当前规则未选择出口位置档案`，payload 为空 |
| 规则引用不存在档案 | `当前规则引用的出口位置档案不存在`，payload 为空 |
| 规则选择 unverified 档案 | `当前规则选择的出口位置档案尚未验证`，payload 为空 |
| 检测候选不存在或 ID 不匹配 | `检测结果已失效，请重新检测` |
| 检测候选过期 | 删除候选并返回 `检测结果已过期，请重新检测` |
| 重检期间档案被修改 | `出口位置档案已发生变化，请重新检测` |
| 删除仍被规则引用的档案 | 拒绝，并在错误中列出全部引用域名 |
| 管理动作不是扩展页面发起 | `该操作只允许扩展管理页面调用` |

### 5. Good / Base / Bad Cases

- Good：两个域名分别绑定两个 verified 档案，各自解析对应坐标和时区；重检其中一个档案后只刷新有效 payload 变化的标签页。
- Base：旧配置迁移后显示“待确认旧位置”，规则未绑定；用户重新检测、确认并手动绑定后才启用 auto 信号。
- Bad：Options 通过 `setSiteConfig` 直接构造 verified IP/坐标，或 content 请求携带页面自报 URL/payload 并由后台信任。

### 6. Tests Required

- `tests/config.test.ts`：迁移幂等、未绑定/未验证/悬空引用、两个规则绑定两个档案。
- `tests/background-services.test.ts`：同一响应解析、检测确认、重检并发保护、引用删除阻断、导入降级、payload 精确刷新和失败隔离。
- `tests/anti-detection-runtime.test.ts`：直接 runtime 调用幂等、内部锚点隐藏、frame/worker 行为。
- `tests/extension-wiring.test.ts`：无 `postMessage` 桥、ISOLATED 初始化、定向 MAIN-world 注入及 manifest 权限边界。
- 发布前运行 `npm test`、`npm run typecheck`、`npm run build` 和 Chrome 验收脚本 dry-run。

### 7. Wrong vs Correct

#### Wrong

```ts
window.postMessage({ type: 'apply-spoof', payload }, '*');
await chrome.storage.local.set({ lastLocation });
```

页面可伪造消息，单一 `lastLocation` 也无法表达多个出口。

#### Correct

```ts
chrome.runtime.sendMessage({ action: 'initializeRuntimeForSender' });
rule.exitLocationProfileId = verifiedProfile.id;
```

后台仅根据 `MessageSender` 和持久化配置解析 payload；verified 身份只由检测确认事务创建。

## 场景：管理页规则文本保存

Popup 与 Options 共用 src/shared/rule-list.ts 的 ruleListToText/rulesFromText。文本只表示当前启用域名集合：未显示的禁用规则必须保留，重新写入禁用域名时原位启用并保留原 ID、overrides 和出口档案绑定；移除启用域名时删除该启用规则。

已有规则保持原数组顺序，新域名按文本首次出现顺序追加；无关设置保存和文本重排不能意外重排规则。空行、大小写和 URL 使用 config-model.normalizeDomain 统一归一化后去重，不复制域名匹配器。新规则使用显式确定性且避开已有 ID 的内部身份，再经 normalizeRule 取得原默认值；相同输入结果确定，不修改输入。非法域名仍由 config-resolver.validateConfig 拒绝，文本编辑不能吞掉校验失败。

行为证据来自 tests/rule-list.test.ts、执行真实管理页表单/保存函数的 tests/rule-list-ui.test.ts 和 extension-wiring 的共享接线约束；这些 Node/VM/静态检查不代表真实 Chrome 验收。后台配置队列、多窗口冲突、存储失败恢复及迁移不由此合同改变。

## 场景：自定义 Profile 与零坐标迁移（VG-008）

自定义 Profile 与 verified 出口档案保持两个概念。字段有效性由 config-model 的 getProfileValidationErrors/validateProfile 统一拥有，profile.ts 复用并负责 UUID 创建和应用；不要在 UI 或导入入口另写校验器。

- ID/名称为非空字符串，trim 后 ID 唯一，名称可重复且支持 Unicode。纬度/经度必须是有限 number，范围分别为 [-90,90]/[-180,180]；accuracy 为有限 number 且 >0；时区必须通过 IANA 校验；语言具备非空主语言、语言列表和 Accept-Language。不要将 null、缺失字段或非法 accuracy 修复为有效 Profile。
- normalizeProfiles 为旧存储读取过滤无效/重复 ID 条目，normalizeConfig 清空悬空 activeProfileId。已有 v2 读取不额外重写原始 Profile 存储；正常显式保存仍由 services/storage 负责。validateConfig 先收集原始 profile.profiles 的条目/字段错误，再归一化；保存/导入不得先归一化而掩盖错误。
- saveSiteConfig/importSiteConfig 在进入可能读取和迁移旧 storage 的事务前校验原始输入，失败不触发 local set/remove，也不替换配置。通用保存继续保留当前出口档案，导入成功后继续降级出口档案并清空规则绑定。消息格式、串行队列与对账失败恢复不变。
- createCustomProfile 使用 crypto.randomUUID，与名称解耦，保存/归一化不重生 ID。Options 保留缺失坐标并校验原始表单 accuracy；后台保存成功后才更新本地方案列表，失败重试不重复添加未保存方案；同一页面另存期间禁用确认、取消、主/底保存和重置字体，遮罩关闭及其他完整保存函数也检查同一 pending 状态；finally 恢复后成功路径才关闭弹窗，防止新候选被旧列表覆盖。
- bpg_config 迁移使用显式有限数判断手工模式，合法 0/0、0/120、-30/0 保留。Popup 使用 getTimezoneOffsetMinutes 按目标时区与当前日期显示偏移；显式日期 0 表示 epoch，空/非法输入不猜本机偏移。偏移计算复用 IANA 校验，在 Popup 发送保存前更新，校验失败也不能保留旧值。

证据：tests/config.test.ts、profile.test.ts、profile-ui.test.ts 与 background-services.test.ts；Node/VM/mock 不代表真实 Chrome 或 storage 中断恢复验收。

## 场景：运行时副作用对账（VG-006）

siteSpoofConfig 仍是 schema v2 的唯一 desired state。services 的配置修改和初始化共享串行队列；修改返回 ConfigSaveResult = {config, syncReport}，报告绑定配置 SHA-256，包含 contentScripts/dnr/webrtc/tabReload 的 ok/failed/partial 与可展示固定错误。修改消息 status 为 ok 或 partial，saved:true 只表示配置写入已成功；普通网页不能调用管理页对账 action。

storage 拥有 session runtimeSyncMetadata 读写，只记录摘要、组件状态和待刷新 tab ID/URL 摘要。预写新配置摘要前保存旧摘要欠账，以覆盖 local 写入前/后中断；没有第二份配置。配置写失败恢复旧记录，已保存的配置不因副作用失败回滚。预写/快照/容量失败发生在保存前，保持错误语义；保存后 checkpoint 失败通过 metadataError 可见。浏览器重启/扩展重载会清空 session，已加载新文档按原动态注入路径使用 desired state。

对账先观测实际脚本、动态规则和 privacy 状态，只对差异进行写操作并确认结果；不把期望 policy 当成功。default/禁用不能只由 effective 控制权推断 own override 不存在；必须取得 clear 确认后才允许同一签名跳过。DNR 保存前检查托管 ID、regex、dynamic/unsafe 或 Chrome119 combined session 额度；只修改 1100–2099。全部运行时组件成功后才刷新欠账，四并发、单 tab 错误隔离；关闭/导航目标不再刷新。每批成功清理欠账，API 成功后 checkpoint 前的极窄中断可能导致一次重复刷新（至少一次恢复）。

worker 顶层、onInstalled/onStartup、管理页读取和显式 reconcileRuntime 使用同一对账路径。Popup/Options 常驻状态，部分失败显示“已保存但未完全生效”；重试只读取保存配置，不能保存未提交表单。相同配置收敛后不重复 Chrome 修改/刷新。

验证入口：background-services、dnr、webrtc、runtime-sync-ui 和 wiring 测试，以及按本任务实际边界选择的 Chrome 定向证据。确认提交后的候选清理失败也保持 saved/partial，固定 warning 与待清理 detection ID 可恢复；同一检测 ID 重试不重复创建档案。候选发布/确认/取消/清理共享队列，网络检测在队列外。完整 MV3/iframe/worker/ICE、迁移和多窗口编辑仍需独立验收。

## 场景：安全初始化与引导（VG-010）

schema 保持 v2。config-model.createInitialConfig 是 fresh/reset 的安全初始值：master=false、WebRTC default、rules=[]；历史 DEFAULT_CONFIG 和 normalizeConfig 缺省值仅服务既有数据兼容，不能用于首次建档或 reset。config-resolver 根据当前/旧配置键及初始化标记的存在性区分 fresh/upgrade，v2 空规则即使缺标记也不补默认规则。storage 对已有 v2 只补标记，不重写原始配置；新建/旧格式迁移仍一次写入配置和标记。

Options 内置引导复用原检测确认事务。completeOnboarding(domains, profileId, webRtcMode) 在当前配置队列中校验 verified 档案和站点，按用户选择合并规则（保留 ID，所选站点重置为继承），全局位置/时区 auto、master=true；其他规则/信号/方案保留。router 另要求 confirmed=true，管理页来源检查不变。skipOnboarding 只设置 master=false/WebRTC=default，保留内容；无引导进度或第二配置来源。首次 install 在安全空配置时打开现有 Options，update/startup/worker 唤醒不打开引导。

reset 明确清空规则、环境方案、出口档案和历史并回安全初始值；先清 session 候选，清理失败拒绝重置。检测代际使 reset 前在途响应无法重新发布候选；无持久化检测进度。代码回退仍可读 v2，但不能恢复用户已确认删除的数据；旧版空存储/reset 默认值会恢复历史语义。运行时副作用失败继续 saved/partial 和既有对账恢复。

ui-state 从配置派生未配置/部分配置/已配置关闭/已启用，复用 resolver 检查关闭时规则完整性；同步状态独立展示，不能把配置启用投影当实际全部生效。安装/升级/打开UI/引导跳过不发 provider 请求；真实检测只由明确用户动作发起。证据来自 config/background/UI 回归及按任务选择的真实 Chrome smoke。

## 场景：Intl/Date 兼容模式（VG-013）

schema v2 的全局 intlMode: strict|compatible 由 config-model 归一化，缺失/旧存储/新安装/reset 为 strict；validateConfig 对显式非法值拒绝。storage 读取已有 v2 不额外重写；resolver 唯一生成 EffectivePayload.intlMode；services 的语义签名仅在语言/时区有效时纳入模式，继续既有配置队列/刷新欠账。自定义 Profile 不拥有模式，应用 Profile 保留全局策略。不得另建 storage、规则模式或域名匹配器。

runtime-modules/intl-policy.ts 为页面/worker 共用参数策略。strict 保持历史强制覆盖；compatible 仅 locale===undefined 或原生读取 timeZone===undefined 时补启用的默认信号，显式空 locale 数组、继承/不可枚举 timeZone、getter/原生异常保留。compatible resolvedOptions 回报原生实际结果，不能只改回报而格式化继续覆盖。Date 本地 getter 无显式参数，两模式均使用有效时区；UTC/epoch 仍原路径。首次文档模式固定，重复初始化保持既有未来 worker 更新语义；模式进入完整 worker patch source/SharedWorker 身份，已启动 worker 不热更新。

诊断 probe 无预期参数，采默认及固定 en-US/UTC 显式调用；报告按模式独立比较构造结果、NumberFormat 与 Date locale/format hour，缺证据 UNKNOWN。预期不进入页面 URL/DOM/storage；production MAIN 安全暂停不改，真实模式 Chrome smoke 仅临时最小扩展当前文档，正式 dist 仅测试配置和暂停。

证据入口：tests/intl-mode.test.ts、rule-list-ui、background-services 与 diagnostic-report；scripts/chrome-intl-smoke.mjs。精确语义、权衡、回退和浏览器限制见 CONFIG_GUIDE；本任务人工验收前 review。
