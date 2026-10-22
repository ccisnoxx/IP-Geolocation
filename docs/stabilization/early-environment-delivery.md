# VG-027：可信早期环境交付与位置恢复资格

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
