# 质量规范

> VG-023：Chrome 138+ / userScripts / 正常 Allow User Scripts。生产通过固定构建模板加 resolver 最小语言/时区 JSON 提前注册 MAIN / document_start，普通 HTTP(S) 顶层及 iframe 每文档快照。无 content 初始化或 documentId executeScript 回退，无热更新/自动 reload。Geolocation/Permissions geolocation、Worker/SharedWorker 仍暂停；字体暴露过滤仍暂停，配置仅保存；特殊文档 unsupported / UNKNOWN。任务及证据见 [VG-023](../../tasks/10-16-vg-023-userscripts-language-timezone/prd.md)。

## 当前技术与权威边界

VanishGeo 使用 TypeScript + Vite/Rollup 构建 Chromium MV3 扩展，原生 HTML/CSS/DOM 为界面。源码在 src，运行时从 dist 加载；质量检查必须同时考虑类型、ES module 构建 wiring 和 Chrome 文档/权限边界。目录与入口见 [目录结构](./directory-structure.md)，schema v3/verified 事务见 [状态管理](./state-management.md)。

配置归一化、匹配/解析、迁移/持久化分别以 `src/shared/config-model.ts`、`config-resolver.ts`、`storage.ts` 为权威。background/services 拥有副作用和配置修改事务，injected/runtime 拥有 MAIN-world 页面 hook。新增 UI、诊断或测试不得复制域名匹配器、可信配置桥或 storage 事实来源。

## 构建与 wiring

- 使用 TypeScript ES module imports，Node 测试通过 tsx 导入维护源；不添加 global/CommonJS 双导出，也不以仓库根可直接加载扩展为要求。
- manifest 和 HTML 引用 dist 路径；userScripts code 来自固定构建模板字符串。入口改名/移动必须同步 Vite input、引用和 `tests/extension-wiring.test.ts`，并检查实际构建。
- `src/injected/runtime.ts` 是 virtual module facade，构建器静态生成自包含函数；生产后台只消费语言/时区固定 source；完整函数保留隔离测试，不是独立 runtime 入口或 web-accessible 文件。注入函数不能依赖模块闭包和外部 chunk 在页面中的可访问性。
- dist 包含共享 assets chunks，完整分发不能只拷贝六个 JS 入口。使用当前构建输出作为证据，不用 Vite 注释推断不存在共享 chunks。
- 不直接修改 dist，不在业务源码中引用某次构建的哈希 chunk 名。

## 注入、消息与权限

- manifest 保持 MV3、最低 Chrome 138、userScripts 权限、无静态 content_scripts、WAR 为空。正常开启 Allow User Scripts 是用户前置条件，不写 profile/prefs 或用命令行绕过。不可用时 fail closed，区分 API/权限/用户开关/注册失败。
- 生产注册只来自 validateConfig/resolver 最小 payload 与构建模板；安全 JSON 值，不接受网页或用户 JavaScript，不使用 eval/new Function、远程 import/运行期下载。不得写 IP/provider、完整规则/档案或暂停/未启用信号。
- Chrome 直接按 MAIN / document_start / matches / excludeMatches / allFrames 执行普通 HTTP(S) 新文档；最长域名优先，即使子规则无有效页面信号。无 content 初始化、worker documentId 或 scripting.executeScript 生产回退。
- 所有注册修改经 services 唯一串行队列，先撤销失效/范围变化并确认，再更新保留项，最后新增并读回。每次失败进入报告；worker 初始化及 onInstalled(update) 幂等恢复。注册完成后才能提示手动完整 reload/关闭重开，不自动刷新，不热更新旧/BFCache 文档。
- 普通 iframe 按自己的 URL 匹配；about:blank/srcdoc/data/blob/特殊 sandbox 明确 unsupported / UNKNOWN，不启用 origin fallback 或父子帧遍历。管理动作仍 requireExtensionPage，无 postMessage/DOM 配置桥。
- HTTP 请求头保持原生；仅保留DNR权限用于历史1100至2099范围清理和验证，不生成新规则；WebRTC 使用 Chrome privacy setting，期望策略与实际控制状态分别报告。
- manifest 权限或 host scope 变化须有明确任务授权，同步 `PERMISSIONS.md` 和 wiring 测试。不得为测试放宽权限或校验；optional host permissions 需要独立设计拒绝状态、重新注册与失效处理。
- Refactor 默认保持 runtime action、storage 键/schema、payload 和入口合同；语义变化必须在任务中明确授权和验收。

