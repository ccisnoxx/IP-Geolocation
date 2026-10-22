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

- 保持 Chromium Manifest V3、最低 Chrome 138。仅从 config-model / config-resolver 的启用 allowlist 规则派生 userScripts 的 HTTP(S) matches / excludeMatches，保持最长域名优先级；固定自包含模板加安全 JSON 最小语言/时区或定位 payload（独立入口），在 MAIN / document_start 提前注册。需要 userScripts 权限和用户正常开启 Allow User Scripts；不可用时 fail closed，无 content 初始化消息、documentId executeScript 或页面桥回退。注册更新串行，先撤销失效/范围变化，再更新，最后新增并验证；worker 初始化与 onInstalled(update) 恢复。每文档快照、不热更新、不自动 reload。仅普通 HTTP(S) 顶层/iframe；VG-029地理位置恢复已于2026-10-22获用户明确授权，最小定位payload、三方法及合成权限语义独立验证；VG-033于2026-10-23获用户明确授权仅本页创建的Dedicated Blob Worker语言/时区同步，HTTP(S)/SharedWorker/外来Blob Worker继续暂停，限定嵌套Blob见下述VG-034授权，其他文档 unsupported / UNKNOWN。VG-025固定内置名单字体过滤已于2026-10-20获用户明确授权：仅总开关/字体开关/HTTP(S) allowlist均启用且vendor-software模式时派发包内单文件MAIN/document_start/allFrames，不使用动态payload、storage读取或页面桥；custom继续暂停，旧hook/BFCache须完整重建。
- `src/shared/config-model.ts`、`config-resolver.ts`、`storage.ts` 分别拥有配置归一化、匹配/解析、迁移/持久化；不得新增平行域名匹配器或配置事实来源。auto 信号只使用规则显式绑定的 verified 出口档案；verified 身份只能由后台检测确认事务建立。
- VG-032已于2026-10-22获用户明确授权恢复必要DNR权限：仅declarativeNetRequestWithHostAccess，默认静态allow先隔离，清理并读回1001、1002、1100至2099后，dynamic 40000..49999从同一有效语言payload派生Accept-Language；2026-10-22用户另行明确授权持久化投影和写前隔离，旧session30000..39999独立迁移，dynamic30000及session40000仍未知；首次接管新范围须为空且记录所有权版本。所有可能迁移/修复/变更配置的读取和写回占同一队列，先持久隔离再写影响投影的配置，稳态冷启动不重复隔离；范围外冲突规则保留并报告，其他请求头原生。导航按目标域、子资源按发起域，最长域名优先且关闭子规则排除父规则。与userScripts同队列、先页面确认再解除隔离；旧文档/BFCache需完整重载，不宣称跨API原子同步。WebRTC由Chrome privacy API管理。权限、host scope、错误校验和verified边界不得放宽；权限变更须同步PERMISSIONS.md及wiring测试，并取得对应任务授权。
- 页面伪装与反检测注册集中在 `src/injected/runtime.ts`。未有目标检测证据和独立任务授权，不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等设备指纹伪装面。字体仅做选择性暴露过滤维护源，固定内置名单包含16项厂商／软件及2026-10-22用户授权加入的27项简繁中文字体，仍仅总开关／字体开关／HTTP(S) allowlist均启用时生效，不改 Canvas 绘制、像素或图像导出；完整 runtime 仍不生产派发，保留已验收语言／时区专用 userScripts。保持未接管浏览器 API 的原生透传。
- 维护源在 `src/`，TypeScript/Vite 输出到 `dist/`；不直接修改构建产物。任务收尾至少执行或复用输入未变化的 `git diff --check`、`npm run typecheck`、`npm test`、`npm run build` 证据，并按实际边界选择定向验证。Node、VM、静态检查和 Chrome 脚本 dry-run 不得表述为真实 Chrome 验收。
- 不把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。采用合成、脱敏数据；诊断与外部请求变更须说明实际数据流和隐私边界。
- 稳定化任务的依赖、范围和状态以 `docs/stabilization/task-manifest.yaml` 为唯一跨任务事实来源。开始前检查依赖全部为 `done`，实施时标记 `in_progress`；实现及本地验证结束后只能标记 `review`，人工验收后才可标记 `done`。Trellis 任务记录保存执行证据并同步状态；历史归档状态不得冒充当前稳定化验收。每次只实施当前获授权任务，不因清单存在而启动后续任务；不自行 push、merge、打 tag 或发布。

- VG-034已于2026-10-23获用户明确授权：仅已同步Blob Dedicated Worker链中各realm自身新建Blob子Worker递归继承同一语言/时区快照；HTTP(S)、SharedWorker、外来Blob与未接管父级仍未覆盖。沿用VG-033安全及生命周期限制；2026-10-23用户人工验收通过并授权本次本地提交，不推送。
