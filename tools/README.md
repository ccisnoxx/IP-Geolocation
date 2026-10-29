## 跨上下文指纹一致性（P2）

```bash
npm run smoke:fingerprint                                     # 烘焙 persona 构建
npm run smoke:fingerprint -- --extension=<ext> --canvas-spoof   # 顺手打开字体伪装再测
# 除指纹一致性外还在页面里验地理定位：偏移 ≤ 随机半径、accuracy ≥ 位移、
# 会话内两次请求同一个点、Position/Coordinates 原型与自有属性干净；
# watchPosition 首帧不等心跳、帧间隔 2.5–4.2s 且逐帧抖动、静止时每帧同一个点；
# 静止读数自洽：speed 跟平台（桌面 null / 移动端 0）、heading=null、altitude=null
```

同一个页面里同时量主线程 / 同源 iframe / Worker，比对字体度量、`document.fonts.check`、
canvas 像素 hash、时区语言，再看 WebRTC 候选里有没有真实 IP：

```
✓ 字体度量：主线程与 iframe 一致         56.45 vs 56.45
✓ 字体 check：主线程与 iframe 一致        true vs true
✓ 字体度量：主线程与 Worker 一致           56.45 vs 56.45
✓ canvas：主线程与 iframe 像素一致        2055581638 vs 2055581638
✓ Worker 时区与主线程一致                 America/Los_Angeles vs America/Los_Angeles
✓ Worker 语言与主线程一致                 en-US vs en-US
✓ WebRTC 没有暴露真实 IP                  0 个候选
7/7 通过（Chrome / Helium 都是）
```

结论：

- **Worker 的时区/语言是跟得上的**：`installWorker()` 会把补丁 `toString` 后塞进 blob
  再 `importScripts`，所以 `Intl` 在 Worker 里同样被改写。
- **canvas 像素主线程与 iframe 一致**；`OffscreenCanvas`（Worker）与 DOM canvas 的像素
  **本来就不一样**（渲染路径不同，裸浏览器同样如此），所以判据只要求"同一家族内一致"。
- **WebRTC 没有泄漏**：`webRtc.globalMode = strict` 下 `disable_non_proxied_udp` 生效，
  Chrome 和 Helium 都是 0 个候选（`--` 没有 `.local`），不需要再额外关 mDNS。

字体伪装（`canvas.enabled`）现在是**真能生效**的，而且三处一致：

```
补丁    字体度量 SimSun=38.53 monospace=38.53 · check(SimSun)=false · 已生效
✓ 字体度量：主线程与 iframe 一致     38.53 vs 38.53
✓ 字体 check：主线程与 iframe 一致    false vs false
✓ 字体度量：主线程与 Worker 一致       38.53 vs 38.53   ← Worker 里走 OffscreenCanvas 补丁
```

修的是两处：

1. **Worker 侧原本没有任何字体补丁**，页面只要开个 Worker 量一下宽度就能看出主线程被动过。
   现在 `workerPatch` 会把同一份目标字体表带进去，补 `OffscreenCanvasRenderingContext2D`
   的 `measureText` / `fillText` / `strokeText`；`fonts.check` 不接管（原生对系统字体本来就返回 true）。
2. **persona 构建原本关着消息通道**（`bridge: false`），烘焙值写死在 bundle 里，选项页的改动
   （包括字体伪装开关）对注入层完全没有影响——开关是个死开关。现在 persona 构建默认
   `bridge: on`，烘焙值只当初始状态；想要"完全冻结"就 `--no-bridge`。

注意：canvas 侧的三条路径（量宽度 + 填充 + 描边）已经对齐，但 `FontFace local()`、
DOM/CSS 布局和 SVG 文字尺寸仍然够不到，所以它能否骗过目标站点，取决于对方是否只用
canvas 探测。

## frame 隔离（动态 payload 投递）

```bash
npm run smoke:frames                                              # 默认 dist
npm run smoke:frames -- --extension=/path/to/ext                  # 烘焙包
```

fixture 在 `fixtures/iframe/`，端口由页面自身决定，不依赖固定的 8765：

- 顶层 `localhost` 用父域规则；
- `child.localhost` 有独立子域规则，不能被父页 payload 覆盖；
- 父域规则删掉后，顶层恢复原生，子域仍保持独立规则；
- 全删后，同源 / `srcdoc` / `about:blank` / 不匹配子域全部恢复原生。

单测另外覆盖嵌套不透明 frame 链、`blob:` / `data:`、`getAllFrames` 失败回退和
frame 投递并发上限（最多 8 个同时发送）。

## Worker 覆盖面（SharedWorker 不包装）

```bash
npm run smoke:workers                                             # 默认 dist
npm run smoke:workers -- --extension=/path/to/ext                 # 烘焙包
```

fixture：`fixtures/workers/shared-counter.js` + `fixtures/workers/top.html`。
两个标签页各连一次**同名** `(脚本, name)`，用 `connections` 累加判断是不是同一个实例：

| 观测 | 包装时（改前实测） | 不包装（改后实测） |
|---|---|---|
| `workerUrl` | `blob:http://localhost:...` | `http://localhost:.../shared-counter.js` |
| 两个标签页 + 再连一次 | 1 / 1 / 1（各建一个） | 1 / 2 / 3（同一实例） |
| 时区 / 语言 | `Asia/Tokyo` / `ja-JP`（被伪装） | `Asia/Shanghai` / `zh-CN`（原生，符合声明） |

结论：SharedWorker 的身份是 `(resolved URL, name)`，换成 blob 入口就让每个文档各建
一个实例，跨文档共享语义消失且无法在 JS 层修回去 —— 所以它**不包装**，读到原生值。
classic / module Worker 继续包装（同一个工具里第一条断言守住它没被顺手删掉）。

