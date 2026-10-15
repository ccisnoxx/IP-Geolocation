# VG-014 发布候选验收

日期：2026-10-15。阶段 R4；任务状态只读取 [task-manifest](./task-manifest.yaml)。**当前不具备完整功能 release-ready 条件，禁止据本报告自动发布。** VG-011 的生产页面伪装安全暂停保持，旧 documentId 错投和 earliest-inline 负向证据未修复。本报告验收当前安全暂停候选，并将隔离 runtime 功能结果单独列出；PASS 不表示恢复生产派发。

## 候选与环境

- 分支 `stabilize/VG-014`，HEAD `5701b55`。整个稳定化波次尚未提交；HEAD 不能单独重建本次候选，当前不是已锁定提交的正式 RC。
- VG-001～VG-013 均已由用户人工确认并在 manifest 为 done。用户于2026-10-15确认VG-014人工验收通过，接受当前安全暂停和已知限制；manifest为done、Trellis为completed，见[人工验收记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md#人工验收)。该确认不构成发布批准，生产伪装继续暂停。
- package.json、package-lock.json、manifest.json 及 dist manifest 均为 `2.1.0`，本任务未改版本。
- macOS `27.0.1`、Darwin arm64、Node `v24.16.0`、npm `11.13.0`、Vite `5.4.21`；真实 Google Chrome `155.0.8059.40`，headless、独立临时 profile、Chrome DevTools Protocol 实际加载扩展。
- dist 内容摘要：`36873ecb6b27a39830daa44b404fceef38eab629bfd9c0f5dbaaf631207bd3f0`。算法为相对路径排序的 `[path, sha256]` JSON 再 SHA-256；[artifact-evidence.json](../../.trellis/tasks/10-15-vg-014-release-acceptance/artifact-evidence.json) 保存全部 47 个文件摘要。集成 Chrome JSON 使用同一算法绑定候选。
- 本地交付 `release/vanishgeo-v2.1.0-vg014-candidate.zip`，SHA-256 `35e9e7b3b4bb1eed32450b7a0cdc2194ec3c7254e6da50a05b3387b358ea0b5a`，与 dist 每个文件字节相同；未上传、未发布。

## 发布判定与阻断

| 项目 | 判定 | 处理 |
|---|---|---|
| 完整页面伪装 | **阻断** | 生产 MAIN 派发与初始化注册继续暂停，language/timezone/location/Canvas/Worker 保持原生。必须先取得可靠最终文档绑定、另行授权恢复并重验 |
| 最早 inline | **完整功能 FAIL** | 暂停前 VG-009 已确认异步竞态；暂停候选的 earliest/load/postLoad 原生值也不能算伪装 PASS。原历史 FAIL 不变 |
| Chrome 155 旧 documentId | **已知安全缺陷未修复** | 本轮证明扩展零派发阻断有效，不证明浏览器已修复；旧 hook/BFCache 文档必须关闭重建 |
| 正式 RC 身份 | **待完成** | 工作树为前序波次未提交候选。未来授权发布前需审阅并确定精确提交、版本/tag 与同一构建证据 |
| VG-014 人工验收 | **已通过** | 用户于2026-10-15接受当前安全暂停和已知限制；不改变负向证据或覆盖缺口 |
| 发布批准 | **未批准** | 用户明确要求任务完成不视为发布批准；不改版本、不提交、不推送或发布 |
| 新增 P0/P1 产品回归 | 本轮未确认 | 两项独立只读审查及实际检查未提出生产代码修复；未恢复任何安全边界 |

建议后续完整功能版本号 **2.2.0**（含已实现的 Intl 模式等稳定化变化）；仅是建议，须在阻断消除、人工批准后统一 package/lock/manifest/tag。若要先发布安全暂停版本，须由用户明确批准其缩减能力及版本方案；本任务不作该决定。

## 逐项集成矩阵

本表更新原 acceptance matrix 的当前证据，不覆盖历史数据。`Chrome` 指本轮真实 Chrome155 自动化；`Node` 指本轮 170 项 Node/VM/mock/静态测试；`隔离` 使用最小测试扩展直接执行当前 runtime，生产仍暂停。

| 原矩阵/领域 | 本轮执行与判定 | 尚未证明 |
|---|---|---|
| A01 配置/disabled rules | Chrome：Options/Popup 无关模式保存保留禁用规则，重新启用保留 ID、overrides 和 verified 档案绑定；Node 规则文本与冲突合同通过 | 真实 action Popup 窗口、跨窗口同时编辑和全部 storage 故障组合 |
| A02 diagnostic privacy | Chrome：固定 localhost URL、页面 observation UNKNOWN、普通 sender/非报告页拒绝、预期不进入 URL/DOM；报告 header omit credentials/no-referrer；Node 旧 query 忽略/无桥通过 | 本轮未访问 hosted 实际部署或保存其网络日志 |
| A02b extension report | Chrome：实际 header/policy 和设备透传可见；页面语言/时区及 worker 伪装行保留 FAIL；ICE 空候选 UNKNOWN；owner、取消/晚到、同 URL 导航、实际两分钟报告 TTL | 任意恶意页面、全部 CSP/权限撤回组合；报告 MAIN 观测仍可受页面干预 |
| A03 DNR | Chrome：主域/子域、具体子域优先级、nonmatch/disabled、禁用/删除后的真实主文档请求头；失败注入后 saved/failed、重试实际恢复、同签名无重复 DNR 写入；Node 容量/管理 ID/Chrome119 combined 限额 | 未在真实 Chrome119 耗尽配额；页面/worker 语言一致性受生产暂停阻断 |
| A04 WebRTC | Chrome：strict/compatible/default 实际值与控制权、总开关关闭清除；完整诊断 policy 与 ICE 分开；Node 其他控制者/不支持/API失败通过 | 当前环境未验证企业策略、第二扩展遮蔽释放或跨网络 ICE 泄露矩阵；空 ICE 不能证明保护成功 |
| A05 MAIN/ISOLATED 与 runtime sync | Chrome 安全闸门：BFCache persisted 恢复、跨 origin、同 URL reload、旧注册清理、保存/重试、真实 worker stop/wake 后生产派发 0；两页暂停可见；ISOLATED 无配置桥 | 浏览器旧 ID 错投仍存在；新集成 runner 的自动附加重启路径超时，采用独立闸门证据，详见执行记录 |
| A06 iframe | Chrome 暂停下 top/iframe 原生、三阶段 top/same-origin/srcdoc/about:blank 实际值；隔离：子帧单独应用不改 top，严格 CSP、ISOLATED 不变 | 完整 cross-origin/sandbox/origin fallback 授权与导航矩阵 |
| A07 Worker/SharedWorker | 隔离 Chrome：classic/module/shared/shared-module/nested、同 key 共享身份/不同 name、module 顶层顺序、未来 worker 更新；Node URL 生命周期/异常/回收通过 | 跨文档共享与广泛 credentials/CSP、真实 BFCache worker 回收；Shared module 缓冲 connect.isTrusted=false 的已接受限制保留 |
| A08 strict/compatible、Intl/Date | 隔离 Chrome 两模式 top/iframe/五类 worker：默认与显式 locale/timeZone、DST、非法 timezone/原生错误、其他 Intl 构造器；正式 dist 两管理页保存模式、旧 v2 缺字段默认 strict 且 raw 不重写 | 不表示生产派发生效、所有 Intl API 或全部浏览器支持 |
| A09 Geolocation/Permissions/Canvas/设备透传 | 隔离 Chrome：合成坐标 get/watch/clear、permission、Canvas fallback/恢复、原生设备引用透传与旧实现等价；生产诊断拒绝原生位置权限，未知位置不冒充 PASS | 真实位置、真实 watcher 导航/权限撤回、随机分布与全面设备反检测；不新增指纹面 |
| A10 onboarding/安装/重置 | Chrome：空配置安全关闭、空脚本/DNR/default、明确确认要求、跳过、主动合成检测确认绑定、启用后暂停可见、reset 清空；无自动 provider 请求 | 本轮未执行旧发行二进制到当前版本的更新、整个浏览器冷启动；旧任务升级证据仍属历史 |
| A11 migration/import/export | Chrome：非法导入不写、合法导入降级并解绑、三组合法零坐标真实 storage 迁移/重复读取、已有 v2 raw 保留；Node 中断/旧键/非法 Profile；源审查确认完整导出未脱敏 | 真实断电/磁盘写失败、全版本迁移链、用户下载文件后续处理；导出仍含敏感字段 |
| A12 verified 出口事务 | Chrome 合成 provider 发出前拦截，用户式检测/确认/绑定与导入降级；Node 取消/过期/并发重检/碰撞/清理失败/恢复；独立源码审查无新增 P0/P1 | 真实 provider 可用性、跨管理页并发及 session 任意中断 |
| A13 集成 | 同一 dist 摘要串联上述配置、网络、隐私、报告、迁移；安全闸门/隔离模式分开保留正式 JSON | 完整功能观测 FAIL；人工验收接受当前暂停和已知限制，不扩展为全部浏览器、全生命周期通过 |
| A14 发布 | 本地完整门禁、47 文件/4 chunk/ZIP 字节一致、版本与权限审查通过；CI/release 只读审查 | 远端 Actions、tag 版本约束、正式 Release/商店、发布中断恢复与人工批准 |
| A15/A16 runtime 模块化 | Node 生成/二次打包/外部绑定守卫、watch/source map；隔离 Chrome 与 VG-012 保存的模块化前 runtime 等价，生产暂停不变 | source map 不等于 Chrome 复制函数后自动关联，生产最终文档绑定未修复 |

## 自动门禁与命令

所有命令均在仓库根目录执行，打包命令明确以 dist 为工作目录。源码、测试、锁文件、构建配置在本任务未变化，成功证据按相同输入复用；新增 runner 由实际 Chrome 执行，静态审查器对实际 ZIP 执行。

| 精确命令 | 结果与含义 |
|---|---|
| `npm ci` | exit 0，安装 50 packages；未升级/新增依赖 |
| `npm run typecheck` | exit 0，源码 TypeScript |
| `npm run typecheck:tests` | exit 0，测试 strict TypeScript |
| `npm test` | exit 0，170/170，0 fail/skip；Node/VM/mock/静态，不是 Chrome |
| `npm run build` | exit 0，Vite5.4.21，29 modules，静态复制13项，47文件 |
| `npm run test:e2e:chrome -- --dry-run` | exit 0，仅检查入口与打印清单 |
| `node scripts/chrome-integration-smoke.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/chrome-evidence.json` | 最终 exit 0，11组 PASS；实际报告12 PASS/54 FAIL/4 UNKNOWN，伪装FAIL与ICE UNKNOWN保留；runner错误及调整见implement.md |
| `node scripts/runtime-modularization/chrome-safety-gate.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/safety-gate-evidence.json` | exit 0，extensionGate PASS，productionRuntimeDispatches=0；测试 wrapper 保持 worker/content 字节及权限一致 |
| `node --import tsx scripts/chrome-intl-smoke.mjs --output .trellis/tasks/10-15-vg-014-release-acceptance/intl-evidence.json` | exit 0，两模式及配置合同 PASS；隔离 runtime 与正式配置/UI分别解释 |
| `gzip -dc .trellis/tasks/10-15-vg-012-runtime-modules/baseline-runtime.ts.gz > "$VG014_TMP/baseline-runtime.ts"`，随后 `node --import tsx scripts/runtime-modularization/chrome-equivalence.mjs --baseline-runtime "$VG014_TMP/baseline-runtime.ts" --output .trellis/tasks/10-15-vg-014-release-acceptance/runtime-evidence.json` | exit 0，旧新严格模式等价 PASS。VG014_TMP 是本任务系统临时目录；基线 SHA-256 见 JSON，不是 HEAD 文件或生产恢复 |
| `(cd dist && zip -qr ../release/vanishgeo-v2.1.0-vg014-candidate.zip .)` | 本地 ZIP 已创建；清理本轮错误工作目录打包的归档后，从空归档重新打包 |
| `node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.0-vg014-candidate.zip --output .trellis/tasks/10-15-vg-014-release-acceptance/artifact-evidence.json` | exit 0，47文件逐字节一致、4共享chunk全部可达 |
| `node --check scripts/chrome-integration-smoke.mjs`、`node --check scripts/audit-release.mjs` | runner/审查器语法检查，非行为证据 |
| `bash -n scripts/release-changelog.sh` | 独立审查实际执行，exit 0 |
| `git diff --check` | exit 0；新文件另外做空白和内容检查 |

正式证据：[集成](../../.trellis/tasks/10-15-vg-014-release-acceptance/chrome-evidence.json)、[生产安全闸门](../../.trellis/tasks/10-15-vg-014-release-acceptance/safety-gate-evidence.json)、[两模式](../../.trellis/tasks/10-15-vg-014-release-acceptance/intl-evidence.json)、[隔离 runtime 等价](../../.trellis/tasks/10-15-vg-014-release-acceptance/runtime-evidence.json)、[产物清单](../../.trellis/tasks/10-15-vg-014-release-acceptance/artifact-evidence.json)。复用 runner 的 JSON task 仍为 VG-011/012/013，路径及本节命令标明属于 VG-014 当前候选的重新执行；未修改原任务 JSON。

## 安全、隐私与构建审查

生产 schema v2、storage key、迁移、消息动作、manifest、权限、host scope、DNR/WebRTC 实现、verified 确认、MAIN/ISOLATED 所有权和构建行为均未改。实际修改限验收脚本与记录/文档；未发现需要 P0/P1 产品修复的证据。

MV3、最低 Chrome119、七项必需权限、`<all_urls>`、无静态 content scripts、WAR 为空与源 manifest 相同。六个入口、页面 HTML/CSS、icons、fixtures、LICENSE/NOTICE 和4个共享 assets 全部随 ZIP 分发；生产后台不打包页面 runtime，生成守卫仍运行。无 map、sourceMappingURL、运行期 eval/new Function、远程可执行 import/HTML脚本或悬空资源；敏感模式检查无命中。该检查结合独立源码审查，不声称静态扫描可以证明任意动态代码或所有未知秘密不存在。

真实 Chrome 使用任务专用 profile，不操作日常浏览器数据。合成出口检测请求在发出前被 CDP 拦截；无真实 provider 请求。localhost 与 `.test` 本机映射仅服务 fixture；无配置传至托管站点。位置权限被明确拒绝；完整诊断实际保留已有 Google STUN 调用，服务可能看到网络出口，原始 ICE 字符串只在浏览器短暂内存中处理，正式证据仅有分类状态，无地址。报告 header 请求不发 cookie/Referer；预期留在扩展。公开记录只有相对路径与合成/布尔证据。

CI/release 的同等门禁和失败传播经独立审查；默认 contents read，仅 release job write，checkout不持久凭据，完整历史 changelog，不吞 Git 错误。workflow **没有 tag/package/manifest 自动一致性或人工审批步骤**，tag push 后仍创建正式 Release；这是已文档化的现有发布前提，本次不改流程或触发远端。未来发布必须人工核对精确候选，不能依赖自动门禁替代授权。

## 回滚、未运行项与后续

- VG-014 回滚点是本任务开始时的整个脏工作树，不能用 `git reset --hard 5701b55` 代替。只撤销本任务新增 runner/审查器、文档增量与记录；保留全部前序成果。审计记录保存增量，未创建提交或 tag。
- 当前完整候选 ZIP 可用于人工复核安全暂停版本；不是已发布回滚版本。未验证跨版本降级数据兼容，不自动覆盖/迁移用户配置。
- 不得回滚 VG-011 安全闸门来恢复功能。旧版已执行 hook 的页面与 BFCache 文档需关闭重建，必要时由用户重启浏览器；配置保存不能撤销旧 hook。
- 未运行：Chrome119/其他浏览器矩阵、真实 action Popup、人为企业策略/全部控制权组合、真实 provider/hosted部署、真实位置、任意断电/迁移中断、远端 CI/Release/商店。原因分别是本地只有当前 Chrome 环境、自动化界面边界、不可可靠重现或不在对应外部授权范围。不能据本报告补写通过。
- 后续仅列出、不实施：可靠文档绑定及生产恢复；earliest-inline 解决方案；用户批准的缩减能力发布方案或完整功能 RC；最低版本/iframe/权限与生命周期缺口；发布 tag 版本自动守卫及审批改进。不得因本列表自行新建/启动任务。

独立复核：两位 fresh critical_reviewer 分别检查发布构建与诊断/配置事务，均未确认新增 P0/P1。审查范围和正式审计摘要见 [执行记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md)，不将实现者自查称为独立复核。

## 恢复前研究补充（2026-10-15）

用户在VG-014人工验收后授权VG-015、VG-017研究。两项当前状态见manifest；[文档绑定报告](./document-binding-research.md)与[首脚本报告](./earliest-inline-research.md)均给出当前完整恢复NO_GO及后续门槛。新的真实Chrome研究不更换本报告的dist/ZIP、不升级发布资格；VG-014 done与未批准发布的结论保持，生产安全暂停继续。
