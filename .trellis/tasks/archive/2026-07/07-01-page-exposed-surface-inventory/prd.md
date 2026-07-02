# 页面可暴露面梳理

## Goal

基于当前仓库真实实现和既有产品边界，梳理“页面脚本可观察、且本扩展理论上可改写或影响”的暴露面清单，区分已覆盖、未覆盖、可扩展但高风险、以及明确不纳入当前产品边界的类别，为后续实现任务提供有证据的候选范围和优先级。

## Confirmed Facts

- 项目当前公开定位是：在白名单网站上对齐语言、时区、IP 定位和 WebRTC 行为，减少浏览器指纹检测中的不一致。证据：`README.md:7-15`。
- 当前页面侧 live 诊断只读取 `navigator.language`、`navigator.languages`、`Intl.DateTimeFormat().resolvedOptions().timeZone`、`Date#getTimezoneOffset()`、`Date#toString()`、`navigator.geolocation` 与若干 `Intl` 诊断结果。证据：`shared/diagnostic.js:220-236`。
- 当前页面侧 spoof 已直接改写 `navigator.language`、`navigator.languages`、`navigator.geolocation.getCurrentPosition/watchPosition`，并安装 timezone / locale patch 与 worker hook。证据：`spoof/apply.js:3-61`、`spoof/date-time.js:1-40`。
- 当前仓库已经把 `Accept-Language` 纳入站点实际可见的一致性面，通过 DNR 动态规则按域名改写请求头。证据：`background/services.js:247-280`。
- 当前仓库已经尝试处理跨执行上下文一致性，但 worker hook 只覆盖 `Worker` / `SharedWorker`，还不能据此认定 iframe、nested worker、service worker 等上下文已经系统性覆盖。证据：`spoof/worker-hooks.js:7-45`。
- 白名单内容脚本当前以 `document_start + allFrames + MAIN world` 方式注册，说明普通 `iframe` 至少有统一注入基础，但 `about:blank/srcdoc`、跨源嵌套上下文、service worker 等边界仍需单独核对。证据：`background/services.js:128-145`。
- 你已确认首轮主清单只围绕地区/语言/时区/定位/请求头/worker/iframe/上下文一致性；`screen.*`、`navigator.platform`、`deviceMemory`、`hardwareConcurrency`、`plugins/mimeTypes`、`userAgentData`、`canvas/audio/fonts` 等 `device/browser` 项不进入主清单，只放到“建议继续排除/后置观察”。
- 你已进一步说明：当前使用的是正常真实浏览器，只是通过代理访问国外网站，因此默认前提不是“伪造设备/浏览器环境”，而是尽量避免与代理出口地区相关的页面可见不一致。
- 你已确认第一版主清单不纳入 CSS / media query 可见环境项，例如 `prefers-color-scheme`、`prefers-reduced-motion`、`forced-colors`、viewport / DPR / `screen` 派生布局结果。
- 你已确认第一版主清单纳入 `WebRTC`，原因是它属于重要泄露面；从你的产品判断看，如果目标站点不依赖 WebRTC，减少泄露优先级高于保留其能力。
- 你已补充当前真实使用方式：WebRTC 防泄漏主要由外部扩展 `a8763506128977812212307169331690/WebRTC-Leak-Prevent` 负责，而不是完全依赖本仓库内建能力。
- 你已确认后续候选方向选择“替代外部扩展，改由本项目统一接管 WebRTC 策略”，因此 WebRTC 不再只被视为外部依赖边界，还要被视为本项目可能回收控制权的能力面。
- 你已进一步确认：如果本项目统一接管 `WebRTC`，第一优先方向是“浏览器全局策略接管”，而不是先做白名单页面内 API 级禁用。
- 你已明确允许后续 WebRTC 防泄漏实现参考外部扩展 `a8763506128977812212307169331690/WebRTC-Leak-Prevent` 的做法。
- 你已确认后续 WebRTC 继续保留“策略型”模型，并把语义明确为：
  - `strict = disable_non_proxied_udp`
  - `compatible = default_public_interface_only`
  - `default = 恢复浏览器默认`
  - 真正的 `disabled` 以后如有需要再单独增加。
