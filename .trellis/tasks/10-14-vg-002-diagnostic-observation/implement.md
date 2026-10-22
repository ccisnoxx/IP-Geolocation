# VG-002 实施与证据

## 开始状态

日期 2026-10-14；分支 stabilize/VG-002；基线 5701b55 feat: add explicit exit location profiles。依赖 VG-000=done。工作树既有 VG-000/VG-001 与图标文件，不覆盖或丢弃；共享路径按片段修改。

根及目标路径检查只有根 AGENTS.md；已读取 RTK、稳定化 README/manifest/matrix、前端规范、相关任务记录、README/PERMISSIONS/package/manifest/Vite 和实现测试。PRIVACY.md 不存在。使用 task.py create 生成本任务格式。

## 基线测试

`npx tsx --test tests/background-services.test.ts tests/diagnostic.test.ts tests/extension-wiring.test.ts`：exit 0，35 tests / 35 pass / 0 fail / 0 skipped。旧 openDiagnosticPage 测试明确要求 expected query；这是已确认泄露证据。没有不可区分的基线失败。

## 实施计划

1. 删除 launcher 的预期配置数据流。
2. 将页面改为 observation mode，删除 query 比较和普通网页 runtime 调用。
3. 更新相关测试、Chrome 清单与必要隐私文档。
4. 执行定向行为检查、独立只读隐私复核和指定本地门禁；记录结果。
5. 清理本任务临时资源，状态同步 review，等待人工验收。

## 实际实现

- services 的 launcher 只打开固定 HTTPS 地址及 ui=zh。删除 appendExpectedProfileParams、预期 timezone offset/locale 序列化和配置/privacy 读取；创建失败继续显式传播。
- leak-test 删除 ExpectedProfile、敏感 query/策略快照解析、runtime 消息和所有配置比较判定。只读取固定 UI 语言选项；所有行和摘要 UNKNOWN，原始值只有实际 snapshots。WebRTC policy 为 not_observable；ICE 无候选也不声称 protected。
- 保留页面实际 language/timezone/locale/geolocation/header echo、iframe/worker 与设备采样。旧设备基线只作为本地实际观测人工参考。STUN 与 timeout 固定原有默认值；不新增设备伪装。
- 页面 meta 与同源 header fetch 使用 no-referrer。不迁移旧 URL，不回显完整 href，不把预期数据改放到其他载体。
- 删除失去调用者的 diagnostic 比较 helper、profile locale helper、相关测试；保留观测归一化，新增实际页面 VM 合同测试。
- Chrome 脚本不再生成 expected query；清单明确人工比较与观察页 UNKNOWN。最小更新 README、PRIVACY、质量规范及稳定化 A02/VG-002 记录。

## 回归与失败分类

| 精确命令 | 实际结果与原因 |
|---|---|
| `npx tsx --test --test-name-pattern='诊断' tests/background-services.test.ts`（实现前） | exit 1，2 tests / 0 pass / 2 fail；URL 白名单断言发现额外 validation、expected*、actualWebRtc*，无配置读取断言发现 getConfig 调用；均为预期的 pre-fix 失败 |
| `npx tsx --test tests/background-services.test.ts tests/diagnostic.test.ts tests/leak-test-observation.test.ts tests/extension-wiring.test.ts`（实现后初跑） | exit 1，38 tests / 37 pass / 1 fail；后台两项通过，唯一失败是 VM 跨 realm RequestInit 对象原型造成 deepStrictEqual 失败，实际字段结构相同 |
| `npx tsx --test tests/leak-test-observation.test.ts`（修正测试对象比较后） | exit 0，3/3 pass，0 fail/skipped；使用 JSON 归一化比较序列化请求字段，未修改页面以迎合断言 |
| `git diff --check`（初次） | exit 2，仅 locale-datetime.ts 末尾额外空行；删除空行后通过，不涉及行为 |

这些失败均可定位，没有基线阻塞或未解决回归。

## 最终本地验证

