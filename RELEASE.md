# VanishGeo 构建与发布说明

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

[CI](.github/workflows/ci.yml) 检查 push/pull_request；[release](.github/workflows/release.yml) 检查 v*.*.* tag push 并发布。稳定化任务完成不授予提交、push、tag、Release、托管部署或远端设置权限；这些操作需对应明确授权。VG-005 建立本地门禁；VG-014 的候选结论、逐项证据、阻断和回滚见 [release-readiness](docs/stabilization/release-readiness.md)。VG-023 仅恢复普通 HTTP(S) 文档语言/时区快照，已于2026-10-16通过用户人工验收；其他页面能力仍暂停，本任务不授权发布。

## 本地候选

当前 package.json、package-lock.json（顶层与根包）和 manifest.json 均为 **2.1.1（未发布候选）**。页面语言/时区需 Chrome138+、userScripts 权限及正常开启 Allow User Scripts，提前注册后新文档使用快照；定位恢复候选见 VG-029；自定义字体和 Worker 仍暂停；HTTP 请求头保持原生，WebRTC 按实际策略状态运行。真正发布时重新检查候选版本。在仓库根目录使用 Node.js 20+、npm 和锁文件：

```bash
npm ci
npm run check
npm run test:e2e:chrome -- --dry-run
git diff --check
```

本次 VG-005 确定聚合入口 `npm run check`，顺序为 `npm run typecheck && npm run typecheck:tests && npm test && npm run build`。任何子命令非零立即停止，不能产生后续构建。`typecheck` 检查 src；`typecheck:tests` 使用继承 strict 的 tsconfig.test.json，涵盖 tests/**/*.ts 及引用源码；tsx 执行测试不替代测试类型检查。`build` 仍自带源码 typecheck，再执行 Vite；不直接修改 dist。npm ci 和 Chrome dry-run 保持单独入口。

真实 Chrome 安装与人工场景需单独记录候选/版本/结果；dry-run 只检查构建入口并打印清单。CI 不执行或宣称完成人工验收。`npm run dev` 是 watch，`npm run preview` 是静态预览。

分发包含完整 dist：manifest、background/content/popup/options/leak-test/diagnostic 六个 JS 入口、页面 HTML/CSS、assets/ 共享 chunks、icons、fixtures、LICENSE 与 NOTICE。后台只导入固定语言/时区模板字符串；完整 runtime 保留隔离测试，构建期均运行自包含守卫。没有独立 injected/runtime.js。ZIP 根部直接含 manifest.json。

VG-014 历史暂停候选的自动真实 Chrome 集成入口（不能作为当前VG-023通过门禁）（Node 22+，需支持 Extensions CDP domain 的 Chrome）：

```bash
node scripts/chrome-integration-smoke.mjs --output <脱敏JSON路径>
node scripts/runtime-modularization/chrome-safety-gate.mjs --output <脱敏JSON路径>
node --import tsx scripts/chrome-intl-smoke.mjs --output <脱敏JSON路径>
```

第一项使用正式 dist、临时 profile、合成 provider 拦截、loopback fixture 和仅本进程的 `.test` host 映射。普通页面仍原生，报告语言/时区与伪装预期不符必须保留 FAIL；runner PASS 表示暂停候选的测试合同通过，不表示完整功能 release-ready。原生位置权限被拒绝；完整诊断仍包含既有 Google STUN，可能看到测试网络出口，证据只保留分类结果。第二项用生产字节一致副本加测试计数 wrapper；第三项的 runtime 模式测试使用独立最小扩展，均不能当作生产派发恢复。

VG-023 生产定向 smoke 与机器证据见 [任务记录](.trellis/tasks/10-16-vg-023-userscripts-language-timezone/implement.md)；原实验与语言/时区生产阶段均已通过用户人工验收，其他页面能力继续暂停；本次没有发布授权，也不启动后续任务。

本地打包与只读核验（归档名须使用本次获准的候选名，不覆盖已有交付）：

```bash
mkdir -p release
(cd dist && zip -r ../release/vanishgeo-v2.1.1-candidate.zip .)
node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.1-candidate.zip --output <脱敏JSON路径>
```

审查器核对版本、权限、入口/资源图、共享 chunk 可达性、远程执行/运行期编译/map/敏感模式和 ZIP 文件/字节一致性。它不能识别所有任意秘密或动态计算 URL，需要与维护源审查共同解释。归档供本地人工检查，未发布；正式发布不得重复利用旧 ZIP 的残留条目。

## GitHub Actions 门禁

| 项目 | 当前行为 |
|---|---|
| CI 触发 | 所有 push 与 pull_request；普通分支/PR 只检查并上传通过门禁的 dist，不创建 Release |
| Release 触发 | push 名称匹配 v*.*.* 的 tag；不自动创建 tag |
| 环境 | ubuntu-latest、Node 20、npm ci；保留现有工具链版本 |
| 同等门禁 | npm ci → 源码 typecheck → 测试 typecheck → npm test → npm run build → Chrome 入口 dry-run；release 在 npm ci 前额外检查版本一致性 |
| 失败传播 | job/step 采用默认成功条件；无 continue-on-error/always；任一门禁失败都跳过后续构建、ZIP、artifact 与 Release |
| 权限 | 两份 workflow 默认 contents: read；只有 release job 为 contents: write；checkout 不持久化 token |
| CI artifact | vanishgeo-ci-<commit SHA>，整个 dist/；30 天保留；缺文件视为错误 |
| 发布 ZIP | vanishgeo-v<版本>.zip；从 dist 内打包完整内容 |
| Release | 保留 softprops/action-gh-release；通过所有门禁和 changelog 后才执行，draft:false、prerelease:false；缺 ZIP 失败 |
| 发布 artifact | vanishgeo-v<版本>，整个 dist/，30 天；同样位于门禁之后 |

