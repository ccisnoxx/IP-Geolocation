# VanishGeo 配置指南

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；定位已于 VG-029（2026-10-22）获用户授权恢复，按独立注册状态报告；Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

当前源码版本为 **2.1.1（未发布）**。页面语言/时区需 Chrome 138+、userScripts 权限及正常开启 Allow User Scripts；配置注册成功后按文档快照执行。WebRTC 独立报告；其他页面能力继续暂停。扩展不改变代理或网络出口。安装步骤见 [INSTALL](INSTALL.md)，数据处理见 [PRIVACY](PRIVACY.md)。

## 首次配置、升级与重置

- **fresh install**：没有当前或旧配置键及初始化标记，后台建立 schema v3 安全配置：总开关关闭、空规则、WebRTC default。不会在安装、启动或打开管理页时检测出口。
- **upgrade**：存在配置或旧初始化标记，继续既有迁移语义；v2 升级至 v3 后有效开关、WebRTC、规则与 Profile 保留，空规则不补回默认站点。升级事件不自动打开引导。
- **reset**：用户在 Popup 或 Options 明确确认后清空配置、规则、环境方案、出口档案、历史和待确认候选，回到安全新默认值。选择清空而非保留已验证档案，是为了避免旧出口在重置后被误认为仍有效。不能恢复已删除数据；下载文件与外部站点数据不删除。

Options 配置引导要求三步：点击检测并确认出口 → 显式选择已确认档案和站点 → 选择 WebRTC 策略、勾选确认并点击“保存并启用所选站点”。默认不预选站点，WebRTC 默认保持 browser default；选 strict/compatible 会改变浏览器全局策略。所选规则改为继承全局并绑定出口，全局位置/时区切为 auto，其他设置和其他规则保留；开启总开关也会恢复其他已启用规则。引导只提交其自身选择，下方未保存表单不参与。

“跳过并保持关闭”关闭总开关并清除本扩展 WebRTC 设置，保留已经保存的档案/规则。直接关闭引导不自动提交或启用。引导不保存独立进度；重新打开可继续使用已保存档案。两页显示未配置、部分配置、已配置关闭或已启用，并单独展示同步状态；已保存但同步失败不能当作全部生效。

## 规则与保存

1. 在 Popup 查看当前站点状态，或在 Options 编辑域名列表。域名示例用 `example.com`，本地诊断用 `localhost`。
2. 开启总开关及目标规则。域名规则通常匹配本域和子域；更具体的启用规则优先。后台从同一 resolver 派生最小语言/时区 payload；更具体的启用规则通过 excludeMatches 阻止父域重复执行，即使该子规则没有有效页面信号。
3. Options 修改后点击“保存当前配置”；Popup 的控件 change/blur 会自动保存，观察保存状态。后台先校验配置，再保存并对账（无 DNR 组件或容量预检）；语言/时区脚本提前注册，WebRTC 报告实际结果。只有注册同步成功才提示已有受影响文档完整 reload 或关闭重开；不会自动刷新、热更新或撤销旧 hook。

两页常驻“运行时同步状态”区分配置已保存和实际同步；部分失败显示“已保存但未完全生效”及失败组件。点击“重试同步”只按已保存配置重试，不保存当前未保存的表单。安装、浏览器启动和 service worker 再次唤醒也会对账；已收敛注册不重复修改，扩展 update 清除的注册会重建。API/权限/用户开关不可用时页面语言/时区 fail closed，无旧路径回退。当前页面实际值未采样时为 UNKNOWN；待重载提示保守保留，不能凭保存成功认定旧文档已使用新值。浏览器 API 暂时失败不会回滚配置；保存前无法准备刷新快照/恢复记录或配置写入失败则返回错误，不宣称已保存。WebRTC 同步只证明策略操作与可观察状态，不证明 ICE 网络防护。

文本域名列表显示启用规则，未显示的禁用规则仍保留；重新输入已有禁用域名会保留原 ID、覆盖设置和出口绑定。删除列表中的启用域名会删除该规则。Popup 的“不启用”会删除当前匹配规则，Options 规则卡的“删除”也会删除规则。

## auto 与出口档案

auto 表示使用**本规则显式绑定的已确认出口档案**，不表示自动联网刷新。

1. 在 Options 点击“检测新出口”；此动作会向外部 IP 定位 provider 请求当前网络出口信息。
2. 检查同一次完整响应中的 IP、国家、时区与坐标，确认并命名档案。取消或检测失败不会替换已保存的档案。
3. 在“站点特定规则”选择该 verified 档案并保存，或在 Popup 为当前规则绑定已有 verified 档案。
4. 切换代理或网络后，在 Options 对该档案“重新检测”并确认；它保留原 ID，引用规则继续绑定。没有定时重检。