覆盖面声明在 `src/shared/worker-coverage.ts`，诊断快照（`buildWorkerDiagnosticsSnapshot`）
和 `fixtures/workers/top.html` 都按它标注；UNSUPPORTED 的项即使探测成功也不显示成通过。

### CSP 拒绝 blob 的处理（同一工具内的 `?csp=1` 页面）

服务器对 `?csp=1` 的 HTML 只加一条 `worker-src 'self'`，所以同源脚本照常、blob 入口被拒。
真 Chrome 在这种拒绝下**不抛错**（`threw:false`，随后才 `error`），因此只靠 try/catch 会得到
"页面 Worker 直接坏掉 + 没有任何记录"。现在的行为：

```
✓ CSP 页面本身仍被伪装（顶层 payload 不受 worker-src 影响）
✓ CSP 拒绝 blob 后 Worker 仍能跑（回退原生入口，不是直接坏掉）
✓ 回退后的 Worker 读到原生值（明确知道它没被接管）    zh-CN/Asia/Shanghai
✓ 包装失败被上报到后台（弹窗/诊断因此能显示）          count=3 reasons=[csp-blocked]
```

上报走私有端口 → ISOLATED 桥 → 后台，按 hostname 聚合，弹窗显示「本页 N 个 Worker 未能包装」，
诊断快照把 classic / module 标成 `degraded`。断言用 `getWorkerFallbacks` 读，不依赖弹窗 DOM。

### blob 探测的开销（`probe:cost`）

探测要回答"当前文档能不能开 blob Worker"，代价是每个文档一次 `new Worker(blob:)`。三个数都由
`npm run probe:cost` 实测（30 个 iframe，共 31 个文档；`--frames=60` 可改规模）：

```text
| 模式                | 探测 Worker 数 | navigation duration |
| 无扩展              | 0              | 50ms                |
| 有扩展（含探测）    | 31             | 89ms                |
| 有扩展（探测已短路）| 0              | 88ms                |

探测的系统开销: 1ms / 31 个文档
CSP 站点上 Worker 包装延迟: p50=43.4ms p95=57.2ms max=59.2ms（n=30）
每个文档的 CSP 违规数: 1
```

读法：

- **每文档恰好 1 个**探测 Worker（31 文档 → 31 个 target），与 iframe 数线性；"探测已短路"的对照组
  是把 `dist/injected/runtime.js` 里那段 probe 删掉后重新加载，用来隔离探测本身的影响。
- 首屏几乎不受影响：89ms vs 88ms（每个文档 ≈0.03ms）。单次 `new Worker` + `terminate` 在主线程
  上只花 0.015ms（另做 100 次微基准），真正的成本是每个文档一次 worker 线程创建。
- **CSP 站点**：探测必然失败，每文档产生 1 条 `securitypolicyviolation`；`Worker` 全局要等探测
  出结果才会被换掉，实测窗口 p50 ≈ 43ms、p95 ≈ 57ms —— 这段时间内页面自己创建的 Worker 拿到的
  是原生实现（文档里写的"少覆盖，不是假通过"就是这条）。不接受这个窗口的话只剩两条路：不包装
  Worker，或对 CSP 站点放弃 blob 入口、只做经典脚本路径（后者会把 `type: 'module'` 的 Worker 也
  变成不受支持）。
- 探测在**非 CSP** 页面上不产生任何网络请求，也不留 DOM 痕迹；`blob:` 请求不出现在 Network 面板。

## BFCache 恢复

```bash
npm run smoke:bfcache                                            # 默认 dist
npm run smoke:bfcache -- --extension=/path/to/ext                # 烘焙包
```

fixture：`fixtures/bfcache/page.html` + `other.html`（刻意不挂 `unload` / `beforeunload`，
否则页面失去 BFCache 资格，用例会退化成"普通重新加载"）。同一标签页 A → B → `history.back()`，
页面自己记录 `pageshow.persisted`，所以"这次恢复确实来自 BFCache"是页面证实的。

```
✓ 场景1 A 从 BFCache 恢复（pageshow.persisted=true）   ← 也证明常开端口/新监听没把页面挡在缓存外
✓ 场景1 恢复后值不变（配置没动，不该被重启或清掉）
✓ 场景2 前台页面 B 立刻拿到新时区（广播链路正常）
✓ 场景2 A 仍然从 BFCache 恢复（改时区不把页面踢出缓存）
✓ 场景2 恢复后读到新时区（不是冻结前的旧值）
✓ 场景3 冻结期间排除站点：回到 A 是原生值（clear 不被旧 payload 挡住）
```

脚本会打印一个观察值（**不作为断言**）：冻结期间改**语言** → `persisted=false`。

原因查清了，是 DNR 写入本身，不是语义变化（Chromium 实测，同一个用例框架逐个变量跑）：

| 冻结期间做的动作 | 恢复时 `persisted` |
|---|---|
| 什么都不做 | `true` |
| 只改时区（不碰 DNR） | `true` |
| `updateDynamicRules` remove+add **同内容** | `false` |
| `updateDynamicRules` 改 Accept-Language 值 | `false` |
| `updateSessionRules` 首写一条规则 | `false` |
| `updateContentScripts` 原样重注册 | `true` |
| `updateEnabledRulesets` 空操作 | `true` |
| `setSiteConfig` 只改语言（产品路径） | `false` |

结论：**没有"只 updateDynamicRules 而不失效 BFCache"的 API 路径** —— 只要真的写入就驱逐，
连同内容重写都算。所以能做的只有两件事：不需要时**绝不写**（签名一致就跳过，
`tests/dnr.test.ts` 有状态替身盯着），以及把"改语言 = 页面重载一次"变成明确行为而不是副作用。