| 精确命令 / 操作 | 结果 | 证据边界 |
|---|---|---|
| `git diff --check` | 修正 EOF 后及最终候选均 exit 0 | 已跟踪 diff 的 whitespace；另检查新文件 whitespace |
| `npm run typecheck` | exit 0，tsc --noEmit；最终构建再次执行同一类型检查并通过 | src 静态类型，不涵盖完整测试类型或 Chrome |
| `npm test` | URL/页面候选两轮 exit 0，74/74；补充 runtime 日志修复后最终 exit 0，75 tests / 75 pass / 0 fail / 0 skipped | Node/VM/Chrome mocks/静态 wiring；包含后台两项、页面三项隐私回归及已有伪装/配置合同 |
| `npm run build` | 最终 exit 0，Vite 5.4.21，24 modules，12 items copied | 五个入口、共享 chunks、静态资源；生成到忽略的 dist，不直接编辑产物 |
| `npm run test:e2e:chrome -- --dry-run` | 初次与最终重建后均 exit 0；首目标仅 ui=zh，清单明确 observation mode/UNKNOWN | 不安装扩展、不执行浏览器断言，不是 Chrome 验收 |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-vg-002-diagnostic-observation` | exit 0，implement/check JSONL 各 6 个有效引用 | Trellis context 格式和引用 |
| `npm run serve:leak-test -- 8787`；`curl --silent --fail --output /dev/null --write-out '%{http_code}\n' http://localhost:8787/leak-test/leak-test.html` | 本地服务正常，HTTP 200；服务在检查结束后 SIGINT 退出 130，端口 listener 已清除 | 本地构建 HTTP 页面可服务；SIGINT 为主动清理，非测试失败 |
| Codex 内置浏览器：打开 localhost 页面 → English → 中文；另用合成 expectedLanguage 与旧 validation query 打开 | 页面有实际 language/header/timezone，languageRows=4、headerObserved=true；observation=true、sensitiveMarkerVisible=false、hasPassFailBadge=false；console error/warn 为空 | 1280×720 普通网页实际渲染与交互；未加载 VanishGeo，不代表 Chrome MV3/策略验收 |

本地截图曾发现顶部长状态文字挤压标题：仅缩短顶部提示并限制状态块宽度，下方完整 observation 说明保留；重新构建、npm test 及页面截图复验通过。最终截图保留在仓库外的桌面可视化目录，用于用户核对；未保留中间截图或设备原始值日志。

## 独立只读复核

critical_reviewer 实际检查 source/test/script diff 与相关反例，没有确认阻断问题；确认无预期配置转移、页面桥、策略快照接收或正常注入/权限/verified 边界变化。主线程工具测试结果通过消息摘要转交，审查者未独立读取完整原始日志或重复运行测试。

Audit ID：20261014T075100Z-vg-002-diagnostic-privacy-review-03078ca5。本任务 SUBAGENT_EXECUTION_DIGEST 已由 work-plan 生成；audit-finalize/audit-verify passed，无异常。配置快照不是运行时模型遥测；子任务审查验收不等于用户人工验收。

审查后仅主线程调整 locale EOF 空行、顶部状态文案与布局；其他八个 source/test/script 摘要保持一致。最后两个 UI 变化不触及审查的敏感数据流，主线程检查实际 diff，并重新取得测试/构建/页面证据。

## 合同、隐私与回滚

schema v2、storage keys、迁移、runtime actions、MessageSender 校验、documentId MAIN 注入、ISOLATED allowlist、top/iframe/worker 授权、DNR、Chrome privacy 权限与 verified 事务无本次修改；配置权威仍在原三个模块。正常站点伪装与原生透传不改变；runtime 仅把 debug 日志收紧为固定字符串，不添加依赖或权限。

launcher 无配置读写、无新队列；并发/重复打开仍各建标签，创建失败传播。页面没有新持久预期配置，原 UI 偏好/设备基线键不变，无迁移或数据恢复操作。回滚只反向应用可归属补丁并重建；不 reset/clean，不覆盖既有工作；安全回滚始终保留不传敏感值的 launcher。

实际外部边界：托管访问仍传正常网络出口与请求头，页面可见实际浏览器 API 数据；用户主动位置/ICE 观测仍可能显示位置或经既有 STUN 发送网络流量。此次仅运行 localhost 与合成 VM，未触发真实位置检测、出口 provider 或 STUN。no-referrer 无法撤销旧 URL 的初始服务器请求或历史记录。

## 未验证与范围外

- 未执行 `npm run test:e2e:chrome` 的真实扩展安装/人工验收；此次完成本地实现及 review 候选，Chrome launcher 点击、DNR/策略、位置/ICE、iframe/worker、导航重启和资源请求 Referrer 实测仍须人工证据。内置浏览器的普通网页检查不能替代。
- 远端托管页面未部署；用户禁止自行发布。新 launcher 立即停止预期 URL 传值，页面 observation 行为须部署本次页面产物后才在线生效。
- 完整扩展侧报告留给用户指定的 VG-003。现清单 VG-003 为 DNR，启动前需校准；此次未修改或启动后续任务。

## 状态与清理

