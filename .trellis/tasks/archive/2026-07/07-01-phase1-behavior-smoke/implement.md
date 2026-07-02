# Phase 1 行为一致性与真实 smoke implementation plan

## Ordered Checklist

1. 固定任务边界并启动子任务。
   - 落盘 `prd.md`、`design.md`、`implement.md`
   - `task.py start 07-01-phase1-behavior-smoke`

2. 先补本地诊断所需代码。
   - 扩 `main_spoof.js` 的 7 个 `Intl` 默认 locale spoof
   - 扩 `background.js` 的 live probe，补 `intlDiagnostics`
   - 扩 `test.html` 的展示与 compare
   - 只在必要时微调现有 popup/diagnostic 入口

3. 做最小静态验证。
   - `node --check config.js`
   - `node --check background.js`
   - `node --check popup.js`
   - `node --check options.js`
   - `node --check content.js`
   - `node --check main_spoof.js`

4. 做本地诊断验证。
   - 在 allowlist 页面打开诊断页，确认 7 个接口都有可见输出
   - 在 non-allowlist 页面打开诊断页，确认 compare 能体现未 spoof 的原生值

5. 再做真实 Chrome + 外部站点 smoke。
   - 主 smoke profile 改为与当前美国出口 IP 对齐：
     - `language`: `en-US`, `["en-US", "en"]`, `en-US,en;q=0.9`
     - `timezone`: 优先验证 `auto` / `follow IP`
     - `geolocation`: 优先验证 `auto` / `follow IP`
     - `WebRTC`: `strict`
   - 复用站点矩阵：`claude.ai`、`gemini.google.com`、`browserleaks.com`、`whoer.net`、至少一个非白名单普通站点
   - 之前 `ja-JP + Asia/Tokyo + Japan` 仅作中途可视化调试，不计入最终 smoke 验收

6. 如果 smoke 发现问题，只修确认缺陷路径。
   - 先定位唯一权威代码路径
   - 只补最小必要修复与诊断
   - 复跑受影响站点

7. 记录 smoke 结果并收尾。
   - 把 smoke 记录写入子任务自己的 `research/`
   - 总结变更、验证结果和残余风险

## Validation Contract

### Local checks

- 新增 7 个 `Intl` 接口的诊断项在 `test.html` 中都可见
- allowlist 页面 compare 为一致
- non-allowlist 页面仍显示原生值，不错误宣告 spoof 成功

### Real Chrome smoke

逐站至少记录这些字段：

- allowlist 命中状态
- `navigator.language`
- `navigator.languages`
- `Accept-Language`
- timezone / offset / date string
- 7 个新增 `Intl` 接口的 locale 与样例输出
- geolocation
- WebRTC 模式效果

## Risky Files

- `main_spoof.js`
  - 直接影响页面主世界 `Intl` 行为，最容易引入兼容性回归
- `background.js`
  - 负责诊断数据 shape，若 contract 漂移会导致 `test.html` 读数失真
- `test.html`
  - 容易把最小诊断页扩成过重的测试平台
- `popup.js` / `popup.html`
  - 只允许最小必要入口补强，不把 popup 做成新工作台

## Decision Gates

- Gate A: 先完成本地诊断，再进入真实 Chrome smoke
- Gate B: 没有真实 Chrome smoke 证据，不把本任务视为完成
- Gate C: 不扩到 `device/browser` 指纹面
- Gate D: 不新增自动语言推导和新配置字段
- Gate E: 发现问题时，只修确认缺陷和最小必要补强
