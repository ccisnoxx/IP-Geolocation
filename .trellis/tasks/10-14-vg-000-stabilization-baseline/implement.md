# VG-000 执行与证据

## 执行工作项

1. 检查 Git、适用指令、Trellis 生命周期和现有稳定化文件；输出 13 项 preflight。
2. 运行实际基线检查，通过后使用 `task.py create` 创建本任务。
3. 建立 manifest 的 planned 记录，切换 VG-000 为 in_progress，并用 `task.py start` 激活本任务。
4. 校准长期规范、README、ignore 例外和验收矩阵；不实现后续任务。
5. 检查文档、依赖、范围和摘要；验证成功后同步 manifest/task.json 为 review。

## 基线检查（2026-10-14，提交 5701b55）

| 精确命令 | 实际结果 | 证据范围 |
|---|---|---|
| `git status --short` | 只有两项既有未跟踪图标 | 不包含用户已修改的已跟踪文件 |
| `git branch --show-current` | `stabilize/VG-000` | 未切换分支 |
| `git log -1 --oneline` | `5701b55 feat: add explicit exit location profiles` | 当前本地基线 |
| `npm run typecheck` | exit 0，`tsc --noEmit` | src TypeScript 静态检查 |
| `npm test` | exit 0，58 tests / 58 pass / 0 fail / 0 skipped | Node、VM、Chrome mocks 和静态 wiring |
| `npm run build` | exit 0，Vite 5.4.21，23 modules，静态复制 12 items | 五个入口及共享 chunks 实际产出 |

没有基线失败；无需判断失败归属或修复功能。文档变更不改变上述检查输入，完成时复用证据而不无变化重跑。

## 摘要基线

- 65 个运行时/测试/静态资源/构建输入文件的 SHA-256 集合摘要：`9f3062911045926250940bb38030286c1ba510a9872ec182b24223cbe3c8a795`。
- 38 个 dist 文件的 SHA-256 集合摘要：`fc7df7bb4ebdb3cc9aae5511e45a5126ee41cb894d5dcc56dbaf717d26cefbce`。
- 既有两个未跟踪图标单独在会话内记录摘要，结束时核对，未把图像纳入本任务。

## 完成验证

| 检查/命令 | 实际结果 |
|---|---|
| `git diff --check` | exit 0，无 whitespace 错误；新文件另由内联检查覆盖 |
| `python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-14-vg-000-stabilization-baseline` | exit 0，implement.jsonl/check.jsonl 各 6 项有效引用 |
| `node scripts/chrome-acceptance.mjs --dry-run` | exit 0，dist 必需文件与人工验收清单可用；未启动 Chrome，未执行浏览器断言 |
| 内联 Python + 已安装 Ruby/Psych YAML 检查 | 15 项任务字段/状态/依赖/阶段与无环检查通过；16 项交付、19 项本地链接、换行/空白、敏感模式与 ignore 作用域通过 |
| 输入/产物/既有图标 SHA-256 集合比较 | 65 项输入、38 项 dist 文件与两个图标均和基线完全一致 |
| 实际 diff / `git status --short --untracked-files=all` | 仅 16 项本任务治理交付和两个既有图标；无 staged 文件，无 runtime/API/权限/构建输入变化 |

内联文档检查首次发现 task.py 生成的 task.json 缺少文件末尾换行；补齐换行后通过。该问题属于本任务新记录格式，不是产品基线失败，也没有通过运行时修改消除。

manifest 状态实际经历 `planned → in_progress → review`；Trellis 经 create/start 从 `planning → in_progress`，本地验证后同步 `review`。completedAt 为 null；人工验收未执行，未标记 done/completed。最终状态写入后再次检查文档依赖/范围/whitespace 和 JSONL 引用，不重复运行输入未变化的 Node/typecheck/build。

## 未执行与限制

真实 Chrome 安装、DNR、WebRTC ICE、frame/worker、MV3 重启、迁移中断和发布人工验收未执行；VG-000 无运行时改动，矩阵记录该缺口，dry-run 不补足它。PRIVACY.md 缺失和诊断 URL 传递预期值属于待审查范围，本次未修复。

`dist/` 是已有构建输出目录，本次 build 生成的文件作为可复核产物保留并继续忽略；无本任务后台进程、端口或临时浏览器 profile。未提交、push、merge、打 tag、发布或移动旧任务。

## 人工验收

2026-10-14，验收人：用户。用户在当前任务对话明确确认：“VG-000 已通过我的人工验收”，并要求将 manifest 更新为 done、同步 Trellis 验收记录及继续 VG-001。

据此将 manifest 的 VG-000 从 review 改为 done；本任务 task.json 同步为工具原生 completed，completedAt 为 2026-10-14。以上是用户人工验收确认，不补写未提供的浏览器版本、操作或观测结果，也不将 VG-000 的治理验收扩展为后续功能验收。原有本地验证与 review 交付描述保留为历史证据。本次不归档、不提交、不推送。