未选择、不存在或 unverified 的档案不能满足 auto 位置/时区，UI 会显示配置问题。自定义环境方案和出口档案是两个概念：保存/导入自定义方案不能建立 verified 出口身份。档案被规则引用时不能删除，先解除引用再操作。

## 手工配置与信号

位置可手工填写合成坐标，设置精度、随机半径和位置权限伪装；时区使用有效 IANA 标识（例如 `UTC`），不手工猜测夏令时 offset。网页语言只配置主语言和语言列表，例如 `en-US`、`en-US, en`；HTTP Accept-Language 保持浏览器原生。语言、位置和时区可分别启用、禁用；逐规则配置可继承、覆盖或禁用信号。

完整自定义环境方案需要有效手工坐标、时区和语言，可“另存为自定义配置”。纬度范围为 [-90,90]，经度为 [-180,180]，精度必须是大于 0 的有限数值；0 是合法坐标。时区使用 IANA 标识，不接受 `+08:00` 这类固定偏移代替时区。名称支持中文、emoji 和重名，每次另存生成独立 UUID，不覆盖同名方案。Popup 的 UTC 偏移按填写的目标时区和当前日期计算，包含夏令时变化；空或无法解析的时区不显示偏移。

完整配置导入会先检查原始自定义方案；任一方案的字段或 ID 唯一性不合法，整个导入失败，错误指出 `profile.profiles[index]` 和字段。请修正对应条目的坐标、精度、时区、名称或 ID 后重试，该失败导入不会触发配置写入或旧键清理，既有配置不会被替换。旧存储读取只返回有效且 ID 唯一的方案，悬空选中 ID 清空；已规范化 v3 读取不会额外重写配置；v2 首次读取会迁移写回 v3。旧 `bpg_config` 中合法零坐标迁移为手工模式。

自定义方案不是内置地区整套预设。固定内置名单字体过滤已获恢复授权；启用总开关、字体开关及HTTP(S)站点规则并确认注册成功后，仅新文档生效。自定义名单仅保存，不生产派发；不承诺隐藏所有字体、消除 Canvas 指纹或达到检测评分。页面语言仅在 userScripts 注册成功后的匹配新文档使用配置；请求头不再随配置改变，网页语言与原生 Accept-Language 不一致不判为扩展失败。未接管的 GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 保持原生透传。

字体暴露过滤在 Popup 和 Options 提供固定内置 `vendor-software` / 自定义 `custom` 模式。内置只读名单共43项：16项厂商／软件字体保留，2026-10-22获用户授权增加19项简体和8项繁体中文字体。完整名单以 `src/shared/font-families.ts` 及界面只读列表为准，包含微软雅黑、宋体、苹方、思源、Noto CJK 等。旧v3内置模式读取时使用当前43项，保留原开关；custom 模式仍保留用户名单且不生产派发。2026-10-22另获授权：仅顶层Canvas文本测量使用包内固定monospace/sans-serif/serif允许名单，无允许项回退sans-serif；FontFaceSet.check及iframe仍使用43项过滤名单。测量与原生绘制可能不一致，影响文本排版和站点兼容性；并非虚拟字体库存。仅总开关、字体开关及HTTP(S) allowlist均启用时注册，新文档生效。

v2 字体迁移确定且幂等：旧 canvas 关闭时使用关闭的新默认；启用且名单与旧宽默认集合等价时换成新内置名单；启用且为自定义集合时迁移为 custom，trim、去空、按规范键去重并保留首次显示值。语言、方案和规则覆盖中的 acceptLanguage 被丢弃，v3 导出不含 canvas/acceptLanguage。规则（含禁用规则）、verified 出口档案、WebRTC、位置、时区及 intlMode 保留；导入仍将出口档案降为 unverified 并清空绑定，非法输入写前拒绝。

当前版本已移除 DNR 权限。无论经过 VG-028 清理升级，还是从更旧 v2 直接升级，HTTP 请求头均保持原生；跳级不保证删除浏览器磁盘中的旧动态规则，但权限缺失时不启用。以后重新引入 DNR 必须单独设计清理迁移，不通过重试同步重新授权。

WebRTC 为浏览器全局策略，独立于站点 allowlist：

