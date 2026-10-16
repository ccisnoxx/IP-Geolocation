# 空 body 与自动恢复补充验证

2026-10-16；本轮仅修复实验和补充 smoke，停在 review，尚无针对本轮补丁的新人工验收。不修改生产 src/build/manifest，不重写三个本地提交，不暂存或提交，不启动后续稳定化任务，不 push/tag/发布。Navigator 保持 review；US-EXP、VG-023 的既有人工验收状态不变。

## 修改与独立性

- 最小 collector 读取 `document.body?.innerText`；body 尚未创建时由原 until 继续等待。其他异常、超时、sandbox 判定和网络门禁不变。回归测试实际执行该读取表达式，覆盖 null→正文；修复前提交在同一测试下因读取 null 的 innerText 按预期失败。
- 新增固定 `--recovery-only` 模式，复用现有 Linux namespace/降权/Chrome 启动及正常详情页 Allow User Scripts 流程。新模式只要求7项：network、chrome-sandbox、fresh-disabled、normal-user-switch、register、worker-restart、extension-update。它只采页面语言/时区，不启动 Dedicated/SharedWorker 采样，不声称本轮覆盖其他暂停 surface。
- 完成合成配置后关闭所有本扩展页面及扩展详情页；恢复段内业务 message 入口会拒绝调用。直接附加 service worker 的 CDP session，先 Runtime.enable，再调用浏览器原生 userScripts.unregister/getScripts，确认空注册后停止 worker 并确认目标消失。
- worker 重启由 ServiceWorker.startWorker 触发；扩展更新只改 VM 临时 dist 副本版本 2.1.1→2.1.2，通过同目录 Extensions.loadUnpacked 更新同一扩展，不显式启动 worker。两者都直接等待 worker 出现并读回完整注册，不调用 getSiteConfig 或重试。
- 注册与更新前快照完整相等后，才创建新 localhost 文档；顶层和普通 HTTP iframe 的首 inline、load、current 必须为 fr-FR / Europe/Paris / offset -60。首 inline 必须 loading、scriptIndex=1、inline=true。
- 宿主要求 schema v2、对应 scope、两组隔离/清空/注册/新文档证据以及三层清理 PASS。原 schema v1 的恢复 PASS 标签不能通过新门禁。

Chrome 自身 sandbox、仅 lo 的 IPv4/IPv6 prohibit namespace、非 root collector 和7项 socket/继承检查均保留。没有放行 Allow User Scripts 的 flags/prefs/私有设置，没有第三方站点/provider/STUN请求。新增 CDP protocol 查询仍走同一 namespace 的 loopback。

## 实际结果与新证据

| 检查 | 结果 |
| --- | --- |
| 最小 fixture / acceptance / recovery 门禁定向测试 | 13/13，通过，无 skip |
| 修复前空 body 反证 | 按预期失败，临时副本已删除 |
| 本次8个 JS 文件语法检查 | 通过；修改后的最终 collector/host/两个参数入口再次检查 |
| git diff --check | 通过，新增文本另检查行末空白 |
| 最小真实 Chrome | linux-body-ready-evidence.json：GO/0，25项必需检查PASS，含实际BFCache恢复；三层cleanup PASS |
| 独立恢复真实 Chrome | production-auto-recovery-evidence.json：GO/0，7项必需检查PASS；两组注册精确回读及top/iframe三阶段PASS；三层cleanup PASS |

两份新报告均来自 Chrome155.0.8059.84 / Linux ARM64 / Node24.16.0，运行期间394个生产路径 changedCount=0。最小 fixture 的 pauseGate 保持严格：从 a4a4055 临时导出暂停基线，仅复制当前实验 JS，再只读使用原 Git 元数据枚举输入；未切换、重置或修改原工作树。临时导出目录已删除。因此该报告证明修复后的最小实验，不把当前生产恢复候选冒充暂停状态。

生产 dist 的47个文件与先前已验证的 VG-023 构建逐字节相同；本次生产源码、TS测试、构建/依赖输入未变，复用其 typecheck、typecheck:tests、185项测试、build与dry-run成功证据，未重跑这些门禁。dry-run 没有浏览器验收含义。

复现独立恢复（先按 linux-fixture-review.md 准备独占 VM）：

```sh
limactl start vg-userscripts-fixture
node scripts/chrome-language-timezone-smoke.mjs --recovery-only --output experiments/userscripts-document-start/production-auto-recovery-rerun.json
limactl stop vg-userscripts-fixture
```

原 linux-evidence.json、production-evidence.json、三份历史 macOS BLOCKED 和人工验收记录未覆盖。新 JSON 不能替代用户对新补丁的人工确认。

## 未通过的尝试与限制

本轮两次完整17项模式在新增恢复步骤前等待文档观测超时：第二次诊断表明 iframe Dedicated Worker 未收到消息，而文档 complete、语言/时区与 SharedWorker 已有样本。没有确认 Worker 缺样本根因，没有修复该范围外采样或将它计为通过。一次独立恢复尝试在 worker CDP 上下文读取时异常；后续增加 Runtime.enable 和上下文诊断后完成。三次 BLOCKED 原始报告与日志在本轮仓库外执行回执中保留，均三层cleanup PASS。

独立恢复7项 GO不等于本轮完整17项通过。更新使用临时未打包扩展版本更新，不是商店升级；证明没有管理面消息介入的自动恢复，不单独区分 worker 顶层初始化和 onInstalled(update) 两个自动入口的贡献。CDP连接可能延长 worker 存活；未验证长期自然休眠、频繁目标更换、Chrome138实机、HTTPS、跨源/OOPIF或生产BFCache矩阵。

