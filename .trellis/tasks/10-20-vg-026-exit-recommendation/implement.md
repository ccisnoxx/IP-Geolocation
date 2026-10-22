# VG-026 验收收尾记录

## 2026-10-22 记录恢复与当前核对

用户授权优先处理VG-026验收收尾，延续不改代码、不push边界。本轮未修改生产源或测试，不暂存、不提交；状态保持review，人工验收pending。

原任务目录在当前工作区不存在，`git log --all -- <任务目录>`没有记录；当前可见Git历史未找回原始文件。本目录依据task-manifest、当前维护源和本轮实测重建，不能冒充原始设计或Chrome证据。

核对基线提交：`a63ed8c`。

| 验收点 | 当前依据 | 结论 |
| --- | --- | --- |
| 推荐无网络、Chrome API访问或输入修改 | exit-recommendation纯函数及测试 | Node通过 |
| countryCode来自同次provider响应明确字段，未知不猜 | background-services解析及确认测试 | Node通过 |
| 打开、查看、修改推荐不检测或保存；选择变化撤销旧确认 | Options维护源VM | VM通过 |
| 未确认、页面非管理来源、过期或未verified档案拒绝 | 后台消息及事务测试 | Node通过 |
| 所选规则合并，保留其他规则和全局配置 | 后台并发保存、重复应用测试 | Node通过 |
| 明确选择地区语言、全局字体/WebRTC；默认保留 | 推荐、Options VM及后台测试 | Node/VM通过 |
| 总开关及全局策略影响提示，保存与partial区分 | Options HTML/维护源及VM | 静态/VM通过 |

命令：`npx tsx --test tests/exit-recommendation.test.ts tests/onboarding-ui.test.ts tests/background-services.test.ts`。本轮结果：73 tests，73 pass，0 fail，0 skipped。测试采用合成档案和mock，不发真实provider定位请求，不操作个人浏览器。源码与测试未变化，完整类型检查、280项回归和构建复用VG-032最终候选已记录证据；本轮未重新运行全套检查。记录整理后执行git diff --check。

## 证据缺口与人工验收边界

稳定化README提及历史Options八项PASS，但原始chrome-evidence.json缺失；现存脚本不等于执行证据，本轮不将该历史摘要计为已核验PASS。未运行真实Chrome，不操作历史用户现场、不重复旧隔离实验，不宣称覆盖真实action Popup、Chrome138、其他OS或真实provider精度。

VG-025、VG-029和VG-032后续已有各自限定范围人工验收。它们不替代本任务推荐启用字体后实际过滤、关闭/撤销后新文档原生的联合证据，也不证明旧VG-025现场根因已确认。旧文档关于全任务状态的2026-10-21描述为历史阶段；当前状态只以task-manifest为准。

当前建议：可就上述推荐与确认事务进行人工审阅；若验收要求包含真实浏览器完整推荐流程，应先补齐当前构建的独立Chrome证据，明确覆盖Options操作、实际页面应用及关闭恢复，再确认对应范围。未获得人工通过前不标记done。本轮未发现已执行测试中的代码故障。

## 2026-10-22 当前构建真实Chrome补验

用户明确授权继续补跑Options推荐、明确应用、页面实际生效及关闭恢复，暂不提交或push。本轮仅扩展验收脚本与记录，不修改生产代码。旧暂停取证描述是前阶段记录；本节是用户本次新授权下的独立临时环境验证，不重开旧个人Chrome现场。

正式证据：[chrome-evidence.json](chrome-evidence.json)，结果 **PASS，17项检查全部通过，cleanup PASS**。有界面Chrome for Testing **149.0.7827.55**，macOS，独立临时profile；当前dist由 `npm run build` 生成。浏览器验证前后维护资产SHA256为 `c659b709bcdaae0c716bbd5e6f318d85dc7a3afe46d74479be2f10f0038fd0ba`（排除Chrome生成的_metadata），与已通过完整门禁的VG-032生产候选一致。

复现方式：创建空的临时信号目录，设置CHROME_BIN为有界面Chrome可执行文件，运行：

```sh
node scripts/chrome-exit-recommendation-smoke.mjs --page-effects --ui-signal-dir <本轮空临时目录> --output .trellis/tasks/10-20-vg-026-exit-recommendation/chrome-evidence.json
```

