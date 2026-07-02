# Accept-Language 实时校验闭环

## Goal

为 allowlist 站点补齐 `Accept-Language` 的 live 请求侧验证闭环，能证明浏览器实际发出的请求头与解析后的期望值一致，同时保留非白名单对照。

## Confirmed Facts

- 当前仓库已通过 DNR 动态规则按域名改写 `Accept-Language`。证据：`background/services.js:247-280`。
- 当前诊断页只展示解析后的期望 `Accept-Language`，没有 live 请求侧读数。证据：`pages/test-page.js:92-100`、`test.html:197-198`。
- 既有真实 smoke 研究已经在外部站点上手工确认过一次请求头效果，但仓库内还没有自带的验证闭环。证据：`.trellis/tasks/07-01-custom-site-configuration-refactor/research/2026-07-01-real-chrome-smoke.md:26-28`。
- 当前诊断链路的核心形态是：popup 记住目标 tab，diagnostic 页通过 `getDiagnosticState` 读取当前 tab 的解析结果和 main-world live probe。证据：`background/services.js:461-492`、`pages/test-page.js:183-197`。
- 当前 live probe 只采集页面脚本可直接读到的语言 / 时区 / geolocation API 存在性，不采集页面服务端回显的请求头内容。证据：`shared/diagnostic.js:162-236`。
- 当前仓库的权限模型已具备访问现有检测站和回显站所需能力：`host_permissions` 仍是 `<all_urls>`。证据：`manifest.json:15-17`。
- 截至 2026-07-02，本地验证确认 `httpbin.org/headers` 和 `httpbingo.org/headers` 都仍可直接返回请求头 JSON；`browserleaks.com/ip` 页面仍保留服务端渲染的 `HTTP Headers` 表格，可解析请求头回显。
- 2026-07-02 的真实 Chrome smoke 已确认：
  - 非白名单 `example.com` 的导航请求头保持浏览器原生 `zh-CN,zh;q=0.9`
  - 白名单 `browserleaks.com/ip` 的服务端回显为 `en-US,en;q=0.9`
  - 在把 `httpbin.org` 加入白名单后，其 JSON 回显也为 `en-US,en;q=0.9`
  证据：`research/2026-07-02-real-chrome-smoke.md`。
- 当前环境下，若通过 browser automation 直接新开 tab 并 `goto` 某些 header echo 页，可能遇到 `net::ERR_BLOCKED_BY_CLIENT`；但用户手动打开同页后，claim 现有 tab 可以正常完成 smoke。证据：`research/2026-07-02-real-chrome-smoke.md`。

## Requirements

- 必须能区分 allowlist 页面与非 allowlist 页面在请求头上的差异。
- 必须优先复用现有诊断页 / popup 入口，不额外扩成独立测试系统。
- 只解决“如何证明真实请求头已经生效”，不重写现有 DNR 生成逻辑，除非验证中发现真实缺陷。
- 验证路径必须尽量稳定，可复用既有检测站、回显接口或最小自建 echo 路径。
- 第一轮必须优先验证“当前目标标签页自己发出的页面请求头”，而不是先退化成 extension/background 自发请求。
- 第一轮可以接受“仅支持少数已知 echo 页面”的站点感知解析方式，但要把支持矩阵和失败提示写清楚。

## Acceptance Criteria

- [x] 至少有一种可重复的 live 验证路径，能显示服务端实际观测到的 `Accept-Language`。
- [x] 至少有一个 allowlist 命中样本和一个非 allowlist 对照样本。
- [ ] 若当前实现有缺陷，任务结果必须明确指向“验证链路补齐”还是“真实修复”。
- [x] 不引入新的 spoof 配置项。
- [x] 诊断页在“当前 tab 不是已知 echo 页面”时，能明确提示如何切换到推荐的 allowlist / control 样本页继续验证。

## Out Of Scope

- 修改 language 配置模型。
- 扩展到 `User-Agent` 或其他请求头。
- 建立通用的任意站点请求头抓包系统。

## Open Questions

- 当前无阻塞性开放问题；推荐方案是首轮支持 `browserleaks.com/ip` 作为 allowlist echo 样本，`httpbin.org/headers` 作为非 allowlist control 样本。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