本轮生产 Geolocation/Permissions geolocation、Canvas、Worker、SharedWorker 和 Temporal 继续暂停，DNR/WebRTC生产源未改。真实Chrome/profile/端口、namespace、VM staging已回收到0；独占VM停止，保留可复用安装。

## 第二组 worker 就绪与 target 换代补充修复

本次仍停在 review，未取得针对本补丁的新人工验收。第一组、旧第二组候选树、全部历史 JSON 与三条本地提交保持原样。旧第二组候选的鲜测曾在扩展更新阶段 BLOCKED：target 已出现，但上下文 `chrome` 为 undefined；原 GO7 不能替代这次失败。

本次仅新增 fixture `worker-reader.mjs` 及回归检查，接入生产 smoke collector。它按扩展 origin/type 枚举 worker，在同一次求值内检查原生 API 就绪、绑定预期 manifest 版本后才读取注册；未就绪或旧版本继续有界等待。确定的 CDP target/session/context 生命周期错误会丢弃 session 并重新定位；读取后复核 target 仍存在，拒绝已换代 target 的旧成功值。真实 API 异常、非生命周期 CDP 错误和超时仍 BLOCKED；注册清空写入只执行一次，不因重新定位重写。更新注册的版本和 readback 绑定于同次 worker 求值，随后才创建新文档。

新增8项 Node/VM 回归覆盖延迟 namespace、context 销毁、session/target 换代、读回期间换代、版本并存、API 拒绝、非生命周期错误和有界超时。它们是观察器合同检查，不是 Chrome 验收。

新证据另存 [production-worker-ready-evidence.json](./production-worker-ready-evidence.json)：真实 Chrome155.0.8059.84 / Linux ARM64，scope=`automatic-language-timezone-recovery`，7项全部 PASS，GO/0。两段恢复均关闭扩展管理页、业务消息数为0，先清空注册并确认 worker 消失；重启用 ServiceWorker.startWorker，更新仍为临时副本同目录 2.1.1→2.1.2，更新段没有显式 startWorker。均精确回读3条注册，再验证新 localhost 顶层/普通iframe首 inline、load、current 的 fr-FR / Europe/Paris / offset -60。更新段实际等待过1次 API 未就绪，最终版本为2.1.2。真实 namespace/sandbox/正常详情开关与三层 cleanup 均 PASS；生产路径 changedCount=0。

本次只复验7项，不声称完整17项或其他暂停 surface 通过；旧完整模式 iframe Worker 缺样本记录保留。未验证自然休眠、频繁真实 target 更换、商店升级、Chrome138实机、HTTPS、跨源/OOPIF或生产BFCache矩阵。确定性的 target 失效分支由定向回归覆盖，本次真实 Chrome 没有发生读回期间 target 销毁。没有修改生产代码、任务状态、隔离或权限约束；Navigator 仍 review，其他页面能力继续暂停。

独立只读复核未确认阻断性缺陷。宿主 `independentRecoveryPassed` 尚未独立验证 workerReadiness 的 API/版本字段及 update 的版本身份字段；本次版本绑定由 collector 同次求值、8项回归和真实 JSON 共同证明，不把此点表述为宿主已独立拒绝无版本字段的报告。本轮按最小 fixture 修复范围保留该门禁，不扩展后续任务。

## 默认执行上下文缺失 P2 最小修复

本轮只处理 `Cannot find default execution context`：将这条精确、带 CDP 错误码的协议错误加入 fixture worker-reader 的既有生命周期重试分类。没有扩大通用 context/异常吞掉范围；仍使用原有有界尝试、丢弃旧 session 和重新附加逻辑。API 拒绝、访问拒绝、普通异常和超时继续失败。P3 宿主版本/身份字段校验缺口暂不扩展，宿主和 recovery-evidence 源码保持原样。

新增1项回归在修复前因该精确错误按预期失败；修复后确认重新附加到第二个 session、只读注册1次、API/版本就绪、失效会话计数1且求值2次。新第二组候选定向检查22/22通过，无skip；包含原有API拒绝/访问拒绝/有界超时检查。该P2分支由Node/VM回归证明，没有把它写成真实Chrome已发生该协议错误。

真实 Chrome 新证据另存 [production-default-context-evidence.json](./production-default-context-evidence.json)：Chrome155.0.8059.84 / Linux ARM64，scope=`automatic-language-timezone-recovery`，GO/0，7项全部PASS。恢复段依旧无管理页业务消息，更新不显式启动worker；两段均先清空注册并确认旧worker停止，恢复后精确读回3条注册，再创建新localhost顶层及普通iframe，首inline/load/current均为fr-FR / Europe/Paris / offset -60。正常Allow User Scripts UI、Chrome自身sandbox、仅loopback/IPv4+IPv6 prohibit/非root及三层cleanup均PASS；运行期间生产路径changedCount=0。

本轮7项不代表完整17项。未重跑最小25项、完整17项或自然休眠/高频换代/商店升级/Chrome138/HTTPS/OOPIF/生产BFCache矩阵。生产源码、TS测试、构建及依赖输入未变，47文件dist与已验证构建一致，复用既有类型/185测试/build/dry-run证据；dry-run没有浏览器通过含义。

第一组、两个旧fixture候选树、全部原JSON和三条本地提交保留，新JSON不覆盖旧证据。补丁仍停在review，不记人工验收、不改稳定化任务状态。Navigator保持review；Geolocation/Permissions geolocation、Canvas、Worker/SharedWorker与Temporal继续暂停。不暂存、提交、push或发布，不启动后续任务。
