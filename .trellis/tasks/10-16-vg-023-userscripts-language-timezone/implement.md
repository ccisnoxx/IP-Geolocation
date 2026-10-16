# VG-023 执行与人工验收记录

2026-10-16；状态 **done（Trellis completed）**，用户已确认语言和时区阶段通过人工验收，completedAt=2026-10-16。当前用户明确授权在 US-EXP 人工通过后生产实施；US-EXP 已同步 done / Trellis completed。VG-013 与 US-EXP 依赖均 done。VG-022 保留原状态，未启动其后续研究。本任务未提交、push、tag、发布、创建 PR 或修改 GitHub 设置。

## 实现与权限

manifest 最低 Chrome 从119提高138，新增 userScripts，原 host_permissions 保持 <all_urls>，MV3、无静态 content_scripts、WAR为空。用户必须在正常扩展详情页开启 Allow User Scripts。API/权限/用户开关不可用时不回退旧注入。PERMISSIONS/README/INSTALL/CONFIG_GUIDE/PRIVACY/RELEASE、根 AGENTS 与对应 Trellis spec 已同步当前合同；历史调查及原证据保留。

config-model/validateConfig/resolver 仍唯一生成配置与规则事实；getPageRuntimeProfile 排除暂停 geolocation 对页面语言/时区解析的影响，auto timezone 保持显式 verified 绑定。getLanguageTimezonePayload 仅含 intlMode、启用的 language/languages、timezone；不含 Accept-Language、IP/provider、位置、ruleId/domain、完整规则/档案或其他暂停信号。override.enabled=false 不进入payload。

构建器从固定 language-timezone-entry 静态生成自包含函数，作为字符串模板交后台。所有值安全 JSON 序列化；不接受用户/网页 JavaScript，无 eval/new Function、远程 import/下载、页面消息/DOM/postMessage配置桥。该入口只复用现有 Navigator/Intl/Date 实现，includeTemporal:false；不安装 Geolocation/Permissions、Canvas 或 Worker/SharedWorker，无反检测或隐藏逻辑新增。

page-scripts 管理 MAIN/document_start/allFrames 注册，HTTP(S) matches 及 excludeMatches 复用已有 resolver/domain builder。更具体启用域始终排除父域，即使子规则无有效页面信号。services 配置队列串行调用：先撤销失效/范围变化项并确认，再 update 保留项，最后 register 新项并完整读回；幂等时零写。移除旧 ISOLATED 初始化脚本，但不再注册content通知或接收initializeRuntimeForSender，生产 services 无documentId/executeScript路径。既有诊断采样继续独立使用scripting，不是恢复回退。

worker初始化、onStartup、onInstalled（含update）及管理页重试同一对账路径。Chrome扩展update清除注册后恢复。DNR/Chrome privacy WebRTC原语义不变，独立同步/报告；不因页面注册不可用而停止。

## 快照、UI 与失败边界

注册完成后创建的新文档使用当前配置；已加载和BFCache文档保留旧快照，不热更新、不撤销旧Hook、不调用tabs.reload。配置切换或禁用后须完整reload或关闭重开。只有注册读回成功后才提示已有受影响页面重载。pendingReloads仅存tab ID/URL摘要并提供保守提示，关闭/导航会清理；同URL重载后提示可能仍保留，UI始终不把注册成功当当前页面实际值已确认。

Popup/Options区分API不支持、权限缺失、Allow User Scripts未开启、注册同步失败、注册成功待reload、新文档可用、无启用页面规则，常驻说明其他surface暂停与不支持文档。普通HTTP(S)顶层/iframe支持；about:blank/srcdoc/data/blob/特殊sandbox为unsupported/UNKNOWN，运行时拒绝非HTTP(S)与opaque origin，不启用origin fallback。

每个已捕获浏览器API失败进入RuntimeSyncReport，不返回纯成功，失败不提示reload。注册读取故障不能推断用户开关关闭，报sync-failed/状态未知；无法确认数量为null。明确namespace不可用且版本满足时才提示正常用户开关。update失败尝试撤销受影响旧项，清理失败也明确报告。部分合法update成功后新增失败，成功项可能保留；不承诺任意API失败能清空全部注册。用户开关/权限由Chrome约束执行，无旧路径补偿。无法确认清理时应关闭扩展并检查权限，旧文档仍须重建。

