# VG-044 审计与清理证据

## 基线与范围

- 2026-10-28，基线 `567f65f`，初始工作区干净。
- 依赖 VG-040、VG-042 均为 done；已合入基线的 VG-043 仍为 review，本轮不代替人工验收。
- 基线源码和测试类型检查通过；`npm test` 398/398 通过，0 skipped、0 todo。
- workflow、get_context.py、frontend spec 正文实际缺失，按 AGENTS、现行源码、构建及任务合同审计。
- 三个并行只读子代理分别核对应用代码、测试和运行时/工具；主代理负责证据核对与实施。

## 删除前证据

以下证据先于对应源码/测试删除建立；行号针对基线。引用检查包含 src、tests、build、scripts、experiments、fixtures、文档与工作流。

| 编号 | 候选与证据 | 保留覆盖 |
| --- | --- | --- |
| D01 | `src/popup/popup.ts:2` 导入 ENVIRONMENT_PRESETS，但模块中仅此一次出现；真实卡片事件使用 findEnvironmentPreset → presetSignals。`font-exposure.ts:3` 导入 FONT_SIZE_PATTERN，但本模块仅此一次出现。额外 TypeScript noUnusedLocals/noUnusedParameters 精确报告这两个未读取导入。只移除导入绑定，不删除其权威定义。 | 预设查询、DOM 卡片和字体解析/测量测试保留；脚本、共享字体策略仍消费这些定义。 |
| D02 | `environment-presets.ts:41-68` 的 applyEnvironmentPreset、presetCardInfo 只有本模块定义、environment-presets.test 专属调用及 browser-validation.md 说明。Options 中同名按钮变量不是函数消费者。真实两页 UI 走 findEnvironmentPreset → presetSignals → applyQuickSetSignals → readForm → 保存。 | 删除旧 helper 专属两项测试前，迁移三信号、国家、非目标配置保留、校验/往返及不修改原输入断言到真实 UI 保存路径；保留未知预设、HTML 卡片文案、presetSignals 和 verified 出口测试。 |
| D03 | `options.ts:350-351,375-376,384-385` 三处刷新同一出口选择器，其他确认检测、重检、删除、导入、重置只调用 populateForm 而遗漏刷新。将同一刷新迁到 populateForm 后，这三处重复调用失去独立作用。 | 新 UI 回归覆盖确认检测后即时启用选择器及移除后禁用；原保存、引导、档案及导入/reset 测试保留。 |
| D04 | `config-model.ts:589-595` 的 formatTimezoneOffsetMinutes 全仓只有定义，未被测试、UI、脚本、构建引用；Popup 的实际偏移显示由 getTimezoneOffsetMinutes 和本地 updateTimezoneOffset 完成。 | 现行时区/夏令时解析及 Popup 状态测试保留。 |
| D05 | `shared/canvas-fonts.ts:8-23,52-54` 两张 ONLY_FAMILIES 表只被 canvasImpossibleFamilies 使用，后者只被 canvas-fonts.test:58-59 的两条数组包含断言调用。运行时实际使用 WINDOWS_TO_MACOS、MACOS_TO_WINDOWS 和 canvasFontReplacementMap，平行数组不参与执行。 | 保留生产映射、字体替换、check、门禁及生成产物行为测试；新增参数边界回归。仅移除两条退役数组断言，不删除所在测试。 |
| D06 | `canvas-fonts.test.ts:34` 对临时 realm().root 安装补丁后立即丢弃；断言使用 :36 新建且 :37 另行安装的 patched 对象，没有读取前一个 realm。 | 整项测试保留 native 对照、补丁效果、字体恢复与非目标透传。 |
| D07 | `font-exposure.ts:20-33` 的局部 observeConversion 是已验证的单次原生参数转换观察实现。Worker/Canvas 修复需要同一合同，提到相邻共享 font-conversion 模块后移除局部副本，三个入口使用同一实现。 | 保留 anti-detection-runtime 对 getter/this/hint、单次转换、异常、重入和反射的全部回归，新增 Worker/Canvas 同类边界回归。 |
| D08 | `smoke-fingerprint.mjs:8-9` 的 existsSync、join 无调用；:53 与 :56 对象字面量重复 URL 键且值相同。VM 初始化的宿主 Date/Intl 等共享绑定导致跨 realm 污染，移除这些注入使各 context 使用自身内建对象。 | 工具、package 入口及正负测试保留，补逐上下文预期值和 no-op/错值负例；以真实 Blob Worker bootstrap 生成器代替页面函数冒充 Worker。 |
| D09 | `offscreen-fonts.ts:53-91` 的 applyFallbackFont/restoreFont/findFontDescriptor 是旧 measureText 包装器专用路径，在参数转换之前查找 receiver 字体描述符，不能处理转换回调改字体，并可能读取伪造 getter。用安装时捕获的原型 get/set 及转换后选择字体替代后，旧三个 helper 已无调用；旧 restore catch 会吞掉恢复失败，也随替代退出。 | 保留测量后恢复测试，新增非法 receiver 不读页面 getter、转换副作用、重入、异常及单次转换回归；不增加独立补丁路径。 |

