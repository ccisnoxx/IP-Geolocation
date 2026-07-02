# Accept-Language 实时校验闭环设计

## Summary

首轮设计采用“复用现有 diagnostic 页 + 目标标签页 site-aware 回显解析”的方案，不引入新的测试页面系统，也不先做 background/extension 自发请求探测。核心目标是让 diagnostic 页在目标标签页本身就是已知 header echo 页面时，直接显示服务端回显的 `Accept-Language`，并与解析后的期望值做对比。

## Why This Shape

- 现有 diagnostic 链路已经具备：
  - 记录目标 tab
  - 读取当前生效配置
  - 在目标页 main world 执行 live probe
- `Accept-Language` 是请求侧信号。最接近真实用户访问路径的验证方式，是读取“加载当前目标页面时，服务端实际看到的请求头回显”，而不是先用 extension/background 另外发一次请求。
- 既有 smoke 已验证 `browserleaks.com/ip` 可以作为 allowlist 样本；当前网络验证也确认 `httpbin.org/headers` 与 `httpbingo.org/headers` 可作为 JSON 回显控制样本。

## First-Round Supported Sources

### Allowlist sample

- `browserleaks.com/ip`
- 解析方式：
  - 从页面 `HTTP Headers` 表格中提取 `Accept-Language`
  - 首轮只要求支持这一条稳定路径，不承诺支持 `browserleaks` 全站任意页面

### Non-allowlist control

- `httpbin.org/headers`
- 解析方式：
  - 读取页面纯文本
  - 解析 JSON
  - 读取 `headers["Accept-Language"]`
- 可兼容 `httpbingo.org/headers` 作为备用 JSON 样本，但不要求首轮 UI 暴露多套控制选项

## Data Flow

1. 用户在目标站点打开一个已知 echo 页面。
2. 用户从 popup 打开 diagnostic 页。
3. diagnostic 页继续通过 `getDiagnosticState(tabId)` 获取状态。
4. `shared/diagnostic.js` 中的 main-world probe 增加 `requestHeaderProbe`：
   - 探测当前页面是否为已支持的 echo 页面
   - 若支持，解析服务端回显的 `Accept-Language`
   - 返回统一结构：`status`、`source`、`observedAcceptLanguage`、`message`
5. diagnostic 页新增 `Accept-Language` live 校验区域：
   - 期望值
   - 实际回显值
   - 对比结果
   - 当前页面不受支持时的引导文案

## Proposed Probe Model

统一返回结构建议如下：

```js
requestHeaderProbe: {
  status: "ok" | "unsupported" | "parse_error",
  source: "browserleaks_ip" | "httpbin_headers" | "httpbingo_headers" | null,
  observedAcceptLanguage: string | null,
  message: string
}
```

这样可以避免 diagnostic 页把解析细节硬编码到渲染层。

## UI Changes

在 `test.html` / `pages/test-page.js` 中新增一个小节，位置放在“解析后的生效配置”和“目标页面实际值”之间或之后均可，但必须清楚区分：

- `effective-accept-language`: 配置层期望值
- `observed-accept-language`: 服务端回显值
- `compare-accept-language`: 是否一致
- `request-probe-source`: 当前回显来源
- `request-probe-message`: 不支持时如何继续验证

## Boundaries

- 首轮不做任意网站通用请求头检查。
- 首轮不做 background fetch 或 extension fetch 作为主验证路径。
- 首轮不修改 DNR 语言规则生成逻辑，除非 probe 暴露出真实缺陷。
- 首轮不扩展到其他请求头。

## Risks And Tradeoffs

### Tradeoff: third-party parsing brittleness

- `browserleaks.com/ip` 的 HTML 结构可能变。
- 解决方式：
  - 首轮解析尽量基于表格标题 / 行名，而非脆弱的深层 CSS 选择器
  - 对解析失败返回明确 `parse_error`
  - 保留 JSON 回显控制样本作为更稳定对照

### Tradeoff: not generic across arbitrary tabs

- 这个设计只能验证“当前目标 tab 正好是已知 echo 页面”的场景。
- 这是有意取舍：优先获得可信、最小、贴近真实请求路径的 live 验证闭环。

### Tradeoff: no automatic cross-site comparison

- 首轮不尝试在同一张 diagnostic 页里自动同时拉 allowlist / non-allowlist 两个不同站点的数据。
- 验证方式是分别在 allowlist 样本页和 control 样本页打开 diagnostic 页。

## Rollout Shape

1. 先补 requestHeaderProbe 数据模型和 UI。
2. 先支持 `browserleaks.com/ip` + `httpbin.org/headers`。
3. 若解析或可用性不足，再考虑补 `httpbingo.org/headers` 备用支持。
4. 若首轮验证中暴露 DNR 真缺陷，再回到规则生成逻辑修复。
