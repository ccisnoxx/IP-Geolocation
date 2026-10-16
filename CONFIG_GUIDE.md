# VanishGeo 配置指南

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；Geolocation / Permissions geolocation、Canvas、Worker / SharedWorker 继续暂停。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。DNR 与 WebRTC 仍独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

当前源码版本为 **2.1.1（未发布）**。页面语言/时区需 Chrome 138+、userScripts 权限及正常开启 Allow User Scripts；配置注册成功后按文档快照执行。DNR 与 WebRTC 独立同步；其他页面能力继续暂停。扩展不改变代理或网络出口。安装步骤见 [INSTALL](INSTALL.md)，数据处理见 [PRIVACY](PRIVACY.md)。

## 首次配置、升级与重置

- **fresh install**：没有当前或旧配置键及初始化标记，后台建立 schema v2 安全配置：总开关关闭、空规则、WebRTC default。不会在安装、启动或打开管理页时检测出口。
- **upgrade**：存在配置或旧初始化标记，继续既有迁移语义；已有 v2 的有效开关、WebRTC、规则与 Profile 保留，空规则不补回默认站点。升级事件不自动打开引导。
- **reset**：用户在 Popup 或 Options 明确确认后清空配置、规则、环境方案、出口档案、历史和待确认候选，回到安全新默认值。选择清空而非保留已验证档案，是为了避免旧出口在重置后被误认为仍有效。不能恢复已删除数据；下载文件与外部站点数据不删除。

Options 配置引导要求三步：点击检测并确认出口 → 显式选择已确认档案和站点 → 选择 WebRTC 策略、勾选确认并点击“保存并启用所选站点”。默认不预选站点，WebRTC 默认保持 browser default；选 strict/compatible 会改变浏览器全局策略。所选规则改为继承全局并绑定出口，全局位置/时区切为 auto，其他设置和其他规则保留；开启总开关也会恢复其他已启用规则。引导只提交其自身选择，下方未保存表单不参与。

“跳过并保持关闭”关闭总开关并清除本扩展 WebRTC 设置，保留已经保存的档案/规则。直接关闭引导不自动提交或启用。引导不保存独立进度；重新打开可继续使用已保存档案。两页显示未配置、部分配置、已配置关闭或已启用，并单独展示同步状态；已保存但同步失败不能当作全部生效。

## 规则与保存

1. 在 Popup 查看当前站点状态，或在 Options 编辑域名列表。域名示例用 `example.com`，本地诊断用 `localhost`。
2. 开启总开关及目标规则。域名规则通常匹配本域和子域；更具体的启用规则优先。后台从同一 resolver 派生最小语言/时区 payload；更具体的启用规则通过 excludeMatches 阻止父域重复执行，即使该子规则没有有效页面信号。
3. Options 修改后点击“保存当前配置”；Popup 的控件 change/blur 会自动保存，观察保存状态。后台先校验配置与 DNR 容量，再保存并对账；语言/时区脚本提前注册，DNR、WebRTC 分别报告实际同步状态。只有注册同步成功才提示已有受影响文档完整 reload 或关闭重开；不会自动刷新、热更新或撤销旧 hook。

两页常驻“运行时同步状态”区分配置已保存和实际同步；部分失败显示“已保存但未完全生效”及失败组件。点击“重试同步”只按已保存配置重试，不保存当前未保存的表单。安装、浏览器启动和 service worker 再次唤醒也会对账；已收敛注册不重复修改，扩展 update 清除的注册会重建。API/权限/用户开关不可用时页面语言/时区 fail closed，无旧路径回退。当前页面实际值未采样时为 UNKNOWN；待重载提示保守保留，不能凭保存成功认定旧文档已使用新值。浏览器 API 暂时失败不会回滚配置；容量不足、保存前无法准备刷新快照/恢复记录或配置写入失败则返回错误，不宣称已保存。WebRTC 同步只证明策略操作与可观察状态，不证明 ICE 网络防护。

