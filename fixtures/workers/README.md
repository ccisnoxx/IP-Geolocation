# Worker / SharedWorker 本地 fixture

构建后运行 `npm run serve:leak-test`，把 `localhost` 加入启用规则，再打开 `http://localhost:8787/fixtures/workers/top.html`。只使用手动合成语言/时区配置，无需出口检测或主动 ICE。

页面记录 classic/module Dedicated Worker、classic/module SharedWorker、同 key 两次连接的 scope 与 1/2 计数、不同 name 的独立 scope，顶层 await 期间 capture listener 的一次交付/微任务顺序，以及嵌套 Dedicated Worker。所有 Shared 测试在观察期间保留端口，结束或失败后关闭。module-observation.js 在依赖模块顶层采样语言/时区，验证补丁先于整个业务模块图执行。

`node scripts/chrome-worker-smoke.mjs` 使用 Node 22+ 原生 WebSocket 与支持 Extensions.loadUnpacked 的真实 Chrome，在独立临时 profile 中加载 dist、配置合成值、执行 fixture/构造器反射/cross-origin/CSP/异步错误和实际导航 pagehide 回收。只输出分类结果，不输出 Blob URL、配置 payload 或原始请求头；finally 清理 Chrome/profile/server。它不是人工验收、跨浏览器矩阵或完整网络语义测试。

当前包装限于同源 HTTP(S)。缓存只保证同一文档、同一 key 复用；pagehide（含 BFCache）清空后开始新周期。已运行 worker 保留启动配置。module SharedWorker 的动态 import 期间及初始队列排空期间 connect 被缓冲并用同一 ports 合成 MessageEvent 交付，因此这些早期事件 isTrusted 为 false；缓冲队列排空后的 connect 保持原生。ServiceWorker/Worklet 不在范围。