- 已有 planning 明确记录：当前页面级 spoof 与诊断主链路聚焦在 `language`、`timezone`、`geolocation`、`WebRTC` 四类信号。证据：`.trellis/tasks/07-01-project-optimization-planning/prd.md:15-17`。
- 已有 planning 也明确把 `navigator.userAgentData`、`screen`、`deviceMemory`、`hardwareConcurrency`、`navigator.platform`、`plugins` 等更深的指纹面排除在第一阶段之外。证据：`.trellis/tasks/07-01-project-optimization-planning/prd.md:17-18`、`.trellis/tasks/07-01-phase1-behavior-smoke/prd.md:9-10`、`.trellis/tasks/07-01-phase1-behavior-smoke/prd.md:45`。
- 当前仓库搜索没有发现对 `screen`、`deviceMemory`、`hardwareConcurrency`、`navigator.platform`、`plugins`、`mimeTypes`、`canvas`、`audio`、`fonts`、`permissions`、`mediaDevices` 等新暴露面的正式实现或诊断展示。
- 当前 WebRTC 配置只有三档：`strict -> disable_non_proxied_udp`、`compatible -> default_public_interface_only`、`off -> null`；其中 `off` 表示清掉浏览器策略并回到默认行为，不等于“禁用 WebRTC”。证据：`background/services.js:38-42`、`shared/config-base.js:29-31`。
- 当前仓库和既有 planning 都把 WebRTC 建模为浏览器全局策略，而不是按站点单独控制：配置字段只有 `webRtc.globalMode`，message 路径也只更新这一全局值，既有 PRD 还明确写明 “WebRTC remains browser-global”。证据：`shared/config-base.js:29-31`、`background/message-router.js:23-40`、`.trellis/tasks/07-01-custom-site-configuration-refactor/prd.md:48`。
- 你当前使用的外部扩展公开说明显示：它用于控制 Chromium 的 WebRTC 隐私设置，默认设为 `default_public_interface_only`，并使用 `privacy` 权限与后台脚本控制该策略。证据：GitHub README、`manifest.json`、`js/background.js`。
- 该外部扩展的公开文档还明确区分了几种典型使用场景：系统级 VPN 默认用 `default_public_interface_only`，而浏览器代理 / 代理扩展场景推荐 `disable_non_proxied_udp`。证据：`DOCUMENTATION.md`。
- 因为外部扩展与本仓库都作用在同一条 `chrome.privacy.network.webRTCIPHandlingPolicy` 策略上，而你已决定后续由本项目统一接管，所以第一版 inventory 需要把 WebRTC 记成“重要面 + 当前存在外部依赖迁移背景 + 后续回收为内建全局策略能力”的特殊项，而不是简单等同于其他页面侧 spoof 面。

## Requirements

- R1: 输出必须只基于仓库当前代码、现有任务文档和已确认产品边界，不做“浏览器理论上也许可以改”的空泛罗列。
- R2: 必须把暴露面至少分成四类：
  - 已有覆盖且已有诊断链路。
  - 已有部分覆盖但诊断不足。
  - 理论上可扩展、但当前仓库完全未覆盖。
  - 明确不建议纳入当前产品边界。
