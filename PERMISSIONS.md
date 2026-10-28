# VanishGeo 权限说明

权限以当前 [manifest.json](manifest.json) 为准。扩展使用 Manifest V3，最低 Chrome 138；没有静态 `content_scripts`，`web_accessible_resources` 为空。外部请求和数据生命周期见 [隐私说明](PRIVACY.md)。

没有声明 `externally_connectable`，没有 `management` 权限；不向页面插入扩展 URL、产品全局标记、DOM 属性或自定义事件，不建立网页配置桥。站点兼容性预设只裁剪已有权限下的效果，不改变授权范围。native 不派发页面、请求头、定位或字体修改；WebRTC 仍为浏览器全局策略。审计及可观察差异见 [可观察面审计](docs/development/observability-audit.md)。

## 已申请权限

| 权限 | 用途与边界 |
| --- | --- |
| `storage` | 保存本地配置、出口档案、位置历史、环境方案及维护标记；会话存储暂存待确认出口和同步恢复状态。诊断运行不持久化到 local／session。 |
| `scripting` | 按启用站点规则注册包内固定字体过滤脚本，执行用户主动发起的定向诊断采样，并清理旧初始化注册。生产语言／时区和定位不通过 executeScript 或 documentId 回退派发。 |
| `tabs` | 读取当前及相关标签页 URL、选择诊断目标、打开目标／报告，记录需要用户重载的页面。不会自动调用 tabs.reload，也没有标签页历史上传流程。 |
| `contextMenus` | 提供站点规则启停、诊断入口和 WebRTC 策略重置菜单。 |
| `privacy` | 设置、清除并读取浏览器全局 `webRTCIPHandlingPolicy` 及实际控制权，作用范围不限于站点规则。 |
| `userScripts` | 在新文档MAIN/document_start注册语言/时区、独立定位及参数化三层/自定义字体模板；需要正常开启Allow User Scripts。 |
| `alarms` | 仅自有5分钟自动出口检测闹钟；启用且存在auto规则时创建，关闭时撤销，worker启动读回恢复。浏览器可能延迟事件，不承诺精确定时。 |
| `contentSettings` | 按有效定位规则设置本扩展的Chrome真实站点定位allow/block，并用ask遮盖父域下的禁用或原生子规则。关闭定位权限选项时，原生定位可能请求真实传感器。用户于2026-10-28明确授权此行为；JS坐标替换不是Chrome权限隔离。 |
| `declarativeNetRequestWithHostAccess` | 在已有 host 授权范围内同步站点 Accept-Language，执行请求头规则隔离、迁移和读回核验；不读取请求正文。 |

旧固定字体文件独立于Allow User Scripts；三层及自定义字体模板需要该开关；语言／时区和定位各有独立注册状态，不能由其中一项成功推定其他项已生效。

## 为什么使用广泛站点权限

`host_permissions` 为 `<all_urls>`，用于允许用户运行时选择站点、注册规则范围内的脚本、定向诊断、按规则处理语言请求头，以及主动访问出口定位服务。

这是广泛的浏览器访问能力授权，不等同于逐站点最小权限。当前实现通过已启用站点规则、最长域名优先、最小 payload 和可信扩展来源检查约束使用方式；没有将其改为逐站点可选授权。

普通网页不能提交可信配置或调用扩展管理动作；报告资源不作为 web accessible resource 暴露。配置由固定模板和安全 JSON 组合，不接受用户 JavaScript、远程脚本或运行期编译。

## 页面、定位与 Worker 范围

