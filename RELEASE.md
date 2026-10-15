# VanishGeo 构建与发布说明

[CI](.github/workflows/ci.yml) 检查 push/pull_request；[release](.github/workflows/release.yml) 检查 v*.*.* tag push 并发布。稳定化任务完成不授予提交、push、tag、Release、托管部署或远端设置权限；这些操作需对应明确授权。VG-005 建立本地门禁；VG-014 的候选结论、逐项证据、阻断和回滚见 [release-readiness](docs/stabilization/release-readiness.md)。当前生产页面伪装保持 VG-011 安全暂停，不能按完整功能候选发布。

## 本地候选

当前 package.json 与 manifest.json 都为 2.1.0；真正发布时重新检查候选版本。在仓库根目录使用 Node.js 20+、npm 和锁文件：

```bash
npm ci
npm run check
npm run test:e2e:chrome -- --dry-run
git diff --check
```

本次 VG-005 确定聚合入口 `npm run check`，顺序为 `npm run typecheck && npm run typecheck:tests && npm test && npm run build`。任何子命令非零立即停止，不能产生后续构建。`typecheck` 检查 src；`typecheck:tests` 使用继承 strict 的 tsconfig.test.json，涵盖 tests/**/*.ts 及引用源码；tsx 执行测试不替代测试类型检查。`build` 仍自带源码 typecheck，再执行 Vite；不直接修改 dist。npm ci 和 Chrome dry-run 保持单独入口。

真实 Chrome 安装与人工场景需单独记录候选/版本/结果；dry-run 只检查构建入口并打印清单。CI 不执行或宣称完成人工验收。`npm run dev` 是 watch，`npm run preview` 是静态预览。

分发包含完整 dist：manifest、background/content/popup/options/leak-test/diagnostic 六个 JS 入口、页面 HTML/CSS、assets/ 共享 chunks、icons、fixtures、LICENSE 与 NOTICE。生产安全暂停期间后台不导入页面 runtime；其维护源保留供隔离验证，构建期仍运行自包含守卫。没有独立 injected/runtime.js。ZIP 根部直接含 manifest.json。

VG-014 当前暂停候选的自动真实 Chrome 集成入口（Node 22+，需支持 Extensions CDP domain 的 Chrome）：

```bash
node scripts/chrome-integration-smoke.mjs --output <脱敏JSON路径>
node scripts/runtime-modularization/chrome-safety-gate.mjs --output <脱敏JSON路径>
node --import tsx scripts/chrome-intl-smoke.mjs --output <脱敏JSON路径>
```

第一项使用正式 dist、临时 profile、合成 provider 拦截、loopback fixture 和仅本进程的 `.test` host 映射。普通页面仍原生，报告语言/时区与伪装预期不符必须保留 FAIL；runner PASS 表示暂停候选的测试合同通过，不表示完整功能 release-ready。原生位置权限被拒绝；完整诊断仍包含既有 Google STUN，可能看到测试网络出口，证据只保留分类结果。第二项用生产字节一致副本加测试计数 wrapper；第三项的 runtime 模式测试使用独立最小扩展，均不能当作生产派发恢复。

本地打包与只读核验（归档名须使用本次获准的候选名，不覆盖已有交付）：

```bash
mkdir -p release
(cd dist && zip -r ../release/vanishgeo-v2.1.0-vg014-candidate.zip .)
node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.0-vg014-candidate.zip --output <脱敏JSON路径>
```

审查器核对版本、权限、入口/资源图、共享 chunk 可达性、远程执行/运行期编译/map/敏感模式和 ZIP 文件/字节一致性。它不能识别所有任意秘密或动态计算 URL，需要与维护源审查共同解释。归档供本地人工检查，未发布；正式发布不得重复利用旧 ZIP 的残留条目。

## GitHub Actions 门禁

| 项目 | 当前行为 |
|---|---|
| CI 触发 | 所有 push 与 pull_request；普通分支/PR 只检查并上传通过门禁的 dist，不创建 Release |
| Release 触发 | push 名称匹配 v*.*.* 的 tag；不自动创建 tag |
| 环境 | ubuntu-latest、Node 20、npm ci；保留现有工具链版本 |
| 同等门禁 | npm ci → 源码 typecheck → 测试 typecheck → npm test → npm run build → Chrome 入口 dry-run |
| 失败传播 | job/step 采用默认成功条件；无 continue-on-error/always；任一门禁失败都跳过后续构建、ZIP、artifact 与 Release |
| 权限 | 两份 workflow 默认 contents: read；只有 release job 为 contents: write；checkout 不持久化 token |
| CI artifact | vanishgeo-ci-<commit SHA>，整个 dist/；30 天保留；缺文件视为错误 |
| 发布 ZIP | vanishgeo-v<版本>.zip；从 dist 内打包完整内容 |
| Release | 保留 softprops/action-gh-release；通过所有门禁和 changelog 后才执行，draft:false、prerelease:false；缺 ZIP 失败 |
| 发布 artifact | vanishgeo-v<版本>，整个 dist/，30 天；同样位于门禁之后 |

