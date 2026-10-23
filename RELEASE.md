# VanishGeo 构建与发布说明

项目仓库：[ccisnoxx/VanishGeo](https://github.com/ccisnoxx/VanishGeo)；构建结果见 [Actions](https://github.com/ccisnoxx/VanishGeo/actions)，已发布版本见 [Releases](https://github.com/ccisnoxx/VanishGeo/releases)。

当前交付合同以本文、[安装说明](INSTALL.md)、[权限说明](PERMISSIONS.md)和 [稳定化清单](docs/stabilization/task-manifest.yaml) 为准。36 项任务（含 VG-033～VG-037）均已人工验收为 done；VG-037仅批准发布资料对齐和本地候选ZIP核验；完整索引见 [验收证据](docs/stabilization/evidence-index.md)。[VG-014 报告](docs/stabilization/release-readiness.md)保留历史候选事实，不能作为当前构建的发布批准。

[CI](.github/workflows/ci.yml) 检查 push/pull_request；[release](.github/workflows/release.yml) 在 v*.*.* tag push 后检查并直接发布。任务完成不授予提交、push、tag、Release、托管部署或远端设置权限，需对应明确授权。

## 本地候选

当前 package.json、package-lock.json（顶层与根包）和 manifest.json 均为 **2.1.1（本地候选）**，本轮不改版本。Chrome 138+、userScripts 权限及正常开启 Allow User Scripts 是语言／时区与合成定位的前提。VG-032 已恢复同一语言 payload 的 Accept-Language 同步，必要权限为 declarativeNetRequestWithHostAccess；固定名单字体过滤和 WebRTC 独立报告。页面及已同步Blob链内各realm安装后自身创建的Blob Dedicated Worker已按VG-033／VG-034限定范围同步语言时区；HTTP(S) Worker、SharedWorker、自定义字体继续暂停。

可靠关闭使用插件总开关，等待保存／同步后完整重载文档，再按需关闭 Allow User Scripts。直接关闭 Chrome 开关仍可能让首请求带旧语言头；不承诺跨 API 原子同步。旧文档和 BFCache 保留旧快照。当前证据边界及发布前待办见 [发布校准记录](docs/stabilization/release-calibration.md)。

仓库根目录使用 Node.js 20+、npm 和锁文件：

```bash
npm ci
npm run check
npm run test:e2e:chrome -- --dry-run
git diff --check
```

VG-005 建立的聚合入口为 `npm run check`，顺序为 `npm run typecheck && npm run typecheck:tests && npm test && npm run build`。任何子命令非零立即停止，不能产生后续构建。`typecheck` 检查 src；`typecheck:tests` 使用继承 strict 的 tsconfig.test.json，涵盖 tests/**/*.ts 及引用源码；tsx 执行测试不替代测试类型检查。`build` 仍自带源码 typecheck，再执行 Vite；不直接修改 dist。npm ci 和 Chrome dry-run 保持单独入口。

真实 Chrome 安装与人工场景需单独记录候选/版本/结果；dry-run 只检查构建入口并打印清单。CI 不执行或宣称完成人工验收。`npm run dev` 是 watch，`npm run preview` 是静态预览。

分发包含完整 dist：manifest、background/content/popup/options/leak-test/diagnostic 六个 JS 入口、页面 HTML/CSS、assets/ 共享 chunks、icons、fixtures、LICENSE 与 NOTICE。还必须包含默认启用的 rules/header-migration-guard.json 和独立 font-exposure/filter.js。后台使用固定语言／时区与独立定位模板；完整 runtime 保留隔离测试，构建期运行自包含守卫。没有独立 injected/runtime.js。ZIP 根部直接含 manifest.json。

真实 Chrome 证据按各任务记录解释：VG-026 推荐流程、明确应用及关闭恢复，VG-029 定位恢复，VG-030 字体故障恢复，VG-031 语言列表和 VG-032 请求头同步／完整退出重启，见 [证据索引](docs/stabilization/evidence-index.md)。VG-014 的旧暂停 runner、旧完整 runtime 隔离实验及 Chrome dry-run 均不能代替当前候选的真实 Chrome 验收。VG-033／VG-034有当前Chrome实测，VG-036补充Chrome138 Blob及嵌套Blob定向验收；VG-035的HTTP包装反例支持继续暂停。任何新候选的改动须评估已有证据是否仍适用。

本地打包与只读核验（下列命令用于未被Chrome写入`_metadata`的干净dist；已在Chrome中加载的目录请保留浏览器缓存，按[VG-037记录](.trellis/tasks/10-23-vg-037-release-candidate-alignment/implement.md)使用独立交付快照。归档名须使用本次获准候选名，且目标ZIP必须不存在，避免更新旧归档留下旧条目）：

```bash
mkdir -p release
(cd dist && zip -r ../release/vanishgeo-v2.1.1-candidate-vg037.zip .)
node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.1-candidate-vg037.zip --output <脱敏JSON路径>
```

审查器核对版本、Chrome 138 下限、现行精确权限集合、默认启用的静态隔离规则及其维护源字节、独立字体入口、入口/资源图、共享 chunk 可达性、远程执行/运行期编译/map/敏感模式和 ZIP 文件/字节一致性。它不能识别所有任意秘密或动态计算 URL，需要与维护源审查共同解释。报告摘要采用相对路径 localeCompare 排序的 [path, SHA-256] JSON 再 SHA-256，不能与使用路径加文件字节的 Chrome runner 摘要直接比较。归档供本地人工检查，未发布；审查器目前是手动步骤，未接入 CI / release workflow。

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

release 在安装依赖前运行 `node scripts/check-release-version.mjs "$GITHUB_REF_NAME"`，要求 tag 严格等于 `v` 加 package.json 版本，并核对 package-lock.json 的顶层版本、`packages[""].version` 与 manifest.json。任一项缺失或不一致即非零退出，后续构建、打包与发布均不会执行；检查不改写版本或 tag。版本通过后仍从 tag 去掉开头 v，用于文件名和 Release。例如未来明确批准发布 2.1.1 时，tag 应为 v2.1.1，ZIP 为 vanishgeo-v2.1.1.zip；本文不表示它已经发布。workflow 不等待人工浏览器审批，维护者须在获准触发前核对候选和人工验收。本轮仅核对版本、校准文档和检查，不创建或修改 tag、GitHub Release，也不发布。

## 更新日志与本地回归证据

release checkout 设置 fetch-depth: 0，取得完整分支历史及 tags。`bash scripts/release-changelog.sh` 拒绝 shallow 仓库；从 HEAD 全部祖先可达的版本 tag 中选最近者，并排除指向 HEAD 的全部版本 tag，输出该 tag 到 HEAD 的 commit subject/hash；不误用当前 tag 或未合并分支 tag。首次没有旧版本 tag 时输出全部历史，不替换成笼统描述；Git 错误保持失败并阻止打包。轻量/附注 tag 均由 git describe --tags 处理；同提交的其他 tag 不作为上一版。

changelog 写入 RUNNER_TEMP 文件，经 body_path 传给 Release；提交文本不插入 workflow shell 或多行 GitHub output。提交信息会成为公开 Release notes，维护者仍需遵守合成/脱敏约定并审阅内容。当前实际生成预览及审阅范围见 [候选资料收尾](docs/stabilization/release-candidate/README.md)；不访问远端管理接口。

`tests/release-gates.test.ts` 核对 workflow 顺序/权限/失败旁路，在临时 npm 项目注入失败证明后续构建未到达，并用临时 Git 仓库验证首发、跨 tag、无关分支、第二父提交的已发布 tag、同提交轻量/附注 tag 及浅克隆。合成 tags 只创建在临时 fixture 仓库，finally 删除；不操作当前仓库 tags。这些是本地/静态证据，未实际运行 GitHub Actions、Release API 或真实 Chrome。

## 历史权限迁移与现行边界

VG-028 完成旧请求头清理，VG-024 随后移除 DNR 权限，均是历史阶段。VG-032 已获重新授权，采用默认静态 allow 隔离、已知旧规则迁移、dynamic 40000..49999 持久投影及写前隔离；未知范围冲突保留并报告。当前仅声明 declarativeNetRequestWithHostAccess，不恢复普通 declarativeNetRequest。细节见 [权限说明](PERMISSIONS.md)与 VG-032 记录。

降级可能重新生成旧请求头规则或遇到配置不兼容，不能承诺无损或同等隐私。先安全备份配置，按明确候选验证迁移；不使用 reset/stash 覆盖用户工作。

## 人工发布和恢复

1. 确认获准发布的精确候选、任务清单中的依赖/人工验收、package/lock/manifest/tag 版本及完整 dist；审查要提交的文件，保留无关修改。
2. 确认目标远端是当前仓库，审阅触发 workflow 的 tag 与日志。经对应授权后由维护者提交/推送 tag；本文不提供自动推送或删除远端 tag 的恢复脚本。
3. 在当前仓库的 Actions 与 Releases 页面核对结果、ZIP 清单和安装步骤；更新日志应说明实际变化和已知限制，不宣称未做的验收通过。
4. 构建或发布失败时先查看具体失败和是否已产生 Release/artifact。修复需要新的授权和候选证据；不得盲目删除/移动已发布 tag、重写历史或 force-push。
5. 已发布版本的恢复可由用户重新加载已知可用完整产物，但旧版配置/迁移兼容性必须单独确认；不能承诺降级自动恢复数据。

本地文档、扩展发行与托管诊断页面是不同交付。构建不会部署 hosted 目标；页面部署需要对应授权和部署后核验。安装说明见 [INSTALL](INSTALL.md)，隐私说明见 [PRIVACY](PRIVACY.md)。

## GitHub repository 元信息建议（仅人工设置）

Description：`Chromium MV3 扩展：按站点协调网页语言、时区与位置，同步语言请求头，选择性过滤字体暴露并控制 WebRTC 策略，并提供扩展侧诊断。`

Topics：`vanishgeo`、`chromium-extension`、`manifest-v3`、`privacy`、`geolocation`、`timezone`、`webrtc`、`typescript`。

只建议在当前仓库 Settings/About 中由维护者设置，不调用远端管理 API，不沿用原作品地址创建或关联仓库。原作品归属仅保留于 [NOTICE](NOTICE)。历史敏感值清理是另一项需人工批准的操作，见 [CONTRIBUTING](CONTRIBUTING.md)。