| 模式 | 当前 Chrome privacy API 操作 |
|---|---|
| strict | 设置 `disable_non_proxied_udp` |
| compatible | 设置 `default_public_interface_only` |
| default | 清除本扩展的策略设置，交回浏览器/其他控制者 |

关闭总开关也会清除本扩展 WebRTC 设置。Options 的 actual policy/levelOfControl 与网页 ICE 分开检查；compatible 不承诺隐藏出口 IP，strict 或无候选也不能替代真实网络验收。

## 时区与 Locale 模式

Popup 的“高级配置 → 时区”和 Options 的“时区”页签提供全局 `intlMode`。以下语义用于注册成功后的匹配新文档。该策略使用各匹配规则解析后的语言/时区值；自定义环境方案只保存信号值，应用方案保留当前模式。它与 WebRTC 的同名策略相互独立，不会改变原生 Accept-Language。

| 调用 | strict（默认） | compatible |
|---|---|---|
| `Intl.DateTimeFormat()`、其他已有 Intl 服务构造器的默认 locale | 使用已启用的配置语言/时区 | 使用已启用的配置语言/时区 |
| `Intl.DateTimeFormat('en-US', {timeZone:'UTC'})` | 使用已启用的配置语言/时区 | 保留 en-US / UTC，格式化和 resolvedOptions 一致 |
| 只显式指定 locale 或 timeZone | 覆盖已启用的信号 | 保留显式项，只补另一个缺省项 |
| `Date#toLocaleString`、`toLocaleDateString`、`toLocaleTimeString` | 强制已启用的语言/时区 | 同样逐参数尊重显式项 |
| Date 本地 getter、offset 与本地字符串/多参数构造 | 使用已启用的配置时区 | 同左；这些 API 没有调用级 locale/timeZone 参数 |
| UTC getter、时间戳与带显式 offset 的日期字符串 | 保持既有原生路径 | 同左 |

compatible 中省略参数或值为 `undefined` 视为未指定；`[]` 是显式 locale 列表，交原生协商，可能使用浏览器默认语言。显式 null/非法 locale、null options、非法 timeZone 与抛错 getter 保留原生异常，不静默替换；继承或不可枚举的 timeZone 也算显式值。未启用的信号不注入。其他已有 Intl 构造器包括 NumberFormat、Collator、RelativeTimeFormat、ListFormat、PluralRules、DisplayNames、Segmenter；其显式 locale 仍由浏览器协商/规范化，不保证 resolved locale 与输入文本逐字相同。

新安装、重置和旧数据缺字段时均默认 strict，保持升级前强制一致性，避免静默改变隐私预期。schema 已升级至 v3；合法 v2 配置首次读取迁移写回，v3 稳态读取不重写。完整导入/导出保留模式；非法显式模式拒绝导入。回退旧版会忽略模式，保存时可能移除字段；无破坏性迁移。

compatible 优先兼容使用固定语言/时区的站点，允许页面显式结果与默认结果不同，降低强制一致性；两种模式都不承诺不可检测。切换并完成注册后需要完整 reload 或关闭重开文档；已有文档及 BFCache 保持旧模式。Worker / SharedWorker 和 Temporal 不在本阶段恢复范围。

历史全 surface 隔离自动化（非当前生产支持范围）：`node --import tsx scripts/chrome-intl-smoke.mjs --output <脱敏JSON>`，需要 Node22+ 和支持 Extensions CDP domain 的 Chrome。它在临时最小扩展内通过真实 scripting API 验证两模式的当前 top/iframe、classic/module/shared/nested Worker，另加载正式 dist 验证 Options/Popup 文档保存与旧 v2 重复读取。配置仅在扩展内部，经 func/args 交给当前文档；无页面配置桥，无 provider/位置/ICE 调用。临时 profile/server 在 finally 清理；不等同生产恢复、真实 action Popup 或完整人工验收。

## 诊断与数据示例

构建后运行 `npm run serve:leak-test`，从扩展“隐私检测”打开报告，打开/选择 localhost 目标。启用 `localhost` 规则，完成信号配置并刷新，再在扩展报告中运行。无须向 URL、cookie、DOM 或页面消息写入预期配置。外部 observation 页显示实际值并保持 UNKNOWN；扩展报告才比较预期与实际。

文档公网 IP 示例只用 `192.0.2.10`、`198.51.100.10` 或 `203.0.113.10`，它们来自 [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737)，不能当作真实出口、provider 检测结果或本地服务地址。分享配置/报告时另行脱敏，不上传真实位置、IP、个人目录或凭据。完整配置导出包含保存的敏感字段；导入会降级出口档案并清空绑定。

