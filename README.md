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

VanishGeo 是一个 Chrome MV3 扩展（Chrome 119+，Edge / Brave / Helium 等同内核浏览器可用）。
它不做"随机化指纹"，做的是**一致性**：同一个 persona 在请求头与页面 JS 里同时成立，改不到的地方宁可不改。

### ✨ 功能

- 🕐 **时区** - `Date` 全套方法、`Intl`、`Temporal.Now`、`document.lastModified` 一起跟着目标时区走
- 🌐 **语言** - `navigator.language` / `languages`、`Intl` 与各类 `toLocaleString` 的默认 locale；`Accept-Language`
  在首个请求前改写，包括站点页面发往 CDN、接口等其它域名的请求
- 🌍 **定位** - 坐标、精度、会话内固定的随机偏移；`watchPosition` 的节奏与静止读数像真机；拿不到坐标时
  返回"位置不可用"，不会落回真实定位
- 🖋 **canvas 字体** - 按平台、中文字体、手动列表三层隐藏字体，覆盖 `<canvas>`、`OffscreenCanvas` 与 `queryLocalFonts()`
- 🔒 **WebRTC** - `strict` / `compatible` / `default` 三档策略
- 🧵 **Worker / Worklet** - 普通 Worker、嵌套 Worker、Audio / Paint / Animation Worklet 与主线程一致
- 🛡 **反检测** - 补丁函数的签名、形状、报错与原生一致；原生值已经正确时不打补丁
- ⚡ **首屏即生效** - 打开「允许用户脚本」后，网页最前面的脚本读到的就是目标值
- 🧭 **从出口 IP 配置** - 一键按出口 IP 填好时区、坐标与语言；可选「跟随出口 IP」，换出口自动跟着改
- 🩺 **诊断页** - 在目标网页里实测并与期望值逐项对比，配置体检指出自相矛盾的地方

### 🚀 安装

