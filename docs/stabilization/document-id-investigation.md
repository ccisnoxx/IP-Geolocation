# VG-011：Chrome155 旧 documentId 定向注入调查

> 当前状态：下文“未实施”属于此前调查/方案阶段。用户随后明确接受功能代价并授权安全暂停，现已实施派发前拒绝与初始化脚本撤销；生产行为已变化；用户于2026-10-15确认安全暂停人工验收通过，VG-011 当前 done，Trellis completed。当前实现与验证见本文末“安全暂停实施”。原始 FAIL 原样保留，不能将扩展阻断表述为浏览器已修复。

日期：2026-10-15。用户授权调查原 FAIL、排除 spike/CDP 问题并确认生产影响；VG-011 保持 review，不启动 VG-012，不实施生产修复。原始 [spike JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/chrome-evidence.json) 保留不变，本轮正式结果为 [调查 JSON](../../.trellis/tasks/10-15-vg-011-runtime-modularization/document-targeting-evidence.json)。

## 结论与影响

**FAIL 成立，生产注入路径可复现受影响。** Chrome155.0.8059.40 默认模式中，导航后的旧真实 documentId 可命中替换文档。无 Vite/生成器、所有 ID/导航/API 调用留在扩展上下文、且实验开始前已断开 CDP 的对照也复现，因此不是原 spike 的代码生成、CDP 参数串接或 Page.navigate 时序造成的假阳性。

生产 dist 副本中仅插入测试观测/延迟 wrapper，原 service-worker.js 与 content.js 字节一致，权限/host/WAR 与生产 manifest 相同。来自真实 content script 的 MessageSender 通过生产 router/services，后台解析旧规则 payload 后，在实际 Chrome API 调用前被测试 gate 暂停。导航至未匹配规则的 loopback origin，再释放**原参数、原函数**的调用，替换文档从原生语言变为旧规则的合成语言；Chrome 返回的 documentId 也是替换文档 ID。

这是 P1 范围的 allowlist 隔离风险：旧页面已授权的 payload 可能作用于另一未授权规则文档。它不是 Chrome host 权限突破；生产本就拥有 `<all_urls>`，本轮没有扩大权限。测试只启用并实际观测语言；其他启用的 runtime surface 受到同一入口控制，但未在本轮逐项测量。该确定性 gate 放大了真实异步窗口，证明当前代码的易受影响性，不代表已测得自然发生率或所有导航都受影响。

## 对照结果

| 检查 | Chrome 默认模式 | 仅加 `--disable-features=BackForwardCache` |
|---|---|---|
| 无打包器、CDP 完全断开后运行 | 已确认 | 已确认 |
| 32 位十六进制、格式合法但不存在的 documentId | 拒绝，No document 类错误 | 拒绝，No document 类错误 |
| 当前 iframe documentId | 只命中该 iframe | 只命中该 iframe |
| 当前替换文档 documentId | 正常命中 | 正常命中 |
| 旧真实 ID，MAIN | 错投替换文档 | 拒绝 |
| 旧真实 ID，ISOLATED | 错投替换文档 | 拒绝 |
| 导航后等待一秒再用旧 ID | 仍错投 | 拒绝 |
| 真实生产 sender/函数，延迟后跨 origin 导航至 nonmatch | 新文档被旧 payload 改写 | 旧调用被拒绝，新文档保持原生 |

禁用 flag 仅用于区分根因，不是生产修复、发布建议或全浏览器安全保证。本轮两种模式均为同一 Chrome 版本的定向实验，不扩展为浏览器矩阵。

原生探针的 CDP 连接只用于装载临时扩展、安排启动。扩展等待本机 readiness；驱动确认 WebSocket 已关闭后才允许探针执行，结果由扩展向本机返回。documentId、tab ID、chrome.tabs.update 和 scripting.executeScript 始终在扩展内，未由 CDP 拼接或重放。生产探针仍使用 CDP 对 service worker 中的测试 gate 进行控制；没有用 CDP 在目标页面执行补丁。

## 源码支持的根因

核验了与浏览器版本一致的 Chromium tag `155.0.8059.40`。网页读取工具无法打开该 tag 时，使用 HTTPS 从官方 Gitiles `?format=TEXT` 读取并解码；以下路径、行号与 SHA-256 对应该版本内容，不以 main 分支代替。