## 页面 hook 与设备透传

生产语言/时区入口仅安装Navigator语言与Intl/Date，includeTemporal:false。Geolocation/Permissions、字体和Worker/SharedWorker继续暂停，完整runtime不生产派发。registry.ts 只拥有本次安装的闭包状态和原生快照；不得把 state、controller 或 marker 放在 window/self 或其他页面可访问的对象属性上（包括不可枚举或 Symbol 属性）。Object/Reflect 反射函数和 Function.prototype.toString 保持原生引用与 descriptor，不维护 descriptor/source 虚拟化缓存。

Navigator / WorkerNavigator getter 保留原生 prototype 位置、descriptor flags、name/length 和非法 receiver 异常；仅当前 navigator 返回配置值，其他 receiver 调用原生 getter。属性后来被网页替换、删除或冻结时，反射 API 必须报告实际值。函数 source 由未修改的引擎 API 决定，不保证包装函数与原函数源码文本相同。

`applyVanishGeoRuntime(payload)` 返回私有 `RuntimeController`（仅含 `update(payload)`），调用方持有同次安装的句柄以保留幂等和未来 Worker 配置更新。初次禁用不会安装 surface，之后该句柄仍只更新未来 Worker；不热更新既有页面 surface。不同序列化调用创建独立闭包，不再通过 documentId/Symbol 查回旧状态；生产使用每文档一次执行的专用入口，不导出或更新 controller；不能把完整 runtime 返回函数当作可 JSON 传输的 Chrome scripting result。

无目标检测证据和独立任务授权，不新增 WebGL/GPU、Audio、screen、hardware concurrency、device memory、原生字体库存、codec、WebGPU 等设备指纹伪装。当前选择性字体暴露过滤维护源不自动授权扩大伪装面。对未接管表面记录原生透传证据，而不是由 IP 地理位置猜测设备属性。

## Worker bootstrap（隔离 runtime，生产继续暂停）

页面 wrapper 当前只包装同源 HTTP(S) worker URL，其他 URL 保留原生路径；classic worker 在 prelude 后 `importScripts`，module worker 在 prelude 后 `await import(...)`。不能把实际 module 静态 import 放在补丁正文后，因为模块依赖会先执行。

SharedWorker 的 options/name、复用和端口行为，以及 CSP、嵌套 worker、Blob URL 释放、同步/异步失败的可观察结果，应按实际变更选择浏览器验证；不把 Node 构造 mock 或 VM prelude 检查当成完整 Chrome worker 支持证据。

SharedWorker URL Map 与当前 worker patch source 存在本次安装闭包的 RuntimeState；key 包含原始绝对 URL、type、name、credentials 与完整补丁源签名。同 key 复用，同一私有句柄的 update 更新未来 worker 的补丁源而保留缓存/代理；options 的已支持成员按 credentials/name/type 单次转换，key、bootstrap 和原生构造使用同一快照，显式 null name 为字符串 "null"，枚举仍由原生拒绝。新浏览器额外选项保留原生读取，未声明完整新选项转换矩阵。

Dedicated（含已有嵌套包装）在原生构造器返回/同步失败后 revoke 临时 Blob URL；Shared 新项同步失败时撤销，已有项不因单次失败被删除，pagehide 清空所有 Shared URL。BFCache 恢复从新缓存周期开始，不承诺跨文档共享或改变存量 worker 配置。异步 CSP/脚本错误保持 error，不以网络重试掩盖失败。

