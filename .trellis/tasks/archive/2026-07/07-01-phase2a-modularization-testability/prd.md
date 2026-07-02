# Phase 2A 模块拆分与可测试性

## Goal

在不改变现有产品边界、权限范围和运行时加载方式的前提下，把当前扩展从“大文件 + 入口脚本内聚合一切职责”的形态，重构为可分层复用、可在 Node 下直接验证纯逻辑的 JavaScript 模块结构，为后续权限/注入边界收缩提供稳定基础。

## Confirmed Facts

- 仓库现在已经具备最小 Node 测试工具链：`package.json` 提供 `npm test`，并已有 `tests/*.test.js` 覆盖 config、diagnostic、runtime、wiring 以及后续行为补强项。
- 运行态仍保持原生 Chromium MV3 扩展，不依赖 bundler / transpiler 构建产物。
- `background.js` 已收敛为装配层；主要职责已下沉到 `background/services.js` 与 `background/message-router.js`。
- `config.js` 已采用浏览器全局 + Node `module.exports` 双出口，并把主要逻辑下沉到 `shared/config-base.js` 与 `shared/config-profile.js`。
- 原先 `background.js` 与 `test.js` 之间重复的 diagnostic 逻辑已收敛到 `shared/diagnostic.js`。
- `popup.js`、`options.js`、`test.js` 现在都已变成薄入口，主要页面控制逻辑分别位于 `pages/popup-page.js`、`pages/options-page.js`、`pages/test-page.js`。
- `main_spoof.js` 相关职责已拆入 `spoof/date-time.js`、`spoof/worker-hooks.js`、`spoof/geolocation.js`、`spoof/apply.js` 等模块。
- 当前工作区已有一组未提交的 Phase 1/WIP 改动，尤其是诊断页链路扩展到了 `background.js`、`popup.js`、`test.html`、`main_spoof.js`；Phase 2A 需要在保留这些行为目标的基础上做结构重组，而不是回退它们。
- 你已明确 Phase 2A 只做模块拆分与可测试性，不做权限边界收缩；`host_permissions`、`matches`、`allFrames`、`runAt`、`world` 等注入范围保持不变，留给 Phase 2B。
- 你已明确 Phase 2A 保持 JavaScript，允许最小开发工具链，运行态仍保持扩展原生可加载，不引入重型 bundler / transpiler。
- 你已明确 Phase 2A 采用“经典脚本优先”运行时策略，不把原生 ESM 作为统一前提。
- 你已明确 Phase 2A 的范围不是只抽几个纯函数，而是“连 UI 一起深拆”：共享逻辑与 popup/options/test 页面控制器都要形成更清晰边界。

## Requirements

- R1: 保持 JavaScript 源码层，不把本任务扩展为 TypeScript 迁移。
- R2: 允许最小开发工具链，但运行态必须继续保持 unpacked extension 原生可加载，不依赖 bundler / transpiler 才能运行。
- R3: Phase 2A 默认采用经典脚本优先策略：入口脚本可通过有序脚本装配共享模块，但不要求统一切到原生 ESM。
- R4: `manifest.json` 中现有运行边界相关配置保持兼容，包括页面入口名、background service worker 入口名、content script 注入目标和页面路径。
- R5: 存储 schema、配置 JSON 语义、popup/options 的功能含义、runtime message action 名及其响应形状保持兼容。
- R6: 必须把当前重复出现的 diagnostic 逻辑收敛到共享模块，避免 background 与 test 页各自维护一份近似实现。
- R7: 必须把 `background.js` 拆成职责明确的模块，至少分离出配置/存储访问、geo 刷新、运行时副作用、诊断服务、message 路由几个边界。
- R8: 必须把 `config.js` 内部进一步拆成共享纯逻辑模块，但对外继续提供统一 `IPGeoConfig` API，避免破坏现有调用点。
- R9: 必须把 `main_spoof.js` 拆出可单独理解和复用的内部边界，至少区分 timezone/date patch、Intl locale patch、worker hook patch、payload bootstrap。
- R10: 必须把 `popup.js`、`options.js`、`test.js` 从“DOM + 状态 + 动作混写”重构为更薄的页面入口与可复用控制/渲染模块。
- R11: 必须引入 Node 下可直接执行的最小测试能力，并优先覆盖纯逻辑边界，而不是依赖浏览器手工点测作为唯一验证方式。
- R12: 测试范围至少覆盖配置归一化/校验/匹配、生效 profile 解析、diagnostic 构建、消息封装或页面表单映射中的核心纯逻辑。
- R13: Phase 2A 不修改权限边界、不收缩注入范围、不新增产品能力、不改变 Phase 1 的行为目标。
- R14: 结构重组必须考虑当前未提交 WIP，避免为了“干净重构”而回退已经引入的诊断与 `Intl` 扩展能力。

## Acceptance Criteria

- [x] 仓库新增最小测试工具链配置，并可在本机 Node 环境下执行纯逻辑测试。
- [x] `background.js` 不再继续承担大段诊断构建、重复工具函数和长链式 action 分发；相关职责已下沉到模块。
- [x] `config.js` 的内部逻辑已按职责拆分，但现有调用点仍能通过统一出口访问兼容 API。
- [x] `background.js` 与 `test.js` 原先重复的 diagnostic 逻辑已收敛到共享模块，不再保留两份实现。
- [x] `main_spoof.js` 内部已形成清晰模块边界，便于单独理解时区、locale 和 worker hook 行为。
- [x] `popup.js`、`options.js`、`test.js` 已拆成更薄的页面入口，页面控制与渲染辅助不再都堆在单文件顶层。
- [x] `manifest.json`、存储 schema、导入导出配置格式、runtime message 契约与既有页面路径保持兼容。
- [x] 扩展仍可作为原生 unpacked extension 加载，不需要 bundler / transpiler 构建产物。
- [x] 至少一组 Node 侧测试通过，覆盖配置纯逻辑与诊断/控制器共享逻辑的关键路径。
- [x] 本阶段未引入权限/注入边界变化；相关工作仍留给 Phase 2B。

## First-Round Conclusion

本阶段定义的“模块拆分与可测试性”目标已经完成：

- runtime 入口保持原生扩展可加载
- 主要业务逻辑已按 runtime boundary 下沉到 `background/`、`shared/`、`pages/`、`spoof/`
- Node 侧测试基线已建立，并持续覆盖后续行为补强任务
- 后续权限/注入边界工作已能建立在稳定模块边界之上

因此，`Phase 2A` 可以按“结构边界与测试基础已完成”收口。

## Out Of Scope

- 收缩 `<all_urls>`、`matches`、`allFrames`、`runAt`、`world` 或其他权限/注入边界。
- 新增产品能力、配置字段、站点规则语义或新的指纹伪装范围。
- TypeScript 迁移、重型 bundler、transpiler、复杂浏览器 E2E 基建。

## Open Questions

None currently blocking.
