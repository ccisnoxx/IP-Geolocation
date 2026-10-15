# VG-005 执行证据

## 基线与计划

2026-10-14，stabilize/VG-005，5701b55。已执行 pwd、git status --short、git branch --show-current、git log -1 --oneline；保留前序任务未提交工作和图标。读取适用 AGENTS/RTK、Trellis workflow、目录/质量规范、稳定化 README/manifest/矩阵、VG-004 记录及相关实现/测试/公开文档。已输出完整 preflight，task.py create 创建标准记录。

基线 `npm ci && npm run typecheck && npm test && npm run build` exit 0；96/96 tests，Vite 5.4.21、29 modules、13 copied items。额外探测命令 `npx tsc --noEmit --target ES2020 --module ES2020 --lib ES2020,DOM --moduleResolution node --strict --esModuleInterop --skipLibCheck --resolveJsonModule --types chrome,node tests/*.test.ts` exit 2，3 文件12处既有类型错误：globalProfile/rules 夹具缺字段和 ScriptInjection 联合类型 args 未收窄。此为新门禁暴露的可区分类型缺口，不是阻塞性基线失败。

实施顺序：校准 manifest/in_progress；新增两套同等门禁与测试类型；修正必要夹具并实现可验证 changelog；定向失败/历史测试及最低门禁；独立审查；检查增量/临时资源；同步 review，人工验收 pending。

## 实现与合同

- 新增 .github/workflows/ci.yml，在所有 push/pull_request 执行锁文件安装、源码类型、测试类型、测试、构建及 Chrome dry-run；之后才能上传完整 dist。
- release.yml 在 v*.*.* tag push 上先执行同等门禁；changelog 成功后才 ZIP，再创建 Release/上传 artifact。默认成功条件、无 continue-on-error/always 或错误吞掉。两份 workflow 默认 contents: read；仅 release job contents: write，checkout persist-credentials:false。ZIP/tag 命名和正式 Release 行为保留；版本一致性与人工审批门禁未提前实现。
- package.json 新增 typecheck:tests 和 check；check 使用 && 聚合 typecheck、typecheck:tests、test、build。保留 build 自带源码检查；无依赖或 lockfile 变化。tsconfig.test.json 继承 strict，include tests/**/*.ts，不削弱生产类型。
- 三个既有测试文件只修夹具类型：通过 config-model 现有归一化补齐配置，补 SiteRule 空绑定，并断言 args 分支收窄 Chrome ScriptInjection；保留所有原断言。
- release checkout fetch-depth:0；release-changelog.sh 拒绝 shallow，用全部 HEAD 祖先可达 tag，按 peeled commit 排除指向 HEAD 的所有版本 tag，再选最近版本。无旧 tag 时输出全部提交；Git 错误传播。subject/hash 写 stdout→RUNNER_TEMP→body_path，不插入 shell 或多行 GitHub output。
- README/CONTRIBUTING/RELEASE、质量规范及稳定化入口同步。只校准 VG-005 manifest 块；A05 原注入生命周期保留为待重新分配的缺口，其他14任务块逐字不变。VG-006/007 等任务仍需核对实际浏览器前提。

## 失败证据与修正

1. 新增回归检查套用旧 release workflow 的临时副本，缺失类型/测试门禁导致预期 ERR_ASSERTION，证明检查可识别原缺口；未修改当前仓库旧文件。
2. 临时 npm 项目逐项注入非零；测试项执行故意断言失败的 Node test，确认 test 非零且 build 未到达。第一次嵌套 Node test 继承 NODE_TEST_CONTEXT，递归 runner 跳过内层测试，导致新增检查失败（99 pass/1 fail）；仅从子进程 env 副本删除该变量后，失败定向 1/1、最终100/100通过，不改外层环境或生产行为。
3. 首次 fresh critical_reviewer 发现 P2：HEAD^ 遗漏第二父分支已发布tag。先增加真实合并图，`npx tsx --test --test-name-pattern=changelog tests/release-gates.test.ts` 对旧脚本按预期失败，输出自 v1.1.0 且重复已发布分支提交，而应自 v1.2.0。修改全祖先/HEAD全部tag排除后，同命令1/1通过；最新四项定向及100项完整测试均通过。
4. 新 fresh critical_reviewer 对该修正独立复核，未确认可行动缺陷；静态核对Git失败传播、轻量/附注tag、合并图与文档。两次审查都只读，未重复全套门禁；最终审查期间220个仓库文件集合/摘要未变。首次审查期间主代理仅调整已声明的测试环境隔离，后续脚本/文档修正均由主代理完成。