场景 4 就是这个行为的回归：

```
✓ 场景4 只改时区：前台页面不被重载（请求头没变）        marker 仍在
✓ 场景4 改语言：前台页面被重载（文档与 JS 值重新对齐）    marker 消失
✓ 场景4 重载后页面读到新语言                            en-US
✓ 场景4 重新加载的文档请求带新 Accept-Language          en-US,en;q=0.9
```

实现是「按域名比较请求头值」：只重载**值变了**的域名下的标签页；域名增删仍由
`reloadAffectedTabs` 负责，否则同一个标签页会被重载两次。首轮应用（安装 / SW 冷启动）不重载。

单测（`tests/content-bridge.test.ts`）覆盖触发条件本身：`persisted === true` 才重拉、
`persisted === false` 与 `undefined` 不重拉、`stop()` 后监听器摘掉且不再拉取。
**smoke 证明的是终态与 BFCache 没被破坏；"重拉到新值"与"排队消息在恢复时送达"两条路都产出
正确结果，脚本不区分它们 —— 触发条件的证明在单测里。**

## 烘焙 fail-closed（P1-5）

```bash
npm run smoke:baked-failclosed                                    # 默认 dist
npm run smoke:baked-failclosed -- --extension=/path/to/ext        # 烘焙包
```

在烘焙包里强制定位解析失败，确认三层说法一致：

- `getCurrentPosition` / `watchPosition` 返回 code 2；
- `navigator.permissions` 为 `denied`；
- `Accept-Language` 仍是配置语言；
- 补上明确坐标后页面无需重载即可恢复坐标与权限；
- 关总开关后烘焙静态脚本也收到 `clear`，语言/时区恢复原生。

## 烘焙 clear / frozen

```bash
npm run smoke:baked-clear
```

用 `fixture.localhost` 构建两个临时包：默认 bridge 包和 `--no-bridge` 的 frozen 包。

- **bridge 包**：禁用规则 / 关总开关后页面与请求头都恢复原生；重新启用后恢复烘焙值；刷新后静态脚本会再次注入，桥必须再次 clear。
- **frozen 包**：禁用规则 / 关总开关后页面和请求头都保持烘焙值；刷新后仍是烘焙值。后台也读烘焙配置，保存配置不会改 DNR / 权限，避免“页面烘焙值、请求头原生值”的撕裂。

**Service Worker 冷启动兜底**：内容桥拉 `getPayloadForUrl` 时 SW 可能还没醒，按 40ms → 24s
退避重试约 48 秒；如果是显式 `clear` 触发的拉取，重试耗尽仍会主动下发 `clear`，
保证排除站点 / 关总开关不会停在烘焙值上。普通首屏拉取失败只重试、不清除，避免把烘焙值
误清成原生。单测用短延迟注入覆盖了这两条路径。

## 静态检查（类型 / 单测 / 构建）

`npm run audit` 会先跑三项与引擎无关的检查，再跑浏览器矩阵：

```
▶ 静态 · 类型检查 … ✓  0.5s
▶ 静态 · 单元测试 … ✓ 312/312  1.0s
▶ 静态 · 构建 … ✓  0.3s
```

单独跑：`npm run audit -- --only=typecheck,unittest,build`（不要求浏览器在场）。
目的就是防止"改一处悄悄破坏契约"——类型、单测、构建任何一项红，整体退出码就是 1。
版本号同步也进了单测：`manifest.json` 的 version 必须等于 `package.json`，且不再是 `1.0.0`。

## 主题免疫（`smoke:theme`）

```bash
npm run build && npm run smoke:theme
npm run smoke:theme -- --extension=/path/to/ext
```

主题是**两套固定面板**，不是待统一的双主题：popup 浅色玻璃、options 深绿配置中心、
leak-test 深灰诊断页。这条脚本用 CDP 把 `prefers-color-scheme` 分别模拟成 light / dark，
断言三页的计算 `color-scheme` 与真实画出来的背景两档一致（系统外观带不跑它们），
再用 `matchMedia` 断言模拟确实生效（否则前两条是空转）。

实测一个反直觉的点：Chrome 的 `prefers-color-scheme` **不**受页面 `color-scheme`
影响——系统深色时，声明了 `color-scheme: light` 的弹窗里那条媒体查询照样报 dark。
所以 `color-scheme` 只管 UA 默认配色（控件、弹层、滚动条、光标），挡不住别人用
媒体查询写两套样式。这也是 `tests/theme.test.ts` 里禁掉 `prefers-color-scheme` 的原因。

## 一键从出口 IP 配置（手动档）

```bash
npm run build && npm run smoke:ipapply
```

同一套本地桩，但验的是按钮本身：在**真实弹窗页面**里点 `#getFromIP`，断言坐标/时区/
语言真的写进配置（`mode:'manual'`）、输入框立刻显示新值、按钮下面出现
`已按出口 IP … 配置：…`；桩切成查不到坐标时，状态行必须变成 error 并给出原因，
按钮要恢复可点。它同时守住两条回归线：`applyFromExitIp` 不许占用
`lastSyncedExitIp` 账本（那是自动跟随的），auto 档的输入框不许是空框
（空框正是当初"点了没反应"的观感来源）。

## 出口 IP 变化跟随（auto 模式）

```bash
npm run smoke:ipchange                                   # 用 auto 构建 dist
npm run smoke:ipchange -- --extension=/path/to/ext
```

### 跟随出口 IP（`smoke:ipfollow`）

```bash
npm run build && npm run smoke:ipfollow                          # 出口先日本、再美国
npm run smoke:ipfollow -- --site=https://example.com/            # 换一个检测站
npm run smoke:ipfollow -- --offline                              # 只跑扩展侧
```

