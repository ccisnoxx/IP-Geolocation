<div align="center">

<img src="images/banner-zh.png" alt="VanishGeo" width="100%"/>

# VanishGeo

浏览器环境一致性工具：让页面里的时区、语言、定位、canvas 字体、请求头和真实出口**说的是同一件事**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)

[English](#english) | [中文](#中文)

</div>

---

## 中文

VanishGeo 是一个 Chrome MV3 扩展（Chrome 119+：`chrome.scripting` 的 `world: "MAIN"` 要 111+，
`matchOriginAsFallback` 要 119+）。它不做"随机化指纹"，做的是**一致性**：同一个
persona 在进程环境、请求头、页面 JS 三层同时成立，改不到的地方宁可不改。

### ✨ 做了什么

- 🕐 **时区** - `getTimezoneOffset` / `get*` / `set*` / `toString` / `Intl` 全套跟着走，`new Date(str)` 的本地时间语义一并处理
- 🌐 **语言** - `navigator.language` / `languages`（冻结数组）/ `Intl` 默认 locale，请求头 `Accept-Language` 由 DNR 在首个请求前改写
- 🌍 **定位** - 坐标、精度、可选随机偏移（会话内固定，不会每 3 秒瞬移）；`Position` / `Coordinates` 按 WebIDL 形状重建
- 🖋 **canvas 字体** - 三层结构：**平台层**（按本机真实平台判定，隐藏另外两个平台的字体）、**中文层**（中文与国产厂商字体）、**手动层**；覆盖 `<canvas>`、`OffscreenCanvas` 和 `window.queryLocalFonts()`（直接枚举本机字体那条路，实测 667 → 632 条），名字匹配含本地化别名（`苹方-简`、`微软雅黑`）
- 🔒 **WebRTC** - `strict` / `compatible` / `default` 三档，对应不同的 `contentSettings` 策略
- 🛡 **反检测** - 原生函数签名、原型 getter、零自有属性、零 `window` 全局；改不到的地方（原生值已经正确）一个对象都不动

### 🚀 安装

**从 Release**：下载最新的 `vanishgeo-v*.*.*.zip` → 解压 → `chrome://extensions/` →
打开「开发者模式」→「加载已解压的扩展程序」→ 选解压出来的目录。

**从源码**：

```bash
git clone https://github.com/XiNian-dada/VanishGeo.git
cd VanishGeo
npm install
npm run build        # 内含 typecheck；产物在 dist/
```

`dist/` 就是要加载的扩展目录。逐步说明见 [INSTALL.md](INSTALL.md)。

### 📖 使用

打开弹窗：

- **站点白名单** - 每行一个域名，`example.com` 自动包含子域名；**不支持通配符**
- **启用本站 / 排除本站** - 直接给当前域名写一条规则，写完只重载这个域名的标签页
- 📦 **一条命令出包** - `npm run release -- --all-presets` 烘焙 → 校验 → 打包 → 记账（sha256 / git sha / 坐标 / 域名），三道闸任一不过就不出包；`npm run verify:release` 真开浏览器量首屏，证明零窗口成立
- 🩺 **配置体检** - 诊断页实时算出配置里的自相矛盾：请求头与 JS 语言不一致、时区填了却没开、坐标与声明时区差几千公里……能机械修的直接给按钮；「时区在美国而语言是中文」这类取舍只报告、不替你做决定
- **快速配置** - 五个内置 persona 卡片（新加坡 / 日本 / 德国 / 美国 / 中国）、手动坐标与时区、语言与 `Accept-Language`、字体列表
- **从 IP 自动配置** - 按出口 IP 推一套自洽的地点和时区

完整配置页（弹窗内「打开完整配置」）多出：站点规则的可视化启用/禁用/删除、
自定义 persona 的保存/导入/导出、全部数据重置。

#### 规则模型

只有一种模型：**域名规则**。

```
google.com          ← 启用：google.com 及其所有子域
!mail.google.com    ← 排除：命中更长的这条规则，整站保持原生值
```

- 最长匹配优先：`google.com` 启用 + `mail.google.com` 排除，访问 `mail.google.com` 就是不伪装
- 排除规则会被保留，不会因为保存一次就消失
- 没有"全局/白名单/黑名单"三模式，也没有 `*.example.com`、`*keyword*` 这类通配符

#### 改动什么时候生效

| 改了什么 | 生效方式 |
| --- | --- |
| 时区 / 语言 / 定位 / canvas | 立即推给所有已开标签页，**不用刷新** |
| 启用 / 排除 / 删除某域名 | 只重载**该域名**的标签页（其它标签页不动） |
| 出口 IP 变化 | 每 5 分钟（`chrome.alarms`）自动跟随一次；想立刻生效点「重试定位」 |
| 图标角标 | 随定位/配置刷新；fail-closed 时变红 `!` 并在弹窗给出原因 |

### 🧱 默认值

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 语言 | `en-US` / `en-US,en;q=0.9` | 语言是 persona 属性，不跟随系统 |
| 时区 | `auto` | 跟随出口 IP 推导；只有点了 persona 卡片才钉成固定值 |
| 定位 | `auto` | 同上 |
| 默认选中 persona | `united-states` | 只在配置页"当前配置"里预选，**不代表**时区已被钉住 |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| canvas 字体 | 关闭 | 打开后按 `targetFonts` 列表替换 |
| 域名规则 | 13 个，全部启用 | 见 `src/shared/default-domains.json` |

**首次安装**会把默认规则种进去（chatgpt.com、openai.com、claude.ai、anthropic.com、
gemini.google.com、copilot.microsoft.com、google.com、bing.com、x.com、twitter.com、
youtube.com、reddit.com、linkedin.com）；**从旧版升级**时，`VanishMe` 老配置会被
`convertVanishMeConfig` 迁移，更早的扁平键（`bpg_config` 之前的形态）走默认规则。

### 🧪 调试与自检

**只有一个测试页**：右键扩展图标 →「Open diagnostic page」（`leak-test/leak-test.html`）。

- 上半部分显示当前配置的**期望值**（语言、`Accept-Language`、时区、坐标、启用域名）
- 「探测选中标签页」会在目标页面的 MAIN world 里跑一遍真实取值，逐行标红没达标的项：
  `Intl` 时区、`Date` 语义（字符串日期 / 非法日期 / `setHours` 往返）、
  `languages` 是否冻结、`setHours.toString()` 是否原生签名、`Coordinates` 是否有自有属性、
  `fonts.check`、canvas 度量
- 本页自己跑在扩展源，注入层不作用于它，所以上方的"基线"是浏览器原生值 —— 对比用

命令行验证：

```bash
npm run typecheck     # 类型（含 tests/）
npm run lint          # ESLint
npm run verify        # lint + typecheck + test
npm test              # 单测（312 条）
npm run test:coverage # 单测 + Node 覆盖率报告
npm run test:coverage:core # 核心文件分支覆盖率门禁（每文件 ≥ 85%）
# options / popup 的 DOM 测试用 jsdom 驱动真实点击与表单事件
npm run build         # 构建
npm run setup:chrome119 # 下载/校验 Chrome for Testing 119（macOS arm64）
npm run audit         # 静态检查 + 三引擎 E2E（Chrome 155 / 119 / Helium），输出通过率表格
npm run smoke:frames  # frame 隔离（父域 / 子域 / about:blank / srcdoc）
npm run smoke:baked-failclosed  # 烘焙包定位 fail-closed + 可逆恢复 + 关总开关 clear
npm run smoke:baked-clear  # 烘焙包排除站点 / 关总开关 / frozen 冻结验证
npm run smoke:presets # 五个内置 preset 的浏览器 E2E（语言/时区/请求头）
npm run smoke:cold-start # 冷启动 + clear 浏览器 smoke
npm run smoke:popup   # popup 真实点击 / storage / 后台消息 smoke
node tools/native-parity.mjs  # Helium 原生形状对拍（83 项，control vs patched）
```

`npm run audit` 里另含 `smoke:options` / `smoke:failclosed` / `smoke:frames` /
`smoke:baked-failclosed` / `smoke:baked-clear` / `smoke:fingerprint` / `smoke:ipchange` /
`smoke:real-site` 八组探针，具体见 [tools/README.md](tools/README.md)。

### 🧱 烘焙构建（persona）

```bash
node scripts/build-persona.mjs --persona=us-la-1               # -> ~/.vanishgeo/profiles/us-la-1/ext
node tools/chrome-env.mjs --persona=us-la-1 --setup-extension  # Chrome 首次装一次
node tools/chrome-env.mjs --persona=us-la-1 --url=https://claude.ai
```

- 配置在构建期烘焙进注入层：`document_start` 同步生效，首屏脚本读到的就是目标值
- 同时产出**静态** DNR 规则集（manifest 里声明），首个请求就带正确的 `Accept-Language`
- 同时把域名写进 manifest 的**静态** `content_scripts`（`world: "MAIN"`、
  `document_start`、`all_frames`、`match_about_blank`）：不受"动态注册赶不上首个渲染进程"影响
- 在选项页改了语言 → 自动禁用静态 ruleset 交给动态规则；新增域名由动态注册补上，不重复注入
- 运行时通道（ISOLATED 桥 → `MessagePort` → 注入层）在烘焙构建里**默认开启**：烘焙值只是初值，选项页改动仍要实时生效；`--no-bridge` / `--frozen` 才彻底关闭
- **排除站点 / 关总开关在烘焙包里也生效**：静态脚本无法按域名卸载，桥拿到
  `matched: false` 后会下发 `clear`，注入层把 Date / Intl / navigator / Geolocation /
  Canvas / Worker 逐项还原（已验证刷新后仍是原生值，请求头同步回退）。
  已经进入页面闭包的旧引用收不回来，但之后所有新读取都是原生值
- 关掉桥（`--no-bridge` / `--frozen`）等于把规则冻结进包：后台也读烘焙配置，
  保存配置不会改 DNR / 权限；排除、总开关、语言改动都需要重新构建才生效

### 🔬 实测结论

- `TZ` 改时区（含 Service Worker），`-AppleLanguages (en-US)` 改 ICU locale；`--lang` 只改
  `navigator.language`，**不改** ICU。三者都对时扩展一个原生对象都不改
- Chrome 155 已移除 `--load-extension`；Chrome 119 和 Helium 156 仍然支持（审计用后者测老引擎）
- Chrome 119 没有 CDP `Extensions.loadUnpacked`；老引擎用启动参数装载，扩展 id 从 extension target 里发现
- DNR `modifyHeaders` 用 `regexFilter` 会把 `main_frame` 打成 `ERR_ABORTED`，已改用
  `requestDomains`；重写动态规则会打断进行中的请求，所以规则没变就不重写
- 冷 profile 首次启动要等约 10s 注入才就绪（2/3.5/5/7/8s 都漏，12s 成功）；同一个 profile 第二次启动 2s 内就绪
- 语言与时区**解耦**：`auto` 时区拿不到定位时，语言和 `Accept-Language` 照常生效，只有时区留在原生值
- fail-closed 不是静默：角标变红 `!`、弹窗显示原因、`getCurrentTabState` 返回具体 `errors`
- **定位 fail-closed**：命中规则且定位开启、但坐标解析不出来（auto 没拿到出口 IP / 手填值非法）时，
  `getCurrentPosition` 与 `watchPosition` 返回 `POSITION_UNAVAILABLE`（code 2），权限层同步置为
  `block`；不会落回原生定位。坐标解析出来后同一文档内自动切回伪装坐标，无需刷新

### 🔧 实现要点

- **三层一致**：进程环境 / 请求头（DNR）/ 页面 JS（MAIN world 原型补丁）
- **签名表，不是 Proxy**：`Function.prototype.toString` 输出
  `function setHours() { [native code] }` 且 `name`/`length` 与原生 arity 表一致
- **WebIDL 形状**：`GeolocationCoordinates` 的属性是原型上的只读 getter，实例零自有属性
- **不造假信号**：不接管 `document.fonts.check`（原生对系统字体本来就返回 `true`）
- **私有通道**：payload 经 `document_start` 握手换来的 `MessagePort` 下发，页面既看不到也伪造不了
- **按 frame 投递**：payload 带解析时的精确 `hostname`；后台用 `webNavigation.getAllFrames` 为每个 frame 单独算规则并带 `frameId` 下发，父页不会覆盖独立子域 iframe，子框架规则删除后也会收到自己的 `clear`。同一 URL 的解析结果复用，投递最多 8 个并发，避免几十个 iframe 被串行 IPC 拖慢
- **BFCache 恢复会重拉**：页面进 BFCache 后内容脚本不会重新注入，payload 也不会自己再来一遍。桥在 `pageshow` 且 `event.persisted === true` 时按本 frame 的规则重拉一次，所以"冻结期间改了配置/排除了站点，恢复后仍是旧值"这条路径不存在；普通加载的 `pageshow` 不重复拉取。已知代价：改语言要重写 DNR 请求头规则（Chromium 实测任何 DNR 写入都会驱逐 BFCache，同内容重写也算），而前台页面不会自己重载、文档仍是旧头 —— 所以检测到请求头值变化时**主动重载命中该域名的已打开页面**；只改时区不写 DNR、也不重载。细节见 [CONFIG_GUIDE](CONFIG_GUIDE.md)
- **静态优先**：烘焙构建把 DNR 规则与内容脚本写进 manifest，首帧即生效
- **值一致优先**：原生值已经正确时不打补丁

**字体伪装的边界**（照实写，免得误判）：它改的是 canvas 里的**族名解析** —— `measureText`
量出来的宽度，以及 `fillText` / `strokeText` 落下去的像素，两者走同一条回落路径（只改前者的话，
"量出来缺失、画出来真实"本身就互相印证出矛盾）。所以 (1) DOM / CSS 那条路仍测不到：
`element.getBoundingClientRect()`、SVG 文字尺寸不受影响；(2) 系统 CJK 兜底字体
依然存在 —— `72px monospace` 量中文时仍会落到 PingFang，这是"这台机器有中文字体"的事实，
靠 canvas 补丁消不掉；(3) `document.fonts.check()` 对没装的字体名也返回 `true`，是原生行为，
两边一致，不构成差异信号；(4) 除 canvas 之外还有一条**直接枚举**的路 ——
`window.queryLocalFonts()` 会返回本机全部字体，所以这一层也按同一把键过滤（实测 667 → 632 条），
让两份视图说的是同一件事。

**Worker 覆盖面**（同样是照实写，声明与 `src/shared/worker-coverage.ts` 同源）：

| 上下文 | 覆盖 | 说明 |
|---|---|---|
| classic / module Worker | ✅ 或 ⚠️ | blob 前缀包装入口，Date / Intl / navigator / canvas 与主线程同源。每个文档先探一次 blob 是否被 CSP 放行：被拒时全部走原生入口，此时标 ⚠️ 并在弹窗里明说 |
| SharedWorker | ❌ | **不包装**：身份是 `(resolved URL, name)`，换成 blob URL 会让每个文档各建一个实例，跨文档共享语义消失且无法修回去。它读到的是**原生值** |
| nested worker | ❌ | 父 Worker 里的 `Worker` 构造器未打补丁，孙 Worker 读到原生值 |
| service worker | ❌ | 没有 hook `navigator.serviceWorker.register` |

诊断页（`fixtures/workers/top.html`）与 `buildWorkerDiagnosticsSnapshot` 都按这张表标注：
UNSUPPORTED 的上下文即使探测"成功"也不显示成通过 —— 探测能返回值不代表被伪装。

**包装失败是可见的，不是静默回退。** 页面 CSP 的 `worker-src` / `script-src` 有权拒绝
blob 入口，而 Chrome 在这种拒绝下**不会让构造函数抛错**，只在稍后触发一次 error 事件
（`message` 还是空的）。所以注入层在 `document_start` 先建一个一次性探测 Worker：

- 探测通过 → 照常包装；
- 探测被拒 → 该文档里所有 Worker 走原生入口（页面不会坏），并回报 `csp-blocked`；
- 探测未完成（毫秒级窗口）→ 该次构造先走原生，宁可少伪装一次也不把页面弄坏。

回报经私有端口 → ISOLATED 桥 → 后台，按 hostname 聚合。用户可见的出口有两处：
弹窗会显示「本页 N 个 Worker 未能包装（页面 CSP 拒绝 blob 入口）」并说明这些 Worker 里是原生值；
诊断快照把 classic / module 标成 `degraded`（`coverage` 仍是 `supported`，`fallback` 字段带计数与原因），
不会混成 `ok`，也不会冒充 `unsupported`。

探测本身的代价写在这里，不藏：在 CSP 拒绝 blob 的站点上，每次文档加载都会多出一次被拒的
blob Worker 请求，页面的 `securitypolicyviolation` 监听或 CSP 上报端能看到它 —— 这类站点可以
由此推断"有东西在试探 blob Worker"。不探测的替代方案是让页面自己的 Worker 直接坏掉（CSP 站点
上必然发生），或者干脆不包装 Worker 却仍显示"已生效"，两者都更差，所以选探测 + 如实上报。

回归脚本：`npm run smoke:workers`（两个标签页连同一个 `(URL, name)`，用 connections 计数
区分"共享一个实例"与"各建一个"；另有一个 `?csp=1` 的页面专门验证 CSP 回退与上报）。

### 🛡️ 指纹检测站点

- [iprisk.top](https://iprisk.top/)
- [BrowserLeaks](https://browserleaks.com/)
- [IPLeak](https://ipleak.net/)
- [Device Info](https://www.deviceinfo.me/)

### 📚 文档

- [INSTALL.md](INSTALL.md) - 安装与排错
- [CONFIG_GUIDE.md](CONFIG_GUIDE.md) - 配置怎么做才自洽
- [RELEASE.md](RELEASE.md) - 发布流程与 CI

---

## English

<div align="center">
  <img src="images/banner-en.png" alt="VanishGeo" width="100%"/>
</div>

VanishGeo is a Chrome MV3 extension for environment **consistency**, not fingerprint
randomisation: one persona holds across the process environment, the request headers
and the page's JavaScript at the same time. Where a value cannot be reached, nothing
is patched.

### ✨ What it does

- 🕐 **Timezone** - `getTimezoneOffset`, `get*`, `set*`, `toString` and `Intl` move together, including the local-time semantics of `new Date(string)`
- 🌐 **Language** - `navigator.language`, `languages` (a frozen array) and the default `Intl` locale; `Accept-Language` is rewritten by DNR before the first request
- 🌍 **Geolocation** - coordinates, accuracy and an optional random offset (fixed for the session, no teleporting every 3 s); `Position` / `Coordinates` are rebuilt with WebIDL shape
- 🖋 **Canvas fonts** - three layers: **claimed platform** (mac / windows / linux, hides the other platforms' fonts), **CJK layer** (Chinese + vendor fonts) and a **manual list**; patches both `<canvas>` and `OffscreenCanvas`, with alias-aware name matching (`苹方-简`, `微软雅黑`)
- 🔒 **WebRTC** - `strict` / `compatible` / `default`, each mapping to a `contentSettings` policy
- 🛡 **Anti-detection** - native function signatures, prototype getters, zero own properties, zero `window` globals; when the native value is already correct, nothing is patched at all

### 🚀 Installation

**From a release**: download the latest `vanishgeo-v*.*.*.zip`, extract it, open
`chrome://extensions/`, enable Developer mode, click "Load unpacked" and pick the
extracted folder.

**From source**:

```bash
git clone https://github.com/XiNian-dada/VanishGeo.git
cd VanishGeo
npm install
npm run build        # runs typecheck too; output lands in dist/
```

`dist/` is the folder to load. Step-by-step notes in [INSTALL.md](INSTALL.md).

### 📖 Usage

In the popup:

- **Site rules** - one domain per line; `example.com` also covers its subdomains; **no wildcards**
- **Enable / exclude this site** - writes a rule for the current hostname and reloads only that site's tabs
- **Quick presets** - five built-in personas (Singapore / Japan / Germany / USA / China), manual coordinates and timezone, language and `Accept-Language`, font list
- **Configure from IP** - derives a self-consistent location and timezone from the exit IP

The full options page adds enable/disable/delete for each site rule and import/export
for custom personas.

#### Rule model

There is exactly one model: **per-domain rules**.

```
google.com          ← enabled: google.com and all of its subdomains
!mail.google.com    ← excluded: the longer rule wins, the site stays native
```

- Longest match wins: `google.com` enabled plus `mail.google.com` excluded means the
  mail host is not spoofed
- Excluded rules are kept; they no longer disappear after a save
- There are no global/whitelist/blacklist modes and no `*.example.com` or `*keyword*` wildcards

#### When changes take effect

| Change | How it applies |
| --- | --- |
| Timezone / language / geolocation / canvas | Pushed to every open tab immediately, **no reload** |
| Enable / exclude / delete a domain | Reloads only that domain's tabs |
| Exit IP changes | Followed by a 5-minute alarm; "retry location" forces it now |
| Action badge | Updates with location/config; turns red with `!` when failing closed |

### 🧱 Defaults

| Item | Default | Notes |
| --- | --- | --- |
| Language | `en-US` / `en-US,en;q=0.9` | Persona property, never derived from the host OS |
| Timezone | `auto` | Derived from the exit IP; only a persona card pins it |
| Geolocation | `auto` | Same |
| Default selected persona | `united-states` | Only pre-selects the profile in the options page |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| Canvas fonts | off | When on, replaces `targetFonts` |
| Site rules | 13 domains, all enabled | See `src/shared/default-domains.json` |

First install seeds the 13 default rules. Upgrading from the old `VanishMe` build
migrates its config through `convertVanishMeConfig`; older flat keys fall back to the
default rules.

### 🧪 Diagnostics

There is a single test page: right-click the toolbar icon → "Open diagnostic page"
(`leak-test/leak-test.html`).

- The top half shows the **expected** values from the current config
- "Probe selected tab" runs a probe in the target page's MAIN world and flags every
  failing row in red: `Intl` timezone, `Date` semantics (string dates, invalid dates,
  `setHours` round-trip), frozen `languages`, native `setHours.toString()`, own
  properties on `Coordinates`, `fonts.check`, canvas metrics
- The page itself runs on the extension origin, so its baseline section shows native
  browser values - use it for comparison only

Command line:

```bash
npm run typecheck     # types (tests included)
npm run lint          # ESLint
npm run verify        # lint + typecheck + test
npm test              # unit tests (312)
npm run test:coverage # unit tests + Node coverage report
npm run test:coverage:core # core-file branch gate (per file >= 85%)
# options / popup DOM tests drive real clicks and form events through jsdom
npm run build         # build
npm run setup:chrome119 # download/verify Chrome for Testing 119 (macOS arm64)
npm run audit         # static checks + three-engine E2E (Chrome 155 / 119 / Helium), prints a pass-rate table
npm run smoke:frames  # frame isolation (parent / child / about:blank / srcdoc)
npm run smoke:baked-failclosed  # baked geolocation fail-closed + reversible recovery + master-off clear
npm run smoke:baked-clear  # baked exclusion / master-off / frozen freeze behavior
npm run smoke:presets # five built-in presets browser E2E (language/timezone/header)
npm run smoke:cold-start # cold-start + clear browser smoke
npm run smoke:popup   # popup real clicks / storage / background-message smoke
node tools/native-parity.mjs  # Helium native-shape parity (83 checks, control vs patched)
```

### 🧱 Baked (persona) builds

```bash
node scripts/build-persona.mjs --persona=us-la-1               # -> ~/.vanishgeo/profiles/us-la-1/ext
node tools/chrome-env.mjs --persona=us-la-1 --setup-extension  # once, for Chrome
node tools/chrome-env.mjs --persona=us-la-1 --url=https://claude.ai
```

- The persona is baked into the injection layer at build time, live synchronously at `document_start`
- A **static** DNR ruleset ships in the manifest, so the very first request carries the right `Accept-Language`
- Baked domains are also declared as **static** `content_scripts` (`world: "MAIN"`,
  `document_start`, `all_frames`, `match_about_blank`), which closes the "dynamic registration misses the first renderer" gap
- Editing the language in the options page disables the static ruleset and hands over to dynamic rules
- The runtime bridge (ISOLATED → `MessagePort` → injection layer) defaults to **on** in baked builds; `--no-bridge` / `--frozen` disables it
- Frozen builds also read the baked config in the background: saving settings cannot change DNR or permissions, so page and headers cannot diverge

### 🔬 Measured behaviour

- `TZ` sets the timezone for every process (service worker included); `-AppleLanguages (en-US)`
  changes the ICU locale; `--lang` only changes `navigator.language`. When all three already
  match, the extension patches nothing
- Chrome 155 dropped `--load-extension`; Chrome 119 and Helium 156 still honour it (the audit uses that for the legacy engine)
- Chrome 119 has no CDP `Extensions.loadUnpacked`; the legacy engine is loaded with `--load-extension` and its id is discovered from extension targets
- A DNR `modifyHeaders` rule built with `regexFilter` aborts `main_frame` with `ERR_ABORTED`;
  the rules now use `requestDomains`, and unchanged rules are never rewritten
- A cold profile needs ~10 s before content scripts inject; a warm one is ready within 2 s
- Language and timezone are decoupled: if the auto timezone cannot resolve, language and
  `Accept-Language` still apply and only the timezone stays native
- Failing closed is never silent: red `!` badge, an explained popup and concrete `errors`
  from `getCurrentTabState`

### 🔧 Implementation notes

- **Three-layer consistency**: process environment / request headers (DNR) / page JS (MAIN-world prototype patches)
- **Signature table, not Proxy**: `Function.prototype.toString` returns
  `function setHours() { [native code] }`, with `name`/`length` matching the native arity table
- **WebIDL shape**: `GeolocationCoordinates` attributes are read-only prototype getters, instances carry no own properties
- **No invented signals**: `document.fonts.check` is left alone (the native one already returns `true` for system fonts)
- **Private channel**: payloads arrive through a `MessagePort` obtained by a `document_start` handshake; the page can neither observe nor forge them
- **Per-frame delivery**: payloads carry the exact `hostname` they were resolved for; the background uses `webNavigation.getAllFrames` to resolve and send each frame with its own `frameId`, so a parent payload cannot overwrite an independently-ruled child iframe, and a removed child rule still receives its own `clear`. Payload resolution is shared per URL and sends are capped at 8 concurrent IPC calls
- **BFCache restore re-pulls**: a page in BFCache is not re-injected and receives no new payload on its own. When `pageshow` fires with `event.persisted === true`, the bridge re-pulls for its own frame, so "config changed while frozen, stale value after restore" does not happen; a normal-load `pageshow` does not trigger an extra pull
- **Static first**: baked builds ship DNR rules and content scripts in the manifest, live on the first frame
- **Value first**: no patching when the native value is already correct

### 🛡️ Fingerprint test sites

- [iprisk.top](https://iprisk.top/)
- [BrowserLeaks](https://browserleaks.com/)
- [IPLeak](https://ipleak.net/)
- [Device Info](https://www.deviceinfo.me/)

### 📚 Docs

- [INSTALL.md](INSTALL.md) - installation and troubleshooting
- [CONFIG_GUIDE.md](CONFIG_GUIDE.md) - how to build a self-consistent config
- [RELEASE.md](RELEASE.md) - release process and CI