- R3: 每个候选暴露面必须记录最小必要信息：读取入口、当前仓库是否已覆盖、若扩展的大致实现入口、主要一致性风险、以及是否更像“页面脚本面”还是“更深设备/浏览器面”。
- R4: 结论必须帮助后续排优先级，而不是只做百科式清单；至少要给出“建议优先补”“可后置观察”“建议继续排除”三档。
- R5: 这次任务默认停留在梳理和范围收敛，不直接进入实现。
- R6: 若某一暴露面虽然页面可读，但本质上依赖浏览器底层网络栈、TLS、内核、GPU、字体或宿主系统稳定特征，必须单独标记高风险，不得与现有 `language/timezone/geolocation/WebRTC` 同等对待。
- R7: 首轮 inventory 不只统计主页面 JavaScript 直接读到的值，也纳入“扩展可控、站点实际可见、但不完全属于主页面 JS 值”的项，例如 `Accept-Language`、worker/iframe 一致性、以及其他页面可触达的执行上下文一致性面。
- R8: `device/browser` 类页面可见项在本任务中只作为“继续排除/后置观察”记录，不作为当前主清单候选实现范围，除非后续出现明确证据表明它们与当前代理地区一致性问题直接相关。
- R9: CSS / media query 可见环境项在第一版中不进入主清单，只在需要时作为单独观察项记录。
- R10: 第一版主清单纳入 `WebRTC`，并且需要明确区分“限制泄露的策略模式”和“真正禁用能力”不是同一件事。
- R11: `WebRTC` 条目必须额外记录“能力归属”与“策略冲突边界”：当前真实使用中是由本项目负责、由外部扩展负责，还是两者并存。
- R12: 由于你已选择让本项目后续接管 WebRTC，inventory 需要把“全局策略控制”和“站点级 API/行为禁用”明确区分成两类候选方向，不能混成一个条目。
- R13: WebRTC 条目需要记录外部参考实现的适用边界：哪些策略只是 `privacy` API 的薄封装，哪些是当前项目已有能力，哪些是迁移后仍未覆盖的产品缺口。
- R14: WebRTC 条目需要按最终产品语义记录模式映射，避免当前 `off` 这种容易被误解为“禁用 WebRTC”的命名继续保留。

## First Inventory

### Inventory Fields

首轮主清单的每个条目统一记录以下字段：

- 读取入口：站点通过什么页面侧或请求侧入口观察到它。
- 当前覆盖：仓库当前是否已经改写或控制该面。
- 当前诊断：仓库当前是否已经能证明 allowlist 页面实际读到/看到的是目标值。
- 主要缺口：当前最直接的不一致风险或能力缺口。
- 建议档位：`已覆盖基线` / `建议优先补` / `可后置候选` / `建议继续排除`。

### 已覆盖基线

| 条目 | 读取入口 | 当前覆盖 | 当前诊断 | 主要缺口 | 建议档位 |
|---|---|---|---|---|---|
| language 主值 | `navigator.language`、`navigator.languages` | 已在 main world 直接改写。证据：`spoof/apply.js:21-30` | 诊断页已读取目标页 live 值。证据：`shared/diagnostic.js:225-236`、`test.html:227-230` | 还未证明在 iframe / worker 等上下文完全一致 | 已覆盖基线 |
| locale / Intl 派生面 | `Intl.DateTimeFormat().resolvedOptions().locale` 与 7 个 `Intl.*` 默认 locale 行为 | 已覆盖 `DateTimeFormat`、`NumberFormat`、`Collator`、`RelativeTimeFormat`、`ListFormat`、`PluralRules`、`DisplayNames`、`Segmenter`。证据：`spoof/date-time.js:151-192` | 诊断页已输出期望 locale 与 live locale/sample。证据：`shared/diagnostic.js:14-57`、`shared/diagnostic.js:162-236`、`test.html:246-248` | 仍未证明这些接口在子 frame / worker 中完全一致 | 已覆盖基线 |
| timezone / date 派生面 | `Intl.DateTimeFormat().resolvedOptions().timeZone`、`Date#getTimezoneOffset()`、`Date#toString()`、`Date#toLocale*()` | 已覆盖 timezone、offset、日期字符串与 DST 相关读数。证据：`spoof/date-time.js:73-149`、`spoof/date-time.js:194-289` | 诊断页已对比 timezone、当前 offset、1 月 / 7 月 offset、`Date#toString()`。证据：`shared/diagnostic.js:92-113`、`shared/diagnostic.js:217-236`、`test.html:199-208`、`test.html:231-239` | 与 language 一样，跨执行上下文仍缺系统性证明 | 已覆盖基线 |

