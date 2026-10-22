# VG-004 执行证据

## 基线与前置检查

2026-10-14；分支 stabilize/VG-004；基线 5701b55。git status --short、git branch --show-current、git log -1 --oneline 已执行。任务前 203 个非忽略文件已保存临时内容摘要/副本用于增量检查；既有 VG-000～003 与两个图标保留。

根项目 AGENTS 为目标路径唯一项目规则；已读 RTK、Trellis workflow、前端目录/质量规范、manifest/矩阵、VG-003 PRD/design/implement，以及相关文档、配置、源码/测试。task.py create 创建本任务，不另建格式。VG-003 为人工验收后的 done；本次显式范围覆盖旧 VG-004 WebRTC 初始计划。

基线命令：`npx tsx --test tests/background-services.test.ts tests/diagnostic-report.test.ts tests/leak-test-observation.test.ts tests/extension-wiring.test.ts`，50 tests / 50 pass / 0 fail / 0 skipped，exit 0。首次工具聚合输出不完整，使用 RTK proxy 同命令恢复可读结果；没有将缺失输出当成功，也无代码修复。证据是 Node/mock/VM/静态，不是真实 Chrome。

## 实施计划

1. 校准 manifest，进入 in_progress；建立 PRD/design、context 和精确 ignore 放行。
2. 重写公开文档，保留必要许可证归属；提示词去个人路径，说明模板与 manifest 的关系。
3. 执行最低门禁、链接/scripts/产物核验、搜索和任务增量检查。
4. 同步 review，保留历史清理和人工元信息操作方案，不提交或发布。

## 历史检查

只读扫描本地所有 refs 的 62 个提交中 CONFIG_GUIDE/RELEASE/README/INSTALL：CONFIG_GUIDE 历史仍有非文档公网 IP；RELEASE 历史仍有个人绝对路径。只保存文件与类别，不复述敏感值。未重写历史、访问远端管理或 force-push；方案见 CONTRIBUTING。


## 实际交付

- README/INSTALL/CONFIG_GUIDE 统一 VanishGeo、unpacked dist、当前保存/auto 绑定/手工配置与诊断路径。移除旧地区整套预设、真实公网 IP/个人位置示例和评分承诺。
- PRIVACY 补齐 provider 顺序、请求信息、local/session/内存、完整配置导出未脱敏、候选五分钟逻辑过期但无定时物理删除，以及普通网页/Google STUN/同源 echo 的实际可见面。localhost 不等于主动 ICE 完全离线。
- PERMISSIONS 校准现有每项权限，保留宽 host 能力及动态 allowlist/可信 sender/documentId 使用边界；未修改 manifest。
- RELEASE 以当前 workflow 为准：Node20、npm ci/build、完整 dist、vanishgeo-v<版本>.zip、tag push 直接正式 Release，明确缺失 test/真实 Chrome/版本一致性门禁；repository description/topics 仅人工建议。
- CONTRIBUTING 新增合成数据、验证边界及待人工批准的历史清理方案。NOTICE 保留 MIT 原作品名称/来源链接，仅作归属，不作为安装/更新/发布目的地。
- 清理 public/icons 旧占位操作；test-geolocation 只改展示说明，删除无证据 Google Maps 归因，inline script/style 与任务前逐字一致。
- 提示词包去个人目录，移除重复路线表，明确后续模板以 manifest/用户授权校准。聚合 check 命令原是未来模板举例，改为获批后确定名称并同步 package.json，避免误当当前可执行入口；未实施后续 CI 任务。
- 已跟踪历史 Chrome 记录只脱敏源路径并注明历史 v1.4，不修改其版本/观测/结论或归档状态；HEAD 只读检查确认旧路径仍在 Git 历史。

## 契约与不变量

本任务没有运行时变化。schema v2、storage key/迁移、runtime messages、manifest、权限、host scope、DNR/WebRTC、verified 建立、MAIN/ISOLATED、各 frame documentId、Worker/SharedWorker 及浏览器 API 边界保持原样。没有新依赖、匹配器、配置桥或设备伪装。只更新文档事实和 NOTICE 内容；构建入口/流程不变，NOTICE 由构建原样复制。

