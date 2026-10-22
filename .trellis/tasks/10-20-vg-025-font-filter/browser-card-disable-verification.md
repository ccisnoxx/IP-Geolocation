# VG-025 未插桩 dist 的浏览器卡片停用对照

## 最新：自动恢复活动 HTTP 标签的启动首读（2026-10-21）

按用户本轮授权，以有界面 **CfT 155.0.8059.80 / mac-arm64**、全新独立临时 profile 和当前未插桩 `dist/` 完成三次真实进程冷重启，**23 项 PASS，failure=null，cleanup=PASS**。正式记录：[chrome-http-session-restore-155.0.8059.80.json](chrome-http-session-restore-155.0.8059.80.json)。现场根因仍 **UNCONFIRMED**；VG-025 保持 `review`、人工验收 `pending`，VG-026/027 人验继续暂停，未提交发布。

### 自动恢复与采集顺序

本轮原生界面首次读取无 VanishGeo 卡片，独立窗口标识与本次子进程一致；实际点击开发者模式、加载未打包扩展，通过原生目录选择器确认当前 `dist`。执行器收到动作确认后独立回读包路径、UNPACKED 与 ENABLED，未调用 `Extensions.loadUnpacked`。随后在 `chrome://settings/onStartup` 正常点击“继续浏览上次打开的网页”，原生可见单选值由 0 变 1；未改写 Preferences、添加强制恢复 flag 或开启 unsafe extension debugging。

每次退出前只保留一个已激活的 HTTP 探针标签，关闭 Options、设置和管理页；`Browser.close` 后确认旧子进程正常 exit 0、无信号。以同一二进制、同一临时 profile 启动新 PID，**不传网页或空白页启动 URL**。HTTP 标签自行恢复，服务器提供 `no-store` 新响应；首 inline 同步读取目标 `FontFaceSet.check`、目标/monospace 测量关系、普通字体以及转换回调调用栈，并只向本次 loopback 服务回传布尔结果及内存内响应标识。

执行器先收到新进程对应的新响应首读报告，**之后才建立 CDP WebSocket 连接**、附加实际恢复 target，回读首 inline 快照及当前普通 iframe。没有恢复前的 Debugger 暂停、自动附加、新建 target 或驱动导航。其后在开启 Debugger 的情况下完整刷新并确认新响应，再新建 HTTP 文档；全部观测完成后才打开管理页，允许的分支最后再打开 Options。临时响应标识、扩展 ID、完整栈及度量原值不写正式证据。页面自报告是受控 fixture 的观察，不是生产配置或注册事实来源。

### 三条恢复路径

| 重启前状态 | 自动恢复文档的首 inline | 完整刷新及新建文档 | 采集后确认的保留状态 |
|---|---|---|---|
| 总开关和字体开启，卡片 ENABLED | 目标 check=false、测量等于 monospace，普通字体原生；捕获当前字体资产调用栈 | 同样过滤；顶层完整字体源码与当前 dist 一致 | 同一扩展 ENABLED、master=true、规则保留、font ready/1 |
| 内部 master=false，卡片 ENABLED | 目标 check=true、测量不等于 monospace；无字体/扩展来源栈 | 原生，未观测到字体栈或顶层字体脚本解析 | 同一扩展 ENABLED、master=false、字体开关仍 true、规则保留、font disabled/0 |
| 原生扩展卡片停用，内部 master 原为 true | 与内部关闭一致，未出现过滤或字体来源栈 | 原生，未观测到字体栈或顶层字体脚本解析 | 同一扩展 DISABLED、开关 off、worker target 不存在；停用期间未打开 Options |

卡片随后通过 Native CUA 实际重新启用，原生开关 on 后执行器再回读；此后才打开 Options，master 仍 true、字体开关和规则保留，新文档过滤及当前源码正对照恢复。三次均确认正常、未最小化的有界面窗口。

### 已确认的来源采集盲点

**开启恢复正对照的首 inline 已捕获 `font-exposure/filter.js` 调用栈并发生过滤，但首文档之后才附加的 Debugger 没有回放该顶层字体脚本，完整源码结果为 null。**同一次运行的完整刷新及新建正对照在导航前启用 Debugger，均取得顶层字体脚本及与 dist 一致的完整源码。

