# 执行记录

## 开始前核验

2026-10-15；分支 stabilize/VG-012；HEAD 5701b55。已执行 pwd/status/branch/log，根 AGENTS 是唯一适用文件；读取 RTK、workflow、前端目录/质量、稳定化三入口、VG-011 RFC/任务/安全暂停及源码测试。工作树大量前序未提交改动保持；本任务可能修改的原文件临时副本用于等价与归属核验，路径不进入公开记录。

依赖 VG-011 人工 done；本任务按用户授权将旧出口事务范围校准为 R3 模块化，VG-013/014 不实施。编码前完整13项preflight已输出。

基线：`npm test` exit 0，154/154，0 skipped；`npm run typecheck` exit 0；`npm run build` exit 0，29 modules、六入口及现有共享 assets。无基线失败。生产暂停仍生效，不恢复 MAIN 派发。

后续实施、验证与证据在实际完成后补录。

## 结构与行为

- `src/injected/runtime.ts` 从1,588行完整函数改为2行facade。维护源在 runtime-modules：types/payload/registry/entry、五类surface、worker独立registry/navigator/Intl-Date/nested/entry。原算法按责任搬移，未顺便修正现有伪装语义。
- 页面 anchor 显式传入唯一registry；runtimeReady、原生快照、WeakMap/Set、workerPatchSource、SharedWorker URL Map和安装顺序保持。worker registry接收本realm原生全局，nested显式接收生成的bootstrap自身，避免对页面函数闭包的依赖。
- 两阶段构建先生成自包含worker，再展平page，静态函数外只允许纯export。生成器/插件未新增依赖；复用已安装Vite/Rollup/TypeScript，接口核对本地类型。生成失败中止，不回退旧实现。
- 插件buildStart在暂停期间仍生成校验，但后台没有runtime import/executeScript路径，生产不恢复任何MAIN伪装。virtual module的内部解析ID只用于组合map，不写维护树生成正文；watch登记page/worker实际依赖且不缓存生成结果。
- schema v2、storage/迁移、runtime message action/payload、manifest六入口/权限/host/WAR、DNR/WebRTC、resolver/verified边界不变。`src/background/services.ts`保持任务前内容。
- 真实dist检查：任务前后47个文件，新增0、删除0、内容变化0；六入口和原共享assets完整，无独立runtime或额外chunk/WAR。忽略的dist是正式构建验收候选，保留供加载。

## 行为等价性矩阵

| 合同 | 本次实际证据 | 结论与边界 |
|---|---|---|
| func闭包 | 同一生成器、最终facade二次bundle、禁字符串代码生成VM；构建反例测试 | 完整函数独立执行；暂停期间正式后台没有runtime函数，不能虚称已在生产派发验证 |
| worker二次闭包 | 最终函数生成的Blob prelude独立VM，再生成nested并独立执行；Chrome classic/module/nested | 无页面helper依赖，递归自引用保持 |
| registry/反射 | 原12项runtime VM断言；直接模块realm/state；Chrome旧新snapshot | descriptor/source/name/length/非法receiver/隐藏anchor/未接管反射路径保持 |
| 首次/重复/顺序 | entry与任务前逐函数对照、VM SharedWorker同配置/变配置恢复、Chrome重复调用 | 原language→geo→Intl/Date→Canvas→worker顺序；重复不更新页面值/getter，仅刷新未来worker |
| language/Intl/Date | VM既有显式选项断言、Chrome旧新冬/夏固定epoch、locale/format/toString | 行为等价；不把现有实现宣称完全符合原生规范 |
| geo/permissions | VM稳定随机位置/watch/clear/非geoquery；Chrome合成12/23/accuracy50回调/watch/granted与notifications透传 | 无真实位置/provider请求；完整原生权限/导航回收矩阵未扩大 |
| Canvas | 字体纯逻辑单测；Chrome Arial→monospace测量和字体恢复、旧新相同 | 沿用原finally/目标字体语义；未增加设备表面 |
| Worker/SharedWorker | 原VG007 options/缓存/失败/revoke/pagehide VM；Chrome七类fixture、同key计数/name隔离、module依赖与延迟connect、未来worker | 保留synthetic connect.isTrusted=false限制；本次未重新覆盖所有浏览器/CSP/网络credentials矩阵 |
| top/iframe/origin | Chrome当前iframe先独立注入/top不变，再top注入；正式dist BFCache/跨origin/reload零派发 | 非生产恢复；旧documentId错投仍是VG011正式FAIL，不能以当前文档等价替代 |
| ISOLATED/消息 | 既有sender/消息/wiring测试；Chrome MAIN更改不影响ISOLATED原生值 | 普通页面仍无可信payload输入/配置桥；services与content字节不变 |
| CSP/产物 | Chrome script-src none当前top/iframe函数执行；单函数/单chunk守卫、47份dist一致 | 无eval/import/WAR新增；不推断任意CSP/Chrome版本支持 |
| source map/watch | 最终二次bundle map实际位置回到registry和worker维护TS；临时副本修改page/worker后真实build watch输出更新；缺源/循环失败 | 组合map/watch通过；不承诺序列化func的MAIN DevTools自动映射 |
| 安全/透传 | diff/wiring；Chrome native设备引用保持；正式dist安全闸门全部PASS | schema/存储/权限/verified不变，无设备hook或额外网络 |
| 首inline三阶段 | 原VG009正式FAIL保留；本次暂停下三轮四类文档、同run比较/渲染一致与无UNKNOWN | earliest/load/postLoad各12/12原生；相对伪装预期均FAIL，符合暂停，不声称修复竞态 |

