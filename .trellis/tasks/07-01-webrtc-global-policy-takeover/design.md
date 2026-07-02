# WebRTC 全局策略接管设计

## Summary

第一轮不处理外部扩展迁移 UX，而是先把本项目内的 WebRTC 策略控制做成语义清晰、可验证、可单独使用的能力。技术路线分两层：

1. 把当前 `strict / compatible / off` 模式重命名并与底层 `webRTCIPHandlingPolicy` 一一对齐
2. 增加最小可重复的 leak 验证路径，证明“策略已设置”与“页面实际不泄漏”

目标是回答：

- 本项目当前 UI 模式到底对应哪个底层策略值
- 如何避免把“恢复默认”误解成“禁用 WebRTC”
- 在当前浏览器环境里，最小 leak 验证路径是什么
- 外部扩展并存时，本项目该如何描述边界

而不是第一轮就做自动探测、自动冲突处理或迁移向导。

## Why This Shape

- 当前底层能力已经存在：`chrome.privacy.network.webRTCIPHandlingPolicy`
- 当前主要问题不是“能不能设”，而是：
  - 命名误导
  - 结果缺少验证闭环
  - 外部扩展与本项目职责边界不清
- 外部扩展迁移 UX 会额外引入：
  - 扩展共存探测
  - 用户教育
  - 状态提示与冲突说明
  - 甚至可能需要更多浏览器页交互
  这些都不属于第一轮最小闭环

## Target Mode Model

第一轮目标模式语义：

- `strict`
  - value: `disable_non_proxied_udp`
  - 含义：最保守的代理 / 泄漏控制策略

- `compatible`
  - value: `default_public_interface_only`
  - 含义：兼顾部分 WebRTC 功能和基础泄漏控制

- `default`
  - value: `clear()` / browser default
  - 含义：恢复浏览器默认策略

明确不做：

- `disabled`
  - 第一轮不引入真正“禁用 WebRTC API”的模式

## Migration From Current Model

当前代码里 `off` 实际表示“清掉策略并恢复默认”。

第一轮设计建议：

- 存储层继续兼容读老值 `off`
- UI 层和新文案统一显示为 `default`
- internal normalize 层把 `off` 视为 `default` 的 legacy alias

这样可以：

- 不破坏已有存储
- 让用户看到的产品语义更准确

## Verification Strategy

第一轮验证闭环分成两步：

### Step 1: 策略值验证

通过现有 runtime message / state 读取，确认：

- 当前模式
- 对应的底层 `effectivePolicy`

这一步回答“浏览器策略已设置为什么”。

### Step 2: 页面 leak 行为验证

优先复用已存在的白名单检测站：

- `browserleaks.com/webrtc`
- `diafygi.github.io/webrtc-ips`

第一轮要求最小化：

- 至少支持一个稳定样本页做 real smoke
- 能记录“在 strict / compatible / default 下页面看到的结果”

## Diagnostic / Research Shape

第一轮不一定要把完整 WebRTC leak 测试嵌进 diagnostic 页面 UI。

更轻量的选择是：

- 先把研究记录与最小 smoke 路径固定下来
- 若需要 UI，仅补一个模式与 `effectivePolicy` 展示字段

这样能避免把任务膨胀成“站点自动解析器”。

## External Extension Boundary

第一轮只做文档化边界，不做自动探测：

- 本项目现在可以独立控制 WebRTC 全局策略
- 如果用户仍同时启用外部扩展，则谁最后写入同一 `webRTCIPHandlingPolicy`，页面就看到谁的结果
- 本项目不保证与外部扩展并存时的最终赢家

应在任务结论或说明里明确这一点。

## Likely Code Changes

- `shared/config-base.js`
  - 模式 normalize / default 值兼容
- `background/services.js`
  - `WEBRTC_POLICY_VALUES`
  - 可能改 key 名或兼容 alias
- `background/message-router.js`
  - `getWebRtcConfig` / `setWebRtcGlobalMode` 返回语义
- `pages/popup-page.js`
  - 模式按钮与文案
- `pages/options-page.js`
  - 模式选项文案
- 相关测试

## Boundaries

- 第一轮不做外部扩展自动探测
- 第一轮不做外部扩展自动禁用
- 第一轮不做按站点单独 WebRTC 控制
- 第一轮不做页面级 API 禁用

## Risks And Tradeoffs

### Tradeoff: no automatic coexistence handling

- 用户同时开着外部扩展时，结果可能受最后写入方影响
- 第一轮接受这个边界，并通过说明文档处理

### Tradeoff: strategy verification != full leak parser

- `effectivePolicy` 正确不等于页面必然完全无泄漏
- 所以仍需要至少一个真实站点 smoke

### Tradeoff: keep `default` but not `disabled`

- 这能先把现有能力说清
- 但不能满足“真正禁用 WebRTC”这一未来需求

## Rollout Shape

1. 对齐模式语义与 legacy alias
2. 更新 popup/options 文案
3. 补配置与 runtime 返回测试
4. 做最小真实 leak smoke
5. 在任务文档中明确外部扩展并存边界