module SharedWorker 动态 import 期间及初始队列排空期间，connect 被缓冲；业务监听器就绪后通过携带同一 ports 的合成 MessageEvent 交付，缓冲事件 isTrusted=false，缓冲队列排空后的 connect 原生交付。这是当前动态 bootstrap 的明确边界，不用新事件 hook 或伪造 isTrusted 隐藏它。`scripts/chrome-worker-smoke.mjs` 验证同 key scope/计数、module 依赖顶层补丁、revoke 后 classic/module/嵌套加载、反射/cross-origin/CSP/异步错误与实际 pagehide；自动 smoke 不等于人工验收。


## 诊断与隐私

- 页面可见伪装验收必须来自已 allowlist 的普通 HTTP(S) origin。扩展 origin 页面只能作为 launcher、说明或原生基线面板，不能证明目标网页注入。
- 保留 `npm run test:e2e:chrome` 半自动入口：构建后可启动/明确指向加载 dist 的真实 Chrome profile，并列出 headers、WebRTC policy/ICE、language/timezone/geolocation、iframe、worker 和设备透传场景。
- `--dry-run` 只检查 dist 必需文件并打印目标/清单，不执行断言、不安装扩展、不产生浏览器通过证据。
- 不写入精确公网 IP、真实个人路径、精确位置或凭据；fixture 使用合成/脱敏数据。外部诊断 URL 只带固定 UI 参数，不序列化扩展预期配置或 privacy API 快照；不得换用其他 query、路径、cookie、外部存储或页面桥。MAIN runtime 调试日志只输出固定提示，不传完整 payload 或预期坐标。
- 外部 leak-test 固定 observation mode，只展示实际观测并保持 UNKNOWN，不判定配置 PASS/FAIL；普通网页无法读取 Chrome privacy policy。页面与同源 header fetch 使用 no-referrer。数据流及托管部署限制见 [PRIVACY.md](../../../PRIVACY.md)，VG-003 扩展侧验证与外部观测分离。

## 扩展侧诊断报告（VG-003）

- `openDiagnosticPage` / `openLeakTest` 打开扩展 `diagnostic/report.html`。hosted/localhost 目标由报告页固定按钮打开，URL 只带 ui=zh；报告资源不设置 web accessible。
- `prepareDiagnosticRun` / `executeDiagnosticRun` / `cancelDiagnosticRun` 仅接受精确报告 URL、扩展 id 和可信 sender tab/documentId；run 绑定 owner 与目标 top documentId。后台仅通过现有 config-resolver 解析，最小预期字段、TTL（两分钟）和状态在内存，不写 local/session。完成、取消、过期、目标/报告导航或关闭释放敏感状态；重启失效。
- MAIN 采集函数自包含且无预期参数；普通 origin 同源 header echo 使用 no-referrer、omit credentials、禁止重定向和超时。WebRTC 策略实际值/控制权由后台读取，ICE 地址只归纳数量，不把空候选或 policy PASS 当防护通过。
- 每次异步采样后复核 run 与文档。子帧 MAIN 采样前重新读取配置，交付前及临时 iframe 清理后核对各子帧有效预期与文档身份；顶层不变不代表子帧授权未撤销。about:blank/srcdoc 来源不能独立确定时 UNKNOWN。
- 取消/过期通知可及时拒绝 execute，但不直接终止已派发 Chrome 函数；采样函数负责有界超时与资源清理，失效后不得启动下一阶段位置/header/STUN/worker 采集。执行或清理的旧文档调用先失败于导航事件时，使用可信 tab/ISOLATED identity 分类，不透出网页异常文本。
- 比较只在扩展报告页；时区别名对实际与预期采用相同 Intl 规范化，原始值仍展示。随机坐标按配置半径比较。禁用或不可观察为 UNKNOWN。设备透传用同文档 ISOLATED 参考，只证明当次实际值，不新增伪装。
- 报告完成后后台已消费 run，页面释放 active 指针；之后 TTL/清除只处理本地报告，不依赖后台仍存在。页面没有诊断持久化或导出。
- ChromeSetting 完成只能由 callback/Promise 确认，原生函数 length 不能用于判定异步 API 已成功；回调 lastError 保持失败。
- `node scripts/chrome-diagnostic-smoke.mjs` 使用 Node 22+ 原生 WebSocket 与当前 Chrome DevTools protocol、独立临时 profile、合成配置及 localhost 完成定向真实 headless Chrome 验证。profile/server 在 finally 清理；输出仅状态和行数。生产 TTL 实测需要等待两分钟；它不等于用户人工验收或所有浏览器边界验证。

