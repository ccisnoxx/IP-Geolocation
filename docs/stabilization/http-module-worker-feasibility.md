# HTTP(S) Dedicated Worker 语言时区同步：实验结论与暂停决定

2026-10-23，用户要求同源 HTTP(S) module Dedicated Worker 可行性实验，随后明确保持 HTTP(S) Worker 暂停、SharedWorker 不动，仅将结论和证据整理进仓库供审阅，不自动提交。任务状态只以 [task-manifest.yaml](task-manifest.yaml) 的 VG-035 为准；用户随后于同日验收整理通过，授权 VG-035 标记 done 及本地提交，先不推送，见 [验收记录](../../.trellis/tasks/10-23-vg-035-http-worker-feasibility/implement.md#人工验收与本地提交授权)。研究资料验收不构成生产恢复授权。

**结论：本次“Blob module 启动脚本＋按原 HTTP URL 静态导入业务模块”方案不满足 CSP 和全部相对路径语义等价要求。HTTP(S) Dedicated Worker 的语言／时区包装继续暂停，SharedWorker 也继续暂停。** VG-033／VG-034 已验收的页面及已同步 Blob 链内、各 realm 自身新建 Blob Dedicated Worker 范围保持不变。

## 实验方法与证据

- 使用用户当前 Chrome，浏览器回传 UA 为 Chrome/155.0.0.0；不把该 UA 当作完整安装版本号或最低 Chrome 138 的验收证据。
- 实际执行仅为本机 `127.0.0.1` HTTP 回环、同源 module Dedicated Worker。不是 HTTPS 实测，不是新临时浏览器 profile，也不是生产扩展已接管 HTTP Worker。
- 对照同一业务模块的原生 HTTP Worker，以及 Blob module 启动脚本；包装入口先静态导入同步补丁模块，再静态导入原 HTTP URL 的业务模块。补丁来自现有生成函数，显式传入合成的 en-US／America/Los_Angeles 最小 payload，没有改动用户配置。
- 包含静态依赖、带顶层 await 的动态模块、资源 fetch、XHR、子 Worker、同源 302 重定向、CSP 阻断及 Report-Only 观测。9 组用例各有 native／wrapped 两种模式，共 18 个入口结果。
- 所有请求、资源、CSP report 和结果回传均限定本机服务。只保存合成资源、语言／时区观测、UA、回环 URL 与请求目的地，不记录公网 IP、凭据、真实位置或个人路径。未修改权限、DNR、host scope、扩展配置或生产派发。

| 资料 | 用途 |
|---|---|
| [Chrome 原始证据 JSON](../../experiments/http-module-worker-feasibility/chrome-evidence.json) | 浏览器回传、夹具服务端请求记录，以及采样后追加的 66 项断言名称和边界说明；原文件逐字节保存 |
| [Chrome 汇总截图](../../experiments/http-module-worker-feasibility/chrome-report.png) | 采样后根据结果生成的汇总页截图，不能代替原始证据 |
| [证据核对脚本](../../experiments/http-module-worker-feasibility/verify-evidence.py) | 只读重算 66 项历史结果断言，不启动浏览器、不产生新的 Chrome 验收 |
| [历史实验夹具](../../experiments/http-module-worker-feasibility/server.mts) | 保存最终采样服务器；归档时仅移除机器绝对路径，输出改为独立临时目录 |

实验运行于本地日期 2026-10-23；JSON `createdAt` 使用 UTC，日期为 2026-10-22，两者并不矛盾。源码基线为本地提交 `2a04924`（VG-034），归档时没有修改该生产实现。

## 实测结果

| 用例／检查 | 原生 HTTP module Worker | Blob 启动＋原 URL 导入 | 判定 |
|---|---|---|---|
| baseline：相对静态／动态 import | 成功 | 成功 | 本用例模块路径保留 |
| baseline：基于 import.meta.url 的资源／子 Worker | 成功 | 成功 | 本用例模块资源路径保留 |
| baseline：直接相对 fetch、XHR、new Worker | 成功 | 分别发生 TypeError／SyntaxError／SyntaxError | 全局相对路径不等价 |
| page-worker-self | 成功 | Worker error | 原 CSP 不允许 Blob 时无法启动 |
| page-worker-none | Worker error | Worker error | 两者均被阻止 |
| page-connect-none：业务资源连接 | 成功 | 连接被阻止，出现 connect-src enforce 违例 | Blob 继承页面策略导致额外阻断 |
| response-connect-none | 连接被阻止，有 enforce 违例 | 绝对／模块资源连接成功，无对应违例 | 原入口响应连接限制丢失 |
| response-worker-none | 通过模块 URL 创建子 Worker 被阻止 | 同样的子 Worker 创建成功 | 原入口响应子 Worker 限制丢失 |
| response-script-none | 动态 import 被阻止；静态依赖仍执行 | 动态 import 成功 | 原入口响应动态脚本限制丢失 |
| response-report-only | 连接成功，同时产生 report 违例及服务端 CSP report 请求 | 连接成功，无对应违例或报告请求 | 报告语义丢失 |
| redirect：同源 302 后模块地址 | import.meta.url、静态／动态依赖按最终 URL 解析 | 同样按最终 URL 解析 | 模块路径保留，全局相对路径仍失败 |

成功启动的包装用例中，业务入口、静态依赖、动态模块首次执行的快照均为 `en-US`、`["en-US", "en"]`、`America/Los_Angeles`，冬季／夏季 `getTimezoneOffset()` 为 `480 / 420`。原生对照读取到 `zh-CN`、`["zh-CN", "zh"]`、`Asia/Shanghai`、`-480 / -480`。这证明合成补丁能先于被测模块执行，不能证明生产支持 HTTP Worker；HTTP 子 Worker 仅用于路径与 CSP 探针，没有纳入语言同步覆盖。

66 项断言通过的含义是：正向行为、预期阻断及不等价反例均与存档一致。**它不是“66 项兼容性验收通过”。**

## 原始记录的限制

1. `page-connect-none` 是历史用例名；实际页面 `connect-src` 只允许结果回传端点 `/case-results`，禁止所有被测业务资源，并非字面上的完全 `connect-src 'none'`。JSON `requests[].responseCSP` 对该页面记录的是替换前的策略模板，不是抓包所得的完整实际响应头。原始字段保留，并由 `verification.fixtureNotes` 及本说明解释，不伪装为网络捕获。
2. `response-report-only` 的报告策略在夹具响应中设置，JSON 的 `responseCSP` 不含 Report-Only 响应头；结论由 Worker 违例事件、服务端 `/csp-report` 请求及夹具配置共同支持。未保存报告请求正文，也未覆盖 Reporting API 的其他端点形式。
3. 初版连续 iframe 夹具未完成批次，后改用顶层页面顺序采样。归档 JSON 仅为最终九组顶层对照；早期停滞没有计为 Worker 反例。历史夹具的 `/` 路由仍是旧 iframe 入口，不用于复验；使用下述 `/case?case=baseline`。
4. 本轮记录了每组无 Service Worker controller，以及 SharedWorker 构造器引用未被更换；这不代表验证过 Service Worker 合成响应，也不构成 SharedWorker 功能验收。
5. 相同业务入口的查询参数区分 native／wrapped；夹具返回相同业务源码。模块路径比较使用返回的依赖地址及资源结果。请求记录中的原入口和被导入入口均可能显示 `destination: worker`，不能用该字段推定二者策略容器等价。

## 未覆盖及继续暂停的范围

| 范围 | 当前结论 |
|---|---|
| HTTP(S) Dedicated Worker 生产包装，包括 classic 与 module | 暂停；本实验没有启用，module 反例不能自动转成 classic 的实现结论 |
| SharedWorker，含 HTTP(S)／Blob、身份复用与跨文档共享 | 暂停；本轮未接管、未功能测试 |
| 真正 HTTPS、证书链、混合内容、不同可信上下文 | 未执行；HTTP 回环结果不能冒充 TLS 实测 |
| Service Worker 合成响应、CacheStorage、接管变化 | 未验证 |
| DNR 实际响应头防护、优先级／隔离规则交互、错误回退 | 未实现、未验证，不以现有权限推定方案已可用 |
| 跨源、credentials／Cookie、完整 CORS／CORP／COEP／Referrer-Policy、缓存与更多重定向 | 未验证；仅含本轮同源 302 正例 |
| Trusted Types、异常模块图、广泛顶层 await／循环依赖时序 | 未完整验证；一个动态模块 await 正例不代表完整模块时序验收 |
| terminate、泄漏、重启、导航、BFCache、旧 Worker 更新、关闭及升级 | 本 HTTP 包装实验未验证；不能套用 Blob 生产验收 |
| Chrome 138、其他浏览器／系统、真实第三方站点和代理出口 | 未验证；美西时区是合成 payload，不是代理出口核验 |
| 外来 Blob、未接管父 Worker 的后代 | 沿用 VG-033／VG-034 未覆盖边界 |

## 决策与后续门槛

当前不恢复历史 HTTP 包装、不新增权限、不修改 CSP、不增加 fetch／XHR／Worker 的全局路径修补。仅将域名加入 allowlist 或仅限制 module，不能解决已观测到的策略丢失与基准地址变化。

未来若重新评估，需另行明确授权，并提供可验证的脚本及依赖范围、全局相对路径约束、实际入口响应策略核验及不能保证时的行为。DNR、预取响应头或网站协作初始化仍只是不同方向，未因本实验获得实现资格；本次 NO_GO 针对被测包装方案，不证明所有未来方案都不可能。

## 本地复核与复验

在仓库根目录执行只读历史证据复核：

```sh
python3 experiments/http-module-worker-feasibility/verify-evidence.py
```

如另行需要重跑真实浏览器实验，可启动独立夹具：

```sh
./node_modules/.bin/tsx experiments/http-module-worker-feasibility/server.mts
```

服务仅监听 `127.0.0.1` 的随机端口，打印 `PROBE_OUTPUT` 和 `PROBE_URL`。在目标 Chrome 打开该 origin 的 `/case?case=baseline`，顺序采样完成后查看临时输出目录的 `evidence.json`，应有九组且无 timeout；不要使用历史 `/` iframe 入口。新结果写到独立临时目录，不覆盖存档。结束后停止该进程并关闭实验标签页。该命令不会自动改扩展配置、权限、生产派发或 Git 状态。

本次归档没有重跑 Chrome；仅复核已有结果、文件对应关系和生产基线。归档夹具的路径适配也不能表述为新一轮 Chrome 已通过。
