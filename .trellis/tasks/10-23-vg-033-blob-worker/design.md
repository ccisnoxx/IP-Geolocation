# 设计与边界

页面入口继续由同一规则注册；构建期生成独立自包含 Blob Worker bootstrap，仅包含页面 navigator 与 Intl/Date surfaces。Worker 不接收配置消息。

私有 Map 只记录本 realm 的 createObjectURL(Blob)。Dedicated Worker 构造时复制 Blob URL 引用，classic 先执行补丁再 importScripts 原业务，保留其指令 prologue；module 用两个静态依赖保证补丁先于业务模块图执行，并保留原生启动及消息排队。原 URL 可立即撤销。入口 URL 构造后撤销，源/补丁由 worker 启动、error、terminate 清理。无跨页 SharedWorker 缓存。

新增 Blob 加载必须遵守 CSP、Trusted Types 和 MIME；不绕过失败，不回退为伪装成功。CSP 必须允许入口及 Blob 脚本依赖，worker-src 允许 Blob 但 script-src 禁止 Blob 的页面不支持。location.href、import.meta.url、错误堆栈中的 Blob URL 可观察地变化，不宣称原生等价或不可检测。原有/外来 Blob、HTTP(S)、SharedWorker、嵌套 Worker 仍为原生。

启动前用同步 XMLHttpRequest 仅核验本页已跟踪的 blob: URL 是否仍在原生存储中，避免同源其他 realm 撤销后复活源码。该步骤不访问 HTTP(S) 或外部网络，但读取成本随 Blob 大小增加；CSP connect-src 禁止读取时会明确警告“本次语言/时区未同步”并保留原生加载，不能当作通过。普通 URL 对象支持；TrustedScriptURL、安装前或其他 realm 创建的 URL 未覆盖。页面 CSP 仍需允许 Blob Worker 及 Blob 脚本依赖。
