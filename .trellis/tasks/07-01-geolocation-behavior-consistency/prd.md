# geolocation 行为一致性补强

## Goal

把 geolocation 从“只像返回值”补到“关键行为也像”：至少覆盖成功回调、`watchPosition`、`clearWatch`、错误分支和可观察权限/拒绝边界中的最小必要集合。

## Confirmed Facts

- 当前 geolocation patch 只代理 `getCurrentPosition` 成功分支和 `watchPosition`，没有 `clearWatch`。证据：`spoof/apply.js:32-51`。
- 当前诊断页只显示 geolocation API 是否存在，不主动调用，以避免权限弹窗。证据：`pages/test-page.js:142`、`test.html:161`、`test.html:241-242`。
- inventory 已将 geolocation 权限状态面单独归为可后置候选，不要求这项任务一开始就完整覆盖 `permissions.query`。证据：父任务 `prd.md` 中 First Inventory。
- 当前仓库没有 repo-local geolocation fixture 或专门的行为 smoke 页。
- 当前实现里 `watchPosition()` 只是立即复用一次 `getCurrentPosition()`，并返回随机整数；`clearWatch()` 未实现，错误分支、拒绝分支、超时分支也未建模。
- 你已确认第一轮采用“最小 repo-local geolocation fixture，只覆盖成功回调、`watchPosition` / `clearWatch`、错误分支基础形态”的路线，并把 `permissions.query({ name: "geolocation" })` 明确保留给后续候选。
- 2026-07-02 的本地 geolocation fixture 重跑已确认：
  - geolocation controller 已在 allowlisted `localhost` fixture 页面正确挂载
  - success / watch / clearWatch / forced error 四类最小行为都可稳定触发
  - `watchId` 已从随机值收敛为可追踪递增值
  证据：`research/2026-07-02-local-geolocation-fixture-smoke.md`。
- 2026-07-02 的真实站点补证已确认 `browserleaks.com/geo` 可以观察到 spoof-controlled geolocation 结果，并显示 `watchPosition` 处于 active 状态。证据：`research/2026-07-02-local-geolocation-fixture-smoke.md`。

## Requirements

- 先聚焦站点最容易直接观察到的行为差异：成功回调、`watchPosition` / `clearWatch`、错误回调基本形态。
- 必须明确哪些权限相关差异属于当前任务，哪些保留给后续候选。
- 任务结果应优先建立最小行为模型，不追求一次性复制原生 geolocation 的全部边角行为。
- 若需要主动触发 geolocation 调用，必须设计不会误伤日常浏览的最小验证方式。

## Acceptance Criteria

- [x] 已补齐或明确建模 `clearWatch` 与最小必要的错误/拒绝分支。
- [x] 至少有一种验证方式能主动调用 geolocation 并观察返回行为，而不只看 API 存在性。
- [x] 若权限状态仍未覆盖，任务结果中明确把它保留给后续候选而不是隐含遗漏。

## First-Round Conclusion

在当前任务范围内，第一轮结论已经收敛为：

- allowlisted 本地 fixture 页面上，扩展控制的 geolocation controller 已能稳定挂载
- `getCurrentPosition` 成功分支、`watchPosition`、`clearWatch`、forced error 四类最小行为都可稳定触发
- `watchId` 已从随机值收敛为可追踪递增值
- 真实站点 `browserleaks.com/geo` 已能作为最小补证，证明 spoof-controlled geolocation 在外部页面上可被观察到
- `permissions.query({ name: "geolocation" })` 与更完整权限态仍保留为后续候选，不在第一轮继续扩大

## Out Of Scope

- 完整复制浏览器原生 geolocation 的所有时序细节。
- WebRTC、iframe、worker 一致性。

## Open Questions

- 当前无阻塞性开放问题；第一轮已按“repo-local geolocation fixture 先补行为模型，再把权限状态留作后续候选”的路线完成收口。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