因此晚附加的 `scriptParsed` 缺失不能证明恢复文档从未注入。本轮关闭路径的结论由首 inline 实际 API/测量关系及同步栈负观察、开启正对照共同支持；不将其表述为所有脚本从未执行的绝对证明。恢复首文档的完整脚本字节仍未捕获，这一限制明确保留，也不将采集盲点冒充用户现场过滤根因。

执行形式：

```bash
CHROME_BIN='<temporary>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
CHROME_EXPECTED_VERSION='155.0.8059.80' VG025_UI_SIGNAL_DIR='<temporary>/ui-signals' \
node --import tsx scripts/chrome-font-filter-smoke.mjs --browser-disable --headed --persistent-cold --http-session-restore \
  --output .trellis/tasks/10-20-vg-025-font-filter/chrome-http-session-restore-155.0.8059.80.json
```

当前 dist 48 文件摘要在原路径、备份及执行后相同，字体资产与既有生成器一致。官方 ZIP SHA256、长度、提供方 MD5、CRC、673 个解压条目及版本/launcher 摘要均与已复核包一致；只读取 quarantine 缺失，不重签、不改变系统安全设置、不禁用沙箱，不声称验证了 Gatekeeper 开启时行为。只附加本次 owned CfT，未读取、操作、替换或重启用户 Chrome。

本轮通过 `node --check`、23 项真实浏览器定向检查、证据语义/隐私/状态一致性与 `git diff --check`；生产输入未变，复用既有类型检查、224 测试和 build 证据，未重跑广泛测试。临时浏览器/profile/CDP/server、ZIP/解压副本、信号及中间日志回收；早期现场证据保留。

本轮覆盖的是正常退出后**唯一活动 HTTP 标签**的自动恢复，不包括多个后台惰性恢复标签、崩溃恢复、所有历史注册状态、HTTPS、Chrome 138/其他 OS、用户普通 Chrome/profile 的实际后台构建/注册/停用派发路径或完整人验。两条关闭路径均未复现现场症状，不能据此确认现场原因或排除 Chrome 问题。启动读取失败清理修复仍是独立事项，不请求截图或重启用户 Chrome。


## 最新：正常 UI 加载及持久化冷启动 17 项 PASS（2026-10-20）

按用户授权，使用有界面 **CfT 155.0.8059.80 / mac-arm64**、同一专用临时 profile、未插桩当前 dist，完成原生扩展管理页加载及两次真实进程退出／重启。验证于 10-20 完成，10-21 补充记录。正式证据：[chrome-normal-ui-persistent-cold-155.0.8059.80.json](chrome-normal-ui-persistent-cold-155.0.8059.80.json)，**17 项 PASS、failure=null、cleanup=PASS**。没有操作、替换或重启用户 Chrome；现场根因仍 **UNCONFIRMED**，`review/pending` 不变，未提交或发布。

### 正常 UI 与进程归属确认

- 正式模式为 `--browser-disable --headed --persistent-cold`，要求本次临时原生操作信号目录。Native CUA 按临时 CfT 应用完整路径绑定；核对相同专属空白页标识后，在扩展管理页点击“加载未打包的扩展程序”，由原生目录选择器确认当前 dist，实际看到“扩展程序已加载完毕”。只记录路径一致布尔值，不保存窗口标识、个人路径或实际扩展 ID。
- 安装前首次 DOM 读取未见 VanishGeo 卡片，不将这一瞬间的 DOM 结果夸大为对所有异步安装来源的排除。等待阶段曾出现早于本代理明确目录选择的已加载状态，来源未确认；随后明确通过原生选择器再次加载同一路径，并在可见加载成功后才发出开始验证的信号。初轮未设原生操作完成门禁的结果仅作资格诊断，不计入正式 17 项；不将该准备现象归因于用户操作、浏览器缺陷或现场根因。
- 本模式不调用 `Extensions.loadUnpacked`，也不传 `--enable-unsafe-extension-debugging`。卡片停用／重新启用均由 Native CUA 实际点击并读取可见状态，执行器收到确认信号后还会从新管理页独立回读状态；没有通过管理 API、偏好文件或伪造配置替代正常加载／停用。
- 只连接自己启动的 CfT loopback CDP。每次重启前关闭全部管理页和 Options，保留空白页；调用该进程的 `Browser.close`，确认旧子进程正常退出（exit 0、无终止信号），再用相同二进制及相同临时 profile 启动新 PID。没有用 worker stop/wake 冒充浏览器重启，没有重新加载扩展或修改 profile 偏好。
- 官方 ZIP 重复 SHA256、长度／MD5／CRC、673 个解压条目、版本和 launcher 摘要与此前一致，复用同包的 CfT ad-hoc 复核；不重签、删除 quarantine、改变系统安全设置、关闭沙箱或申请新权限。

