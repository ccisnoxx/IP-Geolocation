# VG-001 执行与阻塞证据

当前阶段：VG-001 已完成范围内源码、本地验证与独立复核，并由用户确认通过真实 Chrome 人工验收；manifest 为 done、Trellis 为 completed。人工验收记录见文末。下列初始阻塞和本地交付证据保留为历史，不能用来判断当前依赖或验收状态。

## 初始阻塞阶段（历史）

2026-10-14，基线 `5701b55 feat: add explicit exit location profiles`，当前分支 `stabilize/VG-001`。

读取适用 AGENTS/RTK、稳定化 README/manifest/验收矩阵、前端目录/质量/状态规范、Trellis 工作流和 VG-000 记录、根 README/PERMISSIONS、package.json、manifest.json、vite.config.ts，以及两处规则文本/表单转换函数。PRIVACY.md 不存在；没有附加路径 AGENTS/override。

既有工作树：修改 .gitignore、两个前端规范、README；未跟踪前端 index/state-management、VG-000 记录、AGENTS、docs 和两个 images 图标。没有覆盖或清理这些工作。

## 阻塞

manifest VG-000.status = review；VG-000 task.json.status = review，completedAt = null。未完成人工验收，不能满足 VG-001.dependencies = [VG-000]。按用户明确停止条件，将 VG-001 从 planned 改为 blocked；工具创建记录从 planning 同步为 blocked，没有调用 start、没有进入 in_progress、没有实现源码。

manifest 同步本次授权的 VG-001 标题、R1 阶段和规则编辑范围，并链接本记录。没有修改 VG-000 或其他任务的状态。验收矩阵 A01 的历史宽泛范围未改，不把并发/失败恢复场景作为本任务实施授权。

## 初始阶段实际检查

| 精确命令或操作 | 实际结果 | 证据边界 |
|---|---|---|
| git status --short | 存在上述既有改动 | 工作树基线 |
| git branch --show-current | stabilize/VG-001 | 未切换分支 |
| git log -1 --oneline | 5701b55 feat: add explicit exit location profiles | 当前提交 |
| ./node_modules/.bin/tsx --test tests/config.test.ts tests/extension-wiring.test.ts | exit 0，25 tests / 25 pass / 0 fail / 0 skipped | Node/静态 wiring 基线，不覆盖规则文本合并 |
| node --import tsx --input-type=module（stdin 内联复现，步骤见下） | exit 0；两处函数均 input=2 output=1，disabled 规则缺失 | 函数复现，不是真实 Chrome 保存 |
| python3 .trellis/scripts/task.py current --source | Current task: (none), Source: none | 未借用其他会话指针 |
| python3 .trellis/scripts/task.py create 'VG-001：保留已禁用站点规则并统一规则编辑语义' --slug vg-001-rule-list --description 'R1；依赖 VG-000 人工验收完成后实施，当前仅记录依赖阻塞' | exit 0，工具创建本目录和标准 task.json/PRD/JSONL | 记录创建，不表示允许实施 |
| git diff --check | exit 0，无 whitespace 错误 | 已跟踪 diff；新文件另做内联检查 |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-001-rule-list | exit 0，implement.jsonl/check.jsonl 各 6 项引用有效 | Trellis 上下文引用 |
| ruby -ryaml -rjson（stdin 内联状态检查） | exit 0；15 个唯一任务，VG-000=review、VG-001=blocked/R1、其余 13 项 planned；task.json 状态和依赖一致 | YAML/JSON 状态一致性 |
| python3（stdin 内联文件检查） | exit 0；6 个任务文件末尾换行/空白合格、无真实个人路径、relatedFiles 均存在 | 新记录完整性 |
| git diff --name-only -- src tests package.json package-lock.json manifest.json vite.config.ts PERMISSIONS.md | exit 0，无输出 | 产品源码、测试及关键构建/权限输入未改 |
| git diff --cached --name-only；git status --short --untracked-files=all | exit 0，无 staged 文件；既有工作加本任务 6 项记录和 manifest/ignore 改动 | 未提交、未覆盖既有工作 |

