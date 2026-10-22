# VanishGeo 隐私边界

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；定位已于 VG-029（2026-10-22）获用户授权恢复，按独立注册状态报告；Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

本说明描述当前维护源的数据流与存储；权限清单见 [PERMISSIONS](PERMISSIONS.md)。VanishGeo 不提供 VPN/代理，不改变正常请求的网络出口，也不承诺匿名或让网页无法观测浏览器。没有后台定时出口刷新，也没有配置同步到开发者服务器的流程。

## 用户主动出口检测

只有在 Options 点击引导的“检测并确认出口”、“检测新出口”或“重新检测”时，后台依次尝试 `https://ipwho.is/`、`https://ipapi.co/json/`、`https://ipinfo.io/json`。第一个可解析的完整响应结束本次检测；每次请求有 3500ms 超时。不会把不同响应拼成出口身份，也不会由安装、启动、打开 Popup 或 auto 信号自动发起这些请求。确认/绑定已存在档案不再次联网。

这些请求由扩展后台发出，provider 可以看到网络出口 IP 和正常请求信息；返回 IP、坐标、国家、时区和 provider 身份。请求不主动附加站点规则、用户配置、位置历史或诊断预期值。provider 的保留政策不由扩展控制，源码使用普通 fetch，没有增加匿名传输层或显式的 credentials/referrer 设置。实际请求及响应验证见 [services.ts](src/background/services.ts)。

auto 使用每条规则显式绑定的 verified 档案。verified 只由后台检测后的确认事务建立，不证明当前网络仍使用该出口；网络改变后需要主动重新检测。导入不能建立 verified 身份。

## 保存的数据与生命周期

| 位置 | 当前数据 | 保留与清理 |
|---|---|---|
| `chrome.storage.local` 的 `siteSpoofConfig` | schema v3 总开关/debug、全局 Intl strict/compatible 模式、规则域名与绑定/覆盖、语言、时区、手工坐标与精度/随机设置、用户保存的坐标历史、自定义环境方案、字体暴露过滤模式与名单；已确认出口档案含名称、公网 IP、坐标、国家、时区、provider 与检测时间 | 跨浏览器重启保留；由用户编辑/删除或重置配置。删除档案前必须解除规则引用；卸载会清除扩展本地存储。没有扩展实现的加密层 |
| local 的 `vanishgeoRulesInitialized` | 规则初始化/迁移标记 | 用于一次配置迁移；旧配置键按 storage 维护源清理 |
| local 的 `legacyDnrCleanupV3Complete` | 旧版历史清理布尔标记，不含配置或请求数据 | 当前版本不写入或依赖此惰性旧键；保留读取兼容，卸载清除 |
| `chrome.storage.session` 的 `pendingExitLocationDetection` | 一份待确认 candidate（IP/坐标/国家/时区/provider/时间）、检测 ID、重检目标与旧验证时间、过期时间 | 五分钟后拒绝确认；成功确认/取消/访问已过期候选时删除，新检测覆盖旧候选。没有定时物理删除器；service worker 暂停不等同于 session 清空 |
| `chrome.storage.session` 的 `runtimeSyncMetadata` | 版本、配置 SHA-256 摘要、语言/时区与字体注册/WebRTC/人工重载提示状态与固定错误类别、待重载 tab ID 和 URL 摘要；预写时保留旧配置摘要的刷新欠账（含可选page/font标签和字体注册窗口补录标记）；已确认检测的待清理 ID | 用于 service worker 暂停后的恢复，关闭/导航清理相应人工重载提示；同 URL 完整重载可能保守保留提示。没有配置副本、原始 URL、IP、坐标或原始 API 错误；不进入配置导出。浏览器重启、扩展重载/更新/禁用时 session 清空，避免旧 tab ID 跨会话重用；摘要不承诺匿名化 |
| 后台诊断内存 | 最小预期信号、run ID、报告/目标文档身份、状态、两分钟 TTL | 消费一次；完成、取消、过期、执行中导航/关闭/配置变更或后台重启失效并释放敏感状态。少量有上限的短期终态只保留原因/所有者 |
| 扩展报告页面内存与 DOM | 当次预期、实际值、PASS/FAIL/UNKNOWN；不保留 ICE 地址，只展示分类数量 | TTL、清除或离开报告页释放；无诊断持久化、导出或跨会话恢复 |
| 外部诊断页内存与 DOM | navigator、Intl/Date、位置回调、ICE 候选和设备/realm 的实际观测 | 页面可见；重新加载/关闭释放其内存快照。网页本身仍能读取这些 API |
| 外部诊断 origin 的 localStorage | 用户点击“记录真实设备基线”保存的实际设备观测，以及界面语言偏好 | 基线清除按钮只删除设备基线；清除该站点数据可删除两者。扩展卸载不清除此站点数据 |
| 用户下载的 JSON | 完整配置或单个自定义方案，取自当前表单 | **完整配置导出未脱敏**，可含出口 IP/位置、档案名称、规则和坐标历史；下载文件不会随重置/卸载删除，需用户自行管理 |