release 在安装依赖前运行 `node scripts/check-release-version.mjs "$GITHUB_REF_NAME"`，要求 tag 严格等于 `v` 加 package.json 版本，并核对 package-lock.json 的顶层版本、`packages[""].version` 与 manifest.json。任一项缺失或不一致即非零退出，后续构建、打包与发布均不会执行；检查不改写版本或 tag。版本通过后仍从 tag 去掉开头 v，用于文件名和 Release。例如未来明确批准发布 2.1.1 时，tag 应为 v2.1.1，ZIP 为 vanishgeo-v2.1.1.zip；本文不表示它已经发布。workflow 不等待人工浏览器审批，维护者须在获准触发前核对候选和人工验收。本次仅整理版本、文档和检查，不创建或修改 tag、GitHub Release，也不发布。

## 更新日志与本地回归证据

release checkout 设置 fetch-depth: 0，取得完整分支历史及 tags。`bash scripts/release-changelog.sh` 拒绝 shallow 仓库；从 HEAD 全部祖先可达的版本 tag 中选最近者，并排除指向 HEAD 的全部版本 tag，输出该 tag 到 HEAD 的 commit subject/hash；不误用当前 tag 或未合并分支 tag。首次没有旧版本 tag 时输出全部历史，不替换成笼统描述；Git 错误保持失败并阻止打包。轻量/附注 tag 均由 git describe --tags 处理；同提交的其他 tag 不作为上一版。

changelog 写入 RUNNER_TEMP 文件，经 body_path 传给 Release；提交文本不插入 workflow shell 或多行 GitHub output。提交信息会成为公开 Release notes，维护者仍需遵守合成/脱敏约定并审阅内容。本次不打印真实仓库历史日志，不访问远端管理接口。

`tests/release-gates.test.ts` 核对 workflow 顺序/权限/失败旁路，在临时 npm 项目注入失败证明后续构建未到达，并用临时 Git 仓库验证首发、跨 tag、无关分支、第二父提交的已发布 tag、同提交轻量/附注 tag 及浅克隆。合成 tags 只创建在临时 fixture 仓库，finally 删除；不操作当前仓库 tags。这些是本地/静态证据，未实际运行 GitHub Actions、Release API 或真实 Chrome。

## VG-024 候选与权限退出

VG-028 已于2026-10-20人工验收通过，历史清理及真实Chrome证据保留。本任务按第二阶段删除两项DNR权限与过渡组件，已完成人工验收，仅保留本地候选；不改版本、不创建ZIP、不提交、不发布。

升级验收覆盖已清理VG-028直接升级，以及旧v2跳过清理直接升级。两者都核验同profile同路径、权限确实减少、header原生、配置保存与worker唤醒不依赖DNR。跳级后的旧规则磁盘残留无法在无权限下证明已清除，不得重新授权来制造“清理通过”；本版本不会重新申请DNR，未来重新引入必须先设计独立清理迁移。正式证据只保留布尔/数量/摘要。

VG-025才考虑字体生产恢复，VG-026为推荐引擎，均不实施。回滚只恢复本任务可识别的增量，保留VG-028和用户已有工作；回到VG-028会重新声明过渡DNR权限，需人工决定权限与兼容风险。回旧v2可能重新生成请求头规则，不能承诺无损或同等隐私；先安全备份v3配置，不使用reset/stash覆盖工作。

## 人工发布和恢复

1. 确认获准发布的精确候选、任务清单中的依赖/人工验收、package/lock/manifest/tag 版本及完整 dist；审查要提交的文件，保留无关修改。
2. 确认目标远端是当前仓库，审阅触发 workflow 的 tag 与日志。经对应授权后由维护者提交/推送 tag；本文不提供自动推送或删除远端 tag 的恢复脚本。
3. 在当前仓库的 Actions 与 Releases 页面核对结果、ZIP 清单和安装步骤；更新日志应说明实际变化和已知限制，不宣称未做的验收通过。
4. 构建或发布失败时先查看具体失败和是否已产生 Release/artifact。修复需要新的授权和候选证据；不得盲目删除/移动已发布 tag、重写历史或 force-push。
5. 已发布版本的恢复可由用户重新加载已知可用完整产物，但旧版配置/迁移兼容性必须单独确认；不能承诺降级自动恢复数据。

本地文档、扩展发行与托管诊断页面是不同交付。构建不会部署 hosted 目标；页面部署需要对应授权和部署后核验。安装说明见 [INSTALL](INSTALL.md)，隐私说明见 [PRIVACY](PRIVACY.md)。

## GitHub repository 元信息建议（仅人工设置）

Description：`Chromium MV3 扩展：按站点协调网页语言、时区与位置，保持请求头原生，选择性过滤字体暴露并控制 WebRTC 策略，并提供扩展侧诊断。`

Topics：`vanishgeo`、`chromium-extension`、`manifest-v3`、`privacy`、`geolocation`、`timezone`、`webrtc`、`typescript`。

只建议在当前仓库 Settings/About 中由维护者设置，不调用远端管理 API，不沿用原作品地址创建或关联仓库。原作品归属仅保留于 [NOTICE](NOTICE)。历史敏感值清理是另一项需人工批准的操作，见 [CONTRIBUTING](CONTRIBUTING.md)。


VG-025（2026-10-20）已获用户授权恢复固定内置名单字体过滤；仅启用的HTTP(S) allowlist生效，custom和Worker继续暂停；位置恢复见VG-029。注册成功只代表匹配新文档就绪，旧hook/BFCache须完整重建；恢复授权不等于人工验收通过。详见 [配置指南](CONFIG_GUIDE.md)。
