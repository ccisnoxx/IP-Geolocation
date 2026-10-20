> 2026-10-17：用户已确认 `77790ce`（第一组3文件）、`fc40299`（第二组13文件）通过补充人工验收。最小实验 GO25 与独立恢复 GO7 的范围、相同 JSON 的独立执行回执及保留缺口见 [补充人工验收记录](./recovery-review.md#2026-10-17-两条-fixture-提交补充人工验收)。GO7不代表完整17项通过；P3暂不扩展，Navigator保持review，其他页面能力继续暂停。下文“待人工验收/review”按对应交付日期保留为历史状态。
>
> 2026-10-16：用户已明确确认本实验通过人工验收，US-EXP=done；原文中的“待人工验收/review”为交付时历史状态。人工记录见 .trellis/tasks/10-16-userscripts-loopback-fixture/implement.md。生产恢复在独立VG-023任务实施。

# userScripts document_start 本地兼容性实验

当前最小机制结论为 **GO，已通过用户人工验收（US-EXP=done）**。真实 Linux ARM64 Chrome155.0.8059.84 在独立 VM 的仅 loopback 网络命名空间内完成 API/A–F；16 个场景和三个阶段均 PASS。证据见 [linux-evidence.json](./linux-evidence.json)，环境、复现和边界见 [linux-fixture-review.md](./linux-fixture-review.md)。这只证明最小 navigator.language 实验，尚未集成生产 runtime。

macOS 原 Seatbelt 后端仍为 **BLOCKED**，不是本轮已修复的平台。原 [sandbox-startup-investigation.md](./sandbox-startup-investigation.md)、[sandbox-evidence.json](./sandbox-evidence.json)、[gated-evidence.json](./gated-evidence.json) 和 [evidence.json](./evidence.json) 保留历史事实。本轮新增独立 Linux 后端，没有放宽原策略或关闭 Chrome sandbox。

本目录是独立 Chromium MV3 实验，不导入生产 runtime，不修改正式 manifest、background、runtime、popup、options、DNR、WebRTC 或 `runtime-injection-paused`。用户既有修改保留。没有恢复、提交、push 或发布授权。

## GO 必须同时满足

| 必需项 | 判定 |
| --- | --- |
| 浏览器/API | 真实 Chrome138+；扩展上下文 getScripts 实际成功；register/update/路径更新/unregister 完成且回读一致 |
| 顶层新文档 | 首个 head inline 同步 earliest 就看到当前注册值，readyState=loading、scriptIndex=1、inline=true；load/postLoad 一致 |
| HTTP iframe | 自己的首个 inline 独立采样，文档实例与顶层不同，三个阶段均正确 |
| 更新 A→B | 已有 top/iframe 文档未重建，仍为 A；新标签、同 URL reload 的新文档均为 B |
| 注销 | 注销后新文档及 reload 三阶段均原生；已有 B 文档不热更新，保留 B |
| URL 边界 | localhost 匹配；127.0.0.1 三阶段原生；窄路径内/外和相似前缀分别验证；子帧逐 URL 匹配 |
| reload | 新文档使用当前注册快照；确认创建了新文档 |
| back/forward | 缓存恢复时保留该文档原快照，重建时用当前快照；其他 origin 始终原生，无其他文档配置串用 |
| 生产文件与暂停 | 与本次运行开始时相比，实验目录外 Git 跟踪文件及未忽略的未跟踪文件的路径、内容、mode 均不变；暂停闸门存在且不变 |
| 网络 | 网络 collector 及派生 Chrome 进程树受内核 loopback 策略约束；loopback 正向、IPv4/IPv6 TCP/UDP 拒绝对照和子进程继承检查全部 PASS；Linux 还要求无外部接口、prohibit default 路由和非 root collector |
| Chrome sandbox | chrome://sandbox 实际回报第一层隔离、PID/Network namespaces、seccomp 和 adequately sandboxed；没有该证据不得 GO |
| 用户开关 | 临时扩展正常详情页开关初始关闭且 API 不可用；正常 UI 点击后开关开启，API 实际成功；不改 prefs、私有设置或放行 flags |
| 清理 | 本次 Chrome、profile、fixture 服务和连接已释放 |

`acceptance.mjs` 是唯一最终结论所有者。它枚举固定必需项，不信任 collector 的 conclusion/exitCode；按固定预期重算每帧三个阶段实际值及 pageshow/文档连续性；缺少场景、阶段、实际观测、同文档/新文档证明、网络检查或生产完整性证明，都不能退出0。必需项为 UNKNOWN、未执行或报告不完整也不能退出0。首读错误不能由后阶段成功补足。

- **0 / GO**：全部必需项有实际证据且 PASS，无中断原因，仅最小机制 GO。
- **1 / NO_GO**：已确认机制、网络约束或生产不变要求失败，保留 FAIL；其余尚未执行的项仍为 UNKNOWN。
- **2 / BLOCKED**：网络后端/API/用户开关/版本/自动化/清理不可用或证据不完整。不得将超时、无流量或静态检查当成 PASS。

BFCache 通过 fixture 内部文档实例连续性与真实 pageshow.persisted 共同记录。未命中时可以验证历史导航重建，但不会宣称已验证 BFCache 恢复；不通过全局禁用/强制开启 BFCache 制造结果。Allow User Scripts UI 未直接观察记为 NOT_OBSERVED；API 实际成功才证明本次可用，UI 未观察不是 API 成功的替代证据。

## 强制网络门禁

默认后端仍为 macOS `/usr/bin/sandbox-exec`，策略在 [loopback.sb](./loopback.sb)。它保留原阻断，不自动回退。显式 `--linux-vm` 使用本任务独占 Lima VM：特权协调器只创建/回收全新 network namespace，不创建 veth 或外部接口；仅打开 lo，并为 IPv4/IPv6 添加 prohibit default。collector/Chrome 降权到普通用户，禁止非 loopback 的尝试返回明确 EACCES。根协调器、SSH/vsock 和依赖下载不在 Chrome IP 命名空间内；准备阶段联网与浏览器实验阶段严格分开。

两条路径均先施加内核网络约束，再启动 collector/Chrome；缺少后端、检查不明确或失败直接 BLOCKED，没有不受约束的 Chrome 回退。

IP 网络默认拒绝，仅开放 loopback；本机 Unix IPC 保留，系统 mDNSResponder socket 的出站访问被显式拒绝。`network-probe.mjs` 在启动 Chrome 前检查 loopback TCP/UDP 正向，以及固定 TEST-NET-1/IPv6 文档地址的 TCP/UDP 拒绝结果，只有 EPERM/EACCES 计为拒绝成功，超时、路由失败、连接拒绝均为 UNKNOWN。探针不使用第三方服务、DNS、真实位置、公网 API 或用户配置；不保留地址/端口到正式证据。相同探针还在派生 Node 中验证策略继承。探针证明直接 IP socket 限制；不把它扩写为系统代理、Mach 服务或所有 Chrome 后台流量已审计。

这提供允许通信仅限 loopback 的进程约束，不是对整台机器抓包，也不宣称统计过所有被系统拒绝的后台尝试。限制覆盖本次直接派生进程的 IP socket；不约束整台机器其他进程。不会为了启动 Chrome 而移除 Chrome 自身 sandbox、增加 `--no-sandbox` 或放宽策略。

原 `--cdp-port` / `--extension-id` 外接模式现在在连接前直接 BLOCKED：外接浏览器不在本 runner 的网络约束内，仅检查其调试端口为 loopback 不足以批准 GO。未提供用户声明“已隔离”即可跳过的开关。

## 文件与数据流

- `runner.mjs`：公共入口，生产基线、显式后端选择、最终必需项门禁、输出与退出码。
- `lima-backend.mjs` / `linux-netns.mjs`：独占 VM 内 staging、namespace、降权、IPC JSON、中断与清理；宿主机负责原仓库的生产完整性比较。
- `chrome-sandbox-status.mjs`：解析 Chrome155 实际的 Layer 1 Sandbox 状态，不用启动参数推断隔离已启用。
- `browser-experiment.mjs`：受约束的内部 Chrome collector，仅通过 IPC 返回观测，不能自行批准 GO；直接单独执行被拒绝。
- `chrome-startup-diagnostics.mjs` / `sandbox-compatibility.mjs`：对启动权限错误进行固定分类，并记录同策略/更严格不同策略的原生对照；不把相同策略可重应用解释为 Chrome 可启动，不猜测未观测的策略模式。
- `acceptance.mjs` / `acceptance.test.mjs`：固定验收清单、缺失/UNKNOWN/FAIL 的判定和回归测试。
- `production-guard.mjs`：比较本次开工时工作树，不要求用户既有修改等于 HEAD；不输出文件清单或哈希内容到正式证据。
- `network-guard.mjs` / `network-probe.mjs` / `loopback.sb`：进程约束、实际 socket 检查和继承检查。
- `guards.test.mjs`：生产变动、暂停移除、输出路径和真实内核网络边界的定向验证。
- `fixture.mjs` / `fixture.test.mjs`：固定 HTTP 路由，首个 head inline 同步采 earliest、load 事件再采样，collector 独立采 postLoad。
- `extension/`：固定模板和合成 JSON，A=`x-vg-a`、B=`x-vg-b`；唯一实验 surface 为 navigator.language。只申请 userScripts 和 http://localhost/*，无 service worker/content script/WAR/存储/消息桥。

数据流：本地父 runner → 网络受限 collector → loopback CDP → 非 WAR 扩展控制页 → Chrome 注册；Chrome → 匹配新文档的固定代码；fixture 实际值 → collector → 父 runner → 脱敏 JSON。CDP Runtime.evaluate 仅运行固定控制/读取表达式，不接受网页代码或给页面派发补丁/preload，不调用 userScripts.execute/scripting.executeScript，不使用 eval/new Function/远程 import/DOM 或 postMessage 配置桥。

原生语言用 `<native-control>` 记录，非预期原生值用 `<other-redacted>`。内部标签、会话、文档比较 token、profile 路径和 Chrome 原始 stderr 不进入证据；仅保留固定诊断分类。输出文件必须位于实验目录或系统临时目录，不能覆盖仓库其他文件；已有 symlink/hardlink 目标被拒绝。profile 由父启动器持有，内部清理和父级 finally 均负责释放；超时或 SIGINT/SIGTERM 终止本次进程组，父级 finally 删除临时目录；不操作用户日常 Chrome。

## 实际运行与复现

```sh
node --check experiments/userscripts-document-start/runner.mjs
node --check experiments/userscripts-document-start/browser-experiment.mjs
node --test experiments/userscripts-document-start/acceptance.test.mjs experiments/userscripts-document-start/guards.test.mjs experiments/userscripts-document-start/fixture.test.mjs
node --test experiments/userscripts-document-start/chrome-startup-diagnostics.test.mjs
node experiments/userscripts-document-start/runner.mjs --output experiments/userscripts-document-start/sandbox-evidence.json
git diff --check
```

上述 macOS 历史命令退出2/BLOCKED，stopReason=CHROME_SANDBOX_INITIALIZATION_DENIED；网络七项检查、生产380个文件 changedCount=0 和 cleanup 均 PASS，16个场景及其三阶段全部 UNKNOWN。Linux 新结果及验证命令以 linux-fixture-review.md 和 linux-evidence.json 为准。

新门禁定向测试：验收7/7、生产/网络/中断清理3/3、fixture2/2，合计12项通过；另验证外接 Chrome 参数退出2且未启动 collector。门禁测试中的完整合成报告只测试退出码规则，不能作为真实 Chrome 页面证据。生产源码、TS 测试、依赖、共享测试工具和构建输入未变，复用本会话已通过的 typecheck、npm test174/174 和 build；本任务不修改 TypeScript 测试或共享工具，没有额外运行 typecheck:tests。

真实 Chrome 使用临时 profile。runner 读取正常扩展详情页的可见 Allow User Scripts 开关，以 CDP Input 的可信鼠标输入点击，再分别读取 UI 开启状态与 getScripts 实际成功。没有 feature flag/偏好写入或私有设置 API 来放行。该开关和权限仍按 [Chrome userScripts 官方文档](https://developer.chrome.com/docs/extensions/reference/api/userScripts) 要求；这是自动 UI 操作证据，人工验收仍待用户完成。开关缺失、不可点击或 API 不可用都停止，不继续 A–F。

## 未覆盖与生产决定

不覆盖 HTTPS、about:blank、srcdoc、data:、blob:、sandbox 特殊帧、Worker/SharedWorker、Geolocation、Canvas、完整 runtime、已有 Hook 自动清理、进行中的导航/注册更新竞态、扩展更新和浏览器重启持久性；没有恶意页面、攻击、篡改、窃取、绕过、隐藏或反检测测试。

当前 `runtime-injection-paused` 保持。退出0只表示最小实验 GO；真实 runtime、规则编译、配置持久化与注册更新提交语义及生产集成授权仍需独立处理。本目录不实施生产恢复，人工验收前停在 review。

## VG-023 生产语言/时区 smoke（独立于上述已验收最小实验）

用户确认最小实验 GO 后，VG-023 已获生产恢复授权。`production-smoke.mjs` 加载实际 dist，仅合成语言/时区配置，复用同一 Linux namespace/sandbox/正常 UI 开关后端；没有改变原最小实验、acceptance 或 pauseGate 的通过条件。原 `linux-evidence.json` 保持原样，不能将原最小实验的生产暂停检查套用于已授权恢复的候选。

准备独占 VM 与依赖见 linux-fixture-review.md。运行：

```sh
npm run build
limactl start vg-userscripts-fixture
node scripts/chrome-language-timezone-smoke.mjs --output experiments/userscripts-document-start/production-evidence.json
limactl stop vg-userscripts-fixture
```

生产宿主门禁固定枚举17项，并要求namespace/collector/staging清理与运行期间生产文件不变；改用语言/时区专用入口/无旧派发的边界检查。GO仅代表这组生产 smoke，未验证项仍需独立报告。期望值仅存在扩展管理页与collector断言，localhost自己同步采实际值，无法接收预期桥。扩展update只修改VM里临时dist副本版本，仓库manifest不变；cleanup回收副本。没有第三方站点、provider、位置或ICE请求。生产语言/时区阶段已于2026-10-16通过用户人工验收，见VG-023任务记录；其他页面能力继续暂停。

## 2026-10-16 补充：空 body 与独立自动恢复

本轮补丁及新机器证据停在 review，说明见 [recovery-review.md](./recovery-review.md)。最小 fixture 的空 body 等待已修复，新报告为 [linux-body-ready-evidence.json](./linux-body-ready-evidence.json)。独立恢复使用 `node scripts/chrome-language-timezone-smoke.mjs --recovery-only --output experiments/userscripts-document-start/production-auto-recovery-evidence.json`；[新报告](./production-auto-recovery-evidence.json) 为 scope 明确的7项 GO，不代表本轮完整17项通过。

恢复期间关闭扩展管理页，禁止管理消息，直接在 worker 上下文读回注册后再验证新文档首 inline。原 `linux-evidence.json`、`production-evidence.json` 及历史 BLOCKED 均保留，不覆盖、不追加人工验收，也不改变 Navigator review 或其他页面能力暂停状态。


第二组后续就绪修复：`worker-reader.mjs` 先等待原生扩展 API 与预期版本，再读取注册；失效的 target/session/context 重新定位，真实 API 失败仍停止。新证据另存 [production-worker-ready-evidence.json](./production-worker-ready-evidence.json)，本次真实 Chrome GO7；旧候选的更新观测 BLOCKED 与上述历史 JSON 均保留。7项不代表完整17项，新增8项观察器回归也不充当浏览器证据。具体边界见 [补充记录](./recovery-review.md#第二组-worker-就绪与-target-换代补充修复)，本轮仍待人工 review。


默认执行上下文缺失的P2已在fixture中最小修复，新增回归先失败后通过；第二组新证据为 [production-default-context-evidence.json](./production-default-context-evidence.json)，真实Chrome GO7，定向检查22/22。P3宿主版本字段校验保持原样；旧候选与全部JSON保留，仍停在review。该7项不能替代完整17项，精确P2协议分支由Node/VM回归覆盖，见 [补充记录](./recovery-review.md#默认执行上下文缺失-p2-最小修复)。
