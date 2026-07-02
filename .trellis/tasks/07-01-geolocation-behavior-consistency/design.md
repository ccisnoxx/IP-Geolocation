# geolocation 行为一致性补强设计

## Summary

第一轮不尝试完整复制浏览器原生 geolocation，而是先把最直接、最容易被页面脚本观察到的行为模型补齐。技术路线分两层：

1. 增加一个最小 repo-local geolocation fixture，稳定复现成功回调、`watchPosition` / `clearWatch`、错误分支基础形态
2. 在现有 diagnostic 链路上补 geolocation 行为验证能力

目标是回答：

- 当前 `getCurrentPosition` 成功分支是否像样
- `watchPosition` / `clearWatch` 是否有最小可用模型
- 错误分支是否有明确行为
- 哪些权限状态和拒绝态仍属于下一轮候选

而不是第一轮就完整模拟浏览器权限系统。

## Why This Shape

- 当前实现只把 geolocation 做成了“给个成功值”，而不是完整行为模型。
- 页面最容易直接观察到的差异不是 `permissions.query`，而是：
  - 有没有成功回调
  - `watchPosition` 是否真能 watch
  - `clearWatch` 是否存在
  - 错误分支是否有基本形态
- 权限状态和浏览器弹窗强相关，环境依赖大，适合作为后续候选而不是第一轮主线。

## Fixture Topology

建议新增 `fixtures/geolocation/`：

- `top.html`

第一页就够，里面提供若干按钮和结果区：

- `Run success`
- `Run watch`
- `Run clearWatch`
- `Run forced error`

该页的职责不是模拟浏览器原生 geolocation，而是让当前 page-world geolocation patch 的行为可以被稳定触发和观察。

## First-Round Scenarios

### Scenario A: success callback

- 调用 `navigator.geolocation.getCurrentPosition(success, error)`
- 观察：
  - 是否进入 success
  - 是否返回配置坐标
  - `coords` 字段是否具备最小必要值

### Scenario B: watchPosition

- 调用 `watchPosition`
- 至少要求：
  - 返回一个稳定可追踪的 watch id
  - 能触发成功回调

第一轮不要求真实持续流式更新，但不应只是完全随机且不可清除的伪 id。

### Scenario C: clearWatch

- 调用 `clearWatch(watchId)`
- 第一轮最小目标：
  - API 存在
  - 对已登记的 watch id 有可观测的清理效果

### Scenario D: error branch

- 通过 fixture 传入一个明确的 forced error 模式或测试开关，触发错误回调
- 第一轮只要求有最小标准化错误形态：
  - `code`
  - `message`

### Scenario E: permission / denial boundary

第一轮不把 `permissions.query({ name: "geolocation" })` 纳入主验证目标。

要求只是：

- 在结论里明确写成“后续候选”
- 不把当前缺失的权限态误写成第一轮 bug

## Proposed Behavior Model

建议把 geolocation patch 从“直接改写两个函数”收敛成一个最小内部 state model：

- active watches: `Map<watchId, callback payload>`
- next watch id: deterministic counter
- optional forced error mode

最小 contract：

```js
getCurrentPosition(success, error, options)
watchPosition(success, error, options) -> watchId
clearWatch(watchId)
```

不做的事：

- 不模拟完整高频位置变化
- 不模拟浏览器权限弹窗生命周期
- 不模拟全部超时 / maximumAge 语义

## Diagnostic Model Changes

在 `shared/diagnostic.js` 中新增 geolocation behavior probe 数据，例如：

```js
geolocationBehavior: {
  status,
  successResult,
  watchResult,
  clearWatchResult,
  errorResult,
  note
}
```

用于 diagnostic 页展示：

- success 是否触发
- 返回的 coords
- watch id 是否稳定
- clearWatch 是否可用
- error callback 的最小结构

## Probe Strategy

首轮不在任意真实站点上直接主动触发 geolocation；优先在 fixture 页中运行。

建议方式：

1. fixture 顶层页暴露 `window.runGeolocationDiagnostics()`
2. 该方法顺序触发：
   - success
   - watch
   - clearWatch
   - forced error
3. 返回统一结构
4. diagnostic 页读取并展示

这样可以避免在普通站点上误触 geolocation 权限交互。

## UI Changes

在 `test.html` / `pages/test-page.js` 中新增 geolocation behavior 区块，至少显示：

- success status / coords
- watch status / watchId
- clearWatch status
- error status / code / message
- note

## Real-Site Spot Check

fixture 闭环后，再做少量真实站点抽查：

- 只在安全、可控、不会误触敏感权限流的页面上进行
- 真实站点抽查仅作为补证，不作为第一轮主要验收手段

## Boundaries

- 第一轮不做完整权限状态建模
- 第一轮不模拟浏览器 geolocation 全时序语义
- 第一轮不扩展到 geolocation 之外的信号

## Risks And Tradeoffs

### Tradeoff: fixture 不代表真实权限系统

- 这是有意取舍：先补最小行为模型
- 权限系统另开候选，不和这轮主线混在一起

### Tradeoff: forced error 是测试模式，不是浏览器真实拒绝

- 第一轮只要求建立可观测错误分支
- 不把它包装成“已完整模拟用户拒绝权限”

## Rollout Shape

1. 增加 repo-local geolocation fixture
2. 抽 geolocation patch 的最小 state model
3. 补 success / watch / clearWatch / error 分支
4. 扩展 diagnostic data model 与 UI
5. 用 fixture 验证
6. 再决定是否需要第二轮权限态工作
