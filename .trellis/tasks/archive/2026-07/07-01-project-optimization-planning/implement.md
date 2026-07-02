# 项目优化规划 implementation plan

## Ordered Checklist

1. 完成父任务规划收敛。
   - 保持当前 task 作为父任务，承载总范围、阶段顺序和验收边界
   - 用最终 PRD / design / implement 作为后续实现任务的来源
   - 通过 review 后再决定是否创建子任务并启动执行

2. 准备 Phase 1 子任务。
   - 子任务目标：行为一致性与真实 smoke 验证
   - 复用当前配置模型，不新增语言自动推导或新 UI 配置
   - 复用现有 smoke 站点矩阵

3. 执行 Phase 1 的实现顺序。
   - 先扩 `main_spoof.js` 中与 `language` / `timezone` 相关的 `Intl` 默认 locale 行为
   - 再扩 `background.js` / `test.html` 的本地诊断输出
   - 然后做真实 Chrome + 外部站点 smoke
   - 如发现问题，只修复确认缺陷路径和最小必要诊断补强

4. 准备 Phase 2A 子任务。
   - 引入最小开发工具链
   - 保持运行态原生可加载
   - 只做 JavaScript 层面的模块拆分与测试能力建设

5. 执行 Phase 2A 的实现顺序。
   - 先建立 `package.json`、lint、最小测试入口
   - 再抽纯逻辑模块
   - 再给纯逻辑模块补单测
   - 最后清理高耦合入口文件中的重复逻辑

6. 准备并执行 Phase 2B 子任务。
   - 在已有测试/验证基础上审视权限与注入边界
   - 优先收缩真正过宽的运行范围
   - 每次收缩后都复跑白名单、非白名单、诊断链路验证

## Phase 1 Validation

### Static / local checks

- `node --check config.js`
- `node --check background.js`
- `node --check popup.js`
- `node --check options.js`
- `node --check content.js`
- `node --check main_spoof.js`

### Local diagnostic checks

- `test.html` 中能看到新增 7 个 `Intl` 接口的可见输出
- 本地诊断页读到的 locale/timezone 派生行为与当前有效配置一致

### Real Chrome smoke

- 白名单站点：`chatgpt.com`、`claude.ai`、`gemini.google.com`
- 检测站点：`browserleaks.com`、`whoer.net`
- 至少一个非白名单普通站点

记录口径固定为：

- allowlist 命中状态
- `navigator.language`
- `navigator.languages`
- `Accept-Language`
- timezone / offset / date string
- 新增 7 个 `Intl` 接口的默认 locale 行为
- geolocation
- WebRTC 模式效果

## Phase 2A Validation

推荐最小验证命令：

- `npm run lint`
- `npm test`
- 如入口文件有改动，继续保留 `node --check` 作为最小静态回归

单测优先覆盖：

- `config.js` 中可抽离的规范化 / 校验 / effective profile 解析
- domain matching
- geolocation / timezone 解析辅助
- 与 locale/timezone 补丁相关的纯辅助函数

## Phase 2B Validation

- 白名单 smoke 不退化
- 非白名单页面仍不出现额外页面级副作用
- `test.html` / 诊断页仍能正确读取目标页面状态
- 权限或注入收缩后，配置保存、popup 展示、runtime message 流程不回归

## Risky Files

- `main_spoof.js`
  - 改动会直接影响页面主世界行为
- `background.js`
  - 同时承载 DNR、WebRTC、注入、diagnostic、message action
- `config.js`
  - 影响导入导出、校验、匹配、effective profile
- `manifest.json`
  - 影响权限、入口和运行方式
- `test.html`
  - Phase 1 诊断补强会改这里，容易把调试需求和产品需求混在一起

## Decision Gates

- Gate A：没有真实 Chrome smoke，就不把 Phase 1 视为完成
- Gate B：检测站整体不必全绿；只验证本项目负责维度
- Gate C：Phase 1 不新增“按 IP 自动推语言”
- Gate D：Phase 1 不新增独立 locale 配置系统
- Gate E：Phase 2 不升级 TypeScript，不引入重型 bundler/transpiler
- Gate F：Phase 2B 不在 2A 之前启动

## Rollback Points

- 如果 Phase 1 扩的某个 `Intl` 接口补丁引发兼容性问题，回退该接口级改动
- 如果 `test.html` 诊断扩展开始演变成测试平台，收回到“最小必要可见诊断”
- 如果最小工具链开始侵入运行态，回退工具链集成方式，保留原生加载
- 如果权限收缩引发白名单回归，先回退边界收缩，再分析是否缺少测试或模块边界支撑

## Follow-up Before `task.py start`

- 审阅父任务三份规划文档是否完整反映当前决策
- 确认是否把当前父任务拆成三个子任务后再执行
- 选定 Phase 2A 的最小工具链方案（推荐：`eslint` + Node 原生测试）
