# VanishGeo 配置指南

装好之后怎么配才不会自相矛盾。安装步骤见 [INSTALL.md](INSTALL.md)。

## 一、核心原则：一致性 > 精确性

大多数"被识别"不是因为值假，而是因为**几处值互相矛盾**：请求头说 `en-US`、页面说
`zh-CN`、时区是 `Asia/Shanghai`、坐标在洛杉矶。VanishGeo 的取舍是：

1. 同一个 persona 在**进程环境 / 请求头 / 页面 JS** 三层同时成立；
2. 改不到的地方（比如 Service Worker 里的内建 locale）宁可**保留原生值**，也不编一个假值；
3. 原生值已经是目标值时，**一个对象都不改** —— 这是最难被识别的状态。

所以配置的目标不是"看起来像某个国家"，而是"页面里所有能互相对照的值都指向同一个地方"。

## 二、时区：auto 还是手动钉死

| 模式 | 行为 | 什么时候用 |
| --- | --- | --- |
| `auto`（默认） | 按出口 IP 推导（每 5 分钟跟随一次）；推导不出来时**保持原生值**，不猜 | 代理出口会变（机场、轮换 IP） |
| 手动 | 固定使用你填的 IANA 时区 | 出口固定，或者要求与账单地址/手机号所在地区严格一致 |

要点：

- 手动模式下，时区必须和**出口 IP 所在地区**对得上。出口在美国却钉 `Asia/Singapore`，
  是最典型的自相矛盾。
- 手动填的是 IANA 名字（`America/Los_Angeles`、`Europe/Berlin`），不是 `UTC-7`。
  夏令时由系统处理，不要手算偏移。
- 时区一改，`Date` 的 `get*`/`set*`/`toString`/`Intl` 会一起跟着走；`new Date('2026-01-01T00:00:00')`
  这类**没有时区后缀**的字符串会被当成目标时区的本地时间解释，这是原生语义。

## 三、语言：三处必须同源

一次配置会同时影响三处：

1. 请求头 `Accept-Language`（由 DNR 在首个请求前改写，不等 Service Worker 启动）
2. `navigator.language` / `navigator.languages`（后者按 WebIDL 冻结，`push` 会抛错）
3. `Intl` 的默认 locale，以及 `Date.prototype.toLocaleString` 一族

规则：

- **主语言**（`language`）放在 `languages` 的第一位，避免出现 `navigator.language = en-US`
  但 `navigator.languages[0] = zh-CN` 这种组合
- `Accept-Language` 用标准 q 值格式：`en-US,en;q=0.9`
- 语言和时区是**解耦**的：`auto` 时区拿不到定位时，语言照常生效，只有时区留在原生值

## 四、定位

| 选项 | 行为 |
| --- | --- |
| 坐标 + 精度 | 页面拿到 `Position`，形状与原生一致（属性在原型上、实例无自有属性） |
| 随机偏移 | 以给定半径随机取点，**同一会话内固定**，不会每次调用都瞬移；换坐标才重摇 |
| 伪装权限（`spoofPermission`） | 开启：把定位权限伪装成已授权，直接给坐标；关闭：**只换坐标，不碰权限** —— 授权提示、错误码、超时全部交给浏览器，只在成功回调里替换坐标 |

配置建议：

- 坐标与出口 IP 所在城市一致；精度别填太小（1 米反而像模拟器），50–200 米比较常见
- 需要"移动感"就开随机偏移，半径 100–1000 米；半径 0 表示固定点
- 不想接管权限就关掉伪装权限 —— 这样"页面被拒绝定位"也是真实行为，不会与 `permissions.query` 打架

## 五、canvas 字体：三层结构

字体伪装不是一个开关，而是三层叠加。每层回答一个不同的问题，互不干扰：

| 层 | 字段 | 回答的问题 |
| --- | --- | --- |
| 平台层 | `canvas.platform` | 这台机器像不像某个平台 |
| 中文层 | `canvas.hideCjkFonts` | 这台机器有没有中文环境 |
| 手动层 | `canvas.targetFonts` | 我还要额外隐藏什么 |

三层取并集，按名字匹配（含 `苹方-简` / `微软雅黑` 这类本地化别名），命中即替换成
`monospace` 再量宽度。

### 平台层

`canvas.platform` 只有两个值：

- `auto`（默认）：按**本机真实平台**（`navigator.userAgentData.platform`），隐藏**另外两个**
  平台的字体。真 Mac 就藏 Windows / Linux 字体，真 Windows 就藏 mac / Linux 字体 ——
  装在哪台机器上，"别的平台的字体不存在"这条都自动成立
- `none`：关掉平台层，只留中文层与手动层

| 真实平台 | 隐藏 | 保留 |
| --- | --- | --- |
| `mac` | 微软雅黑 / 宋体 / Segoe UI / Ubuntu / DejaVu… | 苹方 / Hiragino / Songti / Helvetica Neue / Menlo |
| `windows` | 苹方 / Hiragino / Songti / Menlo / Ubuntu / DejaVu… | 微软雅黑 / 宋体 / Segoe UI / Consolas |
| `linux` | 苹方 / 微软雅黑 / Segoe UI / Helvetica Neue… | Ubuntu / DejaVu / Liberation / Cantarell |