## 真实 Chrome

1. `node --import tsx scripts/runtime-modularization/chrome-equivalence.mjs --baseline-runtime "$VG012_BASELINE_RUNTIME" --output .trellis/tasks/10-15-vg-012-runtime-modules/chrome-evidence.json`：exit0，Chrome155.0.8059.40，旧/新对照PASS。VG012_BASELINE_RUNTIME指向任务开始保存的原runtime临时副本，SHA-256记录在JSON；公开记录不写其本机路径。使用临时最小扩展最终二次bundle，真实scripting.func/args、当前documentId与MAIN；普通localhost提供fixtures，扩展页持有合成payload，无页面配置桥。退出finally清理扩展/profile/server。
2. `node scripts/runtime-modularization/chrome-safety-gate.mjs --output .trellis/tasks/10-15-vg-012-runtime-modules/safety-gate-evidence.json`：exit0，extensionGate PASS，生产runtime派发0；BFCache persisted、跨origin、同URL reload、真实service worker停止/唤醒、保存/同签名重试均阻断，旧脚本注销，Options/Popup暂停可见，DNR/WebRTC各自ok。复用VG011维护runner，输出task字段仍VG011；是本次候选重新执行，未改原证据。
3. `npm run test:e2e:chrome -- --injection --runs=3 --output .trellis/tasks/10-15-vg-012-runtime-modules/injection-evidence.json`：exit2，观测前`setSiteConfig`的partial与runner要求ok不符。dist与任务前逐字节一致，services依然按VG011安全合同返回partial；这是历史runner与已批准暂停状态不兼容，不是模块化恢复或新时序回归。原runner和VG009正式JSON均未改。
4. `node "$VG012_PAUSED_TIMING_ADAPTER" .trellis/tasks/10-15-vg-012-runtime-modules/injection-evidence.json`：exit1、实际FAIL；使用上述runner的临时副本，仅将配置保存状态断言适配为下方条件，其他导航loader、采样、比较/渲染同run、取消清除、三阶段分类和退出码不变；引入临时绝对导入/项目定位只为运行副本，不进入公开产物。JSON附vg012Context说明及adapter哈希。三轮均12 PASS/60 FAIL/0 UNKNOWN（PASS为结构/来源等行），四种文档各阶段均original，runtime exceptions=0，请求只有固定fixture路径。

```js
if (request.action === 'setSiteConfig' && response.status === 'partial') {
  assert.equal(response.saved, true);
  assert.ok(response.syncReport.components.contentScripts.errors.some(e => e.code === 'runtime-injection-paused'));
} else assert.equal(response.status, 'ok', 'VG-009 后台动作失败');
```

这不是把原生保持标成伪装PASS；JSON的result保留FAIL。真实Chrome自动化与完整人工验收分开：本任务人工验收pending；未运行Chrome119/其他浏览器、真实公网provider/ICE或生产伪装恢复。前者无版本特定改动/矩阵授权，后两者不属于本任务，生产恢复还需可靠最终文档绑定和独立授权。未运行远端CI或发布。

## 失败诊断

