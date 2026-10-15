# VanishGeo Codex 稳定化任务提示词包

适用仓库：`ccisnoxx/IP-Geolocation`

在本地仓库根目录执行 `VANISHGEO_REPO="$(pwd)"`，示例 shell 使用该变量；提交的任务记录使用仓库相对路径。建议按顺序执行；每个任务使用独立分支和新的 Codex 会话。后续任务只从已经人工接受并合并的代码、`docs/stabilization/task-manifest.yaml` 和 `.trellis` 记录获取上下文，不依赖前一个聊天会话的记忆。

## 总体执行规则

1. 先完成 VG-000，建立 `AGENTS.md`、稳定化 manifest 和与当前实现一致的 `.trellis/spec`。
2. 每个任务开始前，依赖任务必须在 manifest 中为 `done`。
3. 开始实施时把本任务标记为 `in_progress`；实现与本地验证完成后标记为 `review`。
4. Codex 不得自行标记 `done`、merge、push、创建 tag 或发布 Release。
5. 人工验收后使用本文末尾的统一收尾提示词，再提交/合并。
6. 未实际运行的测试必须标为“未运行”，不得推断为通过。
7. 一旦发现需要改变既定安全边界、破坏性迁移或未批准的范围扩张，停止并标记 `blocked`。

## 模板与当前任务清单

本文件保留任务提示词模板，**不是任务范围、依赖或状态的第二份来源**。当前信息只读取 [task-manifest.yaml](stabilization/task-manifest.yaml)。启动任何任务前先按 manifest 与用户本次授权校准模板中的阶段、依赖、范围和结束状态；不得仅凭后续章节标题实施任务。

VG-000～VG-004 已按用户明确请求校准。后续章节仍是早期建议，可能与 manifest 不同，不表示已接受实施合同或授权。本次 VG-004 只清理个人路径和旧项目信息，不改变后续任务定义。

## VG-000 — 建立稳定化执行基线并校准仓库规范

| 字段 | 内容 |
| --- | --- |
| 阶段 | R0 |
| 依赖 | 无 |
| 建议分支 | `stabilize/VG-000` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-000
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-000：建立稳定化执行基线并校准仓库规范**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-000`
发布阶段：`R0`
依赖任务：无
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

建立后续 Codex 任务可依赖的、与当前 TypeScript/Vite/MV3 实现一致的治理基线；修正过时的 `.trellis` 规范，并创建稳定化任务清单。不得改变扩展运行时行为。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。

此任务负责创建稳定化 manifest，因此不要因为 `docs/stabilization/task-manifest.yaml` 尚不存在而阻塞。开始时先检查是否已有等价文件；若存在，兼容合并而不是建立第二套事实来源。


## 长期不变量

- 一次只实现 VG-000，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- 根 `AGENTS.md`（若已存在则审慎合并，不覆盖本地有效约束）
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `docs/stabilization/README.md`
- `docs/stabilization/task-manifest.yaml`
- `docs/stabilization/acceptance-matrix.md`
- 本任务对应的 `.trellis/tasks/...` 记录

## 必须交付

- 根 `AGENTS.md` 只保存长期稳定的仓库约束：MV3 动态注入边界、单一配置模型、禁止新增无证据的指纹面、测试要求、敏感数据规则、任务状态规则。
- 把 `.trellis/spec` 中“无 bundler、根目录 JS 入口”等旧描述更新为当前 TypeScript + Vite + `src/` + `dist/` 架构；保留仍然有效的浏览器边界要求。
- 创建 `docs/stabilization/task-manifest.yaml`，列出 VG-000 至 VG-014，字段至少包含：id、title、phase、dependencies、branch、status、scope、acceptance；初始状态除 VG-000 外均为 `planned`。
- 创建验收矩阵，覆盖配置持久化、诊断隐私、DNR、WebRTC、MAIN-world 注入、iframe、Worker/SharedWorker、首次安装、迁移和发布流程。
- 记录当前基线测试的实际结果，不得把未执行测试写成通过。
- VG-000 实施结束时在 manifest 中标记为 `review`，不得自行改为 `done`。

## 验收条件

- 规范文件不再与 `package.json`、`vite.config.ts`、当前目录结构矛盾。
- 后续每个任务都能通过 manifest 明确判断依赖与状态。
- 本任务不改变 `src/`、`manifest.json`、构建产物行为或公开 API。

## 明确范围外

- 不修复任何功能缺陷。
- 不修改 manifest 权限、默认配置、运行时注入或发布版本号。
- 不重写 Git 历史，不移动现有归档任务。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-001 — 保留已禁用站点规则并统一规则编辑语义

| 字段 | 内容 |
| --- | --- |
| 阶段 | R1 |
| 依赖 | VG-000 |
| 建议分支 | `stabilize/VG-001` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-001
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-001：保留已禁用站点规则并统一规则编辑语义**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-001`
发布阶段：`R1`
依赖任务：VG-000
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