文本域名列表显示启用规则，未显示的禁用规则仍保留；重新输入已有禁用域名会保留原 ID、覆盖设置和出口绑定。删除列表中的启用域名会删除该规则。Popup 的“不启用”会删除当前匹配规则，Options 规则卡的“删除”也会删除规则。

## auto 与出口档案

auto 表示使用**本规则显式绑定的已确认出口档案**，不表示自动联网刷新。

1. 在 Options 点击“检测新出口”；此动作会向外部 IP 定位 provider 请求当前网络出口信息。
2. 检查同一次完整响应中的 IP、国家、时区与坐标，确认并命名档案。取消或检测失败不会替换已保存的档案。
3. 在“站点特定规则”选择该 verified 档案并保存，或在 Popup 为当前规则绑定已有 verified 档案。
4. 切换代理或网络后，在 Options 对该档案“重新检测”并确认；它保留原 ID，引用规则继续绑定。没有定时重检。

未选择、不存在或 unverified 的档案不能满足 auto 位置/时区，UI 会显示配置问题。自定义环境方案和出口档案是两个概念：保存/导入自定义方案不能建立 verified 出口身份。档案被规则引用时不能删除，先解除引用再操作。

## 手工配置与信号

位置可手工填写合成坐标，设置精度、随机半径和位置权限伪装；时区使用有效 IANA 标识（例如 `UTC`），不手工猜测夏令时 offset。语言使用主语言、语言列表和 Accept-Language，例如 `en-US`、`en-US, en`、`en-US,en;q=0.9`。语言、位置和时区可分别启用、禁用；逐规则配置可继承、覆盖或禁用信号。

完整自定义环境方案需要有效手工坐标、时区和语言，可“另存为自定义配置”。纬度范围为 [-90,90]，经度为 [-180,180]，精度必须是大于 0 的有限数值；0 是合法坐标。时区使用 IANA 标识，不接受 `+08:00` 这类固定偏移代替时区。名称支持中文、emoji 和重名，每次另存生成独立 UUID，不覆盖同名方案。Popup 的 UTC 偏移按填写的目标时区和当前日期计算，包含夏令时变化；空或无法解析的时区不显示偏移。

完整配置导入会先检查原始自定义方案；任一方案的字段或 ID 唯一性不合法，整个导入失败，错误指出 `profile.profiles[index]` 和字段。请修正对应条目的坐标、精度、时区、名称或 ID 后重试，该失败导入不会触发配置写入或旧键清理，既有配置不会被替换。旧存储读取只返回有效且 ID 唯一的方案，悬空选中 ID 清空；不会在读取已有 v2 时额外重写原始方案数据。旧 `bpg_config` 中合法零坐标迁移为手工模式。

自定义方案不是内置地区整套预设。Canvas 字体过滤当前暂停，勾选或保存不会启用；它不承诺隐藏所有字体、消除 Canvas 指纹或达到检测评分。页面语言仅在 userScripts 注册成功后的匹配新文档使用配置；有效语言同时用于 DNR Accept-Language，请求头同步不代表旧文档的 navigator.language 已改变。未接管的 GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 保持原生透传。

WebRTC 为浏览器全局策略，独立于站点 allowlist：

| 模式 | 当前 Chrome privacy API 操作 |
|---|---|
| strict | 设置 `disable_non_proxied_udp` |
| compatible | 设置 `default_public_interface_only` |
| default | 清除本扩展的策略设置，交回浏览器/其他控制者 |

关闭总开关也会清除本扩展 WebRTC 设置。Options 的 actual policy/levelOfControl 与网页 ICE 分开检查；compatible 不承诺隐藏出口 IP，strict 或无候选也不能替代真实网络验收。

## 时区与 Locale 模式

Popup 的“高级配置 → 时区”和 Options 的“时区”页签提供全局 `intlMode`。以下语义用于注册成功后的匹配新文档。该策略使用各匹配规则解析后的语言/时区值；自定义环境方案只保存信号值，应用方案保留当前模式。它与 WebRTC 的同名策略相互独立，也不控制 DNR Accept-Language。

