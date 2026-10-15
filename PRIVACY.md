# VanishGeo 隐私边界

> **VG-011 安全暂停（2026-10-15 用户确认人工验收通过）**：Chrome 155 已证实旧 `documentId` 可错投替换文档。当前后台在读取 payload 和派发前拒绝所有页面伪装初始化，并撤销动态初始化脚本。语言、时区、位置、Canvas 及 Worker/SharedWorker 伪装暂停；配置仍可保存。DNR 请求头规则、WebRTC 继续各自执行并按实际同步结果报告；二者不补偿页面 API 伪装。重试同步、保存或后台重启不会恢复页面伪装。新闸门不撤销旧 hook，已加载页面及旧 BFCache 文档需关闭并重建；无法确认清理时需自行重启浏览器。恢复完整功能前须验证可靠最终文档绑定或浏览器上游修复。详情见 [调查与实施证据](docs/stabilization/document-id-investigation.md)。

本说明描述当前维护源的数据流与存储；权限清单见 [PERMISSIONS](PERMISSIONS.md)。VanishGeo 不提供 VPN/代理，不改变正常请求的网络出口，也不承诺匿名或让网页无法观测浏览器。没有后台定时出口刷新，也没有配置同步到开发者服务器的流程。

## 用户主动出口检测

只有在 Options 点击引导的“检测并确认出口”、“检测新出口”或“重新检测”时，后台依次尝试 `https://ipwho.is/`、`https://ipapi.co/json/`、`https://ipinfo.io/json`。第一个可解析的完整响应结束本次检测；每次请求有 3500ms 超时。不会把不同响应拼成出口身份，也不会由安装、启动、打开 Popup 或 auto 信号自动发起这些请求。确认/绑定已存在档案不再次联网。

这些请求由扩展后台发出，provider 可以看到网络出口 IP 和正常请求信息；返回 IP、坐标、国家、时区和 provider 身份。请求不主动附加站点规则、用户配置、位置历史或诊断预期值。provider 的保留政策不由扩展控制，源码使用普通 fetch，没有增加匿名传输层或显式的 credentials/referrer 设置。实际请求及响应验证见 [services.ts](src/background/services.ts)。

auto 使用每条规则显式绑定的 verified 档案。verified 只由后台检测后的确认事务建立，不证明当前网络仍使用该出口；网络改变后需要主动重新检测。导入不能建立 verified 身份。

## 保存的数据与生命周期

| 位置 | 当前数据 | 保留与清理 |
|---|---|---|
| `chrome.storage.local` 的 `siteSpoofConfig` | schema v2 总开关/debug、全局 Intl strict/compatible 模式、规则域名与绑定/覆盖、语言、时区、手工坐标与精度/随机设置、用户保存的坐标历史、自定义环境方案、Canvas 字体列表；已确认出口档案含名称、公网 IP、坐标、国家、时区、provider 与检测时间 | 跨浏览器重启保留；由用户编辑/删除或重置配置。删除档案前必须解除规则引用；卸载会清除扩展本地存储。没有扩展实现的加密层 |
| local 的 `vanishgeoRulesInitialized` | 规则初始化/迁移标记 | 用于一次配置迁移；旧配置键按 storage 维护源清理 |
| `chrome.storage.session` 的 `pendingExitLocationDetection` | 一份待确认 candidate（IP/坐标/国家/时区/provider/时间）、检测 ID、重检目标与旧验证时间、过期时间 | 五分钟后拒绝确认；成功确认/取消/访问已过期候选时删除，新检测覆盖旧候选。没有定时物理删除器；service worker 暂停不等同于 session 清空 |
| `chrome.storage.session` 的 `runtimeSyncMetadata` | 版本、配置 SHA-256 摘要、脚本/DNR/WebRTC/刷新状态与固定错误类别、待刷新 tab ID 和 URL 摘要；预写时保留旧配置摘要的刷新欠账；已确认检测的待清理 ID | 用于 service worker 暂停后的恢复，收敛后清空欠账。没有配置副本、原始 URL、IP、坐标或原始 API 错误；不进入配置导出。浏览器重启、扩展重载/更新/禁用时 session 清空，避免旧 tab ID 跨会话重用；摘要不承诺匿名化 |
| 后台诊断内存 | 最小预期信号、run ID、报告/目标文档身份、状态、两分钟 TTL | 消费一次；完成、取消、过期、执行中导航/关闭/配置变更或后台重启失效并释放敏感状态。少量有上限的短期终态只保留原因/所有者 |
| 扩展报告页面内存与 DOM | 当次预期、实际值、PASS/FAIL/UNKNOWN；不保留 ICE 地址，只展示分类数量 | TTL、清除或离开报告页释放；无诊断持久化、导出或跨会话恢复 |
| 外部诊断页内存与 DOM | navigator、Intl/Date、位置回调、ICE 候选和设备/realm 的实际观测 | 页面可见；重新加载/关闭释放其内存快照。网页本身仍能读取这些 API |
| 外部诊断 origin 的 localStorage | 用户点击“记录真实设备基线”保存的实际设备观测，以及界面语言偏好 | 基线清除按钮只删除设备基线；清除该站点数据可删除两者。扩展卸载不清除此站点数据 |
| 用户下载的 JSON | 完整配置或单个自定义方案，取自当前表单 | **完整配置导出未脱敏**，可含出口 IP/位置、档案名称、规则和坐标历史；下载文件不会随重置/卸载删除，需用户自行管理 |

