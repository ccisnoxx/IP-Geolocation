# VG-038 真实 Chrome 回归

2026-10-23 用户授权继续验证 Intl/Date、Blob Worker、关闭配置后的注册清理及 iframe 重载提示，最初要求先汇总、不提交或推送；汇总后用户确认 Chrome138 验收通过，并授权整理记录后本地提交，仍不推送。本轮是 VG-038 的定向回归，不扩大 HTTP(S) Worker、SharedWorker 或其他暂停范围。

## 已完成实测

| 浏览器／平台 | 结果 | 原始证据 |
| --- | --- | --- |
| Chrome for Testing 138.0.7204.183／macOS arm64／有界面 | 774/774 断言通过 | [Chrome138](chrome138-evidence.json) |
| 当前 Chrome 155.0.8059.86／macOS arm64 | BLOCKED；仅原生基线和构建不变检查，未执行产品断言 | [Chrome155 未完成记录](chrome-current-evidence.json) |

维护采集器：[chrome-audit-regression.mjs](../../../scripts/chrome-audit-regression.mjs)。采样时脚本 SHA-256 为 `dbb654a6f5bebba0a510ef56ffac3f0bf811fe07bb457cbf5085eac435c1a96d`；dist SHA-256 为 `8f52e5493bb991fd8760095b4b769b7d02c4baffba786b90c09d84f73ca88207`（按排序后的相对路径及字节计算，不含 Chrome 生成的 `_metadata`）。证据另外绑定 Git 基线和四个关键维护源摘要；实际源包含采样时尚未提交的修复，不能仅由原始 JSON 中的 Git 基线判断构建身份。

提交前暂存 diff 检查发现采集器末尾多余空行，最终文件仅移除一个换行字节，SHA-256 为 `ef38425c6daaecdfdc9e03357dfe3303fb23df924f1cb49fc7b4ba029a5d6201`。已核对最终文件追加一个换行即可精确复原采样脚本；执行内容未变，语法检查重新通过，未因此重跑浏览器或改写原始 JSON。

## 安装与数据边界

- 使用独立临时 profile 和真实浏览器进程；通过原生扩展管理页的加载按钮选择当前 dist，再正常开启 Allow User Scripts。没有使用 loadUnpacked 调试接口、加载扩展启动参数、偏好文件写入或安全策略放宽。
- CUA 完成正常 UI 操作；CDP 用于实际网页／Worker 观测、完整重载、现有扩展管理消息和只读注册核验。不在页面或 Worker 内显式安装运行时补丁，不暂停或替换生产 API。
- 安装前取得同一浏览器的原生基线和 Intl locale 协商结果。配置仅写本轮临时扩展，规则仅 localhost，使用合成语言／时区／零坐标；不调用出口 provider、真实位置、ICE 或外部测试站点。字体和定位只为验证所属注册清理而启用，不据此宣称完成字体效果或定位回调验收。
- 夹具流量限于 HTTP 回环；Chrome 自身后台网络未全量监控。证据保存实际观测、布尔结果、回环匹配范围及哈希，没有精确公网 IP、真实位置、凭据或个人绝对路径。

## 四个重点的观测

1. Intl/Date：strict 法语／巴黎、compatible 英语／洛杉矶、compatible UTC 三组。页面首业务脚本、Blob Worker 每层及 module 静态依赖均执行构造合同探针；验证 Date 零／单／多参数子类与自定义 NewTarget、直接调用、8 类 Intl 构造器集合及子类、必须 new、legacy receiver 与重复初始化、默认及显式时区。UTC 组验证年份 0、1、9、50、99、100 的 epoch／墙钟字段／偏移／年份字符串；数字构造仍保留 1900 年映射。
2. Blob Worker：每组运行 classic/classic、classic/module、module/classic、module/module 四条三层链，业务首读、module 依赖首读与提前消息一致；同时验证构造后立即撤销原 URL、classic/module 业务异常、构造前撤销、立即 terminate 后 400ms 无消息。SharedWorker 仅检查构造器引用文本与原生一致，不构成共享连接功能验收。
3. 关闭配置：实际清理前有语言／时区和定位 userScripts、字体 content script、旧 bootstrap 和 dynamic 40000/40001。关闭同步后，仅保留两个特意加入的无副作用无关命名空间 sentinel，所属注册及动态头规则清空。旧页面随后新建的 Blob 仍使用该文档 UTC 快照；完整 reload 后页面与 Blob 恢复原生，重新启用后仍需完整 reload 才恢复洛杉矶快照。
4. iframe：顶层 127.0.0.1 未匹配，嵌入的 localhost 子帧匹配。仅把 UTC 改为洛杉矶，DNR 投影未变；后台记录该顶层 tab 的 page 重载债，子帧旧 token 和 UTC 保持。正常完整重载 Options 后，实际 UI 显示 reloadRequired 专属提示“已有受影响页面需完整重载（reload）或关闭后重新打开”；再完整重载父页面，子帧更换 token 并使用洛杉矶、冬季 offset 480。