### 冷启动后先采样，再检查状态

| 重启前状态 | 重启后的首个 HTTP 文档及完整刷新 | 探针之后取得的状态 |
|---|---|---|
| 内部 master=false、字体 disabled/0，卡片仍开启 | 两者均原生；无顶层字体脚本／调用栈；首 inline 与新响应确认 | 同一扩展仍 ENABLED；Options 中 master=false、字体开关仍 true、规则保留、字体 disabled/0 |
| 卡片 DISABLED，内部 master 先前为 true | 两者均原生；无顶层字体脚本／调用栈；首 inline 与新响应确认 | 同一扩展仍 DISABLED、开关关闭、worker target 不存在；停用期间未打开 Options |

两次新进程 CDP 就绪后，先核对没有 Options／管理页 target，再创建空白 target、开启 Debugger 并导航 HTTP 探针；首 inline 和字体来源采集完成后执行真正 `Page.reload(ignoreCache=true)`，等待 load 并确认新响应标识，之后才打开管理页。第一条路径最后才打开 Options 读配置；第二条路径只在卡片重新启用后打开 Options，确认内部 master 仍 true、字体开关和规则保留，并确认新文档过滤恢复。

普通 HTTP iframe 同样符合关闭结果，开启正对照和重新启用后均取得当前字体资产源码及实际过滤证据。旧 hook 在卡片停用后、刷新前仍存在；不把旧快照当作新文档。当前 dist 原路径直接加载，加载前后／备份 **48 文件摘要相同**，与既有 headless／headed 对照相同。

执行形式（信号文件仅为驱动流程确认，不是扩展配置事实来源）：

```bash
CHROME_BIN='<temporary>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
CHROME_EXPECTED_VERSION='155.0.8059.80' VG025_UI_SIGNAL_DIR='<temporary>/ui-signals' \
node --import tsx scripts/chrome-font-filter-smoke.mjs --browser-disable --headed --persistent-cold \
  --output .trellis/tasks/10-20-vg-025-font-filter/chrome-normal-ui-persistent-cold-155.0.8059.80.json
```

`node --check`、正式真实 Chrome 流程、冷启动顺序／状态／来源／资产及记录检查、`git diff --check` 通过。正式运行后只将首次 UI 读取字段更名为准确语义，未改变执行或断言；语法检查通过，不为字段名称重跑浏览器。生产输入未变，复用既有类型、224 测试与构建证据。临时浏览器、profile、CDP、server、包、副本、信号及中间资格记录均已回收；早期用户现场原始证据保留。

本轮补齐了**本隔离环境的正常加载与真实冷启动**，原先 CDP 临时扩展的 cold `BLOCKED` 保留为历史，不替换其当时事实。仍未覆盖用户普通 Chrome／现场 profile 的实际构建、注册和派发路径、全部历史状态，以及浏览器自动恢复 HTTP 标签时早于 CDP 就绪的竞态、Chrome 138／其他 OS 或完整人工验收。两条关闭路径冷启动后均未复现现场现象，不据此宣布现场根因已确认或排除 Chrome 问题。VG-026／VG-027 人工验收继续暂停，不要求截图或重启用户 Chrome。

## 此前：155.0.8059.80 有界面对照 9 项 PASS（2026-10-20）