## Popup 视口

Chrome action popup 保持保守的明确视口（当前 html/body 为 380×600，外层 overflow hidden），滚动由内部 `.container` 承担。grid/flex 子项保留 min-width: 0，长域名/状态文本换行；不能以普通 tab 中可滚动证明 action popup 未被裁切。视口合同变动更新已有 wiring 检查，并做目标 Chrome popup 验收。

## 验证命令与证据层级

任务收尾至少运行或复用输入未变化的下列实际证据；不因为只有文档变更而把未执行写成通过，也不重复已经可靠通过的相同输入检查：

| 命令 | 能证明的范围 | 不能替代 |
|---|---|---|
| `git diff --check` | 已跟踪 diff 的 whitespace；新文件另做 whitespace 检查 | 类型、运行时和新文件内容正确性 |
| `npm run typecheck` | tsconfig include 的 src 静态类型 | 测试文件完整类型检查、Chrome 行为 |
| `npm run typecheck:tests` | 继承 strict，检查 tests/**/*.ts 及引用的源码 | 测试执行和 Chrome 行为 |
| `npm test` | `tests/*.test.ts` 的 Node/VM/mock/静态 wiring | 真实 MV3、DNR、privacy、frame/worker 行为 |
| `npm run build` | tsc + Vite，真实入口/chunk/静态资源输出 | Chrome 加载、页面调用和发布验收 |
| `node scripts/chrome-acceptance.mjs --dry-run` | 构建产物必需文件与半自动入口清单 | 任何真实 Chrome 验收 |
| `npm run test:e2e:chrome` + 人工场景执行 | 已记录候选、Chrome 版本及逐项观测的浏览器证据 | 仅启动进程仍不能算通过 |

`npm run check` 依次聚合源码类型、测试类型、单元测试与构建，使用 && 传播失败。push/PR CI 与 tag release 执行同等门禁；失败不能进入后续构建、打包、上传或 Release。release checkout 使用完整历史，changelog 遇 shallow 显式失败。流程与权限以 [RELEASE.md](../../../RELEASE.md) 为准；自动门禁不代表人工 Chrome 验收。

按改变的具体合同选择定向测试。只有新增/改变/真实缺失的可观察合同才增加测试，不为文档更正新增镜像测试或 broad snapshots。运行时边界改变时，wiring/构建之外还须取得能直接观察该边界的真实 Chrome 证据；环境不能执行时明确报告缺口，不能用静态或 VM 代替。

## 当前测试入口

| 维护测试 | 当前保护的合同 |
|---|---|
| `tests/release-gates.test.ts` | CI/release 顺序和最小权限、本地失败传播、合成 Git 历史与浅克隆失败 |
| `tests/config.test.ts` | 归一化、迁移转换、有效档案/规则解析、allowlist matches |
| `tests/background-services.test.ts` | 检测确认、导入降级、刷新、可信 sender、首次初始化和旧键迁移的 mocks |
| `tests/webrtc.test.ts` | policy 映射、clear、不支持状态的 Chrome mocks |
| `tests/anti-detection-runtime.test.ts` | VM 中私有更新句柄、直接 frame 调用、worker wrapper/缓存/回收及 debug 日志隐私 |
| `tests/navigator-contract.test.ts` | 页面/独立 frame realm/实际 Worker prelude 的全局状态不可达、原生反射引用、prototype/receiver 和 descriptor 替换/删除/freeze |
| `tests/diagnostic-report.test.ts` / `diagnostic-report-ui.test.ts` | 一次性 run、owner/TTL/导航/取消/授权变化、真实值比较与报告本地清除的 Node/mock/VM 合同 |
| `tests/diagnostic.test.ts` | header/realm/ICE 实际结果归一化及页面 locale 示例 |
| `tests/leak-test-observation.test.ts` | VM 执行实际页面脚本，旧预期 query 被忽略、API/header/ICE 观测与 UNKNOWN 合同 |
| `tests/extension-wiring.test.ts` | 源码/manifest/HTML/权限/脚本结构约束 |
| `tests/ui-state.test.ts` | 站点状态与未绑定/未验证档案错误投影 |

