# Phase 2A 设计

## Summary

本阶段采用“经典脚本优先 + 共享纯逻辑可被 Node 直接 require 测试”的方案。运行态继续以现有入口文件对 Chrome 扩展暴露能力，但把具体逻辑拆入按责任组织的脚本模块，通过有序加载或 `importScripts(...)` 装配。这样可以在不切换到 bundler/ESM 前提的情况下，先把共享逻辑和页面控制器从入口文件里剥离出来。

## Architecture And Boundaries

### 1. Shared logic

- `shared/config/`: `config.js` 的内部逻辑下沉到按职责拆分的纯函数模块，覆盖 normalize、validate、matching、profile resolution、timezone helper。
- `shared/diagnostic/`: background 与 test 页共用的 diagnostic model、timezone snapshot、lastLocation snapshot、target tab resolution、live-page probe 结果整形。
- `shared/runtime/`: runtime message client、Chrome callback Promise 包装、共用 action 常量、轻量 response unwrap。
- `shared/ui/`: 页面级格式化器、状态文本辅助、必要的 DOM-safe render helper。

### 2. Background

- `background/storage.js`: 获取/保存配置、lastLocation、diagnostic target。
- `background/geo.js`: IP API 请求、响应解析、lastLocation 更新。
- `background/runtime-effects.js`: content script 注册、DNR 语言规则、WebRTC 设置、全 tab 更新。
- `background/diagnostic-service.js`: current tab state、diagnostic state、diagnostic page open/probe。
- `background/message-router.js`: 单一 action -> handler 映射与错误包装。
- `background.js`: 只负责 `importScripts(...)`、listener 注册和启动流程。

### 3. Main-world / content chain

- `spoof/payload.js`: payload normalize 与语言/时区输入整形。
- `spoof/timezone-date.js`: `Date` / `Intl.DateTimeFormat` / offset patch。
- `spoof/intl-locale.js`: `Intl.NumberFormat` 等 7 个 locale 构造器 patch。
- `spoof/workers.js`: worker / shared worker hook。
- `main_spoof.js`: 作为 entry，把 message bridge 事件接到上面几个 patch 模块。
- `content.js`: 保持 bridge entry，但把 allowlist/profile 解析与 payload postMessage 逻辑改为调用共享模块。

### 4. Pages

- `pages/popup/`: state loader、action handlers、formatters、renderer。
- `pages/options/`: form model、rule editor、import/export、save/load controller、renderer。
- `pages/test/`: diagnostic fetch、expected/live diff model、Intl diagnostics renderer、summary/status presenter。
- 页面 HTML 保持原路径和主要 DOM id，不做 Phase 2A 的产品 UI 改版。

## Contracts And Compatibility

- `IPGeoConfig` 继续是唯一配置公共出口；内部可拆，但外部调用保持兼容。
- runtime message action 字符串集中到共享常量；已有 action 名称与响应顶层结构不变。
- content script 与 background 的消息载荷形状保持兼容，避免 Phase 1 诊断页链路回归。
- 页面入口文件名和 `manifest.json` 引用不改，确保扩展原生可加载。

## Testing Strategy

- 新增最小 `package.json`，使用 Node 内建 `node:test` 和 `node:assert/strict`。
- 纯逻辑模块通过 `module.exports` 暴露给 Node 测试；浏览器侧继续挂到命名空间或由装配层消费。
- 首批测试优先覆盖：
  - config normalize / validate / matching / effective profile
  - diagnostic model builder
  - runtime message unwrap / error path
  - 页面 form mapping 或 diff model 的纯逻辑

## Rollout / Risk Notes

- 本阶段最大风险是“入口脚本瘦身时意外断开全局符号或加载顺序”。因此每个入口文件保留为最终装配层，避免一次性替换为全新入口机制。
- 当前工作区已有 Phase 1/WIP 诊断增强，Phase 2A 必须在保留行为目标的前提下重组代码；若发现行为回归，优先修复模块装配，而不是回退 Phase 1 能力。
- 权限和注入范围保持原样，避免 Phase 2A 与 Phase 2B 的验证口径互相污染。