和 `smoke:ipchange` 的区别：那个走 `manualUpdate`、只断言页面里的值；这个走真正的
`ipSync` 通道（`setSiteConfig` / `addDomainRule` / `checkExitIpSync`），并且在
**第三方指纹检测站**上读它自己的判定 —— 扩展可以在 background 里把配置改得很漂亮
而页面一个字节没变，只有让别人的页面自己算一遍才算数。

桩返回的 `country_code` 一定要带上：真实接口都给，但缺了它 `syncLanguage` 会静默
不生效（`src/background/ip-sync.ts` 里现在会从国名反推，见 `codeFromCountryName`）。
截图落在 `tools/out/ip-follow-*.png`。

把 `ipwho.is`（扩展的定位接口）映射到本地假服务，先返回洛杉矶，页面起来后把假出口
切成伦敦、触发一次 `manualUpdate`，再核对环境：

```
✓ 扩展首次定位来自出口 IP            {"timezone":"America/Los_Angeles",...}
✓ 阶段一：页面时区 = 出口 A          America/Los_Angeles offset=420
✓ 阶段一：请求头与页面语言一致        en-US,en;q=0.9 vs nav=en-US
✓ 切换出口后重新定位成功             "Europe/London"
✓ 已打开的页面无需重载就跟随          Europe/London      ← updateAllTabs 会重注入
✓ 阶段二：页面时区跟着出口变了        Europe/London offset=0
✓ 阶段二：UTC 偏移跟随时区            0 vs 0
✓ 阶段二：语言不跟着出口变（配置决定）  en-US / en-US
✓ 阶段二：请求头仍然与页面语言一致      en-US,en;q=0.9 vs nav=en-US
✓ 阶段二：toLocaleDateString 与 Intl 同源  1/1/1970 vs 1/1/1970
✓ storage 里的 lastLocation 已更新    Europe/London
11/11 通过（Chrome / Helium 都是）
```

两点结论：

- **跟随是实时的**：`updateGeolocation` 拿到新位置后 `updateAllTabs` 会把新 payload
  重新注入，已打开的页面不用重载就跟上了。
- **语言不跟随出口**：语言始终由配置决定（`en-US`），只有时区/定位跟着 IP 走。
  这是 P0 那次解耦的直接结果，也是更合理的画像。
- 烘焙 persona 构建是**固定画像**，不跟随（本来就是给"我要一直是洛杉矶"准备的）。

## 一条命令跑完全部验证

```bash
npm run audit                                    # 三引擎 × 十三路检查
npm run audit -- --engines=chrome119             # 只跑老引擎
npm run audit -- --engines=helium                # 只跑 Helium
npm run audit -- --only=options,failclosed       # 只跑指定项
npm run audit -- --only=frames,bakedfailclosed   # 只跑 frame / 烘焙 fail-closed
npm run audit -- --skip=realsite --verbose       # 跳过真实站点并打印子进程输出
npm run audit -- --no-build --timeout=300        # 不重建烘焙构建 / 单检查超时(秒)
```

```
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
│ 引擎       │ options 页端到端 │ 定位失败可见性 │ frame 隔离 │ 烘焙 fail-closed │ 烘焙 clear / frozen │ 原生模式自检 │ 真实站点一致性 │ auto 构建跟随 IP │ 出口变化跟随 │ 指纹一致性 │
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
│ Chrome 155 │ ✓ 9/9           │ ✓ 10/10       │ ✓ 19/19   │ ✓ 13/13         │ ✓ 21/21            │ n/a          │ ✓ 8/8         │ ✓ 8/8           │ ✓ 11/11     │ ✓ 10/10   │
│ Chrome 119 │ ✓ 9/9           │ ✓ 10/10       │ ✓ 19/19   │ ✓ 13/13         │ ✓ 21/21            │ ↻ 19/19     │ ✓ 8/8         │ ✓ 8/8           │ ✓ 11/11     │ ✓ 10/10   │
│ Helium 156 │ ✓ 9/9           │ ✓ 10/10       │ ✓ 19/19   │ ✓ 13/13         │ ✓ 21/21            │ ✓ 19/19     │ ✓ 8/8         │ ✓ 8/8           │ ✓ 11/11     │ ✓ 10/10   │
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

原有十组 368/368 项通过 · 32/32 组全绿。

新增三组：

| 引擎 | 5 preset 浏览器 E2E | 冷启动 / clear | popup 交互 |
| --- | --- | --- | --- |
| Chrome 155 | ✓ 5/5 | ✓ 6/6 | ✓ 4/4 |
| Chrome 119 | ✓ 5/5 | ✓ 6/6 | ✓ 4/4 |
| Helium 156 | ✓ 5/5 | ✓ 6/6 | ✓ 4/4 |

合计 **413/413** 项通过 · **41/41** 组全绿 · 用时 **485s**（1 组因引擎能力跳过）。
```

出口 IP 由 `tools/lib/exit.mjs` 统一查一次再分发给各组（重复查会被接口限流，导致时区判定被标 ⚠ 跳过）。
`auto 构建跟随 IP` 这一组用的是默认（非烘焙）构建 `dist`：时区必须由出口 IP 派生，
且**首帧请求头**必须与页面语言一致——P0 那个「请求头 zh-CN / 页面 en-US」的回归护栏。

有失败时退出码为 1，并打印每个失败组的前几行 `✗`/`Error`；全部通过退出码 0。
浏览器级 E2E 天生偶发，所以失败组会自动重跑一次（`--retries=0` 关掉，表格里 `↻` 表示重试后通过）；
每组之间留 1.5s 让上一轮的浏览器退干净。
`--engines`/`--only` 指到不存在的名字直接报错退出，不会静默空跑。

