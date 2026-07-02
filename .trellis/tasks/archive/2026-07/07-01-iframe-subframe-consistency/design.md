# iframe / subframe 一致性补强设计

## Summary

第一轮不重做注入模型，而是先把边界证明清楚。技术路线分两层：

1. 增加一个最小 repo-local iframe fixture，稳定复现 4 类 frame 场景
2. 在现有 diagnostic 链路上补 frame 读取能力，用来验证 fixture，并对真实站点做少量抽查

目标是回答：

- 哪些 frame 当前天然可覆盖
- 哪些 frame 当前天然不会覆盖
- `about:blank/srcdoc` 在当前模型下是否会吃到 spoof

而不是第一轮就承诺“所有 child iframe 都继承 spoof”。

## Why This Shape

- 当前注入链路已经是 `allFrames: true`，但这只决定“命中的 frame 也会注入”，不解决 frame URL 是否命中规则的问题。
- 当前 diagnostic 只读顶层页，完全看不到 frame，因此“注入有无”与“frame 实际读到什么”之间存在证据缺口。
- 真实站点的 iframe 结构、跨域限制和登录状态都很碎，单靠真实站点难以稳定复现边界。
- repo-local fixture 可以让“注入模型边界”和“诊断能力补齐”先在可控环境中闭环，再去真实站点抽查。

## Fixture Topology

建议增加一个最小本地静态 fixture 服务，基于同一台机器不同 host 访问：

- `http://localhost:<port>/fixtures/iframe/top.html`
- `http://localhost:<port>/fixtures/iframe/child-same-origin.html`
- `http://child.localhost:<port>/fixtures/iframe/child-allowlisted.html`
- `http://nonmatch.localhost:<port>/fixtures/iframe/child-nonmatch.html`

其中：

- `localhost` 用于顶层页和 same-origin child
- `child.localhost` 作为“child 也命中白名单”的跨 host 样本
- `nonmatch.localhost` 作为“child 不命中白名单”的跨 host 样本

这几个 host 当前都解析到 `127.0.0.1`，可以由同一个本地静态服务承载。

## First-Round Scenarios

### Scenario A: 顶层命中 + same-origin child

- Top: `localhost`
- Child: `localhost`
- 预期：
  - 顶层命中白名单
  - child 也命中同一规则
  - 顶层与 child 的 `language/timezone/Date/Intl` 一致

### Scenario B: 顶层命中 + child 也命中白名单

- Top: `localhost`
- Child: `child.localhost`
- 白名单同时包含 `localhost` 和 `child.localhost`
- 预期：
  - 顶层命中
  - child 单独命中
  - 顶层与 child 一致

### Scenario C: 顶层命中 + child 不命中白名单

- Top: `localhost`
- Child: `nonmatch.localhost`
- 白名单只包含 `localhost`
- 预期：
  - 顶层命中
  - child 不命中
  - child 保持原生值
  - 结果归类为“匹配模型限制”，不是 bug

### Scenario D: `about:blank/srcdoc` 边界

- Top: `localhost`
- Child: `about:blank` 或 `srcdoc`
- 预期：
  - 第一轮只要求测清当前实际行为
  - 若当前可覆盖，记录其依据
  - 若当前不可覆盖，记录为边界，而不是立刻扩展模型

## Diagnostic Model Changes

现有 `probeLivePageState()` 只返回顶层页结果。第一轮建议扩成：

```js
{
  livePage: {
    ...topLevelFields,
    frames: [
      {
        url,
        title,
        language,
        languages,
        timezone,
        offsetMinutes,
        dateString,
        accessible
      }
    ]
  }
}
```

设计要点：

- 只采集第一层 frame，不递归所有后代
- `accessible` 表示当前 probe 是否能读取该 frame
- 跨域不可读 frame 不报错为 task failure，而是明确标注为边界

## Probe Strategy

首轮不依赖复杂 Playwright frame 遍历；优先继续复用 `chrome.scripting.executeScript` 在目标 tab 的 `MAIN` world 执行收集函数。

具体做法分两步：

1. 顶层页单独收集 iframe target 列表：
   - `id`
   - `name`
   - `data-scenario`
   - `src`
   - `resolvedUrl`
   - `srcdoc`
2. 再用 `allFrames: true` 在每个已可执行的 frame 内分别执行 `collectLivePageState()`，收集该 frame 自身读数：
   - `location.href`
   - `document.title`
   - `window.name`
   - `navigator.language`
   - `navigator.languages`
   - `Intl.DateTimeFormat().resolvedOptions().timeZone`
   - `Date#getTimezoneOffset()`
   - `Date#toString()`

然后在诊断层把“目标 iframe 列表”和“实际收到的 frame 结果”做匹配。

这样可以避免用顶层页直接跨源读取 `window.frames`，同时仍然保留“哪些 iframe 存在但没有返回结果”的边界信息。

## UI Changes

在 `test.html` / `pages/test-page.js` 中新增一个 `iframe / subframe` 区块：

- 顶层页摘要
- frame 列表
- 每个 frame 的：
  - URL
  - 是否可访问
  - language / timezone / offset
  - 与顶层对比结果

第一轮不需要花太多 UI 复杂度，能看清差异即可。

## Real-Site Spot Check

在 fixture 闭环后，再对真实站点做小范围抽查：

- 至少一个白名单站点
- 只要求抽查它存在的关键 child frame
- 若真实站点不可稳定复现，不阻塞 fixture 结论

真实站点抽查的角色是“验证外部世界没有明显偏差”，不是主要验收手段。

## Boundaries

- 第一轮不承诺覆盖任意跨域 child iframe
- 第一轮不改 `matches` 生成规则
- 第一轮不改权限边界
- 第一轮不把 worker / service worker 混进来

## Risks And Tradeoffs

### Tradeoff: fixture != internet reality

- 本地 fixture 更稳定，但不能代表所有真实站点
- 所以需要保留一层真实站点抽查

### Tradeoff: `window.frames` 可读性受同源限制

- 这正是本任务要测清的边界之一
- 第一轮设计接受“有些 frame 只能判定不可访问”

### Tradeoff: `about:blank/srcdoc` 可能表现特殊

- 第一轮只要求把现状说清
- 不要求本轮就修

## Rollout Shape

1. 加入本地 fixture 页面
2. 扩展 diagnostic data model 以收集 frame 读数
3. 在 diagnostic UI 中展示 frame 列表和对比
4. 用 fixture 覆盖 4 类场景
5. 再做 1 个真实站点抽查