## 验证结果

| 实际执行 | 结果与证据范围 |
|---|---|
| git diff --check | 通过；新文件另检查行末空白 |
| npm run typecheck | 通过（最终 npm run build 内执行 tsc --noEmit） |
| npm run typecheck:tests | 通过；strict测试及引用源码 |
| npm test | 最终185/185通过，0失败/skip；Node/VM/mock/静态wiring，不是Chrome |
| npm run build | 最终通过；Vite33模块、六入口（content为空）、固定模板进入后台bundle |
| npm run test:e2e:chrome -- --dry-run | 通过，清单已更新VG-023；不执行Chrome断言 |
| 既有后台/诊断定向 | 子任务60/60通过；首次安装零register断言加强后对应测试通过 |
| UI定向 | 子任务21/21通过，涵盖保存/重试/快照/开关和暂停说明 |
| 独立P2修复定向 | page-scripts/background-services/runtime-sync-ui共47/47通过 |
| 原最小实验验收逻辑与fixture | node --test experiments/userscripts-document-start/acceptance.test.mjs experiments/userscripts-document-start/fixture.test.mjs：11/11通过 |
| 已人工验收的真实最小实验 | linux-evidence.json：GO/0，25必需项PASS、16个A–F场景、实际BFCache hit；原文件保留未覆盖 |
| 新生产真实Chrome smoke | production-evidence.json：GO/0，17项PASS，实际dist，Chrome155.0.8059.84/Linux ARM64；下表细分 |

重跑中曾因collector在chrome://sandbox导航完成前访问空document.body而中断（自动化错误，未形成sandbox失败判定）；改为可空正文读取后，最终运行17项全通过。没有放宽Chrome或网络sandbox。最终collector补录首inline、B保存前后、禁用及原生对照的实际观测。原最小fixture未在已恢复生产候选上重跑：其pauseGate严格要求旧暂停实现，不能偷偷修改旧实验门禁迎合新候选；本次直接复用已人工验收JSON，生产采用独立入口与边界检查。

## 新生产 JSON 的实际覆盖

文件：experiments/userscripts-document-start/production-evidence.json；命令：构建后运行 `node scripts/chrome-language-timezone-smoke.mjs --output experiments/userscripts-document-start/production-evidence.json`。使用已准备的独占Linux VM；Chrome自身sandbox读回PASS（Layer1/PID/Network namespaces/seccomp/adequate），网络只有lo、IPv4/IPv6 prohibit default、非rootcollector，7项socket/继承检查PASS。正常详情页可信pointer使Allow User Scripts false→true，不改prefs/私有设置，不使用放行开关。

| 合同 | 真实观测 |
|---|---|
| 默认关闭 | master=false/rules=[]；开关未开启时明确switch-required；正常启用后getScripts为空，默认不注册站点脚本 |
| 保存规则 | 控制面通过真实扩展消息保存，注册ready、组件ok |
| 首inline | localhost top与普通同源HTTP iframe均readyState=loading、scriptIndex=1、inline=true；earliest/load/current为ja-JP / Asia/Tokyo / offset -540 |
| 不匹配 | 127.0.0.1完整样本保持原生 |
| 最长域名 | sub.example.test首inline为ko-KR/Asia-Seoul，父example.test的excludeMatches排除子域；同一netns loopback映射，无外部访问 |
| A→B | 保存fr-FR/Europe-Paris后同文档仍ja-JP/Asia-Tokyo；完整reload新文档为fr-FR/Europe-Paris/-60 |
| 模式 | A strict与B compatible真实运行；compatible显式en-US/UTC保留，默认locale/timezone采用B；细分参数与Date语义由既有VM测试补充 |
| 禁用 | localhost规则禁用后注册撤销，已有B文档仍B，完整reload恢复原生 |
| worker恢复 | 测试主动清注册，stopAllWorkers后新worker启动重建注册，新文档B |
| 扩展update | VM中临时dist版本2.1.1→合成2.1.2，同目录/同extension ID更新，配置与B注册恢复；仓库manifest未改版本 |
| DNR/WebRTC | 实际请求Accept-Language为fr-FR,fr;q=0.9；privacy实际policy为disable_non_proxied_udp |
| 暂停 | Canvas启用配置也不改变字体样本；Dedicated/SharedWorker仍原生语言/时区，Permissions geolocation为原生prompt；不请求位置 |
| 清理与输入 | collector/coordinator/staging全部PASS；运行期间384个生产文件changedCount=0，语言/时区入口边界PASS |

