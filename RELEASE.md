# VanishGeo 构建与发布

本文面向维护者，说明本地检查、完整构建产物、打包审查和 GitHub Actions 发布流程。用户安装见 [安装指南](INSTALL.md)，开发环境见 [开发指南](CONTRIBUTING.md)。

项目仓库为 [ccisnoxx/VanishGeo](https://github.com/ccisnoxx/VanishGeo)，构建结果见 [Actions](https://github.com/ccisnoxx/VanishGeo/actions)，已发布版本见 [Releases](https://github.com/ccisnoxx/VanishGeo/releases)。当前源码版本为 **2.1.1，尚未发布**；本地候选、通过检查与实际发布是不同状态。

2026-10-24 [VG-041 最终候选门禁](docs/stabilization/release-candidate/vg041/README.md)当前决策为 **GO（接受已知限制）**：VG-039已由用户人工验收，剩余Chrome155场景不再补验；Blob警告保持UNCONFIRMED，按用户接受的非阻断已知限制记录。原始门禁、浏览器证据及未运行记录保持。GO决策已获用户验收，现仅授权VG-039验收及VG-041 GO相关资料本地提交；不新增功能、不补测、不推送、不打tag、不创建Release或部署。

## 版本一致性

发布标签必须严格等于 `v` 加源码版本，以下版本字段必须一致：

| 位置 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | 顶层 `version` 和根包 `packages[""].version` |
| `manifest.json` | `version` |
| Git tag | `v<版本>`，例如 `v2.1.1` |

发布工作流在安装依赖前运行 [版本检查脚本](scripts/check-release-version.mjs)。缺失或不一致会终止后续步骤；脚本不自动修改版本或标签。

## 本地检查

使用 Node.js 20+、npm 和锁文件，在仓库根目录运行：

```bash
npm ci
npm run check
npm run test:e2e:chrome -- --dry-run
git diff --check
```

`npm run check` 依次执行源码类型检查、测试类型检查、单元测试和生产构建，任一步失败即停止。测试执行器不能替代测试 TypeScript 类型检查；构建本身也包含源码类型检查。

Chrome dry-run 只检查构建入口并打印清单，不安装扩展、不执行真实浏览器断言。发布前应单独核对目标候选在对应 Chrome 版本、平台和场景上的真实证据；历史证据不能自动覆盖后来改变的功能或所有平台。命令和覆盖范围见 [浏览器验证指南](docs/development/browser-validation.md) 与 [证据索引](docs/stabilization/evidence-index.md)。

## 完整分发目录

维护源位于 `src/`，Vite 输出到 `dist/`。分发必须保留完整目录，ZIP 根部直接包含 `manifest.json`：

- manifest、background／content／popup／options／leak-test／diagnostic 六个脚本入口和对应页面资源。
- `assets/` 共享 chunks、图标和 fixtures。
- 默认启用的 `rules/header-migration-guard.json` 与独立 `font-exposure/filter.js`。
- [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 的完整内容。

不要只复制入口 JavaScript、手工修改构建产物或打包源码目录。没有独立的 `injected/runtime.js` 分发入口；生产注册使用构建中的固定模板。

## 本地打包与审查

使用未被 Chrome 写入 `_metadata` 等缓存的干净构建。若现有目录正在被浏览器使用，保留其缓存，在独立工作副本中重新构建交付目录。为每次候选使用新的归档名，避免更新已有 ZIP 留下旧条目。

以下示例生成本地候选并审查；已有同名 ZIP 时停止，需要更换候选名：

```bash
mkdir -p release &&
  test ! -e release/vanishgeo-v2.1.1-candidate-local.zip &&
  (cd dist && zip -r ../release/vanishgeo-v2.1.1-candidate-local.zip .) &&
  node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.1-candidate-local.zip --output release/artifact-audit.json
```

[产物审查器](scripts/audit-release.mjs) 核对版本、Chrome 138 下限、现行权限、默认隔离规则及维护源字节、固定字体入口、资源图和 ZIP 逐文件字节一致性，并检查远程执行、运行期编译、source map 及部分敏感数据模式。

审查器不能识别所有秘密或动态 URL，需与维护源审查结合。其摘要算法与部分 Chrome runner 不同，摘要不能直接互换。该工具是**手动检查步骤**，目前未接入 CI／Release 工作流；生成候选 ZIP 和报告不会发布版本。

## GitHub Actions

| 项目 | 行为 |
| --- | --- |
| CI 触发 | 所有 push 与 pull_request；通过检查后上传整个 `dist/`，不创建 Release。 |
| Release 触发 | 推送名称匹配 `v*.*.*` 的 tag；工作流不自动创建 tag。 |
| 运行环境 | ubuntu-latest、Node.js 20、`npm ci`。 |
| 共同门禁 | 源码类型检查 → 测试类型检查 → 单元测试 → 构建 → Chrome 入口 dry-run。 |
| 发布额外检查 | 安装依赖前检查版本一致性；构建后生成更新日志，再打包和发布。 |
| 失败处理 | 任一门禁失败会阻止后续构建、打包、上传或发布步骤。 |
| 权限 | 默认 `contents: read`；只有发布 job 使用 `contents: write`，checkout 不持久化凭据。 |
| CI artifact | `vanishgeo-ci-<commit SHA>`，保留 30 天。 |
| 发布产物 | `vanishgeo-v<版本>.zip`，另上传 `vanishgeo-v<版本>` artifact，保留 30 天。 |
| Release 可见性 | 当前工作流创建正式公开 Release，`draft: false`、`prerelease: false`；缺 ZIP 会失败。 |

工作流定义见 [CI](.github/workflows/ci.yml) 和 [Release](.github/workflows/release.yml)。工作流**不会等待人工浏览器审批**；维护者须在明确批准触发前完成候选审查和浏览器核验。

## 更新日志

[更新日志脚本](scripts/release-changelog.sh) 需要完整 Git 历史与标签，拒绝浅克隆。它从 HEAD 的可达祖先中选择最近的历史版本标签，排除指向 HEAD 的版本标签，再列出其后的提交；没有旧版本标签时列出全部历史。未合并分支标签和同提交别名不作为上一版。

更新日志写入临时文件供 Release 使用，生成失败会阻止打包和发布。提交主题会出现在公开 Release notes 中，应审阅准确性和敏感信息，并说明提交历史中已被后续变更替代的行为。候选说明、原始证据和审查摘要见 [候选资料](docs/stabilization/release-candidate/README.md)，其身份不会因后续文档提交自动替换。

## 发布前确认与故障恢复

1. 确认精确候选提交、版本、完整产物、源码审查和适用浏览器证据；如有新变更，重新评估原证据是否适用。
2. 保留语言／请求头同步、文档快照、定位和字体边界，以及当前 Blob Worker 的限定范围；不能把 HTTP(S) Worker、SharedWorker 或未覆盖平台写成已支持。
3. 核对正确远端和发布标签，明确批准后再触发 tag 发布。普通文档更新、CI 通过或本地候选验收均不构成发布批准。
4. 在 Actions 与 Releases 核对结果、ZIP 内容和安装说明。失败时先查明已产生的产物，避免盲目删除或移动已发布标签、重写历史或强推。
5. 恢复旧完整产物前先备份配置，并单独验证迁移和兼容性。降级可能恢复旧请求头行为或丢失新版字段，不能保证无损回退。

扩展发布与托管诊断站点部署是独立交付，本地构建不会部署远端页面。当前权限和数据流分别见 [权限说明](PERMISSIONS.md)、[隐私说明](PRIVACY.md)。

## 许可证与来源

分发包应保留 MIT 许可条款和来源版权声明。VanishGeo 独立开发维护，部分代码与功能参考的项目及其归属记录在 [NOTICE](NOTICE)，完整条款见 [LICENSE](LICENSE)。内部任务、实现迁移和历史发布准备过程见 [开发记录](docs/development/project-history.md)。
