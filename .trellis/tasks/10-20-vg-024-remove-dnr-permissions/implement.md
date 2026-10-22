# VG-024 实施记录

## 授权、前置与状态

2026-10-20 用户明确确认“VG-028 人工验收通过，更新状态，然后按计划开始 VG-024；不提交、不发布”。VG-028 的稳定化 manifest 已置 `done`，Trellis 已置 `completed`，人工确认另记在其原实施记录；原 VG-023 `done` 和 VG-022 `in_progress` 不变。

依据输入实施计划第6节执行第二阶段权限退出，原文重用的产品契约 VG-023 前置对应本仓库 VG-028。VG-024 实现及本地验证完成后曾置 `review`；2026-10-20 用户确认人工验收通过，manifest 已置 `done`，Trellis 已置 `completed`。没有提交、push、打包发布、版本变更，也没有启动 VG-025/026。

分支为 `codex/vg-024-remove-dnr-permissions`，从已人工验收但尚未提交的 VG-028 工作树继续；Git HEAD 仍为 `de85aea`，并非 VG-028 的已提交快照。保留全部 VG-028 修改及用户先前文档新增/删除；没有 reset、stash、清空工作树或迁移到缺失未提交前置内容的 worktree。下面按 VG-028 临时源码快照比较本次增量，不能把相对 HEAD 的累计 diff 全部归给 VG-024。

## 实际变更

- manifest 仅删除 `declarativeNetRequest`、`declarativeNetRequestWithHostAccess` 两项权限。MV3、最低 Chrome 138、版本 2.1.1、host scope、userScripts 和其余权限不变；没有 optional DNR 或动态重新申请路径。
- 删除 `legacy-dnr-cleanup.ts`、专用清理测试与旧专用升级 runner。生产源码不再引用 DNR API、旧清理模块或 `legacyDnrCleanup` 组件。已有 marker 是惰性旧数据：不写入、不删除、不依赖，也不构成功能/迁移门槛。
- 后台继续使用现有唯一串行队列与副作用报告；同步组件只保留 `contentScripts`、`webrtc`、`tabReload`。Popup/Options 与共享 UI 不再展示旧清理状态，请求头保持浏览器原生值。
- schema3/config-model/config-resolver/storage、verified 边界、语言/时区 userScripts 注册与每文档快照、WebRTC policy 均没有本次增量。字体、Geolocation/Permissions geolocation、Worker/SharedWorker 生产暂停不变。
- 后台 mock 完全没有 DNR namespace；覆盖初始化、保存、禁用/启用、对账、新 worker 初始化，旧 marker 缺失/true/false 均不产生清理组件或新写入。权限 wiring、UI 测试与现行权限/隐私/安装/配置/发布/spec 同步。
- 新 `chrome-native-headers-upgrade.mjs` 支持经过 VG-028 清理与旧 v2 跳级两条同 profile／同路径升级。现有 production smoke 也不再读取候选 DNR API；其历史 JSON 和检查 ID 保留，不覆写旧证据。

源代码、测试及 runner 的本次增量共18个路径：

- `experiments/userscripts-document-start/production-smoke.mjs`
- `manifest.json`
- `scripts/chrome-acceptance.mjs`
- `scripts/chrome-legacy-dnr-upgrade.mjs`
- `scripts/chrome-native-headers-upgrade.mjs`
- `src/background/legacy-dnr-cleanup.ts`
- `src/background/services.ts`
- `src/options/options.html`
- `src/popup/popup.html`
- `src/shared/runtime-sync.ts`
- `src/shared/types.ts`
- `src/shared/ui-state.ts`
- `tests/background-services.test.ts`
- `tests/extension-wiring.test.ts`
- `tests/legacy-dnr-cleanup.test.ts`
- `tests/onboarding-ui.test.ts`
- `tests/runtime-sync-ui.test.ts`
- `tests/ui-state.test.ts`

权限文档、项目长期约束、现行 spec 和稳定化矩阵同步修改；VG-028 及更早清理/生成描述明确属于历史阶段。原输入计划和提示文档不改写。

## 本地验证

稳定生产候选使用现有 Node 24.16.0 与已安装依赖，无新增依赖：

| 检查 | 实际结果 |
|---|---|
| `git diff --check` | PASS；收尾记录更新后再次执行 |
| `npm run typecheck` | PASS |
| `npm run typecheck:tests` | PASS；主代理实际执行，独立审查未重跑或取得单独原始日志 |
| `npm test` | 200/200 PASS，0 fail、0 skipped |
| `npm run build` | PASS；构建内含 source typecheck，Vite 639ms |
| `npm run test:e2e:chrome -- --dry-run` | PASS，仅列出验收步骤，不等于真实 Chrome 通过 |
| 三个改动 runner 的 `node --check` | PASS：新升级 runner、chrome-acceptance、production-smoke |
| `git apply --reverse --check <本任务 source-changes.patch>` | PASS；仅核验可逆，不执行回滚 |

测试数量从已验收 VG-028 的207项到200项：删除5项清理专用测试、淘汰容量/重复清理等已退出合同，保留并补充无 API 运行的可观察合同。全部测试通过；未改变普通断言来容忍权限或同步失败。生产源码稳定后的修改只有 harness 就绪判定、文档与任务记录，不重复完整门禁。