1. 在 [Releases](https://github.com/ccisnoxx/VanishGeo/releases) 下载最新的 `vanishgeo-v*.*.*.zip`，解压到固定目录
2. 打开 `chrome://extensions/` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选解压出来的目录
3. **推荐**：在 VanishGeo 的「详情」里打开「允许用户脚本」（Chrome / Helium 120+；Chrome 138 之前是「开发者模式」），
   然后刷新网页。这样网页最前面的脚本也读到目标值；不打开也能用，只是配置在页面开始运行后才送到。
   没打开时弹窗会提示并给出「去开启」按钮

扩展装载前就打开的标签页需要刷新一次才会生效。从源码构建与排错见 [INSTALL.md](INSTALL.md)。

### 📖 使用

打开弹窗：

- **启用本站 / 排除本站** - 给当前域名写一条规则，只重载这个域名的标签页
- **站点白名单** - 每行一个域名，`example.com` 自动包含子域名；**不支持通配符**
- **快速配置** - 内置 persona（美西 (洛杉矶) / 新加坡 / 日本）、手动坐标与时区、语言与 `Accept-Language`、字体
- **从 IP 自动配置** - 把出口 IP 的坐标、时区、语言写进当前配置并立即应用；失败时直接显示原因

完整配置页（弹窗内「打开完整配置」）另有：站点规则的启用 / 禁用 / 删除、「跟随出口 IP」、
自定义 persona 的保存 / 导入 / 导出、导出烘焙配置、数据重置。

#### 规则模型

只有一种模型：**域名规则**。

```
google.com          ← 启用：google.com 及其所有子域
!mail.google.com    ← 排除：命中更长的这条规则，整站保持原生值
```

- 最长匹配优先：`google.com` 启用 + `mail.google.com` 排除，访问 `mail.google.com` 就是不伪装
- 没有"全局/白名单/黑名单"三模式，也没有 `*.example.com`、`*keyword*` 这类通配符

#### 改动什么时候生效

| 改了什么 | 生效方式 |
| --- | --- |
| 时区 / 定位 / canvas | 立即推给已开标签页，**不用刷新** |
| 语言 | 立即推送；请求头随之改变，命中的已开页面会自动重载一次，让文档与页面值一致 |
| 启用 / 排除 / 删除某域名 | 只重载**该域名**的标签页 |
| 出口 IP | 每 5 分钟刷新一次定位；打开「跟随出口 IP」后，出口变了才改写时区与坐标 |
| 图标角标 | 拿不到定位等无法生效的情况变红 `!`，弹窗给出原因 |

### 🧱 默认值

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 语言 | `en-US` / `en-US,en;q=0.9` | 语言是 persona 属性，不跟随系统 |
| 时区 / 定位 | `auto` | 跟随出口 IP 推导；点了 persona 卡片才钉成固定值 |
| 跟随出口 IP | 关 | 打开后出口一变就改写时区与坐标；语言默认不跟随 |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| canvas 字体 | 关 | |
| 域名规则 | 20 个 | 13 个常用站 + 7 个隐私检测站，见 `src/shared/default-domains.json` |

默认规则里的 7 个检测站（browserleaks.com、ipleak.net、browserscan.net、deviceinfo.me、whoer.net、ipinfo.io、
iprisk.top）装上就能直接自测。从旧版 `VanishMe` 升级时老配置会自动迁移。

### 🩺 诊断页

先打开一个启用了规则的网页，再右键扩展图标 →「Open diagnostic page」：

- **站点实测**：在网页里读取实际值，与该站点规则算出的期望值逐项对比，先给结论再分组列出
- **配置体检**：配置里的自相矛盾（例如请求头与页面语言不同、坐标与时区差几千公里），能机械修的直接给按钮

定位只在网页已获授权时读取，不会弹授权框；WebRTC 在网页里测，扩展页面自身不受伪装，只作对比。

### ⚠️ 做不到的事

- 浏览器界面语言、表单校验提示、语音列表（`speechSynthesis.getVoices()`）由浏览器进程决定，扩展改不了；
  macOS 可在「系统设置 → 通用 → 语言与地区 → 应用程序」里单独给浏览器指定语言
- SharedWorker 与 Service Worker 读到的是原生值；DOM / CSS 的文字尺寸不受字体伪装影响
- WebRTC 的真实出口取决于网络环境，扩展只能选择浏览器暴露哪些候选地址

完整的边界说明见 [实现说明](docs/ARCHITECTURE.md)。

### 📚 文档

- [INSTALL.md](INSTALL.md) - 安装、确认生效与常见问题
- [CONFIG_GUIDE.md](CONFIG_GUIDE.md) - 怎么配才自洽、首屏的三种模式、烘焙构建
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 实现原理与边界
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 从源码开发、测试与浏览器检查
- [RELEASE.md](RELEASE.md) - 发版流程
- [CHANGELOG.md](CHANGELOG.md) - 更新日志

### 📄 许可与署名

MIT 许可。由 [@ccisnoxx](https://github.com/ccisnoxx) 开发与维护。
本项目最初基于 VanishMe（MIT），原作者的版权声明与许可原文保留在 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

---

## English

<div align="center">
  <img src="images/banner-en.png" alt="VanishGeo" width="100%"/>
</div>

VanishGeo is a Chrome MV3 extension (Chrome 119+; Edge, Brave, Helium and other Chromium browsers work too) for
environment **consistency**, not fingerprint randomisation: one persona holds in the request headers and the page's
JavaScript at the same time. Where a value cannot be reached, nothing is patched.

### ✨ Features

- 🕐 **Timezone** - every `Date` method, `Intl`, `Temporal.Now` and `document.lastModified` follow the target zone
- 🌐 **Language** - `navigator.language` / `languages`, the default locale of `Intl` and `toLocaleString`; `Accept-Language`
  is rewritten before the first request, including the site's own requests to CDNs, APIs and other domains
- 🌍 **Geolocation** - coordinates, accuracy and a random offset fixed for the session; `watchPosition` timing and
  still readings look like a real device; when coordinates cannot be resolved it reports "position unavailable"
  instead of falling back to the real location
- 🖋 **Canvas fonts** - hides fonts in three layers (platform, CJK, manual list) across `<canvas>`, `OffscreenCanvas`
  and `queryLocalFonts()`
- 🔒 **WebRTC** - `strict` / `compatible` / `default` policies
- 🧵 **Workers / Worklets** - dedicated, nested Workers and Audio / Paint / Animation Worklets match the main thread
- 🛡 **Anti-detection** - patched functions match native signatures, shapes and errors; nothing is patched when the
  native value is already correct
- ⚡ **Correct from the first script** - with "Allow User Scripts" on, the page's earliest scripts see the target values
- 🧭 **Configure from exit IP** - one click fills timezone, coordinates and language from the exit IP; optional
  "Follow exit IP" keeps them in step when the exit changes
- 🩺 **Diagnostic page** - measures the real page against the expected values; the config audit flags contradictions

### 🚀 Installation

1. Download the latest `vanishgeo-v*.*.*.zip` from [Releases](https://github.com/ccisnoxx/VanishGeo/releases) and extract it to a permanent folder
2. Open `chrome://extensions/`, enable Developer mode, click "Load unpacked" and pick the extracted folder
3. **Recommended**: on VanishGeo's details page turn on "Allow User Scripts" (Chrome / Helium 120+; before Chrome 138
   it is Developer mode) and reload the page. The page's earliest scripts then see the target values; without it the
   extension still works but the configuration arrives after the page starts running. The popup shows a hint with a
   direct link while it is off

Tabs opened before the extension was loaded need one reload. Building from source and troubleshooting: [INSTALL.md](INSTALL.md).

### 📖 Usage

In the popup:

- **Enable / exclude this site** - writes a rule for the current domain and reloads only that domain's tabs
- **Site rules** - one domain per line; `example.com` also covers its subdomains; **no wildcards**
- **Quick presets** - built-in personas (US West (Los Angeles) / Singapore / Japan), manual coordinates and timezone,
  language and `Accept-Language`, fonts
- **Configure from IP** - writes the exit IP's coordinates, timezone and language into the config and applies them;
  failures are shown right away

The full options page adds enable / disable / delete for each rule, "Follow exit IP", saving / importing / exporting
custom personas, exporting a baked config, and a data reset.

#### Rule model

There is exactly one model: **per-domain rules**.

```
google.com          ← enabled: google.com and all of its subdomains
!mail.google.com    ← excluded: the longer rule wins, the site stays native
```

- Longest match wins: `google.com` enabled plus `mail.google.com` excluded means the mail host is not spoofed
- There are no global/whitelist/blacklist modes and no `*.example.com` or `*keyword*` wildcards

#### When changes take effect

| Change | How it applies |
| --- | --- |
| Timezone / geolocation / canvas | Pushed to open tabs immediately, **no reload** |
| Language | Pushed immediately; the request header changes too, so matching open pages reload once to keep document and page values in step |
| Enable / exclude / delete a domain | Reloads only that domain's tabs |
| Exit IP | Location refreshes every 5 minutes; with "Follow exit IP" on, timezone and coordinates change when the exit does |
| Action badge | Turns red `!` when the profile cannot apply (e.g. no location), with the reason in the popup |

### 🧱 Defaults

| Item | Default | Notes |
| --- | --- | --- |
| Language | `en-US` / `en-US,en;q=0.9` | A persona property, never taken from the OS |
| Timezone / geolocation | `auto` | Derived from the exit IP; a persona card pins them |
| Follow exit IP | off | When on, timezone and coordinates follow exit changes; language does not by default |
| WebRTC | `strict` | `disable_non_proxied_udp` |
| Canvas fonts | off | |
| Site rules | 20 domains | 13 common sites + 7 privacy test sites, see `src/shared/default-domains.json` |

The 7 privacy test sites (browserleaks.com, ipleak.net, browserscan.net, deviceinfo.me, whoer.net, ipinfo.io,
iprisk.top) let a fresh install be self-tested right away. Configs from the old `VanishMe` build migrate automatically.

### 🩺 Diagnostic page

Open a page that has a rule, then right-click the toolbar icon → "Open diagnostic page":

- **Site check** reads the real values inside the page and compares them with what the site's rule expects,
  starting with a verdict and then grouping the rows
- **Config audit** flags contradictions in the config (e.g. header vs page language, coordinates thousands of
  kilometres from the timezone) and offers one-click fixes where they are mechanical

Geolocation is read only when the page already has permission, so no prompt appears; WebRTC is measured in the page,
since the extension page itself is not spoofed and is only a baseline.

### ⚠️ Limits

- Browser UI language, form validation messages and the voice list (`speechSynthesis.getVoices()`) come from the
  browser process and cannot be changed by an extension; on macOS set a per-app language under
  System Settings → General → Language & Region → Applications
- SharedWorker and Service Worker see native values; DOM / CSS text measurement is not affected by font masking
- The real WebRTC exit depends on your network; the extension only controls which candidates the browser exposes

The full list of boundaries is in the [architecture notes](docs/ARCHITECTURE.md) (Chinese).

### 📚 Docs

Detailed docs are in Chinese:

- [INSTALL.md](INSTALL.md) - installation, verification and troubleshooting
- [CONFIG_GUIDE.md](CONFIG_GUIDE.md) - building a self-consistent config, the three first-screen modes, baked builds
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how it works and where it stops
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - developing, testing and browser checks
- [RELEASE.md](RELEASE.md) - release process
- [CHANGELOG.md](CHANGELOG.md) - changelog

### 📄 License and attribution

MIT licence. Built and maintained by [@ccisnoxx](https://github.com/ccisnoxx).
The project was originally derived from VanishMe (MIT); the original copyright notice and licence text are kept in
[LICENSE](LICENSE) and [NOTICE](NOTICE).
