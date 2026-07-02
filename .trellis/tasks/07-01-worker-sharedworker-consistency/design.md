# Worker / SharedWorker 一致性补强设计

## Summary

第一轮不重做 worker 注入模型，而是先把当前 `Worker / SharedWorker` 的真实覆盖边界稳定证明出来。技术路线分两层：

1. 增加一个最小 repo-local worker fixture 页，稳定复现 `Worker`、`module Worker`、`SharedWorker`
2. 在现有 diagnostic 链路上补 worker 结果采集与展示

目标是回答：

- `Worker` 当前是否已吃到 locale/timezone spoof
- `SharedWorker` 当前是否已吃到 locale/timezone spoof
- `nested worker` 当前为什么不能直接算已覆盖
- `service worker` 当前为什么不在覆盖范围内

而不是第一轮就承诺深入支持所有 worker 拓扑。

## Why This Shape

- 当前 hook 的设计点很明确：页面里 new 出来的 `Worker / SharedWorker` 会先被替换成一个 blob URL，再在 worker 上下文里执行 `installDateTimeSpoof`。
- 当前并没有 worker live 诊断链路，所以即使代码看起来像生效，也缺少真实运行证据。
- 和 iframe 一样，真实站点上的 worker 结构很碎，不适合直接作为第一轮主验证手段。
- repo-local fixture 能稳定证明当前 hook 覆盖了什么，再把更深层的 worker 拓扑当作边界说明。

## Fixture Topology

建议新增 `fixtures/workers/`：

- `top.html`
- `worker-classic.js`
- `worker-module.js`
- `shared-worker.js`
- `nested-parent.js`
- `nested-child.js`

第一轮主验证只要求前 3 个：

- classic `Worker`
- module `Worker`
- `SharedWorker`

`nested-parent.js` / `nested-child.js` 可以作为边界观察样本，证明当前 hook 不会自动继续包裹 worker 内部再创建的 worker。

## First-Round Scenarios

### Scenario A: classic Worker

- 顶层页创建经典 `Worker`
- worker 脚本返回：
  - `navigator.language`
  - `navigator.languages`
  - `Intl.DateTimeFormat().resolvedOptions().timeZone`
  - `Date#getTimezoneOffset()`
  - `Date#toString()`

预期：

- locale/timezone 结果与顶层 allowlist 配置一致

### Scenario B: module Worker

- 顶层页创建 `{ type: "module" }` 的 `Worker`
- 返回与 classic worker 同一组结果

预期：

- module worker 与 classic worker 一样，最终返回 spoofed 值

### Scenario C: SharedWorker

- 顶层页创建 `SharedWorker`
- 通过 port 回传同一组结果

预期：

- `SharedWorker` 返回 spoofed 值

### Scenario D: nested worker boundary

- 顶层页创建 parent worker
- parent worker 再创建 nested worker
- 观测 nested worker 返回值或失败状态

第一轮目标：

- 只要求把当前行为记录清楚
- 不要求第一轮修复

### Scenario E: service worker boundary

第一轮不做 live harness。只要求从代码边界明确：

- 当前没有 hook 到 `navigator.serviceWorker.register`
- 因此 `service worker` 不纳入已覆盖范围

## Diagnostic Model Changes

建议在 `shared/diagnostic.js` 中新增 worker 结果数据模型，例如：

```js
workerDiagnostics: {
  classicWorker: { status, result, error },
  moduleWorker: { status, result, error },
  sharedWorker: { status, result, error },
  nestedWorker: { status, result, error, note },
  serviceWorker: { status, note }
}
```

其中：

- `status`: `ok` / `unsupported` / `error` / `not_attempted`
- `result`: worker 回传的 locale/timezone/date 读数
- `note`: 用于记录“当前边界说明”，避免把 service worker 误渲染成失败 bug

## Probe Strategy

首轮不把 worker 探针直接塞进任意真实站点页面；优先在 fixture 顶层页里跑它。

建议方式：

1. fixture 顶层页暴露一个最小全局方法，例如 `window.runWorkerDiagnostics()`
2. 该方法顺序创建：
   - classic worker
   - module worker
   - SharedWorker
   - 可选 nested worker 样本
3. 收集结构化结果并写回页面全局
4. diagnostic 链路只需要在目标页上调用该方法并读取结果

这样可以减少 diagnostic 代码直接持有 worker 业务细节。

## UI Changes

在 `test.html` / `pages/test-page.js` 中新增 `Worker / SharedWorker` 区块：

- classic Worker
- module Worker
- SharedWorker
- nested worker（边界观察）
- service worker（边界说明）

每块至少显示：

- status
- language
- languages
- timezone
- offset
- error / note

第一轮 UI 目标是可读，不追求复杂交互。

## Real-Site Spot Check

fixture 闭环后，再选一个白名单真实站点做小范围抽查：

- 只在该站本身已经使用 worker 的情况下抽查
- 若真实站点无法稳定拿到 worker 结果，不阻塞 fixture 结论

真实站点抽查是补证，不是主验收手段。

## Boundaries

- 第一轮不承诺 `nested worker` 已覆盖
- 第一轮不承诺 `service worker` 已覆盖
- 第一轮不改 worker hook 模型，只先证明现状
- 第一轮不扩展到 geolocation / WebRTC / 网络行为

## Risks And Tradeoffs

### Tradeoff: fixture 覆盖的是可控 worker，而不是真实站点所有 worker

- 这是有意取舍：先证明 hook 基线
- 再用真实站点做少量补证

### Tradeoff: SharedWorker 可用性受浏览器环境影响

- 某些环境可能直接不支持或被禁用
- 第一轮允许把它记录为 `unsupported`，不把环境缺失误判成本项目 bug

### Tradeoff: nested worker 不做第一轮主修复

- 从当前代码结构看，nested worker 没有自动继承 hook 的依据
- 第一轮把它明确记录为边界，比直接扩模型更符合任务范围

## Rollout Shape

1. 增加 repo-local worker fixture
2. 扩展 diagnostic data model 与 UI
3. 用 fixture 验证 `Worker / module Worker / SharedWorker`
4. 记录 nested / service worker 边界
5. 再做一个真实站点补充抽查
