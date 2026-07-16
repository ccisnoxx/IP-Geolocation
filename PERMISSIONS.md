# VanishGeo 权限边界

本文记录当前 Manifest V3 权限边界，是 BrowserInsight 反检测工作后的工程约束。

## 必需权限

| 权限 | 所有者 | 用途 |
|---|---|---|
| `storage` | background、options、popup | 保存 `siteSpoofConfig`、出口位置档案、迁移标记和短期检测确认数据。 |
| `scripting` | background | 为规则域名注册 ISOLATED content script，并把自包含 runtime 定向执行到对应 MAIN-world 文档。 |
| `tabs` | background、popup、context menu | 读取当前/全部标签页 URL、打开诊断页，并在有效 runtime payload 变化后刷新受影响标签页。 |
| `contextMenus` | background | 提供启停规则、打开诊断页和重置 WebRTC 策略的操作菜单。 |
| `privacy` | background | 设置并读取 `chrome.privacy.network.webRTCIPHandlingPolicy`。 |
| `declarativeNetRequest` | background | 更新动态规则，使请求 `Accept-Language` 与有效语言配置一致。 |
| `declarativeNetRequestWithHostAccess` | background | 允许 DNR 在 `host_permissions` 覆盖的站点修改请求头。 |

`alarms` 已移除：出口位置只允许用户主动检测或重新检测，不再后台定时刷新。

## Host 权限边界

`host_permissions` 仍为 `"<all_urls>"`，因为用户可以在运行时添加任意规则域名，扩展需要为这些域名注册 content script、执行定向 MAIN-world 注入并应用 DNR 请求头规则。

扩展不会静态注册 `<all_urls>` content script；动态匹配仍只来自 `getContentScriptMatches()` 返回的已启用规则。

把 `"<all_urls>"` 改成按站点申请的 optional host permissions 暂不处理。该变化需要独立设计权限请求、拒绝状态、权限变化后的重新注册和 DNR 修复。

## 已移除或避免的权限

`activeTab` 不申请。当前 `tabs` 已用于标签页 payload 对比与刷新、诊断页创建和当前站点状态，再加 `activeTab` 不能减少权限边界。

默认伪装不得为了 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、font 或 WebGPU 等无关设备指纹面新增权限；只有目标检测证据和独立规划才能改变这一边界。
