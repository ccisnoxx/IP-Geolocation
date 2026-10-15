# VanishGeo

> **VG-011 安全暂停（2026-10-15 用户确认人工验收通过）**：Chrome 155 已证实旧 `documentId` 可错投替换文档。当前后台在读取 payload 和派发前拒绝所有页面伪装初始化，并撤销动态初始化脚本。语言、时区、位置、Canvas 及 Worker/SharedWorker 伪装暂停；配置仍可保存。DNR 请求头规则、WebRTC 继续各自执行并按实际同步结果报告；二者不补偿页面 API 伪装。重试同步、保存或后台重启不会恢复页面伪装。新闸门不撤销旧 hook，已加载页面及旧 BFCache 文档需关闭并重建；无法确认清理时需自行重启浏览器。恢复完整功能前须验证可靠最终文档绑定或浏览器上游修复。详情见 [调查与实施证据](docs/stabilization/document-id-investigation.md)。

VanishGeo 是 Chromium Manifest V3 扩展，用于按站点规则管理网页可见的语言、时区和位置，并控制 Accept-Language 请求头与浏览器 WebRTC IP 策略。它不提供 VPN 或代理，不改变普通网页请求的公网出口，也不保证匿名、绕过检测或任何指纹评分。

## 当前能力与边界

- 启用的域名 allowlist 规则继承全局设置，可配置语言、时区、位置的逐规则覆盖或禁用。
- MAIN-world runtime 维护源仍保留用于隔离测试；生产后台已移除其调用依赖。ISOLATED 初始化脚本已撤销，残留通知也在后台拒绝。没有静态全站注入或页面可控配置桥。
- DNR 根据同一配置解析有效语言，修改匹配 HTTP(S) 请求的 `Accept-Language`。
- WebRTC 使用 Chrome privacy API 的全局策略，提供 strict、compatible 和 default；该设置影响浏览器普通会话，范围大于站点 allowlist。实际控制权和 ICE 结果需要分别观察。
- 配置保存后由后台对账页面脚本、DNR、WebRTC 与标签页刷新；Popup/Options 显示同步结果，部分失败为“已保存但未完全生效”，可点击“重试同步”。后台安装、启动或再次唤醒会重试未收敛状态。
- 出口位置只在用户点击检测或重新检测时请求外部 provider。候选确认后保存为 verified 档案，auto 位置/时区必须在每条规则上显式绑定该档案。**没有后台定时刷新**；更换代理或网络后需要主动重新检测。
- 支持自定义环境方案、配置导入/导出；Canvas 字体过滤和同源 HTTP(S) Worker/SharedWorker 的语言/时区包装目前暂停。不提供内置地区整套快捷预设，不新增 GPU、Audio、screen 等设备伪装。
- 可配置全局时区与 Locale `strict`/`compatible` 模式：默认 strict 保持强制一致性，compatible 保留页面显式参数、只补默认值。生产页面伪装仍暂停，保存模式不会恢复；精确语义见 [配置指南](CONFIG_GUIDE.md#时区与-locale-模式)。
- 扩展侧一次性诊断报告比较实际值与留在扩展内部的预期值；外部诊断页只做 observation，不给出配置验收 PASS/FAIL。

## 安装与构建

在仓库根目录使用 Node.js 20+ 和 npm（当前 release workflow 使用 Node 20）：

```bash
npm ci
npm run typecheck
npm run typecheck:tests
npm test
npm run build
```

在 `chrome://extensions/` 启用开发者模式，选择“加载已解压的扩展程序”，加载构建后的 **`dist/`**。manifest 声明最低 Chrome 119；其他 Chromium 浏览器的 API 和策略支持需要单独验证。完整步骤见 [INSTALL](INSTALL.md)，首次配置见 [CONFIG_GUIDE](CONFIG_GUIDE.md)。全新安装默认关闭总开关、站点列表为空，WebRTC 使用 browser default；安装后可在 Options 引导主动检测并确认出口、选择站点、明确启用，也可跳过保持关闭。已有 v2 配置升级保留原设置，不套用新安装默认值；auto 仍需显式绑定 verified 档案。

`npm run check` 聚合源码类型、测试类型、单元测试和构建，任一步失败立即停止；完整 CI/发布门禁见 [RELEASE](RELEASE.md)。

开发模式 `npm run dev` 是构建 watch，仍需加载/重载 dist。`npm run preview` 仅启动静态预览，不能代替 Chrome 扩展环境。六个入口、HTML/CSS、manifest、图标、fixtures、许可证及 `assets/` 共享 chunks 一起构成 dist，不能只复制入口 JS。

## 诊断

从 Popup、Options 或扩展菜单打开“隐私检测”，进入仅扩展可访问的 `diagnostic/report.html`。报告可打开固定 hosted 目标或 localhost，也可选择已有普通 HTTP(S) 标签页；用户须先启用目标规则、配置有效信号并刷新目标。

本地目标先构建，再运行：

```bash
npm run serve:leak-test
```

服务默认地址为 `http://localhost:8787/leak-test/leak-test.html`，同源 `/headers.json` 回显实际请求头。报告页分别比较默认与固定显式 en-US/UTC 的 Intl/Date 调用，以及 language/languages、header、timezone/locale、位置/watch、WebRTC policy 与 ICE、iframe/worker 及设备透传参考。run 绑定报告和目标文档、消费一次、两分钟过期；取消、执行中导航/关闭、配置改变或后台重启使 run 失效。完成结果只在当前扩展页面显示，TTL、清除或离开页面时释放。

缺失或不可观察证据为 UNKNOWN。空 ICE 或 policy PASS 都不能证明网络防护通过；设备透传参考只是同文档 MAIN/ISOLATED 的当次比较。目标网页本来就能读取其可见 API，实际观测可能受页面干预。网络、存储及清理详情见 [PRIVACY](PRIVACY.md)，权限用途见 [PERMISSIONS](PERMISSIONS.md)。

## 开发与验收

[CONTRIBUTING](CONTRIBUTING.md) 说明源码边界、合成数据与检查方法；[RELEASE](RELEASE.md) 说明现有 Actions 的触发、产物和待人工操作项。

```bash
npm run test:e2e:chrome -- --dry-run
```

上述命令只检查 dist 必需文件并打印清单，不安装扩展、不执行浏览器断言。`npm run test:e2e:chrome` 是半自动浏览器入口，仍需人工执行并记录场景。`node scripts/chrome-diagnostic-smoke.mjs` 是单独的真实 Chrome headless 定向 smoke，需要 Node 22+ 原生 WebSocket 和支持 Extensions DevTools domain 的 Chrome；使用合成配置及临时 profile，退出时清理 profile/server，不能替代完整人工验收。

VG-009 最早脚本验收（Node 22+，支持 Extensions CDP domain 的真实 Chrome）：

```bash
npm run test:e2e:chrome -- --injection --runs=3
# 需要保存脱敏证据时加 --output <JSON文件路径>
```

脚本先采未启用规则对照，再在临时扩展内保存合成语言/时区配置，重复导航普通 localhost fixture。扩展报告分别比较 earliest（head 首脚本）、load（load 回调）和 postLoad（报告采集时），覆盖 top、同源 iframe、srcdoc 和脚本写入的 about:blank。后阶段通过不能替代 earliest 通过；退出码 0 为全 PASS，1 为实际 FAIL/UNKNOWN，2 为自动化失败。只请求本地 fixture，不调用 provider、位置、header echo 或 STUN，不新增依赖。浏览器发现的竞态应如实保留，不能用 dry-run 或延迟重采替换首脚本证据；具体实测与限制见 [VG-009 执行记录](.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)。

VG-010 的定向真实 Chrome smoke 可运行 `node scripts/chrome-onboarding-smoke.mjs`（Node 22+、支持 Extensions CDP domain 的 Chrome）。它使用两个独立临时 profile，覆盖安全安装、引导、跳过、reset，以及已有 v2 的真实扩展更新；更新副本使用合成测试版本号，仓库 manifest 不变。检测请求在发出前被 CDP 拦截并返回合成数据，不联系真实 provider。可用 `--upgrade-from <旧构建目录>` 指定旧实现，`--output <JSON路径>` 保存脱敏结果；未指定旧构建时只验证候选在既有 v2 数据上的更新保留。此 smoke 不等于真实 action Popup 人工验收或全部浏览器生命周期验收。

当前暂停候选优先使用 `node scripts/chrome-integration-smoke.mjs --output <脱敏JSON路径>`；它覆盖配置、DNR、WebRTC、诊断隐私和生命周期，保留页面伪装项的实际 FAIL。VG-009 `--injection` 与旧 diagnostic/onboarding/worker runner 是恢复前的历史功能预期，不能直接作为当前暂停候选的成功门禁。最新验收、已知阻断和 ZIP 证据见 [VG-014 候选报告](docs/stabilization/release-readiness.md)；运行边界与命令见 [RELEASE](RELEASE.md)。

[稳定化记录](docs/stabilization/README.md) 说明证据和缺口；[manifest](docs/stabilization/task-manifest.yaml) 是任务范围、依赖和状态的唯一来源。本地实现结束为 `review`，人工验收后才为 `done`。

## 许可证

采用 MIT License；参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。NOTICE 保留原作品来源归属。