## 已确认缺陷与修复

| 编号 | 触发、根因与修复 | 实际证据 |
| --- | --- | --- |
| F01 | 两页快速设置丢弃 signals.country，导致新坐标携带旧国家。现在与同批坐标更新 readForm 沿用的国家字段，保留其他配置。 | 新 quick-set-ui 执行真实维护源事件、解析及保存路径，覆盖预设与 verified 出口两种入口。 |
| F02 | Popup 快速设置直接丢弃 saveChanges Promise，后台拒绝后不进入现有错误处理，状态停留 pending。改为既有 runUiTask。 | 真实卡片事件配合后台拒绝，验证失败状态、错误消息和 toast。 |
| F03 | Options 快速出口选择器仅在三个调用方刷新，确认检测、重检、删除、导入、重置后可能过期。统一从 populateForm 刷新并去掉重复调用。 | 无档案初始化、confirmDetection 得到 verified 后立即可用，移除后再次禁用。F01–F03 新增 9 项回归，修复前 6 失败，修复后 9/9 通过；与原 UI/规则/预设定向共 36/36 通过。 |
| F04 | ui-state 仅凭部分 payload 提前声称语言已应用和请求头一致，遮蔽 unknown、暂停、缺权限、关闭、注册失败和重载欠账。改为先显示运行状态，再区分可用配置与实际同步；headers 缺失或失败不再推定成功。 | 修复前增强回归 2 失败；修复后 p0-language-decoupling/ui-state 共 15/15 通过。保留部分语言解析和请求头来源一致性的原测试。 |
| F05 | Worker 的 check 漏掉对象参数转换结果，Canvas 的 check 提前 false 跳过品牌/参数异常，两个包装器还将缺参变成显式 undefined。先执行原生校验，转发完整 arguments，观察同一次转换结果再过滤。 | 原生桩先证明目标可见 true，再断言补丁 false，并保留非目标原生 false；加入非法 receiver、缺参、Symbol、第二 text 参数异常、getter/this/hint 和单次转换。 |
| F06 | Worker/Canvas 测量在 text 转换前选字体，转换回调可改字体而穿透，或看到临时后备字体。复用页面既有转换合同，在用户代码返回 primitive 后选择本次字体，finally 恢复转换后的字体。 | F05–F06 定向 26 项在修复前 11 失败、15 通过；修复后 26/26，页面既有字体回归另 10/10 通过。 |
| F07 | smoke-fingerprint 共用宿主 Date/Intl，且只比较样本相等，可把全未打补丁当成功。改用各 VM 自身内建对象、真实页面/Blob 生成入口，逐样本对 payload 和独立 offset 参考核对，再比较一致性。 | 对基线工具做全 no-op 负对照，实际 exit=0、consistent=true、worker.language=zh-CN（预期 ja-JP）。当前回归会拒绝全 no-op 和遗漏 Worker 补丁，并验证宿主方法不被修改。 |
| F08 | persona-build 测试每次成功或预期拒绝都遗留临时目录。保留所有测试，用 finally 删除本次 mkdtemp 的目录。 | persona-build 与 smoke 工具定向通过；仅删除各次测试自己创建的临时目录，不清理无法确认归属的旧目录。 |

