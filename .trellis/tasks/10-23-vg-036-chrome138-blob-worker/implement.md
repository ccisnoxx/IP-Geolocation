# VG-036 Chrome 138 Blob Worker 定向补验

日期：2026-10-23；状态 **done，已通过用户人工验收**。生产源码、权限、版本及 HTTP(S) Worker／SharedWorker 暂停决定保持不变。用户已授权相关脚本、文档及证据本地提交，先不推送。

## 候选、环境与实际操作

- 本地基线 `d0a695f`；当前实际 dist，Chrome for Testing **138.0.7204.183**，macOS arm64、有界面、独立临时 profile。沿用已安装的官方 CfT 138，未下载、替换或使用个人 Chrome 配置。
- 使用 Chrome 原生扩展管理页开启开发者模式，通过系统目录选择器加载当前 dist，再正常开启 Allow User Scripts。无 loadUnpacked 调试接口、加载扩展启动参数、偏好文件写入或安全策略放宽。
- 原生基线在安装前取得。安装后通过现有 Options 管理消息设置仅 localhost 的合成 en-US／[en-US,en]／America/Los_Angeles 配置，关闭定位和字体，WebRTC 为 default。所有配置写入仅作用于本轮临时 profile；没有调用出口 provider、真实定位或外部测试站点。
- 生产探针由响应中第一个普通页面脚本创建 Worker；扩展按正常 document_start userScripts 派发，测试没有在生产页面／Blob Worker 内手工安装补丁。CDP 用于测试页创建、采样和既有管理消息，不暂停生产脚本、拦截补丁安装或替换 API。
- 请求限于 HTTP 回环；Chrome 自身后台网络未全量监控。证据只含合成配置、语言时区、回环 Blob URL、布尔判定和哈希，不记录精确公网 IP、真实位置、凭据或个人路径。

## 结果

| 证据层 | 本轮实际结果 |
|---|---|
| [生产扩展观测](chrome-evidence.json) | 7 个页面阶段，66 项断言 PASS，包含原生基线、启用、3 种 CSP、关闭后新文档、重新启用后新文档 |
| [独立嵌套资格对照](qualification-evidence.json) | 40 组 PASS；原生、原生 import、显式补丁对照；各组最终可见 URL 存活及创建者检查均为 0 |
| [关闭／reload 边界](reload-evidence.json) | 7 项 PASS；旧文档快照保留、完整 reload 后恢复原生、重新启用前后行为符合每文档快照 |
| 清理 | 本轮 Chrome138、采集器及资格服务已退出，独立临时 profile 已移除 |

启用及重新启用后，新文档的页面、Worker 业务首段、module 静态依赖均为 `en-US`、`["en-US","en"]`、Intl locale `en-US`、`America/Los_Angeles`，冬季／夏季 offset 为 `480 / 420`。四个父子组合 classic/classic、classic/module、module/classic、module/module 均测试到孙级，提前消息及每层模块依赖快照一致。

原生及关闭后新文档为 `zh-CN`、`["zh-CN"]`、Intl locale `zh-CN`、`Asia/Shanghai`、`-480 / -480`。安装前原生对照、关闭后新文档、重新启用后新文档均重复四组链路，未将原生中文值误判成残留同步失败。

撤销及终止覆盖：构造后立即撤销原 Blob URL仍可加载；构造前已撤销的URL与业务异常均得到原生 Worker error；classic／module 立即 terminate 后400ms未收到业务消息；终止根 Worker 后500ms未收到后代tick，刻意保留的 Worker 内原 URL均不可读。跨线程 URL 检查沿用既有100ms稳定观察窗口，不宣称立即原子可见或任意内存泄漏证明。

### CSP 拒绝如何判读

- 页面 `connect-src 'none'` 禁止同步 Blob 存活核验：页面仍有自己的美西快照，Worker 保持原生中文／上海值并明确警告“本次语言/时区未同步”；四条链路均没有报告首读同步成功。原生消息及终止仍正常。
- 页面 `script-src 'self'` 且 `worker-src blob:`：classic 补丁加载的 importScripts 被拒绝；module 静态图仍可加载，module 单级成功。四条三层链均包含 classic 层，因此最终均如实失败。禁止脚本的负例不使用“原生必须成功”作为判据。
- 页面 `worker-src 'none'`：classic／module 均 Worker error，没有绕过入口限制。
- 独立资格对照使用 Worker 内部响应 CSP，覆盖 script-src self／none、worker-src none、connect-src none、原生 import 对照、预撤销、业务异常、立即终止及 HTTP／外来 Blob 透传。HTTP 父 Worker 中的补丁是资格 fixture 显式安装，不构成扩展生产接管 HTTP Worker。

负例原始日志中的 `VG034_DONE.passed=false` 表示通用“美西同步成功”探针在预期拒绝时未通过；`VG034_PARENT_TERMINATE` 在 script/worker 拒绝场景可记录 timeout，因为根业务没有启动。这些原始结果保留，不改写为同步成功；主验收以 CSP 预期和单级错误判断，核对脚本另外确认四条链均如实失败。根终止功能的正向验收来自正常策略场景，不用被拒绝场景的 timeout 作为终止通过证据。

