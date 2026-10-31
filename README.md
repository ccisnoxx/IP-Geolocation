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

- 🕐 **时区** - `getTimezoneOffset` / `get*` / `set*` / `toString` / `Intl` 全套跟着走，`new Date(str)` 的本地时间语义一并处理；`Temporal.Now`（`timeZoneId()` 与不带时区的 `*ISO()`）和 `document.lastModified` 同样按目标时区输出
- 🌐 **语言** - `navigator.language` / `languages`（冻结数组）/ `Intl`（含 `DurationFormat`）与 `Number` / `BigInt` / `String` 的默认 locale；请求头 `Accept-Language` 由 DNR 在首个请求前改写，既覆盖发往该站的请求，也覆盖该站页面发往 CDN / 接口等其它域名的子资源请求
- 🌍 **定位** - 坐标、精度、可选随机偏移（Rayleigh 分布、会话内固定，不会每 3 秒瞬移；上报精度覆盖实际偏移）；`watchPosition` 首帧即时、间隔 2.5–4.2s 逐帧重摇、坐标一变立刻推帧；`Position` / `Coordinates` 按 WebIDL 形状重建；静止读数自洽（`speed` 跟平台走：桌面 `null`、移动端 `0`；`heading: null`；不编 `altitude`）
- 🖋 **canvas 字体** - 三层结构：**平台层**（按本机真实平台判定，隐藏另外两个平台的字体）、**中文层**（中文与国产厂商字体）、**手动层**；覆盖 `<canvas>`、`OffscreenCanvas` 和 `window.queryLocalFonts()`（直接枚举本机字体那条路，实测 667 → 632 条），名字匹配含本地化别名（`苹方-简`、`微软雅黑`）
- 🔒 **WebRTC** - `strict` / `compatible` / `default` 三档，对应不同的 `contentSettings` 策略
- 🛡 **反检测** - 原生函数签名、原型 getter、零自有属性、零 `window` 全局；改不到的地方（原生值已经正确）一个对象都不动
- 🎨 **界面** - 两套固定面板：弹窗浅色玻璃、配置页深绿（诊断页深灰）。`color-scheme` 钉死，系统切成深色也照旧；没有双主题模式（`npm run smoke:theme` 在 light/dark 两档实测底色不变）

### 🚀 安装

**从 Release**：下载最新的 `vanishgeo-v*.*.*.zip` → 解压 → `chrome://extensions/` →
打开「开发者模式」→「加载已解压的扩展程序」→ 选解压出来的目录。

**从源码**：

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
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
- **快速配置** - 三个内置 persona 卡片（美西 (洛杉矶) / 新加坡 / 日本 —— 只留真的会买 VPS 的地区）、手动坐标与时区、语言与 `Accept-Language`、字体列表
- **从 IP 自动配置** - 点一下就把出口 IP 的坐标、时区、语言**写进当前配置**并立刻应用；查不到出口时按钮下面直接显示失败原因

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
| 出口 IP 变化 | 每 5 分钟（`chrome.alarms`）刷新定位；配置页的「跟随出口 IP」打开后，IP 变了才会改写时区/坐标 |
| 图标角标 | 随定位/配置刷新；fail-closed 时变红 `!` 并在弹窗给出原因 |

### 🧱 默认值

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 语言 | `en-US` / `en-US,en;q=0.9` | 语言是 persona 属性，不跟随系统 |
| 时区 | `auto` | 跟随出口 IP 推导；只有点了 persona 卡片才钉成固定值 |
| 定位 | `auto` | 同上 |
| 默认选中 persona | `us-west` | 只在配置页"当前配置"里预选，**不代表**时区已被钉住 |
| 跟随出口 IP（`ipSync`） | 关，周期 5 分钟 | 打开后出口 IP 一变就改写时区/坐标并清掉钉住的 persona；语言默认不跟随 |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| canvas 字体 | 关闭 | 打开后按 `targetFonts` 列表替换 |
| 域名规则 | 20 个，全部启用 | 13 个常用站 + 7 个检测站，见 `src/shared/default-domains.json` |

**首次安装**会把默认规则种进去。前 13 条是常用站（chatgpt.com、openai.com、claude.ai、
anthropic.com、gemini.google.com、copilot.microsoft.com、google.com、bing.com、x.com、
twitter.com、youtube.com、reddit.com、linkedin.com），后 7 条是**隐私检测站**
（browserleaks.com、ipleak.net、browserscan.net、deviceinfo.me、whoer.net、ipinfo.io、
iprisk.top）—— 装上就能直接打开自测，不用手动加域名。