扩展未使用 `chrome.storage.sync` 上传配置。Chrome session storage 会在扩展禁用、重新加载、更新或浏览器重启时清空；本地扩展存储卸载时清除，清浏览器历史不能代替清理扩展配置。参见 [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)。

导入会把出口档案降为 unverified，清空其公网 IP/provider/verifiedAt 与规则出口绑定，但仍可能保留坐标、名称和历史等其他配置字段。重置会清空本地配置、规则、环境方案、出口档案与历史，删除 pending session 候选，使重置前在途检测响应失效，并关闭保护、恢复本扩展 WebRTC 默认策略；清理失败会明确报错。重置不删除下载文件或外部记录。跳过引导只关闭保护和恢复本扩展 WebRTC 默认策略，保留已保存内容。迁移/保存的权威源是 [storage.ts](src/shared/storage.ts) 与 [config-model.ts](src/shared/config-model.ts)，不存在第二份配置存储或网页配置桥。

## 站点注入、原生请求头与 WebRTC

manifest 的 `<all_urls>` host 权限允许用户在运行时选择任意规则域名，也支持后台主动 provider 请求、定向脚本与请求头处理。这是较宽的能力授权，不能解读为没有广泛访问能力；当前后台只清理旧 ISOLATED 初始化脚本，不接受页面初始化消息。生产语言/时区使用 userScripts 提前注册，需 Chrome138+ 和用户正常开启 Allow User Scripts；主动诊断仍按原入口采集实际值。普通网页不能传入可信 payload，也不能访问扩展报告 actions。

时区与 Locale 模式保存在同一个 siteSpoofConfig。strict 默认保持强制一致性；compatible 仅对未指定的 locale/timeZone 补配置默认值，页面显式参数与原生错误保留，因此默认/显式结果可能不同。它不改变 navigator/Accept-Language 或 WebRTC 语义，不承诺规避检测。两种模式仅用于已成功注册的匹配 HTTP(S) 新文档；注册失败无旧 documentId 路径回退。

诊断在原有实际值采样中额外执行固定 en-US/UTC 的 Intl.DateTimeFormat、NumberFormat 与 Date locale 调用；top/iframe/Worker 分别返回实际默认和显式结果，预期与模式只在扩展内部比较。固定调用不包含用户配置、无新增外部请求，不增加设备表面；旧 fixture 缺显式观测时为 UNKNOWN。定向 Chrome 模式 smoke 只使用本地 fixture、临时 profile 与合成配置，保存的 JSON 只含浏览器版本、模式及布尔/场景结论，不含个人路径、IP、坐标、凭据或文档身份。VG-023 的独立生产 smoke 使用实际 dist、仅 loopback namespace 与正常用户开关，证据单独保存，不联系第三方站点/provider/STUN。

注册代码仅由固定构建模板和安全 JSON 最小 payload 组成；payload 只有 intlMode 与启用的 language/languages、timezone，不含位置、公网 IP/provider、完整规则/档案或暂停信号，不接受用户 JavaScript、不下载代码、无页面配置桥。匹配的新顶层文档/普通 HTTP(S) iframe 可读语言与时区配置值；旧文档与 BFCache 保留原快照，不尝试撤销 hook 或热更新。配置切换、禁用和更新后，确认注册同步完成再完整 reload 或关闭重开。定位按独立 userScripts 状态报告，Worker/SharedWorker 继续暂停；固定内置字体过滤按独立注册状态报告；about:blank/srcdoc/data/blob/特殊 sandbox unsupported / UNKNOWN，其他设备 API 保持原生透传。