按用户要求，以相同官方 `.80` mac-arm64 ZIP、全新独立临时配置文件及当前未插桩 dist 补充有界面模式，**9 项 PASS、failure=null、cleanup=PASS**。正式证据：[chrome-browser-card-disable-155.0.8059.80-headed.json](chrome-browser-card-disable-155.0.8059.80-headed.json)。与下方此前 headless 记录比对，11 组行为／状态／资产字段一致，覆盖条件内未发现模式相关差异，现场根因仍 **UNCONFIRMED**，`review/pending` 不变，未提交发布。

### 有界面模式与隔离资格

- 执行器新增 `--headed`，当前仅与 `--browser-disable` 联用；默认 headless 行为不变。有界面启动参数仅移除 `--headless=new`，保留相同的站点隔离、调试及后台网络参数，不新增沙箱关闭或权限放宽。
- 从本次子进程的 `/json/version` 确认 `Chrome/155.0.8059.80`，保留显式二进制缺失不回退、完整版本不符即停止的门禁。没有附加、操作、替换或重启用户 Chrome。
- 先从该子进程实际 `/json/protocol` 核对 Browser window 方法及参数，再用 `Browser.getWindowForTarget`／`getWindowBounds` 取得 Options 所在浏览器窗口：状态 `normal`、非零尺寸、未最小化。证据只保存状态及布尔结果，不记录窗口坐标、尺寸或其他应用窗口信息；没有使用截图代替模式确认。
- 重新从官方 HTTPS 获取 ZIP，核对 SHA256 与 headless 包一致、响应头长度／MD5、ZIP CRC 及全部 673 个解压条目；包内版本和 launcher 摘要亦一致。复用上次针对相同包的 CfT ad-hoc 签名复核，不重复把缺少发布者签名当作安全阻断；未重签、删除 quarantine 或修改系统安全设置。包无 quarantine 属性；不认证 Gatekeeper 开启时启动。
- 相同探针、配置消息、卡片可信点击、首 inline／字体 API／顶层脚本来源及完整刷新判定不变；只有 headed 额外读取窗口元数据。HTTP 文档的 Debugger 仍在导航前开启，完整刷新仍等待实际 load 并核对新的服务器响应标识。

```bash
CHROME_BIN='<temporary>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
CHROME_EXPECTED_VERSION='155.0.8059.80' \
node --import tsx scripts/chrome-font-filter-smoke.mjs --browser-disable --headed \
  --output .trellis/tasks/10-20-vg-025-font-filter/chrome-browser-card-disable-155.0.8059.80-headed.json
```

### 与此前 headless 的实际比较

| 关闭方式 | 有界面：新建 HTTP 文档 | 有界面：完整刷新 | 此前 headless |
|---|---|---|---|
| 内部总开关关闭，卡片仍 ENABLED | 字体原生，无字体脚本来源 | 同左，确认新响应 | 一致 |
| 卡片实际 DISABLED，内部 master 先前为 true | 字体原生，无字体脚本来源 | 同左，确认新响应 | 一致 |

开启正对照及重新启用后均确认过滤、顶层源码与当前资产一致；卡片停用状态由新开的管理页重新读取，worker target 消失。实时 API 证实旧文档在卡片停用后、刷新前仍有 hook，完整刷新后恢复原生；重新启用后内部 master 仍 true。普通 HTTP iframe 同样符合开启／关闭结果。两次记录的 checks、observations、cardStates、内部关闭报告、master／worker／旧 hook 状态及资产等 11 组字段逐项一致。

当前 dist 直接原路径加载，无插桩、额外驱动页或权限变更；加载前后及临时备份的 48 文件摘要一致，并与 headless 记录相同。`node --check`、真实 headed Chrome、比较／记录／状态检查及 `git diff --check` 通过，生产输入未变，复用此前类型、224 测试及 build 证据。临时 Chrome、profile、CDP、server、ZIP、解压副本与日志均回收。

本轮只补齐有界面隔离对照，没有重跑此前已通过的 headless 流程。两者都未复现现场现象，不能将未复现简单归因于 headless；也不能据此确定现场过滤来源或排除 Chrome 问题。CfT 品牌、全新 profile、现场实际后台构建／注册／派发路径及历史状态仍有差异或缺证；真正冷启动、Chrome 138／其他 OS 和完整人工验收仍未闭合。VG-026／VG-027 人工验收继续暂停，不请求截图或重启用户 Chrome。