Chrome 119 用 `npm run setup:chrome119` 安装到 `~/.vanishgeo/browsers/chrome-119/`（macOS arm64，下载后校验 SHA256）；不存在时审计会自动跳过该引擎。
它没有 CDP `Extensions.loadUnpacked`，脚本用 `--load-extension` 启动并从 extension target 里取 id。
`.github/workflows/nightly.yml` 每天自动装 119 并跑 Chrome（以及 runner 自带 Chrome）矩阵；Helium 仍需本地安装。

三条工程约定（都是踩过的坑换来的）：

- **原生模式自检在 Chrome 155 上是 n/a**：Chrome 154+ 忽略 `--load-extension`，而"原生模式"
  的定义就是不开调试端口 → 装不上扩展，测不了。Chrome 119 和 Helium 仍支持 `--load-extension`，所以能测。
- **每项检查前清理残留浏览器**（`reapStrayBrowsers`，只匹配本工具的临时 profile 目录，
  绝不碰用户自己开着的窗口）。残留实例会抢 CPU，让后面的检查`Page.navigate`超时。
- **判定基准按构建种类分开**（2026-10-29 起）：`真实站点一致性` 默认 `--expect-tz=persona`
  （烘焙包的时区该等于 persona），`auto 构建跟随 IP` 传 `--expect-tz=ip`（裸 dist 的时区该等于
  出口 IP）。别混用 —— 拿 persona 去量 auto 构建会打出一串假红。
- **缺环境的检查降级，本地仍严格**：没有代理时「页面时区 == 出口 IP 时区」不成立（runner 出口
  在 `America/Chicago`、`America/New_York` 都见过），对不上时记 ⚠ 警告；`原生模式自检` 的
  geolocation 权限、`烘焙 fail-closed` 的「恢复坐标」在无人值守环境会被浏览器直接 deny，同样
  记 ⚠ 跳过而不是判错。两边一致、本机挂了代理、本机能授权时，一律照旧严格。
- **本地 HTTPS 证书必须带 SAN**：Chromium 只看 `subjectAltName`，缺 SAN 的证书会让主文档
  导航偶发卡在 handshake（`net_error -100`），表现为"页面永远加载不出来"。
  `tools/lib/certs.mjs` 会按 `--domain` 现生成并在缺失时自动补；SAN 覆盖 `claude.ai`
  及其子域，同时保留 `--ignore-certificate-errors` 兜底。

## 真实站点验证（跟随代理出口 IP）

```bash
npm run smoke:real-site                                        # https://claude.ai/signup
npm run smoke:real-site -- --url=https://claude.ai/login
npm run smoke:real-site -- --extension=/path/to/ext --persona=us-la-1
```

不映射域名、不改 DNS：打开真实注册页，核对「页面看到的值」是否跟着**当前出口 IP**。
启动时故意不传 `TZ`——这样时区只能是扩展给的，才测得到扩展本身。

实测（Helium 156 + `us-la-1`，出口 24.249.30.57 · US · Las Vegas）：

```
出口    24.249.30.57 · United States · Las Vegas · America/Los_Angeles
页面    tz=America/Los_Angeles offset=420 nav=en-US Intl=en-US html-lang=en
请求头  Accept-Language=en-US,en
8/8 通过
```

负向对照（换一个 `Europe/London` persona 构建）：`页面 Europe/London vs IP America/Los_Angeles`
立刻报错 —— 说明这个判定不是摆设。

两个坑：

- **只能用 HTTPS 的 IP 接口**：本机代理只接管 HTTPS，明文请求会看到本机真实出口
  （`ip-api.com` 免费版只有 HTTP，会给出 `China/Shanghai` 的错误结论）。
  接口全挂时退化成 Cloudflare trace（只有国家），此时时区判定标 ⚠ 跳过而不是误判失败。
- `document.body.innerText` 在离屏/被遮挡的窗口里恒为空。判断"内容到了"要用 `textContent`
  （实测 claude.ai/signup：`textContent=45034 字`，`innerText=0`）。

## 定位失败时的可见性（fail-closed 不等于静默）

`auto` 时区解析不出来时，语言与请求头照常生效，只有时区留在原生值（部分生效）。
这个「部分生效」的判定**不能不说**——用户会以为自己在受保护状态下注册账号。

现在三层可见：

| 层 | 表现 |
| --- | --- |
| 图标角标 | 白名单站点但没生效 → 红色 `!`，title 写原因；恢复后自动清空 |
| 弹窗 | 站点状态区出现红框告警 + 原因 + 「重试定位」按钮 |
| 数据 | `getCurrentTabState`（可带 `tabId`）返回 `payload.timezone=null` 与 `errors`，`storage.lastGeoError` 记录最后一次定位失败 |

```bash
npm run smoke:failclosed          # 断掉定位接口 → 角标 !、payload=null、弹窗告警、恢复后清空
CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" npm run smoke:failclosed
```

判定逻辑集中在 `src/shared/site-status.ts` 的 `describeSiteStatus()`（有单测），
角标刷新覆盖**所有标签页**：配置/定位变化后，后台开着的页面也不会留着过期的 `!`。

## 原生模式自检（无调试端口）

```bash
npm run audit:native                                            # Helium + 烘焙构建 + 真实域名映射
npm run audit:native -- --fresh --warmup=1                      # 全新 profile，1s 后开页面
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run audit:native
```

探针（`tools/probe` + `verify-env`）走 CDP，`navigator.webdriver` 恒为 `true`，CDP 的
Emulation 覆盖还会掩盖真实环境。这个自检反过来做：`--host-resolver-rules` 把域名指到本地
HTTPS 服务，页面自己跑完断言再 `POST /__report` 回来，全程**没有调试通道**。

当前 20 条断言（Helium 156 / 烘焙构建全绿）：