HTTP Accept-Language 与其他请求头保持原生；当前版本不再申请 DNR 权限，不调用或回读该 API，不写清理标记。旧 v2 跳级升级可能保留磁盘旧规则，但权限缺失时不启用；未来重新引入 DNR 必须独立设计清理迁移。请求仍直接到目标站点，不经过扩展提供的转发服务器。目标、网络出口服务和服务器日志仍可看到正常 IP/请求头。WebRTC 使用浏览器全局 `chrome.privacy.network.webRTCIPHandlingPolicy`，strict/compatible/default 的操作见 [CONFIG_GUIDE](CONFIG_GUIDE.md)；它不限于 allowlist 站点。设置可能受其他扩展或浏览器策略控制，期望值、实际控制权与 ICE 网络结果分开报告。运行时对账只调用现有 Chrome 脚本/privacy/tabs API，不主动检测出口或 ICE；完整 reload 由用户手动执行，会产生网页自身的正常网络请求，仍受该页面/目标服务的数据边界约束。

## 诊断目标页与扩展侧比较

打开“隐私检测”先进入扩展 `diagnostic/report.html`，此动作不解析或传出预期配置。报告页按钮打开固定 hosted HTTPS 目标或用户选端口的 localhost；URL 只带固定 UI 语言 `ui=zh`。后台仅在用户选择目标并运行后解析有效配置，绑定报告 tab/document 和目标 top documentId。报告资源不设为 web accessible，预期配置与比较函数留在扩展后台/报告页。

采集通过 Chrome scripting API 在目标 MAIN world 执行自包含函数，不传预期参数；ISOLATED 提供文档身份和同文档设备参考。每个子帧重新检查规则和文档身份；来源不能确定或无法观测时 UNKNOWN。报告只证明当次可观测行，不是完整浏览器审计；MAIN 观测仍可受目标页面干预。执行中取消/过期可以拒绝报告交付，但已经派发的采样依靠有界超时清理，不能承诺瞬间终止所有请求。

请求头只作原生观测，不与网页语言比较保护 PASS/FAIL；字体检测未采样目标字体，即使固定内置名单注册成功也保持 UNKNOWN。配置迁移和字体模型变更不新增外部请求或敏感数据流。

外部 leak-test 固定 observation mode，显示实际值，行与摘要保持 UNKNOWN。它不接收扩展预期配置、privacy 快照或配置桥，不给出配置 PASS/FAIL；旧预期 query 会被忽略。MAIN runtime 的 debugMode 只输出固定应用提示，不记录完整 payload 或预期坐标；后台仍可能显示操作失败类别/消息，提交问题前应脱敏日志。

## 诊断外部请求与观测限制

- 打开托管目标会请求该站点；服务器可见正常网络出口、路径和请求头，可能保留自己的日志。固定 hosted 地址由 [services.ts](src/background/services.ts) 定义；本地 build 不会更新远端部署。
- 外部 observation 页在加载时采集被动 API 并请求同源 `/headers.json`；位置、ICE 与 realm 的主动检查（包括“运行全部检测”）可读取实际位置/候选。外部页面内存可显示原始地址和回调坐标。
- 外部页与其 header fetch 设置 no-referrer，但 header fetch 是普通同源请求，未显式 omit credentials。同源服务器可见浏览器实际发送的请求头/cookie。本地 echo 会回显请求头，不应把含凭据的原始响应作为问题附件。
- 扩展主动 run 的 MAIN header echo 使用 no-referrer、omit credentials、禁止重定向和五秒超时；只读取实际 Accept-Language。位置/watch 可能调用原生权限或既有伪装；实际回调只进入扩展内存报告，不额外写进目标 DOM。
- 外部主动 ICE 和扩展 run 均使用现有 Google STUN `stun:stun.l.google.com:19302`，该服务可能看到网络出口。扩展采样只在窗口内去重并归纳 IPv4/IPv6/mDNS 数量后释放字符串；IP 候选暴露为 FAIL，空候选/未见 IP 为 UNKNOWN，policy PASS 不能证明 ICE 防护成功。
- 扩展 run 创建固定路径的同源临时 iframe，并使用同源 classic/module/SharedWorker fixtures，URL 不带预期配置。临时 iframe/worker 的正常请求仍到目标 origin；文件缺失、CSP 或 API 限制为 UNKNOWN。
- 设备透传比较是同文档 MAIN/ISOLATED 的当次值，不是启用前完整基线，不新增设备伪装。localhost 可以避免托管诊断站点请求，**但主动 ICE 仍可能联系 Google STUN**，并不等于完全离线。