- 拆分后的首次源码类型检查发现workers模块export未生成（提取脚本遇到零缩进模板正文）；补齐导出后生成成功，非运行时差异。
- 首次定向VM/wiring为29/30；唯一失败是旧单文件源码正则仍查Object而模块实际使用objectCtor，调整为权威registry源的等价接线断言；12项VM行为均通过。
- 构建新测试发现最终source map来源为空；Vite虚拟模块的无位置ID无法正确组合相对来源。改为有明确内部文件位置的virtual解析并将中间map来源定位到原TS，最终两次bundle的实际位置断言通过，不向页面添加sourceMappingURL。
- watch初次断言受生成JS单双引号重写影响；规范化断言中的引号后，分别确认page/worker变更重建。过程中一次测试括号笔误已修复；未修改生产算法来通过测试。
- 测试类型检查发现SourceMap.findEntry联合类型和Worker测试替身赋值不匹配，采用类型缩窄与显式测试替身后通过。
- 独立复核报告的构建守卫反例、修正及最终验证在完成后补录。

## 独立复核与修正

按项目授权使用fresh只读critical_reviewer，未复用实现上下文。审查确认30个页面helper（26个token相同、4个转译等价）及worker四个原语句区段保持；独立write:false二次构建确认单chunk/无import及map实际位置，未独立运行Chrome。

发现两项P2构建守卫缺口：诊断码白名单漏Node名称，成员形式eval/Function调用漏检。当前迁移正文没有这些调用，仍须满足强制构建合同。修正为在无Node环境的TS值绑定上解析全部引用，避免JS检查器合成CommonJS名称；加入require/process/Buffer/module/exports/__dirname和缺失shorthand反例。代码编译检查覆盖标识符、点访问、字符串索引和括号表达式，并拒绝import.meta。反例在修复前由独立审查实际重现，修复后定向测试通过。未添加运行时兜底或放宽CSP。

该审查交付已验收；修正后由主代理运行反例、全部161项测试、类型、构建及最终Chrome等价检查，没有把主代理修正后的自查称为第二次独立复核。Audit Bundle已关闭并校验通过：`20261015T035818Z-vg-012-runtime-modules-review-713b9bf8`，validated SUBAGENT_EXECUTION_DIGEST为1次只读独立复核、无写入、无异常。

## 最终本地检查

| 精确命令 | 最终结果 | 证据层级 |
|---|---|---|
| `git diff --check` | exit0 | 已跟踪空白；新增维护/文档另检查 |
| `npm run typecheck` | exit0；最终`npm run build`内也执行 | src静态类型 |
| `npm run typecheck:tests` | exit0 | strict测试及被导入build工具类型 |
| `npm test` | exit0，161/161，0 skipped/failed | Node/VM/mock/wiring；保留全部既有断言 |
| `npm run build` | exit0，Vite5.4.21，29modules | 六入口与共享assets；47份dist文件与基线相同 |
| `npm run test:e2e:chrome -- --dry-run` | exit0 | 复用同一47份dist输入的入口清单证据，不执行浏览器 |
| `./node_modules/.bin/tsx --test tests/anti-detection-runtime.test.ts tests/extension-wiring.test.ts` | 初次29/30，旧源码正则已修复；最终包含在161/161 | 原12项runtime VM均通过，wiring保持安全边界 |
| `./node_modules/.bin/tsx --test tests/runtime-build.test.ts` | 修正守卫后4/4；补禁用首次调用测试后的最终5项均在全套中通过 | 完整函数/worker/nested序列化、map/watch与失败守卫 |
| `node --check scripts/runtime-modularization/chrome-equivalence.mjs` | exit0 | Chrome runner语法 |
| Chrome旧/新等价命令（上节） | 最终exit0，PASS | 真实Chrome155临时扩展，当前文档函数等价 |
| 正式dist安全闸门命令（上节） | exit0，PASS | 真实Chrome155，生产零派发与暂停生命周期 |
| 原VG009时序命令（上节） | exit2，partial/ok不兼容，未开始观测 | 如实保留历史runner限制 |
| 暂停适配时序命令（上节） | exit1，实际FAIL；三次×四文档各阶段原生，无UNKNOWN | 真实Chrome155，同run证据；不声称伪装PASS |

## 回滚、隐私与未验收

回滚只撤销本任务可归属的41个路径增量，恢复任务前完整runtime及Vite配置/测试并重建；不reset到HEAD，不回滚VG011安全暂停，不改storage数据或Git历史。已安装hook本来就不能由代码回滚即时撤销，旧页面/旧BFCache需关闭重建。无新增生产并发/队列/重试/迁移；watch/临时进程退出时清理。

