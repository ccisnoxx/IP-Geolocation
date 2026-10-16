# VG-011：MAIN-world runtime 模块化 RFC

> 后续安全处置：用户已接受暂停页面伪装的功能代价，后台移除 MAIN runtime 派发并注销初始化脚本；模块化方案和 spike 保留为设计证据，不构成生产恢复授权。见 [实施与验收](./document-id-investigation.md)。

> 2026-10-16 兼容性修订：下文是 VG-011/VG-012 的历史基线。当前维护源已按用户授权移除全局 state/marker 与反射虚拟化，安装改为返回私有 update 句柄，不再承诺独立序列化调用共享状态；当前合同见[质量规范](../../.trellis/spec/frontend/quality-guidelines.md#navigator-原生合同回归)和[修复任务](../../.trellis/tasks/10-16-navigator-native-contract/prd.md)。生产暂停保持，历史等价证据不代表本次变更的验收。

日期：2026-10-15。状态：设计与 spike 已形成，后续安全暂停已于2026-10-15获用户人工验收通过；VG-011 为 done，Trellis completed。原生错投 FAIL 与扩展阻断 PASS 分开保留，见[人工验收记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md#人工验收)；任务状态只读 [manifest](./task-manifest.yaml)。本次选择**构建期生成静态自包含函数**，不切换生产入口、不全面迁移 surface。

**证据结论**：多模块编译、二次打包、函数独立序列化，以及真实 Chrome 当前 top/iframe 的最小语言 surface 均可行。但 Chrome 155.0.8059.40 的旧 `documentId` 负向检查为 FAIL。后续[专项调查](./document-id-investigation.md)已排除生成器与 CDP 问题，并在原生产 dist 的受控导航窗口中复现旧 payload 改写未匹配规则的新文档；源码与 BFCache 对照支持其根因。不能把该结果解释为完整定向安全通过，也不能据此批准生产迁移。原始脱敏结果见 [Chrome 证据](../../.trellis/tasks/10-15-vg-011-runtime-modularization/chrome-evidence.json)，全部命令、失败及限制见 [执行记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md)。

## 1. 当前实现与不可改变的合同

基线为分支 `stabilize/VG-011` 的 HEAD `5701b55` **加任务开始时的未提交工作树**，不能用单独 HEAD 代表前序稳定化成果。`src/injected/runtime.ts` 为 75,493 字节、1,588 行。所有运行时代码在 `applyVanishGeoRuntime(payload, documentStateKey)` 内，文件级声明均为擦除后的 TypeScript 类型；当前没有运行时 import。

`src/background/services.ts` 的 `initializeRuntimeForSender` 先核验扩展 ID、tab 和 documentId，依次使用可信 sender 的 URL/origin/tab URL，再调用现有 `getEffectiveProfile`。未产生有效 payload 就不注入；调用结构为：

```ts
await chrome.scripting.executeScript({
  target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
  func: applyVanishGeoRuntime,
  args: [resolved.payload, sender.documentId],
  injectImmediately: true,
  world: 'MAIN'
});
```

ISOLATED `src/content/content.ts` 只发送初始化 action，没有页面配置输入。动态脚本的 matches 由现有 resolver 产生，保留 document_start、allFrames、matchOriginAsFallback；每个文档仍通过后台授权。配置归一化、解析、持久化分别归 config-model/config-resolver/storage；MAIN 只消费已解析 payload，不新增域名匹配、storage 或 verified 身份来源。DNR/WebRTC 不进入 runtime 模块。

当前函数依赖与拆分约束如下；行号是本次基线定位，未来以符号为准：

| 基线区域 | 当前依赖/状态所有者 | 拆分时必须保留 |
|---|---|---|
| 1–85 类型 | 局部 RuntimePayload、SurfaceName、ReflectionOriginals、AntiDetectionState；生产入参来自 shared/types 的 EffectivePayload | 只提取类型，不改变 schema、可选兼容字段或解析逻辑 |
| 88–410 registry | root、runtimeAnchor、原生 Object/Reflect/Function 快照、WeakMap/Set、descriptor 和 source 注册 | 每文档一个权威 state/registry，所有 surface 共用；不产生局部 toString 补丁 |
| 412–425 首次/重复调用 | getAntiDetectionState、runtimeReady、debugMode | 当前先建立 registry 再检查 payload；重复调用只刷新未来 worker patch source，不能顺手改成全 surface 热更新 |
| 427–479 语言/时区输入 | payload、realm state、native-backed navigator getter、registry proxy/descriptor | 保留原型位置、receiver、languages 冻结与原生透传 |
| 481–748 Intl/Date | realm state、原始构造器/方法、时区 parts、registry | 保持显式选项、DST、构造/调用及反射的当前可观察结果 |
| 750–985 位置/权限 | realm state、稳定随机坐标、watch Map、微任务/interval、registry | 保留回调、watch 清理、异常、permission 原生非目标路径 |
| 987–1108 Canvas 字体 | 字体正则/解析、targetFontKeys、原生 measureText/getContext、registry | 保留字体恢复的 finally、非目标 API 透传；不新增设备伪装 |
| 1110–1414 workerBootstrap | patchConfig、worker 自己的 self/原生全局、内部 helper；末尾引用自身 toString 用于嵌套 Worker | 是第二个独立序列化边界，页面函数体内的 sibling helper 仍不可供 worker 使用 |
| 1416–1553 worker 源/包装 | documentStateKey、timezone 归一化、workerBootstrap.toString、页面 registry 的 patch source/Shared URL Map | 保留同源 HTTP(S)、options 单次转换、缓存身份、module 时序、pagehide/revoke 及错误语义 |
| 1555–1588 调度 | payload、单一 registry、各 installer 与固定 debug log | 保留 language→geolocation→Intl/Date→Canvas→worker 顺序及固定日志 |

函数返回后，由它创建的 getter、计时器和事件监听器可以继续闭包捕获**该次反序列化函数内**的 state；禁止的是捕获扩展模块外部环境。原生全局 `globalThis/self/navigator/Object/Reflect/Proxy/Intl/Date/URL/Blob` 等由目标 realm 提供，不需要在页面加载扩展 chunks。

## 2. executeScript.func 的序列化边界

Chrome 将 func 序列化再在目标 world 还原，绑定参数与执行上下文不随之传输；args 必须可 JSON 序列化。`func` 与 `files` 二选一，args 只适用于 func。`documentIds` 从 Chrome 106 起支持，项目最低版本仍为 119；injectImmediately 不保证赶在首 inline script 前。以上以 [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) 和安装的 `@types/chrome@0.0.268` 的 ScriptInjection/InjectionTarget 为依据。

把 helper import 到扩展 bundle 并不足够。例如 `function injected(p) { installLanguage(p); }` 在扩展中有效，复制其函数体后 MAIN 没有 installLanguage，必然 ReferenceError。`.bind()`、传函数 args、在页面 eval 字符串或假设共享 chunk 可见都不能解决此合同。Chrome 的 [content scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) 也要求被复制的函数自包含。

正确形态必须是静态 JS：

```js
export function applyVanishGeoRuntime(payload, documentStateKey) {
  // 构建器把所有模块依赖、常量、转译 helper 和初始化代码放进此函数体。
  function installLanguage(/* ... */) { /* ... */ }
  // 其他局部模块及调度也在此处；页面不 import 扩展资源。
  // ...
}
```

构建期拼接合法函数声明不等于运行期 eval。最终必须测试**后台最终 bundle 中传给 func 的实际函数**，不能只测试某个模块导出的带闭包函数。workerBootstrap.toString 又丢失一次上下文，因此还必须生成 worker 自己的完整函数体，不能直接从页面 registry import helper 后对 worker 函数取 source。

## 3. 三种候选方案

| 维度 | A：保留单文件、内部生成 | B：构建期生成自包含函数（选择） | C：受控文件注入 |
|---|---|---|---|
| 维护组织 | runtime.ts 仍包含全部嵌套函数，用同文件模板/描述表减少重复 | TS 模块维护，构建展平后完整包进静态函数 | 模块构建为单独经典脚本，由 files 注入 |
| 闭包 | 保留现有词法边界，最小结构风险 | 所有依赖在最终函数体内；二次打包再验证 | 脚本本身可自包含，但不能接收 args |
| MAIN/CSP | 仍用 func MAIN；不引入 eval | 仍用 func MAIN；不增加运行时编译、DOM script 或远程 import | scripting files 可选 MAIN；与 DOM script-src 加载不同，不能把两者混同 |
| WAR | 不需要 | 不需要 | 直接 scripting files 不要求把该资源公开；若改用页面 script src 则涉及 WAR，且受页面加载策略约束 |
| documentId | 现有单次调用 | 现有单次调用 | API 可携带 documentIds，但传配置通常变成两次调用/全局握手，增加导航及页面干预窗口 |
| 构建 | 生产流程最简单；内部生成器仍需校验重复和漂移 | 增加静态生成阶段、virtual module 和 watch 依赖；继续后台打包 | 增加稳定文件入口和完整分发检查，经典脚本不得残留 ESM imports |
| 测试 | 当前 VM 容易复用，文件维护负担不消失 | 单模块逻辑 + 生成函数脱离闭包 + 最终 bundle + Chrome；worker 单独证明 | 文件执行顺序、配置交付、导航中断、全局清理、CSP/WAR 等额外测试 |
| 回滚 | 基本不变 | runtime facade 恢复任务前实现并重建 | 同时撤销新入口、握手及临时全局，回滚面更大 |

A 的“内部生成”限定为维护/构建时展开同文件模板或内部声明表，不是在 MAIN 调用 new Function。它适合小范围消除重复，但不能提供真正的模块责任边界；若同时保留模板和手工维护展开正文，会产生双事实源。本任务不采用它作为长期模块化方案。

C 必须区分两种技术：[web accessible resources 文档](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources) 描述网页通过扩展 URL 访问资源；scripting files 是浏览器 API 执行扩展内文件，并不自动要求 WAR。直接文件注入本身可以保持 documentIds 和 MAIN。否决理由是**本项目每文档动态 payload 的交付**：files 不接收 args，MAIN 又不能直接读取后台 storage。增加全局 installer/临时 payload、DOM 属性、postMessage 或可调用配置入口，会引入新的页面可干预桥与部分失败窗口；构建期把每份用户配置写入包也不可行。不以新增桥或放宽授权来选择 C。

所有 MAIN 方案仍处于网页可干预的环境，不能承诺隐藏完整反检测或绕过任意 CSP。官方文档说明 MAIN 使用页面 CSP；不能靠开启 unsafe-eval、增加 WAR 或改成页面 script 标签解决。spike 在本次 Chrome 的 `script-src 'none'` 页上通过的是直接 scripting func 的具体执行路径，不是任意 CSP/浏览器/worker 的兼容保证。

## 4. 选择 B 的目标设计（后续实施提案）

### 4.1 维护目录与责任

```text
src/injected/
  runtime.ts                       # 稳定 facade，继续导出 applyVanishGeoRuntime
  runtime-modules/
    types.ts                       # 原 runtime 局部类型，type-only 引用共享 EffectivePayload
    entry.ts                       # 显式两个输入，唯一调度/首次及重复调用语义
    registry.ts                    # 隐藏 state、原生快照、反射及函数/descriptor 注册
    payload.ts                     # 仅现有 runtime 输入转换，不做站点匹配或持久化
    surfaces/
      navigator.ts
      intl-date.ts
      geolocation-permissions.ts
      canvas-fonts.ts
      workers.ts                   # 页面 worker wrapper/cache/Blob 生命周期
    worker/
      entry.ts                     # worker 自己的完整 bootstrap 生成边界
      navigator.ts
      intl-date.ts
      nested-worker.ts
build/
  self-contained-runtime.ts        # 静态模块生成、单函数检查与 source map
  runtime-plugin.ts               # Vite virtual module + watch 依赖
src/runtime-virtual.d.ts           # 明确 virtual module 导出签名，无运行时代码
```

不按行数均分，不建通用插件注册框架。registry 拥有 AntiDetectionState，每个 surface 显式获得 state/所需 registry 方法；surface 不自行创建第二套状态、反射补丁或配置来源。模块顶层只允许类型、纯常量和声明，不在扩展 import 时探测或修改浏览器对象。只有生成函数被浏览器调用时才安装 hook。

worker 保留自身现有独立 registry/原生快照语义，它与页面是不同 realm，并非第二套配置权威。此次设计不顺手合并 worker 与页面的 Date 实现；先保持可观察行为，再由独立任务讨论算法复用。

### 4.2 构建与注入

1. 独立编译 worker graph，输出 `workerBootstrap(patchConfig) { /* 所有依赖 */ }` 的静态模块；只有 patchConfig 和 worker 原生全局可作外部输入。
2. 编译页面 graph；worker 导入的是上一步已自包含的函数，其 helper 仍嵌套在 worker 函数内。
3. 用 Rollup banner/footer 把页面 graph 的展平结果静态放进 `applyVanishGeoRuntime(payload, documentStateKey)`。Vite 可能将 export function 改成末尾具名 export，检查应允许此纯导出而拒绝顶层执行语句。
4. Vite 插件的 `virtual:vanishgeo-runtime` 返回生成 JS 和 map；runtime.ts facade 仅 re-export。声明文件使用原 payload 的类型签名，保持后台参数可赋值，不复制 resolver 或 schema。Node 测试直接调用同一生成器，不依赖 Node 理解 virtual import。
5. 保持六个生产入口和 `services.ts` 的注入调用结构，不增加独立公开 runtime 文件；最终 runtime 仍进入后台入口或仅扩展可访问的共享 chunk。Chrome 只复制函数体，不依赖该 chunk 在 MAIN 可见。

生成输出必须恰好一个代码 chunk、无 imports/dynamicImports/外部模块，生成函数外只有必要 ESM export；无运行期 eval/new Function/代码字符串参数。拒绝意外外部依赖与缺失标识符，不提供“找不到模块就退回旧实现”的静默兜底。二次打包后的函数及 workerBootstrap 都要隔离重建并执行。现有 Vite 的 esnext、minify=false 先保持；构建器选项调整不是本任务性能优化。

生产采用 virtual module，避免向 src 写可陈旧的生成正文，也避免 typecheck/build/watch 各读不同版本。插件必须 `addWatchFile` 登记 Rollup 读取到的所有 page/worker 源；worker 改动使 page 生成失效，缺失或循环依赖使构建失败。缓存若实现只按完整输入和选项，不能只按入口路径；第一版可以不缓存。dev 的 build watch 应实际修改一个局部模块并确认输出变化，这是生产切换前的验收项。spike 不实现完整插件/watch。

### 4.3 source map 与调试

spike 使用 Rollup/Vite sourcemap=true，banner/footer 被纳入生成阶段映射；Node 检查 map v3、两份原始 TS 来源及相对路径。二次构建能消费相邻 .map；后续插件应返回 `{code, map}`，由 Vite 继续组合。开发生成 map、发布是否打包 map 应沿现有发布合同明确决定，不新增 WAR 或远程 map 服务。当前生产构建的 sourcemap 设置保持不变。

**不承诺 MAIN DevTools 能自动映射序列化后的 func**：浏览器复制函数体并没有同时接收模块级 sourceMappingURL/map。原模块及后台 bundle 可映射，但 Chrome 注入堆栈到原 TS 的自动定位仍需单独验证；可保留仅相对路径的本地生成文件/映射供开发者定位，不向网页写 map URL、绝对路径或配置。spike 只证明 map 产出/来源，未证明完整 VLQ 位置组合或 Chrome source map 体验。

### 4.4 状态、失败与回滚

每文档 state 的 key、runtimeReady、surface Set、WeakMap、SharedWorker Map、installed callbacks 与顺序均保留。生成器是纯构建阶段，不引入页面 Promise/全局配置握手，也不改变后台串行配置事务、session 恢复、DNR 或 WebRTC。生成失败中止构建；运行时异常保留现有传播/组件报告，不靠额外默认值、catch 或网络重试掩盖。

回滚以**任务前工作树中的 runtime.ts**为基线，将 facade 恢复为原完整函数、撤销生成插件及相关声明/入口依赖，然后重建 dist。不能 reset 到 5701b55 丢失前序未提交成果。无数据迁移、权限变更、外部服务操作或 Git 历史重写；不影响既有 v2。已经打开的页面仍需按现有扩展重载/导航操作更新 runtime，不宣称代码回滚即时撤销旧 realm 中已安装的 hook。

## 5. 本次最小 spike 与证据边界

保留的 spike 均是测试/开发工具，不在 src 生产调用链：

| 文件 | 用途 |
|---|---|
| `tests/fixtures/runtime-modularization/entry.ts` | 两个显式入参的 ambient 类型契约，调用 import 的最小语言 installer |
| `tests/fixtures/runtime-modularization/language.ts` | 单个 native-backed getter 模块；只用于证明序列化，不代替生产 registry |
| `scripts/runtime-modularization/build-spike.ts` | 使用现有 Vite API，configFile=false/publicDir=false/write=false，静态生成并写指定临时目录 |
| `tests/runtime-modularization.test.ts` | 普通拆分失败对照、生成 JS 类型检查、生成/最终 bundle 函数脱离模块执行、receiver 与原型位置、相对 map 来源 |
| `scripts/runtime-modularization/chrome-spike.mjs` | 最小临时 MV3 扩展、localhost 严格 CSP、真实 scripting API 当前 top/iframe/ISOLATED 及导航负向对照 |

测试 fixture 没有完整 registry、隐藏状态或安装幂等，不具备生产等价资格；保留它是为了可重复验证构建机制。无生产引用、入口或依赖变化。不要把这个 getter 直接复制进生产。

精确命令（仓库根执行）：

```bash
./node_modules/.bin/tsx --test tests/runtime-modularization.test.ts
node --import tsx scripts/runtime-modularization/chrome-spike.mjs --output .trellis/tasks/10-15-vg-011-runtime-modularization/chrome-evidence.json
```

Node 检查通过。真实 Chrome155 的 coreMechanism=PASS：同一生成模块又经最终扩展构建，func 在普通 localhost 的 MAIN 中运行，iframe 定向不影响 top，top 再独立定向成功，ISOLATED 保持原生；临时 WAR 为空、host 仅 localhost、权限为生产已有权限的子集。

Chrome 整体 result=FAIL、退出 1。导航已核验新 loader、路径、完整加载及新 documentId，且 MAIN 新文档先恢复原始语言；随后使用旧 documentId 的手写只读 control 返回了替换文档路径和新 documentId，生成函数也将替换文档语言改为合成值。这段是初次 spike 的证据边界。随后[专项调查](./document-id-investigation.md)通过无打包器、断开 CDP 的原生对照和真实生产 sender/原函数的受控延迟，确认当前生产路径可受影响；禁用 BFCache 的对照拒绝旧 ID，对应源码显示 documentId 到 frameId 再到当前文档的身份丢失。仍不据此推断自然发生频率或其他 Chrome 版本。不得删除检查或改成 frameId 兜底。

脚本 finally 关闭 CDP/server/Chrome，删除临时 profile、manifest、bundle、map 和页面；只保留脱敏 JSON。数据限合成语言、布尔检查和版本；无公网 IP、坐标、个人路径、凭据、扩展 ID、tab/document ID 或完整配置。fixture 只服务 localhost，无 provider/header echo/STUN 请求；未监控 Chrome 自身全部内部网络，不能声称浏览器绝对离线。

未做 Chrome119/其他浏览器矩阵、production runtime 全量等价、worker 生成/反射、BFCache 全生命周期、人工验收或发布。本次也不修复 VG-009 已接受的首 inline 竞态。

## 6. VG-012 文件级实施清单（VG-011 时形成的提案）

当前 VG-012 manifest 仍是出口事务初始计划。本节满足用户要求的后续可执行清单，**不自动改其范围/依赖/状态**。开始前须由用户明确授权模块迁移并校准同一记录；旧迁移/出口事务缺口仍保留。

| 顺序 | 文件 | 操作与完成判据 |
|---|---|---|
| 0 | VG-012 task + manifest | 取得迁移授权、核验依赖人工 done、记录任务前 runtime 和构建基线；复核本次 Chrome 负向结果，不以 VG-011 core PASS 替代 |
| 1 | `build/self-contained-runtime.ts`、`build/runtime-plugin.ts` | 将已验证静态包装方式用于 page/worker 两层；单 chunk/无外部引用守卫、map 和 watch 依赖；失败中止 |
| 2 | `src/injected/runtime-modules/types.ts`、`src/runtime-virtual.d.ts` | 提取现有局部类型，virtual 导出签名明确且可接受 EffectivePayload；不改 shared 类型或 schema |
| 3 | `runtime-modules/registry.ts`、`payload.ts` | 从原函数搬移原生快照、state、反射/proxy/descriptor 及现有输入转换；不复制或替换 config-resolver |
| 4 | `runtime-modules/surfaces/navigator.ts`、`intl-date.ts` | 原样搬移语言和 Intl/Date；保留显式选项、receiver、source/name/length 和已知行为 |
| 5 | `surfaces/geolocation-permissions.ts`、`canvas-fonts.ts` | 搬移坐标/watch/permission 和字体逻辑；保留 timer/异常/finally，禁止新增设备表面 |
| 6 | `runtime-modules/worker/*.ts`、`surfaces/workers.ts` | 先生成自包含 worker 函数，再移页面包装；同源/缓存/回收/module connect 合同原样，不能直接引用页面 helper |
| 7 | `runtime-modules/entry.ts`、`src/injected/runtime.ts` | 唯一调度入口及稳定 facade；保留首次/重复注入差异。删去已搬移旧正文，不留第二个可选择生产实现 |
| 8 | `vite.config.ts` | 接入插件、保持六入口/MV3、检查最终后台函数；校正既有“共享代码全部内联”注释，确认真实 assets 分发 |
| 9 | `tests/anti-detection-runtime.test.ts`、`tests/runtime-modularization.test.ts`、`tests/extension-wiring.test.ts` | VM 改读同一生成器、增加最终 bundle/worker 脱离闭包及 watch/source map 验证；移除只锁单文件内部形状的断言，保留真实安全合同 |
| 10 | `tests/background-services.test.ts`、必要 Chrome smoke/fixtures | 后台接口保持时复用现有授权测试；定向 Chrome 比较旧/新 runtime，记录导航负向、CSP 与 realm 结果 |
| 11 | `.trellis/spec/frontend/directory-structure.md`、`quality-guidelines.md`、RFC/任务证据 | 在实际生产切换后更新结构与验证合同；本任务不提前把提案写成当前架构 |

表内未写完整前缀的文件均位于 `src/injected/runtime-modules/`。每一阶段在稳定候选上检查，不为每个文件重复全部门禁；发生真实语义差异先缩小到受影响 surface，禁止趁迁移修复无关行为。

## 7. 等价性矩阵与迁移停止条件

“等价”比较授权迁移前工作树与候选的可观察值/异常/反射/副作用，不比较压缩代码文本或绝对 bundle 字节数。合成 payload 相同；随机位置采用固定随机源或同文档稳定性/范围断言，不把随机值文本相等当要求。

| 合同 | 最小可靠证据 | 本次 / 后续边界 |
|---|---|---|
| func 闭包 | 生成后与最终后台 bundle 提取实际函数，独立 VM、禁止字符串代码生成；负向外部 helper 对照 | 本次最小 fixture PASS；后续覆盖完整 runtime |
| worker 二次闭包 | 单独提取最终 workerBootstrap source，独立 worker VM，再真实 classic/module/nested | 本次仅设计；后续必须补足 |
| registry/反射 | 原生快照、隐藏键、descriptor/source/name/length、非法 receiver、未注册路径前后对照 | 现有 anti-detection tests；后续生成版本跑同一断言 |
| disabled/首次/重复 | 先 registry 的既有顺序、同签名 getter 不重装、重复仅更新未来 worker、配置刷新由后台负责 | 不能借模块化改变当前热更新语义；真实重载定向验证 |
| language/Intl/Date | languages 冻结、locale、时区/DST/固定 epoch、显式选项、构造/函数调用及异常 | Node 加定向 Chrome，旧/新结果相同；不声称已有行为全符合原生规范 |
| geo/permissions | 合法/非法 payload、稳定坐标/watch/clear、回调时序、非 geo query 原生路径 | 对照现有 VM + 可观测 Chrome fixture；不请求真实位置/provider |
| Canvas | 引号字体解析、fallback 的 finally 恢复、原生 measureText/getContext/check | VM/组件对照及目标 Chrome，保持设备透传 |
| Worker/SharedWorker | URL/type/name/credentials/patch key、options 单次读、newTarget、同步/异步错误、pagehide/revoke、module 首 connect | 复用 VG-007 VM 与 Chrome smoke，保留 synthetic connect.isTrusted=false 限制 |
| top/iframe/origin | 每文档独立 sender 授权、nonmatch 不注入、同源/跨源/blank/srcdoc、导航旧 documentId | 本次 current top/iframe PASS、stale FAIL；专项调查已在受控生产路径复现，后续须独立修复而非弱化 target |
| ISOLATED/消息 | content 只通知，普通网页不能提交可信配置；后台以 sender+resolver 生成 args | 现有 mocks/wiring；生产路径真实 Chrome 验证单列 |
| CSP/产物 | func 无 eval/import/WAR，完整 dist 六入口/chunks；严格 CSP 的具体路径 | 本次最小 CSP PASS；后续选真实受影响 CSP，不默认跑浏览器矩阵 |
| source map/watch | 两次构建后的 map 到维护 TS、修改依赖后重建、缺源编译失败 | 本次只验证第一阶段 map 的格式/来源；后续完整组合/DevTools 限制说明 |
| 安全/透传 | schema/storage/消息/DNR/权限/verified 无变化，无新增设备 hook、敏感日志或外部请求 | diff+wiring+既有 targeted checks；不增加无关扫描 |
| 首 inline 时序 | earliest/load/postLoad 分开观测，比较旧/新 | 不以模块化修复 VG-009；保留实际 FAIL，不用加载后成功替代 |

停止生产切换并保留证据的条件：最终函数/worker 含未定义外部引用；需要扩大权限/WAR 或页面配置桥；module CSP 或生命周期表现与旧候选不同且未得到解释；旧 documentId 负向场景无法建立可信安全证据；等价矩阵出现无法归属的实质差异。可在现有边界内修正构建器时继续，不因复杂度或文件数停止。VG-011 的设计与隔离 spike 可交付 review，VG-012 的生产切换不能由该状态自动授权。

## 8. VG-012 实施记录（2026-10-15）

用户已明确授权按本RFC模块化，并将VG-012校准为R3、依赖VG-011 done。第6节“未授权/原事务计划”为VG-011形成提案时的历史状态；当前范围和状态读取manifest。实施与等价性矩阵见 [任务记录](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md)。

采用第4节静态生成方案：registry/payload/entry、五个页面surface与独立worker graph；worker registry明确消费其realm，nested helper接受生成函数自引用。先生成worker再嵌入page，facade导出virtual静态函数；插件在安全暂停期间也运行构建守卫，但不把runtime加入后台或增加公开产物。最终47份dist文件与任务前构建相同。

模块纯逻辑/显式realm单测、完整函数/worker/nested独立VM、二次打包、组合map位置、page/worker watch与缺源/循环失败均有实际证据。真实Chrome155旧新对照覆盖navigator/反射、Intl/Date DST、合成位置/watch/权限、Canvas、classic/module/Shared/nested、重复仅更新未来worker、当前iframe/严格CSP和ISOLATED隔离；这不构成生产恢复授权。VG-011安全暂停与原stale documentId FAIL保持，源map不承诺注入DevTools自动定位。