修复 Popup 或 Options 保存任意设置时静默删除 `enabled: false` 规则的问题，并建立唯一、可测试的文本规则编辑语义。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-001，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/popup/popup.ts`
- `src/options/options.ts`
- 建议新增 `src/shared/rule-list.ts` 或等价共享模块
- `src/shared/config-model.ts` / `config-resolver.ts`（仅在确有必要时）
- `tests/config.test.ts`、新增规则列表单元测试、相关 wiring 测试

## 必须交付

- 把 Popup 与 Options 重复的文本规则解析/合并逻辑提取为共享纯函数。
- 文本框继续表示“当前启用规则域名集合”；未显示的禁用规则必须保留。
- 把已禁用域名重新写入文本框时，应复用原规则 ID、overrides 和出口档案绑定并重新启用。
- 从文本框移除一条当前启用规则时，保持现有产品语义：删除该启用规则；不得顺带删除其他禁用规则。
- 保存语言、时区、画布、坐标等无关设置时，规则数组不得发生非预期变化。
- 为重复域名、空行、大小写、URL 输入、禁用规则重新启用、无关保存等场景补充测试。

## 验收条件

- 给定一条 `enabled:false` 规则，修改任意非规则设置并保存后，该规则仍存在且仍为 disabled。
- 重新启用禁用规则时保留原 ID 和配置。
- Popup 与 Options 使用同一实现，不出现第二套规则合并逻辑。

## 明确范围外

- 不重新设计整套规则 UI。
- 不改变域名匹配算法、默认规则、DNR 语义或存储 key。
- 不实现 optional host permissions。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-002 — 移除诊断 URL 中的敏感预期值

| 字段 | 内容 |
| --- | --- |
| 阶段 | R1 |
| 依赖 | VG-000 |
| 建议分支 | `stabilize/VG-002` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-002
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-002：移除诊断 URL 中的敏感预期值**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-002`
发布阶段：`R1`
依赖任务：VG-000
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

立即消除外部诊断 URL 对精确坐标、语言、时区、Accept-Language 和 WebRTC 预期值的泄露；本任务允许诊断页暂时退化为明确标注的 observation mode。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-002，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/background/services.ts`
- `src/leak-test/leak-test.ts` / `.html` / `.css`
- `src/shared/diagnostic.ts`
- `tests/background-services.test.ts`
- `tests/diagnostic.test.ts`
- `tests/extension-wiring.test.ts`

## 必须交付

- 删除或停用 `appendExpectedProfileParams()` 一类把精确预期数据写入 URL 的实现。
- `openDiagnosticPage()` 打开的外部 URL 不得包含纬度、经度、语言、时区、Accept-Language、WebRTC 预期策略或 locale 预期结果。
- 外部 leak-test 页面只展示实际观测值，并清楚标注 observation mode；不得声称在没有扩展侧预期值时完成 PASS/FAIL 验证。
- 删除依赖敏感 query 参数的代码、测试和文案，但保留普通 HTTP(S) 页面上的观测能力与 header echo 能力。
- 确保 URL、页面日志、控制台日志和错误文本中不出现精确预期位置配置。
- 文档只做本任务必需的最小同步；完整扩展侧验证由 VG-003 实现。

## 验收条件

- 测试断言诊断 URL 不含任何 `expected*` 敏感参数。
- 外部页面仍可观察实际 language/timezone/geolocation/WebRTC/header 数据，但不会接收扩展的预期配置。
- 没有通过 `window.postMessage` 或页面可控消息桥向扩展提交配置。

## 明确范围外

- 本任务不实现新的扩展侧报告页面；由 VG-003 完成。
- 不改变正常站点的伪装行为。
- 不把敏感值改放到另一个普通 query 参数、路径、cookie 或外部存储中。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-003 — 实现扩展侧诊断验证与报告

| 字段 | 内容 |
| --- | --- |
| 阶段 | R1 |
| 依赖 | VG-002 |
| 建议分支 | `stabilize/VG-003` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-003
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-003：实现扩展侧诊断验证与报告**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-003`
发布阶段：`R1`
依赖任务：VG-002
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

