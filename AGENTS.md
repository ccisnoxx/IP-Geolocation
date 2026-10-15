<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# VanishGeo 长期仓库约束

- 保持 Chromium Manifest V3。仅从启用的 allowlist 规则派生动态 content script matches；ISOLATED content script 只通知后台初始化。后台从可信 `MessageSender` 和配置解析 payload，使用 `documentId` 定向执行自包含 MAIN-world runtime。不得增加静态全站注入、页面可控配置桥或信任网页提供的配置/预期值。
- `src/shared/config-model.ts`、`config-resolver.ts`、`storage.ts` 分别拥有配置归一化、匹配/解析、迁移/持久化；不得新增平行域名匹配器或配置事实来源。auto 信号只使用规则显式绑定的 verified 出口档案；verified 身份只能由后台检测确认事务建立。
- `src/background/dnr.ts` 从同一配置解析有效语言并管理 DNR；WebRTC 由 Chrome privacy API 管理。权限、host scope、错误校验和 verified 边界不得为通过测试而放宽。权限变更须同步 `PERMISSIONS.md` 和相关 wiring 测试，并取得对应任务授权。
- 页面伪装与反检测注册集中在 `src/injected/runtime.ts`。未有目标检测证据和独立任务授权，不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等设备指纹伪装面。保持未接管浏览器 API 的原生透传。
- 维护源在 `src/`，TypeScript/Vite 输出到 `dist/`；不直接修改构建产物。任务收尾至少执行或复用输入未变化的 `git diff --check`、`npm run typecheck`、`npm test`、`npm run build` 证据，并按实际边界选择定向验证。Node、VM、静态检查和 Chrome 脚本 dry-run 不得表述为真实 Chrome 验收。
- 不把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。采用合成、脱敏数据；诊断与外部请求变更须说明实际数据流和隐私边界。
- 稳定化任务的依赖、范围和状态以 `docs/stabilization/task-manifest.yaml` 为唯一跨任务事实来源。开始前检查依赖全部为 `done`，实施时标记 `in_progress`；实现及本地验证结束后只能标记 `review`，人工验收后才可标记 `done`。Trellis 任务记录保存执行证据并同步状态；历史归档状态不得冒充当前稳定化验收。每次只实施当前获授权任务，不因清单存在而启动后续任务；不自行 push、merge、打 tag 或发布。
