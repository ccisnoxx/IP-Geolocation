# iframe / subframe 一致性补强实现计划

## Ordered Checklist

1. 固定 fixture 宿主方案
   - 采用 `localhost` / `child.localhost` / `nonmatch.localhost`
   - 记录推荐本地启动方式

2. 新增最小 fixture 页面
   - top page
   - same-origin child
   - allowlisted child
   - non-matching child
   - `about:blank/srcdoc` 边界样本

3. 扩展 diagnostic model
   - `shared/diagnostic.js` 增加 frame collection helper
   - 保持现有顶层字段兼容
   - 对不可访问 frame 返回显式边界状态

4. 扩展 diagnostic UI
   - `test.html`
   - `pages/test-page.js`
   - 展示 frame 列表与顶层对比

5. 添加最小测试
   - 纯 helper 测试
   - 如果新增 fixture 结构解析 helper，则补对应回归

6. 手工验证 fixture
   - 顶层命中 + same-origin child
   - 顶层命中 + child 也命中白名单
   - 顶层命中 + child 不命中白名单
   - `about:blank/srcdoc` 边界

7. 真实站点抽查
   - 至少 1 个白名单站点
   - 只抽查其现有 child frame 关键读数

## Validation Commands

```bash
npm test
```

如新增专门测试：

```bash
node --test tests/*.test.js
```

手工验证建议：

1. 启动本地静态 fixture 服务
2. 把 `localhost`、`child.localhost` 加入白名单
3. 不把 `nonmatch.localhost` 加入白名单
4. 打开顶层 fixture
5. 从 popup 打开 diagnostic 页，检查各 frame 读数与对比

## Review Gates

- Gate A: 不把“顶层命中 + child 不命中”误报成 bug
- Gate B: 不把第一轮扩成新的跨域继承注入模型
- Gate C: 对不可访问 frame 必须给出明确边界说明
- Gate D: fixture 是主验证，真实站点抽查只是补证

## Rollback Points

- 如果一次性把 frame 列表 UI 做太重，可先输出最小字段：
  - URL
  - accessible
  - language
  - timezone
  - compare
- 如果真实站点抽查不稳定，不阻塞 fixture 结论，但必须在结果中说明

## Likely Files

- `shared/diagnostic.js`
- `pages/test-page.js`
- `test.html`
- `tests/*.test.js`
- 新增本地 fixture 页面与最小启动说明