独立复核指出新增 smoke 比较器的 strict 别名误报：`Asia/Kolkata` 被要求等于 Node 的 `Asia/Calcutta`，小写 locale 也被要求等于规范化名称。新增回归先失败，再按既有 strict/compatible 合同分别比较配置字面值或原生名称；空备用语言列表按生产回退为主语言。最终 smoke 定向 5/5 通过。这个问题属于工具参考预期，未修改生产 Intl 合同。

转换依据复用既有页面实现，并核对 [Web IDL DOMString](https://webidl.spec.whatwg.org/#es-DOMString)；VM 隔离依据 [Node VM context](https://nodejs.org/docs/latest-v24.x/api/vm.html#vmcreatecontextcontextobject-options)。没有引入新依赖、权限、Worker 范围、schema 或持久化迁移。

## 明确保留与限制

- 没有整文件删除 runtime、实验、fixture 或自动化测试，也没有新增 skip/todo。两个仅服务退役 helper 的旧测试先迁移断言到真实 UI 路径；其他相似测试覆盖不同输入、错误、恢复或注册合同，保留。
- 完整 runtime/Worker graph 仍被构建自包含守卫、隔离测试及手动 runner 消费；文件型 Worker 字体 hook 保留为维护实验，生产不派发，旧前缀仍用于撤销残留。
- 配置/存储迁移、DNR 所有权与历史规则清理、verified 身份和旧数据默认值继续保留。空 content 入口仍有 Vite/产物审计消费者；getContentScriptMatches 的独立域名边界测试尚未建立等价替代，本轮保留。
- Canvas 平台映射与固定 43 项过滤组合时，部分中文字体可能落到后备字体，不能保证独立 Canvas 映射的等价字体宽度。保持既定过滤合同，修正文档，不通过缩减名单改变优先级；未来如要求不同结果，需要先确定合同。
- 字体只随已有语言/时区 Blob Worker 链传递；仅开字体不会建立 Worker 链。HTTP(S) Worker、SharedWorker、外来 Blob、自定义名单及既有其他未覆盖边界未恢复。
- workflow/spec 正文缺失仍未解决；没有为了清理任务重建工作流。VG-043 仍为 review，本次不签收它的功能或历史浏览器证据。
- 本次没有运行真实 Chrome、修改个人浏览器配置、重建发布 ZIP、提交、推送、打 tag 或发布；Node/VM、构建和 dry-run 不代表 Chrome 验收。
- 未采集行/分支覆盖率百分比。测试总数用于说明迁移与回归增量，不能代替覆盖率或无缺陷证明；没有逐行证明所有历史浏览器 runner。

## 验证

- 第一轮完整 npm run check：423/423 通过，源码/测试类型检查和构建通过。
- 随后仅修正字体包装器两处静态未用参数名称，复跑字体 26/26、构建与 Chrome dry-run；额外开启 noUnusedLocals/noUnusedParameters 的源码及测试 TypeScript 检查通过。
- 独立复核的 smoke 别名修复后，最终完整 npm run check：424/424 通过，0 失败、0 skipped、0 todo；源码及测试类型检查、构建均通过。最终未用绑定检查和 git diff --check 通过。
- 独立只读复核确认删除消费者与迁移覆盖、UI 状态顺序、字体转换及恢复无剩余阻断；唯一 P2 工具别名问题修复后，对两个原失败 CLI 反例分别复测，均 exit=0、consistent=true、failures=[]。
- 本地实现验证结束，manifest 与 task.json 均为 review，人工验收 pending；VG-043 的 review 保持。没有提交、推送或发布操作。