manifest VG-002：planned → in_progress → review；Trellis：planning → in_progress → review，completedAt=null。依赖 VG-000 保持 done，无人工验收记录，不调用 archive。既有 VG-000/VG-001 和图标工作保留；仅放行本任务六个记录。临时 server/tab 和本任务 scratch 在交付前清理，dist 保留为生成交付，独立审查 audits 为仓库外持久化证据，截图为用户核对产物。不提交、推送、merge、tag 或发布。

建议 commit message：`fix(diagnostics): remove sensitive expected values from URLs (VG-002)`。


## 收尾补充：debugMode 控制台边界

最终日志搜索发现 src/injected/runtime.ts 的唯一 log 调用仍携带完整 payload；即使外部页面不读取 query，启用 debugMode 的 allowlist 页面仍可能在控制台显示预期配置。此前 URL/页面审查没有覆盖这条原有日志路径，不能用该审查推断它已满足日志验收。

依用户已明确的控制台隐私授权，任务由 review 回到 in_progress，仅把内部 log 的输入类型收紧为单一 string，唯一调用不再传 payload；所有 hook、配置值、注入和 API 返回语义不改。新增 tests/anti-detection-runtime.test.ts 的 VM 日志回归，覆盖 debugMode 开/关、结构化与文本敏感字段，以及正常语言/时区/坐标返回。

`npx tsx --test --test-name-pattern='debugMode' tests/anti-detection-runtime.test.ts` 在修复前 exit 1，1 test / 0 pass / 1 fail，断言捕获非 string 的 payload 对象，失败原因准确。修复后 `npm test` exit 0，75/75；`npm run typecheck`、`git diff --check`、`npm run build` 和重新生成产物后的 Chrome dry-run 均 exit 0。没有重跑普通网页 smoke，因为页面 JS/HTML/CSS 及其共享输入未变；现有截图/观测证据复用，不据日志 VM 推断真实 Chrome 控制台验收。

本轮额外文件仅 runtime.ts 与其既有 VM 测试；共 26 个任务文件。对新增日志隐私合同另派 fresh critical_reviewer，只读补充审查。最终聚合审计保留第一轮已关闭审计的原始证据，不修改原 bundle。


补充独立审查未确认问题：核对 runtime 的唯一日志及唯一调用，删除第二参数没有副作用；自包含 MAIN、worker bootstrap、禁用/重复初始化与正常 API 语义未改。审查者只读源码/diff/测试，未独立重跑测试或真实 Chrome。最终聚合 Audit ID：20261014T080949Z-vg-002-final-privacy-review-0bbf5f8e；digest 覆盖两次 fresh 只读审查，audit-finalize/audit-verify passed，0 异常，无未知写入或残留活跃 Worker。原第一轮 audit 保持关闭、不可变。

补充修复和本地验证/独立审查完成后，manifest 与 task.json 再次同步 review，completedAt 仍为 null。任务历史为 planned → in_progress → review → in_progress（日志补正）→ review，没有标记 done。最终 26 个文件名单见 task.json；已检查实际 diff、未跟踪文件 whitespace/敏感路径、权威边界、最终工作树和端口。没有发现本任务覆盖无关工作或引入隐藏传值；没有新增临时资源。


## 托管页面部署授权与准备（2026-10-14）

用户明确授权将新版诊断页部署到 https://leak.962850.xyz，仅更新 leak-test 页面及必要资源，不发布扩展。当前没有执行服务器写入；缺少服务器/部署平台入口，已请求用户提供目标信息。仓库没有部署脚本；可检索历史未找到该站点部署记录；本机已配置 SSH 别名的目标地址与当前域名解析未匹配，不能据此猜测写入目标。

公开 HTTPS 检查确认旧页面仍包含 expected query 指引；新构建页面没有共享 JS chunk import，只直接依赖 leak-test.css/leak-test.js。已准备仅含 leak-test/leak-test.html、leak-test/leak-test.css、leak-test/leak-test.js 的部署包及 SHA-256 清单，保留在仓库外的桌面可视化目录。静态检查确认 observation mode、无旧预期解析/比较/配置桥、页面及 header fetch no-referrer。

线上五个被诊断页使用的 iframe/worker 静态文件均 HTTP 200 且与本地构建逐字节相同；/headers.json HTTP 200，并正确 echo 合成 Accept-Language。未记录响应中的公网 IP 或其他请求头。因此已知最小替换范围为三个 leak-test 文件，无需更新 fixtures、header 服务或扩展文件。

成功的 75 项测试、typecheck/build 与普通网页观测证据输入未变，本轮复用。临时下载、staging 及 scratch 已清理；保留部署包作为可审阅候选。VG-002 仍为 review，未作人工验收或标记 done。待提供目标后，先定位站点目录、备份原三个文件并取得回滚路径，再执行受限替换与 HTTPS/资源校验。


