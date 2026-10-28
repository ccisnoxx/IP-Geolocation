# 浏览器验证指南

本文面向开发者，集中说明浏览器诊断、定向验证入口和历史实验。日常安装见 [安装指南](../../INSTALL.md)，功能配置见 [配置指南](../../CONFIG_GUIDE.md)。

## 验证层级

在仓库根目录运行：

```bash
npm run check
npm run test:e2e:chrome -- --dry-run
```

`npm run check` 执行源码与测试类型检查、单元测试和构建。Chrome dry-run 只检查 dist 必需文件并打印清单，不安装扩展、不执行浏览器断言。`npm run test:e2e:chrome` 是半自动浏览器入口，仍需人工执行并记录场景。

真实 Chrome 结果应记录浏览器版本、平台、候选构建身份、合成配置、覆盖范围和实际结果。Node、VM、mock、静态检查及 dry-run 均不能替代真实 Chrome 验收；历史脚本的全能力预期也不代表当前生产支持范围。

## 可观察面审计与兼容预设

独立工具 `node --import tsx scripts/chrome-observability-audit.mjs --output <新JSON>` 使用正式 dist 和临时 Profile，先采未安装扩展的原生对照，再比较总开关关闭及语言、时区、定位、字体、WebRTC 逐项叠加，最后比较三种预设与再次关闭的新文档。可通过 CHROME_BIN 指定 Helium；内置 uBlock 正常停用后采样，不操作个人配置。

顶层、同源／跨源 iframe、HTTP／Blob classic/module Worker、SharedWorker 分别采样。只使用 NATIVE、OBSERVABLE、UNKNOWN、UNSUPPORTED；WebRTC policy 与无 STUN/TURN 的 ICE 计数分开记录。工具还有正式 Options 及实际 action Popup 保存链断言。精确字段、数据流、命令与未覆盖面见 [可观察面审计](observability-audit.md)。dry-run 不执行这些观测。

## 扩展侧诊断

从 Popup、Options 或扩展菜单打开“隐私检测”，进入仅扩展可访问的 `diagnostic/report.html`。报告可打开固定 hosted 目标或 localhost，也可选择已有普通 HTTP(S) 标签页；先启用目标规则、配置有效信号并刷新目标。

本地诊断先构建，再运行：

```bash
npm run serve:leak-test
```

服务默认地址为 `http://localhost:8787/leak-test/leak-test.html`，同源 `/headers.json` 回显实际请求头。扩展报告比较语言、时区、locale、位置、WebRTC policy 与 ICE、iframe/worker 及设备透传参考；当前未采样的字体和不支持的场景保持 UNKNOWN。外部观测页仅展示实际值，不接收配置预期值，不作为配置验收 PASS/FAIL 报告。

`node scripts/chrome-diagnostic-smoke.mjs` 是独立的真实 Chrome headless 定向 smoke，需要 Node.js 22+ 原生 WebSocket 和支持 Extensions DevTools domain 的 Chrome。它使用合成配置及临时 profile，退出时清理 profile/server，不能替代完整人工验收。

## 当前功能的定向验证

### 配置与 WebRTC 往返

构建后执行 `node scripts/chrome-onboarding-smoke.mjs --config-only --output <脱敏JSON>`。复用现有临时 Chrome profile 与 CDP runner，检查 Popup／Options 的三个领域选项、实际 Chrome policy、保存与重新打开回显、关闭总保护、非法导入保留原配置、导出再导入，以及损坏存储的错误显示和有效导入／重置恢复。不发起定位或 ICE 请求；Popup 作为扩展文档检查，不代替 action 气泡人工验收，也不覆盖完整升级或其他浏览器版本。

### 固定名单字体与定位

VG-025 正式dist定向验证：`node --import tsx scripts/chrome-font-filter-smoke.mjs --production --output <脱敏JSON>`，使用实际worker/router/包内固定字体资产和临时profile；不读取用户配置、不修改Allow User Scripts开关。默认不带--production仍是隔离固定脚本资格验证，不替代生产接线或人工验收。VG-027位置资格见 [可信早期环境交付](../../docs/stabilization/early-environment-delivery.md)。