扩展未使用 `chrome.storage.sync` 上传配置。Chrome session storage 会在扩展禁用、重新加载、更新或浏览器重启时清空；本地扩展存储卸载时清除，清浏览器历史不能代替清理扩展配置。参见 [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)。

导入会把出口档案降为 unverified，清空其公网 IP/provider/verifiedAt 与规则出口绑定，但仍可能保留坐标、名称和历史等其他配置字段。重置会清空本地配置、规则、环境方案、出口档案与历史，删除 pending session 候选，使重置前在途检测响应失效，并关闭保护、恢复本扩展 WebRTC 默认策略；清理失败会明确报错。重置不删除下载文件或外部记录。跳过引导只关闭保护和恢复本扩展 WebRTC 默认策略，保留已保存内容。迁移/保存的权威源是 [storage.ts](src/shared/storage.ts) 与 [config-model.ts](src/shared/config-model.ts)，不存在第二份配置存储或网页配置桥。

## 站点注入、DNR 与 WebRTC

manifest 的 `<all_urls>` host 权限允许用户在运行时选择任意规则域名，也支持后台主动 provider 请求、定向脚本与请求头处理。这是较宽的能力授权，不能解读为没有广泛访问能力；当前安全暂停只注销旧 ISOLATED 初始化脚本，残留可信初始化通知在配置读取与派发前拒绝；主动诊断仍按原入口采集实际值。普通网页不能传入可信 payload，也不能访问扩展报告 actions。

时区与 Locale 模式保存在同一个 siteSpoofConfig。strict 默认保持强制一致性；compatible 仅对未指定的 locale/timeZone 补配置默认值，页面显式参数与原生错误保留，因此默认/显式结果可能不同。它不改变 navigator/Accept-Language 或 WebRTC 语义，不承诺规避检测。当前两种模式均不绕过生产安全暂停。

诊断在原有实际值采样中额外执行固定 en-US/UTC 的 Intl.DateTimeFormat、NumberFormat 与 Date locale 调用；top/iframe/Worker 分别返回实际默认和显式结果，预期与模式只在扩展内部比较。固定调用不包含用户配置、无新增外部请求，不增加设备表面；旧 fixture 缺显式观测时为 UNKNOWN。定向 Chrome 模式 smoke 只使用本地 fixture、临时 profile 与合成配置，保存的 JSON 只含浏览器版本、模式及布尔/场景结论，不含个人路径、IP、坐标、凭据或文档身份。正式 dist 中的配置/UI smoke 不恢复 MAIN 派发。

安全暂停不新建 MAIN hook；旧版本已接管 API 的返回值仍可能对网页可见，直到相应文档被重建。top frame、iframe 及 Worker/SharedWorker 伪装均由暂停入口阻断；service worker hook 不在支持范围。未接管的设备 API 保持原生透传。

DNR 从同一配置解析有效语言，仅修改匹配请求的 Accept-Language；请求仍直接到目标站点，不经过扩展提供的转发服务器。目标、网络出口服务和服务器日志仍可看到正常 IP/请求头。WebRTC 使用浏览器全局 `chrome.privacy.network.webRTCIPHandlingPolicy`，strict/compatible/default 的操作见 [CONFIG_GUIDE](CONFIG_GUIDE.md)；它不限于 allowlist 站点。设置可能受其他扩展或浏览器策略控制，期望值、实际控制权与 ICE 网络结果分开报告。运行时对账只调用现有 Chrome 脚本/DNR/privacy/tabs API，不主动检测出口或 ICE；刷新已有网页会产生网页自身的正常网络请求，仍受该页面/目标服务的数据边界约束。

## 诊断目标页与扩展侧比较

打开“隐私检测”先进入扩展 `diagnostic/report.html`，此动作不解析或传出预期配置。报告页按钮打开固定 hosted HTTPS 目标或用户选端口的 localhost；URL 只带固定 UI 语言 `ui=zh`。后台仅在用户选择目标并运行后解析有效配置，绑定报告 tab/document 和目标 top documentId。报告资源不设为 web accessible，预期配置与比较函数留在扩展后台/报告页。

采集通过 Chrome scripting API 在目标 MAIN world 执行自包含函数，不传预期参数；ISOLATED 提供文档身份和同文档设备参考。每个子帧重新检查规则和文档身份；来源不能确定或无法观测时 UNKNOWN。报告只证明当次可观测行，不是完整浏览器审计；MAIN 观测仍可受目标页面干预。执行中取消/过期可以拒绝报告交付，但已经派发的采样依靠有界超时清理，不能承诺瞬间终止所有请求。

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
