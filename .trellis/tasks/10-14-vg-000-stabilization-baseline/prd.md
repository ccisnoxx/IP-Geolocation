# VG-000：建立稳定化执行基线并校准仓库规范

## 目标与授权

发布阶段 R0，无依赖。用户已授权实现和本地验证；交付状态为 `review`，人工验收后才能进入 `done`。只实施 VG-000，不修复功能或推进后续任务。

## 基线与差异

- 初始分支 `stabilize/VG-000`，基线提交 `5701b55`（`feat: add explicit exit location profiles`）。
- 初始工作树只有未跟踪的 `images/icon-concept-v2.png`、`images/icon-master.svg`；两者属于既有工作，必须保留。
- 根和目标路径没有附加 `AGENTS.override.md` 或嵌套 `AGENTS.md`；读取了根 AGENTS、适用全局规则、Trellis 工作流、相关 spec、当前任务历史记录、实现和测试。
- `docs/stabilization/` 及等价 manifest 不存在，VG-000 负责创建；没有依赖阻塞。
- 当前实现为 TypeScript + Vite + MV3，旧目录/质量规范仍描述根 JS、无 bundler、全局/CommonJS 双导出和父页面 iframe 传播。
- README 的自动定位缓存描述已落后于显式出口档案；`PRIVACY.md` 不存在，隐私说明留给 VG-002。
- 既有 schema v2 状态管理 spec 有效但被 Git 忽略，需要与规范索引一起纳入治理交付。

## 必须交付

- 根 AGENTS 保留 Trellis 管理块，追加长期运行时、配置、权限、验证、敏感数据和任务状态约束。
- 校准前端目录、质量规范及索引；保留有效浏览器边界，纳入现有状态管理合同。
- 建立唯一 `task-manifest.yaml`，包含 VG-000 至 VG-014 的 ID、标题、阶段、依赖、分支、状态、范围和验收。
- 验收矩阵覆盖配置持久化、诊断隐私、DNR、WebRTC、MAIN-world、iframe、Worker/SharedWorker、首次安装、迁移和发布。
- 保存实际基线结果及证据层级；准确区分 Node/VM、dry-run 和真实 Chrome。
- 通过最小 `.gitignore` 例外使治理文件可审查，不暴露无关本地任务、会话或缓存。

## 验收条件

- [x] 规范与当前 package.json、vite.config.ts、入口和 dist 输出一致。
- [x] 15 个任务的依赖和状态可判定，除 VG-000 外全部为 planned。
- [x] 最低验证命令都有实际结果，未执行浏览器验收明确报告。
- [x] src、manifest、公开 API、权限、依赖、构建配置和行为没有变化。
- [x] 原有图标文件和历史任务未被覆盖、删除或移动。
- [x] 本地验证交付时 manifest 与本任务 task.json 都为 review，completedAt 保持 null。
- [x] 2026-10-14 用户确认人工验收通过；manifest 为 done，task.json 为 completed，验收证据见 implement.md 的“人工验收”。

## 范围外与停止条件

功能修复、运行时注入、默认配置、版本号、权限、迁移执行、生产依赖、Git 历史重写、历史归档移动和远端操作均不授权。仅在实际依赖未完成、不可消解合同冲突、未批准破坏性操作/外部授权、安全隐私边界必须改变，或无法区分的阻塞性基线失败时标记 blocked。
