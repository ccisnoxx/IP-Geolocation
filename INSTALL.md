# VanishGeo 安装指南

面向"第一次装上并确认它在工作"的场景。配置怎么调见 [CONFIG_GUIDE.md](CONFIG_GUIDE.md)，
从源码开发见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 环境要求

- Chrome 119+ 或同内核浏览器（Edge / Brave / Helium 等）
- 首屏即生效（用户脚本模式）需要 Chrome / Helium 120+
- 从源码构建需要 Node.js 22+

## 一、安装

### 方式 A：从 Release 安装（推荐）

1. 在 [Releases](https://github.com/ccisnoxx/VanishGeo/releases) 下载最新的 `vanishgeo-v*.*.*.zip`
2. 解压到一个固定目录（解压后应能看到 `manifest.json`；之后不要删除或移动这个目录）
3. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`），打开右上角「开发者模式」
4. 点「加载已解压的扩展程序」，选中**含 `manifest.json` 的那一层目录**

> 选错层是最常见的失败原因：选中了解压目录的上一层，扩展会提示找不到 manifest。

### 方式 B：从源码构建

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
cd VanishGeo
npm install
npm run build
```

加载构建产物 `dist/`，不是仓库根目录。

### 打开「允许用户脚本」（推荐）

不打开也能用，但网页最前面的脚本会先读到真实时区与语言，配置在页面开始运行后才送到。打开后首屏就是目标值：

1. `chrome://extensions/` → VanishGeo「详情」→ 打开「允许用户脚本」
   （Chrome 138 起是每个扩展单独的开关；更早的版本只要打开「开发者模式」）
2. 刷新已经打开的网页

开关没开时，弹窗顶部会提示，点「去开启」直接跳到扩展详情页。

## 二、确认它在工作

### 1. 诊断页

先打开一个启用了规则的网页（默认规则里有 `chatgpt.com`、`google.com` 等），再右键工具栏图标 →
「Open diagnostic page」：

- **站点实测**：自动检测本窗口最近用过的网页，先给结论（N 项一致 / M 项不一致），
  再按时区、语言、定位、WebRTC 列出"期望 / 网页实际"
- **配置体检**：配置本身有矛盾时在这里列出，能机械修的直接给按钮

诊断页本身是扩展页面，不受伪装；「高级」里的本页原生值只作对比。

### 2. 在网页控制台里看

```js
Intl.DateTimeFormat().resolvedOptions().timeZone   // 配置里的时区（auto 时是出口 IP 所在时区）
navigator.language                                 // 配置里的语言
Date.prototype.setHours.toString()                 // "function setHours() { [native code] }"
```

再在开发者工具的 Network 里看任意请求的 `Accept-Language` 是否与语言一致。

### 3. 外部检测站

- <https://iprisk.top/>
- <https://browserleaks.com/>
- <https://ipleak.net/>

## 三、常见问题

### 页面没有任何变化

- 确认当前站点**在规则里且是启用状态**（弹窗「站点白名单」或完整配置页），总开关没关
- **扩展装载之前就打开的标签页需要刷新一次**：注入只发生在页面加载时，不会补注入到已打开的页面

### 网页最前面的脚本读到的是真实值

普通模式下配置是异步送达的。打开「允许用户脚本」（见上文），或使用烘焙构建，
原理见 [CONFIG_GUIDE 第十节](CONFIG_GUIDE.md#十首屏窗口三种模式)。

### 改了配置但页面没变

| 改了什么 | 生效方式 |
| --- | --- |
| 时区 / 语言 / 定位 / canvas | 已开标签页会收到推送，不用刷新；改语言时命中的页面会自动重载，让请求头与页面一致 |
| 启用 / 排除 / 删除域名 | 该域名的标签页会自动重载 |

还是不对就去扩展页点一下「刷新」（↻）再刷新网页 —— 通常是 Service Worker 卡住了。

### 角标显示红色 `!`

fail-closed：定位或配置没拿到，扩展**不会**用半套值糊过去。弹窗里会写明原因，点「重试定位」；
持续失败时检查代理与定位接口是否可达。

### 时区一直是原生值

`auto` 模式需要拿到出口 IP 的定位。定位接口被代理挡住或超时时，时区留在原生值，
语言与 `Accept-Language` 照常生效。想钉死就手动填时区与坐标，或点一张 persona 卡片。

### 构建失败

```bash
node -v              # 需要 22+
npm run typecheck    # 先看类型错误
rm -rf node_modules && npm ci
```

## 四、卸载

`chrome://extensions/` → 找到 VanishGeo →「移除」。配置随之清空；想保留先在完整配置页导出。