在不把预期配置暴露给外部页面的前提下，恢复可操作的 PASS/FAIL 诊断。预期值和比较逻辑必须留在扩展受信任边界内。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-003，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/background/services.ts`
- `src/background/message-router.ts`
- `src/shared/diagnostic.ts` / `types.ts`
- 新增扩展侧 diagnostic/report 页面及其 TS/CSS/HTML
- `vite.config.ts`
- `src/leak-test/*` 与本地 header echo 服务
- 后台、诊断、wiring 与真实 Chrome 验收测试

## 必须交付

- 设计并实现一次性诊断 run：背景页持有预期配置、run ID、TTL 和状态；run 状态只存在内存或 `chrome.storage.session`。
- 通过 `chrome.scripting.executeScript` 在目标文档 MAIN world 定向收集实际值；不得建立页面可控 `postMessage` 配置桥。
- Accept-Language 通过普通目标 origin 的 header echo 观测；WebRTC 同时报告浏览器策略状态和可获得的 ICE 观测。
- 扩展 origin 的报告页负责比较和显示 PASS/FAIL/UNKNOWN；外部目标页只提供实际观测。
- 诊断结束、过期或取消后清理 session 状态；不得长期保存精确坐标或公网 IP 诊断快照。
- 保留 hosted 与 localhost 两种目标工作流，并对未 allowlist、无法注入、权限受限和页面已导航等情况给出明确状态。
- 构建配置不得把报告页设为不必要的 `web_accessible_resources`。

## 验收条件

- 网络请求、目标页面 URL 和目标页面 DOM 中均不存在扩展预期的精确坐标等敏感配置。
- 扩展报告页可验证 language、languages、Accept-Language、timezone、locale、geolocation、WebRTC、iframe/worker 与 pass-through 项目。
- run 过期、目标 tab 变化和脚本执行失败均有测试和可解释错误。

## 明确范围外

- 不添加远程数据库、遥测或第三方分析。
- 不新增新的指纹伪装面。
- 不要求外部页面信任页面脚本传回的预期值。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 能够运行真实 Chrome 时，执行并记录定向 smoke；不能运行时明确记录阻断

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-004 — 清理文档、隐私说明和旧项目信息

| 字段 | 内容 |
| --- | --- |
| 阶段 | R1 |
| 依赖 | VG-003 |
| 建议分支 | `stabilize/VG-004` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-004
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-004：清理文档、隐私说明和旧项目信息**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-004`
发布阶段：`R1`
依赖任务：VG-003
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

让公开文档只描述当前 VanishGeo 行为，移除旧项目操作流程、个人路径、具体公网 IP、失效命令和不可验证承诺，并补充明确的隐私边界。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-004，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `README.md`
- `INSTALL.md`
- `CONFIG_GUIDE.md`（可重写、合并或删除）
- `RELEASE.md`
- `PERMISSIONS.md`
- `NOTICE`
- 新增 `PRIVACY.md` 与必要的 contributing/release 文档
- 相关文档/wiring 测试

## 必须交付

- 统一项目名、构建路径、安装方法、命令和当前功能描述。
- 删除或替换具体公网 IP、个人本地目录和旧仓库地址；示例 IP 使用 RFC 5737 文档地址。
- 准确说明出口位置只在用户主动检测时请求外部 provider，不存在后台定时刷新。
- 准确说明诊断目标页、扩展侧比较、保存数据、session 数据、DNR、WebRTC 和 `<all_urls>` 的用途。
- 删除无法验证的指纹评分承诺。
- RELEASE 文档与当前 `npm` scripts、产物命名和 GitHub Actions 一致。
- 若敏感值仍存在 Git 历史，只记录需要人工批准的历史清理方案；不得擅自 force-push 或重写历史。
- 输出建议的 GitHub repository description/topics，作为人工操作项，不在未授权情况下调用远端管理 API。

## 验收条件

- 仓库中不再出现旧项目名导致的错误操作说明、个人绝对路径或真实公网 IP 示例。
- README、INSTALL、PRIVACY、PERMISSIONS 和实现一致。
- 文档链接和命令可执行，不引用已删除的 profile 或旧脚本。

## 明确范围外

- 不改变运行时行为。
- 不重写 Git 历史。
- 不发布新版本。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- 使用仓库搜索确认旧名称、个人路径和敏感示例已清理，并报告搜索命令

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-005 — 增加 CI 与发布测试门禁

| 字段 | 内容 |
| --- | --- |
| 阶段 | R1 |
| 依赖 | VG-004 |
| 建议分支 | `stabilize/VG-005` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-005
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-005：增加 CI 与发布测试门禁**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-005`
发布阶段：`R1`
依赖任务：VG-004
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

确保 push、pull request 和 tag release 在类型检查、单元测试和构建失败时不能产生可发布产物，并让测试 TypeScript 本身接受类型检查。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-005，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- 新增 `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json` / `package-lock.json`
- `tsconfig.json` 与可选 `tsconfig.test.json`
- 必要的 CI 文档与 wiring 测试

## 必须交付

- CI 在 push 和 pull_request 上至少执行 `npm ci`、源码 typecheck、测试 typecheck、`npm test` 和 `npm run build`。
- release workflow 在打包和创建 Release 前执行同等门禁；任一失败必须阻止发布。
- checkout 使用足够的 Git 历史生成跨 tag changelog，或改用不依赖浅克隆错误假设的实现。
- 测试目录纳入独立 TypeScript 检查，不能只检查 `src/**/*`。
- 聚合本地检查 script 的命名和组成须在对应任务获批后确定并同步 package.json，不得隐藏各子命令失败；当前已有入口见 RELEASE.md。
- GitHub Actions 权限最小化；除 release job 外不授予 `contents: write`。
- dry-run 检查真实 Chrome 验收入口仍可解析，但 CI 不得伪称完成人工浏览器验收。

## 验收条件

- 故意制造测试失败时，CI/release 逻辑在创建产物前停止（通过静态或本地可验证证据证明）。
- 正常状态下所有本地门禁命令通过。
- 发布 changelog 不再因浅克隆默默退化为无意义文本。

## 明确范围外

- 不发布 tag 或 Release。
- 不大版本升级工具链。
- 不引入与门禁无关的格式化器或测试框架迁移。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm ci`（环境允许时）
- `npm run typecheck`
- 新增的测试 typecheck 命令
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-006 — 实现运行时副作用对账与可见同步状态

