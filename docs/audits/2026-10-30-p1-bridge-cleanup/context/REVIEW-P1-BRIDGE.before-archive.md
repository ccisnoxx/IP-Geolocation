# 消息桥信任边界审查

2026-10-30。原 MAIN 消息桥 P1 保持未关闭。用户在方案研究和独立设计审查后选择：保留当前功能合同，先加固后台消息分权；不采用刷新式快照，不改变 Chrome 119 基线，不增加权限。

## 缺陷与范围

`src/injected/runtime.ts` 接受页面窗口提供的握手端口，回传构建 nonce，再把端口载荷交给 `applySpoof`。构建常量随发行包公开，不能充当秘密；MessagePort 本身也不证明握手对方属于扩展。先前基于构建 nonce 的 HMAC 候选已撤销，不作为本阶段基础。

MAIN 与页面共享 JavaScript 环境，页面可干扰注入脚本。这不同于越过扩展权限边界。现有 ISOLATED 桥只转发 `getPayloadForUrl`、`reportFontLayers`、`reportWorkerFallback`，没有任意后台 action 转发。因此不能把当前事实扩大为“网页已经可以执行全部后台管理动作”。[Chrome 执行环境说明](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

Chrome 要求限制内容消息可触发的特权动作。本阶段把这一规则落实在后台入口；它不为现有 MAIN 通道补上认证，也不证明页面报告真实。[Chrome 消息安全说明](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#security-considerations)

## 已选择的后台边界

| 来源 | 身份依据 | 能力 |
| --- | --- | --- |
| 扩展 UI | browser sender.id、本扩展 chrome-extension 协议与主机、精确 popup/options/leak-test 页面路径 | 保留管理与诊断动作 |
| 内容脚本 | browser sender.id、tab.id、frameId、documentId、文档 URL 或已证明的父链 | 仅本地文档配置拉取及两类诊断上报 |
| 其他来源 | 无符合上述合同的身份 | 在服务调用前拒绝 |

UI 可以位于标签页内，不能用是否存在 `sender.tab` 区分来源。URL 校验不能只比较可能为 `null` 的 `URL.origin`。发送者字段来自 Chrome，而不是请求体中的同名字段。[MessageSender 合同](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)

HTTP(S) 内容文档仅使用 `sender.url`。不透明框架保留“继承最近可证明父文档规则”的应用策略：浏览器 frame 记录必须匹配 sender 的 frameId 和 documentId；每层父关系同时匹配 parentFrameId 和 parentDocumentId。链断、换文档、循环、未知协议或查不到证据时拒绝，不回退任意顶层 URL，不使用请求自报 URL/referrer。

该父继承策略不是对真实创建者来源的断言。Chrome 的 `matchOriginAsFallback` 可能依据创建者或导航发起者，而非父 frame。文档 ID 关联字段从 Chrome 106 起可用，符合当前最低版本。[注册脚本合同](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)、[webNavigation 文档身份](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)

归属暂不可证明时返回错误，让现有内容桥重试；不能伪装成规则未命中而清除烘焙值。成功拉取由后台返回有效 URL，内容桥按此校验 payload 的 hostname，避免继续把本地 referrer 当权威。父页推送不能覆盖独立子域，clear 仍按各自规则重拉。

`noteDocumentInjected` 暂时保留为合法内容脚本、browser documentId 绑定的幂等提示。它只提示该文档的桥正在运行，不认证 MAIN 安装成功，不授权任何动作。孤立删除它会使已注册注入的文档重复安装 runtime；这违反现有幂等合同。UI 拉取和两类诊断不得写入此提示。

字体和 Worker 报告仍按 hostname 聚合，属于未独立验证的观察。它们不驱动配置、权限或注入账本。界面应明确报告来源与聚合范围，不能把报告次数写成当前页面的实际实例数。

## 未采用的替代方案

| 候选 | 审查结论 |
| --- | --- |
| 构建 nonce 作 HMAC 密钥 | 密钥公开，不能认证 |
| 后台 executeScript 再 dispatch/postMessage | 页面仍能构造同类输入，不能认证 |
| 公开 window updater 或重复运行 runtime | 前者页面可调用；后者丢失旧闭包恢复栈，可能叠加补丁 |
| 每文档浏览器注入一次配置快照，删除所有更新入口 | 能移除该控制入口，但修改配置、clear、watch 和已有 Worker 更新需要换文档 |
| userScripts 动态快照 | 需另行评估 Chrome 120+、权限和用户开关，以及注册顺序和旧文档失效策略 |

`executeScript` 的函数会序列化，不能访问旧 IIFE 的私有状态；`injectImmediately` 不保证先于页面脚本执行。普通构建已有异步窗口，但把可变烘焙包改成后台解析后注入，会新增首屏真实信号窗口。仅刷新也无效：当前 BAKED 是构建常量，刷新会再次应用旧配置。用户未接受这些合同变化，本阶段不实施。[Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[userScripts 要求](https://developer.chrome.com/docs/extensions/reference/api/userScripts)

uBlock Origin 的 `safe-self` 缓存当前 realm 的内建对象，可参考其减少后续环境干扰的思路；这不能证明晚注入时拿到的是可信原生对象。本阶段未复制上游代码、未引入密码学依赖。[上游实现](https://github.com/gorhill/uBlock/blob/master/src/js/resources/safe-self.js)

## 独立审查记录

架构研究与独立设计审查分别由不同只读子代理完成。独立审查对后台阶段给出有条件通过：严格区分 UI/content、浏览器文档绑定、证明父链、未知归属保持错误、保留同文档幂等提示、报告不作权限依据。实施必须满足这些条件；通过本阶段不关闭 MAIN P1。

审查修正了一项初步建议：不能直接删除 payload 拉取的幂等提示，否则后台会重复安装已存在的 runtime。确认这一回归后，保留提示并缩小其含义和写入来源。现有请求 URL 优先测试需要改为 sender URL 优先；实际服务调用及参数断言保留。

## 验证与剩余门禁

实际实现经过独立的只读安全复核，未确认本阶段新增的可行动缺陷。复核检查了 UI/content 能力区分、父链及旧 documentId、归属错误与重试、账本调用点和 effectiveUrl 校验；该结论不覆盖原 MAIN 桥的认证问题。

新增 10 项边界测试在改生产代码前全部失败，改动后定向 46/46 通过。最初失败执行只有工具回执摘要，未保留完整原始日志；最终成功检查保留了原始日志。请求 URL 优先等旧断言已先列证据再替换，原服务调用及参数断言保留；本阶段没有删除测试用例。

| 检查 | 本阶段结果 |
| --- | --- |
| 完整测试及核心覆盖率门禁 | 563/563，通过，无失败、取消或跳过 |
| 核心分支覆盖率 | 指定 8 个文件合计 88.82%，各文件至少 85%；不包含新 message-policy.ts |
| 类型检查、完整 lint、build、diff whitespace 检查 | 通过 |
| Chrome 155.0.8059.86 frames | 19/19，含普通子域、about:blank、srcdoc 与 clear |
| Chrome 155 Workers | 14/14，含 CSP 回退报告和诊断显示 |
| Chrome 155 BFCache | 11/11，含配置未变、时区热更新及恢复后 clear |
| Chrome 155 baked/frozen clear | 21/21 |
| Chrome 119.0.6045.105 frames | 19/19，验证最低支持版本的真实文档元数据 |

主要原始日志位于 `/tmp/vanishgeo-p1-coverage.log`、`/tmp/vanishgeo-p1-build.log`、`/tmp/vanishgeo-p1-lint.log` 和 `/tmp/vanishgeo-p1-smoke-{frames,frames-119,workers,bfcache,baked-clear}.log`。这些是本地临时证据，不是 CI 或发布验收。浏览器检查均使用本任务隔离 profile。

进入本阶段的 30 项 dirty 基线已对照保存的差异和 SHA-256 检查：26 项逐字节不变；4 个重叠路径仅追加本阶段必要变更，原清理和回归断言保留。没有新增依赖、权限、最低版本变更或数据迁移，没有提交或推送。

仍未覆盖 blob/data/filesystem 的完整真实浏览器父链矩阵，以及 opaque 文档 BFCache 与跨导航竞争的完整组合；相关父链拒绝条件目前由单元替身验证。Chrome 119 本阶段只跑了 frames，不能据此宣称所有功能和引擎完成验收。

此前真实浏览器攻击复现被平台安全审查拒绝，本阶段不重试、不绕过。普通功能 smoke 与源码/单元边界验证不替代该攻击验收。原消息桥的认证缺口继续作为未解决的 P1，不得因为后台加固或功能检查通过而标记关闭。

## 普通 opaque 浏览器回归追加记录

用户随后要求补齐 blob/data/filesystem、跨导航和 BFCache 的普通回归。本轮没有构造攻击握手或伪造配置，没有更改权限、Chrome 最低版本或关闭浏览器安全限制。

发现并修复三条有失败证据的路径：

- Chrome155 的导航 API 省略 blob，导致自身及嵌套 data 的配置拉取被拒、推送漏发。按精确 documentId 在 ISOLATED 同步读取可访问的真实父窗口；空结果、身份不符、未知协议、跨源不可读继续拒绝。脚本枚举仅发现目标，不提供父关系授权。
- 真实 BFCache 恢复后，documentId 不变，但导航 API 可能只返回顶层。后台 services 统一持有成功验证过的父边缓存，供拉取与推送共用；仅记浏览器事实，不记配置或猜测的 blob 父边；新父边冲突拒绝。缓存限500项，内存失效后未知文档不借用旧身份。
- 可变烘焙包静态脚本缺少 `match_origin_as_fallback`，而这些域名不再动态注册，导致 blob/data 未注入。补齐 MAIN 与 ISOLATED 两项静态来源回退，保留 about:blank 匹配。构建断言先失败后通过，普通浏览器抽样也先失败后通过。

跨导航更新以 documentId 定向；未知归属仅触发重拉。总开关关闭适用于所有文档，广播明确的 globalDisabled clear，不依赖可能不完整的发现列表。内容桥立即清除并使旧拉取失效，避免关闭前的迟到响应重新应用旧配置。

独立审查否决了 DOM 索引路径拼接父树：多帧执行不是原子快照，框架移动或导航可能错接父关系。该方案没有进入生产代码。之后的定向探测、共享事实缓存与生命周期处理经过独立只读代码复核；原 MAIN 认证 P1 保持开放。

本轮完整测试584/584、无失败或跳过；类型检查、lint、构建通过。指定八个核心文件合计分支88.62%，每个至少85%，不包含新增 blob-frames.ts；新解析器的行为用例在完整测试中执行。新增21项测试，保留原用例与有效断言。

| 普通浏览器检查 | 结果及范围 |
| --- | --- |
| Chrome155 普通构建 opaque | 18/18，初始值、独立子域跨导航、热更新、真实 BFCache 两种恢复、同文档时区 clear |
| Chrome155 可变烘焙包 opaque | 18/18，相同普通功能范围；不证明所有 opaque 首个脚本同步值 |
| Chrome155 原 frames / BFCache | 19/19、11/11 |
| Chrome155 原 baked/frozen clear | 21/21 |
| Chrome119 opaque | 失败；浏览器拒绝精确读取 blob，自身和嵌套 data 保持原生；后续该组生命周期断言未执行 |
| filesystem 导航 | 两版浏览器在裸环境与带扩展环境均明确拒绝；文档内回归未执行，不算扩展覆盖通过 |

关键原始证据：`/tmp/vanishgeo-opaque-155-before.log`、`/tmp/vanishgeo-opaque-fixed-155.json`、`/tmp/vanishgeo-opaque-final-155.{log,json}`、`/tmp/vanishgeo-opaque-debug-119.{log,json}`、`/tmp/vanishgeo-opaque-baked-before.log`、`/tmp/vanishgeo-opaque-baked-after.{log,json}`、`/tmp/vanishgeo-opaque-final-coverage.log`。

尚未解决：Chrome119 blob 的程序化读取权限拒绝；跨源不可读 blob 祖先；后台重启或缓存淘汰后缺失父边的 data。后两类无证据时仍拒绝，普通重拉失败可能保留既有值，总关仍可广播清除。没有将这些限制隐藏为成功，也没有降低最低版本或改用自报 referrer/origin 绕过归属校验。

依据与边界：[Chrome155 的导航状态过滤实现](https://chromium.googlesource.com/chromium/src/+/804d6b05f089b27af8342622a36558c49401a1d4/chrome/browser/extensions/api/web_navigation/frame_navigation_state.cc)、[文档生命周期身份](https://developer.chrome.com/docs/extensions/reference/api/webNavigation#frame_ids)、[Chromium filesystem iframe 导航移除说明](https://groups.google.com/a/chromium.org/g/blink-dev/c/2V7lIYDkdtI/m/my-groups)。当前通过结果均为本地普通功能回归，不能替代消息桥安全或发布验收。


## Chrome119 blob 兼容修复追加记录

本节更新上一轮的 Chrome119 未通过结论。原 MAIN 消息桥 P1 仍未关闭；没有把构建 nonce 当作秘密，没有增加权限、提高最低版本、禁用 SOP 或重试此前被拒绝的攻击验证。

### 修复依据与独立设计审查

Chrome119.0.6045.105（revision `38c72552c5e15ba9b3117c0967a0fd105072d7c6`）支持注册脚本的 `matchOriginAsFallback`，但程序化 `executeScript` 使用另一条匹配/权限路径，不为 blob 采用同等回退。[119 注册参数处理](https://chromium.googlesource.com/chromium/src/+/38c72552c5e15ba9b3117c0967a0fd105072d7c6/chrome/browser/extensions/api/scripting/scripting_api.cc#488)、[119 程序化权限检查](https://chromium.googlesource.com/chromium/src/+/38c72552c5e15ba9b3117c0967a0fd105072d7c6/chrome/browser/extensions/api/scripting/scripting_api.cc#278)。上游在 Chrome133 才调整程序化默认行为，见 [官方变更说明](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/D8DcJARVM90) 与 [WebExtensions 议题673](https://github.com/w3c/webextensions/issues/673)。因此不能靠给 executeScript 追加注册参数、重试或扩大 host 权限修复。

独立架构审查有条件通过以下方案，再实施并接受另一名独立审查者的实际差异安全复核：保留程序化 ISOLATED 探测；仅当调用抛错时，按完整 `{tabId, frameId, documentId}` 向本扩展已合法运行的 ISOLATED 内容脚本发送 `readBlobParent`。成功但空结果、错误身份或 URL 变化直接拒绝，不进入另一条路径。端点同步读取真实原生父窗口；SOP、未知协议、无 HTTP(S) 父文档或自身已导航为非 blob 均失败。不接受 MAIN 或 payload 请求体提供的父地址，不为后台内容动作增加第四项能力。

`tabs.sendMessage` 的 documentId 从 Chrome106 起可用；119 双 ID 必须指向同一个活动 RenderFrameHost。仅 documentId 可能触及 BFCache 文档并驱逐它，因此不得降级为单 ID。[API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)、[119 双 ID 路由检查](https://chromium.googlesource.com/chromium/src/+/119.0.6045.105/chrome/browser/extensions/api/messaging/chrome_messaging_delegate.cc#111)、[119 活动 frame 查询](https://chromium.googlesource.com/chromium/src/+/119.0.6045.105/extensions/browser/extension_api_frame_id_map.cc#115)、[缓存文档的消息处理](https://chromium.googlesource.com/chromium/src/+/119.0.6045.105/extensions/browser/api/messaging/extension_message_port.cc#514)。查询响应没有独立 sender 元数据，身份依赖浏览器精确路由；父 URL 是已知 ISOLATED 代码的现场观测，不伪造成浏览器父 documentId。内容脚本仍低于后台信任级别，不能据此承诺抗 renderer 失陷。[消息安全要求](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#security-considerations)

### 实际修复与失败证据

- 后台新增精确内容端点查询，严格校验 blob 自身 URL、已知 sender URL 和 HTTP(S) 父地址。每次重新读取，不缓存父 URL 授权。新端点不依赖 MAIN 握手，不另开 frozen 更新通道。
- resolver 统一持有成功解析的 opaque 身份集合，供 services 补充发现。只保存 tab、顶层 documentId、frameId、documentId、自身 URL，总计最多500项。它不参与父边选择，不保存配置；当前导航记录优先，同 frame 不同文档不互相遮挡。顶层 ID 不同或缺失时不合并，避免在 B 活动时遍历 A 的冻结身份。
- 首轮真实119回归通过初始值、跨导航、热更新与两种 BFCache 恢复，但最后 clear 失败：blob 已恢复原生时区，root data 与 nested-data 仍为 Tokyo。原因是119恢复后脚本发现同样省略 data，仅记录 blob 仍不够。保留失败断言后，将成功整链中的 opaque 身份一起登记；该最小增量也经过独立设计复核。定向单元回归同样先失败（实际仅 top/blob）、修正后通过；没有删除测试掩盖问题。
- 普通浏览器工具通过隔离浏览器内的同步 runtime 旁观监听记录 Chrome 提供的 sender 身份，不响应、不构造消息、结束移除。该记录只补身份观察，不能替代运行值或父关系证明。119 的原生 blob 程序化拒绝仍写入 JSON，兼容路径没有取消浏览器拒绝。

### 验证结果与限制

| 检查 | 最新结果 |
| --- | --- |
| 全量测试与核心覆盖率门禁 | 606/606，失败/取消/跳过均0；指定八个文件合计分支88.80%，每个至少85% |
| 类型检查、lint、构建与 diff whitespace | 通过；content 与 MAIN 经典产物均无顶层 import/export |
| Chrome119 普通 opaque | 18/18，含 blob/data/nested-data、独立子域跨导航、热更新、真实 BFCache 两种恢复、同文档时区 clear |
| Chrome155 普通 opaque 回归 | 18/18，同上 |
| Chrome119 可变烘焙 opaque | 18/18，同上；不证明所有首个脚本同步值 |
| Chrome119 原 bridge/frozen clear | 21/21，保留排除站点、总关、恢复与刷新合同；不覆盖 frozen opaque 首个脚本值 |
| filesystem iframe 导航 | 两版原生与带扩展浏览器均明确拒绝，文档内回归不计通过 |

本轮新增22项测试，原用例保留。旧 `resolveBlobParentUrl` 的内部返回改为 `resolveBlobParent` 结构以保留探测自身 URL；实际调用点和单测同步调整，没有遗留包装或双实现。旧“抛错原样透传”的断言改为同时保留程序化与端点失败原因，因为现在有已审查的兼容路径；失败与零副作用断言仍保留。指定八文件的覆盖率不包含 `blob-frames.ts`，不能把88.80%称作新解析器的覆盖率。

原始证据：`/tmp/vanishgeo-119-opaque-after.{log,json}`（初版真实 clear 失败）、`/tmp/vanishgeo-119-bfcache-{before,after}.log`（单测先失败后通过）、`/tmp/vanishgeo-119-opaque-final.{log,json}`、`/tmp/vanishgeo-119-regression-155.{log,json}`、`/tmp/vanishgeo-119-baked-opaque.{log,json}`、`/tmp/vanishgeo-119-baked-clear.log`、`/tmp/vanishgeo-119-final-{coverage,build,lint}.log`。新增边界测试独立执行49/49，保留与差异证据位于 `/tmp/vanishgeo-chrome119-boundaries.Dd6Mlu/`。这些是本地普通回归，不是安全攻击验收、完整兼容矩阵或发布验收。

剩余边界：跨源不可读或 sandbox 禁止读取父 Location 仍拒绝；SW 重启或500项淘汰后，发现身份及父边证据可能缺失，未覆盖的恢复/更新仍可能漏发或因未知链拒绝，不能推断顶层规则。普通重拉失败可能保留旧值，总关 clear 合同保留。此限制没有通过永久缓存父 URL、消息自报 origin/referrer 或浏览器启动参数规避。原 MAIN 桥认证 P1 保持未关闭。


## SW 重启与内存淘汰恢复追加记录

本节更新上一轮的 SW 重启/500项缓存淘汰限制。原 MAIN 消息桥认证 P1 仍未关闭；未增加权限、提高最低版本、放宽 session 对内容脚本的访问、增加保活或禁用浏览器限制。

### 研究、独立设计与安全复核

Chrome119/155 的 `webNavigation.getFrame(documentId)` 与 `getAllFrames` 共用 `FrameNavigationState` 门槛。切换旧主文档时，Chromium 删除其子树导航状态；恢复提交未必为子文档重建。因此精确 documentId 仍可能查不到 data 父边，不能把补调 getFrame 当作可靠恢复。[119 实现](https://chromium.googlesource.com/chromium/src/+/38c72552c5e15ba9b3117c0967a0fd105072d7c6/chrome/browser/extensions/api/web_navigation/web_navigation_api.cc#432)、[155 状态清理](https://chromium.googlesource.com/chromium/src/+/804d6b05f089b27af8342622a36558c49401a1d4/chrome/browser/extensions/api/web_navigation/web_navigation_tab_observer.cc#310)。这个 getFrame 结论来自精确版本源码，不能称为本轮逐文档 getFrame 浏览器实测。

已比较机会性 webRequest 取证、内容脚本保留关系、重新查询导航状态和 session 保存事实。webRequest 需要新增权限及请求事件，不能保证静默文档恢复；内容保留方案会扩大证明回传协议。独立设计审查选择复用现有 resolver，在后台默认私有的 `storage.session` 保存已证明的浏览器文档事实，并以一次无配置重拉提示补发现。session 是 Chrome 推荐的 SW 状态保存方式，重启 SW 不清空；扩展禁用/重载/更新或浏览器重启会清空。[SW 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#persist-data)、[session 合同](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas)

实际代码经另一名独立审查者复核，未确认本轮新增的可行动安全缺陷。复核包括身份/父边冲突、反序列化、部分失败、关闭与在途写交错、提示范围及 frozen 入口；不关闭原 MAIN P1，也不构成攻击或发布验收。

### 实际实现与保留的失败证据

- resolver 是唯一父边证据所有者。按 `vanishgeo.frame-evidence.v1:<tabId>:<documentId>` 独立键保存成功整链中的浏览器 Frame 字段；data 只存 `data:` 标记。只读精确键，验证身份、字段与协议，当前导航身份或父边冲突时拒绝。500项内存缓存淘汰不删除 session 事实。
- 只持久浏览器实际提供的 HTTP 文档 URL，不把 blob 现场探测返回的 parentUrl 合成 Frame 或永久有效 URL，不保存配置/payload。当前规则只匹配 hostname；同文档 history 路径变化不改变规则结果。若未来引入路径匹配，必须重新评审这项终点语义。
- `session.set` 成功后才发布新 verified/known 状态。存储读写/配额失败保持错误，不伪装成未命中或成功；失败的链也不发布部分证据。同 tab 写队列和关闭标记保证 `tabs.onRemoved` 等在途写结束后只删除该 tab 的自有键，不让已关闭文档回填；顶层导航保留可能属于 BFCache 的旧树。
- services 保留精准推送，再广播一次 `{action:'refreshPayload',opaqueOnly:true}`，不携带配置、父关系或有效 URL。仅支持的 opaque 文档按浏览器 sender 身份自拉，HTTP/未知协议忽略；旧普通 refresh 和全局 clear 仍有效。无桥/frozen 入口继续提前返回。
- 两版本广播从当前主文档树开始，不主动枚举历史 BFCache 树。[119 实现](https://chromium.googlesource.com/chromium/src/+/119.0.6045.105/chrome/browser/extensions/api/messaging/chrome_messaging_delegate.cc#118)、[155 实现](https://chromium.googlesource.com/chromium/src/+/804d6b05f089b27af8342622a36558c49401a1d4/extensions/browser/api/messaging/message_service.cc#905)。在途投递恰遇导航仍有原生竞态，不能宣称任意并发导航都不会影响 BFCache。

修复前真实隔离浏览器明确停止旧 SW，确认旧 target 消失，再由普通管理消息唤醒不同 target。随后119三类 opaque 均停留 Tokyo，155的 blob 已更新但两个 data 仍旧值。另一次119普通页面顺序创建505个 data 文档，每个都观察到配置实际生效，再改时区时三类原文档仍旧值。失败断言保留。首次快速导航在第200个附近未继续生效；工具改为每次至少70ms并完成505次，不添加禁用导航保护的开关。这个中间工具失败不算缓存淘汰复现，淘汰失败以完成505次后的记录为准。

### 当前验证与仍有的边界

| 检查 | 结果 |
| --- | --- |
| Chrome119.0.6045.105 普通完整恢复回归 | 26/26 |
| Chrome155.0.8059.86 普通完整恢复回归 | 26/26 |
| Chrome119 可变烘焙完整恢复回归 | 26/26 |
| Chrome119 原 bridge/frozen 清除合同 | 21/21 |
| 全量测试、核心覆盖率门禁 | 624/624；指定八文件分支88.87%，每个至少85%，不包含blob-frames.ts |
| 定向 resolver/router | 64/64，含读写/quota、损坏证据、身份/父边冲突、500淘汰、并发提交与关闭交错 |
| content/services 与既有注入合同 | 99/99 |
| preflight/audit/docs 工具检查 | 39/39 |
| 类型检查、构建、完整lint、经典产物、diff whitespace | 通过；完整lint以主代理退出码为准，不以空日志推断 |

本轮新增18项测试（15个恢复边界、2个content/services、1个preflight依赖），保留原用例和有效失败断言。旧“冷实例无证据拒绝”先补共享session可恢复正例，再显式清空session保留拒绝负例；不能把旧内存生命周期假设继续当授权合同。新命令 `npm run smoke:opaque-recovery` 与原工具共用逻辑，并接入 preflight、CI、audit 的 `opaquerecovery` 组。

原始证据：`/tmp/vanishgeo-session-before-{119,155}.{log,json}`（真实重启失败）、`/tmp/vanishgeo-eviction-before-paced-119.{log,json}`（505文档后的实际淘汰失败）、`/tmp/vanishgeo-session-after-{119,155}.{log,json}`（完整通过）、`/tmp/vanishgeo-session-baked-119.{log,json}`、`/tmp/vanishgeo-session-baked-clear-119.log`、`/tmp/vanishgeo-session-unit-tests.log`、`/tmp/vanishgeo-session-content-injection.log`、`/tmp/vanishgeo-session-runner.log`、`/tmp/vanishgeo-session-final-{coverage,lint}.log`、`/tmp/vanishgeo-session-build-first.log`。

仍然拒绝：从未取得浏览器父边证据的静默 data、session 被扩展重载等清空后的缺失链、损坏记录、跨源不可读 blob 祖先。10MB session 配额由整个扩展共享，记录按文档累积、仅关闭标签页清理，长期不关标签页仍可能用尽；本轮证明明确拒绝行为，不保证无限历史恢复。普通失败重拉可能保留旧值，全局关闭仍可clear。filesystem 导航仍由浏览器拒绝、文档内行为不计覆盖；frozen opaque 首脚本值未覆盖。原消息桥 P1 继续未关闭。


## 文档自持凭证与父边 session 配额治理

本节更新上一轮的长期标签页父边累积限制。原 MAIN 消息桥 P1 继续未关闭；这里认证的是后台曾证明的文档父链，不是 MAIN 握手或页面补丁。后台会话随机密钥与公开构建 nonce 完全分离。

### 回收研究与删除旧实现的证据

实际119/155版本无法可靠枚举全部活动、BFCache和静默驱逐文档。`getAllFrames`排除缓存页，`getFrame`空混合了不存在与导航状态缺失；扩展没有覆盖所有已完成文档销毁的事件。`pagehide(false)`只能回收子集，后续BFCache驱逐不会补发可靠通知；TTL、LRU、无响应均不能证明死亡。不能用这些信号删除恢复所需的证据。[官方Instant Navigation合同](https://developer.chrome.com/blog/extension-instantnav#how-do-i-determine-if-a-frame-is-the-outermost-frame)、[BFCache生命周期](https://web.dev/articles/bfcache#observe-when-a-page-is-entering-bfcache)

独立研究使用实际revision119 `38c72552c5e15ba9b3117c0967a0fd105072d7c6` 与155 `804d6b05f089b27af8342622a36558c49401a1d4`。原生释放路径为 Dispatcher::WillReleaseScriptContext → ScriptContextSet::Remove → Invalidate/DeleteSoon，支持文档私有状态交由浏览器释放，不意味着销毁瞬间全部堆内存同步清零。[119释放实现](https://chromium.googlesource.com/chromium/src/+/38c72552c5e15ba9b3117c0967a0fd105072d7c6/extensions/renderer/dispatcher.cc#642)、[155释放实现](https://chromium.googlesource.com/chromium/src/+/804d6b05f089b27af8342622a36558c49401a1d4/extensions/renderer/dispatcher.cc#672)

旧逐文档session增长点、仅关tab删除的限制已在前轮定位；本轮真实10MB压力又证明它会阻止新data生效。独立架构审查准入文档自持HMAC凭证，并在实施前补审精确store+ACK交接。原逐文档session读写、按tab写队列和前缀扫描不再承担保存/恢复职责，因此由新机制替换；内存tab清理及关闭检查保留。没有按未知存活状态删除运行中证据。

新版本必须正常reload/update激活；Chrome会清空session，项目此前也未承诺扩展重载后的缺失链恢复。因此无须保留旧前缀双读、迁移扫描或对冻结旧文档强行交接。不能仅覆盖磁盘bundle、保留旧SW运行就宣称升级完成。[Chrome session生命周期](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas)

### 已审查的实现边界

- 父链owner仍为resolver。后台使用原生WebCrypto HMAC-SHA256，唯一会话随机256-bit key默认只在可信后台session可读；不调用setAccessLevel，不采用构建常量作密钥，不引入密码学依赖。[WebCrypto HMAC规范](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#hmac)
- 凭证覆盖purpose/version、tab/frame/document、完整成功浏览器父链及missing-blob精确边界。data只存marker；HTTP Frame保留原完整URL以保持现有effectiveUrl合同。HMAC不提供保密，凭证不记录payload/配置，也不进MAIN、MessagePort或日志。
- 每份凭证自足，不引用祖先凭证；祖先私有状态释放不会截断孩子证明。缺失节点边界不能把blob现场parentUrl合成HTTP Frame，blob始终按精确双ID现场重读。当前快照优先，身份或逐边父关系冲突拒绝。
- 验证只读会话key，缺失/畸形/MAC错误不生成或轮换。首次签发才允许生成随机key，await持久成功后签名；单SW单services初始化Promise复用。失败可由既有拉取重试，不发布部分事实。
- 签发后先以精确双ID `storeFrameEvidence` 同步存入所属文档私有闭包并ACK；ACK明确成功且tab未关闭才发布verified/known与返回成功。ACK丢失可保守报错，不能回滚其他文档依赖的key。可信正常响应先保管凭证再用seq丢弃旧payload，迟到回复不能抵消clear。
- 后台只保留现有两个500项有界内存集合和一个会话key。恢复只查询当前解析需要的精确文档，不扫历史BFCache树，不把查询失败当死亡。文档实际释放后的回收由浏览器负责，无heartbeat/TTL/保活。无桥/frozen入口和opaqueOnly无配置提示保留。

实际差异由独立安全审查者复核，未确认新增可行动缺陷；MAC/身份、密钥并发与失败、交付ACK、关闭交错、链终点、隐私与正常激活前提均被复核。该结论不关闭原MAIN P1，不是攻击或发布验收。

### 本轮验证与保留成果

修复前 `/tmp/vanishgeo-gc-before-119.{log,json}` 记录真实共享session配额拒绝后，新 `quota-data` 仍显示原生语言/时区。该失败断言保留。新回归在隔离profile正常加载当前bundle，未改配额、权限或浏览器保护开关，只填充本任务测试key并在finally删除它。

| 检查 | 最新结果 |
| --- | --- |
| Chrome119.0.6045.105 普通完整回归 | 33/33 |
| Chrome155.0.8059.86 普通完整回归 | 33/33 |
| Chrome119 可变烘焙完整回归 | 33/33 |
| Chrome119 原bridge/frozen清除合同 | 21/21 |
| 505普通data文档前后父边持久状态 | 两版均1个key、1056字节，键数和用量不增长 |
| 真实10MB压力 | 两版session达10485744字节并触发浏览器拒绝；新data生效、满额时真实SW重启、热更新、BFCache与同文档clear通过 |
| 完整单元与核心覆盖率门禁 | 651/651，失败/取消/跳过0；指定八文件分支88.97%，每个至少85% |
| 类型检查、lint、构建、经典产物、diff whitespace | 通过 |

统计的八文件不包含 `blob-frames.ts` 或新增 `frame-receipts.ts`，不能把88.97%当成新协议覆盖率。新codec以独立node:createHmac交叉验证，并覆盖错误MAC/跨身份重放、合法MAC下的schema/环/断链、缺坏key、初始化并发/失败重试和边界类型。没有在真实浏览器中构造攻击握手或重试先前被拒绝的攻击复现。

本轮新增27项测试：codec13、resolver6、router5、content3。原resolver29例与router35例的对应行为保留；旧逐文档session计数/前缀删除断言迁移为唯一key、精确凭证投递、ACK前不发布及关tab不删共享key。原Chrome119/SOP/逐次blob探测、冷实例恢复与无证据拒绝、并发关闭、错误零业务副作用继续验证，没有删除测试用例。

原始证据：`/tmp/vanishgeo-gc-final-{119,155}.{log,json}`、`/tmp/vanishgeo-gc-baked-119.{log,json}`、`/tmp/vanishgeo-receipt-baked-clear-119.log`、`/tmp/vanishgeo-receipt-{coverage,typecheck,lint}.log`、`/tmp/vanishgeo-receipt-final-build.log`、`/tmp/vanishgeo-receipt-content-injection.log`、`/tmp/vanishgeo-receipt-router-tests.log`。原32项中间通过记录另留 `/tmp/vanishgeo-gc-after-{119,155}.{log,json}`；最终33项额外验证满额时真实重启SW。

剩余边界：首次建key即被其他组件挤满时仍明确失败，不能擅删其他key；扩展reload/update/禁用或浏览器重启清空key后的旧凭证不再有效。没有取得并ACK凭证、浏览器又失去父边的文档仍可能无法恢复；ACK前冻结/导航的操作不报告成功，未强制浏览器命中这个精确交错，延迟ACK与关闭测试已覆盖保守失败。正常活动/BFCache持证文档不按年龄或未枚举到而被扩展回收。filesystem文档内行为及frozen opaque首脚本值仍未覆盖，原MAIN P1仍开放。

## 遗留代码清理与 Chrome 119/155 回归复核（2026-10-30）

本节补录四组已获用户批准的清理、实际差异的独立只读审查，以及清理后追加的普通浏览器回归。原 MAIN 消息桥 P1 保持未关闭；没有把公开构建常量当作秘密，没有增加权限、修改最低版本、放宽浏览器限制或重试此前被拒绝的攻击复现。前文 651/651 是清理前阶段记录；移除四个仅验证孤立代码的独立用例后，清理阶段的完整测试为 647/647。

### 删除依据与保留的测试合同

删除前对仓库源码、测试和工具进行了符号引用检索，结合实际入口核对调用链；删除后的维护代码再次检索无残留引用。判断针对当前仓库的运行路径，不把“仅被测试调用”一概等同于可删除。

| 清理组 | 删除前证据 | 实际清理与保留范围 |
| --- | --- | --- |
| `config-model.ts` 的 `LANGUAGE_PRESETS`、`TIMEZONE_PRESETS` | 仅有声明，无业务、工具或测试调用；当前设置页使用 `DEFAULT_PROFILES` 与表单字段 | 删除两份旧数据，保留正在使用的默认 profile |
| `diagnostic.ts` 的 `buildRequestHeaderProbe`、`buildFrameProbeSnapshot`、`buildGeolocationBehaviorSnapshot` | 调用只在 `diagnostic.test.ts`，未接入当前诊断页或工具；五个私有 helper 和 `REQUEST_HEADER_PROBE_SOURCES` 仅服务于被删链路 | 删除三个导出及其孤立辅助代码；保留诊断页实际调用的 `buildWorkerDiagnosticsSnapshot` 与覆盖声明 |
| `config-resolver.ts` 的 `isUrlMatchedByEnabledRule` | 无业务调用，只有两份测试引用；实际行为由 `resolveRuleMatch`、`getEffectiveProfile` 和内容脚本注册逻辑承担 | 删除旧包装函数，保留实际匹配、排除与注册行为 |
| `config-model.ts` 的 `formatTimezoneOffsetMinutes` | 无业务调用，只有 `config.test.ts` 两条断言；当前 UI 不通过它显示偏移 | 删除函数及其专属断言，保留时区校验和偏移计算 |

代码与测试共 8 文件，新增 17 行、删除 255 行，统计不含本节文档。TypeScript AST 核对确认：三个生产文件仅移除批准的 13 个顶层声明，所有保留的语句逐字一致。`defaults.ts`、`storage.ts` 在清理前基线中已删除，本阶段没有重复计入。

删除的独立用例恰为四个：两个旧请求头解析用例、一个 frame 快照用例，以及旧 URL 包装函数用例。三个混合用例仅移除对应遗留函数的断言，仍保留时区校验/偏移失败、注册范围/排除、Worker 缺失条目的 `not_attempted` 等有效行为。其他规则排除、DNR、Worker 的 unsupported/degraded、安全路由与凭证测试没有删除。

另外两处按已确认范围修正，没有整项删除：

- `content-bridge.test.ts` 分别保留“接收端关闭”和“发送端同步异常”。前者核对不抛错、投递数量不增加及原 payload；后者通过 `attempts === 1` 证明实际触发发送异常，并在 `finally` 恢复原型方法。Node 关闭对端本身不使发送同步抛错，不能继续把前者命名为异常分支测试。
- `extension-wiring.test.ts` 限定为旧后台地址提示与 MAIN 经典脚本自包含检查，保留 referrer 兼容提示和打包约束，不宣称 referrer 可授权后台。忽略自报 URL、按浏览器身份授权及失败后零业务副作用仍由路由行为测试保护。

旧后台地址提示、没有 `hostname` 的旧 payload、IP 同步单飞的测试隔离/观察接口均保留。兼容桥、消息授权、父链凭证、注入 runtime、路由/父链凭证安全测试和既有清理成果未被此次整理改写。

### 独立审查与最终差异复核

独立只读审查由 `/root/cleanup_contract_review`（`critical_reviewer`）完成，以清理前快照到实际候选的八文件差异为对象，不用包含前轮成果的 HEAD 总差异替代本轮范围。审查重建删除前引用，核对保留断言、端口的两个不同场景、referrer 测试范围及未改变的后台信任边界，未发现本轮新增的可行动缺陷。

审查者另行核对 205 个基线路径：只有约定的 8 文件变化，其余 197 个路径的内容与存在状态一致，并查阅主代理执行的定向、lint、构建与核心覆盖率日志；审查者没有自行运行浏览器攻击验证，也没有重新审计未改变的凭证协议。该结论仅覆盖清理差异及其直接影响，不能关闭原 MAIN P1。

本次文档补录前再次重建八文件差异，与保存的 `cleanup-only.patch` 逐字一致；重新核对删除证据与维护代码引用。浏览器补跑前后 205 个仓库路径均保持不变，普通构建的 46 文件指纹在测试期间一致。此次仅追加本节，其他 204 个路径与补跑基线一致，既有历史段落保留；不暂存、不提交、不推送。

### 清理后的验证结果

| 检查 | 已执行结果 |
| --- | --- |
| config、rule-exclusion、diagnostic、content-bridge 定向测试 | 72/72，失败/取消/跳过均为 0 |
| `npm run lint` | 退出码 0，以进程最终退出结果为准 |
| `npm run build`（含 typecheck） | 清理阶段与浏览器补跑前均成功 |
| `npm run test:coverage:core` | 647/647，失败/取消/跳过均为 0；指定八文件整体分支 89.05%，每文件至少 85% |
| 差异空白、删除引用、快照与保留语句复核 | 通过 |
| 本次文档补录的 `tests/docs-consistency.test.ts` | 10/10，失败/取消/跳过均为 0 |

八文件覆盖率仍不包含 `blob-frames.ts`、`frame-receipts.ts` 或 `diagnostic.ts`。删除代码改变了覆盖率分母，89.05% 不能解释为新增安全验证或整个凭证协议的覆盖率。本次文档补录复用了输入未变的代码检查结果，没有重跑完整单元或浏览器套件。

补跑使用实际 Chrome 119.0.6045.105 与 155.0.8059.86、临时隔离 profile 和当前构建。119 正常通过 `--load-extension` 激活，155 使用已有 CDP 装载能力；没有混合旧 SW 与新磁盘脚本，也没有禁用 SOP、导航保护或提高配额。

| 普通功能回归 | Chrome 119 | Chrome 155 |
| --- | --- | --- |
| 普通构建 `smoke:opaque-recovery`：跨导航、热更新、SW 重启、淘汰与配额恢复 | 33/33 | 33/33 |
| 普通构建 `smoke:frames`：父子框架规则、排除与恢复原生 | 19/19 | 19/19 |
| 普通构建 `smoke:bfcache`：真实恢复、配置变更及页面/请求头对齐 | 11/11 | 11/11 |
| 临时 bridge/frozen 包 `smoke:baked-clear`：排除、总关、刷新后的约定 | 21/21 | 21/21 |
| 合计 | 84/84 | 84/84 |

八次脚本运行最终退出码均为 0，共 168/168。关键证据为：

- 两版均确认旧 SW target 消失，再由普通管理消息唤醒不同的新实例；普通 session 状态及真实满额状态下均重新完成热更新、BFCache 恢复和同文档 clear。
- 两版均完成 505 个普通 data 文档实际生效后才继续；父边模块导航前后均为 1 个 session key、1056 字节。这是模块统计，不代表整个扩展只有一个 session key。
- 两版共享 session 达到 10485744 字节并发生浏览器真实配额拒绝后，新 data 仍继承父规则；满额下 SW 重启、更新、BFCache 与 clear 通过，测试填充 key 在 `finally` 删除。
- opaque 恢复检查真实 `pageshow.persisted`、页面 token 与文档身份。普通页面冻结期间改语言后的 `persisted=false` 只作观察，不计为缓存命中证明；改时区不重载、改语言后新文档及 Accept-Language 对齐由各自断言验证。
- bridge 的排除/总关/刷新恢复原生，frozen 保留烘焙页面与请求头值；这些通过项保护原约定，不改变兼容模型。

补跑未发现新的运行时 Bug，未修改实现或删除失败断言。临时浏览器、profile 和 bridge/frozen 测试包已清理；没有遗留本任务浏览器进程或 `persona.config.json`，原始证据及构建指纹保留。

### 证据定位与剩余边界

清理证据目录：`/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/vanishgeo-cleanup-baseline-5_90j45q`。

- `cleanup-only.patch`、八个原文件快照、`deletion-evidence.txt`：删除前引用与实际差异。
- `structure-verification.txt`、`preservation-final.json`、`verification-summary.json`：保留语句、路径基线、审查结论和执行结果。
- 清理阶段原始日志为 `/tmp/vanishgeo-cleanup-{targeted,lint,build,coverage}.log`。
- 本次文档相关检查日志为 `/tmp/vanishgeo-cleanup-closeout-docs.log`。

浏览器证据目录：`/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/vanishgeo-cleanup-browser-taqw4cqa`。

- `opaque-recovery-{119,155}.{log,json}`、`frames-{119,155}.log`、`bfcache-{119,155}.log`、`baked-clear-{119,155}.log`：八次运行的原始结果。
- `opaque-evidence-summary.json`、`verification-summary.json`：浏览器实际版本、SW 更换、配额、父边占用、通过数与退出码。
- `tested-dist-hashes.json`、`baked-dist-hashes.json`：普通构建与两种临时包的文件指纹；临时包本体已删除。

复核时 `cleanup-only.patch` 的 SHA-256 为 `af62828fc407161946e8be28e1cc717c128e84a71ab4e8f8bee5ed5dfebe904a`，浏览器 `verification-summary.json` 为 `5fcb01665c2a0fe9f0b8866fbb2b43563a816b433382a1c89ee6f586a761f5d4`。这些原始文件位于本地临时目录，尚未归档为持久发布制品；本节已摘录核心结论，原始细节复查仍依赖这些文件。

剩余问题和验收边界保持明确：

1. 原 MAIN 消息桥仍不能认证页面提供的握手端口或端口载荷，公开构建 nonce 不是秘密；P1 继续未关闭。此前被平台安全审查拒绝的真实攻击复现没有重试，本次普通功能检查与独立代码复核不替代该验收。
2. Chrome119 的程序化 blob 注入仍被浏览器拒绝，现有合法注入内容脚本的精确双 ID 查询兼容路径通过。跨源不可读或 sandbox 不允许读取父 Location 的链仍拒绝，不能回退顶层规则或自报 referrer。
3. 两版无扩展/有扩展环境均明确拒绝 filesystem 导航；拒绝对照是通过项，但 filesystem 文档内更新、导航与 BFCache 行为未覆盖。frozen opaque 首脚本值仍未覆盖。
4. 首次建立会话 key 就遇到其他数据占满配额时仍明确失败；扩展 reload/update/禁用或浏览器重启清空 key 后，旧凭证无效。未持有已 ACK 凭证且浏览器父边已缺失的文档仍可能无法恢复；普通重拉失败可能保留旧值，总关 clear 合同保留。
5. ACK 前精确冻结/导航交错未强制在真实浏览器命中；延迟 ACK、关闭与保守失败由已有测试保护。505 次导航和真实配额压力是所测场景，不能证明无限历史、所有并发交错或所有资源压力下均可恢复。
6. 本次仅为两个精确版本、隔离 profile 的普通功能回归。临时 bridge/frozen 包只重跑清除合同；前文 Chrome119 可变烘焙包完整 opaque 33/33 是此前阶段结果，不计入本次 168 项。未验证真实日常 profile、跨版本升级、全部 Chrome119 API 合同或发布验收。