| 组 | 断言 |
| --- | --- |
| 自动化痕迹 | `navigator.webdriver === false`、UA 无 `HeadlessChrome` |
| 语言 | `navigator.language`、`navigator.languages[0]`、`Intl` 默认 locale 都是期望值；`Accept-Language` 头等于期望值且与 `navigator.language` 前缀一致 |
| 时区 | `Intl` 时区名、`getTimezoneOffset()`（按目标时区独立算期望值）、Worker 内 `Intl` 时区 |
| 一致性 | `toLocaleDateString()` 与 `Intl.DateTimeFormat().format()` 相同 |
| 网络 | WebRTC ICE 候选为空（无内网/公网 IP 泄漏） |
| 硬件/环境 | `platform=MacIntel`、screen ≥ 1000×…、`hardwareConcurrency`、plugins、PingFang 在 / MS Gothic 不在（宽度比对，不用 `document.fonts.check`——它对任意不存在的字体名都返回 true） |
| 权限 | geolocation 权限状态不是 `denied` |

坑：打开页面**不能**用 `open -a`（会把 URL 交给系统里已经在跑的那个浏览器实例），
必须带同一个 `--user-data-dir` 再启动一次，让 URL 转发给刚起的实例，才会带上
`--host-resolver-rules` / `--load-extension`。`chrome-env` 的首启保护同样按这个方式修正了。

## 冷启动保护（--warmup）

新 profile 第一次启动时，未打包扩展要 ~10s 才加载完；这个窗口内的在途导航会被浏览器
直接取消（Helium 156 实测 `net::ERR_ABORTED`，服务端 0 请求）。`chrome-env` 于是先开
`about:blank`，等扩展就绪再打开目标 URL：

```bash
node tools/chrome-env.mjs --persona=us-la-1 --url=https://claude.ai
# 冷启动保护：新 profile + 扩展，先等 12s 再打开 https://claude.ai
node tools/chrome-env.mjs --persona=us-la-1 --warmup=0      # 关掉（热 profile 默认就不启用）
```

判定依据是 `<profile>/Default/Preferences` 是否存在：全新 profile 才等 12s，之后每次启动
直接开页面（实测热启动 2s 就绪）。只对原生模式生效，headless/CDP 模式不启用。

## 冷启动窗口内保存（storage 与 DNR 必须一致）

```bash
npm run smoke:cold-save     # 3 轮，每轮全新 profile
```

盯的是这条链路：`bootstrap()` 先读配置、后应用副作用，两次之间用户可能已经保存。旧实现的
风险是"读到的旧快照在保存之后被应用回去" —— storage 里是用户配置，DNR 规则与 payload 却是
默认值，界面上还写着"已保存"。同一类问题还有两处：慢读返回的旧快照会被写进内存缓存
（之后每次读都停在保存前），以及首次运行的种子写入可能把用户配置直接盖掉。

现在的实现有三道防线：

| 防线 | 位置 | 作用 |
|---|---|---|
| 应用串行化 | `applyConfig` 的 promise 链 | 两次并发应用不会交错写 DNR / 内容脚本 / payload |
| 代际守卫 | `getStorageSnapshot` / `getLastLocation` | 慢读返回时若期间被失效过，不写缓存 |
| 种子守卫 | `getSiteConfig` 的首次运行分支 | 只在"读到的确实是当前存储"时落种子，避免覆盖用户配置 |
| 应用时重读 | `bootstrap` 不传快照 | 旧快照没有机会在保存之后被应用 |

诚实说明：最初观察到的失败率是 3 轮里 2 轮（DNR 停在 13 条默认域名、值 `en-US`）。但现在把
四处修复**全部撤掉**再跑，3/3 仍然一致 —— 说明当时的失败依赖机器时序（新 profile 首次编译
扩展更慢），这个 smoke 复现不稳，不能当作"回归必失败"的证据。它保留的意义是**终态断言**：
冷启动窗口内保存之后，storage 与 DNR 必须一致。缓存守卫本身有确定性单测
（`tests/injection-idempotency.test.ts`，撤掉守卫即失败）。

## options 页端到端冒烟

```bash
npm run smoke:options                                        # 默认 Chrome
CHROME_PATH="/Applications/Helium.app/Contents/MacOS/Helium" npm run smoke:options
node tools/smoke-options.mjs --extension=dist-probe-geo --language=de-DE --domain=example.org
```

真的点选项页的「保存当前配置」，再从 Service Worker 侧核对：

| 断言 | 期望 |
| --- | --- |
| 烘焙构建起步 | `enabledRulesets=["baked-language"]`、动态 DNR 0、动态脚本 0 |
| 改语言（`#language` + `#languages` + `#acceptLanguage` → 保存） | 静态 ruleset 被禁用（`[]`）、动态规则重写成新语言 |
| 加域名（`#ruleList` 追加一行 → 保存） | 新域名出现在 `getRegisteredContentScripts()` 的 match 里、动态 DNR 多一条、继承当前语言 |
| 打开「跟随出口 IP」 | 配置落库、`vanishgeo-exit-ip` 定时器周期跟表单一致、状态行如实说上次同步结果 |
| 写入一次定位失败 | 配置页出现「上次自动定位没成功」卡片：人话解释里没有接口原文、原文折在「技术原因」里、带「多久之前」、点「清除提示」后 storage 两个 key 一起清空 |

注意：保存成功会 `alert('设置已保存')`，原生弹窗会卡住 `Runtime.evaluate`，脚本里已经
挂了 `Page.javascriptDialogOpening` 自动确认。

# 环境一致性工具（tools/）

用于回答一个问题：**页面到底能看见什么**。不猜，跑数据。

## 四条命令