| 字段 | 内容 |
| --- | --- |
| 阶段 | R2 |
| 依赖 | VG-005 |
| 建议分支 | `stabilize/VG-006` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-006
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-006：实现运行时副作用对账与可见同步状态**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-006`
发布阶段：`R2`
依赖任务：VG-005
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

解决“配置已保存但 content script、DNR 或 WebRTC 实际未同步”的状态分裂。配置仍是唯一期望状态，后台通过可重试 reconciliation 收敛实际状态。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-006，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/background/services.ts`
- `src/background/dnr.ts`
- `src/background/webrtc.ts`
- `src/background/message-router.ts`
- `src/shared/types.ts` / 配置与状态类型
- `src/popup/*`、`src/options/*`
- 后台服务、DNR、UI 与 wiring 测试

## 必须交付

- 定义结构化 runtime sync report，至少区分 content scripts、DNR、WebRTC 和 tab reload 的 ok/failed/partial 状态及可展示错误。
- 配置存储仍是唯一 desired state；不得创建第二套配置。可以保存轻量 reconciliation metadata，但必须与配置签名关联。
- 保存配置后执行 reconciliation；若部分失败，API/UI 不得显示无条件成功，而应显示“已保存但未完全生效”。
- service worker 启动和安装时重试未收敛状态；重复执行必须幂等。
- 在写入配置前验证可预见的运行容量，例如 DNR 可管理规则上限，避免明知必失败后仍声称成功。
- tab reload 单个失败不得阻塞其他 tab，但必须形成 partial 状态。
- 为 content registration、DNR、WebRTC、reload 各自失败与后续恢复补充测试。

## 验收条件

- 模拟任一副作用失败时，配置保存结果包含明确失败组件，UI 可见，且下次初始化会重试。
- 所有组件成功后，同一配置签名不会产生重复无意义操作。
- 不存在吞错后返回纯成功的路径。

## 明确范围外

- 不改变配置业务语义或站点匹配。
- 不新增后台定时 alarm。
- 不通过回滚用户配置来掩盖暂时性浏览器 API 失败。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-007 — 修复 SharedWorker 身份语义和 Blob URL 生命周期

| 字段 | 内容 |
| --- | --- |
| 阶段 | R2 |
| 依赖 | VG-005 |
| 建议分支 | `stabilize/VG-007` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-007
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-007：修复 SharedWorker 身份语义和 Blob URL 生命周期**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-007`
发布阶段：`R2`
依赖任务：VG-005
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

确保相同脚本 URL、名称和配置的 SharedWorker 复用稳定的包装 URL，不因每次创建新 Blob URL 破坏共享语义，同时清理 Dedicated Worker 与 SharedWorker 的对象 URL。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-007，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/injected/runtime.ts`
- `fixtures/workers/*`
- `tests/anti-detection-runtime.test.ts`
- `tests/extension-wiring.test.ts`
- 真实 Chrome acceptance 脚本/检查项

## 必须交付

- 为 SharedWorker 包装 URL 建立页面生命周期内的稳定缓存；缓存 key 至少包含原始绝对 URL、worker type、name、credentials 和当前补丁配置签名。
- 相同 key 必须复用相同 Blob URL；不同脚本、名称或配置不得错误共享。
- Dedicated Worker 构造成功后在安全时机 revoke 临时 Blob URL；SharedWorker 缓存在 `pagehide`/卸载时统一清理。
- 保留 cross-origin fallback、classic/module bootstrap 顺序和原生构造器 prototype/toString 形态。
- 缓存状态必须放入现有隐藏运行时 state，不新增页面可见 marker。
- 补充 Node 模拟测试和 worker fixture：两次相同 SharedWorker 连接到同一 scope；不同 name 不共享；module patch 先于 import。

## 验收条件

- 测试能证明相同 SharedWorker key 使用相同包装 URL和共享计数器/状态。
- 对象 URL 有明确回收路径。
- Worker、SharedWorker、cross-origin fallback 和反射伪装无回归。

## 明确范围外

- 不新增 ServiceWorker 或 Worklet 伪装。
- 不扩展到新的指纹面。
- 不改变普通网页脚本 URL 的网络语义。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 环境允许时执行 worker fixture 的真实 Chrome smoke

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-008 — 强化配置迁移、Profile 校验和 UI 正确性

| 字段 | 内容 |
| --- | --- |
| 阶段 | R2 |
| 依赖 | VG-001, VG-005 |
| 建议分支 | `stabilize/VG-008` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-008
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-008：强化配置迁移、Profile 校验和 UI 正确性**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-008`
发布阶段：`R2`
依赖任务：VG-001, VG-005
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

集中修复一组彼此独立但规模较小的配置正确性问题：零坐标迁移、Profile 范围与时区验证、Unicode 名称 ID、Popup 时区偏移显示。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-008，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/shared/config-model.ts`
- `src/shared/config-resolver.ts`
- `src/shared/profile.ts`
- `src/popup/popup.ts`
- `src/options/options.ts`
- `tests/config.test.ts` 及新增 profile/UI 纯逻辑测试

## 必须交付

- 旧配置迁移用显式有限数判断坐标，合法的纬度或经度 0 不得被判为 auto。
- 统一 Profile 校验：纬度 [-90,90]、经度 [-180,180]、accuracy > 0、有效 IANA timezone、非空名称和唯一 ID。
- 导入非法 Profile 时给用户可操作错误；不得通过先 normalize 后静默丢弃来伪装成功。
- 创建自定义 Profile 时使用 `crypto.randomUUID()` 或等价稳定唯一 ID；Unicode 名称和同名 Profile 均可正常保存。
- Popup 使用目标时区计算 UTC offset，不得显示本机时区偏移。
- 新增 0/0、0/120、-30/0、越界坐标、非法 timezone、中文名称、同名 profile、DST 日期等测试。