脚本显示 `VG026_NATIVE_UI_REQUIRED allow-user-scripts` 后，在该临时Chrome的扩展详情页正常打开“允许运行用户脚本”，确认开关开启，再在临时目录写入 `user-scripts-enabled` 文件。脚本另以userScripts API确认可用。扩展通过CDP `Extensions.loadUnpacked` 加载；Options由真实页面DOM事件驱动，不把它表述为原生鼠标逐项操作，也不表述为正常安装后的冷启动资格验证。

流程：无扩展原生基线 → Options默认值、未确认拒绝、主动检测确认 → 查看推荐无保存 → 保留语言并明确保存 → 用户脚本关闭时准确partial → 明确选择日语及固定字体 → 原生UI启用用户脚本 → Options明确选择compatible WebRTC并再次应用 → 首inline与HTTP实际值 → 未匹配页面对照 → Options总开关关闭并保存 → 新文档原生及注册撤销。

| 观测 | 原生基线 | 推荐生效 | 总开关关闭后新文档 |
| --- | --- | --- | --- |
| language / languages | zh-CN / [zh-CN] | ja-JP / [ja-JP, ja] | 与原生相同 |
| Intl时区 | Asia/Shanghai | Asia/Tokyo | Asia/Shanghai |
| 导航及同源子请求Accept-Language | zh-CN,zh;q=0.9 | ja-JP,ja;q=0.9 | 与原生相同 |
| PingFang SC字体check | true | false | true |
| Times New Roman文本测量宽度 | 174.703125 | 180.5439453125，与sans-serif一致 | 174.703125 |
| 通用sans-serif / serif测量 | 原生数值 | 保持原生数值 | 保持原生数值 |
| WebRTC浏览器策略 | default | default_public_interface_only，由扩展控制 | default，释放控制 |

未匹配的127.0.0.1页面所有采集值与localhost原生基线一致。生效时同步报告ok，页面及字体ready、headers ok；关闭后userScripts、contentScripts、dynamic和session规则均为空。只比较本表实测surface；geolocationAvailable仅检查方法存在，不代表位置或权限语义验证。WebRTC核验privacy策略，不等于ICE泄漏测试。

取证顺序复核：首轮使用getSiteConfig检查状态，该消息可能触发对账，因此没有保留为最终依据。最终轮改为Options保存回包结束、UI状态ok后，仅直接读取storage与浏览器设置，再创建探针页面；期间不发getSiteConfig或其他管理对账请求，避免检查操作代替UI保存完成同步。最终正式JSON来自修订脚本的全新临时profile完整运行。

隐私与清理：唯一一次主动provider请求在CDP Fetch阶段拦截并以合成保留地址、0/0坐标及JP/Tokyo响应满足，未向provider传输；页面fixture仅绑定loopback，不包含配置预期值。Chrome自身后台网络未全量监控。临时profile删除、Chrome主进程退出及loopback服务关闭；额外进程核对未发现本任务临时Chrome主进程残留。未操作个人Chrome配置。

检查：本轮 `npm run build`（含源码类型检查）、脚本 `node --check`、JSON断言及 `git diff --check` 通过。生产源和单测输入未变，复用前轮73/73定向和VG-032完整280/280、测试类型检查证据；不宣称本轮重新执行完整单测。

限制：仅上述macOS/Chrome149、HTTP顶层新文档；未覆盖iframe、BFCache、完整退出重启、Chrome138、其他OS、TLS、真实provider精度或action Popup。旧用户现场根因仍不由本轮推定；旧Chrome证据未找回的事实保持。本轮已补齐所请求流程的独立Chrome证据，等待用户人工验收，状态review；无暂存、提交、push或发布。

## 2026-10-22 人工验收确认

用户明确确认：“这轮 VG-026 验收通过，把它标记为 done，补充人工验收记录并提交相关改动，仍然不要 push。”据此同步唯一任务清单和本任务状态为done，并授权相关验收脚本、证据及文档的本地提交；不push、不打tag、不发布。

验收覆盖本轮Options推荐与明确确认、所选站点实际语言/时区/请求头/字体生效、WebRTC策略，以及Options关闭总开关后新文档恢复原生。正式Chrome149证据17项PASS、cleanup PASS；本节不扩大前述浏览器、文档类型或网络覆盖范围，历史原始记录缺失与旧现场根因限制保留。

本次收尾仅更新状态和人工验收文档，脚本、生产源及测试输入未变，复用前述真实Chrome、构建、73/73定向测试及完整门禁证据。此前review、pending和未提交描述保留为历史阶段记录，以本节为当前验收结论。
