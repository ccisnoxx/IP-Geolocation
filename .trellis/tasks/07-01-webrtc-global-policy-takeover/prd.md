# WebRTC 全局策略接管

## Goal

把当前依赖外部扩展的 WebRTC 防泄漏能力迁移为本项目内建的浏览器全局策略控制，并补齐模式语义、迁移边界和 leak 验证闭环。

## Confirmed Facts

- 当前仓库已能通过 `chrome.privacy.network.webRTCIPHandlingPolicy` 设置全局模式。证据：`background/services.js:195-223`、`background/message-router.js:21-42`。
- 当前模式语义仍不够清晰：`off` 实际是 `clear()` 回到浏览器默认，而不是禁用。证据：`background/services.js:202-209`。
- 你已确认后续统一采用策略型模型：`strict = disable_non_proxied_udp`、`compatible = default_public_interface_only`、`default = 恢复浏览器默认`；真正的 `disabled` 以后再说。
- 你当前实际使用外部扩展 `WebRTC-Leak-Prevent`，并允许本项目参考其基于 `privacy` API 的实现方式。
- 你已确认第一轮不做外部扩展自动探测、自动禁用或迁移向导；只要求本项目内的模式命名、策略映射和验证闭环先对齐，并把并存边界写清楚。
- 2026-07-02 的最小真实 smoke 已确认：`browserleaks.com/webrtc` 在当前浏览器状态下显示 `WebRTC Leak Test = No Leak`，且 `Local IP / Public IP` 均未暴露。证据：`research/2026-07-02-browserleaks-webrtc-smoke.md`。

## Requirements

- 任务第一优先是“本项目统一接管浏览器全局策略”，不是白名单页内 API 禁用。
- 必须明确模式命名和 UI 语义，避免继续把“恢复默认”误写成“关闭”。
- 必须建立最小可重复的 WebRTC leak 验证路径，并能区分“策略已设置”与“页面实际不泄漏”。
- 迁移方案必须考虑从外部扩展切回本项目时的冲突与使用说明。

## Acceptance Criteria

- [x] 本项目内的 WebRTC 模式语义与底层策略值一一对应且命名清晰。
- [x] 至少有一种 live 验证方式能证明当前模式下页面侧 leak 测试结果。
- [x] 任务结果明确给出与外部扩展并存/迁移时的边界说明。
- [x] 不把页面级 WebRTC API 禁用混进本任务主范围。

## First-Round Conclusion

在当前任务范围内，第一轮结论已经收敛为：

- 本项目内的 WebRTC 策略模型已统一为 `strict / compatible / default`
- 旧存储里的 `off` 已作为 `default` 的 legacy alias 兼容
- UI 文案已不再把“恢复默认”误写成“关闭”
- `browserleaks.com/webrtc` 的最小真实 smoke 已给出 `No Leak` 证据
- 外部扩展并存时，本项目不保证最终赢家；谁最后写入 `webRTCIPHandlingPolicy`，页面就看到谁的结果

因此，这一轮已经完成“统一接管策略语义 + 建立最小 leak 验证闭环 + 写清并存边界”的目标。

## Out Of Scope

- 按站点单独控制 WebRTC。
- 页面内直接阉割 `RTCPeerConnection` 等 API。

## Open Questions

- 当前无阻塞性开放问题；第一轮已按“先对齐策略语义与验证闭环，再把外部扩展迁移 UX 留到后续”路线完成收口。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
