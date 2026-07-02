# Accept-Language 实时校验闭环实现计划

## Ordered Checklist

1. 梳理并固定首轮 probe 支持矩阵
   - allowlist 样本：`browserleaks.com/ip`
   - control 样本：`httpbin.org/headers`
   - 备用 control：`httpbingo.org/headers`

2. 扩展 diagnostic model
   - 在 `shared/diagnostic.js` 中增加 request-header probe helper
   - 统一返回 `status/source/observedAcceptLanguage/message`
   - 保持现有 `livePage` 结构兼容，不破坏已有 language/timezone/intl 渲染

3. 扩展 background diagnostic state
   - `getDiagnosticState()` 返回新的 request-header probe 数据
   - 不改 popup 打开诊断页的入口模型

4. 扩展 diagnostic page UI
   - 在 `test.html` 新增 `Accept-Language` live 校验区
   - 在 `pages/test-page.js` 渲染期望值、观察值、对比结果、来源和提示

5. 添加最小测试
   - 为 probe helper 的纯解析逻辑补单测或最小 fixture 验证
   - 覆盖：
     - `browserleaks` HTML 解析成功
     - `httpbin` JSON 解析成功
     - 非支持页面返回 `unsupported`
     - 解析失败返回 `parse_error`

6. 手工验证
   - allowlist `browserleaks.com/ip`
   - non-allowlist `httpbin.org/headers`
   - 至少验证一次命中白名单和一次未命中白名单

## Validation Commands

优先级从低到高：

```bash
node --test tests/*.test.js
```

如果新增了独立测试文件：

```bash
node --test tests/diagnostic*.test.js
```

手工验证：

1. 让 `browserleaks.com` 在白名单中，打开 `https://browserleaks.com/ip`
2. 从 popup 打开 diagnostic 页，确认：
   - 期望 `Accept-Language`
   - 服务端回显 `Accept-Language`
   - Compare 为一致
3. 打开未加入白名单的 `https://httpbin.org/headers`
4. 再次打开 diagnostic 页，确认：
   - 观察值是浏览器原生 `Accept-Language`
   - 与 allowlist 样本形成对照

## Review Gates

- Gate A: 不引入新的 spoof 配置项
- Gate B: 不把这项扩成通用抓包系统
- Gate C: 当前页不是已知 echo 页面时，用户能看到明确提示，而不是空白或误判
- Gate D: 若发现真实 DNR 缺陷，修复必须和验证链路补齐分开描述

## Rollback Points

- 若第三方页面解析过于脆弱，可先只保留 JSON control 路径，并把 allowlist 样本支持缩回 planning 结论
- 若 diagnostic UI 过重，可先保留 requestHeaderProbe 数据模型，再压缩展示字段

## Likely Files

- `shared/diagnostic.js`
- `background/services.js`
- `pages/test-page.js`
- `test.html`
- `tests/diagnostic*.test.js`