## 真实 Chrome 升级证据

Chrome `155.0.8059.80`，使用 Chrome 自身 sandbox 的临时 headless profile，通过 `Extensions.loadUnpacked` 在同一 staged 路径替换扩展，package version 不变；未使用用户日常 profile。旧 v2 构建来自 `de85aea` 的独立临时源码构建，VG-028 对照为本次开始前的实际已验收 dist 快照。

| 路径 | 结果 | 权限删除前的受管旧规则 |
|---|---|---|
| 已清理 VG-028 → VG-024 | [9项 PASS](chrome-from-vg028.json) | 实际清理并确认0条，范围外对照保留 |
| 旧 v2 跳过清理 → VG-024 | [9项 PASS](chrome-from-v2.json) | 1条有效旧规则，升级前实际改写 header |

两条路径均核验：manifest 只减两项权限；实际 runtime permissions 和 DNR API 缺失；候选请求头与原生内存基线相等；v2→v3 自定义字体名单迁移；改变语言配置两次仍保持原生 header；UI 无清理组件且报告只有三项；关闭管理页后实际 stop/wake worker，恢复仍无 DNR 依赖。

调试中曾出现旧 worker discovery→attach target 消失，以及升级后管理页短暂空白文档导致的表达式失败。前者只重试明确的只读协议竞态，后者改为等待完整且 URL 匹配的文档；未改变生产逻辑、权限或验证断言来绕过失败。最终两条正式 JSON 均 PASS、failure=null、cleanup=PASS。

**磁盘残留仍为 UNKNOWN。** 无权限候选不调用 DNR，也没有临时重新授予权限来读取规则。旧 v2 跳级的旧规则可能留在磁盘；证据证明当前无权限且请求头原生，不能宣称旧规则已删除。本版本不会重新申请 DNR；未来重新引入必须独立授权并设计清理迁移。

本次没有开启 Allow User Scripts，不证明语言/时区首 inline、完整页面恢复或字体生产恢复；相关生产逻辑本次未变。未执行 Linux production smoke、Chrome138/Edge 矩阵或商店分发更新；这些不能由 dry-run、Node 或 Chrome155 unpacked 定向升级推断通过。

## 独立复核

fresh `critical_reviewer` 以 VG-028 源码快照审查本次增量，读取原始测试/构建/dry-run及两条 Chrome 证据，未修改文件或重复门禁。没有确认生产阻断；指出 RELEASE 和两份现行 spec 的4处旧 DNR 表述，已逐项修正，README 与稳定化历史标题也已同步。独立复核未单独验证测试 typecheck、Chrome138/Edge 或商店分发。

Audit Bundle 已关闭且 `audit-verify` PASS，无异常；`audit_id=20261020T081436Z-vg-024-remove-dnr-permissions-f33333cd`。执行摘要统计仅属于本次 VG-024 的1次独立只读复核，不混入 VG-028 历史代理。

## 数据流、恢复与资源

升级 fixture 仅通过 loopback 返回 `Accept-Language`，原生/改写值只在内存比较，正式 JSON 只存布尔、计数和结果摘要；不存完整 header、公网 IP、documentId、精确位置、个人路径或配置。未主动请求 provider、第三方检测站或 STUN。没有监控 Chrome 自身所有后台网络；目标服务器在实际浏览时仍能看到正常出口和原生请求头，网页语言可与之不同。

[source-changes.patch](source-changes.patch) 是相对已验收 VG-028 源码基线的正式增量恢复文件，包含被删除的前置未提交文件，采用相对路径且已反向 dry-check。它仅覆盖上述源代码/测试/runner/manifest，不包含文档、任务状态或用户既有文件；不能直接当作全部工作树回滚命令。恢复须先识别后续变化并取得相应授权，文档另按本记录审查。返回 VG-028 会重新声明过渡 DNR 权限，需人工评估重新授权/兼容；不得静默返回旧 v2 恢复请求头修改。

两条 Chrome runner 均退出并清除自己的临时 profile、fixture listener 和 CDP 会话。当前任务另建的源码快照、旧构建及临时日志在保留必要正式证据/增量补丁后删除；复用依赖和用户原有文件保留。`dist/` 是供人工加载的被忽略本地候选产物，未直接修改或发布。最终工作树含 VG-028 与 VG-024 的预期累计修改，没有暂存或提交。

## 2026-10-20 人工验收

用户明确确认：“VG-024 人工验收通过，更新状态”。据此将稳定化 manifest 从 `review` 更新为 `done`，Trellis 从 `review` 更新为 `completed`，记录确认日期和证据引用。VG-028、原 VG-023 与 VG-022 状态不变。

本次仅更新状态和现行文档提示，未修改生产代码、测试、配置或构建输入，复用前述通过的验证证据，不重复运行测试或构建。人工确认保留既有证据层级与限制，包括磁盘旧规则 `UNKNOWN`；没有扩展到 Chrome138/Edge、商店分发或字体生产恢复。未提交、推送、发布、归档，也未启动 VG-025/026。