## 托管页面部署完成（2026-10-14）

用户通过问题卡片明确指定 hostdzire；该信息解除上一节目标待定状态。使用 personal-vps-ssh 技能及原生 SSH/SCP 别名，保留严格 host-key 验证；没有读取私钥、绕过 host-key 或修改凭据。

只读确认 /etc/nginx/sites-enabled/leak.962850.xyz.conf 管理目标域名，root 为 /var/www/vanishgeo-leak-test/current。已有 current 符号链接指向 releases/20260707035648。原有 nginx /headers.json 动态 echo、no-store、站点跳转及资源路由保持不变。

沿用既有版本目录机制：复制原网站版本到新目录，仅覆盖三个 leak-test 文件；在切换前逐项比较内容哈希、类型、权限和所有者，确认仅三个文件有差异，其余 54 项一致。复验旧版本和候选未变化后原子替换 current 链接，无 Nginx 配置修改、重启或扩展发布。

- 当前网站版本：/var/www/vanishgeo-leak-test/releases/20261014T085447Z-vg002-observation-c32a9c。
- 保留回滚版本：/var/www/vanishgeo-leak-test/releases/20260707035648。
- 实际更新：leak-test/leak-test.html、leak-test/leak-test.css、leak-test/leak-test.js。
- 回滚可重新原子切换 current 到保留旧版本，无需恢复或迁移任何扩展数据；回滚会恢复旧诊断页面，需明确考虑其旧预期 query 解析，扩展 launcher 的隐私修复不会受站点回滚影响。

### 实际部署验证

公开 HTTPS GET 的三个新文件均 HTTP 200、Cache-Control no-store、正确 HTML/CSS/JS MIME，逐字节及 SHA-256 与已验证 dist 一致。HTML/JS 无旧 expected*/actualWebRtc* 参数解析与比较，包含 observation mode 和 no-referrer。

页面所用五个 iframe/worker 静态资源均 HTTP 200 且与构建一致；/headers.json 对合成 Accept-Language echo 正确；站点首页跳转到 /leak-test/leak-test.html 正常。只保留资源名、状态、哈希及合成 echo 布尔结果，不记录真实公网 IP、位置或其他请求头。

Codex 内置浏览器访问线上 ?ui=zh 页面，实际 DOM 核对：mode=observe、status=UNKNOWN、hasExpectedProfile=false、passFailBadges=0、languageRows=4、headerEchoVisible=true；console error/warn 为空。保存首屏截图与公开资源验证摘要到仓库外桌面可视化目录，没有运行位置、出口检测或 STUN，也没有加载/发布扩展。此结果证明普通线上页面已更新，不替代用户本机 Chrome 扩展人工验收。

源代码、依赖及构建输入未变，复用 75/75、typecheck/build 的成功证据；部署候选经过独立的内容/范围与线上检查。只清理本次上传目录、下载/staging 和测试浏览器标签页；新网站版本和原旧版本保留为运行与回滚资源，没有清理其他版本或用户数据。

同步实际部署事实到 PRIVACY、稳定化 README/A02 矩阵和任务说明。VG-002 保持 review、completedAt=null；用户尚未确认 Chrome 人工验收，不修改 done，不启动 VG-003 或发布扩展。

## 人工验收

验收日期：2026-10-14；验收人：用户。用户在本轮会话明确确认：

> Chrome 人工验收已通过，请将 VG-002 更新为 done，并同步 manifest 和 Trellis 验收记录。

此前用户描述的验收环境为本机 macOS Chrome，已加载本次构建；新版托管诊断页已按单独授权部署。上述确认作为 VG-002 诊断隐私与 observation mode 范围的人工验收依据，与 Node/VM、dry-run 和内置浏览器普通网页证据分别记录。没有提供 Chrome 具体版本、逐项网络/Referer 记录或用户截图，不将本次确认扩展为其他任务、完整扩展侧报告或浏览器生命周期合同的通过证据。

状态同步：manifest VG-002 review → done，新增验收人、日期和本节证据引用；Trellis task.json review → completed，completedAt=2026-10-14，并记录同一人工验收元数据。此前各节的 review、未部署及待验收说明保留为按执行顺序记录的历史状态，以本节及 manifest 为当前结论。

本轮仅同步状态和验收文档，源码、依赖及构建输入未变，复用已通过的 typecheck、75/75 测试、build 和 Chrome dry-run 证据。收尾的 git diff --check、Trellis task.py validate、任务 JSON/状态/日期/证据引用一致性、记录 whitespace 和实际修改范围检查均通过。不归档、提交、推送、发布扩展或启动后续任务。
