# geolocation 行为一致性补强实现计划

## Ordered Checklist

1. 固定 fixture 结构
   - `fixtures/geolocation/top.html`

2. 重构 geolocation patch 为最小 state model
   - success payload builder
   - deterministic watch id
   - active watch registry
   - `clearWatch`
   - optional forced error path

3. 新增 repo-local fixture
   - success probe
   - watch probe
   - clearWatch probe
   - forced error probe

4. 扩展 diagnostic model
   - 在 `shared/diagnostic.js` 增加 geolocation behavior 结果结构
   - 不破坏现有 top-level / iframe / worker / request-header 结构

5. 扩展 diagnostic UI
   - `test.html`
   - `pages/test-page.js`
   - 展示 geolocation behavior 结果

6. 添加最小测试
   - geolocation state helper / normalizer 测试
   - 至少覆盖：
     - success
     - watch id
     - clearWatch
     - forced error

7. 手工验证 fixture
   - 触发 success
   - 触发 watch + clearWatch
   - 触发 forced error

## Validation Commands

```bash
npm test
```

如新增更细测试：

```bash
node --test tests/*.test.js
```

手工验证建议：

1. 启动本地静态 fixture 服务
2. 打开 `fixtures/geolocation/top.html`
3. 从 popup 打开 diagnostic 页或直接看 fixture 结果
4. 验证 success / watch / clearWatch / forced error

## Review Gates

- Gate A: 不把第一轮扩成完整权限模型
- Gate B: `clearWatch` 必须有真实可观察效果，不只是空函数
- Gate C: watch id 不要再用随机值
- Gate D: forced error 必须明确标成测试模式，不伪装成完整浏览器拒绝态

## Rollback Points

- 如果 diagnostic UI 一次接入过重，可先保留 fixture 自身结果展示，再延后接 diagnostic 页
- 如果权限相关分叉开始膨胀，立即把它留给后续候选，不在这轮继续扩大

## Likely Files

- `spoof/apply.js`
- `fixtures/geolocation/*`
- `shared/diagnostic.js`
- `pages/test-page.js`
- `test.html`
- `tests/*.test.js`