## 最终验证（2026-10-14）

本地 Node v24.16.0 / npm 11.13.0；workflow 声明 Node20，未在远端或另一个Node20环境执行。表内源码/build成功后输入未变化，复用其证据；最终测试类型与测试均在最新候选执行。

| 精确命令/检查 | 实际结果 | 证据边界 |
|---|---|---|
| npm ci | exit 0，安装50包 | 使用原lock，无新增/升级依赖 |
| npm run typecheck | exit 0；基线及check/build中成功 | src静态类型 |
| npm run typecheck:tests | 最新候选exit 0 | strict tests及引用源码 |
| npm test | 最新含合并历史候选exit 0，100 tests/100 pass/0 fail/0 skipped | Node/VM/mock/静态，含临时Git与失败注入 |
| npm run build | exit 0，Vite5.4.21、29 modules、13 copied items；六入口及共享chunks | 真实构建；构建输入之后未变 |
| npm run check | 实际执行exit 0，四子命令均成功；随后测试夹具/changelog修正由最新类型、定向及完整测试覆盖 | 本地聚合入口；源码/build证据复用 |
| npm run test:e2e:chrome -- --dry-run | exit 0，入口/必需产物和清单可解析 | 未启动浏览器，无人工验收 |
| npx tsx --test tests/release-gates.test.ts | 最新exit 0，4/4；覆盖门禁顺序/权限、四项失败传播、strict入口、合成Git历史 | 包含第二父tag、HEAD多个轻量/附注tag、首发、跨tag、无关分支和浅克隆 |
| npx tsx --test --test-name-pattern='本地 check' tests/release-gates.test.ts | 环境隔离修正后exit 0，1/1 | 真正的失败Node test阻断后续build |
| npx tsx --test --test-name-pattern=changelog tests/release-gates.test.ts | 修正前预期失败，修正后exit0，1/1 | 只使用临时fixture tags，不操作当前仓库tags |
| bash -n scripts/release-changelog.sh | exit 0 | Bash语法 |
| git diff --check | exit 0；最终记录同步后再检查 | tracked diff whitespace；本任务23文件另查无行尾空白 |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-005-ci-release-gates | exit 0，implement/check各3条有效引用 | 标准Trellis context，无模板行 |
| Ruby/Psych解析两份workflow | exit 0，均含jobs | YAML语法；未安装actionlint，不代表远端Actions通过 |

实际 YAML 命令：

```bash
ruby -e 'require "yaml"; ARGV.each { |f| data = YAML.load_file(f); abort "missing jobs" unless data["jobs"]; puts "YAML parse OK: #{f}" }' .github/workflows/ci.yml .github/workflows/release.yml
```

文档本地链接目标、23个任务维护文本的行尾空白/个人绝对路径检查通过；197个任务前非本任务文件内容摘要保持一致。完整增量、working tree与秘密/无关改动边界已检查。没有生产源码、tsconfig.json、manifest.json、vite.config.ts、lockfile或前序任务记录增量。

## 不变量、隐私和恢复

schema v2、storage/迁移、runtime message、MV3 manifest、动态allowlist、可信sender/documentId、MAIN/ISOLATED、top frame/iframe/worker、DNR/WebRTC、verified和设备API透传均未变；不新增配置事实来源或页面桥，不扩大扩展权限。仅GitHub job contents写权限收窄，扩展PERMISSIONS无须修改。

没有新的运行时幂等/并发或数据恢复语义；Actions各自隔离工作目录，失败跳过后续步骤。重新运行仍经过门禁，不承诺已有Release/API部分失败可自动事务回滚。回滚只撤销VG-005的23文件增量（共享文档按补丁撤销），保留前序工作/用户图标与浏览器数据；不移动tag、不改历史/远端。脚本stdout不是被shell再次求值的数据。

npm ci使用锁文件，可能访问npm registry；官方Actions文档只读核对。未请求出口provider/STUN/诊断站点，未创建当前仓库tag、ZIP/Release或上传artifact。合成Git fixtures只用保留域名身份/空提交，不写真实IP/位置/凭据；临时仓库与失败npm项目finally删除。未来发布会公开commit subject/hash及dist，维护者仍需审阅脱敏候选与提交信息。

## 独立审计与状态

