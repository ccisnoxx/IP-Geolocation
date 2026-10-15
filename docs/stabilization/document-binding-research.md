# VG-015：最终文档绑定机制与浏览器资格研究

日期：2026-10-15；阶段R5。状态、依赖以[manifest](./task-manifest.yaml)为准。**当前恢复资格为NO_GO，生产安全暂停保持。** 研究交付完成不表示存在合格恢复机制，也不表示浏览器缺陷已修复。

## 当前结论

- 本机唯一可用Chrome为155.0.8059.40（macOS arm64，headless）。本轮断开CDP的原生扩展再次复现旧documentId在MAIN、ISOLATED及导航一秒后命中替换文档。随机不存在ID拒绝，当前文档和当前iframe精确命中，排除了“全部ID都失效”的错误解释。
- 唯一增加`--disable-features=BackForwardCache`的诊断对照拒绝旧ID，当前文档仍正常。该flag不进入生产，也不是恢复方案。
- 当前正式dist的安全暂停重新通过BFCache实际恢复、跨origin、同URL reload、配置保存/同签名重试及真实后台stop/wake的零派发检查。
- 已读取对应tag和本次main固定提交的四个Chromium源文件，所检路径仍将documentId降为frameId、执行层再解析当前host。没有取得能用于本项目恢复的可信执行机制或已验证修复浏览器构建。
- 本结论不声称所有其他发行版本都受影响，也不声称上游不存在修复；本轮没有安装、编译或执行其他版本。

## 可复现命令与正式证据

从仓库根执行，`--output`可改为新系统临时位置，避免覆盖保留证据：

```bash
node scripts/runtime-modularization/document-targeting-investigation.mjs --native-only --output .trellis/tasks/10-15-vg-015-document-binding-research/chrome-evidence.json
node scripts/runtime-modularization/document-targeting-investigation.mjs --native-only --disable-bfcache --output .trellis/tasks/10-15-vg-015-document-binding-research/control-evidence.json
node scripts/runtime-modularization/chrome-safety-gate.mjs --output .trellis/tasks/10-15-vg-015-document-binding-research/safety-gate-evidence.json
node scripts/recovery-research/collect-upstream.mjs --output .trellis/tasks/10-15-vg-015-document-binding-research/upstream-evidence.json
```

四条本轮均exit0。前两条退出0是采集成功：默认`documentTargetSafety=FAIL`，禁用BFCache对照为PASS，后者不是生产安全通过。第三条`extensionGate=PASS`、生产派发0；第四条采集8文件、0 unavailable及安装类型0.0.268。

复用的旧runner在JSON中仍标记task=VG-011，不改原runner或历史JSON；上述新路径和本任务执行记录标识本轮采集。[默认反例](../../.trellis/tasks/10-15-vg-015-document-binding-research/chrome-evidence.json)、[flag对照](../../.trellis/tasks/10-15-vg-015-document-binding-research/control-evidence.json)、[正式暂停闸门](../../.trellis/tasks/10-15-vg-015-document-binding-research/safety-gate-evidence.json)、[固定源码与类型索引](../../.trellis/tasks/10-15-vg-015-document-binding-research/upstream-evidence.json)。

原生实验无bundler，ID、导航、Chrome API调用均由扩展自身产生；CDP断开后本机readiness才放行。原生本轮为同origin旧/新路径，没有声称本轮重新测量完整旧生产payload错投；跨origin旧payload影响仍引用[历史生产调查](./document-id-investigation.md)。当前生产三场景测的是零派发，不是恢复后的功能。

## 固定源码依据

官方tag155.0.8059.40解析为`cfaadc5a132d78e1828635aa8405a499f3e14864`；本次main解析为`a8bee654ee5bcb9d747e9307384921b5bc403e93`。main不是发行版资格证据。JSON保存每个文件固定URL、SHA-256、符号行号；复跑collector会重新解析main，重现本次源码应使用JSON中的固定URL并核对摘要。