```bash
# 1) 对比三种「让时区/语言跟随 IP」的做法，看哪种在页面里是原生的
node tools/verify-env.mjs --frameHost=localhost

# 2) 把默认构建（运行时通道开着）的 VanishGeo 载进来做 A/B
node tools/verify-env.mjs --mode=extension --extension=dist --frameHost=localhost

# 3) persona 构建：默认直接产出到 ~/.vanishgeo/profiles/<persona>/ext
node scripts/build-persona.mjs --persona=us-la-1            # 域名默认取 src/shared/default-domains.json
node tools/verify-env.mjs --mode=extension --extension=dist-probe-geo --frameHost=localhost --no-seed

# 4) 首次在这个 profile 里装一次扩展（Chrome 155 已忽略 --load-extension）
node tools/chrome-env.mjs --persona=us-la-1 --setup-extension

# 5) 日常启动：TZ + -AppleLanguages 让整条进程链原生正确，扩展只负责"定义"
node tools/chrome-env.mjs --persona=us-la-1 --url=https://claude.ai
node tools/chrome-env.mjs --persona=us-la-1 --check     # 体检并退出
```

`--setup-extension` 会把扩展目录放进剪贴板、把开发者模式预先写进 profile，
然后打开 `chrome://extensions`——只剩一次「加载已解压的扩展程序」的点击。
装完之后启动器能自己认出来（按路径派生的扩展 ID 判断，`--check` 里会显示
`extension 已安装 <id>` / `未安装 → --setup-extension`）。

`--frameHost=localhost` 很关键：顶层页在 `127.0.0.1`、iframe 在 `localhost`，
两个 host 不同 → 只有把 iframe 的域名也写进规则里，注入才会覆盖到它。
这正好复刻 `claude.ai` 与 `challenges.cloudflare.com`（Turnstile）的跨源关系。

`--no-seed` 用于 persona 构建：跳过 storage 播种，直接验证"烘焙配置自己起作用"。
`--native-env` 给进程加上 `TZ` 和 `-AppleLanguages`（等价于 persona 启动器），
用来验证"扩展在场但一个补丁都不打"的状态。

## 烘焙构建附带静态 content_scripts

烘焙域名除了写进 DNR 规则集，还写进 manifest 的静态 `content_scripts`
（`world: "MAIN"`、`document_start`、`allFrames`）。原因：动态
`registerContentScripts` 在 Helium（Chromium 156）上会漏掉**会话里的第一次导航**——
浏览器起来后打开的第一个页面不注入，第二个才正常。静态脚本在渲染进程创建时就绑定，没有这个窗口。

- 烘焙域名由静态脚本负责，`registerSpoofContentScripts` 只补注册**不在烘焙清单里**的域名
  （所以用户在选项页新增域名照样生效，也不会重复注入）
- 冷 profile（第一次启动）实测注入要等 ~10s 才就绪：2s/3.5s/5s/7s/8s 都漏，12s 成功；
  同一个 profile 第二次启动 2s 内就绪。第一次用新 profile 时，打开的第一个页面建议刷新一次
- 通道关闭的构建（`bridge: off`）不会额外注入隔离世界的桥接脚本

## 烘焙构建附带静态 DNR 规则集

persona 构建会把语言规则**同时**写进 manifest 的静态 ruleset：

```
manifest.json  →  "declarative_net_request": { "rule_resources": [{ "id": "baked-language", ... }] }
rules/baked-language.json  →  modifyHeaders / requestDomains
```

静态规则在第一条请求之前就已生效，不依赖 Service Worker 启动 —— 启动后立刻打开的第一个页面
也会带正确的 `Accept-Language`，不再有"SW 还没播种完"的空窗。

- 配置与烘焙时一致 → 运行时完全不动动态规则（`getDynamicRules()` 保持 0 条）
- 选项页改了语言配置 → 自动 `updateEnabledRulesets({ disableRulesetIds: ['baked-language'] })`，
  禁用静态规则集并改由动态规则接管
- 普通构建（没有 `persona.config.json`）不产出规则集，manifest 原样不动

## Helium（Chromium 156 分支）

Helium 0.20.1.1 / Chromium 156.0.8078.47 上实测：

- **CDP 全通**：`--remote-debugging-port` + `Extensions.loadUnpacked` + 我们的探针都能跑。
  `CHROME_PATH=/Applications/Helium.app/Contents/MacOS/Helium node tools/verify-env.mjs ...` 直接可用。
- **`--load-extension` 在 Helium 上仍然有效**（Chrome 155 已经移除），所以 Helium 不需要
  `--setup-extension`，启动器带上 `profiles/<persona>/ext` 即可。
- **`TZ` + `-AppleLanguages` 同样生效**：SW 也能拿到 LA / en-US。
- **`regexFilter` + `modifyHeaders` 会把 main_frame 打成 `ERR_ABORTED`**（请求根本没发出去）。
  规则已改成 `requestDomains`。另外重写动态规则会打断进行中的请求，所以规则没变就不重写。
- **Helium 不暴露 `chrome.userScripts`**（`typeof chrome.userScripts === 'undefined'`）。
  任何依赖 `userScripts` 注入的旧构建在这里完全不会动。

`--load-extension` 在 Chrome 155 上已经被彻底移除：带上它扩展不会加载
（访问 `chrome-extension://<id>/` 直接是 `ERR_BLOCKED`），
`--disable-features=DisableLoadExtensionCommandLineSwitch` 也救不回来。
所以自动化测量走 CDP 的 `Extensions.loadUnpacked`，日常使用走"装一次，持久化"。

测异步通道的构建时要注意：SW 冷启动要几百毫秒，探针可能先跑完。`verify-env` 会等
payload 落地后重跑一遍探针，量的才是补丁质量；"首屏读到的值"单独看 `early.tz`。