复现步骤：读取两处 TypeScript 的完整 rulesFromText 函数，使用已安装 TypeScript transpileModule 转成 JS，在 Node vm 中提供维护源 config-model.ts 的 createRule/normalizeDomain；构造 enabled.example 启用规则和 disabled.example 禁用规则，将启用域名序列传入原函数；断言输出为 1 条且禁用域名缺失。所有操作内联执行，没有临时脚本或真实数据。

初始阻塞阶段未运行 npm run typecheck、npm test 全套、npm run build 或真实 Chrome：当时依赖阻塞，尚未进入实现完成验证。VG-000 历史记录的 58 项通过结果未冒充 VG-001 验收；恢复后的实际验证见下文。

## 恢复步骤

1. 人工验收 VG-000，并在 manifest 标记 done、保存验收人/日期/证据；不能由代理推断或自行提升状态。
2. 重新检查工作树、依赖和受影响实现/测试的完整合同；保留新增并发工作。
3. 将本任务与 manifest 同步为 in_progress 并按工具约定 start；实现共享语义及缺失行为测试。
4. 输出恢复后的 preflight，完成四项最低验证和实际 diff 检查；同步 review，等待人工验收。

## 初始阶段清理与限制

初始阶段没有创建后台进程、监听端口、浏览器 profile 或一次性文件，没有提交、push、merge、tag 或发布。六个 Trellis 文件是保留的恢复证据，不是临时产物；当时缺陷仍存在，任务停在 blocked。

## 依赖解除与恢复执行（2026-10-14）

用户在当前对话明确确认 VG-000 已通过人工验收，并授权更新状态、继续 VG-001。本轮重新运行 git status --short、git branch --show-current、git log -1 --oneline：仍在 stabilize/VG-001、5701b55；工作树保留原有治理文档、规范和两个图标。

manifest VG-000 review → done，保存 accepted_by=用户、accepted_at=2026-10-14 和原任务 implement.md 的人工验收引用。VG-000 task.json 同步为 completed、completedAt=2026-10-14；不归档、不提交。VG-001 移除 blocked_reason，manifest blocked → in_progress，并执行 `python3 .trellis/scripts/task.py start .trellis/tasks/10-14-vg-001-rule-list`（exit 0，planning → in_progress，关联当前会话）。初始阶段 25/25 基线与两处缺陷复现在源码/测试输入未改变时复用。

实施前完整读取 Popup、Options、config-model、config-resolver、storage、types、相关 config/wiring 测试，以及后台 saveSiteConfig/persistConfig 队列和消息校验路径；复用先前已读的根文档、Manifest/Vite、权限、Trellis 和前端规范。无需跨会话历史检索。

## 实现与数据合同

- 新增 src/shared/rule-list.ts，唯一拥有规则文本显示/合并：文本是启用域名集合，禁用规则保留；重新启用复用原 ID、overrides、出口档案绑定；移除启用域名删除该规则。
- 已有规则保持数组顺序；新域名按文本首次出现顺序追加。新 ID 确定且避开已有 ID；使用 config-model.normalizeDomain/normalizeRule，不复制默认值或匹配器，不使用时间/随机数。
- Popup/Options 删除原有本地合并实现，共用两项函数；Options 规则卡片删除后的文本也使用同一显示函数。
- 新增 8 项规则行为测试、4 项实际管理页表单与保存函数的 Node VM 测试、1 项共享接线约束。表单测试观察 setSiteConfig 消息中的真实转换结果，覆盖主开关、debug、语言、时区、画布、坐标及连续保存，不能作为真实 Chrome/storage 测试。
- config-model/resolver/storage、schema v2、storage key、迁移、runtime action/payload、manifest、DNR、权限和依赖没有修改。MAIN/ISOLATED、documentId、top frame/iframe/worker、浏览器 API 与 verified 身份边界保持现有实现。
- 没有新增网络请求或生产依赖，测试仅使用合成域名/坐标和已有 mocks；未把真实个人路径、精确公网 IP、位置或凭据写入任务交付。