| 所有者与位置 | 实际控制流 |
|---|---|
| [scripting_utils.cc](https://chromium.googlesource.com/chromium/src/+/a8bee654ee5bcb9d747e9307384921b5bc403e93/extensions/browser/scripting_utils.cc#75)，75–107 | 由documentId查host，只在该段检查存在/所属tab，然后转frameId |
| [extension_api_frame_id_map.cc](https://chromium.googlesource.com/chromium/src/+/a8bee654ee5bcb9d747e9307384921b5bc403e93/extensions/browser/extension_api_frame_id_map.cc#111)，111–158 | 顶层frameId解析primary main frame，子帧查当前frame-tree-node；documentId映射仍可返回旧host |
| [script_executor.cc](https://chromium.googlesource.com/chromium/src/+/a8bee654ee5bcb9d747e9307384921b5bc403e93/extensions/browser/script_executor.cc#61)，61–137 | 按frameId重新取host，包含live/error-page检查，但所检接口未携带预期Document身份作最终等值条件 |
| [scripting_api.cc](https://chromium.googlesource.com/chromium/src/+/a8bee654ee5bcb9d747e9307384921b5bc403e93/extensions/browser/api/scripting/scripting_api.cc#361)，361–386 | 访问检查后向执行器传frame IDs |

tag与main的utils、frame-map、scripting-api字节摘要相同，executor摘要不同；读取差异后没有把新增错误页面检查误当文档绑定修复。上述是维护源控制流审查，不是对本机binary逐指令调试，也不是全仓库/全历史证明。

## 受影响入口与候选取舍

生产恢复入口是`src/background/services.ts`的initializeRuntimeForSender；目前在payload读取之前拒绝，且后台不打包runtime。runtime的getAntiDetectionState会创建隐藏state并修改反射API，因此未来拒绝必须早于该调用，而非等安装之后检查结果。

`src/background/diagnostic-runs.ts`的sample、子帧采样、临时帧创建/清理也使用documentIds并在返回后核对。返回核对保护结果交付，不能证明采集函数没在替换文档执行。这是静态确认的同API影响面，本轮未复现新的诊断漏洞、不修改诊断行为；恢复机制资格研究必须把这些有副作用的入口列入后续定向验证，不能把当前零runtime派发扩大为全部scripting调用为零。

| 候选 | 本轮判定 |
|---|---|
| 浏览器保留Document身份并在最终执行前核验 | 推荐方向；尚无本轮验证合格的构建，不能进入VG-016生产恢复 |
| URL/origin前置限制 | 仅有附加范围限制作用，不能区分同URL新Document |
| ISOLATED前置采样、后台epoch、nonce | 可减少过期工作，采样到执行间仍有导航窗口，不能充当最终身份 |
| InjectionResult事后核对 | 有诊断价值，无法撤销已经执行的hook或采集 |
| frameIds/files/另一个world、全局禁用BFCache | 不符合当前安全恢复目标；不采用 |

## 恢复门槛

1. 具体浏览器构建或等价可信机制有可审计依据，预期Document身份保留至最终执行；同一RFH复用、导航、销毁、冻结/恢复不会把旧调用重定向给替换文档。仅拒绝旧host不活跃或仅检查frame ID不够。
2. 当前合法Document正向成功；BFCache、跨origin、同URL reload、iframe替换和移除重建负向均不向替换文档交付payload/安装任何state、反射代理、hook、timer或worker wrapper。
3. 既覆盖API调用前延迟窗口，也补充API接收后到执行前的窗口证据；不能仅凭现有wrapper认为后者已验证。冻结时拒绝，不缓存待未来新文档执行的授权。
4. 明确配置变更/规则撤销与初始化提交顺序；过期后台任务失效，BFCache恢复重新核验当前配置。已派发调用和旧hook的不可撤销范围继续明示。
5. 针对拟支持的实际浏览器/OS取得真实证据；未知环境继续暂停，不按网页值、UA大版本或一次自检放行。当前最低Chrome119不因此改动，也未取得119资格。
6. 独立只读安全复核及人工恢复授权齐备。满足文档绑定仍不满足首脚本保证，须结合[VG-017](./earliest-inline-research.md)作能力决策。

## 限制、安全与后续

只运行当前headless Chrome；未做修复binary、Chrome119/其他版本、自然竞态频率、完整iframe/原生执行队列矩阵、诊断副作用错投复现。研究NO_GO是有效研究结论，任务可进入review，不以blocked掩盖已完成交付。

实验使用专属临时profile和loopback fixture，无真实provider、位置、header echo或STUN。官方源码下载只发送公开源码URL，正式JSON无文档ID、个人路径、真实IP或配置；源码副本/浏览器资源收尾删除。生产权限/schema/storage/版本/dist均未变。

下一步只有候选可信机制或修复构建出现时才开展对应资格验证；不启动VG-016/018/019，不提交上游issue或修改任何远端状态。回滚只撤销本轮研究脚本、文档和记录增量，保留VG-011暂停及历史负向证据。

## 研究人工验收（2026-10-15）

用户确认VG-015研究验收通过，接受当前NO_GO结论及已知限制，见[人工验收记录](../../.trellis/tasks/10-15-vg-015-document-binding-research/implement.md#人工验收)。manifest现为done，Trellis为completed；研究验收不改变NO_GO，也不授权恢复或发布。生产伪装继续暂停，不启动恢复实施，不改版本、不提交、推送或发布。原始实验结果、恢复门槛和未验证范围保留。
