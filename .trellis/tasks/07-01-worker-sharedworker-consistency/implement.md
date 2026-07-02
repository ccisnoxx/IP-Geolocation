# Worker / SharedWorker 一致性补强实现计划

## Ordered Checklist

1. 固定 fixture 结构
   - `fixtures/workers/top.html`
   - `worker-classic.js`
   - `worker-module.js`
   - `shared-worker.js`
   - 可选边界样本：`nested-parent.js`、`nested-child.js`

2. 新增最小 worker fixture
   - classic Worker
   - module Worker
   - SharedWorker
   - nested worker 观察样本

3. 扩展 diagnostic model
   - 在 `shared/diagnostic.js` 增加 worker diagnostics 数据结构
   - 约定 `status/result/error/note`
   - 不破坏现有 iframe / request-header / intl 诊断结构

4. 扩展 diagnostic UI
   - `test.html`
   - `pages/test-page.js`
   - 展示 worker 结果与边界说明

5. 添加最小测试
   - 纯 helper / 数据整形测试
   - 若新增 probe result normalizer，则补回归

6. 手工验证 fixture
   - classic Worker
   - module Worker
   - SharedWorker
   - nested worker 边界

7. 真实站点抽查
   - 至少 1 个白名单站点
   - 仅在它本来就使用 worker 时补证

## Validation Commands

```bash
npm test
```

如果新增更细的测试：

```bash
node --test tests/*.test.js
```

手工验证建议：

1. 启动本地静态 fixture 服务
2. 把 `localhost` 加入白名单
3. 打开 `fixtures/workers/top.html`
4. 从 popup 打开 diagnostic 页
5. 检查 classic / module / shared worker 的 locale/timezone 结果

## Review Gates

- Gate A: 不把 `nested worker` 自动视为应当已覆盖
- Gate B: 不把 `service worker` 缺失包装成第一轮 bug
- Gate C: SharedWorker 若环境不支持，应标成 `unsupported`，不是直接报失败
- Gate D: fixture 是主验证，真实站点只做补证

## Rollback Points

- 如果一次性把 nested worker 也接进 UI 太重，可先只在研究记录中保留其边界结果
- 如果 SharedWorker 在当前环境不可用，保留 classic / module Worker 为主结论，SharedWorker 记为环境边界

## Likely Files

- `fixtures/workers/*`
- `shared/diagnostic.js`
- `pages/test-page.js`
- `test.html`
- `tests/*.test.js`