## 证据复核与限制

- Chrome138 最终 status=PASS、completed=true、errors=[]，774 项名称不重复且全部通过；dist 在整个验收中未变。浏览器主进程退出、临时 profile 移除、回环服务关闭均记录为 true。
- Chrome155 的电脑控制工具只能选中既有个人 Chrome，无法准确操作新开的临时实例；因此未在该临时实例正常安装扩展或开启 Allow User Scripts，未执行产品断言。最终 status=BLOCKED、completed=false，唯一检查为 dist 未变；这既不是产品通过证据，也不是产品失败。用户随后明确选择先汇总 Chrome138。155 临时浏览器、profile 和回环服务均已清理，个人 Chrome 未作导航、安装或配置修改。
- 两份 JSON 的 environment.installation／userScriptsSwitch 是采集器预设的流程说明，不是安装或开关完成标记；138 的完成证据来自后续注册／生产观测及正常开关读回，155 没有这些完成证据。
- 独立只读复核直接重算三组的 36 个 Worker 入口与 18 个 module 依赖的完整观测，以及关闭注册前后、iframe 快照和专属 UI 文案，均与采集断言吻合。切换阶段的临时链路对象和 metadata 本体未单独落盘，因此这些部分以现场断言结果和脚本逻辑为证，不宣称每项均可从 JSON 独立重算。
- 采集器在正式运行前经独立检查，修正了旧 UI 文本可误判 PASS、缺构造器集合断言、显式时区漏验、证据写失败阻断清理及启动错误处理等采集缺陷；没有为此修改生产源码。第一轮 Chrome155 仅完成准备与原生基线，未安装扩展或运行产品断言，不计入通过结果。
- 未覆盖 HTTPS、其他平台、所有 Chrome 补丁版本、完整浏览器重启／BFCache／崩溃恢复、底层 API 故障注入、完整 CSP／Trusted Types 矩阵或任意内存泄漏证明。旧 bootstrap 清理的真实 Chrome 覆盖是正常撤销；拒绝／虚假成功等故障路径仍以已有 Node/mock 回归为证。
- 用户已于 2026-10-23 人工验收 Chrome138，并授权整理记录后本地提交；Chrome155 补验仍未完成。该验收不构成 release-ready 声明，不改版本、不重建发布 ZIP、不推送、tag 或发布。

## 本地检查与证据身份

- 本轮重新执行 `npm run build`、`node --check scripts/chrome-audit-regression.mjs` 和 `git diff --check`，均通过。
- 源码、测试、构建脚本及依赖配置的输入摘要保持 `7a8db2f28dc425c1bb400342bc2d0c4c9f867a38c3d0496e2b074f81cb2ce52d`，复用上一阶段 `npm run check` 的源码／测试类型检查、336/336 Node 测试和构建通过证据；未将其冒充本轮重跑或真实 Chrome 结果。
- Chrome138 原始 JSON SHA-256：`621c03ea34bd613f9102d3595fad44d12e7ae197fde8e3cb15be0baf1038be85`。Chrome155 未完成记录 SHA-256：`c9b62f10cccafdc874c37c1757c981decf60e1a9520eb3b16f9d34581761b0f8`。
- 另用合成的不存在 Chrome 路径验证采集器启动失败会记录 BLOCKED、清理服务和临时目录、删除控制文件且脱敏错误路径；该边界检查不是产品回归。
