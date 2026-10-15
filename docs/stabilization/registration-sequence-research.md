# VG-021：P0-F 注册文件序列隔离验证

日期：2026-10-15。依赖VG-020已人工done。本任务已于2026-10-15人工验收通过，manifest为done、Trellis为completed；当前状态以[manifest](./task-manifest.yaml)为准。

## 结论

**有限同步表达：GO（仅本机合成4位机制）；作为保持当前合同的安全恢复方案：NO_GO。生产伪装继续暂停。** 本轮没有证明F类设计普遍不可行，也未证明当前toy组装不可被页面干预。研究完成、机制GO、生产恢复与发布分别决定。

真实Chrome证明，在扩展包不变时，扩展控制页可以选择位置专属固定文件，把4位非敏感数据在首inline前同步组装；没有func/args并不等于无法表达配置。重复引用同一文件则不能按本探针预期编码：API保留重复列表，但实际组装只有01。文件列表有顺序，不等于列表整体原子执行；begin排入的微任务可在第一个位片段前运行。注册快照还保留当前合同不能接受的禁用窗口：先保存禁用、再注销的受控间隙内，新文档仍安装旧序列。

这些结果只适用于下面的固定探针及Chrome构建，不把“未攻破”写成安全通过，不把存量getter不撤销写成Chrome注销失败。

## 可复现入口与证据

从仓库根目录执行：

```sh
node --check scripts/recovery-research/chrome-registration-sequence.mjs
node scripts/recovery-research/chrome-registration-sequence.mjs --output .trellis/tasks/10-15-vg-021-registration-sequence-probe/chrome-evidence.json
```

环境：Chrome/155.0.8059.40，macOS arm64，Node v24.16.0，真实headless Chrome、独立临时profile；使用原生CDP Extensions.loadUnpacked加载临时扩展，未使用VM或dry-run替代浏览器。正式[Chrome JSON](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/chrome-evidence.json)包含20个场景、runner摘要、全部27个固定程序的摘要、注册js数组及逐文档布尔结果。27个程序合计1860字节；6文件表达4位，34项重复列表仅作负向容量观察。runner固定维护在[scripts/recovery-research](../../scripts/recovery-research/chrome-registration-sequence.mjs)。

临时manifest只用scripting/tabs/storage、http://localhost/*，MV3、无background、无WAR、无静态content_scripts；相对生产七权限和all_urls为子集，生产manifest未修改。Chrome自动化调试开关不属于扩展权限，不能作为生产设计前提。临时扩展版本1.0只是独立探针，生产版本2.1.0不变。

各文档head首个inline同步保存实际值，load回调另存；驱动收到load样本后通过当前CDP target读取第三阶段及同源子帧，不使用executeScript(documentIds)重新选址。预期只在驱动比较，页面仅上报合成实际观测；受控fixture不是可信配置来源。数字表示命中驱动合成预期，不表示完整伪装效果或人工验收。

## 逐项结果

| 场景 | 实际观测 | 判定 |
|---|---|---|
| 原生 / 单文件固定MAIN | 四类文档首读分别0/4、4/4；load/postLoad一致 | 正负对照有效 |
| 重复文件global / lexical | 各6项列表均注册成功，保留重复路径；四文档assembledBits均01，未commit，首读0/4 | 重复字母表编码NO_GO；不推定所有版本规则 |
| 位置专属global / lexical | 各6个不同路径，0110组装成功；top、HTTP iframe、srcdoc、blank/write各首读4/4，load/postLoad同样4/4 | 有限同步表达GO |
| 不重建包切换1001 | 更新文件选择后四文档首读4/4，实际commit为1001 | 证明可选数据，不只是单固定档案 |
| 32位重复列表 | 34项被API接受，但实际仍为01，未commit，首读0/1 | 没有证明32位表达或容量上限 |
| 严格CSP | nonce首脚本、default-src none；0110三阶段1/1 | 仅该CSP对照PASS，不外推全部策略 |
| 不完整序列 | begin + 1位 + end，未commit、未装getter，首读0/1 | 部分组装未产生toy hook |
| 文件间微任务 | top、HTTP iframe、srcdoc的begin微任务观测bits.length=0；blank重用场景可为4 | 非原子、依上下文调度；不是页面成功篡改证据 |
| 父页setter / 已知lexical绑定 | global setterCalls=0，getter仍0110；lexical push可由父页改写，但发生在4位提交后，getter仍0110 | 公开状态可接触；未证明提交前攻击成功或不可行 |
| 父页预排microtask | global未取得cell；lexical在length=4时改写push；各首读仍1/1 | 未抢占实际组装；安全性NOT_ESTABLISHED |
| 攻击有效性对照 | 无动态注册，由普通父页eval相同global组装程序；setter调用1次，0110被翻转为1001，toy getter随之改变 | 证明setter攻击逻辑有效；不冒充原生注册路径被攻破 |
| update完成 | 旧文档保留A，新文档使用B | 当前fixture下更新边界有效，存量不更新 |
| unregister完成 | 新文档无commit；存量文档仍保留B getter | 注销不等于撤销存量hook |
| storage禁用至注销间隙 | 保存syntheticEnabled=false后、尚未注销时新文档仍A；注销后新文档无commit | 受控新鲜度反例，NO_GO；不统计自然发生频率 |
| 在途导航 | HTTP响应头保持未发送，待update/unregister完成后放行；分别新B/无commit，无旧A | 只覆盖该导航窗口，不证明renderer队列/BFCache绑定 |
| 非匹配origin | 127.0.0.1页面无commit（仅localhost注册） | 本探针host边界有效 |