### 建议优先补

| 条目 | 读取入口 | 当前覆盖 | 当前诊断 | 主要缺口 | 建议档位 |
|---|---|---|---|---|---|
| `Accept-Language` 请求头 | 站点服务端、回显接口、请求日志 | 已通过 DNR 按 allowlist 域名改写请求头。证据：`background/services.js:247-280` | 诊断页目前只展示“期望值”，没有 live 请求侧校验。证据：`pages/test-page.js:92-100`、`test.html:197-198` | 页面 JS 的 language 已对齐，但请求头是否真的按目标请求链路发出，目前无内建验证闭环 | 建议优先补 |
| iframe / subframe 一致性 | 子 frame 内的 `navigator.*`、`Intl.*`、`Date*` | 内容脚本注册为 `allFrames: true`，主 world 注入有基础。证据：`background/services.js:128-145`、`background/services.js:300-306` | live probe 只采集 `allFrames: false` 的顶层页。证据：`shared/diagnostic.js:247-253` | 目前只能证明顶层页一致，不能证明普通 iframe、`about:blank/srcdoc`、嵌套 frame 一致 | 建议优先补 |
| Worker / SharedWorker 一致性 | worker 内 `Intl.*`、`Date*`、timezone/locale 读数 | 已通过 Blob 包装给 `Worker` / `SharedWorker` 注入 timezone / locale patch。证据：`spoof/worker-hooks.js:3-45` | 当前没有 worker live 诊断 | 还未覆盖或证明 nested worker、service worker 等更深上下文 | 建议优先补 |
| geolocation 值与行为一致性 | `navigator.geolocation.getCurrentPosition()`、`watchPosition()`、权限/错误分支 | 仅覆盖成功返回坐标与 `watchPosition()` 代理。证据：`spoof/apply.js:32-51` | 诊断页只看 API 是否存在，且为避免弹窗不主动调用。证据：`pages/test-page.js:142`、`test.html:161`、`test.html:241-242` | 没有 `clearWatch()`、权限状态、错误分支、拒绝态、超时态的模型；站点如果检查行为而不只看 API 存在，会出现明显差异 | 建议优先补 |
| WebRTC 全局策略与 leak 验证 | 页面 WebRTC leak test、ICE candidate 可见结果、浏览器全局策略 | 已能通过 `chrome.privacy.network.webRTCIPHandlingPolicy` 设置全局模式。证据：`background/services.js:195-223`、`background/message-router.js:21-42` | 当前仓库没有内建 WebRTC live leak 诊断，也没有对“真实生效策略”与外部扩展冲突的检测闭环 | 这是重要泄露面；你已决定后续由本项目统一接管，而且当前 `off` 只是恢复默认，不是禁用 | 建议优先补 |

### 可后置候选

| 条目 | 读取入口 | 当前覆盖 | 当前诊断 | 主要缺口 | 建议档位 |
|---|---|---|---|---|---|
| geolocation 权限状态面 | `navigator.permissions.query({ name: 'geolocation' })` 等页面权限读数 | 当前仓库未见对应实现 | 无 | 这是站点可见面，但当前产品主轴更偏“值 / 请求 / 上下文一致性”；可在 geolocation 行为补强后再评估是否需要单独改写 | 可后置候选 |
| WebRTC 真正 `disabled` 模式 | 页面内 WebRTC API / 能力是否完全不可用 | 当前未实现；你已确认首轮先保留策略型模型 | 无 | 产品上有价值，但已明确不作为当前主路径；应在全局策略接管完成后再决定是否新增 | 可后置候选 |

### 建议继续排除

