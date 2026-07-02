# Phase 1 行为一致性与真实 smoke

## Goal

在不改变现有配置模型和产品边界的前提下，把 `language/timezone` 相关的一致性扩展到固定 7 个 `Intl` 接口，并通过本地诊断页与真实 Chrome + 外部站点 smoke 证明本项目负责维度的一致性。

## Confirmed Facts

- 当前页面侧 spoof 只覆盖 `navigator.language`、`navigator.languages`、`Intl.DateTimeFormat`、`Date#toLocale*`、`Date#getTimezoneOffset()`、`Date#toString()`、`geolocation`、`WebRTC`；证据见 `main_spoof.js`、`background.js`、`test.html`。
- 当前已经对 `Intl.NumberFormat`、`Intl.Collator`、`Intl.RelativeTimeFormat`、`Intl.ListFormat`、`Intl.PluralRules`、`Intl.DisplayNames`、`Intl.Segmenter` 的默认 locale 行为完成扩面，并在诊断页中展示。
- 父任务 `07-01-project-optimization-planning` 已固定本阶段边界：只做行为一致性与真实 smoke，不做结构重构，不扩到 `device/browser` 指纹面，不新增按 IP 自动推导语言。
- 既有真实 smoke 研究 `.trellis/tasks/07-01-custom-site-configuration-refactor/research/2026-07-01-real-chrome-smoke.md` 已证明 v1.4 在原有维度上通过过一次真实 Chrome smoke；本任务是在该基线上做有限扩面与复验。
- 当前工作区已经形成一套完整诊断链路：`background/services.js` 提供 `getDiagnosticState` / `openDiagnosticPage`，`popup.html` / `pages/popup-page.js` 提供诊断页入口，`test.html` / `pages/test-page.js` 已能展示 live page 值、7 个 `Intl` 接口诊断、iframe、worker、geolocation 行为和请求头诊断。
- 当前出口 IP 是美国 VPS，后续真实 smoke 应优先验证“跟随 IP”路径，而不是再用与出口 IP 故意不一致的测试 profile。
- 2026-07-02 的后续任务链已补齐本阶段核心缺口：
  - `Accept-Language` live 校验闭环
  - iframe / subframe 一致性边界
  - Worker / SharedWorker 一致性边界与 `module Worker` 修复
  - geolocation 最小行为模型
  - WebRTC 策略语义与最小 leak 验证
  相关证据见已归档子任务研究记录。

## Requirements

- R1: 只做行为一致性与真实 smoke，不做模块拆分、权限收缩、工具链引入、配置系统重构。
- R2: 新增范围固定为 7 个 `Intl` 接口：`Intl.NumberFormat`、`Intl.Collator`、`Intl.RelativeTimeFormat`、`Intl.ListFormat`、`Intl.PluralRules`、`Intl.DisplayNames`、`Intl.Segmenter`。
- R3: 完全复用现有 `languageConfig` / `timezoneConfig` / `payload.timezone` 语义，不新增配置字段、不新增每接口开关、不新增按 IP/地区自动推导语言。
- R4: 7 个新增接口只扩默认 locale 行为；timezone 仍由现有 `Date` / `Intl.DateTimeFormat` 路径负责，不为这 7 个接口引入独立 timezone 配置或新 override 语义。
- R5: `test.html` / 诊断页必须补齐这 7 个接口的可见输出，并显示目标标签页 main world 的真实读数与对比结果。
- R6: 真实 smoke 必须在真实 Chrome unpacked extension 会话中执行，并覆盖 `claude.ai`、`gemini.google.com`、`browserleaks.com`、`whoer.net`，外加至少 1 个非白名单普通站点；`chatgpt.com` 不再纳入本任务测试矩阵。
- R7: smoke 的通过标准只看本项目负责维度：`navigator.language`、`navigator.languages`、`Accept-Language`、现有 timezone/offset/date 行为、7 个 `Intl` 接口默认 locale 行为、geolocation、WebRTC；检测站整体评分或 exit IP 地理不一致不算失败。
- R8: 如 smoke 发现问题，只修确认缺陷路径与最小必要诊断补强，不顺手扩到 `device/browser` 指纹面，也不顺手做结构性整理。
- R9: 本阶段要先补本地诊断，再做真实 Chrome smoke；本地诊断用于缩短定位路径，但不能替代真实站点验证。
- R10: 真实 smoke 的主验证配置应优先使用与当前美国出口 IP 对齐的 profile：
  - `timezone` / `geolocation` 优先验证 `follow IP` / `auto` 路径
  - `language` 仍保持显式配置，但应选与美国出口 IP 不冲突的值，例如 `en-US`
  - 之前用于快速观察差异的 `ja-JP + Asia/Tokyo + Japan` smoke 结果不作为最终验收依据

## Acceptance Criteria

- [x] allowlist 命中的真实页面上，7 个新增 `Intl` 接口都体现配置语言带来的默认 locale 结果。
- [x] `test.html` / 诊断页能为这 7 个接口展示期望值、live 页面值、样例输出和对比结果。
- [x] persisted config、导入导出格式、popup/options 配置项数量和含义不变。
- [x] 非白名单普通站点继续保留浏览器原生 language/timezone/Intl 行为，不吃到 allowlist spoof。
- [x] 真实 Chrome smoke 有完整记录，并固定复用既有站点矩阵。
- [x] 检测站若提示未覆盖的设备/浏览器维度，或提示与 exit IP 地理不一致，只要本项目负责维度一致，仍判定通过。
- [x] 最终验收使用与美国出口 IP 对齐的 smoke 配置，而不是故意错配的日本 profile。

## First-Round Conclusion

本阶段已经完成最初定义的主目标：

- 7 个高价值 `Intl` 接口已完成 locale 扩面
- 本地诊断页已补齐对应输出与 live 对比
- 真实 Chrome + 外部站点 smoke 证据已齐备
- 后续发现的行为缺口已通过独立子任务分别补齐或明确记录边界

因此，这个 `Phase 1` 任务可以按“行为一致性与真实 smoke 已完成”收口。

## Out Of Scope

- `navigator.userAgentData`、`screen`、`deviceMemory`、`hardwareConcurrency`、`navigator.platform`、plugins 等新指纹面。
- 自动按 IP/地区推导语言。
- 模块拆分、测试框架、lint、权限边界收缩。
- 诊断页之外的额外测试平台化 UI。
