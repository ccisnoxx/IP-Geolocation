# VanishGeo 权限说明

权限以当前 [manifest.json](manifest.json) 为准。扩展使用 Manifest V3，最低 Chrome 138；没有静态 `content_scripts`，`web_accessible_resources` 为空。外部请求和数据生命周期见 [隐私说明](PRIVACY.md)。

## 已申请权限

| 权限 | 用途与边界 |
| --- | --- |
| `storage` | 保存本地配置、出口档案、位置历史、环境方案及维护标记；会话存储暂存待确认出口和同步恢复状态。诊断运行不持久化到 local／session。 |
| `scripting` | 按启用站点规则注册包内固定字体过滤脚本，执行用户主动发起的定向诊断采样，并清理旧初始化注册。生产语言／时区和定位不通过 executeScript 或 documentId 回退派发。 |
| `tabs` | 读取当前及相关标签页 URL、选择诊断目标、打开目标／报告，记录需要用户重载的页面。不会自动调用 tabs.reload，也没有标签页历史上传流程。 |
| `contextMenus` | 提供站点规则启停、诊断入口和 WebRTC 策略重置菜单。 |
| `privacy` | 设置、清除并读取浏览器全局 `webRTCIPHandlingPolicy` 及实际控制权，作用范围不限于站点规则。 |
| `userScripts` | 在新文档的 MAIN／document_start 注册固定语言／时区及独立定位模板；需要用户正常开启 Allow User Scripts。 |
| `declarativeNetRequestWithHostAccess` | 在已有 host 授权范围内同步站点 Accept-Language，执行请求头规则隔离、迁移和读回核验；不读取请求正文。 |

固定字体注册独立于 Allow User Scripts；语言／时区和定位各有独立注册状态，不能由其中一项成功推定其他项已生效。

## 为什么使用广泛站点权限

`host_permissions` 为 `<all_urls>`，用于允许用户运行时选择站点、注册规则范围内的脚本、定向诊断、按规则处理语言请求头，以及主动访问出口定位服务。

这是广泛的浏览器访问能力授权，不等同于逐站点最小权限。当前实现通过已启用站点规则、最长域名优先、最小 payload 和可信扩展来源检查约束使用方式；没有将其改为逐站点可选授权。

普通网页不能提交可信配置或调用扩展管理动作；报告资源不作为 web accessible resource 暴露。配置由固定模板和安全 JSON 组合，不接受用户 JavaScript、远程脚本或运行期编译。

## 页面、定位与 Worker 范围

- 页面功能仅支持普通 HTTP(S) 顶层文档和 iframe，子帧按自身 URL 匹配。`about:blank`、`srcdoc`、`data:`、`blob:` 文档、opaque origin 及特殊 sandbox 场景不支持。
- 语言／时区和定位需要可用的用户脚本权限及 Allow User Scripts；API、权限或注册不可用时不回退到页面消息、配置桥或 documentId 注入。
- 合成定位复用既有权限，仅返回配置坐标，不读取真实传感器、不修改 Chrome 站点授权。安全上下文、原生 API 和 Permissions Policy 约束仍然生效；合成权限选项的含义见配置指南。
- 页面及已同步 Blob 链内各 realm 自身新建的 Blob Dedicated Worker 可继承语言／时区；HTTP(S) Dedicated Worker、SharedWorker、外来 Blob 和未接管父级的后代未覆盖。
- Blob 包装仍受 CSP、Trusted Types 和 MIME 检查约束；不新增权限或 host 范围，不绕过页面策略。固定字体仅在已启用的 HTTP(S) 规则和内置模式下注册，自定义名单及 Worker 字体未覆盖。

配置按文档快照生效。撤销注册只影响未来文档，已有页面、Worker 和 BFCache 需由用户完整重建；网页已读取的数据无法撤回。

## 语言请求头规则的控制边界

当前只申请 `declarativeNetRequestWithHostAccess`，没有申请普通 `declarativeNetRequest`、Feedback 或 webRequest 权限。仅改写 Accept-Language，导航按目标域、子资源按发起域匹配，其他头保持原生，请求不经转发服务器。

升级或配置变化时，后台先隔离并核验所属规则，再安装新投影；未知占用或范围外语言头冲突会保留并报告，不默认为已清理。规则可跨浏览器会话保存，稳定冷启动沿用上次确认的结果。实现范围和历史迁移编号见 [开发记录](docs/development/project-history.md#请求头隔离与迁移实现摘录)。

Allow User Scripts 与 DNR 属于不同 API。直接关闭 Chrome 用户脚本开关后，后台核验前可能继续发送旧语言头；核验后撤销所属语言头、保持隔离并报告失败。页面注册与头规则更新不承诺原子同步，失败也不代表其他独立组件全部停止。

可靠关闭方法：先关闭并保存插件总开关，等待同步成功，完整刷新或关闭重开目标页面，之后才按需关闭 Chrome 用户脚本开关。

## 未申请的权限与未接管的能力

当前未申请 `alarms`、`activeTab`、`geolocation`、`debugger`、`webRequest` 等额外权限。出口检测只由用户主动触发，没有后台定时刷新。

WebGL／GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等未接管设备 API 保持原生。字体过滤、WebRTC 策略或诊断结果不能被解读为所有设备指纹已隐藏或所有网络路径均无泄漏。

功能配置见 [配置指南](CONFIG_GUIDE.md)，安装与故障处理见 [安装指南](INSTALL.md)。内部研发和历史验收内容保留在 [开发记录](docs/development/project-history.md)。