- 页面功能仅支持普通 HTTP(S) 顶层文档和 iframe，子帧按自身 URL 匹配。`about:blank`、`srcdoc`、`data:`、`blob:` 文档、opaque origin 及特殊 sandbox 场景不支持。
- 语言／时区和定位需要可用的用户脚本权限及 Allow User Scripts；API、权限或注册不可用时不回退到页面消息、配置桥或 documentId 注入。
- 定位按规则修改真实Chrome站点授权；权限选项关闭时委托原生传感器后替换成功坐标。未接管realm/缓存原生方法可使用真实授权，不能保证真实位置永不被读取。安全上下文、原生 API 和 Permissions Policy 约束仍然生效；合成权限选项的含义见配置指南。
- 匹配文档及已接管Worker链可向未来同源HTTP(S) classic/module Dedicated/SharedWorker及自身Blob传递语言／时区与字体快照；外来Blob、TrustedScriptURL、含extendedLifetime的SharedWorker和未接管父级后代未覆盖。SharedWorker同页同配置代缓存入口，跨页可能分离为独立后台实例。
- Blob入口仍受创建页面的CSP、Trusted Types和依赖MIME检查；不新增host范围。原HTTP入口响应CSP不作为Blob Worker自身策略，例如其connect-src限制可能不再生效；该变化单独列入C7确认，不能宣称策略原生等价。字体只在已启用的HTTP(S) full规则下注册；支持三层及自定义，已同步Blob链继承同一展开名单。queryLocalFonts保留浏览器本地字体授权，只过滤返回结果，不主动调用、不上传枚举数据；fonts.check原生。

首屏仍由userScripts同步派发。已初始化文档通过ISOLATED只读桥更新／关闭，BFCache返回重新读取；新域及旧版本文档仍需重建，不自动reload。桥只按Chrome sender读取该frame最小已确认快照，页面请求不触发配置／权限／DNR对账；nonce仅路由，不是网页身份认证。未知快照报错而非清除，消息回执不能证明实际生效，重载欠账保守保留。已有Worker、旧formatter、已交付Position保留各自快照；网页已读取数据无法撤回。Position只读适配器保留到realm销毁，以维持历史对象寿命。

## 语言请求头规则的控制边界

当前只申请 `declarativeNetRequestWithHostAccess`，没有申请普通 `declarativeNetRequest`、Feedback 或 webRequest 权限。仅改写 Accept-Language，导航按目标域、子资源按发起域匹配，其他头保持原生，请求不经转发服务器。

升级或配置变化时，后台先隔离并核验所属规则，再安装新投影；未知占用或范围外语言头冲突会保留并报告，不默认为已清理。规则可跨浏览器会话保存，稳定冷启动沿用上次确认的结果。实现范围和历史迁移编号见 [开发记录](docs/development/project-history.md#请求头隔离与迁移实现摘录)。

Allow User Scripts 与 DNR 属于不同 API。直接关闭 Chrome 用户脚本开关后，后台核验前可能继续发送旧语言头；核验后撤销所属语言头、保持隔离并报告失败。页面注册与头规则更新不承诺原子同步，失败也不代表其他独立组件全部停止。

可靠关闭方法：先关闭并保存插件总开关，等待同步成功，完整刷新或关闭重开目标页面，之后才按需关闭 Chrome 用户脚本开关。

## 未申请的权限与未接管的能力

当前未申请 `activeTab`、`geolocation`、`debugger`、`webRequest` 等额外权限。有效auto规则会后台每5分钟检测出口，复用现有provider请求；不上传字体、规则、浏览历史或Chrome传感器坐标，provider可观察请求出口地址。

WebGL／GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等未接管设备 API 保持原生。字体过滤、WebRTC 策略或诊断结果不能被解读为所有设备指纹已隐藏或所有网络路径均无泄漏。

功能配置见 [配置指南](CONFIG_GUIDE.md)，安装与故障处理见 [安装指南](INSTALL.md)。内部研发和历史验收内容保留在 [开发记录](docs/development/project-history.md)。

Persona为独立固定语言／时区包：没有普通包后台、popup/options管理入口、DNR或API权限，仅对指定域静态派发，无实时更新、自动出口或在线关闭恢复。完整定位／字体persona不在本次该包验收范围。