没有访问第三方测试站点、provider、STUN或真实IP/位置数据。页面只采实际值，配置仅在扩展管理上下文与collector中。JSON保留合成语言/时区/原生样本、状态和版本，不含个人路径、精确公网IP、位置或凭据。

## 独立复核

fresh只读critical_reviewer确认1项P2：一般getScripts故障被误判用户开关关闭。主代理按建议改为sync-failed并补“已有注册+非开关读取异常”断言，同时把失败数量从0改为null；47项定向、完整185项、类型/构建及最终真实Chrome通过。未二次派发复核，不把主代理验证称为独立二次复核。未确认P0/P1。审计Bundle已关闭校验通过，audit_id=20261016T133620Z-vg-023-userscripts-production-386e54b2；3次派发均主代理验收通过，含1次独立复核，具体由有效SUBAGENT_EXECUTION_DIGEST记录。

## 未运行与已知限制

- 未在Chrome138实机、其他Chromium、HTTPS或跨origin/OOPIF iframe执行本轮生产smoke；minimum138与URL匹配合同已实现，不能把Chrome155结果扩写为全矩阵。
- 生产BFCache未单独重跑；原已人工验收最小实验有实际BFCache hit，本轮旧文档快照有实际证据，生产代码无热更新/生命周期撤销。不能将最小实验写成完整生产BFCache直接验收。
- 真实ChromeAPI部分失败/权限撤销/策略控制故障矩阵未人工注入；故障语义由Node/mock与独立复核覆盖，不承诺失败即能清空所有注册。
- 未运行本阶段范围外的全部runtime/worker/geolocation历史Chrome runner、ICE、第三方站点、Chrome文档缺陷研究或对抗测试。没有运行远端CI、打包审计或发布。
- Popup/Options状态路径经真实脚本VM与Chrome控制面验证，上一轮未单独记录真实action Popup视口/人工点击结果；本次补录用户对语言/时区阶段的整体人工验收，不推定新增逐场景实测证据。
- Mac原Seatbelt启动仍BLOCKED，Linux受约束后端GO不表示已修复Mac。
- 用户已有runtime/测试重构与VG-022等无关修改保留，没有回滚或额外恢复surface。

## 清理与下一步

Chrome/profile/fixture/连接、namespace与VM staging已回收，独占VM停止，保留可复用Debian/Chrome/Node安装供人工复验。临时调试脚本/测试日志删除；dist是常规忽略构建输出，JSON是明确交付证据，原实验历史文件保留。用户已完成人工验收，本次仅同步完成状态；其他页面能力继续暂停，不启动后续任务，不提交/push/tag/发布。

## 2026-10-16 人工验收确认

用户在当前对话明确确认：“语言和时区这一阶段已通过我的人工验收，请同步 VG-023 的验收记录并标记 done。其他页面能力继续暂停，不启动后续任务，不 push、不发布。”

据此将稳定化清单VG-023由review标记done，Trellis由review标记completed，完成日期为2026-10-16。验收仅针对已实现的语言/时区阶段，关联原生产机器证据experiments/userscripts-document-start/production-evidence.json（GO/0，Chrome155.0.8059.84 Linux ARM64，17项PASS）；原最小实验linux-evidence.json及其人工记录保留。本次未修改或重跑Chrome证据，不把整体人工确认扩写成此前未运行场景的新自动化结果。

Geolocation、Permissions geolocation、Canvas、Worker、SharedWorker继续暂停；Temporal未恢复。其他文档类型、快照与已知限制不变。未启动后续任务，未修改生产代码或构建输入，未提交、push、创建tag、发布或修改GitHub设置。原VG-022等其他任务保持原状态。

本次只更新验收/状态和对应待验收说明，复用上一轮185/185测试、typecheck、typecheck:tests、build、Chrome dry-run及真实Chrome GO证据；未重复运行。执行git diff --check，并核对本次改动仅在记录与说明文件、原Chrome JSON字节未变。