### 语言请求头与浏览器生命周期

VG-032语言请求头验证：构建后执行 `node scripts/chrome-header-sync-smoke.mjs --output <脱敏JSON>`。使用临时profile和映射到loopback的测试域，先经过无DNR中间版本，再暂停候选后台验证静态隔离，随后验证迁移、普通Allow User Scripts开关、导航/iframe/跨源资源、子域关闭、快照重载、后台唤醒及扩展更新恢复。该脚本的 `--cold-restart` 是历史CDP临时加载探查，其阻塞证据保留，不能代替正常安装的冷启动验收。

正常安装冷启动使用 `CHROME_BIN="<有界面Chrome或Chrome for Testing可执行文件>" node scripts/chrome-header-cold-start.mjs --output <脱敏JSON> --ui-signal-dir <本次临时目录>`。在脚本提示时，通过原生扩展管理页加载当前dist、正常开启用户脚本，并由UI驱动依次写入 `install-complete`、`user-scripts-complete` 完成信号；最后的关闭开关负例使用 `user-scripts-disabled`。信号只协调交互，安装路径和真实开关仍由浏览器读回验证。两轮稳定设置冷启动先采首HTTP再只读核验，另含配置写后中断恢复和用户脚本关闭负例。实测Chrome for Testing149：稳定冷启动通过；关闭用户脚本后首请求曾出现原生JS/旧语言头失配，后台核验后撤销并隔离，不把这一过渡窗口计作首请求一致性通过。详见VG-032任务证据。

同一命令追加 `--http-session-restore` 可验证旧HTTP标签自动恢复：在正常设置页确认“继续浏览上次打开的网页”后写入 `session-restore-setting-complete` 信号，脚本另读实际偏好值确认。每轮退出前仅保留一个活动HTTP标签；确认整个观测进程树退出后，不传启动网址或强制恢复参数。服务器先记录该路径的首个新响应及其首inline语言报告，收到后才连接CDP并核验恢复文档。Chrome for Testing149的日语、改存德语两轮均通过；法语子iframe、关闭语言子iframe和同源/跨源请求也符合预期。本模式不重复中断与关闭开关负例，不覆盖多窗口、后台延迟标签或崩溃恢复。详见[自动恢复证据](../../.trellis/tasks/10-22-vg-032-header-sync/chrome-http-session-restore-evidence.json)。

可靠关闭流程的独立验证使用同一命令追加 `--master-off-restore`：正常 Popup 总开关关闭、界面确认保存并同步后写入 `master-disabled`，随后正常关闭 Chrome 用户脚本开关并写入 `user-scripts-disabled`。先验证新顶层/iframe及同源、跨源请求均原生，再完整退出并自动恢复一个HTTP标签，在CDP连接前采集首导航头与首inline。Chrome149本轮9项通过，见[总开关关闭及重启证据](../../.trellis/tasks/10-22-vg-032-header-sync/chrome-master-off-restore-evidence.json)。正常安装和恢复设置的信号与上文相同。

`--user-scripts-off-restore` 则保留直接关闭Chrome开关的负例，不执行插件总开关关闭；此模式及默认冷启动模式现在把首请求失配纳入整体FAIL，后台后续收敛不再代替首请求验收。旧JSON保留其当时判据，不覆盖历史失败观测。本轮用户选择插件总开关作为关闭入口，未宣称消除直接关闭Chrome开关的窗口。

## Blob Worker 语言与时区

仅在语言或时区已启用、匹配规则的新 HTTP(S) 文档中，对该 realm 在脚本安装后通过 URL.createObjectURL(Blob) 创建的 Dedicated Worker 应用同一快照，覆盖 classic 和 module。不改系统或 Chrome 原生设置；HTTP(S) Worker、SharedWorker、其他 realm 创建的 Blob、未接管父级及旧 Worker 仍未覆盖。不是全浏览器语言清理。