## 恢复后实际验证

| 精确命令 | 实际结果 | 层级与限制 |
|---|---|---|
| ./node_modules/.bin/tsx --test tests/rule-list.test.ts（临时提取原合并逻辑时） | exit 1，8 tests / 1 pass / 7 fail；禁用规则丢失、顺序及确定性断言失败 | 有意验证旧逻辑缺口；临时实现随后被正式修复替换，不是环境失败 |
| ./node_modules/.bin/tsx --test tests/rule-list.test.ts tests/rule-list-ui.test.ts tests/extension-wiring.test.ts | exit 0，27 tests / 27 pass / 0 fail / 0 skipped | 修正后首先重验失败范围和直接调用页 |
| npm run typecheck | exit 0，tsc --noEmit | src 静态类型；tsconfig 不包含 tests |
| npm test | exit 0，71 tests / 71 pass / 0 fail / 0 skipped | Node、VM、Chrome mocks、静态 wiring；不是浏览器验收 |
| npm run build | exit 0，TypeScript + Vite 5.4.21，24 modules、静态复制 12 items | 五个稳定入口及共享 rule-list chunk 实际输出；未直接编辑 dist |

完整验证是项目明确最低门禁，在全部授权实现稳定后执行；没有运行多浏览器矩阵、安全扫描或无关额外套件。源码/测试/依赖/构建输入未变化时复用上述证据。

## 未验证边界与回滚

本地实现交付时，代理未执行真实 Chrome UI 保存/重载、真实 storage 写失败、service worker 重启或多管理页并发。随后用户已按提供步骤确认规则保存、重新读取及扩展重载后的读取通过，见“人工验收”；存储失败、广泛 service worker 生命周期和多管理页并发仍没有验收证据。变更限于管理页规则转换，Node/VM 与构建结果不表述为 Chrome 通过，不因此启动后续任务。

本任务不改变多窗口完整配置保存的现有覆盖语义、写入队列或失败恢复；旧版本已删除的禁用规则无法从缺失的数据恢复。回滚只撤销本任务可归属源码、测试、规则合同文档及治理记录，保留用户验收与既有工作；旧源码会恢复原丢失缺陷，不需要 schema 降级或破坏性迁移。已有规则 ID 保留，新规则 ID 符合原有字符串身份合同，旧版本可读取。

没有临时脚本、后台进程、端口监听或浏览器 profile；正常 dist 构建输出保留用于人工加载且继续被忽略。未提交、推送、合并、tag 或发布。

## 独立复核与收尾

按持久化规则集合的数据完整性风险，派发 fresh、隔离上下文的 critical_reviewer 进行只读复核，没有委派实现或重复测试。复核检查管理页 readForm → setSiteConfig → saveSiteConfig → validateConfig → storage.local.set 链路，以及禁用交错、清空、重启用元数据、URL/去重、已有自定义 ID/后缀冲突、非法域名校验及测试消息边界；未确认可行动问题。复核当时未验证真实 Chrome、存储失败和多窗口并发；后续用户 Chrome 验收只补足本文“人工验收”列出的规则场景。

复核前后的六个源码/测试文件摘要完全一致，实际工作树无无法归属的新文件；主代理文档修改与产品候选区分。通过 WorkPlan 计划/派发门禁和 Execution/Summary/Digest 校验后，审计 Bundle 已关闭并通过 audit-verify：audit_id 为 `20261014T063726Z-vg-001-rule-list-review-ef30a30c`，1 次复核执行已按合同验收、1 次独立复核，无活跃 Worker、未知写入或异常。模型配置证据为 Agent TOML 的 gpt-6.1-sol/xhigh，不推断运行时模型遥测。