blank/write的首读命中没有区分初始blank安装与document.open/write后再次安装；父页setter是在append返回后才预置，不能据其未触发证明已有全局上的重新组装安全。该边界仍留给后续生命周期研究。

globalCell和全局lexical都不能直接称为私有：后者可由同源父页普通eval访问，本实验也记录了这种访问。但此次没有观测到原生注册组装期间的成功篡改。攻击正向对照使用页面eval，不是注册调度；这两种证据必须分开。列表顺序及document_start的公开合同见[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)、[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)，核验于2026-10-15；两者不能代替本轮微任务与撤销实测。

## 为什么不能恢复

1. 当前F只提供注册时快照，而当前合同要求后台按可信sender与当前配置逐文档授权。storage与注册API不是本实验已证明的原子事务。仅把写入顺序反转也不能自动解决更新失败、启用、后台重启和并发导航的全部语义；本轮不修改它们。
2. 本轮组装依赖页面可接触的共享状态，且列表允许微任务间隙。未观测到提交前篡改，不等于证明缺失的私有性/原子性；不补造攻击成功，不把checksum或隐藏Symbol当认证。
3. 4位非敏感合成数据不覆盖任意语言列表、时区、坐标、auto/verified和规则优先级。不得为适配F静默缩小配置或把真实IP、精确位置、凭据编码进文件序列。位置专属库的大小、解析/注册成本和Chrome上限未测。
4. 本实验没有调用旧documentId派发，减少了那一特定路径的依赖；没有完成P2文档生命周期验证，不表示Chrome原生错投已修复。BFCache、document.open的完整重注入/撤销、扩展更新与renderer缓存仍缺证据。
5. toy language getter不包含生产反射、Intl、Geolocation、Canvas、Worker/SharedWorker，首读机制PASS不能替代完整runtime集成。

## 后续门槛与停止点

继续研究F需另行授权具体候选，而不是直接恢复。至少先明确可接受的数据类型/容量与隐私限制，给出不依赖页面信任的组装机制，并针对微任务、同源父页/opener、global复用、原型污染和重入做攻击及正向对照；失败即停止该候选。

授权新鲜度需单独方案：证明当前配置与注册快照的提交/失效边界，或由用户明确接受不同的文档快照语义。不能把本次RFC或研究验收推定为接受合同弱化；已经执行的hook/worker需重建文档或经证明可撤销。

通过这些门槛后才讨论P2生命周期及P3配置/首读，最终P4须完整runtime、独立安全复核和人工恢复授权。当前不启动P1/P2/P3/P4、VG-016/018/019或任何生产实施；发布仍需独立决定。

## 数据流、验证与回滚

只访问loopback fixture/CDP；无provider、STUN、真实位置或用户配置访问。临时生成文件来自固定程序模板，值域仅合成位，不eval用户字符串、无远程代码。页面攻击对照的普通eval专用于本地合成代码，生产代码不新增eval。HTTP POST仅报告合成观测，JSON不含原生语言、doc/tab ID、精确IP/位置、个人路径或凭据。

实际运行node --check及上述真实Chrome命令，退出0表示采集完成；预期负向结果及NO_GO保留。另运行git diff --check、Trellis校验、状态/JSON/链接/新文件空白、生产输入及dist/ZIP摘要核对。生产输入不变，复用VG-014的typecheck、typecheck:tests、170/170、build/dry-run证据，不重新运行npm ci、生产测试/构建或完整Chrome集成。没有Chrome119/其他OS、全部CSP/文档/worker矩阵、容量极限、性能基准或新的独立代理复核。

临时profile、扩展、server由finally清理；中间重复探针JSON已被完整正式证据替代并删除。只保留研究runner、报告、Trellis记录、正式脱敏JSON和治理索引。回滚仅撤销本轮可归属文件增量，不reset前序脏树；生产暂停不需要回滚，存量旧hook仍须关闭重建。未提交、推送、改版本、打tag或发布。

## 人工验收确认（2026-10-15）

用户接受有限同步表达GO、安全恢复NO_GO及已知限制，见[人工验收记录](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/implement.md#人工验收)。本任务manifest由review更新为done、Trellis由review更新为completed；此前review/pending是本地交付阶段状态。该确认验收隔离研究，不提升页面防篡改、最终文档绑定或完整恢复资格，不授权后续验证阶段、恢复实施或发布。生产伪装继续暂停，版本/权限及正式Chrome证据保持；未提交、推送或发布，未补写用户未提供的浏览器证据。