这一层**不撒谎**：真 Mac 上量 `"SimSun"` 会回落到默认字体，naive 的检测脚本容易误判成
"装了宋体"，按等宽处理反而是在纠正误报。它只说清一件事——这台机器没有别的平台的字体。

> 早先版本允许手动选 `mac` / `windows` / `linux`，语义是"让这台机器看起来像另一台"。
> 那件事在 JS 层做不成（WebGL 渲染器、GPU、色深仍是真硬件），做了只会制造矛盾，
> 所以 v4 收窄成 `auto` / `none`；旧配置里的手动值一律按 `auto` 处理。

判据是"默认安装"：只收装系统就带着、别的系统默认没有的字体。Arial / Times New Roman /
Verdana 这类跨平台常见的不收 —— 把它们藏起来会让正常的机器看起来缺字体，反而更像被动过。

### 中文层

`hideCjkFonts`（默认开）与平台无关，收的是中文与国产厂商字体：简体、繁体、开源 CJK、
MiSans / MIUI / 鸿蒙黑体 / HONOR Sans / OPPO Sans / vivo Sans / 阿里巴巴普惠体 /
钉钉进步体 / 抖音美好体 / 汉仪旗黑 / 方正系列。

### 两个开关怎么组合

- **"一台没有中文字体的 mac"**：`platform=auto` + `hideCjkFonts=on`。
  苹方也被藏掉，检测方的中文行全部落空。代价是自相矛盾 —— 真 mac 有苹方，
  实际渲染中文仍然看得出系统 CJK 能力（见下面"做不到的事"）
- **"一台自洽的 mac"**：`platform=auto` + `hideCjkFonts=off`。
  苹方在，检测方的中文行会命中 —— 但那是事实，不命中反而不像 mac
- **"一台自洽的 Windows"**：在真 Windows 上 `platform=auto`。
  mac 自带字体全部消失，中文检测项里只剩 Windows 的字体名

### 手动层与默认值

`targetFonts` 是追加项，默认空。旧版本（schemaVersion ≤ 2）把整张中文表放在这里，
升级时会被搬进 `hideCjkFonts`，旧条目不会丢。

### 覆盖范围与做不到的事

- **两条路径都补**：`<canvas>` 与 `new OffscreenCanvas().getContext('2d')`。
  只补前者时，检测脚本一行就绕过了
- **不动渲染**：CSS 布局（`getBoundingClientRect`）、实际字形都不受影响
- **中文兜底存在性消不掉**：`72px monospace` 量中文仍会落到系统 CJK 字体
- **`document.fonts.check` 故意不接管，它也不是信号**：实测原生对
  `"NoSuchFontZzz123"` 这种随口编的名字同样返回 `true`（它测的是 FontFaceSet，
  不是系统字体安装情况）。改它反而会造出真机永远不出现的差异
- **隐藏项与真缺失逐字节同宽**：命中字体换成 `"__vg_absent__"` 这种必然不存在的
  族名，而不是 `monospace`。真机实测 16px 下 `MMMM`：monospace 38.53、
  sans-serif 56.45、不存在的族名 56.45 —— 填 monospace 会差 18px，一个对照组就能
  把"被藏了"和"真没有"分开
- **worker 里同一套规则**：主线程解析出最终列表后把键集合传给 Worker，
  两边不会说两套话

## 六、WebRTC

| 档位 | 底层策略 | 说明 |
| --- | --- | --- |
| `strict`（默认） | `disable_non_proxied_udp` | 只允许走代理的 UDP，最保守 |
| `compatible` | `default_public_interface_only` | 只暴露公网接口 |
| `default` | `default` | 不干预 |

改完在 <https://ipleak.net/> 看 WebRTC 段是否还出现真实 IP。

## 七、站点规则

只有一种模型：域名规则。

```
google.com          ← 启用：google.com 及其所有子域
!mail.google.com    ← 排除：更长的规则命中，整站保持原生值
```

- **最长匹配优先**：`google.com` 启用 + `mail.google.com` 排除 = 邮件站不伪装
- 排除规则会被保留，保存一次不会消失
- 没有通配符（`*.example.com` / `*keyword*` 都不支持），也没有全局/白名单/黑名单三模式
- 启用/排除/删除只重载**该域名**的标签页

## 八、常见误配清单

| 症状 | 原因 | 改法 |
| --- | --- | --- |
| 检测站说"时区与 IP 不符" | 手动时区与出口地区不一致 | 改 `auto`，或按出口城市填 IANA 时区 |
| 请求头是 `en-US`，页面是 `zh-CN` | 语言配置没启用/没保存 | 检查语言 `enabled` 与 `Accept-Language` |
| `navigator.languages` 第一位不是主语言 | 列表顺序和主语言不一致 | 把主语言放列表第一位 |
| 定位被拒绝但页面仍给出坐标 | 伪装权限开着，而真实权限是 `prompt`/`denied` | 关掉伪装权限，让权限流程回到浏览器 |
| WebRTC 泄漏真实 IP | 档位是 `default` | 改 `strict` |
| 坐标与 IP 城市差几千公里 | 手动坐标没跟着出口改 | 用「从 IP 自动配置」重新推一次 |
| 某些站点没有伪装 | 该域名不在规则里，或被更长的排除规则命中 | 弹窗「站点白名单」检查 |