| 官方源 | 关键行为 | SHA-256 |
|---|---|---|
| [scripting_utils.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.40/extensions/browser/scripting_utils.cc#75) 75–108 | 从 documentId 查 RenderFrameHost，只检查存在且属于目标 tab；随后降为 frame ID，没有在此拒绝 cached 生命周期 | `388dc50984e5fff0d5e9cc5387079b669fedbaed2063164fddd8ec12610e6182` |
| [extension_api_frame_id_map.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.40/extensions/browser/extension_api_frame_id_map.cc#77) 77–85、111–158 | 文档映射返回对应 host；frame ID 查找则转到当前 primary main frame 或 frame-tree-node 对应的活动 host | `ea10d52b429786bdda83a03ecd8b55a4d185ff794fc526993a9f86fa46625e57` |
| [script_executor.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.40/extensions/browser/script_executor.cc#56) 56–104 | 执行器按 frame ID 重新解析 RenderFrameHost，未携带原 documentId 作最终等值检查 | `bd0433d04b9975c32346aa0ff46d9902d31d8a00944b332a79f39453ab3a7115` |
| [scripting_api.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.40/extensions/browser/api/scripting/scripting_api.cc#361) 361–386 | CanAccessTarget 得到 frame IDs 后传给执行层，原 documentId 不再作为执行目标身份条件 | `0f00dff2b0d669cb5bf8df1b4a85bcb6341b79cd08dbdc44f8f235f2aae01fe6` |

源码与 flag 对照共同支持：**BFCache 保留旧文档映射后，documentId→frameId→当前活动 RenderFrameHost 的转换丢失了原文档身份，因而导航替换后的 frame 可接收旧调用。** 这是基于对应源码及行为差分的根因判断，没有对已安装二进制逐指令调试或获取旧 host 的内部生命周期快照。不能将结论扩大为所有 Chrome 版本。

## 生产链路的证据

- `src/content/content.ts` 不变，只通知初始化；MessageSender 来自真实 Chrome content script。
- `src/background/message-router.ts` 不变，初始化仍交给 services，并非测试伪造 sender 后直接调用函数。
- `src/background/services.ts:563` 在扩展 ID/tab/documentId 校验后，await resolver/storage，再于 569–576 调用 scripting。生产只提供 documentIds，没有 frameIds/allFrames 兜底。
- 捕获到的 sender.documentId、target.documentIds[0]、args[1] 三者相等；函数名为 applyVanishGeoRuntime，包含生产 registry。wrapper 不修改 details、payload、func 或 sender，只记录并在原生调用前等待。
- 替换页使用另一个 loopback origin，生产 getCurrentTabState 返回 matched=false；新文档最初为原生语言，释放旧调用后才变成合成 fr-FR。
- `src/injected/runtime.ts:88` 把 documentStateKey 用作隐藏状态 key；它没有独立的当前 Chrome documentId 证明。`services.ts` 也没有在 API 返回时拒绝 documentId 不一致的结果。返回后检查本身仍无法撤销已经发生的 hook。

## 修复边界（仅建议，不实施）

不能把 documentIds 改成 frameIds、扩大注册、加页面配置桥、隐藏异常、禁用整个浏览器 BFCache 或忽略 FAIL。保留可信 sender/resolver 权威边界。

后续安全修复需要在任何 registry/hook 副作用之前，对实际执行文档进行拒绝式授权约束，并处理“校验后又导航”的窗口。单独的异步前置采样仍有 TOCTOU，单独的事后结果 ID 比对只能发现、不能阻止此次改写。可以评估以后台解析得到的授权 origin/URL 快照作 runtime 开头的额外拒绝条件，避免复制域名匹配器；但它不能证明同 URL 的新文档身份，不能独自宣称完成 documentId 隔离修复。完整方案、兼容性与所需接口变更需单独确定。

本轮未修改生产代码、配置 schema/storage/message、manifest、DNR、WebRTC 或权限。VG-011 保持 review，VG-012 未启动。原构建期模块化方案仍有最小机制证据，但这个安全问题独立存在于当前生产入口，不能留到模块迁移后才考虑。

## 复现与验证

维护脚本为 `scripts/runtime-modularization/document-targeting-investigation.mjs`，使用当前 dist；可运行：

```bash
# 历史修复前复现：需要尚有派发路径的旧 dist；当前候选已拒绝，不能等待此旧生产 gate。
# 原生对照不受暂停影响，当前使用 --native-only。
node scripts/runtime-modularization/document-targeting-investigation.mjs
# 相同实验，仅改变 BFCache 诊断选项。
node scripts/runtime-modularization/document-targeting-investigation.mjs --disable-bfcache
# 只执行无活动 CDP 的原生对照；可配合 --disable-bfcache。
node scripts/runtime-modularization/document-targeting-investigation.mjs --native-only
```

加 `--output <JSON路径>` 可保存脱敏结果。本轮已实际运行默认/禁用 BFCache 的生产对照，以及两种模式的断开 CDP 原生对照；每个最终成功采集命令均退出 0，表示**调查完成**，安全判定另存 documentTargetSafety，默认仍为 FAIL。正式 JSON 聚合各次已取得的结果，没有把未重跑的生产结果冒充最后一次原生运行的输出。

脚本检查语法通过。生产源码、类型和既有测试输入保持，因此复用上一轮源码/测试类型、152/152、build 和 dry-run 的成功证据；本轮不重复无关门禁。新增脚本没有进入生产构建或测试 glob。最终 diff、状态、任务外文件完整性与临时资源检查见 task implement。

前期 harness 的动态 import 不适用于扩展 service worker，已改为有序静态 imports 后才获得生产证据。可选 history-back 检查遇到“无下一历史页”的错误，未将其作为 BFCache 证明；改用唯一 flag 差分和对应源码。最终断开 CDP 使用确定性 readiness 握手，不依赖固定延时假定。失败尝试及修正不改变已保存的原始 spike FAIL。

所有 browser profile、临时扩展、fixture server 与 JSON 中间文件在收尾清理；正式证据无原始文档 ID、tab/扩展 ID、公网 IP、位置、个人路径或完整配置。原生探针只向 loopback server POST 布尔/分类结果；服务器仅监听 loopback，无 provider/header echo/STUN 请求。没有监控浏览器自身全部网络，不宣称完全离线。未做人工验收、Chrome119、自然竞态频率或全部 iframe/BFCache 生命周期测量。

## 最小安全修复提案（未实施）

用户随后明确要求：先给最小安全方案，覆盖 BFCache、跨 origin 和同 URL 重载；仍保持 review、不启动 VG-012、不得改生产代码。本节是方案，不是已修复或已验证的新行为。

### 推荐：先拒绝不能证明安全的 MAIN 派发

当前已核实的 Chrome155 API 没有提供能在 MAIN 内读取、不可被网页伪造的当前 Chrome documentId；func 的 args 又不能携带真实 Document 对象引用或扩展闭包。因而本轮不承诺用一个正常网页 JS 条件，在继续所有页面伪装的同时解决全部文档身份竞态。最小可证明方案是临时 fail closed：在后台、executeScript 之前拒绝该未验证能力的调用，零 runtime 派发使 registry、反射代理、getter、timer、worker wrapper 均不执行。

具体实施边界：

1. 在 background/services 的可信调度入口建立单一能力决策；当前已证实不安全的路径为 blocked，未知实现也不默认放行。决策来自扩展自身可信环境/维护策略，不接受页面、payload中的布尔开关、UA伪装值或新storage设置来打开。
2. initializeRuntimeForSender 保留既有 sender 校验，安全能力不成立时在解析/派发敏感 payload 前报固定、可解释的 unsupported 错误，不调用 MAIN API。不得以其他world、frameIds、files或页面消息作为 fallback。
3. reconcile 同时使该能力关闭可见：撤销/不注册当前用于启动MAIN的动态初始化脚本，并通过已有 contentScripts 组件报告 failed/unsupported，整体 partial；不宣称保护全部生效。配置仍保存，不改变规则、schema、verified、DNR或WebRTC。DNR/WebRTC实际结果仍按既有组件单列，不为页面降级静默改写用户策略。
4. 若扩展更新前已有派发、hook或BFCache旧文档，新的后台Map/闸门无法撤销已经执行的代码。交付必须说明需要重建相关文档；无法确认旧缓存与在途代码清空时，需要受控浏览器重启才能建立干净起点，不自动执行用户浏览器操作、不用全局关闭BFCache作修复。

最小文件范围是 services.ts 的调用入口/对账及其现有测试，必要时调整已有同步状态固定文案；本阶段 runtime.ts 可以保持原实现，因为入口根本不派发它。避免在 MAIN 中增加一个并无可靠身份证明、却看起来已解决问题的假guard。能力判断必须每次适用，不得被“配置签名未变化，已收敛”缓存绕过。

### 三个场景的安全含义

| 场景 | 新策略处理 | 功能/恢复边界 |
|---|---|---|
| BFCache 的旧sender/旧documentId仍可被Chrome解析 | 派发前拒绝，不让其进入MAIN，更不创建registry | 不因pageshow或旧ticket自动恢复；部署前旧缓存需重建 |
| A origin导航到nonmatch B | A的旧payload不序列化给MAIN，B保持原生API | 不靠只比较location.origin把问题误称为完整文档隔离 |
| 相同URL重载，URL/origin相同但Document不同 | 仍拒绝派发，无URL相等例外 | 不以timeOrigin、导航entry、页面nonce复用旧授权 |

### 不接受的替代

- 前置ISOLATED采样/后台token或epoch可以减少晚到请求，但采样与MAIN调用之间仍可导航，不能单独作为执行终态证明。
- 后置检查InjectionResult.documentId有诊断价值，但hook可能已经安装，不能把结果不一致后的报错叫作阻止。
- origin/URL只适合额外限制跨origin暴露，无法区分同URL新Document。
- performance.timeOrigin不是具有唯一性/不可伪造保证的Chrome文档授权能力；NavigationHistoryEntry也不是Chrome documentId。HTML标准的window.navigation明确为Replaceable，不能把MAIN的读取当可信身份凭证。见[HTML标准](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object)与[High Resolution Time](https://w3c.github.io/hr-time/#the-performance-interface)。
- DOM/postMessage的随机nonce、可调用全局installer或网页可回放的grant，不成为可信配置/执行桥；不引入这类协议来伪造原子提交。

### 恢复功能前的门槛

需要浏览器提供并落实“最终执行仍对应预期Document”的原子保证，或找到不依赖网页值、不引入配置桥的等价可信机制。当前没有这样的已验证候选，不自动按UA大版本猜测已修复。若走上游修复，检查执行层保留/核对原document身份，并在真实Chrome跑同一负向矩阵后才恢复。

验收最小集：三场景均断言生产runtime派发0次、页面API及反射descriptor未变、无timer/worker/隐藏state安装；已有动态注册被撤销，UI明确partial/unsupported；保存/重启/同签名重试不能绕过；页面伪造performance/navigation/消息不会放行。另保留原生API错投对照，防止把Chrome仍错投但扩展已停止调用两者混淆。前述是待实施验收，未执行、未宣称通过。

该方案能提供安全止血，代价是暂停MAIN页面伪装；它不被表述为保留全部功能的最终修复。代码/权限/生产行为在本轮仍保持不变。

## 安全暂停实施（2026-10-15，保持 review）

用户已明确接受暂停语言、时区、位置、Canvas 和 worker 伪装的功能代价，授权按先拒绝、验证、独立安全复核、人工验收推进。该安全暂停替代前文未实施提案的状态，不是完整功能恢复。

- `services.initializeRuntimeForSender` 保留扩展身份/tab/documentId 校验后，无条件抛固定 `runtime-injection-paused` 错误；不读配置、不构造/传送 payload、不调用 scripting。生产后台删除 runtime import/executeScript，构建不再包含页面 hook；`runtime.ts` 维护源不改，原模块化 Node spike 保留。
- 对账只回读并注销固定 `vanishgeo-runtime-init`，再次回读确认；注销失败为 failed，仍拒绝所有初始化。有启用 allowlist 时现有 contentScripts 组件为 partial 并给出暂停范围；无启用站点时没有待执行页面功能，注销成功可为 ok，闸门仍拒绝。没有 UA、版本、storage、签名或网页开关。
- DNR/WebRTC 各自执行/验证并报告；不改 schema、storage 结构、消息动作、host/manifest/权限或 resolver。原配置刷新恢复在注销/DNR/WebRTC 操作成功后继续，不代表撤销 BFCache 旧 hook。同步报告、设置概览、当前站点与保存提示明确暂停，重试不会恢复；总开关只表示已保存配置。
- 新闸门不撤销旧 hook、不取消旧代码已发出的 API 调用，也不能清除旧 BFCache/worker。加载本候选后应关闭并重新打开受影响页面，无法确认旧状态清空时自行重启浏览器；不自动操纵用户浏览器。不回滚到旧不安全派发路径。

真实 Chrome155.0.8059.40、临时 profile/dist 副本验证见 [暂停证据](../../.trellis/tasks/10-15-vg-011-runtime-modularization/safety-gate-evidence.json)。测试 wrapper 先于字节相同的生产 service worker 加载，仅统计 scripting 调用并延迟真实 ISOLATED 初始化消息，sender 由 Chrome 产生；权限/host/WAR 与候选 manifest 相同。测试专用本地页面在首脚本捕获 API 引用及 descriptor，无配置输入。测试代码不进入生产构建。

| 场景 | Chrome 实际文档证据 | 扩展结果 |
|---|---|---|
| BFCache | A→B 替换文档，history.back 后恢复 A 的原 ID/token 且 pageshow.persisted=true；恢复后再通知 | 替换前旧通知及恢复后的通知均拒绝，生产派发 0，top/iframe API 原生 |
| 跨 origin | localhost→另一个 loopback origin，新 documentId；未匹配替换文档 | 旧通知拒绝，派发 0，top/iframe API 原生 |
| 同 URL 重载 | URL 不变，documentId 与测试 token 均更换 | 旧通知拒绝，派发 0，top/iframe API 原生 |
| 生命周期/配置 | 真实 ServiceWorker.stopAllWorkers 后重新唤醒，保存和同签名重试 | 派发 0，预置旧初始化脚本被撤销；两管理页可见暂停；DNR/WebRTC 报告均 ok |

API 检查覆盖 Navigator language/languages、Date/Intl、Geolocation/Permissions、Canvas、Worker/SharedWorker 及反射 API 的原生 source 与引用/descriptor 连续性。未主动请求位置、创建实际 worker 或 ICE；“没有执行 hook”的核心证据是生产后台所有 scripting 派发计数为 0，不能把有限 API 快照描述为全浏览器审计。

精确命令：

```bash
npm run build
node scripts/runtime-modularization/chrome-safety-gate.mjs --output /tmp/vg011-safety-gate.json
node scripts/runtime-modularization/document-targeting-investigation.mjs --native-only --output /tmp/vg011-native-control.json
```

第二条退出 0、extensionGate=PASS。第三条退出 0 只表示调查完成，documentTargetSafety=FAIL：无活动 CDP、无生成器的旧 ID 仍命中替换文档。正式证据将两次独立运行分开保存，不把原生缺陷和扩展零派发合并成“浏览器安全”。早期 UI 读取尝试遇到模块私有 loadConfig 不能从 CDP 全局调用，已改为 Page.reload 与真实重试按钮，未修改产品为测试暴露内部函数。

恢复完整功能只列为后续独立研究：核验原子最终文档绑定或上游执行层修复，并重跑负向矩阵；URL/时间戳/nonce/事后 ID 比对都不能作为完整方案。VG-012 未启动。独立复核与本地完整门禁结果、人工验收待办见任务 implement；Node、dry-run 与真实 Chrome 结果分开。

## 安全暂停人工验收确认

2026-10-15，用户明确确认 VG-011 安全暂停人工验收通过，并授权状态更新。当前 manifest 为 done，Trellis 为 completed；此前 review/待验收描述为对应阶段历史。确认原话与边界见[人工验收记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md#人工验收)。Chrome 原生错投 FAIL、扩展零派发阻断 PASS 与人工确认分别保留，原始三个 JSON 不变；不宣称 Chrome 已修复或页面伪装已恢复。不补写用户未提供的浏览器版本、截图、逐项日志，旧 hook/BFCache 文档重建要求继续有效。VG-012 未启动，不提交或推送。