幂等、并发、失败恢复与数据迁移未改。文档区分候选 session 和诊断内存 TTL，不承诺瞬时停止已派发采样或超期自动物理擦除。回滚只撤销本任务 docs/治理/展示文案补丁并重建 dist；不恢复真实敏感示例、不撤销既有源码、不触碰浏览器数据。不会 reset/clean、提交或操作远端。

## 最终验证（2026-10-14）

| 命令/核验 | 实际结果 | 边界 |
|---|---|---|
| `npx tsx --test tests/background-services.test.ts tests/diagnostic-report.test.ts tests/leak-test-observation.test.ts tests/extension-wiring.test.ts` | 基线 50/50，exit 0 | Node/mock/VM/静态 |
| `npm run typecheck` | exit 0 | src 静态类型 |
| `npm test` | 96 tests / 96 pass / 0 fail / 0 skipped，exit 0 | 现有 Node/mock/VM/wiring；未新增测试 |
| `npm run build` | exit 0；Vite5.4.21，29 modules，13 copied items，六入口与 assets chunks | 真实构建，不是 Chrome 验收 |
| `git diff --check` | exit 0；收尾状态/记录完成后再核对 | tracked whitespace；新增文件另查 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-004-documentation-privacy` | exit 0；implement/check 各2条有效引用；已删除模板 _example | Trellis context 引用 |
| `python3 "$VG004_TMP/validate-docs.py"` | 定向脚本：本地 Markdown 链接/锚点、npm script、全体维护文本路径/IPv4 分类、新文件 whitespace、保护文件摘要及其他任务块核对通过 | 临时脚本与快照在系统临时目录，不纳入仓库；最终统计见下方收尾 |
| 在 dist 执行 `zip -qr "$VG004_TMP/vanishgeo-v2.1.0.zip" .` 并用 Python zipfile 对比 | 42个文件与整个 dist 相等；六入口/共享chunks、manifest、LICENSE/NOTICE 字节一致 | 本地临时打包，不创建 Release；ZIP交付前删除 |
| `node --input-type=module` 本地服务核验 | createLeakTestServer 在 localhost 临时端口返回 HTML/JS/CSS/经典worker，header echo 返回合成 Accept-Language，5/5，finally关闭 | 实际本地 HTTP；不启动浏览器/请求provider/STUN |

定向脚本第一轮发现旧归档个人路径与模板中未来 check 举例；脱敏/校准后通过，没有通过盲目重复代码门禁来掩盖文档问题。typecheck/test/build 的相关输入未再变化，复用成功证据。

## 搜索命令与结果

从仓库根目录执行（exit 1 在此表示无匹配，不是检查失败）：

```bash
rg -n -i 'vanishme|vanishme-v|90%|type-check|npm run check' README.md INSTALL.md CONFIG_GUIDE.md RELEASE.md PRIVACY.md PERMISSIONS.md CONTRIBUTING.md docs public/icons/README.md test-geolocation.html
rg -n --hidden -g '!.git/**' -g '!node_modules/**' -g '!dist/**' '/(Users|home)/[[:alnum:]_.-]+' .
rg -l --hidden -g '!.git/**' -g '!node_modules/**' -g '!dist/**' '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' .
```

前两项无匹配；IPv4 命中当前文档RFC5737地址、已有合成测试地址/私有分类数据、localhost回环说明。Python对 git ls-files 的 tracked+非忽略untracked文本逐值解析，排除版本字符串，确认没有非文档公网IPv4或个人路径，包含rg默认会忽略但已跟踪的旧归档。原作品名字/链接只保留NOTICE归属，以及源码/测试必要的旧键迁移标识，不是操作说明。

## 未运行与限制

- 未运行真实 Chrome smoke/人工验收/浏览器矩阵：运行时与wiring未变，文档风险由源码、构建与本地静态/HTTP核验覆盖；本次不新增浏览器通过证据。既有VG-003用户确认不扩充为VG-004已人工验收。
- 未运行出口provider或STUN，不部署托管页面，不调用GitHub管理API，不安装/升级依赖；外部链接只核对RFC5737与Chrome Storage官方文档。Node本地HTTP不是Chrome/DNR验收。
- 没有执行CI或发布workflow，它们会产生外部写入。本地ZIP验证不能证明远端Actions/changelog实际成功；RELEASE明确当前workflow缺失门禁。
- Git历史仍有敏感值；四份公开文档的62个本地提交扫描与归档HEAD确认不构成全历史/远端缓存审计。需另行批准清理，不能保证外部副本消失。
- A03 DNR与A04 WebRTC完整生命周期待用户重新分配；后续依赖任务须重新核对，不由VG-003/VG-004完成推断通过。后续任务只列manifest，不实施。

## 状态与人工操作

manifest VG-004 planned → in_progress → review；Trellis planning → in_progress → review，completedAt=null，human_acceptance=pending。依赖VG-003保持done；其他14个manifest任务块逐字未变。只精确放行本任务6个维护记录；没有归档、提交、push、merge、tag、发布、历史重写或后续任务实施。

建议 commit message：`docs: align VanishGeo documentation and privacy boundaries (VG-004)`。

人工repository description/topics见RELEASE；人工验收应核对安装/配置步骤、隐私说明与当前实现、Actions命名及NOTICE归属，确认后才可更新done。

## 收尾核对

最终定向核验通过：196 个维护文本，57 个本地链接/锚点，75 处有效 npm script 引用，37 处 IPv4/版本字符串分类后无非文档公网 IP。扫描包括已经跟踪但当前忽略的归档。脚本排除 shell 搜索模式字面量，避免把查询字符串误判为要执行的 npm 命令。

任务增量共 22 个文件，精确列表见 task.json relatedFiles；任务前 188 个文件内容摘要未变。源码、tests、scripts、fixtures、有效 spec、依赖/lockfile、manifest、Vite 和 workflow 未变；旧图标保留。其他14个manifest任务块逐字一致。test-geolocation的script/style未变，NOTICE构建复制一致。实际增量diff和工作树已检查，未进行bulk staging或提交。

本次没有浏览器进程；localhost核验服务在finally关闭且Node退出0，没有任务后台进程。dist继续作为忽略的本地构建产物保留；临时副本、脚本、日志、增量diff和ZIP在核验结束后删除，清理结果另记。

清理已确认：本任务唯一 mkdtemp 目录已删除并核对不存在；未删除用户资源。清理后核对 git diff --check 与 git status --short，只保留本任务22个维护/文案文件增量及任务前既有修改，manifest/Trellis保持review，人工验收pending。


## 人工验收

验收日期：2026-10-14。验收人：用户。用户在本会话明确确认：

> VG-004 的文档人工验收已通过。请将状态从 review 更新为 done，并同步 manifest 和 Trellis 验收记录，不启动后续任务。

本次确认范围是 VG-004 文档人工验收。用户未提供逐项验收记录、截图或浏览器版本；不将这次文档确认扩充为真实 Chrome、DNR/WebRTC 完整生命周期、Git 历史清理或发布验收。历史敏感值清理和远端 repository 元信息操作仍需各自授权。

根据本次确认，manifest VG-004 从 `review` 更新为 `done`，增加验收人、日期及本节证据引用；Trellis 按既有映射从 `review` 更新为 `completed`，`completedAt` 为 `2026-10-14`，`meta.validation.human_acceptance` 为 `passed`，`meta.human_acceptance` 保存同一验收范围/日期/证据。同步稳定化 README 与验收矩阵。上文 review/pending 和未人工验收的说明保留为本地交付时的历史，当前结论以本节及 manifest 为准。

本次只同步五个状态与验收文件，源码、测试、依赖、manifest.json、构建配置和运行时输入未变化；复用上文已通过的 typecheck、96/96 Node 测试和 build 证据，不重复执行。依赖 VG-003 保持 done，VG-005～VG-014 保持 planned；未启动后续任务、归档、提交、push、merge、创建 tag、发布或重写历史。具体收尾核对结果见下方。

本次收尾核对（2026-10-14）：`git diff --check` exit 0；`python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-004-documentation-privacy` exit 0，implement/check 各2条有效引用。状态/日期/验收人/范围/证据锚点与 task.json 解析、五个目标文件 whitespace 校验通过；实际增量已检查，仅涉及五个状态与验收文件。其他14个manifest任务块逐字未变，其他205个仓库文件的集合与内容摘要未变。没有任务临时文件或后台资源；本次不调用archive/finish，不清理其他会话，既有工作树修改继续保留。
