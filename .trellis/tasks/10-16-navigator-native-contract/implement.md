# 实施与验证记录

## 范围与生命周期

本次为用户在 2026-10-16 明确授权的兼容性和隐私修复，独立于已验收的稳定化清单；未启动其他任务，未改 manifest/权限、配置解析/持久化、DNR、WebRTC、后台生产暂停或版本，未提交/push/发布。

页面 RuntimeState 和 Worker 原生快照仅由闭包持有，移除所有全局 Symbol marker、descriptor/source 缓存以及 Object/Reflect/Function.prototype.toString 替换。原生反射直接报告当前对象。Navigator getter proxy 只处理当前 navigator，其他 receiver 继续原生调用。

applyVanishGeoRuntime(payload) 返回私有 RuntimeController.update(payload)。同安装的更新维持页面 getter 身份、SharedWorker URL Map 与代理，只更新未来 Worker；独立序列化调用不再共享状态。页面 graph 以 IIFE namespace 静态封入外层函数并返回句柄；Worker 保持独立序列化。句柄不能通过 Chrome scripting 的 JSON 结果传回，也不得发布至网页全局；未来生产恢复的句柄/授权生命周期必须另行设计，当前无生产使用者。

## 已执行验证

- `git diff --check`：通过（候选实现阶段；最终交付前再查实际 diff）。
- `npm run check`：通过；src 严格类型、tests 严格类型、174 项 Node/VM/mock/静态测试、Vite 构建全部成功。包括暂停初始化、可信 sender、生产不派发的已有测试。
- 新增 `tests/navigator-contract.test.ts` 与自包含 `tests/helpers/navigator-contract.ts`：页面、独立 iframe realm、实际生成 Worker prelude；原生反射引用/flags/不可构造、global own keys（原生快照/Proxy/跨 realm）、getter 位置/shape/receiver、descriptor 替换/ToPropertyKey/删除/freeze。
- 用 `git show HEAD:<path>` 在操作系统临时目录重建修复前 runtime，并运行同一探针。反例实际触发：noNewGlobalKeys=false、reflectionUnchanged=false、reflectionNotConstructible=false、changedDescriptor=false、frozenDescriptor=false。临时源已删除。
- `node --import tsx scripts/chrome-navigator-contract.mjs`：Chrome 155.0.8059.80 通过。页面、同源 iframe 合法跨 realm receiver/反射，classic/module Dedicated Worker 与 SharedWorker 全部通过；私有 CDP objectId 持有更新句柄，未来 Worker 变为新合成语言、当前页面保持初次语言；descriptor 替换/删除/freeze 和全局无状态/原生反射通过。

首次 Chrome 检查在最后一次页面 own-key 检查失败，原因是测试脚本顶层声明 collectWorkers 自身增加 window key。改为局部 async IIFE 后重跑同一检查通过，未改生产实现以迁就探针。静态生成器的中间接线曾因模块顶层 return、Vite 默认丢弃入口导出失败，已改用严格入口导出的 IIFE namespace；随后自包含、二次序列化、watch/source map 和完整门禁通过。

## 证据边界与隐私

Chrome runner 不加载生产扩展，不验证或恢复生产派发；暂停保持由未变的后台源、wiring/行为测试与构建证据支持。浏览器验证只覆盖当前 Chrome 和同源 iframe；Chrome119、跨源/srcdoc/about:blank iframe 与生产恢复资格未验证。没有扩展反机器人、风控或第三方检测规避能力。

探针仅访问 localhost，使用合成语言配置，不访问外部 provider/位置/ICE，不增加配置 URL 或生产页面桥。Chrome/profile/本地 server、旧源临时目录在 finally 清理；只保留维护测试与 runner。

## 独立复核

fresh critical_reviewer 独立只读复核完成，未确认可行动缺陷或新增阻断问题。检查了实际 diff、状态可达性、非目标 receiver、私有 controller/SharedWorker 生命周期、生成函数及 Worker 自包含、生产暂停和回归测试。复核额外进行了不落盘的 Node/VM 定向探针；主代理验证前后全部已跟踪及非忽略未跟踪文件内容快照一致。未重复运行全量检查或 Chrome。

