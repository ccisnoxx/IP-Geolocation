# iframe / subframe 一致性补强

## Goal

确认并补强 allowlist 页面在 `iframe / subframe` 上下文中的 `language`、`timezone`、`Intl`、`Date` 相关一致性，至少把当前真实覆盖边界说清，并对可覆盖范围建立验证闭环。

## Confirmed Facts

- 当前内容脚本以 `allFrames: true` 注入到 `MAIN` world。证据：`background/services.js:128-145`。
- 当前匹配模型只为启用规则域名生成 `matches`，即 frame 自身 URL 也要命中规则才会注册。证据：`shared/config-profile.js:100-127`。
- 当前 live probe 只读取顶层页，不读取 frame。证据：`shared/diagnostic.js:247-253`。
- 当前仓库没有发现 `matchAboutBlank` / `match_about_blank`、`srcdoc` 或其他专门针对空白继承 frame 的注入配置。
- 当前仓库也没有现成的 iframe / subframe 专用测试页、fixture 或 diagnostic 数据模型；这一层验证链路需要本任务补齐。
- 你已确认第一轮把 iframe / subframe 问题视为“边界要明确、验证要补齐，但不承诺强行覆盖”。这意味着当前任务优先回答“哪些 frame 当前天然可覆盖，哪些不可覆盖”，而不是先改写注入模型。
- 你已确认第一轮验证方案采用“最小 repo-local iframe fixture + 现有 diagnostic 页做真实站点抽查”的组合，不只依赖真实站点结构。
- 本地宿主方案已经验证可行：`localhost`、`app.localhost`、`child.localhost`、`nonmatch.localhost` 在当前机器上都解析到 `127.0.0.1`，适合由同一个本地静态服务承载不同 host 场景。
- 2026-07-02 的本地 fixture smoke 已确认：
  - `nonmatch.localhost` child 保持原生值，符合“未命中白名单即不覆盖”的预期边界
  - `child.localhost` child 已能观察到 spoofed 值
  - `localhost` 顶层、same-origin child、`srcdoc`、`about:blank` 在当前 live JS 中已是 spoofed，但 fixture 页自身较早执行的脚本仍可能渲染出原生值
  证据：`research/2026-07-02-local-fixture-smoke.md`。

## Requirements

- 任务必须先区分“浏览器权限/匹配模型天然能覆盖的 subframe”与“当前模型不会覆盖的跨域 frame”，不能把两者混成一个 bug。
- 在可覆盖范围内，至少验证 `navigator.language`、`navigator.languages`、`Intl.DateTimeFormat().resolvedOptions().timeZone`、`Date#getTimezoneOffset()` 的一致性。
- 诊断链路应优先复用现有 diagnostic page，而不是引入完全新的调试入口。
- 若发现 `about:blank`、`srcdoc` 或嵌套 frame 是主风险，应在结果中单列边界。

## Acceptance Criteria

- [x] 已明确当前 iframe / subframe 的真实覆盖边界。
- [x] 已有至少一种 frame live 验证方式，能对比顶层页与子 frame 的关键读数。
- [x] 若发现缺口，结果中明确是“匹配模型限制”、“注入时机问题”还是“主 world patch 未传播”。

## Out Of Scope

- 任意跨域 iframe 的强行覆盖承诺。
- worker / service worker 一致性。

## First-Round Conclusion

第一轮结论已经收敛：

- `nonmatch.localhost` child 保持原生值，属于“匹配模型限制”边界，不视为 bug。
- `child.localhost` child 已能观察到 spoofed 值，说明“child 自身命中白名单”路径可工作。
- `localhost` 顶层、same-origin child、`srcdoc`、`about:blank` 在当前 live JS 中最终会呈现 spoofed 值，但页面自身较早执行的脚本仍可能先渲染原生值。

因此，第一轮把 iframe / subframe 问题正式收口为：

- 运行时最终值层面，部分 frame 已可 spoof
- 页面早期脚本可见性层面，仍存在注入时序边界

这一时序差异在本轮被记录为**当前边界**，不在第一轮继续扩成新的注入模型改造。

## Open Questions

- 当前无阻塞性开放问题；若未来继续推进，应把重点转到“页面早期脚本时序”是否值得进入下一轮任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
