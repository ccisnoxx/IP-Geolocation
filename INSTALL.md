# VanishGeo 安装指南

面向"第一次装上并确认它在工作"的场景。发布流程见 [RELEASE.md](RELEASE.md)，
配置怎么调见 [CONFIG_GUIDE.md](CONFIG_GUIDE.md)。

## 环境要求

- Chrome 119+ 或同内核浏览器（Edge / Brave / Helium 等）
  （`chrome.scripting` 的 `world: "MAIN"` 要 111+，`matchOriginAsFallback` 要 119+）
- 从源码构建需要 Node.js 20+

## 一、安装

### 方式 A：从 Release 安装

1. 在 [Releases](https://github.com/ccisnoxx/VanishGeo/releases) 下载最新的
   `vanishgeo-v*.*.*.zip`
2. 解压到任意目录（解压后应能看到 `manifest.json`）
3. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`）
4. 打开右上角「开发者模式」
5. 点「加载已解压的扩展程序」，选中**含 `manifest.json` 的那一层目录**

> 选错层是最常见的失败原因：如果选中了解压目录的上一层，扩展会提示找不到 manifest。

### 方式 B：从源码构建

```bash
git clone https://github.com/ccisnoxx/VanishGeo.git
cd VanishGeo
npm install
npm run build
```

`npm run build` 会先跑 `tsc --noEmit`，再构建到 `dist/`。加载 `dist/` 即可。

改代码后：

```bash
npm run dev      # vite build --watch，改完回扩展页点一下刷新
```

## 二、确认它在工作

### 1. 扩展自己的一致性检查

右键工具栏图标 →「Open diagnostic page」：

- 上半部分是你当前配置的**期望值**
- 在「探测选中标签页」下拉里选一个**已启用规则**的站点标签页，点「探测选中标签页」
- 结果表里变红的就是没达标的项

### 2. 站点实测

打开任意一个已启用域名（默认有 13 个，例如 `chatgpt.com`），在控制台里：

```js
Intl.DateTimeFormat().resolvedOptions().timeZone   // 应该是配置里的时区（auto 时是出口 IP 所在时区）
new Date().getTimezoneOffset()                     // 与该时区一致
navigator.language                                 // en-US
Object.isFrozen(navigator.languages)               // true
Date.prototype.setHours.toString()                 // "function setHours() { [native code] }"
Object.keys(new Date()).length                     // 0
```

再打开开发者工具的 Network，看任意请求的 `Accept-Language` 是否与之一致。

### 3. 外部站点

- <https://iprisk.top/>
- <https://browserleaks.com/>
- <https://ipleak.net/>

## 三、常见问题

### 扩展加载后没反应

- 确认当前站点**在规则里且是启用状态**（弹窗「站点白名单」或完整配置页）
- 确认总开关没关
- 打开诊断页看「当前配置」是不是你要的值

### 改了配置但页面没变

| 改了什么 | 是否需要刷新 |
| --- | --- |
| 时区 / 语言 / 定位 / canvas | 不需要，已开标签页会收到推送 |
| 启用 / 排除 / 删除域名 | 该域名的标签页会自动重载 |
| 大改之前加载的老标签页 | 手动刷新一次最保险 |

如果还是不对，去扩展页点一下「刷新」（↻）再刷新页面 —— 那是 Service Worker 卡住了。

### 角标显示红色 `!`

fail-closed：定位或配置没拿到，扩展**不会**用半套值糊过去。弹窗里会写明原因，
点「重试定位」；WebRTC/定位权限相关的报错需要检查系统代理和定位接口是不是可达。

### 定位一直是原生值

`auto` 模式需要能拿到出口 IP 的定位。定位接口被代理挡住或超时的时候，扩展会让时区
留在原生值，而语言和 `Accept-Language` 照常生效 —— "头说 en-US、页面说 en-US、时区是本地"
本身是自洽的。想钉死就手动填坐标或点一张 persona 卡片。

### 构建失败

```bash
node -v              # 需要 20+
npx tsc --noEmit     # 先看类型错误
npm test             # 再跑单测
rm -rf node_modules && npm ci
```

### 加载时提示 manifest 错误

扩展目录必须是构建产物 `dist/`，不是仓库根目录。根目录的 `manifest.json` 是源文件模板，
直接加载会缺少构建期注入的常量。

## 四、卸载

`chrome://extensions/` → 找到 VanishGeo → 「移除」。配置随之清空；想保留先用完整配置页
导出。