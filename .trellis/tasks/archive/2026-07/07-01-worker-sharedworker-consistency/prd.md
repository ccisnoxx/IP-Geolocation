# Worker / SharedWorker 一致性补强

## Goal

确认并补强 `Worker / SharedWorker` 上下文中的 locale/timezone 派生行为一致性，建立最小可重复的 worker live 验证，并界定 nested worker / service worker 等更深边界。

## Confirmed Facts

- 当前仓库已通过 Blob 包装方式给 `Worker` / `SharedWorker` 注入 `installDateTimeSpoof`。证据：`spoof/worker-hooks.js:3-45`。
- 当前 patch 重点是 locale/timezone 派生行为，不是完整复制 window 侧所有 API。证据：`spoof/date-time.js:144-192`、`spoof/worker-hooks.js:3-16`。
- 当前没有 worker live 诊断输出。证据：`shared/diagnostic.js:162-236`。
- 当前 worker hook 只覆盖页面构造出来的 `Worker` / `SharedWorker`，仓库里没有对 `serviceWorker` 注册或 nested worker 再包装的额外处理。
- 当前仓库也没有 repo-local worker fixture 或专门的 worker smoke 页。
- `buildTimezonePatchSource()` 当前只把 `installDateTimeSpoof` 注入 worker 内容，不会在 worker 内再次安装 `installWorkerHooks`。因此 nested worker 目前从代码结构上就没有自动继承 hook 的依据。证据：`spoof/worker-hooks.js:3-5`、`spoof/worker-hooks.js:11-18`。
- 你已确认第一轮采用“最小 repo-local worker fixture 页，只覆盖 `Worker` / `SharedWorker`，把 `nested worker`、`service worker` 先作为边界观察项”的路线。
- 2026-07-02 的本地 worker fixture smoke 已确认：
  - 顶层页 spoof 正常
  - classic `Worker` 与 `SharedWorker` 的 `Intl` / `Date` 派生行为已 spoof，但 `navigator.language(s)` 仍保持原生值
  - `module Worker` 在第二轮修复后，`Intl` / `Date` 派生行为已恢复为 spoofed
  - `nested worker` 当前仍表现为原生 locale/timezone
  - `service worker` 仍只记录为边界
  证据：`research/2026-07-02-local-worker-fixture-smoke.md`、`research/2026-07-02-module-worker-fix-smoke.md`。

## Requirements

- 任务必须优先证明当前 `Worker` / `SharedWorker` 到底已经覆盖了什么，不先假设它们都不工作。
- 第一阶段聚焦 `Intl.*` 默认 locale、`DateTimeFormat().resolvedOptions().timeZone`、`Date` / offset 相关读数。
- 必须把 `nested worker`、`service worker` 是否纳入当前覆盖范围单独写清。
- 诊断设计应尽量轻量，可内嵌在已有 diagnostic 链路或最小测试页中。

## Acceptance Criteria

- [x] 至少有一种 live 验证方式能读取 worker 内的关键 locale/timezone 结果。
- [x] 已明确 `Worker`、`SharedWorker`、`nested worker`、`service worker` 各自的当前状态和边界。
- [x] 若有修复，修复范围优先限定在 worker hook 与其验证链路，不顺手扩大到无关页面面。

## First-Round Conclusion

在当前任务范围内，第一轮结论已经收敛为：

- classic `Worker`、`module Worker`、`SharedWorker` 的 `Intl` / `Date` 派生行为可 spoof
- worker 上下文中的 `navigator.language(s)` 仍保持原生值
- nested worker 仍是当前边界
- service worker 仍是当前边界

因此，这一轮已经完成“证明现状 + 修复 module Worker 真实缺陷”的目标。若未来继续推进，下一轮重点应转向：

- 是否需要覆盖 worker 内 `navigator.language(s)`
- 是否要让 nested worker 继承 hook
- 是否要把 service worker 纳入明确支持范围

## Out Of Scope

- geolocation / permissions 行为。
- WebRTC 或网络层 worker 能力。

## Open Questions

- 当前无阻塞性开放问题；第一轮已按“repo-local worker fixture 先证明 `Worker/SharedWorker`，再把 nested/service worker 作为边界说明”的路线完成收口。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
