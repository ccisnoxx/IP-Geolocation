# Phase 1 行为一致性与真实 smoke design

## Design Goal

在尽量保持运行态结构不变的前提下，把页面主世界的 locale 派生行为扩展到 7 个新增 `Intl` 接口，并让 `test.html` / 诊断页和真实 Chrome smoke 都能验证这些行为。

## Runtime Shape

### `main_spoof.js`

- 继续作为唯一的 main world 行为补丁入口。
- 复用现有 `normalizeLocale(locales)` 语义，把默认 locale spoof 扩展到：
  - `Intl.NumberFormat`
  - `Intl.Collator`
  - `Intl.RelativeTimeFormat`
  - `Intl.ListFormat`
  - `Intl.PluralRules`
  - `Intl.DisplayNames`
  - `Intl.Segmenter`
- 不新增新的配置来源；新增接口统一读取当前 `payload.languageConfig.language`。
- timezone 仍只复用现有 `payload.timezone` 路径，不为新增接口设计独立 timezone 行为。

### `background.js`

- 继续复用当前 `getDiagnosticState` / `probeLivePageState` 诊断链路。
- 在 live probe 中补一个固定 shape 的 `intlDiagnostics` 对象，作为 `test.html` 唯一数据源。
- 诊断采集必须在目标页面 `MAIN` world 中执行，确保读到的是实际 spoof 后的页面值，而不是诊断页自身上下文。

### `test.html`

- 保持当前“读取 popup 关联 tab 的 live 状态”模式，不再另起一套测试页交互。
- 新增 7 个 `Intl` 接口的展示区，按接口显示：
  - 期望 locale
  - live 页面 resolved locale
  - sample 输出
  - compare 结果
  - 错误信息（如果接口不可用或调用失败）

## Diagnostic Contract

- `background.js` 返回的 `livePage.intlDiagnostics` 固定包含 7 个键：
  - `numberFormat`
  - `collator`
  - `relativeTimeFormat`
  - `listFormat`
  - `pluralRules`
  - `displayNames`
  - `segmenter`
- 每个键的 payload 结构固定为：
  - `locale`: 接口实例 `resolvedOptions().locale`，如接口不支持则为 `null`
  - `sample`: 固定样例输出，仅用于人工排障
  - `error`: 异常消息或空字符串
- 样例固定，避免 smoke 记录口径漂移：
  - `NumberFormat(123456.78)`
  - `Collator(["ä", "a", "z"].sort(...))`
  - `RelativeTimeFormat(-2, "day")`
  - `ListFormat(["Tokyo", "Osaka", "Nagoya"])`
  - `PluralRules(2)`
  - `DisplayNames("JP")`
  - `Segmenter("東京都に行きます")`

## Verification Shape

### Local Diagnostic

- 先在 allowlist 命中的普通页面或检测站页面上通过诊断页确认：
  - 既有 language/timezone/offset/date 读数仍然正常
  - 新增 7 个接口均能返回 `locale` 和 `sample`
  - compare 逻辑能够区分 allowlist / non-allowlist

### Real Chrome Smoke

- 真实 smoke 仍复用既有矩阵：
  - allowlist 目标：`claude.ai`、`gemini.google.com`
  - 检测站：`browserleaks.com`、`whoer.net`
  - 非白名单普通站点：至少 1 个
- smoke 默认使用与当前出口 IP 对齐的配置来验证真实业务路径：
  - `timezone` / `geolocation` 优先走 `auto` / `follow IP`
  - `language` 仍显式配置，但应选与美国出口 IP 不冲突的 `en-US`
- 产品站点允许停在等待页、restricted 页或登录前页；只要 landing page 的 main-world 值与配置一致即可视为通过。
- 检测站只记录并解释本项目负责维度，不把整站评分或 exit IP 地理差异视为失败。

## Compatibility And Rollback

- 不改 `manifest.json`、配置 schema、导入导出格式或 UI 配置项定义。
- 如果某个 `Intl` 接口的补丁引入兼容性问题，回退该接口级补丁，而不是扩大为结构性重构。
- 如果诊断页开始承担测试平台职责，收回到“最小必要可见诊断”的边界。