**从旧版升级**时，`VanishMe` 老配置会被 `convertVanishMeConfig` 迁移，更早的扁平键
（`bpg_config` 之前的形态）走默认规则。**本仓库老版本存下来的配置**由
`migrateStoredConfig` 按 `schemaVersion` 补一次新内置项（检测站与 `us-west` 预设）：
存量用户不会因为"配置非空就原样保留"而错过新功能，而一旦存成当前版本，之后主动
删掉的内置项也不会被下一次读取复活。

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
npm test              # 单测（全部 tests/）
npm run test:coverage # 单测 + Node 覆盖率报告
npm run test:coverage:core # 核心文件分支覆盖率门禁（每文件 ≥ 85%）
npm run test:coverage:security # 安全模块分支覆盖率门禁（消息来源策略 / 函数伪装 / 补丁开关）
# options / popup 的 DOM 测试用 jsdom 驱动真实点击与表单事件
npm run build         # 构建
npm run setup:chrome119 # 下载/校验 Chrome for Testing 119（macOS arm64）
npm run audit         # 静态检查 + 三引擎 E2E（Chrome 155 / 119 / Helium），输出通过率表格
npm run smoke:frames  # frame 隔离（父域 / 子域 / about:blank / srcdoc）
npm run smoke:baked-failclosed  # 烘焙包定位 fail-closed + 可逆恢复 + 关总开关 clear
npm run smoke:baked-clear  # 烘焙包排除站点 / 关总开关 / frozen 冻结验证
npm run smoke:presets # 内置 preset 的浏览器 E2E：一张卡一个包，逐个验证语言/时区/请求头
npm run smoke:cold-start # 冷启动 + clear 浏览器 smoke
npm run smoke:popup   # popup 真实点击 / storage / 后台消息 smoke
npm run smoke:ipapply  # 「从 IP 自动配置」E2E：点一下真改坐标/时区/语言，失败必有提示
node tools/native-parity.mjs  # Helium 原生形状对拍（83 项，control vs patched）
```

`npm run audit` 里另含 `smoke:options` / `smoke:failclosed` / `smoke:frames` /
`smoke:baked-failclosed` / `smoke:baked-clear` / `smoke:fingerprint` / `smoke:ipchange` /
`smoke:real-site` 八组探针，具体见 [tools/README.md](tools/README.md)。

其中 `smoke:fingerprint` 除了三上下文（主线程 / iframe / Worker）的字体重度、canvas 像素、
时区语言与 WebRTC 候选，还会在真实页面里核一遍地理定位：坐标必须落在配置的随机半径内、
`accuracy` 必须覆盖实际位移、同一会话两次请求同一个点、返回对象不能多出自有属性。

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
- 刚装好的扩展要 50–220ms 才把静态 ruleset 的匹配索引建好（机器忙时更久）。这段属于**安装那一瞬间**，
  不属于页面首屏：多开几个 headless 并发跑时，装完立刻导航偶尔还会拿到原生 `Accept-Language`。
  所以 `smoke:cold-start` 先等规则生效、把等待时长打出来，再断言首屏 —— 拿掉这个等待，这条断言在 CI 上会随机变红
- 语言与时区**解耦**：`auto` 时区拿不到定位时，语言和 `Accept-Language` 照常生效，只有时区留在原生值
- fail-closed 不是静默：角标变红 `!`、弹窗显示原因、`getCurrentTabState` 返回具体 `errors`
- **定位 fail-closed**：命中规则且定位开启、但坐标解析不出来（auto 没拿到出口 IP / 手填值非法）时，
  `getCurrentPosition` 与 `watchPosition` 返回 `POSITION_UNAVAILABLE`（code 2），权限层同步置为
  `block`；不会落回原生定位。坐标解析出来后同一文档内自动切回伪装坐标，无需刷新

### 🔧 实现要点

- **watch 不像节拍器**：首帧不等心跳（真机第一次定位是几百毫秒内的事）；间隔逐帧在 2.5–4.2s 里重摇，量两帧间隔认不出固定节奏；坐标变了（保存配置、跟随出口 IP 落地）立刻推一帧，静止时不重复推；watch 期间配置变成"解析不出来"时报 code 2 并结束该路 watch，但 id 占位保留 —— 否则结束后 `clearWatch` 会转交给原生，而原生 id 是小的自增值，很容易误清站点自己的 watch
- **注入包必须零 import**：`dist/injected/runtime.js` 是 MAIN world 的经典脚本，产物里任何顶层 `import`/`export` 都是语法错误，而且失败是静默的（页面只是"没有任何补丁"）。所以注入层不 import `shared/*`，需要的逻辑内联；`vite.config.ts` 的 `injectedClassicScriptPlugin` 在产物上直接拦这一条（2026-10-29 踩过：注入层 import 了 `shared/config-model`，Rollup 拆出 `import '../assets/config-model-xxx.js'`，浏览器 smoke 直挂）

- **三层一致**：进程环境 / 请求头（DNR）/ 页面 JS（MAIN world 原型补丁）
- **签名表，不是 Proxy**：`Function.prototype.toString` 输出
  `function setHours() { [native code] }` 且 `name`/`length` 与原生 arity 表一致
- **反射形状对齐**：替换物的 own keys、属性描述符、可构造性和内建同形 ——
  `methodShaped()` 产出的是**方法**（自有 `length`/`name`，没有 `prototype`，`new` 抛
  `TypeError`），所以 `Object.getOwnPropertyNames(Function.prototype.toString)`
  仍是 `['length','name']`；注入层与 Worker blob 都是显式 strict，否则 V8 会给普通
  函数补上 sloppy 才有的自有 `arguments`/`caller`。`disguise()` 也是惰性的：原生值
  已经等于目标值时不动 `Function.prototype.toString`
- **尺度的边界（照实写）**：目标是主要 Web API 的行为与常见描述符一致，而不是承诺
  所有 JavaScript 反射结果与内建逐位相同；`npm run audit:parity` 在真浏览器里逐项比对
  控制组与打了补丁的一侧，覆盖 own keys / symbols / descriptors / IsConstructor
- **WebIDL 形状**：`GeolocationCoordinates` 的属性是原型上的只读 getter，实例零自有属性
- **不造假信号**：不接管 `document.fonts.check`（原生对系统字体本来就返回 `true`）
- **消息桥在 `document_start` 同步握手**：ISOLATED 桥先挂监听，注入层随后同步派发携带私有
  `MessagePort` 的事件，此时页面还没有任何脚本执行过，端口不经过页面可见的通道；注入层不监听任何
  window 事件，页面没有入口构造握手或推送配置。后台也不再向已打开的标签页晚注入注入层 ——
  晚注入时页面脚本已在运行，实测页面可借它改写或清除伪装 —— 所以扩展装载前已打开的标签页要刷新后才生效。
  构建 nonce 仍随发行包公开，只作消息标识。剩余边界：注入层缺席的文档里，页面可以向桥塞入自己的端口，
  读到本 frame 的 payload 并伪造两类诊断回报，但拿不到注入层的控制入口。
  研究、PoC 与验证记录见 [消息桥安全记录](REVIEW-P1-BRIDGE.md)。
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
| classic / module Worker | ✅ 或 ⚠️ | blob 前缀包装入口，Date / navigator / canvas 与主线程同源，Intl 覆盖同一组九类构造器（DateTimeFormat / NumberFormat / Collator / RelativeTimeFormat / PluralRules / ListFormat / DisplayNames / Segmenter / DurationFormat），`Temporal.Now` 的默认时区与 Number / String 的默认 locale 也同步。配置**活更新**：入口里保留的是一份 `live` 快照，配置变化时主线程向已创建的 Worker 广播一次，关闭补丁会广播空配置让 Worker 回到原生值（只影响经由包装构造器创建、且被登记的 Worker）。每个文档先探一次 blob 是否被 CSP 放行：被拒时全部走原生入口，此时标 ⚠️ 并在弹窗里明说 |
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

回报经 MessagePort → ISOLATED 桥 → 后台，按 hostname 聚合，属于未独立验证的页面侧报告。
弹窗会显示「同域页面报告 N 次 Worker 包装失败」并提示可能回退原生值；
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

### 🧭 还能做（按性价比排序）

- **`speed` 与平台绑定**（2.4 已做）：桌面 `null`（平台不提供速度）、移动端 `0`（能提供且静止）；判不出来的平台按桌面给 `null`
- **`lastGeoError` 上前台**（2.4 已做）：失败时配置页「全局设置」里多一张琥珀色卡片 —— 人话解释在外、接口原文折进「技术原因」、带「多久之前」，可一键清除；成功定位会自动清掉它
- **watch 的「移动」故事**：想给非 null 的 `heading` 就得让坐标帧间漂移几十米，那会破坏"会话内固定"这条更重要的防线，暂不做（`heading` 保持 `null` 是规范要求，不是省事）

### 📚 文档

- [INSTALL.md](INSTALL.md) - 安装与排错
- [CONFIG_GUIDE.md](CONFIG_GUIDE.md) - 配置怎么做才自洽
- [RELEASE.md](RELEASE.md) - 发布流程与 CI

### 👥 贡献者

本项目由 [@ccisnoxx](https://github.com/ccisnoxx) 独立开发与维护。

历史里的旧提交保留了原作者署名（`XiNian-dada`）：那是 MIT 许可要求的事实，
不是漏改。上游 VanishMe 的完整署名与许可原文在 [NOTICE](NOTICE) / [LICENSE](LICENSE)，
这两份文件不能动。GitHub 侧栏的 Contributors 是按提交作者自动生成的，所以它
会同时列出这两个名字 —— 想让它只显示一个人，只能改写历史（见
[RELEASE.md](RELEASE.md) 的「作者信息」一节）。

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

- 🕐 **Timezone** - `getTimezoneOffset`, `get*`, `set*`, `toString` and `Intl` move together, including the local-time semantics of `new Date(string)`; `Temporal.Now` (`timeZoneId()` and zone-less `*ISO()`) and `document.lastModified` follow the target zone too
- 🌐 **Language** - `navigator.language`, `languages` (a frozen array) and the default locale of `Intl` (including `DurationFormat`), `Number`, `BigInt` and `String`; `Accept-Language` is rewritten by DNR before the first request, both for requests to the site and for the site's own subresource requests to CDNs, APIs and other domains
- 🌍 **Geolocation** - coordinates, accuracy and an optional random offset (fixed for the session, no teleporting every 3 s); `Position` / `Coordinates` are rebuilt with WebIDL shape; a still device reports what its platform really reports (`speed: null` on desktop, `0` on mobile)
- 🖋 **Canvas fonts** - three layers: **claimed platform** (mac / windows / linux, hides the other platforms' fonts), **CJK layer** (Chinese + vendor fonts) and a **manual list**; patches both `<canvas>` and `OffscreenCanvas`, with alias-aware name matching (`苹方-简`, `微软雅黑`)
- 🔒 **WebRTC** - `strict` / `compatible` / `default`, each mapping to a `contentSettings` policy
- 🛡 **Anti-detection** - native function signatures, prototype getters, zero own properties, zero `window` globals; when the native value is already correct, nothing is patched at all
- 🎨 **Interface** - two fixed panels: a light glass popup and a dark green settings page (the diagnostic page is dark grey). `color-scheme` is pinned, so a dark OS does not repaint them; there is no dual-theme mode

### 🚀 Installation

**From a release**: download the latest `vanishgeo-v*.*.*.zip`, extract it, open
`chrome://extensions/`, enable Developer mode, click "Load unpacked" and pick the
extracted folder.

**From source**:

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
cd VanishGeo
npm install
npm run build        # runs typecheck too; output lands in dist/
```

`dist/` is the folder to load. Step-by-step notes in [INSTALL.md](INSTALL.md).

### 📖 Usage

In the popup:

- **Site rules** - one domain per line; `example.com` also covers its subdomains; **no wildcards**
- **Enable / exclude this site** - writes a rule for the current hostname and reloads only that site's tabs
- **Quick presets** - three built-in personas (US West / Singapore / Japan — only the regions people actually rent VPS in), manual coordinates and timezone, language and `Accept-Language`, font list
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
| Default selected persona | `us-west` | Only pre-selects the profile in the options page |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| Canvas fonts | off | When on, replaces `targetFonts` |
| Site rules | 20 domains, all enabled | 13 common sites + 7 privacy test sites, see `src/shared/default-domains.json` |

First install seeds all 20 default rules — 13 common sites plus 7 privacy test sites
(browserleaks.com, ipleak.net, browserscan.net, deviceinfo.me, whoer.net, ipinfo.io,
iprisk.top), so a fresh install can be self-tested without adding any domain by hand.

Upgrading from the old `VanishMe` build migrates its config through
`convertVanishMeConfig`; older flat keys fall back to the default rules. Configs saved
by an **older build of this repo** are backfilled once by `migrateStoredConfig` based on
`schemaVersion`, so upgrading users get the new built-ins too. Once the config is stored
at the current version, built-ins you delete stay deleted.

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
npm test              # unit tests (everything under tests/)
npm run test:coverage # unit tests + Node coverage report
npm run test:coverage:core # core-file branch gate (per file >= 85%)
npm run test:coverage:security # security-module branch gate (message policy / disguise / patch needs)
# options / popup DOM tests drive real clicks and form events through jsdom
npm run build         # build
npm run setup:chrome119 # download/verify Chrome for Testing 119 (macOS arm64)
npm run audit         # static checks + three-engine E2E (Chrome 155 / 119 / Helium), prints a pass-rate table
npm run smoke:frames  # frame isolation (parent / child / about:blank / srcdoc)
npm run smoke:baked-failclosed  # baked geolocation fail-closed + reversible recovery + master-off clear
npm run smoke:baked-clear  # baked exclusion / master-off / frozen freeze behavior
npm run smoke:presets # every built-in preset in a real browser (language/timezone/header)
npm run smoke:cold-start # cold-start + clear browser smoke
npm run smoke:popup   # popup real clicks / storage / background-message smoke
npm run smoke:ipapply  # "configure from exit IP" E2E: one click really rewrites geo/timezone/language, failures always surface
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
- A freshly installed extension needs 50–220 ms to finish building the static ruleset index (longer
  on a loaded machine). That is the *install* instant, not the page's first paint — under parallel
  headless runs the very first navigation can still carry the native `Accept-Language`. `smoke:cold-start`
  therefore waits for the rules to go live (and prints how long it took) before asserting first paint
- Language and timezone are decoupled: if the auto timezone cannot resolve, language and
  `Accept-Language` still apply and only the timezone stays native
- Failing closed is never silent: red `!` badge, an explained popup and concrete `errors`
  from `getCurrentTabState`

### 🔧 Implementation notes

- **Three-layer consistency**: process environment / request headers (DNR) / page JS (MAIN-world prototype patches)
- **Signature table, not Proxy**: `Function.prototype.toString` returns
  `function setHours() { [native code] }`, with `name`/`length` matching the native arity table
- **Reflection shape**: replacements match the builtin's own keys, descriptors and
  constructibility — `methodShaped()` yields a *method* (own `length`/`name`, no `prototype`,
  `new` throws `TypeError`), so `Object.getOwnPropertyNames(Function.prototype.toString)`
  stays `['length','name']`; the injected script and the Worker blob are both explicitly
  strict, otherwise V8 adds the sloppy-only own `arguments`/`caller`. `disguise()` is lazy:
  no touch to `Function.prototype.toString` while the native value already matches the target
- **Scope of that claim**: the goal is matching behaviour and common descriptors of the main
  Web APIs, not bit-identical reflection for every builtin. `npm run audit:parity` compares a
  control profile against a patched one in a real browser across own keys / symbols /
  descriptors / IsConstructor
- **WebIDL shape**: `GeolocationCoordinates` attributes are read-only prototype getters, instances carry no own properties
- **No invented signals**: `document.fonts.check` is left alone (the native one already returns `true` for system fonts)
- **Synchronous bridge handshake at `document_start`**: the ISOLATED bridge registers its listener first; the injection layer then synchronously dispatches an event carrying a private `MessagePort` before any page script has run, so the port never travels through a page-visible channel. The injection layer listens to no window events, leaving pages no way to forge a handshake or push configuration. The background no longer late-injects the injection layer into already-open tabs (pages could drive a late-injected copy, verified in a real browser), so tabs opened before the extension loaded need a reload. The build nonce remains public and is only a message tag. Residual edge: in a document without the injection layer, a page can hand the bridge its own port, read that frame's payload and forge the two diagnostic reports, but gains no control over the injection layer. See [the security review](REVIEW-P1-BRIDGE.md).
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

### 👥 Contributors

Built and maintained by [@ccisnoxx](https://github.com/ccisnoxx).

Older commits keep their original author (`XiNian-dada`) — that is what the MIT
licence requires us to preserve, not an oversight. Full upstream attribution for
VanishMe lives in [NOTICE](NOTICE) / [LICENSE](LICENSE), and those two files must
stay as they are. GitHub's sidebar "Contributors" list is generated from commit
authors, so it shows both names; making it show one requires rewriting history
(see the "作者信息" section in [RELEASE.md](RELEASE.md)).