复核后只校准两处表述：Chrome runner 输出将生产注入标为 not-exercised（该 runner 不加载扩展），规范明确不可枚举/Symbol 属性也不得承载公开 state；没有改变实现或断言。`node --check` 与最终 diff/新增文件 whitespace 检查通过，先前行为验证继续有效。本地实现与验证结束停在 review，等待用户人工确认。

审计 Bundle：20261016T081055Z-navigator-native-contract-a1b65b1e。

## 2026-10-16 追加：跨源、srcdoc 与 about:blank Chrome 回归

用户继续授权补齐 iframe 浏览器测试，范围仍限兼容性和隐私一致性。本轮仅修改 Chrome runner、自包含测试探针及规范/任务记录；src 与 build 的候选 diff SHA-256 在本轮前后一致，未改生产实现、暂停路径、权限或配置。

Chrome fixture 扩为两个 localhost 端口：顶层包含 same-origin、cross-origin、srcdoc、about-blank 四个命名 frame；跨源 frame 内额外保留一个未安装 runtime 的同源 iframe 作为合法非目标 receiver/原生反射对照。Runtime.executionContextCreated 的默认上下文按真实 frameId 关联，逐文档执行，不通过父页跨源 eval，不关闭同源策略。实际场景中所有 frame 默认上下文可由同一个 Page target 观察，OOPIF target 数为 0；此证据不覆盖跨站点进程隔离。

安装前核验每个目标唯一身份、实际 location URL 和 globalThis.origin；srcdoc/about:blank 有效 origin 均继承父页。每个 realm 捕获原生 getter/反射和 own-key 基线，顶层与各 frame 使用独立合成语言安装，并在每次单 frame 安装后检查所有 realm。跨源父子双方对 navigator、Navigator、Reflect 及两个 descriptor API 的访问，在安装前/后及 descriptor 变更后均严格为 SecurityError。合法跨 realm receiver 使用实际同源可访问 Navigator，对比安装前捕获的原生 getter；未将无法取得的跨源对象冒充合法 receiver。

探针新增 getter 自身 own-key/descriptor 与函数原型对比，覆盖通过 getter 函数属性暴露状态的路径；保持原生函数引用、全局/Proxy/另一 realm 的 own keys、Symbol 检查。四类 iframe 各自执行 descriptor 替换/ToPropertyKey/删除/freeze，并检查尚未修改的 sibling/parent/control realm，未发生原型或状态串扰。

### 实际验证

- `node --import tsx scripts/chrome-navigator-contract.mjs`：Chrome 155.0.8059.80 退出 0。same-origin、cross-origin、srcdoc、about-blank 的 documentAndOrigin、prototypeDescriptorReceiver、internalStateAndReflection、descriptorMutationDeletionFreeze 均为 passed；crossOriginAccess=双向原生 SecurityError；crossOriginNativeReceiverControl、frameInstallationIsolation 均通过。
- 同一真实 Chrome run 继续通过 classic/module Worker、SharedWorker、私有句柄未来 Worker 更新。
- `npm run typecheck:tests && npm test`：退出 0，174/174 通过（含加强后的共享探针及已有暂停合同）。
- `node --check scripts/chrome-navigator-contract.mjs`、`git diff --check`：通过。
- 复用上阶段输入未变化的 `npm run typecheck` 与 `npm run build` 证据；本轮未改 src、build、依赖、Vite 输入或配置。

隐私数据流仍仅临时 Chrome 与两个 localhost server，配置和业务语言均为合成值，未请求 provider/位置/ICE；没有生产配置桥/marker。runner 的 productionInjection 保持 not-exercised，生产暂停由未变源码及已有行为/wiring 测试支持。两个 server、Chrome/profile 与上下文摸底使用的临时 profile 均已退出/清理。