完整场景、后续负责人及基线覆盖缺口见 [验收矩阵](../../../docs/stabilization/acceptance-matrix.md)。检查 diff 时确认没有无关改动、第二套事实来源、页面可控 payload、弱化失败或敏感数据泄露；仅对证据能支持的结果作通过结论。

## 首个 inline script 时序证据（VG-009）

`fixtures/injection/earliest-inline.html`及其子文档必须在head首个inline script同步保存实际值，不能等待DOMContentLoaded、消息或runtime marker。earliest、load回调和postLoad报告采集是三个不同阶段，分别判定，后阶段PASS不能替代earliest失败。fixture自身JSON仅保存实际值；生产页不添加采样marker，不接收预期。

`executeInjectionTimingRun`与既有full execute消费同一种prepare run，精确report来源、owner/documentId、TTL、取消、导航和配置复核仍由diagnostic-runs拥有；该专用采集不调用位置/header/STUN。ISOLATED有效origin只用于fallback诊断比较，不更改生产sender授权。不明来源或缺失/非法fixture为UNKNOWN。页面实际观测仍可能受页面干预，不能当可信配置。

`npm run test:e2e:chrome -- --injection --runs=3`使用Node22+原生WebSocket/CDP、临时Chrome profile与合成配置，返回每帧每阶段及对照分类。退出0=全PASS、1=实际FAIL/UNKNOWN、2=自动化失败；`--output`仅保存脱敏JSON。dry-run不执行浏览器。若竞态来自ISOLATED→后台→MAIN异步边界，如实记录，不通过推迟首脚本读取、扩大注册/权限或建立页面配置桥来制造PASS。

## 模块化 runtime 验证（VG-012）

- `tests/anti-detection-runtime.test.ts` 使用同一生成器执行完整函数，保留原 VM 行为断言；不能读 facade 的 TypeScript 文本当完整 runtime。
- `tests/runtime-modules.test.ts` 直接导入页面/worker 模块并传入 realm/state；`tests/runtime-build.test.ts` 检查纯逻辑、外部绑定拒绝、最终二次打包函数和 worker/nested 脱离闭包、source map 实际位置与 page/worker watch 重建、缺源/循环失败。
- 生成器在每次生产 buildStart 执行，即使生产暂停/未引用 runtime，失败仍中断构建；dist 六入口和现有共享 assets 不变。未来恢复调用时插件继续检查最终函数外部绑定。
- 历史 VG-012 等价脚本（以当时版本为准；本次闭包状态及原生反射语义变更后不再作为当前等价门禁）：`node --import tsx scripts/runtime-modularization/chrome-equivalence.mjs --baseline-runtime <任务前runtime.ts> --output <脱敏JSON>` 在临时最小扩展中比较旧/新函数，使用真实 scripting API 的当前 documentId、MAIN/ISOLATED、严格 CSP/iframe 和合成位置/worker fixtures。此证据只证明等价，不证明生产派发安全；正式 dist 的暂停使用既有 chrome-safety-gate 独立验证。
- VG-009 历史 runner 要求配置保存返回 ok，与当前安全暂停的 partial 不兼容；该入口退出2不能当时序FAIL或模块化回归。暂停下补采仍分别记录 earliest/load/postLoad 的实际原生值和相对伪装预期的FAIL；不得把原生保持正确写成伪装PASS。原VG-009竞态与VG-011原生错投证据不改。
- 两次构建的 source map 能指回维护 TS，不代表 Chrome 复制 func 后 DevTools 自动获得该 map。Chrome119、其他浏览器和完整手工验收单列覆盖缺口。