SUBAGENT_EXECUTION_DIGEST由工具生成，两个fresh critical_reviewer逻辑任务均按审查交付验收，不代表VG-005人工验收。plan/dispatch/summary/digest/audit-finalize/audit-verify均通过；无残留活跃worker、无未知写入。audit_id：20261014T140340Z-vg-005-ci-release-gates-review-da57b24a；本地受控审计Bundle保留90天，不把个人路径写入仓库。

manifest planned→in_progress→review；Trellis planning→in_progress→review，completedAt:null，human_acceptance:pending。依赖VG-004保持done；其他任务未实施、未改状态。无提交、staging、push、merge、当前仓库tag、Release、部署或历史重写。

## 未执行与已知限制

未实际执行GitHub Actions、Release API、分支保护/远端设置或Node20环境；没有真实Chrome smoke/人工验收/浏览器矩阵。本次只改变门禁与测试类型，浏览器入口由dry-run验证；它不产生浏览器通过证据。actionlint不在本地环境；现有工具已提供YAML解析、wiring与失败传播证据，不引入新依赖。

远端工作流的首次实际运行仍需对应授权；package/manifest/tag版本一致性、人工批准与完整发行候选验收属于VG-014。Git命令任意故障注入未执行，失败传播经过静态审查；正常/浅克隆和合并图经过实际Git运行。A05原注入生命周期、A03 DNR/A04 WebRTC完整验收仍是既有缺口，本任务不补足。

后续只列manifest VG-006～VG-014，须各自明确授权并重新核对依赖/领域前提，不自动实施。建议commit message：`ci: gate VanishGeo CI and releases on checks (VG-005)`。

## 收尾

系统临时目录中的内容摘要、增量diff、一次性脚本副本、临时日志与红灯证据在结果整理后删除。保留既有忽略dist作为本地构建结果、原依赖缓存及受控审计Bundle；无新增浏览器、server或后台端口。最终清理与状态核验结果见下方。

收尾已确认：唯一任务系统临时目录已删除，测试临时npm/Git仓库由finally清理；两名审查者已结束，无任务浏览器/server/后台端口。最终git diff --check通过，git status --short保留23个VG-005增量及任务前已有修改；暂存区为空。manifest/Trellis均为review，completedAt:null、human_acceptance:pending。保留dist、依赖与正式审计Bundle的原因见上文。

## 人工验收

验收日期：2026-10-14。验收人：用户。用户在本会话明确确认：

> VG-005 的本地人工验收已通过。请将状态从 review 更新为 done，并同步 manifest 和 Trellis 验收记录；不启动后续任务，不提交、push、打 tag 或发布 Release。

确认范围为VG-005本地人工验收，重点对应失败阻止后续产物与发布的本地/静态证据、测试TypeScript检查及跨tag changelog。用户未提供逐项命令输出、截图或本次Node/npm版本；此处记录用户明确确认，不伪造新的代理执行结果。人工步骤要求不创建新tag，既有自动回归中的临时合成tag证据仍只属于此前实施阶段。

本次确认不扩大为真实GitHub Actions、Release API、Node20环境或真实Chrome人工验收通过，也不补足原注入生命周期、DNR/WebRTC等既有浏览器缺口。上文review/pending与未人工验收的描述保留为本地交付时历史，当前结论以本节及manifest为准。

根据明确确认，manifest VG-005由review更新为done，补充验收人、日期及本节证据；Trellis按仓库既有映射由review更新为completed，completedAt为2026-10-14，meta.validation.human_acceptance为passed，meta.human_acceptance保存同一范围/日期/证据。同步稳定化README与验收矩阵。依赖VG-004保持done；其他任务不改状态、不启动实施。不归档、不提交、不push、不创建tag、不发布或操作远端设置。

本轮只同步五个状态与验收文件；源码、workflow、测试、依赖、manifest.json、构建配置和运行时输入不变，复用此前通过的源码/测试类型检查、100/100测试、build及Chrome dry-run证据，不重复运行这些门禁。本轮的JSON/YAML、证据锚点、Trellis context、diff/whitespace与增量保护检查另行核验。

本轮收尾核验（2026-10-14）：git diff --check exit 0；task.py validate exit 0，implement/check各3条有效引用。JSON/YAML状态、日期、验收人和证据锚点一致；实际增量仅上述五个文件，其他215个仓库文件与14个manifest任务块保持一致。HEAD、tags、暂存区未变，无后续任务实施或运行时资源；本轮唯一系统临时快照目录已清理。未调用archive/finish或任何提交、push、tag、Release操作。
