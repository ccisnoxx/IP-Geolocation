# 项目优化规划 design

## Design Goal

把“整体重构优化”拆成可执行且可验收的两阶段计划：

- Phase 1：先做行为与验证，证明项目在自己负责的维度上与 IP 保持一致，并补齐必要诊断。
- Phase 2：再做结构性重构，先提升模块边界与可测试性，再收缩权限与注入边界。

当前 task 适合作为父任务，负责总范围、阶段顺序、验收边界和后续子任务映射；实际实现建议拆到后续子任务中独立推进。

## Program Shape

推荐拆成三个后续实现子任务：

1. Phase 1 child: 行为一致性与真实 smoke 验证
2. Phase 2A child: 模块拆分与可测试性
3. Phase 2B child: 权限与注入边界收缩

依赖关系是线性的：

- 先完成 Phase 1，确认行为目标与诊断链路稳定
- 再做 Phase 2A，把高耦合逻辑拆出清晰边界并建立最小测试能力
- 最后做 Phase 2B，基于更稳定的模块边界调整 `<all_urls>`、`allFrames`、全站注入等运行边界

## Phase 1 Boundary

### In Scope

- 保持现有产品边界：只负责与 IP 相关的一致性，不处理 `device/browser` 指纹面
- 保持现有配置模型：继续复用 `language` / `timezone` / `geolocation` / `WebRTC`
- 把 `locale/timezone` 一致性从当前的 `navigator.language(s)`、`Intl.DateTimeFormat`、`Date#toLocale*` 扩到 7 个高价值 `Intl` 接口：
  - `Intl.NumberFormat`
  - `Intl.Collator`
  - `Intl.RelativeTimeFormat`
  - `Intl.ListFormat`
  - `Intl.PluralRules`
  - `Intl.DisplayNames`
  - `Intl.Segmenter`
- 补齐 `test.html` / 诊断页，让这 7 个接口在目标页面中的实际表现可见
- 在真实 Chrome 中对既定站点矩阵执行 smoke
- 如果发现缺陷，只修复确认路径和最小必要诊断补强

### Out of Scope

- 新增“按 IP/地区自动推导语言”
- 新增每接口独立配置或 UI 开关
- 扩到 `userAgentData`、`screen`、`deviceMemory`、`hardwareConcurrency` 等设备/浏览器维度
- 顺手做结构重构、权限收缩或大范围配置模型升级

## Phase 1 Runtime Shape

Phase 1 应尽量保持运行态结构稳定，只在两个位置扩展：

1. `main_spoof.js`
   - 继续作为 main world 行为补丁入口
   - 在现有 `language` / `timezone` 数据上，补齐新增 `Intl` 默认 locale 行为
   - 不引入新的配置来源

2. `background.js` + `test.html`
   - 扩充 live-page probe 和本地诊断展示
   - 让新增接口既能在本地诊断页看见，也能在真实站点 smoke 中交叉验证

这样做的原则是：Phase 1 证明行为正确，不提前把结构改造混进来。

## Phase 1 Verification Contract

真实 smoke 默认复用现有任务里已定义的站点矩阵：

- 白名单站点：`chatgpt.com`、`claude.ai`、`gemini.google.com`
- 检测站点：`browserleaks.com`、`whoer.net`
- 至少一个非白名单普通站点

通过标准不是检测站“整体全绿”，而是本项目负责维度的一致：

- `navigator.language`
- `navigator.languages`
- `Accept-Language`
- `Intl` / locale 派生行为
- timezone / offset / date string
- geolocation
- WebRTC 全局模式效果

## Phase 2 Boundary

### Phase 2A: 模块拆分与可测试性

目标是把当前高耦合的大文件拆成原生可加载的小模块，并引入最小工具链支持测试与 lint。

设计约束：

- 保持 JavaScript，不升级到 TypeScript
- 允许引入最小工具链，但运行态仍保持原生扩展可加载
- 不依赖重型 bundler / transpiler

推荐的最小工程形态：

- `package.json`
- `eslint`
- Node 原生测试能力（推荐 `node --test`）或同等级别的最小单测方案
- 原生入口文件继续存在，例如 `background.js`、`main_spoof.js`、`options.js`、`popup.js`
- 通过 `importScripts`、多脚本加载顺序或其他原生可加载方式拆模块，而不是先引入打包链

优先拆出的边界应围绕纯逻辑：

- config 规范化 / 校验 / effective profile 解析
- domain matching
- geolocation / timezone 解析和诊断辅助
- message action 分发与页面探测辅助

### Phase 2B: 权限与注入边界收缩

这一步放在 2A 之后做，原因是当前运行边界与逻辑边界交织：

- `manifest.json` 的 `<all_urls>`
- `background.js` 注册的 `<all_urls>` content scripts
- `allFrames: true`
- `document_start` 全站注入

Phase 2B 的目标不是抽象优化，而是让权限与注入范围更贴近真实需要，同时保证：

- 白名单内行为不退化
- 非白名单副作用不增加
- 诊断链路仍可工作

## Compatibility And Migration Notes

- Phase 1 不应破坏现有配置导入导出格式
- Phase 1 不应新增复杂 UI，仅允许扩展诊断输出
- Phase 2A 即使拆模块，也应保留原入口文件或薄入口层，避免影响 manifest / HTML 页面加载方式
- Phase 2A 新引入的工具链应服务于开发与验证，不成为运行前置条件

## Rollback Shape

- Phase 1：如果真实 smoke 无法稳定复现问题，不做猜测式补丁
- Phase 1：如果新增 `Intl` 补丁引入站点兼容性问题，回退该接口级别补丁，而不是重开整个 Phase 1
- Phase 2A：如果模块拆分导致运行态加载复杂化或破坏原生可加载，回退工具链/模块边界设计，不强推
- Phase 2B：如果权限收缩导致白名单行为或诊断链路受损，按边界收缩点逐项回退，而不是回退整个 Phase 2A