`git diff --check` 与两项 task.py validate 均 exit 0；新文件空白/引用/敏感路径和 YAML/JSON 验收/依赖检查通过。task.py start 生成的 task.json 缺少末尾换行，在内联格式检查中发现后补齐，随后重验；此为任务记录格式问题，未改变源码，也未重复已通过的运行时验证。WorkPlan 首次输入的多行 deliverable 和 dispatch.message 不符合工具 schema，改为无控制字符合同及标准派发字段后才通过门禁，未在失败门禁状态派发。

本地交付状态（历史）：manifest VG-000=done，VG-001=review；Trellis VG-000=completed、completedAt=2026-10-14，VG-001=review、completedAt=null；VG-002 至 VG-014 保持 planned。没有归档、提交或推送。建议 commit message：`fix(rules): preserve disabled site rules during settings saves`。

## 人工验收

2026-10-14，验收人：用户。用户在当前对话明确确认：“VG-001 已按上述步骤通过真实 Chrome 人工验收，Options 和 Popup 的各项检查均通过”，并要求更新 manifest 为 done、同步 Trellis 验收记录，不提交、推送或启动后续任务。

验收依据为同一对话上一轮提供的 VG-001 真实 Chrome 人工步骤：独立测试 profile 加载当前工作树的 dist，通过扩展管理页消息建立三条合成规则及 unverified 出口绑定；实际操作 Options 和工具栏 Popup，并比较后台 getSiteConfig 与 chrome.storage.local 的重新读取结果。以下通过结果来自用户的人工执行确认，非代理重新运行或浏览器遥测。

| 验收项 | Options | Popup |
|---|---|---|
| 语言、时区、Canvas、坐标等无关设置分别保存后，禁用规则和完整数组保持 | PASS（用户确认） | PASS（用户确认） |
| 重新启用禁用域名，保留原 ID、overrides、出口档案绑定；URL/大小写/重复输入不产生额外规则 | PASS（用户确认） | PASS（用户确认） |
| 移除启用域名，只删除该规则并保留其他禁用规则 | PASS（用户确认） | PASS（用户确认） |
| 保存后后台与 local storage 读取一致，关闭、重开及刷新后仍一致 | PASS（用户确认） | PASS（用户确认） |
| 扩展重载后规则数据读取仍一致 | PASS（用户确认） | PASS（用户确认） |

候选记录沿用 stabilize/VG-001、HEAD 5701b55 的当前工作树构建及扩展 manifest 版本 2.1.0。用户未提供 Chrome 具体版本、截图、逐步 JSON 或额外日志，不补写这些信息。扩展重载后的规则读取通过不代表完整 MV3 生命周期、DNR、WebRTC、iframe、worker、存储故障恢复或多窗口并发验收；这些范围未因此变成已完成任务。

依据此明确验收将 manifest 的 VG-001 从 review 改为 done；task.json 同步为工具原生 completed，completedAt 为 2026-10-14，并保存同一验收人、日期和证据引用。同步 PRD/design、稳定化 README 和验收矩阵的当前状态与证据边界，不修改产品源码、测试、构建输入或 dist；保留此前 71/71、typecheck、build 和独立复核的实际证据，元数据更新不重复运行它们。

本次只进行文档/状态一致性与 diff 检查，不归档、不提交、不推送、不启动后续任务；VG-002 至 VG-014 保持 planned。

验收记录同步检查：`git diff --check` 和 `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-001-rule-list` 均 exit 0；内联 Python/Ruby 校验通过，manifest 与 task.json 的验收人/日期/引用一致，其余 14 项任务记录未变，七个更新文件空白/本地链接/敏感路径检查通过。源码、测试、构建输入、dist、VG-000 记录及既有受保护文件的集合摘要与本轮修改前一致。