## 此前：155.0.8059.80 headless 对照 9 项 PASS（2026-10-20）

重新核实 CfT 的签名与分发合同后，在独立临时 **Chrome for Testing 155.0.8059.80 / mac-arm64 / headless=new** 完成当前未插桩 dist 对照，**9 项 PASS、failure=null、cleanup=PASS**。正式记录：[chrome-browser-card-disable-155.0.8059.80.json](chrome-browser-card-disable-155.0.8059.80.json)。没有操作、替换或重启用户 Chrome；VG-025 仍为 `review`／人工验收 `pending`，现场根因 `UNCONFIRMED`，未提交或发布。

### 签名判断更正与获取完整性

此前 [chrome-155.0.8059.80-acquisition.json](chrome-155.0.8059.80-acquisition.json) 保留首次在启动前停止的历史事实；当时将发布者签名设为独立运行的必要条件，判断过严。最新复核附于该记录的 `followUpReassessment`，不把历史四项 NOT_RUN 改写为当时已通过。

- [CfT 官方维护者说明](https://github.com/GoogleChromeLabs/chrome-for-testing/issues/205)：CfT 二进制不做发布者签名；发布的包内容保持不变。该说明所在 issue 的触发场景是 Windows，macOS 结论另由构建配置及实际包核对支持。
- [精确 `.80` 构建配置](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.80/chrome/installer/installers.gni) 将 CfT 排除在 macOS installer 流程外；实际包只有 linker ad-hoc 签名，无发布者 TeamIdentifier 或资源封印。[Apple DTS 说明](https://developer.apple.com/forums/thread/791270) arm64 链接器会自动生成此类无证书签名。不能把“CfT 不做发布者签名”误解为 arm64 Mach-O 完全没有签名。
- 原应用 bundle 的严格 `codesign` 校验确实失败；其错误本身没有证明篡改。另将主 launcher **逐字节相同的副本**放在 bundle 外做只读诊断，`codesign --verify --strict` 通过，说明该 launcher 的代码签名验证与缺失 bundle 资源封印需要区分。诊断副本未执行，实际运行的完整应用没有重签、改写或拼装；不声称 bundle 已通过发布者签名或公证。
- 从[官方 HTTPS 精确版本 ZIP](https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.80/mac-arm64/chrome-mac-arm64.zip)重新下载，SHA256 与首轮相同：`37e08609b6d087fdb84848d90499d0a54b5a8446eddf76de6b95e0d7ef504ff5`。响应头长度／MD5、ZIP CRC、路径以及解压后全部 **673 个条目**的文件字节／链接目标均核对通过，包内版本确为 `.80`。MD5 只作传输一致性；来源信任基于官方 HTTPS 分发，不伪称存在独立的发布者签名验证。
- 按官方 CLI 下载方式取得的包没有 quarantine 属性，只读确认，未执行 xattr 删除、重签、系统安全设置或更新策略变更，也未加入 `--no-sandbox` 等沙箱关闭参数。此前 `spctl` 已显示本机安全 override，仍不计为签名／公证通过；本轮不认证 Gatekeeper 开启时的用户启动行为。系统未实际拒绝本次正常子进程启动，无需执行安全例外操作。

### 精确版本运行与关闭结果

执行器仅增加显式 `CHROME_BIN` 缺失时不回退到其他安装、以及 `CHROME_EXPECTED_VERSION` 在加载扩展前核对完整版本的约束；未改变探针、生产配置和判定条件。二进制缺失负对照在 prepare 阶段停止，未启动浏览器；正式运行经 `/json/version` 确认为 `Chrome/155.0.8059.80`。

```bash
CHROME_BIN='<temporary>/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
CHROME_EXPECTED_VERSION='155.0.8059.80' \
node --import tsx scripts/chrome-font-filter-smoke.mjs --browser-disable \
  --output .trellis/tasks/10-20-vg-025-font-filter/chrome-browser-card-disable-155.0.8059.80.json
```

开启正对照确认过滤、调用栈及顶层字体源码与当前资产一致。内部关闭后，master=false、字体 disabled/0、Chrome 卡片仍 ENABLED；新建和完整刷新 HTTP 文档均原生。恢复 master=true 后，通过独立 Chrome 卡片可信点击停用，新开的管理页确认 DISABLED/checked=false、worker target 消失；新建和完整刷新文档也均原生，普通 HTTP iframe 同样原生，顶层字体脚本解析和调用栈证据消失。两种刷新均等待真实 load 并核对新的 HTTP 响应标识。

卡片停用后旧文档实时 API 仍有 hook，完整刷新后恢复原生；重新启用卡片后 master 仍 true、字体 ready、新文档过滤恢复。当前 dist 加载前后及临时备份的 **48 个文件摘要不变**，与此前 `.85` 对照一致；没有插桩、额外驱动页、动态 payload 或权限变更。9 项 PASS 来自本次真实 `.80` 运行，不是复用 `.85` 结果。

`node --check`、二进制缺失负对照、真实 Chrome、记录解析／状态一致性和 `git diff --check` 通过；生产输入未变，复用既有类型、224 测试与构建证据。临时浏览器、profile、CDP、server、ZIP、解压副本及诊断文件均回收。

同版本独立环境仍未复现现场现象，但本次是 CfT 品牌、headless、全新配置文件和当前 dist，不等于用户现场的普通 Chrome 二进制／配置／历史状态；没有读取现场实际注册列表或取得实际派发路径。不能宣布根因已确认或排除 Chrome 问题。真正冷启动、Chrome 138／其他 OS、现场路径及完整人工验收仍未闭合，VG-026／VG-027 人工验收继续暂停。

## 此前：155.0.8059.85 已完成对照

2026-10-20，用户授权使用独立临时 Chrome 配置文件，验证内部总开关关闭与浏览器扩展卡片停用的区别。**独立 Chrome/155.0.8059.85，9 项 PASS，failure=null，cleanup=PASS；未复现停用后新文档仍注入。** 正式脱敏证据：[chrome-browser-card-disable.json](chrome-browser-card-disable.json)。VG-025 仍为 `review`、人工验收 `pending`；用户现场根因仍为 `UNCONFIRMED`，未提交或发布。

## 环境与未插桩保证

- 全新随机临时 `user-data-dir`、独立 Chrome 子进程与 loopback CDP；没有附加、读取、操作或重启用户 Chrome。
- 最终执行直接加载当前仓库 `dist/` 原路径，控制面使用包内已有 `options/options.html`。没有新增驱动页、改写 worker、注入故障包装或改变 manifest／权限。
- 加载前后核对整个 `dist/` 的 **48 个文件**及相对文件名的内容摘要，全部一致；临时备份也一致。整体摘要与字体资产 SHA256 见正式 JSON。没有手改或重新构建 `dist/`。
- 字体配置仅使用合成 `localhost` 启用规则、固定内置名单；语言／时区开关关闭，不操作 Allow User Scripts、不请求 provider、不恢复位置或 Worker。
- 只连接本次子进程的 DevTools 端口。Chrome 内置扩展管理页中的目标卡片按实际加载 ID 定位，验证名称 VanishGeo；实际 ID、个人路径及文档 nonce 不写入证据。

执行命令：

```bash
node --import tsx scripts/chrome-font-filter-smoke.mjs --browser-disable --output .trellis/tasks/10-20-vg-025-font-filter/chrome-browser-card-disable.json
```

## 两种关闭方式与实际结果

| 关闭方式 | Chrome 卡片状态 | 新建 HTTP 文档 | 已过滤文档完整刷新 |
|---|---|---|---|
| 内部总开关关闭 | `ENABLED`，卡片仍开启 | 字体 API 原生，无字体脚本／调用栈证据 | 同上，确认新 HTTP 响应 |
| 浏览器卡片停用 | `DISABLED`，卡片开关关闭 | 字体 API 原生，无字体脚本／调用栈证据 | 同上，确认新 HTTP 响应 |

内部关闭通过正常受保护 `setExtensionEnabled(false)` 消息完成，实际报告 `masterEnabled=false`、字体 `disabled/0`，且卡片仍为 `ENABLED`。这是扩展仍运行时的正常配置对账。

浏览器关闭前，先重新保存内部总开关为开启并确认字体 `ready/1`、新文档实际过滤。随后激活独立 Chrome 的 `chrome://extensions/`，通过 `Input.dispatchMouseEvent` 的可信按下／释放点击对应卡片开关；**未调用 `Extensions.unload`、管理 API、修改偏好或内部关闭消息替代此操作**。新开扩展管理页重新取得目标卡片 `state=DISABLED`、`checked=false`，且已无对应 worker target。证据中的卡片 `disabled` 字段是开关控件的不可交互属性，不表示扩展启用状态；扩展停用由 `state` 与 `checked` 判断。

卡片停用后，新文档及完整刷新文档的首 inline 均恢复原生，普通 HTTP iframe 同样恢复原生；没有包内字体文件解析或字体调用栈标签。完整刷新使用 `Page.reload(ignoreCache=true)` 并等待实际 load，响应 nonce 必须变化且与本机服务器记录一致，未用 `document.open`、BFCache 或旧首读快照替代新文档。

作为反向控制，通过同一卡片可信点击重新启用扩展后，从原 Options 页读回内部总开关仍为 `true`，字体状态 `ready`，新文档过滤与源码证据恢复。未在卡片停用期间读取扩展存储，也不声称浏览器停用永久删除了持久注册。

卡片关闭后、完整刷新前，另以**实时 `document.fonts.check()` 调用**确认旧文档仍有过滤，不是读取旧的首 inline 缓存值；完整刷新后该文档恢复原生。这符合已执行 hook 的快照边界，但不能用来解释此前用户现场已确认的新 HTTP 响应仍过滤。

## 来源采集与执行器资格

探针只包含本机脚本和普通字体检查，不安装字体 hook。开启正对照同时确认首 inline 字体结果、测量回退、普通 iframe 过滤、顶层实时调用栈中的包内字体路径，以及当前顶层 frame 对应脚本源码与 `dist` 字体资产一致。关闭后同时要求功能原生、调用栈标签消失、顶层字体脚本解析记录消失，不能仅凭一个 check 返回值判断来源。

最初三次执行在开启正对照的来源采集断言停止，尚未进入卡片停用，不记作浏览器停用 FAIL。加载后才启用 Debugger 时，只采到了 iframe 的字体脚本记录；补充 context/frame 诊断后，执行器改为先创建空白页、启用 Debugger，再导航探针，保留顶层 frame、源码一致及功能断言。最终来源采集和完整流程通过。首个完整通过版本之后，另将旧文档检查改为实时 API 调用，最终正式 JSON 来自该修正后的完整执行。未修改生产实现或以重复尝试本身当作通过证据。

本轮新增独立 `--browser-disable` 模式；`node --check`、真实 Chrome 定向验证、`git diff --check`、正式 JSON／空白／状态及资产摘要检查通过。生产源码、单元测试和构建输入未变，复用上轮类型、224/224 测试及构建证据，没有重复全套。临时 Chrome／profile／CDP／server、备份和中间结果均在证据记录后回收；此前现场探针原始证据保留。

## 早期 `.85` 对照与用户现场的边界

上述早期 `.85` 对照直接加载当前未插桩 dist，在独立配置文件中未复现；先前用户现场记录版本为 **155.0.8059.80**，该次为 **155.0.8059.85**，不是同版本对照。后续 `.80` headless／headed 的结果见本文顶部，仍未重读用户 Chrome 的扩展管理状态或实际注册列表，未确认现场加载的后台构建与独立对照是否一致。

不能据此否定此前现场观测，不能直接归因于旧文档、某个其他扩展、用户配置文件或版本差异，也不能宣布已确认／排除 Chromium 缺陷。浏览器真正冷启动、Chrome 138／其他 OS、现场停用路径及完整人工验收仍未闭合；历史 cold `BLOCKED` 保留。暂不推进 VG-026／VG-027 人工验收，不提交或发布。