版本仍从 tag 去掉开头 v，用于文件名和 Release，不改写 package/manifest，也未新增两份版本与 tag 的自动一致性检查。例如实际批准 2.1.0 时，tag 为 v2.1.0，ZIP 为 vanishgeo-v2.1.0.zip。workflow 不等待人工浏览器审批，维护者须在获准触发前核对候选和人工验收。VG-014 只核验本地候选的 package/lock/manifest 与 ZIP 一致性，不扩大为自动发布流程改造。当前工作树包含未提交的稳定化波次，正式候选提交与精确 tag 一致性须在未来授权发布时重新确认。

## 更新日志与本地回归证据

release checkout 设置 fetch-depth: 0，取得完整分支历史及 tags。`bash scripts/release-changelog.sh` 拒绝 shallow 仓库；从 HEAD 全部祖先可达的版本 tag 中选最近者，并排除指向 HEAD 的全部版本 tag，输出该 tag 到 HEAD 的 commit subject/hash；不误用当前 tag 或未合并分支 tag。首次没有旧版本 tag 时输出全部历史，不替换成笼统描述；Git 错误保持失败并阻止打包。轻量/附注 tag 均由 git describe --tags 处理；同提交的其他 tag 不作为上一版。

changelog 写入 RUNNER_TEMP 文件，经 body_path 传给 Release；提交文本不插入 workflow shell 或多行 GitHub output。提交信息会成为公开 Release notes，维护者仍需遵守合成/脱敏约定并审阅内容。本次不打印真实仓库历史日志，不访问远端管理接口。

`tests/release-gates.test.ts` 核对 workflow 顺序/权限/失败旁路，在临时 npm 项目注入失败证明后续构建未到达，并用临时 Git 仓库验证首发、跨 tag、无关分支、第二父提交的已发布 tag、同提交轻量/附注 tag 及浅克隆。合成 tags 只创建在临时 fixture 仓库，finally 删除；不操作当前仓库 tags。这些是本地/静态证据，未实际运行 GitHub Actions、Release API 或真实 Chrome。

## 人工发布和恢复

1. 确认获准发布的精确候选、manifest 中的依赖/人工验收、package/manifest/tag 版本及完整 dist；审查要提交的文件，保留无关修改。
2. 确认目标远端是当前仓库，审阅触发 workflow 的 tag 与日志。经对应授权后由维护者提交/推送 tag；本文不提供自动推送或删除远端 tag 的恢复脚本。
3. 在当前仓库的 Actions 与 Releases 页面核对结果、ZIP 清单和安装步骤；更新日志应说明实际变化和已知限制，不宣称未做的验收通过。
4. 构建或发布失败时先查看具体失败和是否已产生 Release/artifact。修复需要新的授权和候选证据；不得盲目删除/移动已发布 tag、重写历史或 force-push。
5. 已发布版本的恢复可由用户重新加载已知可用完整产物，但旧版配置/迁移兼容性必须单独确认；不能承诺降级自动恢复数据。

本地文档、扩展发行与托管诊断页面是不同交付。构建不会部署 hosted 目标；页面部署需要对应授权和部署后核验。安装说明见 [INSTALL](INSTALL.md)，隐私说明见 [PRIVACY](PRIVACY.md)。

## GitHub repository 元信息建议（仅人工设置）

Description：`Chromium MV3 扩展：按站点管理语言、时区与位置，控制 Accept-Language 和 WebRTC 策略，并提供扩展侧诊断。`

Topics：`vanishgeo`、`chromium-extension`、`manifest-v3`、`privacy`、`geolocation`、`timezone`、`accept-language`、`webrtc`、`typescript`。

只建议在当前仓库 Settings/About 中由维护者设置，不调用远端管理 API，不沿用原作品地址创建或关联仓库。原作品归属仅保留于 [NOTICE](NOTICE)。历史敏感值清理是另一项需人工批准的操作，见 [CONTRIBUTING](CONTRIBUTING.md)。
