# VG-027：可信早期环境交付与位置恢复资格

> **阅读顺序（2026-10-22）**：下方“2026-10-20 原始研究”保留当时的NO_GO与暂停判断，不代表当前生产状态。VG-029后续已独立获准恢复并人工验收；当前范围和剩余缺口见文末[限定范围收尾对账](#2026-10-22-限定范围收尾对账)。VG-027已按限定范围人工验收为done，本次不扩大生产合同。

## 2026-10-20 原始研究（历史阶段）

2026-10-20。本轮为实施计划第9节允许的架构研究交付，状态以 `task-manifest.yaml` 为准。**现有语言/时区恢复保持；动态位置、Permissions geolocation 和 Worker 恢复为 NO_GO。** 这表示缺少恢复资格证据，不是证明 userScripts 无法承载坐标。未改动 VG-022、旧负向证据或生产位置入口。

## 基线与编号

原计划以 VG-023 指代“产品契约v3”，本仓库实际记录为 VG-028，且与 VG-024 均已人工 done。历史 VG-023 是已人工验收的 userScripts 语言/时区恢复，不能重复实施或撤销。VG-015/017/020/021 的 NO_GO 针对当时 documentId、异步交接或多文件编码架构；后续已批准 userScripts 权限及每文档快照，已解决语言/时区的配置同步来源，不应继续把旧“没有同步配置API”当作当前事实。

现有 `page-scripts.ts` 从 config-resolver 的最小结果编译单个固定函数加安全 JSON，Chrome 提前选择新文档；不再次通过旧 documentId 定位，不依赖网页配置，不暴露跨文件组装状态。`language-timezone-entry.ts` 只安装 Navigator/Intl/Date（不含 Temporal），明确拒绝非 HTTP(S)/opaque 文档。`getLanguageTimezonePayload` 不含位置、IP、provider、规则/档案列表。当前权限缺失/正常用户开关未启用仍 fail closed。

## 六项门槛与差距

| 门槛 | 现有语言/时区 | 动态位置候选 |
|---|---|---|
| 最终执行文档身份 | Chrome 声明式新文档注册；不用 documentId 重新选址 | 可复用机制，但没有本轮位置生命周期实测 |
| 首次 API 读取前配置可信可用 | 单函数/JSON，已有历史真实 Chrome 首 inline 证据 | 可加入最小坐标快照，但未验证首调用/getter保留/回调行为 |
| 更新/撤销新鲜度 | 串行撤销→更新→新增→读回；旧/BFCache快照需重建 | 必须独立接受位置旧快照的隐私影响，不能以注册注销代表坐标撤回 |
| 网页不能提供可信配置 | 无页面桥/全局installer；后台唯一解析 | 同方向可行，需专门验证同源父页/原型污染/调用重入 |
| BFCache/iframe/worker/reload | 普通HTTP(S)窗口支持；特殊文档与Worker不支持；历史证据层级分别保留 | 位置watch/timer与冻结恢复未验；Worker不应顺带恢复 |
| 旧hook清理与提示 | 完整重载或关闭重建，不热更新 | 旧位置watch与已返回坐标无法撤回；必须明确timer生命周期与退出行为 |

语言/时区的历史证据见 `.trellis/tasks/10-16-vg-023-userscripts-language-timezone/implement.md`；其中 BFCache、Chrome138、HTTPS/OOPIF 等限制不能改写为本轮已通过。VG-025 的固定字体文件没有敏感配置，只能证明该候选的有限探测路径，不能补齐本表位置空缺。

## 建议的最小位置候选边界

未来若实施，继续由 config-model / config-resolver / storage 拥有归一化、解析、持久化。不要另建域名匹配器、页面取配置API、第二份档案或多文件编码。将已验证 auto 档案或用户明确的 manual 坐标解析成仅含位置所需字段的独立 payload；不包含公网IP、国家码、provider、档案ID、规则列表或其他档案。只交付给匹配允许的 HTTP(S) 文档；网站能读取被交付坐标，这一数据披露与仅语言/时区不同，不能当作无敏感数据路径。

候选应复用现有注册队列与每文档快照，而不是重新调用完整 runtime。位置专用入口、最小类型和语义签名应在同一任务里建立，确保位置变化只为受影响文档记录人工重载，不能借用当前刻意排除位置的语言/时区签名。不得默认改变原生授权或伪装 PermissionStatus；是否接管权限必须有独立明确合同和验证。

当前 `geolocation-permissions.ts` 属于暂停的维护源：watch 使用 interval，权限可回报 granted，尚无本轮证据证明 callback/receiver/权限事件/冻结清理满足生产合同。直接把该模块导入语言/时区 entry 会同时扩大数据、权限表面与生命周期，缺少验收基础，故本轮不接线。最小固定字体脚本同样不导入该模块。

## 可执行资格矩阵与停止条件

针对拟恢复的具体浏览器构建，使用临时 profile 和 loopback 合成位置：新建顶层与同源/跨源普通HTTP iframe首 inline直接调用；未匹配、opaque、srcdoc/about:blank/data/blob为负对照；同URL reload、父子域优先级、A→B旧/新文档、撤销完成及受控撤销窗口、实际 BFCache hit、document.open、iframe移除重建、worker重启与扩展update分别记载。页面只报实际值，预期和可信配置只在扩展控制面。

同时验证 getCurrentPosition/watchPosition/clearWatch 的 receiver、参数转换、异常、callback顺序、取消、后台冻结恢复及原生权限拒绝；不以 Node/VM、后加载样本或“采集退出0”代替 earliest/安全判断。无实际BFCache hit不得报告通过；若旧授权向替换文档泄露坐标、首调用得到原始值、未验证档案产生auto坐标、关闭后的新文档仍被旧注册覆盖，立即停止该候选并保持暂停。存在已执行hook时要求用户重建文档，不能声称可撤回网页已读取的数据。

本轮不新增位置实验、不执行外部provider或真实定位请求；已足够确认生产入口仍排除位置，缺口不能靠重复历史实验填补。位置恢复需上述资格证据、独立只读复核及人工恢复授权；研究可进入 review，生产保持 NO_GO。

## 官方接口核对与证据限制

2026-10-20 核对 [Chrome userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts)：支持 MAIN 和 code/file 源，Chrome138+正常用户开关，扩展更新清注册并由 onInstalled 恢复。由此推断单函数 JSON 也能表达最小位置，但该接口能力不证明位置模块安全。

[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) 的注册与命令式注入是不同入口；[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) 描述 document_start 和 MAIN world 与页面共享环境。公开API文档不证明特定Chrome缺陷已经修复，也不保证页面不能事后替换hook。旧 documentId 负向证据保留，当前位置不使用任何新入口。

只做公开文档GET与本地源审查，无用户配置/位置上传；没有重新运行或覆盖历史Chrome JSON，没有访问provider/STUN/第三方检测站，没有commit、push或发布。

## 2026-10-22 限定范围收尾对账

本节依据当前源码和从Git恢复的VG-029原始记录整理，不改写上述历史研究、旧负向结果或当时未验证项。VG-027缺失的任务记录已[明确标注为重建](../../.trellis/tasks/10-20-vg-027-early-delivery/implement.md)。本次仅文档及证据收尾，不运行新实验、不恢复Worker；用户已授权本地提交，暂不push。

### 后续独立授权与证据来源

VG-029于2026-10-22独立取得最小定位userScripts和Geolocation/Permissions geolocation恢复授权并获人工验收；[验收记录](../../.trellis/tasks/10-22-vg-029-geolocation-recovery/acceptance.md#2026-10-22-人工验收确认)、[原工作树Chrome证据](../../.trellis/tasks/10-22-vg-029-geolocation-recovery/chrome-evidence.json)、[独立提交范围Chrome证据](../../.trellis/tasks/10-22-vg-029-geolocation-recovery/commit-scope-chrome-evidence.json)和[用户当前Chrome现场记录](../../.trellis/tasks/10-22-vg-029-geolocation-recovery/current-chrome-evidence.json)已从838c301按字节恢复。删除发生于da068f2；恢复来源及摘要见VG-027执行记录。

两份自动Chrome证据均为Chrome155.0.8059.86/macOS arm64/headless、30/30 PASS、cleanup PASS；用户现场签收另有记录。历史NO_GO说明当时缺少恢复资格，不证明userScripts无法承载坐标。后续限定范围恢复来自位置自身实现、实测与授权，不是从字体静态脚本或语言/时区PASS推导。

### 六项门槛的当前证据层级

| 原研究门槛 | VG-029补充及当前合同 | 仍需保留的边界 |
| --- | --- | --- |
| 最终执行文档身份 | Chrome声明式MAIN/document_start定位专用注册；普通顶层及同源/跨源iframe正负对照 | 不使用旧documentId路径；不宣称所有文档生命周期或替换攻击均验证 |
| 首次API读取前可信配置可用 | 固定模板加安全JSON；六字段最小位置payload；首inline、三方法、参数和回调实测 | 自动坐标仅取规则绑定verified档案；网站能读到交付坐标，不是无敏感信息路径 |
| 更新/撤销新鲜度 | 共享配置队列；注册撤销、更新、新增和读回；A→B、reload、关闭和删规则新文档对照 | 配置持久化与浏览器注册不原子；旧文档/BFCache保持旧值，受控撤销窗口未有独立完整位置实测 |
| 网页不能提供可信配置 | 后台解析、独立闭包快照，无页面配置桥；receiver和getter重入测试及Chrome对照 | 不能提升为完整同源父页/原型污染对抗证明，也不承诺网页无法事后替换hook |
| BFCache/iframe/worker/reload | 实际persisted=true，恢复同一A文档仍A；watch初次和恢复各一次；iframe、reload、后台worker唤醒及扩展update | 后台service worker恢复不等于页面Worker伪装恢复；document.open等仍缺独立实测，页面Worker/SharedWorker不支持 |
| 旧hook清理与提示 | watch隐藏/冻结暂停、取消及退出清理，独立定位重载债；静态位置不再interval轮询 | 关闭/撤销完成后的新文档恢复，不撤回旧网页已取得坐标；旧文档必须完整重建 |

### 现行合同

定位解析由[config-resolver](../../src/shared/config-resolver.ts)拥有，仅交付latitude、longitude、accuracy、randomize、randomRadiusMeters、spoofPermission，不含IP/provider/档案标识。独立[定位入口](../../src/injected/runtime-modules/geolocation-entry.ts)和[注册实现](../../src/background/page-scripts.ts)不扩展语言/时区payload，不恢复完整runtime或页面桥。

只在原生定位API存在、非opaque、安全上下文且Permissions-Policy允许的普通HTTP(S)文档工作。启用合成权限时，geolocation权限语义表示扩展提供合成坐标；关闭时保留原生query，仅原生granted才交付，prompt/denied拒绝，不主动获取真实位置。权限API异常不能转换成granted。当前合同详见[配置指南](../../CONFIG_GUIDE.md#合成定位)；失败状态不代表能保证撤回所有旧注册或既有文档数据。

### 未验证项与收尾判定

- 未找到完整同源父页/原型污染攻击矩阵、document.open、受控撤销窗口的独立位置Chrome证据。相关Node/VM行为与真实浏览器覆盖分别保留，不将它们合并为全六项PASS。
- Chrome138、其他OS、真实TLS传输、定位完整冷启动/会话自动恢复和全部故障组合仍未验。HTTPS origin fixture通过CDP本地fulfill提供，不是TLS传输验证。
- 原生取位调用次数没有在Chrome JSON中测量；fixtureInvokedNativePosition只表示fixture未主动调用，哨兵只证明未交付该值。源码/VM支持的结论单独记录。
- 合成对象保持原型兼容但无原生内部slot；不保证无法检测。旧坐标不可撤回，特殊文档及Worker继续不支持。
- 当前定位入口、运行时、注册模块和定位Chrome脚本相对838c301未变；共享匹配器后续增加localhost子域，语言校验也变化，旧30项不冒充当前完整构建重验。
- 原VG-027独立复核记录未找回；VG-029记录载明其自身独立复核及人工验收，不能冒充VG-027本轮新独立复核；本次限定范围人工签收另行记录。

限定范围交付结论：保留历史NO_GO；承认VG-029独立授权下已验收的定位恢复；未验证项保持未知，Worker不恢复。VG-027研究收尾无需为了完成文档而补跑全部未来矩阵，用户已按限定范围人工验收，状态done，不新增生产授权。见[人工验收记录](../../.trellis/tasks/10-20-vg-027-early-delivery/implement.md#2026-10-22-人工验收确认)。
