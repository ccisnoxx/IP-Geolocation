# 项目优化规划

## Goal

基于当前仓库真实状态，梳理这个浏览器插件下一轮“优化”应优先投入的方向，收敛出一个明确的一阶段目标，并形成后续实现任务可直接采用的分阶段优化范围与验收口径。一阶段目标已聚焦为“真实效果与可靠性”，并允许在此阶段扩展 `locale/timezone` 派生面，但不扩到 `device/browser` 指纹面。

## Confirmed Facts

- 项目是一个 Chromium Manifest V3 扩展，目标是在白名单网站上对齐语言、时区、IP 定位和 WebRTC 行为，减少指纹不一致。证据：`README.md`、`manifest.json`。
- 当前实现是原生 HTML + JavaScript，没有发现 `package.json`、`tsconfig*.json`、ESLint、Prettier、Playwright、Vitest、Jest 或 GitHub CI 配置。
- 主要逻辑集中在少数大文件中：`background.js` 660 行、`config.js` 497 行、`options.js` 499 行、`main_spoof.js` 368 行、`popup.js` 259 行。
- `background.js` 同时承担存储迁移、动态规则、WebRTC 策略、地理位置刷新、tab 注入、诊断页入口和 runtime message 分发等多种职责。
- `manifest.json` 目前申请了 `<all_urls>` 的 `host_permissions`；`background.js` 注册的 content scripts 也匹配 `<all_urls>`、`allFrames: true`、`runAt: "document_start"`。
- 当前已有一个相关的进行中任务 `07-01-custom-site-configuration-refactor/`，其 PRD 已把 v1.4 定义为已发布基线，并明确指出还缺少真实 Chrome 会话下的端到端 smoke 验证记录。
- 当前页面级 spoof 实现和诊断链路都聚焦在已有四类信号：`language`、`timezone`、`geolocation`、`WebRTC`。证据：`main_spoof.js`、`background.js`、`test.html`。
- 当前 `test.html` 只展示 `navigator.language(s)`、`timezone`、`offset`、`Date#toString()` 和 `geolocation API` 可用性，还没有展示新增 7 个 `Intl` 接口的诊断输出。
- 仓库中没有发现对 `navigator.userAgentData`、`screen`、`deviceMemory`、`hardwareConcurrency`、`navigator.platform`、`plugins` 等新指纹面的实现或诊断展示；如果第一阶段扩面，这些能力和验证链路都需要新补。
- 你已明确产品边界：本机浏览器本身就是真实浏览器指纹，本项目当前没有必要改 `device/browser` 指纹面；项目核心是保证与 IP 相关的一致性。
- 你已确认第一阶段不加入“按 IP/地区自动推导语言”。当前语言继续保持显式配置，优化重点放在把已有 `language/timezone` 配置一致地扩展到更多 `Intl` / locale 派生接口。
- 你已确认整体优化拆成两阶段：第一阶段先做行为与验证，第二阶段再做结构性重构，不把两类工作混在同一轮实施。
- 你已确认第一阶段验收必须包含真实 Chrome + 外部站点 smoke 验证，不能只依赖本地 `test.html` / 诊断页。
- 你已确认 Phase 1 若在真实 smoke 中发现问题，修复范围限定为“确认缺陷 + 最小必要诊断/验证补强”，不顺手扩成更大范围的行为项目。
- 你已确认 Phase 1 的 `locale/timezone` 扩面只覆盖常见且高价值的接口，不追求更广的全面覆盖。
- 你已确认 Phase 1 的 `locale/timezone` 扩面完全复用现有 `language/timezone` 配置，不新增独立 UI 字段，也不做每个接口的单独开关。
- 你已确认 Phase 2 的结构性重构顺序为：先做“模块拆分与可测试性”，再做“权限/注入边界收缩”。
- 你已确认 Phase 2 允许引入最小开发工具链，但运行态仍保持扩展原生可加载，不引入重型构建链依赖。
- 你已确认 Phase 2 保持 JavaScript 源码层，只引入最小测试 / lint 工具，不升级到 TypeScript。
- 你已确认 Phase 1 的外部站点 smoke 以“本项目负责的维度一致”为通过标准，而不是要求检测站整体全绿/全通过。
- 你已确认 Phase 1 的 `locale/timezone` 扩面必做清单固定为 7 个高价值接口：`Intl.NumberFormat`、`Intl.Collator`、`Intl.RelativeTimeFormat`、`Intl.ListFormat`、`Intl.PluralRules`、`Intl.DisplayNames`、`Intl.Segmenter`。
- 你已确认 Phase 1 要求本地 `test.html` / 诊断页同时补齐这 7 个 `Intl` 接口的可见诊断输出，不只依赖外部站点 smoke。
- 现有相关任务 `07-01-custom-site-configuration-refactor/` 已定义过一组可复用的真实 smoke 目标：白名单站点 `chatgpt.com`、`claude.ai`、`gemini.google.com`，检测站点 `browserleaks.com`、`whoer.net`，以及至少一个非白名单普通站点。

## Requirements