## Navigator 原生合同回归

`node --import tsx scripts/chrome-navigator-contract.mjs` 使用独立临时 Chrome、三个本地 server 和合成语言，覆盖页面及同源/跨源/srcdoc/about:blank iframe、跨站点 OOPIF、sandbox URL/srcdoc/about:blank opaque origin。跨源保留不同 localhost 端口；跨站点使用 localhost 与 127.0.0.1，Chrome 开启 site-per-process，并以目标实际为独立 iframe target/session、URL 与 frame 身份一致作为 OOPIF 通过条件。不能只凭跨源 URL 或启动参数宣称 OOPIF。

runner 自动附加 iframe target，按各 session 合并 frame tree；默认执行上下文与远程 objectId 都携带所属 session，销毁/清除/分离按 session 清理，不回退顶层。逐 realm 捕获原生基线并核对 prototype/descriptor/getter 自身属性、receiver、原生反射和全局 own keys（含 Proxy/可访问的另一 realm）。跨源及 OOPIF 内保留同源原生子帧作为合法非目标 receiver/反射对照。每次单 frame 安装或 descriptor 替换/删除/freeze 后检查未修改 realm，防止误定向或原型/状态串扰。

sandbox 只设置 allow-scripts，不设置 allow-same-origin；三个文档有效 origin 必须为 null。父子及 opaque sibling 之间的 navigator/构造器/反射访问在安装前/后与 descriptor 变更后保持 SecurityError；不能把相同 null 字符串视为相同 origin。opaque 场景在本 realm 检查原生非法 receiver，并保护跨 origin 拒绝；不通过特权 CDP 把网页无法取得的 Navigator 当作合法跨 realm receiver。内部状态检查使用原生快照、Proxy 枚举和 getter 属性；不扩大生产能力。

实际 classic/module Worker 与 SharedWorker 的生成 Blob 继续先捕获原生基线再执行同一合同探针；更新句柄由 CDP objectId 私有持有。脚本不加载或恢复生产注入、不请求 provider/位置/ICE，finally 清理三个 server/profile/Chrome。Chrome119、sandbox 禁脚本、导航/进程交换生命周期及生产派发资格尚未验证；当前 Chrome 的静态 frame 合同回归不替代这些门槛。

## VG-023 生产语言/时区浏览器证据

实际 dist 的 scripts/chrome-language-timezone-smoke.mjs 运行于独立 Linux VM 的新网络 namespace，仅 loopback、IPv4/IPv6 prohibit、非 root Chrome 和自身 sandbox；通过正常扩展详情 UI 的可信 pointer 开关启用。localhost 最先 inline 同步记录实际值，配置只由扩展管理页提交，不写预期到页面。分别验证顶层/普通 iframe 首读、负对照、父子域优先级、strict/compatible、A→B 旧快照/reload、禁用/reload、worker 重启/扩展 update 恢复、DNR/privacy policy 和暂停 surface。

原最小实验的已人工验收 linux-evidence.json（含真实 BFCache hit）保留；production-evidence.json 是生产定向 smoke，不能把原实验当生产全部 surface 验收。两者均不可被 dry-run/Node/mock 替代；Chrome 138 实机、其他 Chromium、真实 action Popup 和 ICE 网络结果单列未验证。旧 VG-009/full-worker runner 含本阶段不支持能力，只保留历史或隔离回归含义。


## VG-028 字体与网络收窄

字体生产暂停，维护源仅过滤目标measureText与FontFaceSet.check，内置16项厂商／软件字体；普通字体、绘制、像素、图像导出和未接管API保持原生。header echo只作原生观测，不与网页语言比较PASS/FAIL，不传递预期配置。网络升级与Node/VM/dry-run证据分别记录。
