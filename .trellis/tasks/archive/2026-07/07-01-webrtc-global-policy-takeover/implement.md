# WebRTC 全局策略接管实现计划

## Ordered Checklist

1. 对齐模式语义
   - legacy `off` -> `default`
   - `strict` / `compatible` / `default` 与底层策略映射一一对应

2. 更新配置和 runtime contract
   - `shared/config-base.js`
   - `background/services.js`
   - `background/message-router.js`

3. 更新 UI 文案
   - `pages/popup-page.js`
   - `pages/options-page.js`
   - 避免继续把“恢复默认”写成“关闭”

4. 添加测试
   - config normalize / legacy alias
   - runtime state returned `effectivePolicy`
   - 文案或模式 key 的最小回归

5. 真实 smoke
   - 至少 1 个稳定 WebRTC leak 样本页
   - 记录 strict / compatible / default 的最小结果

6. 文档边界
   - 明确外部扩展并存时的最后写入者问题

## Validation Commands

```bash
npm test
```

如需最小真实 smoke：

- `browserleaks.com/webrtc`
- `diafygi.github.io/webrtc-ips`

## Review Gates

- Gate A: 不把 `default` 误实现成“禁用”
- Gate B: 兼容旧存储中的 `off`
- Gate C: 不把第一轮扩成外部扩展探测 / 禁用器
- Gate D: 至少有一条真实页面 leak 验证证据

## Rollback Points

- 如果 UI 同步改动过大，可先只改底层模式语义和 runtime 返回，再补文案
- 如果真实 smoke 站点波动，优先保留 `browserleaks.com/webrtc` 的最小证据

## Likely Files

- `shared/config-base.js`
- `background/services.js`
- `background/message-router.js`
- `pages/popup-page.js`
- `pages/options-page.js`
- `tests/*.test.js`