覆盖限制更新：跨源已覆盖同 hostname 的不同端口 origin；srcdoc/about:blank 已覆盖非 sandbox 继承 origin。Chrome119、跨站点 OOPIF、sandbox opaque origin 及生产派发资格仍未验证。前一阶段独立复核审计属于实现修复，未冒充本次测试扩展的独立复核。本地验证完成回到 review，等待人工确认。

## 2026-10-16 追加：跨站点 OOPIF 与 sandbox opaque origin

用户继续授权扩展真实 Chrome 测试，范围仍限兼容性与隐私一致性。只修改 Chrome runner、规范与任务记录；src/build 候选 diff 在本轮前后完全一致，自包含探针与 Node 测试输入也未改动。生产注入保持暂停，不增加权限、配置桥、伪装面或外部请求。

跨站点 fixture 使用 localhost 顶层和 127.0.0.1 子站点，独立 Chrome 启用 site-per-process。脚本要求实际默认上下文属于不同于顶层的 session，该 session 的 Target.getTargetInfo 必须为 iframe、targetId 不同、URL 精确匹配；不是只凭 URL/flag 推断。CDP TargetFilter 参数已对当前 Chrome 的本地 json/protocol 核验，实际附加只包含 iframe，不影响 Worker 启动。原有单 Page 摸底探针未能收集完整 frame；正式 runner 改为各 session 启用 Page/Runtime、合并 frame tree、按 session+frame 寻找默认上下文及持有 objectId，随后完整回归通过。

sandbox URL、srcdoc、about:blank 均使用 sandbox=allow-scripts，不含 allow-same-origin；有效 globalThis.origin 全部为 null。父子双向及三个 opaque sibling 的五类访问（navigator、Navigator、Reflect、Object/Reflect descriptor）在安装前/后及属性变更后均为原生 SecurityError。跨站点 OOPIF 内同源原生子帧提供合法非目标 receiver/反射对照；opaque 文档不伪造网页无法取得的合法外部 Navigator，而是保留原生非法 receiver 和受保护外部对象的拒绝合同。每个场景都验证自身 prototype、descriptor flags、getter 属性、原生反射、global/Proxy own keys 和内部状态不公开；独立合成语言安装及替换/删除/freeze 后继续检查未修改 realm。

### 实际验证

- `node --import tsx scripts/chrome-navigator-contract.mjs`：Chrome 155.0.8059.80，退出 0。新增 cross-site-oopif、sandbox-url、sandbox-srcdoc、sandbox-about-blank 的 documentAndOrigin、prototypeDescriptorReceiver、internalStateAndReflection、descriptorMutationDeletionFreeze 全为 passed；OOPIF independentIframeTarget 及三种 opaqueOriginAndSandbox 为 passed，opaqueSiblingAccess 为原生 SecurityError。
- 同一 run 的旧同源/跨源/srcdoc/about:blank、classic/module Worker 与 SharedWorker、私有句柄未来 Worker 更新均继续通过。
- `node --check scripts/chrome-navigator-contract.mjs`、`git diff --check` 与新增文件 whitespace 检查通过。
- 复用输入未变化的源码/测试类型、174 项 Node 测试及 Vite 构建成功证据；本轮未修改其维护源、测试 helper、依赖、配置或构建输入，Node 测试也不读取该独立 runner。未把旧 Node 通过计为 OOPIF/opaque 浏览器证据。

数据流仅临时 Chrome 与三个本地 server。真实浏览器 runner 不加载生产扩展，productionInjection=not-exercised；暂停保持由未变源码及前轮既有行为/wiring 证据支持。主回归和上下文摸底的 Chrome/profile/server 均已清理。未使用子代理，不把前阶段独立复核审计冒充本次扩展的复核。

覆盖限制更新：本轮覆盖 site-per-process 下静态跨站点 OOPIF，以及 allow-scripts 但无 allow-same-origin 的三类 opaque 文档。Chrome119、sandbox 禁脚本、导航/进程交换生命周期与生产派发资格仍未验证。本地验证完成回到 review，等待用户人工确认。
