# VanishGeo

按站点管理网页语言、时区与合成定位的 Chrome 扩展，让页面语言与 Accept-Language 请求头使用同一套配置，并提供字体暴露过滤、WebRTC 策略控制和扩展内诊断。

[安装](INSTALL.md) · [配置](CONFIG_GUIDE.md) · [隐私](PRIVACY.md) · [问题反馈](https://github.com/ccisnoxx/VanishGeo/issues)

> 当前主分支版本为 **2.1.1，尚未发布**。基于 Manifest V3，最低支持 **Chrome 138**。已发布版本见 [Releases](https://github.com/ccisnoxx/VanishGeo/releases)，其功能范围以对应版本为准。

## 功能

| 功能 | 说明 |
| --- | --- |
| 站点规则 | 按域名及子域名启用保护，更具体的规则优先；语言、时区和位置支持继承、覆盖或禁用。 |
| 语言与时区 | 配置网页语言、语言列表、Intl 与 Date 的语言和时区；提供严格与兼容模式。 |
| 语言请求头 | 从站点语言列表生成对应的 Accept-Language，保持其他请求头原生。 |
| 合成定位 | 使用手工坐标或经用户检测、确认并绑定的出口档案，向支持的页面提供合成位置。 |
| 字体暴露过滤 | 在已启用站点的顶层和普通 iframe 统一过滤固定 43 项字体（含普通简繁中文字体）；其他显式字体正常测量。 |
| Blob Worker 同步 | 页面及已同步 Worker 链中自身新建的 Blob Dedicated Worker 可继承语言和时区，支持 classic 与 module。 |
| WebRTC 策略 | 通过 Chrome privacy API 管理浏览器全局 WebRTC IP 策略，并显示实际控制状态。 |
| 配置与诊断 | 保存自定义环境方案、导入导出配置，并通过扩展内报告检查实际观测值。 |

VanishGeo 不提供 VPN 或代理，不改变网络出口，也不保证匿名、绕过检测或达到特定指纹评分。WebRTC 策略作用于浏览器普通会话，范围大于站点规则。

## 快速开始

### 1. 构建扩展

准备 Node.js 20+ 和 npm：

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
cd VanishGeo
npm ci
npm run build
```

构建结果位于 `dist/`。已有仓库副本可直接在仓库根目录运行安装依赖和构建命令。

### 2. 加载到 Chrome

1. 打开 `chrome://extensions/`，启用“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择 **dist 文件夹**。
3. 打开 VanishGeo 的“详情”，开启 **Allow User Scripts（允许用户脚本）**。
4. 打开扩展面板或设置页，点击“重试同步”。

最低要求为 Chrome 138；其他 Chromium 浏览器需要单独验证 API 和策略支持。完整安装、更新和排查步骤见 [安装指南](INSTALL.md)。

### 3. 配置站点

全新安装默认关闭保护，站点列表为空。打开设置页后：

1. 添加需要启用的站点，例如 `example.com`。
2. 配置语言、时区及所需信号。若使用出口自动模式，主动检测并确认出口档案，再将档案绑定到规则。
3. 开启总开关及目标规则并保存，确认各组件同步成功。
4. **完整刷新或关闭重开目标网页**，让新文档使用新配置。

出口自动模式使用已确认的档案，不会定时联网刷新；更换代理或网络后需要重新检测确认。自定义方案、逐站点覆盖和语言兼容模式见 [配置指南](CONFIG_GUIDE.md)。

## 使用时需要了解

- **配置在新文档生效。** 已打开页面、旧 Worker 和浏览器往返缓存（BFCache）可能保留旧值。保存成功后仍需完整刷新；扩展不会自动刷新页面。
- **可靠关闭从插件总开关开始。** 关闭并保存，等待同步成功，再完整刷新或关闭重开目标页面；之后才按需关闭 Chrome 的 Allow User Scripts。直接关闭 Chrome 开关可能暂时保留旧的语言请求头。
- **页面覆盖有限。** 仅支持普通 HTTP(S) 顶层页面和 iframe；`about:blank`、`srcdoc`、`data:`、`blob:` 文档及特殊 sandbox 场景不在支持范围。
- **Worker 覆盖有限。** HTTP(S) Dedicated Worker、SharedWorker、外来 Blob 和未接管父级的后代未覆盖。Blob 同步受页面 CSP、来源核验等条件限制；“本次语言/时区未同步”警告表示该次 Worker 保持原生加载。
- **定位和字体各有边界。** 合成定位仍受安全上下文和 Permissions Policy 等条件限制；当前仅启用固定内置字体过滤，自定义字体名单暂停，不能隐藏所有字体或消除 Canvas 指纹。

各组件的保存、注册和同步状态分别显示。出现“已保存但未完全生效”时，按具体错误处理并重试同步，不能仅凭保存成功认定页面已生效。

## 隐私与诊断

配置保存在浏览器本地。出口检测仅在用户主动操作时请求外部 IP 定位服务，服务方会看到网络出口 IP；没有后台定时检测或将配置同步到开发者服务器的流程。导出的完整配置可能包含公网 IP、坐标、规则和历史信息，分享前应脱敏。

从扩展面板、设置页或扩展菜单打开“隐私检测”，可查看实际值与扩展预期的比较。外部观测页只显示实际值，未验证或不支持的项目保持 UNKNOWN；WebRTC policy 或空 ICE 结果不能证明所有网络路径均无泄漏。

数据流与存储生命周期见 [隐私说明](PRIVACY.md)，权限用途见 [权限说明](PERMISSIONS.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装指南](INSTALL.md) | 构建、加载、更新、排查与卸载 |
| [配置指南](CONFIG_GUIDE.md) | 站点规则、出口档案、自定义方案与信号设置 |
| [隐私说明](PRIVACY.md) | 外部请求、本地数据与导出边界 |
| [权限说明](PERMISSIONS.md) | Chrome 权限用途和作用范围 |
| [开发指南](CONTRIBUTING.md) | 开发环境、检查要求与问题报告 |
| [浏览器验证](docs/development/browser-validation.md) | 诊断工具、定向验证命令和历史实验边界 |
| [构建与发布](RELEASE.md) | CI、打包与发布流程 |
| [验收证据](docs/stabilization/evidence-index.md) | 已记录的浏览器覆盖范围与已知缺口 |

## 开发与反馈

```bash
npm run check
```

该命令依次执行源码类型检查、测试类型检查、单元测试和生产构建。`npm run dev` 持续构建到 `dist/`，仍需在 Chrome 中手动重载扩展及目标页面；`npm run preview` 仅提供静态预览。

发现问题请通过 [Issues](https://github.com/ccisnoxx/VanishGeo/issues) 提交版本、浏览器环境、复现步骤和脱敏后的观测结果。参与开发前请阅读 [CONTRIBUTING](CONTRIBUTING.md)。

## 许可证与来源

VanishGeo 独立开发和维护，部分代码与功能参考了 [IP-Geolocation](https://github.com/L2OI/IP-Geolocation) 和 [VanishMe](https://github.com/XiNian-dada/VanishMe)。

项目采用 [MIT License](LICENSE)。[LICENSE](LICENSE) 保留来源项目的版权声明和完整许可条款，[NOTICE](NOTICE) 记录代码来源归属。