需要页面 CSP 同时允许 Blob Worker 入口及 Blob 脚本依赖，Trusted Types 和 MIME 检查仍由 Chrome 执行；阻止依赖时 Worker 会报错，不能报告同步成功。包装会改变 Worker location.href、模块 import.meta.url 和错误堆栈中的 Blob 地址。业务源采用独立脚本/模块，保留严格模式及模块依赖先后顺序；页面可在构造后立即撤销原 URL。关闭/改配置后完整刷新页面再创建 Worker。

启动前用同步 XMLHttpRequest 仅核验本页已跟踪的 blob: URL 是否仍在原生存储中，避免同源其他 realm 撤销后复活源码。该步骤不访问 HTTP(S) 或外部网络，但读取成本随 Blob 大小增加；CSP connect-src 禁止读取时会明确警告“本次语言/时区未同步”并保留原生加载，不能当作通过。普通 URL 对象支持；TrustedScriptURL、安装前或其他 realm 创建的 URL 未覆盖。页面 CSP 仍需允许 Blob Worker 及 Blob 脚本依赖。

VG-034（2026-10-23人工验收通过，未发布）进一步覆盖已同步Blob Dedicated Worker链中、各realm安装后自身创建的Blob子Worker，classic/module均继承父级最小快照。未接管父级不会自动覆盖其后代；HTTP(S)与SharedWorker不变。各层沿用VG-033的CSP核验、撤销及生命周期规则，核验在创建者线程同步执行。

HTTP(S) Dedicated Worker 继续暂停，SharedWorker 不变。2026-10-23 当前 Chrome 的独立 HTTP module 对照确认：Blob 启动可保留模块相对路径，但会改变全局相对地址和入口 CSP 语义；不据此恢复生产。详见 [实验结论、证据与未覆盖范围](../../docs/stabilization/http-module-worker-feasibility.md)。

## 历史验证入口

以下说明保留旧 README 中的实验命令和证据边界。执行前核对当前支持范围与各任务记录；历史全 surface 预期不用于认定当前生产能力全部通过。

### 最早脚本时序（VG-009）

历史最早脚本验收包含当前不支持的文档类型，不能作为 VG-023 全通过门禁：

```bash
npm run test:e2e:chrome -- --injection --runs=3
# 需要保存脱敏证据时加 --output <JSON文件路径>
```

脚本先采未启用规则对照，再在临时扩展内保存合成语言/时区配置，重复导航普通 localhost fixture。扩展报告分别比较 earliest（head 首脚本）、load（load 回调）和 postLoad（报告采集时），覆盖 top、同源 iframe、srcdoc 和脚本写入的 about:blank。后阶段通过不能替代 earliest 通过；退出码 0 为全 PASS，1 为实际 FAIL/UNKNOWN，2 为自动化失败。只请求本地 fixture，不调用 provider、位置、header echo 或 STUN，不新增依赖。浏览器发现的竞态应如实保留，不能用 dry-run 或延迟重采替换首脚本证据；具体实测与限制见 [VG-009 执行记录](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)。

### 首次安装与升级（VG-010）

VG-010 的定向真实 Chrome smoke 可运行 `node scripts/chrome-onboarding-smoke.mjs`（Node 22+、支持 Extensions CDP domain 的 Chrome）。它使用两个独立临时 profile，覆盖安全安装、引导、跳过、reset，以及已有 v2 的真实扩展更新；更新副本使用合成测试版本号，仓库 manifest 不变。检测请求在发出前被 CDP 拦截并返回合成数据，不联系真实 provider。可用 `--upgrade-from <旧构建目录>` 指定旧实现，`--output <JSON路径>` 保存脱敏结果；未指定旧构建时只验证候选在既有 v2 数据上的更新保留。此 smoke 不等于真实 action Popup 人工验收或全部浏览器生命周期验收。

### userScripts 早期派发（VG-023）

