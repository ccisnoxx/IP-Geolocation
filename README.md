# VanishGeo

> **VG-032（2026-10-22，人工验收通过，未发布）**：仅恢复 `declarativeNetRequestWithHostAccess`，先隔离并迁移历史规则，再以已核验的持久规则按站点同步 Accept-Language；旧文档仍需完整重载。当前状态与实际验证以任务记录为准。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；定位已于 VG-029（2026-10-22）获用户授权恢复，按独立注册状态报告；Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

当前源码版本为 **2.1.1（未发布）**。VanishGeo 是 Chromium Manifest V3 扩展，按站点规则管理页面语言/时区快照，同步站点的 Accept-Language，保持其他 HTTP 请求头原生，并管理浏览器 WebRTC IP 策略。定位与字体过滤各按独立状态报告，Worker语言仍原生。它不提供 VPN 或代理，不改变普通网页请求的公网出口，也不保证匿名、绕过检测或任何指纹评分。

## 当前能力与边界

- 启用的域名 allowlist 规则继承全局设置，可配置语言、时区、位置的逐规则覆盖或禁用。
- MAIN-world runtime 维护源仍保留用于隔离测试；生产后台已移除其调用依赖。ISOLATED 初始化脚本已撤销，残留通知也在后台拒绝。没有静态全站注入或页面可控配置桥。
- Accept-Language复用站点语言列表，按顺序生成权重；默认静态隔离先保护权限恢复窗口，清理已知旧规则并读回后才安装已核验的dynamic投影，稳定冷启动保留该投影。仅恢复host约束DNR权限，其他请求头保持原生；已有文档和同步期间需完整重载。
- WebRTC 使用 Chrome privacy API 的全局策略，提供 strict、compatible 和 default；该设置影响浏览器普通会话，范围大于站点 allowlist。实际控制权和 ICE 结果需要分别观察。
- 配置保存、worker 初始化和扩展 update 时由后台串行对账：先撤销失效/范围变化的注册，再更新保留规则，最后新增并读回验证。Popup/Options 分别显示 API/权限/用户开关不可用、注册失败、注册成功需重载或新文档可用；不自动刷新页面。
- 出口位置只在用户点击检测或重新检测时请求外部 provider。候选确认后保存为 verified 档案，auto 位置/时区必须在每条规则上显式绑定该档案。**没有后台定时刷新**；更换代理或网络后需要主动重新检测。
- Options 可按已确认出口生成地区语言/时区推荐：默认保留现有语言，查看推荐不保存、不检测；明确确认后仅覆盖所选站点，字体与 WebRTC 的全局变更另行选择。时区只标注单 provider 声明，未知国家代码不猜语言。
- 支持自定义环境方案、配置导入/导出；固定内置字体名单仅在总开关、字体开关和 HTTP(S) allowlist 均启用时注册；自定义名单及同源 HTTP(S) Worker/SharedWorker 的语言/时区包装继续暂停。地区推荐是有限候选，不代表个人偏好；不新增 GPU、Audio、screen 等设备伪装。
- 可保存全局时区与 Locale `strict`/`compatible` 模式。其保留语义分别为强制一致性、保留页面显式参数并只补默认值；仅随已验收的语言/时区注册用于匹配新文档，不恢复其他页面能力；精确语义见 [配置指南](CONFIG_GUIDE.md#时区与-locale-模式)。
- 扩展侧一次性诊断报告比较实际值与留在扩展内部的预期值；外部诊断页只做 observation，不给出配置验收 PASS/FAIL。

## 选择性字体暴露过滤（仅启用白名单）

配置为 `fontExposure`，默认关闭，提供 `vendor-software` 固定内置名单与 `custom` 自定义名单。内置名单包含16项厂商／软件字体及2026-10-22用户授权加入的27项简繁中文字体，覆盖微软雅黑、宋体、苹方、思源、Noto CJK 等；仅在总开关、字体开关和 HTTP(S) allowlist 均启用时生效。2026-10-22增量：匹配HTTP(S)白名单的顶层 `measureText` 仅使用 `monospace`、`sans-serif`、`serif` 测量，移除具名字体，无允许项回退 `sans-serif`；`FontFaceSet.check` 及普通 iframe 仍按原43项名单过滤；不随机化 Canvas 图像，不修改绘制、像素、WebGL/GPU、UA/UA-CH 或硬件信息。测量宽度可能与实际绘制不一致，影响依赖测量的文本排版。DOM 尺寸、`@font-face local()`、像素比对与 Worker 字体探测不在承诺范围；不能称为完全隐藏字体。VG-025 固定名单生产恢复已获授权（`FONT_FILTER_PRODUCTION_APPROVED=true`），custom 名单仍不生产派发。注册就绪不代表当前文档已应用，旧文档及 BFCache 须完整重建。

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

服务默认地址为 `http://localhost:8787/leak-test/leak-test.html`，同源 `/headers.json` 回显实际请求头。报告页分别比较默认与固定显式 en-US/UTC 的 Intl/Date 调用，以及 language/languages、timezone/locale、位置/watch、WebRTC policy 与 ICE、iframe/worker 及设备透传参考。启用站点语言时比较实际Accept-Language与预期列表，缺失或未启用时为UNKNOWN；本报告未采样目标字体，字体结果标为 UNKNOWN。run 绑定报告和目标文档、消费一次、两分钟过期；取消、执行中导航/关闭、配置改变或后台重启使 run 失效。完成结果只在当前扩展页面显示，TTL、清除或离开页面时释放。

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

VG-024 历史权限退出升级验证使用 `node scripts/chrome-native-headers-upgrade.mjs --from vg028 --upgrade-from <已清理VG028的dist> --output <脱敏JSON>`，跳级场景使用 `--from v2` 和实际旧构建。需要 Node22+、真实Chrome和独立临时profile；其预期为当时的权限收缩、原生header及worker恢复，仅适用于VG-024旧候选，不能作为当前VG-032候选门禁；当前请求头验证使用下方专用脚本。

[稳定化记录](docs/stabilization/README.md) 说明证据和缺口；[manifest](docs/stabilization/task-manifest.yaml) 是任务范围、依赖和状态的唯一来源。本地实现结束为 `review`，人工验收后才为 `done`。

## 许可证

采用 MIT License；参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。NOTICE 保留原作品来源归属。

VG-025 正式dist定向验证：`node --import tsx scripts/chrome-font-filter-smoke.mjs --production --output <脱敏JSON>`，使用实际worker/router/包内固定字体资产和临时profile；不读取用户配置、不修改Allow User Scripts开关。默认不带--production仍是隔离固定脚本资格验证，不替代生产接线或人工验收。VG-027位置资格见 [可信早期环境交付](docs/stabilization/early-environment-delivery.md)。


VG-025（2026-10-20）已获用户授权恢复固定内置名单字体过滤；仅启用的HTTP(S) allowlist生效，custom和Worker继续暂停；位置恢复见VG-029。注册成功只代表匹配新文档就绪，旧hook/BFCache须完整重建；恢复授权不等于人工验收通过。详见 [配置指南](CONFIG_GUIDE.md)。

VG-032语言请求头验证：构建后执行 `node scripts/chrome-header-sync-smoke.mjs --output <脱敏JSON>`。使用临时profile和映射到loopback的测试域，先经过无DNR中间版本，再暂停候选后台验证静态隔离，随后验证迁移、普通Allow User Scripts开关、导航/iframe/跨源资源、子域关闭、快照重载、后台唤醒及扩展更新恢复。该脚本的 `--cold-restart` 是历史CDP临时加载探查，其阻塞证据保留，不能代替正常安装的冷启动验收。

正常安装冷启动使用 `CHROME_BIN="<有界面Chrome或Chrome for Testing可执行文件>" node scripts/chrome-header-cold-start.mjs --output <脱敏JSON> --ui-signal-dir <本次临时目录>`。在脚本提示时，通过原生扩展管理页加载当前dist、正常开启用户脚本，并由UI驱动依次写入 `install-complete`、`user-scripts-complete` 完成信号；最后的关闭开关负例使用 `user-scripts-disabled`。信号只协调交互，安装路径和真实开关仍由浏览器读回验证。两轮稳定设置冷启动先采首HTTP再只读核验，另含配置写后中断恢复和用户脚本关闭负例。实测Chrome for Testing149：稳定冷启动通过；关闭用户脚本后首请求曾出现原生JS/旧语言头失配，后台核验后撤销并隔离，不把这一过渡窗口计作首请求一致性通过。详见VG-032任务证据。

同一命令追加 `--http-session-restore` 可验证旧HTTP标签自动恢复：在正常设置页确认“继续浏览上次打开的网页”后写入 `session-restore-setting-complete` 信号，脚本另读实际偏好值确认。每轮退出前仅保留一个活动HTTP标签；确认整个观测进程树退出后，不传启动网址或强制恢复参数。服务器先记录该路径的首个新响应及其首inline语言报告，收到后才连接CDP并核验恢复文档。Chrome for Testing149的日语、改存德语两轮均通过；法语子iframe、关闭语言子iframe和同源/跨源请求也符合预期。本模式不重复中断与关闭开关负例，不覆盖多窗口、后台延迟标签或崩溃恢复。详见[自动恢复证据](.trellis/tasks/10-22-vg-032-header-sync/chrome-http-session-restore-evidence.json)。

可靠关闭流程的独立验证使用同一命令追加 `--master-off-restore`：正常 Popup 总开关关闭、界面确认保存并同步后写入 `master-disabled`，随后正常关闭 Chrome 用户脚本开关并写入 `user-scripts-disabled`。先验证新顶层/iframe及同源、跨源请求均原生，再完整退出并自动恢复一个HTTP标签，在CDP连接前采集首导航头与首inline。Chrome149本轮9项通过，见[总开关关闭及重启证据](.trellis/tasks/10-22-vg-032-header-sync/chrome-master-off-restore-evidence.json)。正常安装和恢复设置的信号与上文相同。

`--user-scripts-off-restore` 则保留直接关闭Chrome开关的负例，不执行插件总开关关闭；此模式及默认冷启动模式现在把首请求失配纳入整体FAIL，后台后续收敛不再代替首请求验收。旧JSON保留其当时判据，不覆盖历史失败观测。本轮用户选择插件总开关作为关闭入口，未宣称消除直接关闭Chrome开关的窗口。