### 关闭与恢复

通过既有管理消息关闭总开关并确认页面脚本／请求头同步完成。旧文档随后新建的 Blob Worker仍使用该文档的美西快照；完整 Page.reload 后新 Worker 恢复原生。重新启用并同步后，尚未 reload 的原生文档仍原生，完整 reload 后恢复美西。未宣称保存时即时撤回旧 Worker 或修改旧文档，不将本次 reload 验收外推为浏览器冷启动／崩溃恢复。

## 可复核工具与来源

- [主采集器](../../../scripts/chrome138-blob-worker-acceptance.mjs)：先发送 baseline，正常 UI 安装并允许脚本后发送 installed，其他补充采样完成后发送 finish。须交互式终端运行以保留 stdin，CHROME_BIN 指向已安装 Chrome138。
- [嵌套资格采集器](../../../scripts/chrome138-nested-blob-csp-probe.mjs)：连接本轮138端口，启动既有40组 fixture，保存独立 JSON。
- [reload采集器](../../../scripts/chrome138-blob-reload-probe.mjs)：同一临时 Chrome138及主 fixture，使用已有管理入口切换并完整重载。
- [只读证据核验](../../../scripts/verify-chrome138-blob-evidence.mjs)：重算正常链路、CSP负例、40组资格与reload边界；不启动 Chrome。

主证据 `distSha256` 按已有 Chrome runner 的路径＋原始字节算法计算，排除 Chrome 生成的 `_metadata`。整理阶段追加基线提交与脚本／维护源 SHA-256，另有 metadataNote；这些元数据不冒充新的浏览器观测。资格证据保存其构建入口和维护源摘要，三份JSON共享本轮同一个Chrome138进程，版本分别核对。

## 验证与异常记录

- 四个新增脚本 `node --check` 通过。
- `node scripts/verify-chrome138-blob-evidence.mjs .trellis/tasks/10-23-vg-036-chrome138-blob-worker` 通过，66项生产断言、40组资格及7项reload边界均与原始观测一致。
- 生产源码、维护构建代码、tests、依赖／版本／配置和既有两份探针未改；VG-034 证据绑定的六个文件 SHA-256 全部一致。复用 VG-034 已通过的源码／测试 typecheck、294/294测试及build；本轮没有重跑或冒称新增这些门禁证据。
- JSON、YAML状态／依赖、相对链接、证据摘要、个人路径与最终diff检查通过。
- 准备阶段第一次采集器通过非交互管道启动，stdin已关闭，尚未开始正式用例；关闭该临时浏览器／采集器后改为交互终端，重新建立独立原生基线。首轮残留临时目录也已清理。未将准备异常记成产品失败或正常验收通过。
- 清理核验初次用进程命令文本子串匹配，将检查器自身误匹配；改为精确匹配本轮浏览器二进制及profile前缀后确认主进程0、采集器／资格服务0。这是检查器误判，没有再次运行产品用例或更改产品逻辑。

## 未覆盖范围

本次仅 Chrome138.0.7204.183／macOS arm64／HTTP loopback／当前已支持 Blob Dedicated Worker范围。未补 HTTPS、其他平台／补丁版本、完整升级／重启／BFCache／崩溃／多窗口、全部 Trusted Types／跨 realm／模块循环及顶层await时序或任意内存泄漏矩阵。

HTTP(S) Dedicated Worker、SharedWorker、外来 Blob、未接管父级的后代及其他现有未覆盖范围继续暂停／未覆盖。SharedWorker只检查页面或fixture中的构造器引用未变化，没有做共享身份／连接功能验收。完整dist和候选ZIP／发布资料对齐留待另行授权，不从本轮PASS推出release-ready。

## 2026-10-23 人工验收与本地提交授权

用户明确确认：“这次 Chrome 138 定向补验验收通过，把 VG-036 标记为 done，补充人工验收记录，并把相关脚本、文档和证据提交到本地，先不要推送。HTTP(S) Worker 和 SharedWorker 继续保持暂停。”

据此将 task-manifest 与 task.json 同步为 done。本次人工签收仅覆盖上述 Chrome138.0.7204.183／macOS arm64／HTTP回环中的现有Blob及嵌套Blob首读、父子组合、撤销终止、CSP拒绝、关闭及reload恢复。保留三份原始观测中的失败／未同步负例和全部未覆盖边界，不扩写为HTTPS、完整重启、其他平台或发布通过。

本次收尾只补充验收与状态记录，四个脚本和三份Chrome证据保持采样后交付时内容；复用输入未变化的语法、摘要、66项生产断言、40组资格对照、7项reload检查及既有类型／294项测试／构建证据，并再次核对实际提交范围与diff。生产源码、权限、版本不变，HTTP(S) Worker和SharedWorker继续暂停。

本地提交授权不包含push、tag、Release或部署。