## 验收条件

- 所有合法零坐标迁移为 manual。
- 非法 Profile 不会进入有效配置，并向导入调用者返回明确错误。
- 中文名称生成非空唯一 ID，Popup 偏移与目标 IANA 时区一致。

## 明确范围外

- 不重新设计 Profile 产品模型。
- 不改变出口位置 verified 信任边界。
- 不引入地理编码服务或新的外部请求。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-009 — 增加最早内联脚本注入时序验收

| 字段 | 内容 |
| --- | --- |
| 阶段 | R3 |
| 依赖 | VG-006, VG-007, VG-008 |
| 建议分支 | `stabilize/VG-009` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-009
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-009：增加最早内联脚本注入时序验收**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-009`
发布阶段：`R3`
依赖任务：VG-006, VG-007, VG-008
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

建立可重复的真实 Chrome 证据，验证 `document_start` 的异步初始化链路是否在页面最早 inline script 之前完成；不得只在 DOMContentLoaded 后检查。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-009，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- 新增 `fixtures/injection/earliest-inline.html` 及必要子框架 fixture
- `scripts/chrome-acceptance.mjs`
- VG-003 的扩展侧诊断采集/报告实现
- `tests/extension-wiring.test.ts` 与必要诊断测试

## 必须交付

- fixture 在 `<head>` 的首个 inline script 中立即捕获 language、languages、timezone、offset 及必要的 runtime marker-free 观测值。
- 扩展侧诊断报告区分 earliest snapshot 与 load 后 snapshot，并对预期值分别判定。
- 覆盖顶层文档、same-origin iframe、srcdoc/about:blank 中至少适用的最早时序。
- `npm run test:e2e:chrome` 的输出明确列出此项；尽可能实现自动结果回传。若自动化需要新增小型 dev dependency，先证明 Node 内置能力不足并记录理由。
- 测试不得依赖把预期敏感配置写入页面 URL。
- 若真实 Chrome 证明存在竞态，本任务只记录可稳定复现的证据和最小修复；不得借机重写整个 runtime。

## 验收条件

- 验收结果能明确回答“首个 inline script 看到的是原始值还是伪装值”。
- Node wiring 测试不能替代真实 Chrome 结果；无法运行真实 Chrome 时任务只能进入 review 并明确标记未验证项。
- fixture 和报告不向生产页面增加 marker。

## 明确范围外

- 不新增新的 spoof surface。
- 不做 runtime 大规模模块化；由 VG-011/VG-012 处理。
- 不使用外部指纹网站作为唯一验收证据。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 环境允许时运行真实 Chrome 验收并保存精确结果

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-010 — 实现首次安装引导和安全默认值

| 字段 | 内容 |
| --- | --- |
| 阶段 | R3 |
| 依赖 | VG-009 |
| 建议分支 | `stabilize/VG-010` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-010
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-010：实现首次安装引导和安全默认值**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-010`
发布阶段：`R3`
依赖任务：VG-009
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

