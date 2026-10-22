# VanishGeo

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；Geolocation / Permissions geolocation、Worker / SharedWorker 继续暂停；字体暴露过滤仍暂停，配置仅保存。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

当前源码版本为 **2.1.1（未发布）**。VanishGeo 是 Chromium Manifest V3 扩展，按站点规则管理页面语言/时区快照，保持 HTTP 请求头原生，并管理浏览器 WebRTC IP 策略。其他页面能力仍暂停。它不提供 VPN 或代理，不改变普通网页请求的公网出口，也不保证匿名、绕过检测或任何指纹评分。

## 当前能力与边界

- 启用的域名 allowlist 规则继承全局设置，可配置语言、时区、位置的逐规则覆盖或禁用。
- MAIN-world runtime 维护源仍保留用于隔离测试；生产后台已移除其调用依赖。ISOLATED 初始化脚本已撤销，残留通知也在后台拒绝。没有静态全站注入或页面可控配置桥。
- 不再修改 `Accept-Language` 或其他 HTTP 请求头；网页语言可以与原生请求头不同。当前版本不再申请 DNR 权限或调用 DNR API。跳过 VG-028 的旧版升级可能留下不可启用的磁盘旧规则；未来重新引入 DNR 必须先设计独立清理迁移。
- WebRTC 使用 Chrome privacy API 的全局策略，提供 strict、compatible 和 default；该设置影响浏览器普通会话，范围大于站点 allowlist。实际控制权和 ICE 结果需要分别观察。
- 配置保存、worker 初始化和扩展 update 时由后台串行对账：先撤销失效/范围变化的注册，再更新保留规则，最后新增并读回验证。Popup/Options 分别显示 API/权限/用户开关不可用、注册失败、注册成功需重载或新文档可用；不自动刷新页面。
- 出口位置只在用户点击检测或重新检测时请求外部 provider。候选确认后保存为 verified 档案，auto 位置/时区必须在每条规则上显式绑定该档案。**没有后台定时刷新**；更换代理或网络后需要主动重新检测。
- 支持自定义环境方案、配置导入/导出；字体配置仅保存、不生产派发；同源 HTTP(S) Worker/SharedWorker 的语言/时区包装继续暂停。不新增 GPU、Audio、screen 等设备伪装。
- 可保存全局时区与 Locale `strict`/`compatible` 模式。其保留语义分别为强制一致性、保留页面显式参数并只补默认值；仅随已验收的语言/时区注册用于匹配新文档，不恢复其他页面能力；精确语义见 [配置指南](CONFIG_GUIDE.md#时区与-locale-模式)。
- 扩展侧一次性诊断报告比较实际值与留在扩展内部的预期值；外部诊断页只做 observation，不给出配置验收 PASS/FAIL。

## 选择性字体暴露过滤（维护源，生产暂停）

配置为 `fontExposure`，默认关闭，支持16项厂商／软件内置名单和自定义名单。v3替代旧canvas配置；当前仅保存配置和维护隔离测试源，不向生产文档派发。维护源仅处理目标 `measureText()` 与 `FontFaceSet.check()`；普通字体、绘制、像素和图像导出保持原生。不承诺覆盖DOM、local()或Worker字体。

## 安装与构建

在仓库根目录使用 Node.js 20+ 和 npm（当前 release workflow 使用 Node 20）：

```bash
npm ci
npm run typecheck
npm run typecheck:tests
npm test
npm run build
```

在 `chrome://extensions/` 启用开发者模式，选择“加载已解压的扩展程序”，加载构建后的 **`dist/`**。manifest 声明最低 Chrome 138，并需在扩展详情页开启 Allow User Scripts；其他 Chromium 浏览器的 API 和策略支持需要单独验证。完整步骤见 [INSTALL](INSTALL.md)，首次配置见 [CONFIG_GUIDE](CONFIG_GUIDE.md)。全新安装默认关闭总开关、站点列表为空，WebRTC 使用 browser default；安装后可在 Options 引导主动检测并确认出口、选择站点、明确启用，也可跳过保持关闭。已有 v2 配置升级至 v3，保留规则、档案和自定义设置，不套用新安装默认值；auto 仍需显式绑定 verified 档案。

`npm run check` 聚合源码类型、测试类型、单元测试和构建，任一步失败立即停止；完整 CI/发布门禁见 [RELEASE](RELEASE.md)。

开发模式 `npm run dev` 是构建 watch，仍需加载/重载 dist。`npm run preview` 仅启动静态预览，不能代替 Chrome 扩展环境。六个入口、HTML/CSS、manifest、图标、fixtures、许可证及 `assets/` 共享 chunks 一起构成 dist，不能只复制入口 JS。

## 诊断

从 Popup、Options 或扩展菜单打开“隐私检测”，进入仅扩展可访问的 `diagnostic/report.html`。报告可打开固定 hosted 目标或 localhost，也可选择已有普通 HTTP(S) 标签页；用户须先启用目标规则、配置有效信号并刷新目标。

本地目标先构建，再运行：

```bash
npm run serve:leak-test
```

服务默认地址为 `http://localhost:8787/leak-test/leak-test.html`，同源 `/headers.json` 回显实际请求头。报告页分别比较默认与固定显式 en-US/UTC 的 Intl/Date 调用，以及 language/languages、timezone/locale、位置/watch、WebRTC policy 与 ICE、iframe/worker 及设备透传参考。请求头只做原生观测，不参与保护 PASS/FAIL；本报告未采样目标字体，字体结果标为 UNKNOWN。run 绑定报告和目标文档、消费一次、两分钟过期；取消、执行中导航/关闭、配置改变或后台重启使 run 失效。完成结果只在当前扩展页面显示，TTL、清除或离开页面时释放。

缺失或不可观察证据为 UNKNOWN。空 ICE 或 policy PASS 都不能证明网络防护通过；设备透传参考只是同文档 MAIN/ISOLATED 的当次比较。目标网页本来就能读取其可见 API，实际观测可能受页面干预。网络、存储及清理详情见 [PRIVACY](PRIVACY.md)，权限用途见 [PERMISSIONS](PERMISSIONS.md)。

## 开发与验收

[CONTRIBUTING](CONTRIBUTING.md) 说明源码边界、合成数据与检查方法；[RELEASE](RELEASE.md) 说明现有 Actions 的触发、产物和待人工操作项。

```bash
npm run test:e2e:chrome -- --dry-run
```

上述命令只检查 dist 必需文件并打印清单，不安装扩展、不执行浏览器断言。`npm run test:e2e:chrome` 是半自动浏览器入口，仍需人工执行并记录场景。`node scripts/chrome-diagnostic-smoke.mjs` 是单独的真实 Chrome headless 定向 smoke，需要 Node 22+ 原生 WebSocket 和支持 Extensions DevTools domain 的 Chrome；使用合成配置及临时 profile，退出时清理 profile/server，不能替代完整人工验收。

历史 VG-009 最早脚本验收（包含当前不支持的文档类型，不能作为 VG-023 全通过门禁）：

```bash
npm run test:e2e:chrome -- --injection --runs=3
# 需要保存脱敏证据时加 --output <JSON文件路径>
```

脚本先采未启用规则对照，再在临时扩展内保存合成语言/时区配置，重复导航普通 localhost fixture。扩展报告分别比较 earliest（head 首脚本）、load（load 回调）和 postLoad（报告采集时），覆盖 top、同源 iframe、srcdoc 和脚本写入的 about:blank。后阶段通过不能替代 earliest 通过；退出码 0 为全 PASS，1 为实际 FAIL/UNKNOWN，2 为自动化失败。只请求本地 fixture，不调用 provider、位置、header echo 或 STUN，不新增依赖。浏览器发现的竞态应如实保留，不能用 dry-run 或延迟重采替换首脚本证据；具体实测与限制见 [VG-009 执行记录](.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)。

VG-010 的定向真实 Chrome smoke 可运行 `node scripts/chrome-onboarding-smoke.mjs`（Node 22+、支持 Extensions CDP domain 的 Chrome）。它使用两个独立临时 profile，覆盖安全安装、引导、跳过、reset，以及已有 v2 的真实扩展更新；更新副本使用合成测试版本号，仓库 manifest 不变。检测请求在发出前被 CDP 拦截并返回合成数据，不联系真实 provider。可用 `--upgrade-from <旧构建目录>` 指定旧实现，`--output <JSON路径>` 保存脱敏结果；未指定旧构建时只验证候选在既有 v2 数据上的更新保留。此 smoke 不等于真实 action Popup 人工验收或全部浏览器生命周期验收。

VG-023 真实 Chrome 定向验证：构建后运行 `node scripts/chrome-language-timezone-smoke.mjs --output experiments/userscripts-document-start/production-evidence.json`。该 runner 使用已准备的独立 Lima Linux VM，Chrome 自身 sandbox 保持开启，测试期间新 namespace 仅 loopback，正常点击 Allow User Scripts；加载实际 dist，覆盖语言/时区首 inline、快照、禁用、恢复、原生请求头/权限退出/WebRTC 及暂停 surface（历史 JSON 保留当时 DNR 行为）。运行前须启动 `vg-userscripts-fixture` VM；环境与命令见 [实验说明](experiments/userscripts-document-start/README.md)。已人工验收的最小实验 [JSON](experiments/userscripts-document-start/linux-evidence.json) 与生产 [JSON](experiments/userscripts-document-start/production-evidence.json) 分开保留；语言/时区生产阶段已于2026-10-16通过用户人工验收；记录见 [VG-023](.trellis/tasks/10-16-vg-023-userscripts-language-timezone/implement.md#2026-10-16-人工验收确认)。旧 integration/diagnostic/onboarding/worker runner 的全部 surface 预期不代表当前支持范围。

VG-024 权限退出升级验证可运行 `node scripts/chrome-native-headers-upgrade.mjs --from vg028 --upgrade-from <已清理VG028的dist> --output <脱敏JSON>`，跳级场景使用 `--from v2` 和实际旧构建。需要 Node22+、真实Chrome和独立临时profile；验证权限收缩、原生header及worker恢复，不重授DNR权限，不恢复字体，也不替代完整人工验收。

[稳定化记录](docs/stabilization/README.md) 说明证据和缺口；[manifest](docs/stabilization/task-manifest.yaml) 是任务范围、依赖和状态的唯一来源。本地实现结束为 `review`，人工验收后才为 `done`。

## 许可证

采用 MIT License；参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。NOTICE 保留原作品来源归属。