## 九、配置体检：让配置自己先打一架

上面那张误配表是**经验**，体检把它变成**代码**：诊断页（`chrome-extension://<id>/leak-test/leak-test.html`）
的「配置体检」一节会实时算出你当前配置里的自相矛盾之处，能机械修的直接给按钮。

分三档，措辞刻意不同：

| 档位 | 含义 | 例子 |
| --- | --- | --- |
| **必错** | 浏览器原生保证不了的组合，一定是配错了 | `Accept-Language` 首选与 `navigator.language` 不同（Chrome 的请求头就是由 languages 拼的） |
| **可疑** | 大概率不是你的本意 | 时区填了但开关没开、坐标填了但定位没开、`targetFonts` 有内容但 canvas 关着、总开关关着却配了一堆 |
| **取舍** | 不一定是错，取决于你想讲哪个故事 | 时区在美国而语言是中文、藏了中文字体但语言还是 zh |

第三档刻意**不给一键修**：把「想让这台机器看起来在美国」和「只是想让时区不指向中国」
混成一件事才是真错误，选择权留给用户。文案里两面都写清楚。

几个具体的判据：

- **坐标 vs 时区**：用经度算太阳时（`longitude / 15`），与声明时区的真实偏移比，
  差超过 4 小时才报——中国横跨五个时区却统一用 `Asia/Shanghai`，容差给小了会误报
  （乌鲁木齐坐标比上海差 3 小时，属于政治时区，不算矛盾）
- **区域推导**：时区与语言各推一个区域（`CN` / `US` / `EU` / `JP`…），不同才提示，
  且只有两边都推得出来时才比——`Asia/Kathmandu` 这种推不出来就闭嘴
- **首选语言不在列表里**这条体检里**没有**：`normalizeLanguage` 会把它 unshift 到
  最前，这个状态存不下来。体检不该重复模型已经保证的事，那条保证由测试守着

实现是纯函数（`src/shared/config-audit.ts`），不碰 chrome API：输入配置，输出
`{ id, severity, title, detail, fix? }[]`。所以它既能给诊断页用，也能在测试里
直接断言「修完之后这条必须消失」。

## 十、首屏窗口：为什么开发构建有、烘焙构建没有

配置进到页面有两条路，区别只在**什么时候**生效：

| 构建 | 配置来源 | 生效时刻 | 页面首个内联脚本读到 |
|---|---|---|---|
| `npm run build`（开发） | `chrome.storage.local`，经 `sendMessage` 取回 | 异步，一次 IPC 往返 | **原生值** |
| `build:persona` / `--config`（烘焙） | 编译进 `injected/runtime.js` 的常量 | `document_start` 同步 | 目标值 |

实测（本机 Helium，出口 Las Vegas，目标 `America/Los_Angeles` / `en-US`）：

```
开发构建  __first = { tz: "Asia/Shanghai", lang: "zh-CN", offset: -480 }   ← 窗口
烘焙构建  __first = { tz: "America/Los_Angeles", lang: "en-US", offset: 420 }
```

原因是硬性的：`document_start` 注入的脚本确实在页面脚本之前跑，但配置要经
`chrome.runtime.sendMessage` 或 `chrome.storage` 才拿到，**任何异步 API 都输给解析器**——
HTML 已经缓冲好时，首个内联脚本紧接着就执行。所以开发构建的窗口关不掉，只能换路径。

### 想要零窗口：导出 + 烘焙（一条命令）

1. 选项页 →「数据管理」→**导出烘焙配置（首屏零窗口）** → 得到 `vanishgeo-bake.json`
2. 构建：

```bash
npm run build:persona -- --config=~/Downloads/vanishgeo-bake.json --out=dist-baked
```

3. `chrome://extensions` → 加载已解压的扩展程序 → 选 `dist-baked`

烘焙只是**初始值**：之后在选项页里改语言/时区/字体，照样实时生效（走消息通道）。
要连消息通道都不要、彻底冻结，加 `--no-bridge`。

### 什么时候可以不管这个窗口

检测脚本通常在 `DOMContentLoaded` 之后才跑，那时 payload 早已落地，开发构建也一致。
只有"在 `<head>` 里同步读 `Intl` / `new Date()` 并把结果立刻上报"的站点才能看到差异。

## 十一、验证

1. 右键扩展图标 →「Open diagnostic page」
2. 「当前配置」区域对照期望值
3. 探针里那几行**不该变红**：`languages` 冻结、`setHours.toString()` 原生签名、
   `Coordinates` 自有属性数为 0、`new Date()` 自有属性数为 0
4. 到 <https://browserleaks.com/> 与 <https://ipleak.net/> 各看一遍时区、语言、WebRTC