## 实测结论（Chrome 155 / macOS 27.0.1）

旧构建（异步 postMessage 通道）留下的痕迹，以及修复后的对照：

| 痕迹 | 旧构建 | 现在（persona 构建） |
|---|---|---|
| 被替换的原生函数（`toString` 不是 `[native code]`） | **18** | 0 |
| 恒等关系破坏（`Date.prototype.constructor === Date` 等） | **10** | 0 |
| `Object.keys(window)` 泄漏（`__vanishGeo*`、Rollup 的 `var`） | **6** | 0 |
| `Object.prototype.toString.call(PermissionStatus)` | **`[object Object]`** | `[object PermissionStatus]`，且状态由 `contentSettings.location` 真正授予 |
| 首屏内联脚本读到的时区 | **Asia/Shanghai（真值）→ 之后变 LA** | America/Los_Angeles（一开始就是） |
| 跨源 iframe 时区 | **不一致** | 一致（把 iframe 域名写进规则） |
| `postMessage` 通道可被页面伪造改写 | **是**（固定 magic string） | 通道整个不存在 |
| Worker 内 `Intl` 时区 | **真值泄漏** | 与顶层一致，`Worker` 仍是 `[native code]` |
| Service Worker 的 tz / locale | 真值泄漏，且**页面侧打不了补丁** | 由 `TZ` + `-AppleLanguages` 从进程层解决（见下） |
| 定位回调时序（早于 `setTimeout(0)` 即为假） | **早于** | 与原生一致 |

三种"让环境跟随 IP"的做法，原生程度排序：

| 项目 | baseline | flags（TZ + --lang） | cdp（Emulation.*） | extension（persona 构建） |
|---|---|---|---|---|
| timeZone | Asia/Shanghai | America/Los_Angeles | America/Los_Angeles | America/Los_Angeles |
| Intl locale | zh-CN | **zh-CN（没跟上）** | en-US | en-US |
| navigator.language | zh-CN | en-US | en-US | en-US |
| 被替换的原生函数 | 0 | 0 | 0 | 0 |
| 恒等关系破坏 | 0 | 0 | 0 | 0 |
| window 泄漏 | 0 | 0 | 0 | 0 |
| 首屏内联脚本读到的时区 | Asia/Shanghai | America/Los_Angeles | America/Los_Angeles | America/Los_Angeles |
| navigator.webdriver | false | false | **true** | false |

五条硬结论：

1. **`TZ` 环境变量在 macOS 的 Chrome 上生效**，时区可以做到原生正确，不需要任何 JS 补丁。
2. **`--lang` 只改 `navigator.language`／`Accept-Language`，不改 `Intl` 的默认 locale**
   （`Intl.DateTimeFormat().resolvedOptions().locale` 仍是系统语言），所以走"纯原生"路线
   时 `Intl` 和 `navigator.language` 会互相矛盾；用扩展时必须把 `Intl` 也补齐。
3. **开 `--remote-debugging-port` 就会让 `navigator.webdriver === true`**（不需要 `--enable-automation`）。
   所有靠 CDP 下发覆盖的方案，都在页面上留了一个比时区不一致更响亮的标记。
4. **任何"运行时通道"方案（异步消息、`executeScript`）都晚于首屏内联脚本**：
   同一次加载里页面先读到真值再读到假值，这不是"伪装得不够像"，是当场自证矛盾。
   所以注册用的构建必须把配置**烘焙进注入层**（`scripts/build-persona.mjs`），
   `document_start` 同步生效。

5. **Service Worker 补不进补丁**：SW 的脚本 URL 决定它的 origin 和 scope，
   `register(blob:...)` / `data:` 都会被拒；扩展也没有任何 `document_start` 时机能改一个
   已存在的 SW 全局。实测：页面 `America/Los_Angeles` / SW `Asia/Shanghai`。
   唯一解法是把环境做成原生正确 —— `TZ` 管所有进程的时区，`-AppleLanguages (en-US)`
   管 ICU 默认 locale，两者都是进程级，SW 自然也一致。
   代价：`(en-US)` 会被 Chromium 当成位置参数开一个后台标签页（把这两项排在 URL 之后，
   真实页面仍在前景）；`-AppleLocale` 不需要，只加 `-AppleLanguages` 就够。

## 扩展什么时候不出手

`runtime.ts` 在模块加载的第一时间抓一份**原生快照**（`Intl` 的 timeZone/locale、
`navigator.language`），之后逐项比对：原生已经等于目标值的那一项就不打补丁。
所以在 `TZ` + `-AppleLanguages` 启动的 persona 浏览器里，扩展虽然加载着，
却是**零替换、零恒等破坏**——它只负责"定义目标值"，不负责"改环境"。

## 目录

- `lib/cdp.mjs`：极简 CDP 客户端 + Chrome 启动器（`debugPort:false` 时可完全不开调试端口）
- `probe/probe.js`：反检测探针，可直接粘到任意站点控制台执行 `await __runProbe('x')`
  覆盖：28 条原生函数路径、12 条恒等关系、window 全局扫描、时区/语言自洽、`Intl` 行为一致性、
  `PermissionStatus`、定位时序与标签、字体一致性、Worker 时区、跨源 iframe、postMessage 桥
- `probe/top.html`、`probe/frame.html`：跨源对照页（含首屏内联脚本的 early 读数）
- `verify-env.mjs`：本地双源服务器 + 多模式对比，`--extension` 载入扩展，`--no-seed` 跳过播种
- `chrome-env.mjs`：persona 启动器（`~/.vanishgeo/personas/*.json` + `profiles/*`）
- `fixtures/`：烘焙构建用的配置夹具
- `out/*.json`：每次跑的完整报告