| 条目 | 原因 | 建议档位 |
|---|---|---|
| `screen.*`、`navigator.platform`、`deviceMemory`、`hardwareConcurrency`、`plugins/mimeTypes`、`userAgentData`、`canvas/audio/fonts` | 这些更偏真实设备 / 浏览器环境；你当前前提是真实浏览器，只是通过代理访问，主动改写它们更可能制造新的不一致 | 建议继续排除 |
| CSS / media query 环境项 | 例如 `prefers-color-scheme`、`prefers-reduced-motion`、`forced-colors`、viewport / DPR / `screen` 派生布局结果；已确认第一版不纳入主清单 | 建议继续排除 |
| TLS / DNS / HTTP2/3 / TCP / ASN / IP reputation 等底层网络特征 | 它们不属于页面层或请求头层，也超出当前项目边界 | 建议继续排除 |
| 白名单页面内直接阉割 WebRTC API 能力 | 你已明确第一优先是“浏览器全局策略接管”，不是先做页面级 API 禁用 | 建议继续排除 |

## Recommended Implementation Order

| 顺序 | 子任务 | 推荐原因 | 依赖 / 备注 |
|---|---|---|---|
| 1 | `07-01-accept-language-live-verification` | 当前请求侧是最明显的验证盲区；现有仓库已能改请求头，但还不能内建证明“服务端实际看到了什么”。这项范围最小、风险最低，也能先建立“页面值之外的 live 校验”模式。 | 独立任务；完成后可为后续 geolocation / WebRTC 的 live 验证提供展示和证据链模式。 |
| 2 | `07-01-iframe-subframe-consistency` | 这是当前已覆盖信号的最大乘数风险：top-level 页面通过，不代表子 frame 也一致。先补它，能最快提升 `language` / `timezone` / `Intl` 基线可信度。 | 受当前匹配模型约束：`allFrames: true` 只覆盖 URL 也命中规则的 frame，不等于任意跨域 iframe。 |
| 3 | `07-01-worker-sharedworker-consistency` | 与 iframe 同属执行上下文一致性，但代码路径和诊断方式更特殊，放在 frame 之后更容易复用上下文验证套路。 | 依赖对“哪些上下文可证明、哪些上下文只能界定边界”已有清晰约束。 |
| 4 | `07-01-geolocation-behavior-consistency` | 当前 geolocation 主要是“值像了”，不是“行为像了”；但它牵涉权限、错误分支和回调行为，复杂度明显高于前 3 项，适合在上下文一致性基线稳定后再收口。 | 这项更偏行为建模；必要时可在后续把权限状态再拆成二级子任务。 |
| 5 | `07-01-webrtc-global-policy-takeover` | 重要性高，但你当前已有外部扩展兜底，因此短期紧迫性低于前 4 项；同时它还涉及模式语义、外部扩展迁移、真实 leak 验证和产品边界回收，适合最后单独收口。 | 第一优先方向已固定为“浏览器全局策略接管”，不是页面级 API 禁用。 |

## Task Tree

- `07-01-accept-language-live-verification`
- `07-01-iframe-subframe-consistency`
- `07-01-worker-sharedworker-consistency`
- `07-01-geolocation-behavior-consistency`
- `07-01-webrtc-global-policy-takeover`

## Out Of Scope

- 代理、TLS、HTTP/2/3、TCP、DNS、ASN、IP reputation 等底层网络特征。
- 直接规划具体绕过检测的实现细节或对抗性策略。
- 本轮直接改代码实现新的 spoof 面。

## Open Questions

- 当前无阻塞性开放问题；下一步可以基于已确认边界直接整理第一版 inventory 主清单。

## Acceptance Criteria

- [ ] `prd.md` 已明确本任务只做梳理与优先级，不直接进入实现。
- [ ] 已记录当前仓库真实已覆盖的页面暴露面和证据来源。
- [ ] 已记录至少一套可用于后续扩面的候选暴露面分类框架，而不是无结构列表。
- [ ] 已定义每个候选项需要记录的统一字段，便于后续继续补充。
- [ ] 已明确首轮 inventory 的范围边界与明确排除项。
- [ ] inventory 主清单已收敛到当前已确认边界，不再存在阻塞性开放问题。
- [ ] “建议优先补”的 5 项已经排成明确实现顺序，并拆成后续子任务。
