# VG-000 设计

## 权威与状态

`docs/stabilization/task-manifest.yaml` 是跨任务依赖、范围、阶段和状态的唯一事实来源。Trellis 沿用 `task.py create` 生成的 task.json/PRD/JSONL 结构，补充 design.md 和 implement.md 保存执行证据，不建立第二个 backlog。

manifest 使用 `planned → in_progress → review → done`；依赖只接受人工验收后的 `done`。Trellis 工具规划状态为 `planning`，本任务执行/交付状态同步为 `in_progress`/`review`；人工验收后可使用工具原生 `completed` 对应 manifest 的 `done`。当前不调用 archive，不设置 completedAt，不移走历史任务。

VG-001 至 VG-014 是本次按现有实现和验收面建立的待实施清单，不表示已有缺陷已确认，也不自动授权实现。后续任务应在保持 ID 可追溯的前提下细化自己的 PRD、设计和证据。

## 文档所有权

- AGENTS 只写长期仓库边界；任务特有清单、阶段、证据和流程放 stabilization 文档。
- directory-structure 描述源码、构建入口和实际输出；quality-guidelines 描述验证层级与浏览器边界，state-management 继续拥有 schema v2/verified 事务合同。
- spec/index 将目录规范从待定制模板提升为有效入口；现有 state-management 正文不修改，只让 Git 可纳入它。
- README 修正出口检测描述并链接稳定化入口，不增加运行时功能。
- `.gitignore` 仅放行前端有效规范和本次任务的六个维护文件；其余 Trellis 工作区、工具、旧本地任务保持忽略。

## 实现依据

`package.json` 定义 tsc/tsx/Vite 命令；`vite.config.ts` 定义五个 TS 入口、HTML/manifest/fixtures/icons/LICENSE/NOTICE 静态拷贝。当前 Vite 5.4.21 构建实际输出共享 `dist/assets/*.js` chunks，配置中的内联注释不能代替真实产物证据。

`storage.ts` 迁移到 schema v2；`config-model.ts` 归一化；`config-resolver.ts` 匹配及解析。`services.ts` 负责配置修改队列、检测确认、动态脚本注册、DNR/WebRTC 和 sender 文档注入；`message-router.ts` 校验扩展管理页身份。自包含 `applyVanishGeoRuntime` 被打包到后台，通过函数参数注入 MAIN world，没有独立 runtime 入口或 web-accessible 配置桥。

各 frame 按可信 sender 单独解析；当前没有父页面遍历/劫持 iframe 创建以替代文档注入。Worker wrapper 具有同源 HTTP(S) 边界，module 路径先执行 bootstrap 再动态 import；CSP、复用、失败降级和资源生命周期的真实 Chrome 行为留在后续验收中。

## 验证与回滚

基线先执行 typecheck、npm test、build。文档完成后复用未改变输入的通过结果，另做 whitespace、manifest 结构/依赖/链接和范围检查。运行 Chrome 脚本 dry-run 仅验证入口；真实浏览器验收留为明确未执行项。

对源码/测试/fixture/构建输入、dist 文件和既有图标记录会话内摘要，完成后比较。摘要只保存总 digest，不把个人路径或测试响应写入仓库。不新增测试框架或生产依赖。

回滚仅撤销本任务文档和 ignore 例外，移除可归属的新治理记录；不使用 reset/clean，不触碰既有文件、历史归档、浏览器 storage 或远端。若发现现有功能问题，记录为后续任务证据，不在 VG-000 修复。