| 调用 | strict（默认） | compatible |
|---|---|---|
| `Intl.DateTimeFormat()`、其他已有 Intl 服务构造器的默认 locale | 使用已启用的配置语言/时区 | 使用已启用的配置语言/时区 |
| `Intl.DateTimeFormat('en-US', {timeZone:'UTC'})` | 使用已启用的配置语言/时区 | 保留 en-US / UTC，格式化和 resolvedOptions 一致 |
| 只显式指定 locale 或 timeZone | 覆盖已启用的信号 | 保留显式项，只补另一个缺省项 |
| `Date#toLocaleString`、`toLocaleDateString`、`toLocaleTimeString` | 强制已启用的语言/时区 | 同样逐参数尊重显式项 |
| Date 本地 getter、offset 与本地字符串/多参数构造 | 使用已启用的配置时区 | 同左；这些 API 没有调用级 locale/timeZone 参数 |
| UTC getter、时间戳与带显式 offset 的日期字符串 | 保持既有原生路径 | 同左 |

compatible 中省略参数或值为 `undefined` 视为未指定；`[]` 是显式 locale 列表，交原生协商，可能使用浏览器默认语言。显式 null/非法 locale、null options、非法 timeZone 与抛错 getter 保留原生异常，不静默替换；继承或不可枚举的 timeZone 也算显式值。未启用的信号不注入。其他已有 Intl 构造器包括 NumberFormat、Collator、RelativeTimeFormat、ListFormat、PluralRules、DisplayNames、Segmenter；其显式 locale 仍由浏览器协商/规范化，不保证 resolved locale 与输入文本逐字相同。

新安装、重置和旧数据缺字段时均默认 strict，保持升级前强制一致性，避免静默改变隐私预期。schema 仍 v2；读取已有 v2 只在内存补 strict，不重写原配置，下一次正常保存才持久化字段。完整导入/导出保留模式；非法显式模式拒绝导入。回退旧版会忽略模式，保存时可能移除字段；无破坏性迁移。

compatible 优先兼容使用固定语言/时区的站点，允许页面显式结果与默认结果不同，降低强制一致性；两种模式都不承诺不可检测。切换并完成注册后需要完整 reload 或关闭重开文档；已有文档及 BFCache 保持旧模式。Worker / SharedWorker 和 Temporal 不在本阶段恢复范围。

历史全 surface 隔离自动化（非当前生产支持范围）：`node --import tsx scripts/chrome-intl-smoke.mjs --output <脱敏JSON>`，需要 Node22+ 和支持 Extensions CDP domain 的 Chrome。它在临时最小扩展内通过真实 scripting API 验证两模式的当前 top/iframe、classic/module/shared/nested Worker，另加载正式 dist 验证 Options/Popup 文档保存与旧 v2 重复读取。配置仅在扩展内部，经 func/args 交给当前文档；无页面配置桥，无 provider/位置/ICE 调用。临时 profile/server 在 finally 清理；不等同生产恢复、真实 action Popup 或完整人工验收。

## 诊断与数据示例

构建后运行 `npm run serve:leak-test`，从扩展“隐私检测”打开报告，打开/选择 localhost 目标。启用 `localhost` 规则，完成信号配置并刷新，再在扩展报告中运行。无须向 URL、cookie、DOM 或页面消息写入预期配置。外部 observation 页显示实际值并保持 UNKNOWN；扩展报告才比较预期与实际。

文档公网 IP 示例只用 `192.0.2.10`、`198.51.100.10` 或 `203.0.113.10`，它们来自 [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737)，不能当作真实出口、provider 检测结果或本地服务地址。分享配置/报告时另行脱敏，不上传真实位置、IP、个人目录或凭据。完整配置导出包含保存的敏感字段；导入会降级出口档案并清空绑定。