未新增生产依赖、权限、host scope、WAR或伪装面；无外部配置桥。Chrome等价只向本机fixture发正常请求、合成payload只交真实scripting API，位置API由已安装合成hook返回，未请求真实位置/provider/ICE/STUN；设备透传只保留布尔引用一致性，未写设备细节。未监控Chrome全部内部网络，不能声称浏览器绝对离线。正式JSON不含真实IP/坐标/个人路径/凭据/扩展ID或tab/documentID；原始时序快照只含语言/时区/固定epoch与阶段判定。

未执行完整人工Chrome acceptance、真实action交互、Chrome119/其他浏览器、广泛权限/网络/CSP矩阵，原因是本次自动化只对实际改动边界作定向验证，人工验收留给用户；暂停状态下历史功能清单不构成可运行的完整伪装验收。stale documentId和最早inline竞态仍是既有已接受限制，功能恢复须独立授权和可靠绑定证据。后续仅列VG-013兼容模式/集成验收（开始前校准同一manifest）、VG-014发布；原A12事务缺口待用户重新分配，均未实施。

manifest VG-012按授权planned→in_progress→review；Trellis planning→in_progress→review，completedAt=null，human_acceptance=pending。VG011仍done、VG013/014块逐字保持。不归档、提交、push、merge、tag或发布。

## 复现输入与资源清理

旧/新等价需要准确任务前源；为不依赖将清理的临时目录，正式保留只读 `baseline-runtime.ts.gz`（原runtime完整源码压缩，非第二份生产实现，不进入src/测试模块/dist）。解压后SHA-256与Chrome等价JSON的baselineRuntimeSha256相同；用于人工复现和精确回滚runtime。

```bash
VG012_BASELINE_RUNTIME=$(mktemp)
gzip -dc .trellis/tasks/10-15-vg-012-runtime-modules/baseline-runtime.ts.gz > "$VG012_BASELINE_RUNTIME"
node --import tsx scripts/runtime-modularization/chrome-equivalence.mjs --baseline-runtime "$VG012_BASELINE_RUNTIME"
rm "$VG012_BASELINE_RUNTIME"
```

如需保存新证据，可加 `--output <新的脱敏JSON>`，不覆盖已交付JSON。回滚runtime也可直接把该压缩输入解压到runtime.ts，再撤销本任务的virtual/plugin接入并重建；services安全暂停保持，旧schema/数据不动。

最终本任务41个路径列于task.json relatedFiles；Git暂存区为空，未触碰无关前序改动。新增文本空白/末尾换行、相对链接及个人/临时路径检查通过；压缩输入经解压哈希校验。保留非源码仅为三份Chrome正式JSON、精确任务前压缩对照与忽略的dist候选；临时副本/生成JS/map/adapter/watch目录及Chrome profile/server均清理。

## 人工验收

2026-10-15，用户明确确认：

> VG-012 人工验收通过：当前 dist 可正常加载，模块化前后行为等价，VG-011 安全暂停保持。

依据该确认，manifest 的 VG-012 从 review 更新为 done；Trellis 从 review 更新为 completed，completedAt=2026-10-15，human_acceptance=passed。本记录前文的 review/pending/completedAt=null 是此前本地交付状态，当前验收结果以本节及 manifest 为准。

此次确认覆盖当前 dist 加载、模块化前后行为等价和 VG-011 安全暂停保持。用户未提供本次人工验收的 Chrome 具体版本、截图或逐项执行日志，不把此前 Chrome155 自动化环境当作人工验收版本，不补写未提供的脚本退出码或子项结果；Chrome119/其他浏览器及广泛权限/网络/CSP矩阵等既有覆盖缺口保留。

生产 MAIN 派发继续暂停。旧 documentId 错投、earliest-inline 竞态、历史 runner 的 partial/ok 不兼容，以及暂停下时序相对伪装预期的 FAIL 原始证据保持；done 表示本任务模块化及本次确认的验收完成，不表示功能恢复或浏览器缺陷已修复。

本轮只同步本任务状态、验收记录及稳定化索引。源码、测试、配置、依赖、构建与 Chrome 工具输入未变化，复用本任务已记录的源码/测试类型、161/161测试、build、dry-run及定向Chrome证据，不为状态更新重复执行；另核验本轮差异、JSON/状态/日期/引用一致性和空白。VG-013、VG-014及其他任务不启动、不改状态；不归档，不提交、推送、合并、打tag或发布。
