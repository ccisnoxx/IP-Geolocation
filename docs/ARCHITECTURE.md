# VanishGeo 实现说明

面向想了解"它是怎么做到的、做不到什么"的读者。安装与使用见 [README](../README.md)，
配置怎么调见 [CONFIG_GUIDE](../CONFIG_GUIDE.md)，开发与测试命令见 [DEVELOPMENT](DEVELOPMENT.md)。

## 一、三层一致

同一个 persona 要在三层同时成立，改不到的地方宁可不改：

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 进程环境 | 浏览器启动参数 / 系统设置（扩展做不到，见[第八节](#八实测结论)） | ICU locale、界面语言、语音列表 |
| 请求头 | DNR `modifyHeaders` 改写 `Accept-Language` | 发往启用站点的请求，以及这些站点页面发往 CDN、接口等其它域名的子资源请求 |
| 页面 JS | MAIN world 原型补丁（`dist/injected/runtime.js`） | 时区、语言、定位、canvas 字体、Worker / Worklet |

原生值已经等于目标值时，对应的补丁不安装。

## 二、配置怎么进到页面：三种首屏模式

注入层由注册的内容脚本在 `document_start` 装进每个命中规则的文档（含 about:blank / srcdoc / blob / data
子框架），配置的来源决定页面**第一个内联脚本**读到什么：

| 模式 | 配置来源 | 首个内联脚本读到 | 适用 |
| --- | --- | --- | --- |
| 普通（`contentScripts`） | 后台经 ISOLATED 桥异步送达 | 原生值，随后才变成目标值 | 默认 |
| 用户脚本（`userScripts`） | 保存配置时把"配置 + 注入层"注册为 MAIN world 用户脚本 | 目标值 | 打开「允许用户脚本」，Chrome / Helium 120+ |
| 烘焙（`baked`） | 构建期编进注入层的常量 | 目标值 | `npm run release` / `build:persona` 出的包 |

**用户脚本模式**（`src/background/user-scripts.ts`）：

- 用户脚本没有 `matchOriginAsFallback`，注入不到 about:blank / srcdoc / blob / data，所以内容脚本照常注册，
  同一 http(s) 文档里会有两份注入层。用户脚本那份首屏按快照打补丁，再带口令同步"认领"；内容脚本那份
  收到第一份可信配置时核对口令，一致就休眠并把后续配置转发过去，不一致就自己应用
- 开关关掉或浏览器不支持时没有认领，自动回到普通模式；正确性不依赖后台及时察觉开关变化
- 后台在定时任务（5 分钟）与打开弹窗时对齐一次用户脚本；对齐排队执行、内容没变不重写
- 认领通道的设计约束与剩余边界见 [消息桥安全记录](reviews/REVIEW-P1-BRIDGE.md) 最后一节

**烘焙构建**额外把 DNR 规则集与内容脚本写进 manifest（静态声明），首个请求就带正确的
`Accept-Language`；选项页改了语言会禁用静态规则集、交给动态规则。`--no-bridge` / `--frozen` 关掉桥后，
后台也只读烘焙配置，保存不会改 DNR 或权限，避免页面与请求头各说各话。

## 三、消息桥

- **`document_start` 同步握手**：ISOLATED 桥先挂监听，注入层随后同步派发携带私有 `MessagePort` 的事件，
  此时页面还没有任何脚本执行过，端口不经过页面可见的通道。注入层不从 window 事件接受配置
- **不晚注入**：后台不向已打开的标签页补注入注入层 —— 晚注入时页面脚本已在运行，实测页面可借它改写或清除伪装。
  所以扩展装载前已打开的标签页要刷新后才生效
- **按 frame 投递**：payload 带解析时的精确 `hostname`；后台用 `webNavigation.getAllFrames` 为每个 frame
  单独算规则并带 `frameId` 下发，父页不会覆盖独立子域 iframe。同一 URL 的解析结果复用，投递最多 8 个并发
- **BFCache 恢复会重拉**：`pageshow` 且 `event.persisted === true` 时桥按本 frame 的规则重拉一次。
  改语言要重写 DNR 规则，Chromium 的任何 DNR 写入都会驱逐 BFCache，而前台页面的文档仍是旧请求头加载的，
  所以检测到请求头值变化时会主动重载命中该域名的已打开页面；只改时区不写 DNR、也不重载
- 剩余边界：注入层缺席的文档里，页面可以向桥塞入自己的端口，读到本 frame 的 payload 并伪造两类诊断回报，
  但拿不到注入层的控制入口。研究、PoC 与验证记录见 [消息桥安全记录](reviews/REVIEW-P1-BRIDGE.md)

## 四、补丁的形状

- **签名表，不是 Proxy**：`Function.prototype.toString` 输出 `function setHours() { [native code] }`，
  `name` / `length` 与原生 arity 表一致；补丁函数在错误的 `this`、`new` 调用等非正常调用下抛出与原生一致的错误
- **反射形状对齐**：`methodShaped()` 产出的是**方法**（自有 `length` / `name`，没有 `prototype`，`new` 抛
  `TypeError`）；注入层与 Worker blob 都是显式 strict，避免 V8 补上 sloppy 才有的 `arguments` / `caller`。
  `disguise()` 是惰性的：原生值已经等于目标值时不动 `Function.prototype.toString`
- **调用栈不暴露扩展**：注入层与用户脚本末尾带 `//# sourceURL=<anonymous>`，调用栈里不出现 `chrome-extension://<id>`
- **WebIDL 形状**：`GeolocationCoordinates` 的属性是原型上的只读 getter，实例零自有属性
- **不造假信号**：不接管 `document.fonts.check`（原生对系统字体本来就返回 `true`）
- **尺度的边界**：目标是主要 Web API 的行为与常见描述符一致，不承诺所有反射结果与内建逐位相同；
  `npm run audit:parity` 在真浏览器里逐项比对控制组与打了补丁的一侧
- **注入包必须零 import**：`runtime.js` 是 MAIN world 经典脚本，产物里任何顶层 `import` / `export` 都是语法错误，
  而且失败是静默的。注入层不 import `shared/*`，`vite.config.ts` 的 `injectedClassicScriptPlugin` 在产物上拦截

## 五、定位

- 坐标、精度、可选随机偏移（Rayleigh 分布、会话内固定；上报精度覆盖实际偏移）
- `watchPosition` 首帧即时、间隔 2.5–4.2s 逐帧重摇、坐标一变立刻推帧，静止时不重复推；
  watch 期间配置变成"解析不出来"时报 code 2 并结束该路 watch，但 id 占位保留，避免 `clearWatch` 误清站点自己的 watch
- 静止读数自洽：`speed` 跟平台走（桌面 `null`、移动端 `0`），`heading: null`，不编 `altitude`
- **fail-closed**：命中规则且定位开启、但坐标解析不出来时，`getCurrentPosition` / `watchPosition` 返回
  `POSITION_UNAVAILABLE`（code 2），权限层同步置为 `block`，不落回原生定位；坐标解析出来后同一文档内自动恢复。
  角标变红 `!`、弹窗给出原因

## 六、canvas 字体的边界

字体伪装改的是 canvas 里的**族名解析**：`measureText` 量出来的宽度与 `fillText` / `strokeText` 落下的像素
走同一条回落路径（只改前者会"量出来缺失、画出来真实"，互相印证出矛盾）。因此：

1. DOM / CSS 那条路测不到：`getBoundingClientRect()`、SVG 文字尺寸不受影响
2. 系统 CJK 兜底字体依然存在：`72px monospace` 量中文仍会落到 PingFang，这是机器有中文字体的事实
3. `document.fonts.check()` 对没装的字体名也返回 `true`，是原生行为，不构成差异信号
4. `window.queryLocalFonts()` 会直接枚举本机字体，这一层按同一把键过滤（实测 667 → 632 条）

## 七、Worker 与 Worklet 覆盖

声明与 `src/shared/worker-coverage.ts` 同源：

| 上下文 | 覆盖 | 说明 |
| --- | --- | --- |
| classic / module Worker | ✅ 或 ⚠️ | blob 前缀包装入口，Date / navigator / canvas / Intl / Temporal 与主线程同源；配置活更新，关闭补丁时广播空配置。页面 CSP 拒绝 blob 时走原生入口并标 ⚠️ |
| nested Worker | ✅ 或 ⚠️ | 父 Worker 里的 `Worker` 同样换成带补丁的入口，配置逐层转发；父 Worker 回退原生时它也是原生 |
| Worklet（Audio / Paint / Animation） | ✅ 或 ⚠️ | `addModule` 换成「补丁模块 + 原模块」入口；没有消息通道，拿到的是创建时的配置快照。SharedStorage worklet 不包装 |
| SharedWorker | ❌ | 不包装：身份是 `(resolved URL, name)`，换成 blob URL 会破坏跨文档共享语义 |
| Service Worker | ❌ | 没有 hook `navigator.serviceWorker.register` |

**包装失败是可见的**：Chrome 在 CSP 拒绝 blob 入口时不抛错，只在稍后触发 error 事件。所以注入层在
`document_start` 先建一个一次性探测 Worker：通过则包装；被拒则该文档所有 Worker 走原生入口并回报
`csp-blocked`，弹窗显示「同域页面报告 N 次 Worker 包装失败」；探测未完成的毫秒级窗口内先走原生。
代价照实写：CSP 拒绝 blob 的站点每次加载会多一次被拒的 blob 请求，页面的 CSP 上报能看到它。

## 八、实测结论

- 进程级：`TZ` 改时区（含 Service Worker），`-AppleLanguages (en-US)` 改 ICU locale；`--lang` 只改
  `navigator.language`，不改 ICU。三者都对时扩展一个原生对象都不改。macOS 上也可以在「系统设置 → 通用 →
  语言与地区 → 应用程序」里单独给浏览器指定语言，解决表单校验提示与语音列表的语言
- Chrome 155 起移除了 `--load-extension`；Chrome 119 与 Helium 仍支持（审计用它测老引擎）
- DNR `modifyHeaders` 用 `regexFilter` 会把 `main_frame` 打成 `ERR_ABORTED`，已改用 `requestDomains`；
  重写动态规则会打断进行中的请求，所以规则没变就不重写
- 冷 profile 首次启动约 10s 后内容脚本才就绪；同一 profile 第二次启动 2s 内就绪
- 刚装好的扩展要 50–220ms 才建好静态规则集索引，属于安装瞬间、不属于页面首屏
- 语言与时区解耦：`auto` 时区拿不到定位时，语言和 `Accept-Language` 照常生效，只有时区留在原生值
- 用户脚本执行顺序（Chrome 156 / Helium 实测）：ISOLATED 桥 → 动态注册的 MAIN 内容脚本 → 用户脚本 → 页面第一个脚本；
  页面 CSP 不影响 MAIN world 用户脚本
