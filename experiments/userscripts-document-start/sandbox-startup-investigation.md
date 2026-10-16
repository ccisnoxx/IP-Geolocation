# 网络受限环境中的 Chrome sandbox 启动调查

2026-10-16；结果 **BLOCKED / 2**。在本机 macOS27.0.1、Chrome155.0.8059.80、Nodev24.16.0 和现有 sandbox-exec 后端下，没有完成满足约束的 Chrome 启动修复。新结果为 [sandbox-evidence.json](./sandbox-evidence.json)；旧 evidence.json / gated-evidence.json 保留历史状态。

## 实际证据

| 检查 | 实际结果 |
| --- | --- |
| 外层 loopback 约束和派生 Node 继承 | 七项全部 PASS |
| 仅给 `/usr/bin/true` 首次安装 loopback 策略 | 退出0 |
| 继承后再次安装完全相同策略 | 退出0 |
| 继承后安装保留相同 loopback 限制、另加 file-write 拒绝的不同策略 | 退出71，sandbox_apply 权限拒绝 |
| 未提前终止的真实 Chrome 定向诊断 | sandbox 初始化权限错误；GPU/network 子进程重复失败；最终 SIGTRAP |
| 最终公共 runner | 识别到同一权限错误后主动终止本次 Chrome，退出2/BLOCKED |
| 生产380个文件、暂停闸门、资源清理 | 全部 PASS；变更数0 |
| userScripts API、注册、A–F | API 未探测，注册未执行；16个子场景和三阶段均 UNKNOWN |

Chrome stderr 的固定实际签名是 `sandbox initialization failed: Operation not permitted`。原始输出还包含网络服务重启和 GPU 子进程退出；不保存原始 stderr、进程身份或路径。诊断 helper 只保留固定分类。

初期把“再次安装不同策略失败”概括为“所有嵌套 sandbox 都失败”过宽，已由同策略成功的对照纠正。最终对照没有安装更宽松的网络策略；第二个不同策略完整保留 loopback 限制且只增加文件写入拒绝。它不执行浏览器或网络 I/O，也不是 Chrome 验收。

## 原因与边界

已确认的直接原因是：受外层策略约束的 Chrome 在初始化自身 sandbox 时遭到权限拒绝。早期 CDP 可以短暂返回版本，但 GPU/network 子进程持续失败，最终浏览器退出，导致 CDP_CLOSED。增加 CDP 超时或重连不能修复这个初始化失败。

不同策略的最小对照也被拒绝，支持现有 macOS Seatbelt 后端与 Chrome 策略安装流程的兼容性问题。**尚未在 Apple 内核层定位具体拒绝条件，也没有证明所有不同策略、所有 macOS 或其他 Chrome 版本都不支持嵌套。** 本次已配置的本地环境没有可直接复用的运行中容器后端或 Lima 实例；未启动、安装或下载另一套虚拟化环境。

核验对应 Chromium155.0.8059.80 的维护源：

- [seatbelt_exec.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.80/sandbox/mac/seatbelt_exec.cc#174)：初始化入口读取并应用序列化策略。
- [sandbox_serializer.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.80/sandbox/mac/sandbox_serializer.cc#194)：源码和已编译策略分别走不同安装路径，失败返回拒绝。
- [seatbelt.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.80/sandbox/mac/seatbelt.cc#156)：封装 sandbox_init_with_parameters / sandbox_apply。

这些源码确认策略安装的结构，不单独证明本次二进制错误发生于哪个 API。现场签名没有输出 SOURCE/COMPILED，因此证据中的 policyMode 保持 NOT_OBSERVED。没有用 UA 版本或同策略对照制造“Chrome 已兼容”的结论。

## 本轮代码修正

- 新增 chrome-startup-diagnostics.mjs：有界、跨 chunk 行解析，仅识别固定 sandbox 权限拒绝签名；未知日志不猜测根因，不导出原始文本。
- browser-experiment.mjs 在识别确定启动拒绝时关闭本次 CDP、终止自己的 Chrome，报告 CHROME_SANDBOX_INITIALIZATION_DENIED；后续不注册脚本或运行场景。
- Chrome 可能早于 CDP 版本响应退出，所以先在同一网络约束内执行 `--version` 并记录来源；有 CDP 版本时明确记录 CDP_BROWSER_VERSION。版本命令或进程启动不代表页面场景通过。
- 新增 sandbox-compatibility.mjs：父 runner 附带本机同策略/更严格不同策略的独立原生对照；该信息不批准 GO，也不替代真实 Chrome 场景。
- 未改变 loopback.sb、网络门禁、GO 条件、实验权限或正式扩展；未增加任何关闭 Chrome sandbox、放行公网或启用 userScripts 的参数。

## 命令与验证

```sh
node --check experiments/userscripts-document-start/runner.mjs
node --check experiments/userscripts-document-start/browser-experiment.mjs
node --test experiments/userscripts-document-start/chrome-startup-diagnostics.test.mjs
node experiments/userscripts-document-start/runner.mjs --output experiments/userscripts-document-start/sandbox-evidence.json
git diff --check
```

新增定向测试4/4通过；真实 runner 退出2，stopReason=CHROME_SANDBOX_INITIALIZATION_DENIED；网络七项、生产和清理 PASS，A–F 全 UNKNOWN。静态/原生对照不写成 Chrome 机制通过。生产 TS、测试、依赖和构建输入不变，复用本会话既有 typecheck、npm test174/174 和 build 成功证据，不重复全量门禁。

现有约束内没有可交付的浏览器启动修复，本轮在此停止。没有禁用 Chrome sandbox、改变原有 loopback 策略、绕过 Allow User Scripts、修改用户设置或恢复生产注入。若以后采用替代隔离后端，仍须单独证明它保留 Chrome 自身 sandbox、通信仅 loopback，以及全部原有 GO 必需项；本任务没有启动该工作。