扩展不设置用于传送预期配置的 URL、cookie、外部存储或页面消息桥；这不阻止普通网页观察其可见值、浏览器记录访问历史，或外部服务保留已经收到的信息。此前带敏感值的 URL/日志也不会被本说明追溯清除。分享数据与历史清理方案见 [CONTRIBUTING](CONTRIBUTING.md)，证据层级及未验收范围见 [稳定化矩阵](docs/stabilization/acceptance-matrix.md)。

## 最早 inline script 时序验收

`fixtures/injection/` 是专用测试页面：每个文档的首个 head inline script 同步读取 language/languages/locale/timezone 和固定日期 offset，load 回调另读一次；实际结果放在 fixture 自身的 JSON script 与可见区域内。它不接收预期、配置、run ID 或 runtime marker，不写站点 storage，不向服务器回传结果，不在生产页面安装这些标记。

扩展报告的“VG-009”入口沿用一次性内存 run、精确报告来源与文档/TTL 校验。MAIN 只读既有快照并补采报告时的实际 API；预期仍由后台现有 resolver 解析、留在扩展内部。ISOLATED 有效 origin 仅用于诊断 fallback 来源，不扩大生产注入授权；不明来源为 UNKNOWN。该入口不启动完整诊断的位置、header、worker、ICE/STUN 或外部 provider 请求。

自动验收只在临时 Chrome profile 中使用合成语言/时区和固定 localhost fixture 路径，通过本机 CDP 读取扩展报告。可选 JSON 输出含浏览器版本、实际语言/时区、固定日期偏移、采样毫秒及阶段判定；不含 IP、坐标、真实文件路径、凭据、完整配置或 run/document ID。JSON 是用户选择的本地交付文件，需自行管理；临时 profile/server 退出时清理。

## 出口推荐与固定字体候选

VG-026 不增加provider端点或自动请求。countryCode只从既有主动检测的同次响应明确字段读取并在确认事务保存；未知不反推。地区locale/时区置信度/字体/WebRTC建议本地计算，不向网页或第三方发送档案、候选、代码或推荐结果。点击明确应用复用既有后台队列和verified边界；普通网页不能调用管理动作。

VG-025 隔离字体脚本只含固定内置名单（16项厂商/软件及2026-10-22授权新增的27项简繁中文字体），无公网IP、位置、规则或档案payload、storage或页面配置桥；2026-10-20用户已授权固定内置名单生产注册；custom及Worker继续暂停；位置恢复见VG-029。真实Chrome资格runner仅访问loopback，合成目标字体别名通过本机字体加载，无字体下载；完整像素/图像和原生设备值只在进程内对照，正式JSON仅保存布尔、版本与固定源码SHA256。Chrome自身后台网络未做全量监控。VG-027未向页面交付位置，未来坐标快照属于额外明确数据披露，不能由字体结果推定安全。


VG-025（2026-10-20）已获用户授权恢复固定内置名单字体过滤；仅启用的HTTP(S) allowlist生效，custom和Worker继续暂停；位置恢复见VG-029。注册成功只代表匹配新文档就绪，旧hook/BFCache须完整重建；恢复授权不等于人工验收通过。详见 [配置指南](CONFIG_GUIDE.md)。


## VG-029 坐标数据流

位置的独立注册payload仅包含latitude、longitude、accuracy、randomize、randomRadiusMeters、spoofPermission，不含公网IP、provider、国家、规则/档案ID或完整配置。值由后台共享resolver从手工设置或显式绑定的verified档案派生，以固定自包含模板和安全JSON提前注册；不使用页面桥、DOM/storage读取或远程脚本。匹配且允许定位的网页可经定位API读取所配置的合成坐标；这属于用户启用站点后的数据交付，坐标不能像语言/时区一样视为非敏感字段。权限伪装不授予真实传感器权限，不执行浏览器真实定位；关闭伪装时保留原生权限查询，未授权不提供成功结果。

注册撤销只影响未来文档；旧文档/BFCache仍持有旧快照，必须重载或关闭，网页已读取的数据无法撤回。诊断仍需用户明确发起，结果仅扩展内短期比较。VG-029浏览器资格测试使用临时profile、合成坐标与loopback目标，证据只保存布尔/分类/版本及构建摘要，不保存真实位置、个人路径或真实出口IP；具体实际覆盖及未验证项见任务证据。
