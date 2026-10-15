# VG-017：earliest-inline 可行性与时序合同研究

日期：2026-10-15；阶段R5。状态、依赖以[manifest](./task-manifest.yaml)为准。**现有后台动态解析、ISOLATED通知、定向MAIN派发合同下，完整首脚本保证NO_GO；未找到合格局部补丁。** 直接注册MAIN实验展示的是固定合成值的机制能力，不是生产动态payload的解决方案。

## 本轮真实Chrome实验

Chrome155.0.8059.40，macOS arm64、Node24.16.0；一个专属临时profile、最小MV3扩展。仅使用现有权限子集scripting/tabs/storage、localhost host、WAR空；不加载生产runtime、不改正式dist。唯一模拟surface为Navigator.language getter，合成值qaa-QM。四类文档各自在第一段inline保存实际值并向本机POST；页面不接收配置或预期。正式JSON仅保留比较后的布尔/阶段状态，原生实际语言只在临时内存。

```bash
node --check scripts/recovery-research/chrome-earliest-feasibility.mjs
node scripts/recovery-research/chrome-earliest-feasibility.mjs --output .trellis/tasks/10-15-vg-017-earliest-inline-research/chrome-evidence.json
```

两条本轮exit0；第二条表示实验采集完成，JSON明确`fullTimingGuarantee=NOT_ESTABLISHED`。正式[Chrome证据](../../.trellis/tasks/10-15-vg-017-earliest-inline-research/chrome-evidence.json)保存五模式、四文档的earliest/load/postLoad，不能用postLoad覆盖earliest。

| 模式 | earliest命中合成值 | postLoad命中合成值 | 证据含义 |
|---|---:|---:|---|
| 未注册原生对照 | 0/4 | 0/4 | 无补丁时保持原生 |
| ISOLATED→后台读取storage→MAIN，暖后台 | 0/4 | 4/4 | 本轮自然热路径仍晚于首读 |
| 同链路，真实stopAllWorkers后冷唤醒 | 0/4 | 4/4 | 确认worker target消失再导航；不是整个浏览器冷启动 |
| 同链路，受控异步窗口 | 0/4 | 4/4 | 等四文档实际首读后才释放注入，提供确定性反例 |
| 提前动态注册MAIN document_start固定文件 | 4/4 | 4/4 | 固定值直接调度在这些fixture提前生效；没有生产动态配置 |

四文档为top、same-origin iframe、srcdoc、about:blank/document.write。直接MAIN的合成值位于临时包内文件，只用于机制对照；所有注册在导航前完成，分模式新开文档，避免上一模式hook残留。各模式异步执行错误0。load的实际布尔结果保留于JSON，不把load事件当后台完成信号。

这是一次有不同受控条件的机制实验，不估计自然成功率，不代表所有surface/浏览器/页面均可先于首脚本。没有为展示成功而推迟首读；受控延迟只放大注入晚到窗口。历史[VG-009生产runtime结果](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)另有12/12 earliest原生、11/12 load原生、12/12 postLoad匹配；本轮toy getter不是重跑该完整runtime。

## API与可行性依据

[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)说明document_start的直接脚本调度；[scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ScriptInjection)说明injectImmediately尽早执行但没有早于页面加载保证。注册的[RegisteredContentScript](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)提供js文件路径，没有func/args或任意inline配置字段。

已核验本机@types/chrome0.0.268的RegisteredContentScript字段，见[安装类型摘要](../../.trellis/tasks/10-15-vg-015-document-binding-research/upstream-evidence.json)；ScriptInjection是func/args或files联合类型，函数闭包不跨序列化边界。官方文档与本机类型共同支持接口结论，不把旧类型定义单独当未来API事实。

异步消息、storage、后台唤醒和跨world派发都有可让页面首脚本继续运行的间隙；本轮受控反例足以否定当前链路的普遍保证。缓存或预热只改变耗时，不能使异步链路变成同步。页面还可提前保留原生函数或创建worker，后补getter不能追溯修复这些行为。

直接MAIN固定脚本无需新权限即可在隔离实验中提前执行，但生产要求由后台从可信sender与当前配置解析任意用户payload。包内固定JS没有同步读取这份payload的现有接口；再加异步取数即恢复竞态。提前静态烧入用户配置、页面桥、扩展可调用全局installer、第二套页面匹配器均不满足现行合同。当前研究未证明所有未来API不可能，只给出当前合同/API下无合格候选的结论。

[userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts)需要新增userScripts权限及用户启用条件，不作为当前权限下的候选；不申请该权限。暂停解析器、同步忙等或拦截网络阻塞页面也没有本轮证明的安全/兼容方案，不作为修复承诺。

## 恢复决策与门槛

| 路线 | 条件与结论 |
|---|---|
| 完整恢复，承诺首脚本前保护 | 尚不可进入实施。先找到可信配置在首脚本之前可用且同步安装的机制，必要时另行审查架构合同；文档绑定也必须通过VG-015门槛 |
| 保留时序限制的有限恢复 | 只有文档绑定先合格、用户另行接受具体早期泄露范围并授权恢复后才可考虑；当前接受安全暂停不等于此授权 |
| 继续暂停 | 当前推荐。DNR/WebRTC独立按实际结果报告；不把已保存配置显示成页面伪装生效 |

完整时序方案必须满足：

1. 有机制依据确保可信有效payload及同步安装先于页面首个相关API读取，不以统计全绿代替保证；不得扩大allowlist/权限或引入页面可控配置。
2. 复用VG-009真实首脚本fixture，分别判earliest/load/postLoad；覆盖冷/热后台、浏览器启动/恢复、更新、导航、严格CSP及已授权iframe/fallback边界，来源不明仍拒绝/UNKNOWN。
3. 首脚本缓存原生函数、创建classic/module/SharedWorker的场景单独验收；不能用后续worker包装成功替代早期实例保护。
4. 对生产自包含runtime和最终dist验证，不以本轮固定getter机制对照、VM或dry-run代替。strict/compatible、未接管API、DNR、WebRTC、配置/verified/迁移边界不退化。
5. 若只能有限恢复，UI、报告与文档必须保留earliest FAIL和已知提前泄露，不能称完整保护；明确初始化提交、配置撤销、BFCache旧hook与worker重建语义，独立复核后人工决定。

## 未验证与安全范围

本轮未覆盖完整Intl/Date/Geo/Canvas/worker surface、跨origin/sandbox/opaque来源、所有CSP/同步创建即读的iframe情况、整个浏览器冷启动、Chrome119/其他版本及自然竞态频率。原生位置、provider、STUN均未调用；loopback fixture和控制页只读写临时profile。Chrome自身后台网络未全面监控，不声称全网络离线。

生产源、schema/storage、runtime消息、manifest/host/权限、依赖、版本、构建及历史证据均保持。临时扩展包含固定合成MAIN脚本是受控研究对照，不进入产品，不绕过VG-011后台闸门。脚本退出时清理profile/server，正式布尔证据保留。任务本地结束review；不启动恢复候选，不提交/推送/发布。

## 研究人工验收（2026-10-15）

用户确认VG-017研究验收通过，接受当前NO_GO结论及已知限制，见[人工验收记录](../../.trellis/tasks/10-15-vg-017-earliest-inline-research/implement.md#人工验收)。manifest现为done，Trellis为completed；研究验收不改变NO_GO，也不授权恢复或发布。生产伪装继续暂停，不启动恢复实施，不改版本、不提交、推送或发布。原始实验结果、恢复门槛和未验证范围保留。
