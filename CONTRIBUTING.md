# 参与 VanishGeo 开发

欢迎通过 [Issues](https://github.com/ccisnoxx/VanishGeo/issues) 报告问题、讨论改进，或通过 Pull Request 贡献代码与文档。项目概况和当前支持范围见 [README](README.md)。

提交较大的功能、权限调整或配置迁移前，建议先用 Issue 说明用户需求、兼容性和影响范围，避免实现与当前项目定位不一致。

## 环境搭建

| 工具 | 要求 |
| --- | --- |
| Node.js | 20 或更高版本；部分自动化 Chrome runner 需要 Node.js 22+ 原生 WebSocket，详见浏览器验证指南。 |
| npm | 使用仓库锁文件，通过 `npm ci` 安装依赖。 |
| 浏览器 | Chrome 138+；语言、时区和定位功能需要正常开启 Allow User Scripts。 |
| Git | 用于获取源码、创建变更分支并提交 PR。 |

以下示例克隆主仓库；没有写权限的贡献者可先 Fork 本项目，再使用自己的 Fork 地址克隆。

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
cd VanishGeo
npm ci
npm run build
```

在 `chrome://extensions/` 开启开发者模式，加载 **dist 文件夹**，开启扩展详情页的 **Allow User Scripts**。打开面板或设置页检查同步状态，再完整刷新目标网页。完整步骤见 [安装指南](INSTALL.md)。

`npm run dev` 持续构建到 `dist/`；代码变更后仍需手动重载扩展和目标页面。`npm run preview` 只提供静态预览，不能替代浏览器扩展环境。

## 目录与代码入口

| 目录 | 用途 |
| --- | --- |
| `src/shared/` | 共享类型、配置模型、匹配解析、存储与纯逻辑。 |
| `src/background/` | 配置操作、脚本注册、请求头规则、WebRTC 策略及诊断协调。 |
| `src/injected/runtime-modules/` | 页面与 Worker 的运行时维护模块，由构建器生成自包含入口。 |
| `src/popup/`、`src/options/` | 扩展面板和设置界面。 |
| `src/diagnostic/`、`src/leak-test/` | 扩展内报告与外部观测页。 |
| `tests/`、`fixtures/` | 单元测试、mock 和浏览器测试资源。 |
| `build/`、`scripts/` | 构建支持、验证和发布工具。 |
| `docs/`、`experiments/` | 专项说明、可复核实验与验收证据。 |

维护源在 `src/`；`dist/` 是生成结果，不直接编辑或提交。配置归一化、匹配解析和持久化分别由 [config-model.ts](src/shared/config-model.ts)、[config-resolver.ts](src/shared/config-resolver.ts)、[storage.ts](src/shared/storage.ts) 负责，避免新增平行匹配器或另一份配置来源。

## 代码规范与功能边界

- 使用 TypeScript，保持严格类型检查；沿用所在模块的缩进、引号和命名方式，避免无关格式化。
- 修改集中于当前问题，复用现有实现与依赖。仅为非显而易见的约束或决策添加注释，文案、日志和文档遵循已有语言约定。
- 在外部输入边界校验数据，内部依赖已建立的类型和不变量；错误应可观察，不以静默默认值代替失败。
- 保持 Manifest V3、Chrome 138 下限、站点规则优先级及每文档快照语义。保留原生 API 透传，不扩大未接管的设备指纹表面。
- 保留已确认出口档案、管理消息来源和权限校验。不得添加网页配置桥、全站静态注入或用旧注入路径绕过用户脚本权限失败。
- 权限、配置格式、迁移、请求头或 Worker 行为变更，应在 PR 中说明兼容性、数据流和验证范围，并同步受影响文档。

现有功能边界以 [配置指南](CONFIG_GUIDE.md)、[权限说明](PERMISSIONS.md) 和 [隐私说明](PRIVACY.md) 为准。

## 测试与检查

提交前运行：

```bash
npm run check
git diff --check
```

`npm run check` 依次执行以下检查，任一步失败立即停止：

| 命令 | 检查范围 |
| --- | --- |
| `npm run typecheck` | 源码 TypeScript 类型。 |
| `npm run typecheck:tests` | 测试及其引用源码的严格类型。 |
| `npm test` | Node 测试、VM 与 mock 回归。 |
| `npm run build` | 生产构建及构建期守卫。 |

开发时可先运行相关测试文件，例如：

```bash
npx tsx --test tests/config.test.ts
```

对新增可观察行为或已复现的回归补充有意义的测试；避免只复述实现的断言。文档或格式改动使用链接、示例和差异检查等适当验证，不需要为文案新增测试框架。

浏览器相关变更应验证实际影响的页面、iframe、Worker 或生命周期场景，记录浏览器版本、平台、候选构建与限制。`npm run test:e2e:chrome -- --dry-run` 只检查入口和打印清单，Node、VM、mock 或 dry-run 均不能写成真实 Chrome 验收通过。工具和命令见 [浏览器验证指南](docs/development/browser-validation.md)。

## 测试数据与产物管理

示例域名使用 `example.com`，公网 IPv4 示例使用 [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737) 文档地址，例如 `192.0.2.10`。坐标和检测响应使用合成数据，不复制个人位置、真实出口或日常浏览器配置。

| 对象 | 处理方式 |
| --- | --- |
| 测试代码、fixtures 和实验实现 | 作为维护源保留；确认不再使用时随对应引用和说明一起调整。 |
| 验收 JSON、截图、失败观测和候选摘要 | 作为可追溯证据保留，不能当作普通测试缓存批量删除。 |
| `dist/`、依赖目录和普通临时报告 | 构建和依赖目录不入库，临时报告放在本次临时目录或明确忽略的位置；清理前确认没有正在使用的浏览器、进程或调试上下文。 |
| 本地 ZIP 和手工输出 | 已绑定候选或用于恢复的文件先保留；确认不再需要且有必要备份后再删除。 |
| 临时浏览器 profile 和日志 | 使用独立临时目录，运行结束后只清理本次创建且已停止使用的对象；不要清理日常 profile。 |

不要把构建目录、缓存、凭据或未经脱敏的报告加入 PR。清理应针对已确认的具体文件，避免直接对整个仓库执行广泛删除。数据生命周期见 [隐私说明](PRIVACY.md)。

## 问题反馈

提交 Issue 时请提供：

1. VanishGeo 版本或提交、浏览器版本、操作系统，以及源码构建或发行包安装方式。
2. 最小复现步骤、合成配置、相关开关和站点规则。
3. 期望结果、实际结果及保存／同步／重载状态。
4. 必要的脱敏日志、截图或报告，并说明是单元测试、静态检查还是真实浏览器观测。

完整导出可能包含公网 IP、坐标、历史、名称和规则。公开前检查 JSON、URL、请求头／Cookie、截图、个人路径与日志，不上传凭据、完整日常浏览器 profile 或未经检查的原始 echo 响应。

## 提交 Pull Request

从清晰命名的变更分支向本项目 `main` 提交 PR，围绕一个具体问题组织改动。说明问题触发方式、最终行为、相关 Issue、执行的检查及尚未验证的范围；文档变更说明调整后的读者入口即可。

提交前审阅准确文件列表和最终差异，保留无关修改，不混入构建产物、依赖更新或大范围格式化。修改公开行为、权限、数据或迁移时，说明用户影响并更新相应测试和文档。CI 通过不代表浏览器场景已人工验收，也不会自动批准发布。

## 许可证与来源

贡献应与项目 [MIT License](LICENSE) 兼容；复用第三方代码时保留相应许可和归属，按需更新 [NOTICE](NOTICE)。来源说明不能因重命名或重构而删除。

构建与发布流程见 [RELEASE](RELEASE.md)。内部协作及历史清理调查保留在 [开发记录](docs/development/project-history.md)，不属于外部贡献者的日常上手步骤。