让全新安装在用户明确配置和启用前不改变 WebRTC 或站点环境，同时保持已有用户升级语义，不把升级误当首次安装。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-010，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` / `types.ts`
- `src/background/service-worker.ts` / `services.ts`
- `src/popup/*`、`src/options/*`
- 可选新增 onboarding 页面及 Vite 构建入口
- `manifest.json`（仅在 onboarding 需要时）
- 迁移、后台、UI、wiring 与 acceptance 测试

## 必须交付

- 定义并记录 fresh install、upgrade、reset 三种状态，不得混用。
- 全新安装默认不启用全局保护，WebRTC 使用 browser default；不得自动调用出口检测 provider。
- 引导流程要求用户主动检测/确认出口、选择站点和明确启用；允许跳过并保持安全关闭状态。
- 已有 v2 配置升级时保留用户 masterEnabled、WebRTC、规则和 Profile，不应用新的 fresh-install 默认覆盖。
- reset 行为必须在 UI 文案和测试中明确：是回到安全新默认，还是保留已验证 Profile；选择一种并记录理由。
- 未配置、部分配置、同步失败和已启用状态在 Popup/Options 中可区分。
- 如 schemaVersion 变化，提供幂等迁移和回滚说明。

## 验收条件

- 空 storage 首次安装不会设置严格 WebRTC、注册站点脚本或发起外部定位请求。
- 旧用户升级后有效配置保持不变。
- 完成 onboarding 后规则、出口档案和启用状态按用户选择生效。

## 明确范围外

- 不实现云同步或账户系统。
- 不默认启用任何外部自动能力。
- 不把 onboarding 与商店发布流程耦合。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 环境允许时执行 fresh install 与 upgrade 两条真实 Chrome smoke

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-011 — 运行时模块化设计与可行性验证

| 字段 | 内容 |
| --- | --- |
| 阶段 | R3 |
| 依赖 | VG-010 |
| 建议分支 | `stabilize/VG-011` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-011
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-011：运行时模块化设计与可行性验证**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-011`
发布阶段：`R3`
依赖任务：VG-010
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

在不破坏 `chrome.scripting.executeScript({func})` 自包含约束的前提下，为约 71KB 的 MAIN-world runtime 制定可实施模块化方案并完成最小 spike。本任务以设计证据为主，不做全面迁移。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-011，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/injected/runtime.ts`
- `src/background/services.ts`
- `vite.config.ts`
- `tests/anti-detection-runtime.test.ts`
- 新增 `docs/stabilization/runtime-modularization-rfc.md`
- 本任务 `.trellis` 设计与研究证据

## 必须交付

- 明确记录 `executeScript.func` 的闭包/序列化约束和当前自包含函数依赖。
- 评估至少三种方案：保留单文件但内部生成、构建期生成自包含 runtime、改为受控文件注入；分别分析 CSP、web_accessible_resources、MAIN world、documentId、构建和测试影响。
- 选择一个方案并给出目标目录、构建产物、注入 API、source map、测试和回滚设计。
- 完成最小 spike，证明所选方案可在 Node 测试中编译，并在可能时通过真实 Chrome 注入一个最小 surface。
- 不得在本任务迁移所有 timezone/geolocation/canvas/worker 代码。
- 输出 VG-012 可直接执行的文件级实施清单和等价性测试矩阵。

## 验收条件

- RFC 能解释为什么拆文件后不会出现 MAIN world 未定义闭包引用。
- spike 证明核心构建/注入机制可行，或明确否决并给出证据。
- 生产行为保持不变；任何 spike 代码若不适合保留必须移除。

## 明确范围外

- 不实施 compatibility mode。
- 不改变公开配置、存储或权限。
- 不以“代码更短”为由牺牲自包含和 documentId 定向注入。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 记录 spike 的精确验证命令

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-012 — 按批准 RFC 实施运行时模块化

| 字段 | 内容 |
| --- | --- |
| 阶段 | R3 |
| 依赖 | VG-011 |
| 建议分支 | `stabilize/VG-012` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-012
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-012：按批准 RFC 实施运行时模块化**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-012`
发布阶段：`R3`
依赖任务：VG-011
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

严格按 VG-011 已人工接受的 RFC 拆分 MAIN-world runtime，在保持行为、注入时序、隐藏状态和构建产物契约不变的前提下降低单文件复杂度。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-012，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- VG-011 RFC 指定的 `src/injected/**` 模块
- `src/background/services.ts`
- `vite.config.ts` 与必要构建脚本
- `tests/anti-detection-runtime.test.ts`
- `tests/extension-wiring.test.ts`
- 所有 iframe/worker/geolocation/diagnostic fixtures

## 必须交付

- 按责任拆分 reflection registry、navigator、Intl/Date、geolocation/permissions、canvas、worker hooks 与 apply orchestration。
- 最终注入产物仍满足 VG-011 的自包含/受控文件契约，不能引用页面中不存在的模块绑定。
- 保持 runtime message action、storage payload、manifest entry、documentId 定向 MAIN-world 注入和幂等 anchor 行为。
- 每个模块有可直接单测的纯逻辑边界；跨 realm 行为继续由现有 VM 与真实 Chrome fixture 验证。
- 建立构建期断言，防止 runtime 产物出现动态 chunk、外部 import 或不稳定文件名。
- 本任务禁止顺便改变伪装语义；任何行为差异必须视为回归并修复。

## 验收条件

- 原有全部测试和 VG-009 earliest-inline 验收不回归。
- 构建产物可加载，不产生额外未声明 chunk/web-accessible resource。
- 行为等价性矩阵逐项有证据。

## 明确范围外

- 不新增 spoof surface。
- 不实现 compatibility mode；由 VG-013 完成。
- 不改变首次安装默认值或权限。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 环境允许时执行完整真实 Chrome acceptance

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-013 — 增加时区与 Locale 兼容模式

| 字段 | 内容 |
| --- | --- |
| 阶段 | R3 |
| 依赖 | VG-012 |
| 建议分支 | `stabilize/VG-013` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-013
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-013：增加时区与 Locale 兼容模式**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-013`
发布阶段：`R3`
依赖任务：VG-012
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

在当前严格一致性行为之外增加兼容模式：默认值可按 Profile 伪装，但页面调用方显式指定的 locale/timeZone 不被无条件覆盖。模式必须可配置、可解释、可测试。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-013，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `src/shared/types.ts` / `config-model.ts` / `config-resolver.ts`
- 模块化后的 Intl/Date runtime 模块
- `src/popup/*`、`src/options/*`
- 配置迁移、diagnostic、runtime 与 UI 测试
- `README.md` / `PRIVACY.md` / 配置文档

## 必须交付

- 定义 `strict` 与 `compatible` 的精确语义；默认模式由产品安全原则决定并记录，不得模糊。
- strict 保持当前强制一致性；compatible 只在调用方未显式传入 locale/timeZone 时注入默认值。
- Date 本地 getter、`Intl.DateTimeFormat`、其他 Intl 构造器和 Worker realm 的模式行为一致。
- 配置 schema 和迁移向后兼容；旧用户保持现有 strict 行为，除非任务设计明确且经测试采用其他迁移策略。
- UI 解释兼容性与一致性的权衡，不承诺规避所有检测。
- 诊断报告同时验证默认调用与显式参数调用。

## 验收条件

- compatible 下 `new Intl.DateTimeFormat('en-US',{timeZone:'UTC'})` 保持调用者显式 UTC；无显式参数时使用配置值。
- strict 下维持原有强制覆盖。
- top frame、iframe 和 worker 中模式一致，迁移无数据丢失。

## 明确范围外

- 不增加 WebGL、Audio、screen、hardware、codec 等新指纹面。
- 不改变 WebRTC 模式语义。
- 不把兼容模式宣传为不可检测。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 环境允许时执行 strict 与 compatible 两套真实 Chrome smoke

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

## VG-014 — 稳定化集成回归与发布候选验收

| 字段 | 内容 |
| --- | --- |
| 阶段 | R4 |
| 依赖 | VG-001, VG-002, VG-003, VG-004, VG-005, VG-006, VG-007, VG-008, VG-009, VG-010, VG-011, VG-012, VG-013 |
| 建议分支 | `stabilize/VG-014` |
| 结束状态 | `review` |

### 使用前

```bash
cd "$VANISHGEO_REPO"
git status --short
git switch main
git pull --ff-only
git switch -c stabilize/VG-014
codex
```

如果主开发分支不是 `main`，替换为实际基线。若分支已存在，切换现有分支；不要重复创建。只有在依赖任务已经人工接受、提交并合并到基线后才开始。

### 复制给 Codex

```text
请实现 VanishGeo 稳定化任务 **VG-014：稳定化集成回归与发布候选验收**。

仓库根目录：当前本地仓库根目录（通过 `pwd` 获取；公开记录使用相对路径）
建议分支：`stabilize/VG-014`
发布阶段：`R4`
依赖任务：VG-001, VG-002, VG-003, VG-004, VG-005, VG-006, VG-007, VG-008, VG-009, VG-010, VG-011, VG-012, VG-013
任务完成状态：`review`，人工验收后才可改为 `done`

## 本任务目标

对整个稳定化波次做集成审查、真实 Chrome 回归、安全/隐私检查和发布候选报告。默认不新增功能；只允许修复本轮集成暴露的阻塞性回归。

## 开始前必须执行

1. 进入仓库根目录，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`，确认工作树和基线。不要覆盖或丢弃用户已有改动。
2. 读取根 `AGENTS.md`、从仓库根到目标目录路径上适用的所有 `AGENTS.md` / `AGENTS.override.md`。
3. 读取 `docs/stabilization/README.md`、`docs/stabilization/task-manifest.yaml`、`docs/stabilization/acceptance-matrix.md`，确认本任务状态和依赖。
4. 读取 `.trellis/spec/frontend/directory-structure.md`、`.trellis/spec/frontend/quality-guidelines.md`，以及当前任务相关的 `.trellis` 记录。
5. 读取 `README.md`、`PRIVACY.md`（若存在）、`PERMISSIONS.md`、`package.json`、`manifest.json`、`vite.config.ts` 和本任务涉及的实现与测试。不得仅凭本提示词编码。
6. 按仓库现有 `.trellis` 约定创建本任务记录。至少包含 `task.json`、`prd.md`、`design.md`、`implement.md`；若仓库工具定义了其他格式，遵循工具而不是建立第二套格式。
7. 运行相关基线测试。若失败，先区分既有失败与本任务引入失败，记录精确命令和输出摘要。
8. 把 manifest 中本任务从 `planned` 更新为 `in_progress`。依赖不满足时不得实施。


## 长期不变量

- 一次只实现 VG-014，不得提前实现后续任务。
- `src/shared/config-model.ts` / `config-resolver.ts` / `storage.ts` 仍是配置、匹配和迁移的权威边界；不得增加第二套域名匹配器或存储事实来源。
- 保持 Chromium Manifest V3、动态 allowlist content script、定向 `documentId` MAIN-world 注入和 DNR 架构，除非本任务明确要求改变。
- 不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、codec、WebGPU 等无证据的指纹伪装面。
- 不建立页面可控的配置桥，不从普通网页接受可信配置或预期值。
- 不为通过测试放宽权限、host scope、隐私边界、verified exit profile 边界或错误校验。
- 不添加生产依赖，除非本任务确实无法用现有能力完成；新增时必须说明替代方案和理由。
- 不修改无关文件，不做顺手大重构，不升级依赖大版本。
- 不得把精确公网 IP、真实个人路径、精确位置或凭据写入仓库、测试夹具、URL、日志或文档。
- 不自行 push、merge、创建 tag、发布 Release 或修改远端仓库设置。

## 主要代码/文档区域

- `docs/stabilization/acceptance-matrix.md`
- `docs/stabilization/release-readiness.md`
- `docs/stabilization/task-manifest.yaml`
- 实际回归发现所需的最小代码/测试修复
- README、PRIVACY、PERMISSIONS、RELEASE 的最终一致性检查

## 必须交付

- 逐项执行 acceptance matrix：配置、disabled rules、diagnostic privacy、extension report、DNR、WebRTC、runtime sync、migration、onboarding、iframe、worker、SharedWorker、earliest inline、strict/compatible。
- 执行完整本地门禁和可用的真实 Chrome 验收，记录环境、Chrome 版本、命令、结果和证据。
- 审查构建产物：manifest、权限、无意 chunk、远程代码、source map、敏感数据、真实 IP/路径和 release zip 结构。
- 审查 CI/release workflow，不创建 tag 或正式 Release。
- 只修复 P0/P1 集成回归；任何新功能或大改创建后续任务，不在本任务实施。
- 生成 release-readiness 报告，列出通过项、未验证项、阻断项、回滚点和建议版本号；没有人工批准不得改版本或发版。
- VG-014 结束状态为 `review`；整个稳定化波次是否发布由人工决定。

## 验收条件

- 所有自动门禁通过，或每个失败都有阻断结论。
- 至少一轮真实 Chrome 证据覆盖核心隐私边界；无法获得时不得宣称 release-ready。
- 文档、manifest、构建产物和当前行为一致。

## 明确范围外

- 不创建/推送 tag，不发布 GitHub Release，不上架商店。
- 不实现 optional host permissions 或新指纹面。
- 不掩盖未运行测试。

## 编码前输出

先输出以下 preflight，然后继续执行，不需要等待我确认：

1. 依赖与任务状态检查；
2. 当前分支、工作树和基线提交；
3. 当前行为及可复现证据；
4. 目标行为；
5. 当前实现与文档/规范的差异；
6. 范围内、明确范围外；
7. 计划修改文件；
8. 配置 schema、storage、runtime message、manifest、DNR、权限和构建产物影响；
9. MAIN/ISOLATED world、top frame/iframe/worker 边界影响；
10. 安全、隐私、外部请求和敏感数据边界；
11. 幂等、并发、失败恢复和迁移影响；
12. 测试计划；
13. 风险、回滚方案和停止条件。

## 仅在以下情况停止并标记 `blocked`

- 依赖任务实际未完成；
- `AGENTS.md`、已接受 RFC/ADR、实现和本任务目标存在无法消解的冲突；
- 完成任务需要未批准的破坏性数据迁移、Git 历史重写、权限扩大或外部服务授权；
- 需要改变本任务明确禁止改变的安全/隐私边界；
- 基线存在与本任务不可区分的阻塞性失败，且无法建立可靠回归证据。

不要因为任务较复杂而停止；能在现有边界内作出合理工程决策时直接完成。

## 最低验证要求

- `git diff --check`
- `npm ci`
- `npm run typecheck`
- 测试 TypeScript typecheck 命令
- `npm test`
- `npm run build`
- `npm run test:e2e:chrome -- --dry-run`
- 完整真实 Chrome acceptance（环境允许时）
- 对 dist/release zip 的静态检查命令并报告结果

按实际变更增加更精确的定向测试。不得把 dry-run、静态测试或 Node VM 测试表述为真实 Chrome 验收。

## 完成后输出

1. 实现摘要；
2. 修改文件列表；
3. 行为与契约变化；
4. 配置 schema、storage、迁移、runtime message、manifest、权限和构建变化；
5. 关键不变量如何保证；
6. MAIN/ISOLATED world、iframe、worker 和浏览器 API 边界；
7. 幂等、并发、失败恢复与回滚；
8. 安全、隐私、外部调用和敏感数据处理；
9. 实际运行的测试命令及逐项结果；
10. 未运行测试和具体原因；
11. `.trellis` 证据及 manifest 状态变化；
12. 已知限制；
13. 后续任务，只列出，不实施；
14. 建议 commit message。

实现及本地验证完成后，把本任务状态更新为 `review`，不得自行标记 `done`。
```

# 通用人工验收收尾提示词

把 `<TASK_ID>` 和 `<TASK_TITLE>` 替换为实际任务。此提示词应在原任务分支的新 Codex 会话中执行，或确保新会话已从仓库根加载最新 `AGENTS.md`。

```text
我已经人工审查并接受 **<TASK_ID>：<TASK_TITLE>** 的实现、测试证据和已知限制。

请只执行以下收尾操作：

1. 读取根 `AGENTS.md`、`docs/stabilization/task-manifest.yaml` 和本任务 `.trellis` 记录。
2. 确认 manifest 中本任务当前为 `review`，依赖状态未被意外修改。
3. 将本任务从 `review` 更新为 `done`。
4. 按仓库现有 `.trellis` 约定记录人工验收完成时间、验收说明和最终测试证据；如现有约定要求归档，执行归档，但不要改动其他任务。
5. 不修改生产代码，不实现后续任务，不改变其他任务状态，不创建 tag、不发布、不 push、不 merge。
6. 运行 `git diff --check`。
7. 输出最终修改文件、manifest/.trellis 状态变化、`git diff --check` 结果和建议 commit message。

如果发现生产代码在人工验收后又发生未审查变化，不要标记 `done`；将任务保持 `review` 并报告差异。
```

# 每个任务合并后的下一步

1. 在任务分支审查 diff 和测试。
2. 使用上面的收尾提示词把状态改为 `done`。
3. 提交该分支。
4. 通过正常 PR/merge 流程合入基线。
5. 删除或保留任务分支按你的仓库策略处理。
6. 从更新后的基线创建下一个任务分支，并启动新的 Codex 会话。

# 暂不纳入本波次的后续议题

- 评估移除冗余 `tabs` 权限。
- optional host permissions 与按站点授权 UX。
- Chrome Web Store 发布、签名、自动更新和商店隐私披露。
- 新的设备指纹伪装面。
