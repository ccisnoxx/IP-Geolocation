# 设计

## 所有者与 key

`src/injected/runtime.ts` 的既有 AntiDetectionState 拥有 SharedWorker URL Map 和当前 worker patch source。安装 hook 前更新 patch source，重复注入保持原构造器代理与缓存；key 用 JSON tuple 表示绝对 URL、默认补齐的 type/name/credentials 与 patch source。patch source 只含既有 stateKey/语言/语言数组/时区。

原生构造器代理保留 prototype、name/length、toString registry 和派生 newTarget。已支持 credentials/name/type 依 WebIDL 字典顺序单次读取和字符串转换，同一快照同时用于 key、bootstrap 和原生构造；仅 undefined 使用默认值，null name 为 "null"。非法 credentials 由原生校验拒绝，不读取后续成员；额外 extendedLifetime 由支持它的原生构造器读取，未声称完整新选项矩阵。

## 生命周期与失败

Dedicated URL 在原生构造器返回后释放；同步失败也释放后用原始 URL/options 回退。浏览器构造器已经解析 Blob URL 并启动加载，不等待业务消息，不消费端口或增加配置桥。真实 Chrome classic/module/嵌套 smoke 直接验证回收不阻断加载。

SharedWorker Map 保留 URL 至 pagehide；同步构造失败仅撤销本次新建项，不删除既有可用缓存。pagehide（含 BFCache）清空 Map；恢复后为新缓存周期。跨文档共享未承诺，已运行 worker 保留启动时配置。异步 CSP/脚本错误保持浏览器 error，不自动重试普通网络脚本。

## 安全与回滚

只包装同源 HTTP(S)，其余透传。URL、配置签名仅内存持有，不写 storage、日志、query 或公开 marker；fixture 仅合成值/localhost。撤回本任务 runtime/tests/fixtures/docs 增量即可回滚，刷新文档恢复旧 hook；不撤销前序任务改动或浏览器用户配置。

## 标准依据

[HTML Worker 构造器](https://html.spec.whatwg.org/multipage/workers.html#dom-worker)、[SharedWorker](https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworker)、[File API URL 回收](https://www.w3.org/TR/FileAPI/#dfn-revokeObjectURL)。类型/name/credentials 的不同 key 按本任务隔离；异步不兼容/CSP 边界单独列为限制，不据此声称完整原生网络语义。

## module SharedWorker 初始 connect

真实 Chrome 对照发现：直接 native module fixture 能连接；旧动态 await import 包装的初始连接丢失，后来连接可用。缓冲 connect 后直接 redispatch 原 event 仍未交付；最小无补丁对照证实 collected=1/replayed=1，却无业务回调。原因是 stopImmediatePropagation 的事件不能据此直接复用为新交付。

本任务在动态 import 前注册临时 connect 收集器，完成后以独立 task 顺序交付带同一 ports/data/origin/source 的新 MessageEvent，排空前继续收集迟到连接，排空后移除 capture=true 收集器。它不改变业务脚本 fetch、端口对象或配置来源，也支持 onconnect/addEventListener 两种业务监听方式；缓冲阶段的事件为 synthetic/isTrusted=false，明确保留为限制，不能伪造原生信任值。队列排空并移除收集器后不再拦截 connect。导入拒绝仍为异步失败，未自动重试脚本。

最终独立复核确认并修正：capture=true 收集器必须先于业务 capture listener；每个缓冲 connect 在独立 timer task 中派发，以保留 callback 后的微任务检查点；排空前继续接收迟到连接，避免原生后到事件越过缓存。dispatch 与 scheduler 捕获于业务 import 前，replaying 仅跳过本次合成派发，import 失败移除收集器并清空队列。新增 shared-worker-module-delayed.js 用 capture listener、100ms 顶层 await 和微任务计数验证一次交付/1→2 顺序。字符串 name 与非法 credentials 的内部快照均填全 own 默认字段，避免 Object.prototype 的 type/name/credentials 污染。