VG-023 真实 Chrome 定向验证：构建后运行 `node scripts/chrome-language-timezone-smoke.mjs --output experiments/userscripts-document-start/production-evidence.json`。该 runner 使用已准备的独立 Lima Linux VM，Chrome 自身 sandbox 保持开启，测试期间新 namespace 仅 loopback，正常点击 Allow User Scripts；加载实际 dist，覆盖语言/时区首 inline、快照、禁用、恢复、原生请求头/权限退出/WebRTC 及暂停 surface（历史 JSON 保留当时 DNR 行为）。运行前须启动 `vg-userscripts-fixture` VM；环境与命令见 [实验说明](../../experiments/userscripts-document-start/README.md)。已人工验收的最小实验 [JSON](../../experiments/userscripts-document-start/linux-evidence.json) 与生产 [JSON](../../experiments/userscripts-document-start/production-evidence.json) 分开保留；语言/时区生产阶段已于2026-10-16通过用户人工验收；记录见 [VG-023](../../.trellis/tasks/10-16-vg-023-userscripts-language-timezone/implement.md#2026-10-16-人工验收确认)。旧 integration/diagnostic/onboarding/worker runner 的全部 surface 预期不代表当前支持范围。

### 历史请求头权限退出（VG-024）

VG-024 历史权限退出升级验证使用 `node scripts/chrome-native-headers-upgrade.mjs --from vg028 --upgrade-from <已清理VG028的dist> --output <脱敏JSON>`，跳级场景使用 `--from v2` 和实际旧构建。需要 Node22+、真实Chrome和独立临时profile；其预期为当时的权限收缩、原生header及worker恢复，仅适用于VG-024旧候选，不能作为当前VG-032候选门禁；当前请求头验证见[语言请求头与浏览器生命周期](#语言请求头与浏览器生命周期)。

## 验收证据

[稳定化记录](../../docs/stabilization/README.md) 说明证据与缺口；[证据索引](../../docs/stabilization/evidence-index.md) 汇总人工验收和原始记录。[任务清单](../../docs/stabilization/task-manifest.yaml) 是稳定化任务范围、依赖和状态的唯一来源。本地实现结束为 `review`，人工验收后才为 `done`。

从根目录正式文档迁出的配置实现、存储字段、规则迁移和发布准备说明见 [项目实现与历史记录](project-history.md)。

## 语言与定位解耦（P0）＋ Worker 侧字体（P2）

- **P0 语言不再跟时区/定位连坐**：`getEffectiveLanguage()` 只看语言配置本身；`resolveProfile()`
  在时区/定位解析失败但语言可用时返回**部分生效** payload（只有语言，`timezone: null`），
  `Accept-Language` 与页面语言仍来自同一份语言解析，不会出现"请求头说 en-US、页面说 zh-CN"。
  Popup 当前站点状态新增 `partial`：写明已应用什么、为什么没生效。
  验证：`tests/p0-language-decoupling.test.ts`、`tests/header-rules.test.ts`。
- **P2 Worker 侧字体伪装**：`surfaces/offscreen-fonts.ts` 把同一份屏蔽名单补到
  `OffscreenCanvasRenderingContext2D.measureText` 与 `FontFaceSet.check`；名单经
  `LanguageTimezonePayload.blockedFonts` 进入 Blob Worker（含嵌套），条件是
  `fontExposure.enabled && mode === 'vendor-software'` 且规则为 full。
  名单只随已有语言/时区 Blob Worker 链传递；语言和时区均关闭时，单独开启字体不会建立 Worker 链。
  验证：`tests/worker-fonts.test.ts`（生成的生产 Blob bootstrap 在 Node VM 中执行）。
- **文件型 Worker 维护实验**：构建保留 `worker-fonts/hook.js` 与
  `generateWorkerFontHook()`，供隔离研究和回归使用；`compileFontRelatedScripts()` 不生产派发它。
  `vanishgeo-font-worker-` 前缀仅用于撤销实验残留，不能当作生产支持的证据。
  `tests/worker-font-hook.test.ts` 分别验证不派发、实验生成自包含及包装行为。
- **仍未覆盖**：HTTP(S) Dedicated Worker、SharedWorker、外来 Blob 和自定义字体名单继续暂停。

## Canvas 字体伪装（独立 userScript）

- 配置：`fontExposure.canvasSpoof = { enabled, platform: 'macos' | 'windows' }`，默认关闭。
- 产物：`dist/canvas-fonts/{macos,windows}.js`，`(${applyCanvasFontSpoof})('macos' | 'windows')`。
- 门禁与字体过滤一致：`FONT_FILTER_PRODUCTION_APPROVED && fontExposure.enabled && canvasSpoof.enabled && 规则预设 full`。
- 行为：目标平台之外的专有字体（如声称 macOS 时的 `Segoe UI`、`Microsoft YaHei`）在 `measureText` 中改用对端等价字体量宽，
  测量后恢复原 `font`；`FontFaceSet.check()` 对它们返回 `false`。不改实际像素，因此与截图指纹仍可能不一致。
- 生产会同时安装固定 43 项过滤。原字体或映射目标在该名单内时，结果仍可能使用后备字体，
  不能将独立 Canvas 补丁的中文等价字体测量结果当作两种补丁组合后的保证。调整优先级需要另行确定合同。
- 不覆盖：`fillText` 实际字形、`@font-face local()`、像素比对、WebGL。

## 环境预设（三省一市：新加坡 / 东京 / 洛杉矶）

- `src/shared/environment-presets.ts` 导出 `ENVIRONMENT_PRESETS`，只包含上述三项。
- Popup/Options 的卡片与已确认出口都通过 `presetSignals()` / `exitProfileSignals()` 填入表单，再走正常保存与校验。
  同批更新坐标、国家、语言和时区，规则、出口档案、WebRTC、字体配置保留。
- `tests/quick-set-ui.test.ts` 执行维护源事件与保存路径，验证三信号、非目标配置、往返和失败提示。

## 烘焙 persona（`npm run build:persona`）

- 把一次出口画像固化进产物：manifest 增加 `content_scripts`（`world: MAIN`、`document_start`、`all_frames`），
  注入 `persona/page-runtime.js`（自包含函数 + 内联 payload），不依赖运行期 `userScripts` 注册。
- `persona/persona.json` 记录坐标/语言/时区/域名，便于复核；`--preset` 与 `--lat/--lon/--timezone/--language` 可混用，显式参数优先。

## 指纹一致性回归（`npm run smoke:fingerprint`）

- 从维护源生成页面入口与生产 Blob Worker 引导，分别在三个拥有独立 JS 内建对象的 Node VM realm 中执行。
  页面样本使用页面入口，Worker 样本使用 Blob Worker 入口；不读取 dist，也不创建真实 iframe 或 Worker。
- 先逐样本核对 payload 预期的时区、固定日期 offset、locale、language/languages，再核对样本间一致性。
  `--selftest-mismatch` 故意让 Worker 偏离；负例测试还验证全不打补丁、遗漏 Worker 补丁和宿主污染。
  这是 Node/VM 证据，不验证字体、网络、Chrome 注册或浏览器生命周期。

## WebRTC：为什么只用浏览器策略

对比过两条路线：页面侧伪造 `RTCPeerConnection`（fork 的 `WebRtcMode + spoof`）与浏览器策略（本项目的 `privacy.network.webRTCIPHandlingPolicy`）。
本项目保留策略路线：它在网络栈执行、页面无法探测（无 proxy 函数、无 toString 痕迹、无 SDP 自相矛盾），且覆盖 Worker 与无脚本场景；
JS 伪造则只能覆盖注入的 realm，且 SDP 与真实 DTLS/候选天然冲突，可被指纹识别。回归锚点见 `tests/webrtc.test.ts`（源码中不得出现 `RTCPeerConnection` 伪造）。