## 出口环境推荐（VG-026）

Options 的引导也可用于已有配置：主动检测并确认出口，选择已确认档案和站点，查看推荐，然后勾选明确启用。国家码只来自同次响应的明确代码字段；旧档案无代码显示未知，主动重检后才可能出现地区语言候选，不按国家名称、IP或时区猜测。

默认“保留我的语言”保留所选规则的既有覆盖或全局语言设置，不是改浏览器偏好。也可选择“出口地区语言”；该表只维护部分地区，多语言地区给一个常用示例，不代表个人偏好。时区默认建议显式绑定已确认档案的 auto 值，置信度只代表单provider声明，未交叉验证。选择“保留”时对应配置不变。

查看/更改推荐不保存、不发请求；选择变化或重新读取配置会撤销旧勾选。确认时后台在同一配置队列重新检查档案verified和检测版本，过期拒绝；只写选中规则的语言/时区覆盖，保留其他规则和全局语言/时区/位置。开启总开关会同时启用其他原已保存有效规则，界面已提示。WebRTC与字体是全局配置，默认保留，选择更改会在确认前提示影响范围。

选择字体建议会启用固定内置名单，并仅在已启用HTTP(S)站点上提前注册；custom仍暂停。已有文档与BFCache保留旧快照，须完整重载或关闭重开；提示保守包含可能嵌入受影响iframe的页面。定位与权限语义按下述VG-029合同；Worker仍暂停。保存成功与页面实际应用分开显示；userScripts正常用户开关未启用时可保存但报告部分生效。重试只对账已保存配置，不应用未提交的表单。


## VG-025 固定内置名单字体过滤（2026-10-20 已获恢复授权）

仅在总开关、字体开关和HTTP(S) allowlist规则均启用且模式为vendor-software时，注册包内单文件font-exposure/filter.js（MAIN/document_start/allFrames，无origin fallback）。字体不依赖Allow User Scripts；语言/时区仍独立需要该开关。只覆盖CanvasRenderingContext2D.measureText与FontFaceSet.check；顶层measureText使用三种通用字体允许名单；check及iframe保持43项固定过滤，非目标透传。绘图/像素/导出保持原生，不覆盖DOM尺寸、local()、OffscreenCanvas或Worker。custom名单和Worker继续暂停；定位使用独立入口。

固定字体文件不含用户配置、IP、位置、规则或档案payload，不读storage、不接受页面桥、不新增外部请求或权限。保存与Chrome注册撤销不是原子操作；同步报告确认的是新文档注册。旧hook/BFCache文档需完整重载或关闭重建，不热更新、不自动reload；字体重载提示保守包含可能嵌入受影响iframe的HTTP(S)标签页。恢复授权不等于人工验收通过，当前不提交或发布。


## VG-029 地理位置

2026-10-22 用户明确授权恢复，人工验收状态以 task-manifest 为准。仅在总开关、定位开关和有效站点规则均启用时，独立userScripts在MAIN/document_start/allFrames安装；Chrome138+正常开启Allow User Scripts，API不可用不回退。manual使用保存坐标；auto仅取当前规则明确绑定且verified的出口档案，不自动检测，不由网页提供配置。语言/时区与位置独立解析与报告。

只在原生存在定位API、非opaque、安全上下文且Permissions-Policy允许的普通HTTP(S)网页工作。普通不安全HTTP、about:blank/srcdoc/data/blob/特殊sandbox与Worker不支持。getCurrentPosition返回合成位置，watchPosition首个结果及可见恢复时报告同一文档固定坐标；不模拟运动、不固定轮询。clearWatch取消待交付回调；隐藏/冻结暂停交付，BFCache恢复仍用原快照，离开文档清理监听。

开启“合成位置权限伪装”时，geolocation权限结果表示本扩展提供合成坐标，不修改Chrome授权或调用真实定位；关闭时permissions.query保持原生，仅granted交付合成位置，prompt/denied返回拒绝，不唤起真实定位。权限API异常不变成授权成功。合成坐标对象保留原生prototype但不拥有浏览器内部slot；没有隐藏反射或保证无法检测的承诺。

保存/改坐标/删除规则/关闭后，确认同步完成再重新加载或关闭重开原网页。旧文档与BFCache可能继续返回旧坐标，已交给网页的数据无法撤回。iframe按自身URL匹配，位置注册变化对所有普通HTTP(S)标签页保守提示重载，以覆盖顶层未匹配但子帧匹配的情况；后台重启/扩展更新恢复注册。面板只显示简短定位状态，完整错误与边界在配置页。