- R1: 这次规划必须先把“优化”拆成可区分的方向，例如运行效果/正确性、工程可维护性、用户体验、权限与性能边界、验证与发布质量。
- R2: 规划必须选出一个单独的一阶段主目标，避免把多种不同性质的优化混成同一轮实施。当前已确认一阶段主目标优先选择“真实效果与可靠性”。
- R3: 每个候选优化方向都要以仓库证据为基础，不用空泛最佳实践代替当前项目实际问题。
- R4: 规划结果至少要产出一个可以单独落地的下一步任务范围，并明确哪些项延后。
- R5: 当前阶段只做需求与范围收敛，不自动进入实现。
- R6: 你已确认第一阶段允许“扩面”，因此规划必须明确新增指纹面的边界，而不是泛泛写成“继续补更多指纹”。
- R7: 任何新增指纹面都必须同时定义验证方式；不能只加 spoof 逻辑、不加诊断或 smoke 检查口径。
- R8: 第一阶段新增范围优先限定在 `locale/timezone` 派生面，不扩到 `device/browser` 指纹面。
- R9: 规划必须保持项目核心目标为“与 IP 相关的一致性”，避免把浏览器指纹伪装平台化需求混入当前项目。
- R10: 第一阶段不新增“按 IP/地区自动推导语言”能力；语言仍由显式配置决定。
- R11: 整体优化按两阶段推进：Phase 1 聚焦行为与验证；Phase 2 聚焦结构性重构与可维护性提升。
- R12: Phase 1 的验收必须包含真实 Chrome + 外部站点 smoke 验证；本地 `test.html` / 诊断页只作为辅助诊断手段，不可替代真实站点结果。
- R13: Phase 1 如发现缺陷，修复范围限定为确认缺陷路径及最小必要的诊断/验证补强，不顺带做更大范围行为扩展。
- R14: Phase 1 的 `locale/timezone` 扩面只覆盖常见高价值接口，不以“尽可能全面覆盖所有 locale 相关接口”为目标。
- R15: Phase 1 的 `locale/timezone` 扩面必须复用现有 `language/timezone` 配置，不新增独立 UI 字段或每接口单独开关。
- R16: Phase 2 的结构性重构顺序固定为“模块拆分与可测试性”优先，“权限/注入边界收缩”随后进行。
- R17: Phase 2 允许引入最小开发工具链以支撑模块拆分与可测试性，但运行态必须继续保持原生扩展可加载，不依赖重型打包或转译链。
- R18: Phase 2 保持 JavaScript 源码层，只引入最小测试 / lint 工具，不把结构性重构扩展为 TypeScript 迁移项目。
- R19: Phase 1 的外部站点 smoke 以本项目负责的维度一致为通过标准，不把未覆盖的 `device/browser` 指纹项告警当作失败条件。
- R20: Phase 1 的 `locale/timezone` 扩面必做范围固定为 `Intl.NumberFormat`、`Intl.Collator`、`Intl.RelativeTimeFormat`、`Intl.ListFormat`、`Intl.PluralRules`、`Intl.DisplayNames`、`Intl.Segmenter`。
- R21: Phase 1 必须把本地 `test.html` / 诊断页补齐到可见展示这 7 个 `Intl` 接口的诊断输出，用于定位外部 smoke 中的不一致。
- R22: Phase 1 的真实 Chrome smoke 默认复用已存在的站点矩阵：`chatgpt.com`、`claude.ai`、`gemini.google.com`、`browserleaks.com`、`whoer.net`，以及至少一个非白名单普通站点。

## Acceptance Criteria

- [ ] 已确认当前项目的主要优化候选方向，并说明每个方向为什么值得做。
- [ ] 已确定一阶段主目标为“真实效果与可靠性”，并说明不把其它方向作为第一阶段的原因。
- [ ] 已形成一个分阶段优化框架，至少区分“现在做 / 下一阶段做 / 暂缓”。
- [ ] 已形成明确的两阶段框架，并记录为什么第一阶段不和结构重构绑在一起做。
- [ ] 结论能直接转成后续实现 task，而不需要重新做一轮需求澄清。
- [ ] 第一阶段扩面边界已明确限定在 `locale/timezone` 派生面，并记录为什么不纳入 `device/browser` 指纹面。
- [ ] 第一阶段已明确不新增“按 IP/地区自动推导语言”，并记录原因。
- [ ] 第一阶段验收已明确要求真实 Chrome + 外部站点 smoke，而不是只看本地诊断页。
- [ ] 第一阶段缺陷修复边界已明确限定为“确认缺陷 + 最小必要补强”。
- [ ] 第一阶段已明确只覆盖常见高价值 `locale/timezone` 派生接口，而非全面铺开。
- [ ] 第一阶段已明确复用现有 `language/timezone` 配置，不扩成新的配置系统。
- [ ] 第二阶段已明确先做模块拆分与可测试性，再做权限/注入边界收缩。
- [ ] 第二阶段已明确允许最小开发工具链，但保持运行态无重型构建依赖。
- [ ] 第二阶段已明确保持 JavaScript，只引入最小测试 / lint 工具。
- [ ] 第一阶段外部站点 smoke 的通过标准已明确限定在本项目负责维度。
- [ ] 第一阶段 `locale/timezone` 扩面的 7 个必做接口清单已固定。
- [ ] 第一阶段已明确要求本地诊断页补齐 7 个 `Intl` 接口输出。
- [ ] 第一阶段已明确默认复用现有 smoke 站点矩阵。

## Out Of Scope

- 直接开始代码改造、重写或引入新框架。
- 在没有优先级判断前，把验证、体验、架构、权限、指纹覆盖面一次性全部展开。

## Open Questions

None currently blocking.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
