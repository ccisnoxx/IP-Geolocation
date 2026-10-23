# 项目实现与历史记录

本页在 2026-10-23 的项目文档整理中建立，收纳原根目录文档中的内部任务背景、实现细节和历史验收说明。整理基线为 `383e9aef35b2c6768b5b9d07bc2b6d3439427fed`，本次没有改变生产代码、权限、配置或发布工作流。

以下摘录保留整理前的语境，其中“当前”“本轮”“暂停”“授权”等措辞只描述原记录对应阶段；不能直接推定为现行功能、任务状态或操作授权。日常使用以根目录正式文档为准，稳定化任务状态只读取 [任务清单](../../docs/stabilization/task-manifest.yaml)，真实覆盖范围见 [证据索引](../../docs/stabilization/evidence-index.md)。

## 原始文档与现行入口

| 主题 | 现行文档 | 整理前完整版本 |
| --- | --- | --- |
| 安装与更新 | [INSTALL.md](../../INSTALL.md) | [原始版本](https://github.com/ccisnoxx/VanishGeo/blob/383e9aef35b2c6768b5b9d07bc2b6d3439427fed/INSTALL.md) |
| 配置 | [CONFIG_GUIDE.md](../../CONFIG_GUIDE.md) | [原始版本](https://github.com/ccisnoxx/VanishGeo/blob/383e9aef35b2c6768b5b9d07bc2b6d3439427fed/CONFIG_GUIDE.md) |
| 隐私 | [PRIVACY.md](../../PRIVACY.md) | [原始版本](https://github.com/ccisnoxx/VanishGeo/blob/383e9aef35b2c6768b5b9d07bc2b6d3439427fed/PRIVACY.md) |
| 权限 | [PERMISSIONS.md](../../PERMISSIONS.md) | [原始版本](https://github.com/ccisnoxx/VanishGeo/blob/383e9aef35b2c6768b5b9d07bc2b6d3439427fed/PERMISSIONS.md) |
| 构建与发布 | [RELEASE.md](../../RELEASE.md) | [原始版本](https://github.com/ccisnoxx/VanishGeo/blob/383e9aef35b2c6768b5b9d07bc2b6d3439427fed/RELEASE.md) |

## 功能演进与验收入口

| 记录 | 背景 |
| --- | --- |
| VG-005 | CI 与发布门禁、版本校验和更新日志生成 |
| VG-011～VG-023 | 旧派发路径调查、早期注入实验与 userScripts 语言／时区注册 |
| VG-024／VG-028／VG-032 | 历史 DNR 权限退出、字体模型迁移与当前语言请求头恢复 |
| VG-025／VG-030 | 固定名单字体过滤、故障恢复与已有文档重载提示 |
| VG-026／VG-031 | 出口推荐与语言列表同步 |
| VG-029 | 独立合成定位注册与权限语义 |
| VG-033／VG-034 | 本页及限定嵌套 Blob Dedicated Worker 的语言／时区同步 |
| VG-035 | HTTP module Worker 包装反例，相关生产范围继续暂停 |
| VG-036 | Chrome 138 上的限定 Blob Worker 补验 |
| VG-037 | 发布候选资料与 ZIP 核验；验收不等同于已发布 |

原始人工验收、研发过程、失败观测和附件继续保留在既有稳定化记录中，不因本次排版整理而覆盖或重新签收。浏览器命令见 [验证指南](browser-validation.md)，候选身份见 [候选资料](../stabilization/release-candidate/README.md)。

## 配置归一化与迁移摘录

维护源分别为 [config-model.ts](../../src/shared/config-model.ts)、[config-resolver.ts](../../src/shared/config-resolver.ts) 和 [storage.ts](../../src/shared/storage.ts)。下面保留整理前的实现说明，后续变更应核对对应维护源。

完整自定义环境方案需要有效手工坐标、时区和语言，可“另存为自定义配置”。纬度范围为 [-90,90]，经度为 [-180,180]，精度必须是大于 0 的有限数值；0 是合法坐标。时区使用 IANA 标识，不接受 `+08:00` 这类固定偏移代替时区。名称支持中文、emoji 和重名，每次另存生成独立 UUID，不覆盖同名方案。Popup 的 UTC 偏移按填写的目标时区和当前日期计算，包含夏令时变化；空或无法解析的时区不显示偏移。

完整配置导入会先检查原始自定义方案；任一方案的字段或 ID 唯一性不合法，整个导入失败，错误指出 `profile.profiles[index]` 和字段。请修正对应条目的坐标、精度、时区、名称或 ID 后重试，该失败导入不会触发配置写入或旧键清理，既有配置不会被替换。旧存储读取只返回有效且 ID 唯一的方案，悬空选中 ID 清空；已规范化 v3 读取不会额外重写配置；v2 首次读取会迁移写回 v3。旧 `bpg_config` 中合法零坐标迁移为手工模式。

v2 字体迁移确定且幂等：旧 canvas 关闭时使用关闭的新默认；启用且名单与旧宽默认集合等价时换成新内置名单；启用且为自定义集合时迁移为 custom，trim、去空、按规范键去重并保留首次显示值。语言、方案和规则覆盖中的 acceptLanguage 被丢弃，v3 导出不含 canvas/acceptLanguage。规则（含禁用规则）、verified 出口档案、WebRTC、位置、时区及 intlMode 保留；导入仍将出口档案降为 unverified 并清空绑定，非法输入写前拒绝。

新安装、重置和旧数据缺字段时均默认 strict，保持升级前强制一致性，避免静默改变隐私预期。schema 已升级至 v3；合法 v2 配置首次读取迁移写回，v3 稳态读取不重写。完整导入/导出保留模式；非法显式模式拒绝导入。回退旧版会忽略模式，保存时可能移除字段；无破坏性迁移。

## 存储字段与恢复记录摘录

| 位置 | 当前数据 | 保留与清理 |
|---|---|---|
| `chrome.storage.local` 的 `siteSpoofConfig` | schema v3 总开关/debug、全局 Intl strict/compatible 模式、规则域名与绑定/覆盖、语言、时区、手工坐标与精度/随机设置、用户保存的坐标历史、自定义环境方案、字体暴露过滤模式与名单；已确认出口档案含名称、公网 IP、坐标、国家、时区、provider 与检测时间 | 跨浏览器重启保留；由用户编辑/删除或重置配置。删除档案前必须解除规则引用；卸载会清除扩展本地存储。没有扩展实现的加密层 |
| local 的 `vanishgeoRulesInitialized` | 规则初始化/迁移标记 | 用于一次配置迁移；旧配置键按 storage 维护源清理 |
| local 的 `legacyDnrCleanupV3Complete` | 旧版历史清理布尔标记，不含配置或请求数据 | 当前版本不写入或依赖此惰性旧键；保留读取兼容，卸载清除 |
| local 的 `headerRulesDynamicOwnerV1` | 已接管DNR命名空间的版本号，不含语言或规则副本 | 首次确认新范围无未知占用后建立；重置保留以便核验和清理所属规则，卸载清除；不能代替实际迁移读回 |
| 浏览器 DNR dynamic 规则及静态隔离状态 | 按配置派生的目标/发起域、排除域和Accept-Language；持久隔离状态保护未完成配置事务 | 跨浏览器会话保留；配置关闭/删除后清理，更新时先隔离再对账，卸载清除；不保存请求日志、Cookie或正文，不是可独立编辑的配置来源 |
| `chrome.storage.session` 的 `pendingExitLocationDetection` | 一份待确认 candidate（IP/坐标/国家/时区/provider/时间）、检测 ID、重检目标与旧验证时间、过期时间 | 五分钟后拒绝确认；成功确认/取消/访问已过期候选时删除，新检测覆盖旧候选。没有定时物理删除器；service worker 暂停不等同于 session 清空 |
| `chrome.storage.session` 的 `runtimeSyncMetadata` | 版本、配置 SHA-256 摘要、语言/时区与字体注册/WebRTC/人工重载提示状态与固定错误类别、待重载 tab ID 和 URL 摘要；预写时保留旧配置摘要的刷新欠账（含可选page/font标签和字体注册窗口补录标记）；已确认检测的待清理 ID | 用于 service worker 暂停后的恢复，关闭/导航清理相应人工重载提示；同 URL 完整重载可能保守保留提示。没有配置副本、原始 URL、IP、坐标或原始 API 错误；不进入配置导出。浏览器重启、扩展重载/更新/禁用时 session 清空，避免旧 tab ID 跨会话重用；摘要不承诺匿名化 |
| 后台诊断内存 | 最小预期信号、run ID、报告/目标文档身份、状态、两分钟 TTL | 消费一次；完成、取消、过期、执行中导航/关闭/配置变更或后台重启失效并释放敏感状态。少量有上限的短期终态只保留原因/所有者 |
| 扩展报告页面内存与 DOM | 当次预期、实际值、PASS/FAIL/UNKNOWN；不保留 ICE 地址，只展示分类数量 | TTL、清除或离开报告页释放；无诊断持久化、导出或跨会话恢复 |
| 外部诊断页内存与 DOM | navigator、Intl/Date、位置回调、ICE 候选和设备/realm 的实际观测 | 页面可见；重新加载/关闭释放其内存快照。网页本身仍能读取这些 API |
| 外部诊断 origin 的 localStorage | 用户点击“记录真实设备基线”保存的实际设备观测，以及界面语言偏好 | 基线清除按钮只删除设备基线；清除该站点数据可删除两者。扩展卸载不清除此站点数据 |
| 用户下载的 JSON | 完整配置或单个自定义方案，取自当前表单 | **完整配置导出未脱敏**，可含出口 IP/位置、档案名称、规则和坐标历史；下载文件不会随重置/卸载删除，需用户自行管理 |

扩展未使用 `chrome.storage.sync` 上传配置。Chrome session storage 会在扩展禁用、重新加载、更新或浏览器重启时清空；本地扩展存储卸载时清除，清浏览器历史不能代替清理扩展配置。参见 [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)。

导入会把出口档案降为 unverified，清空其公网 IP/provider/verifiedAt 与规则出口绑定，但仍可能保留坐标、名称和历史等其他配置字段。重置会清空本地配置、规则、环境方案、出口档案与历史，删除 pending session 候选，使重置前在途检测响应失效，并关闭保护、恢复本扩展 WebRTC 默认策略；清理失败会明确报错。重置不删除下载文件或外部记录。跳过引导只关闭保护和恢复本扩展 WebRTC 默认策略，保留已保存内容。迁移/保存的权威源是 [storage.ts](../../src/shared/storage.ts) 与 [config-model.ts](../../src/shared/config-model.ts)，不存在第二份配置存储或网页配置桥。

## 请求头隔离与迁移实现摘录

VG-024曾移除两项DNR权限，磁盘中可能仍保留更早的动态规则。VG-032经用户明确授权仅恢复 `declarativeNetRequestWithHostAccess`，复用已有host权限，不申请普通DNR、Feedback、webRequest或debugger权限。

包内默认启用最高优先级静态allow隔离规则，覆盖普通HTTP(S)全部当前资源类型（含main_frame）。后台在原配置队列清理dynamic/session中的1001、1002及1100..2099并读回。旧marker不作为成功依据。范围外规则保留；未知Accept-Language改写会保持隔离并报告冲突。固定规则文件损坏不属于可证明的隔离范围，须通过构建和真实Chrome加载验证。

页面注册确认后才安装并核验新dynamic投影，再解除隔离。用户已明确授权持久化以消除session清空造成的稳定冷启动首请求窗口；dynamic使用独立40000..49999，旧session30000..39999迁移撤销，dynamic30000和session40000仍不接管。local仅记录命名空间所有权版本，首次接管前必须确认新范围为空；未知占用保留并隔离。所有会改写配置的迁移、修复和变更均进入同一队列，影响投影或无法确认旧配置时先持久隔离再写；稳定冷启动不无条件重新隔离。静态enabled状态跨浏览器会话保留，扩展更新按manifest默认重置；不能用manifest默认推断每次worker唤醒时已经隔离。

导航请求按目标站点语言，子资源按发起域语言（含跨源资源）。只改Accept-Language，其他头保持原生，不经过转发服务器。两个API没有原子提交：同步窗口和旧文档/BFCache可能不一致，提示完整重载；本页及已同步 Blob Worker 内自身创建的 Blob Dedicated Worker 可继承语言/时区；HTTP(S)、SharedWorker、外来 Blob 及未接管父级未覆盖。新投影安装依赖页面语言注册就绪，稳定冷启动沿用上次确认的投影；若用户在Chrome中关闭Allow User Scripts，后台核验前仍可能发送旧语言头，不能承诺这一开关过渡窗口的首请求一致。核验后撤销受管头、保持隔离并报告失败；DNR失败时同样隔离并报告partial，其他页面能力独立运行。

## 自动验证的数据流摘录

`fixtures/injection/` 是专用测试页面：每个文档的首个 head inline script 同步读取 language/languages/locale/timezone 和固定日期 offset，load 回调另读一次；实际结果放在 fixture 自身的 JSON script 与可见区域内。它不接收预期、配置、run ID 或 runtime marker，不写站点 storage，不向服务器回传结果，不在生产页面安装这些标记。

扩展报告的“VG-009”入口沿用一次性内存 run、精确报告来源与文档/TTL 校验。MAIN 只读既有快照并补采报告时的实际 API；预期仍由后台现有 resolver 解析、留在扩展内部。ISOLATED 有效 origin 仅用于诊断 fallback 来源，不扩大生产注入授权；不明来源为 UNKNOWN。该入口不启动完整诊断的位置、header、worker、ICE/STUN 或外部 provider 请求。

自动验收只在临时 Chrome profile 中使用合成语言/时区和固定 localhost fixture 路径，通过本机 CDP 读取扩展报告。可选 JSON 输出含浏览器版本、实际语言/时区、固定日期偏移、采样毫秒及阶段判定；不含 IP、坐标、真实文件路径、凭据、完整配置或 run/document ID。JSON 是用户选择的本地交付文件，需自行管理；临时 profile/server 退出时清理。

历史全 surface 隔离自动化（非当前生产支持范围）：`node --import tsx scripts/chrome-intl-smoke.mjs --output <脱敏JSON>`，需要 Node22+ 和支持 Extensions CDP domain 的 Chrome。它在临时最小扩展内通过真实 scripting API 验证两模式的当前 top/iframe、classic/module/shared/nested Worker，另加载正式 dist 验证 Options/Popup 文档保存与旧 v2 重复读取。配置仅在扩展内部，经 func/args 交给当前文档；无页面配置桥，无 provider/位置/ICE 调用。临时 profile/server 在 finally 清理；不等同生产恢复、真实 action Popup 或完整人工验收。

诊断在原有实际值采样中额外执行固定 en-US/UTC 的 Intl.DateTimeFormat、NumberFormat 与 Date locale 调用；top/iframe/Worker 分别返回实际默认和显式结果，预期与模式只在扩展内部比较。固定调用不包含用户配置、无新增外部请求，不增加设备表面；旧 fixture 缺显式观测时为 UNKNOWN。定向 Chrome 模式 smoke 只使用本地 fixture、临时 profile 与合成配置，保存的 JSON 只含浏览器版本、模式及布尔/场景结论，不含个人路径、IP、坐标、凭据或文档身份。VG-023 的独立生产 smoke 使用实际 dist、仅 loopback namespace 与正常用户开关，证据单独保存，不联系第三方站点/provider/STUN。

VG-025 隔离字体脚本只含固定内置名单（16项厂商/软件及2026-10-22授权新增的27项简繁中文字体），无公网IP、位置、规则或档案payload、storage或页面配置桥；2026-10-20用户已授权固定内置名单生产注册；custom字体及Worker字体继续暂停；位置恢复见VG-029。真实Chrome资格runner仅访问loopback，合成目标字体别名通过本机字体加载，无字体下载；完整像素/图像和原生设备值只在进程内对照，正式JSON仅保存布尔、版本与固定源码SHA256。Chrome自身后台网络未做全量监控。VG-027未向页面交付位置，未来坐标快照属于额外明确数据披露，不能由字体结果推定安全。

注册撤销只影响未来文档；旧文档/BFCache仍持有旧快照，必须重载或关闭，网页已读取的数据无法撤回。诊断仍需用户明确发起，结果仅扩展内短期比较。VG-029浏览器资格测试使用临时profile、合成坐标与loopback目标，证据只保存布尔/分类/版本及构建摘要，不保存真实位置、个人路径或真实出口IP；具体实际覆盖及未验证项见任务证据。

## 发布候选与本地门禁摘录

当前交付合同以本文、[安装说明](../../INSTALL.md)、[权限说明](../../PERMISSIONS.md)和 [稳定化清单](../../docs/stabilization/task-manifest.yaml) 为准。36 项任务（含 VG-033～VG-037）均已人工验收为 done；VG-037仅批准发布资料对齐和本地候选ZIP核验；完整索引见 [验收证据](../../docs/stabilization/evidence-index.md)。[VG-014 报告](../../docs/stabilization/release-readiness.md)保留历史候选事实，不能作为当前构建的发布批准。

真实 Chrome 证据按各任务记录解释：VG-026 推荐流程、明确应用及关闭恢复，VG-029 定位恢复，VG-030 字体故障恢复，VG-031 语言列表和 VG-032 请求头同步／完整退出重启，见 [证据索引](../../docs/stabilization/evidence-index.md)。VG-014 的旧暂停 runner、旧完整 runtime 隔离实验及 Chrome dry-run 均不能代替当前候选的真实 Chrome 验收。VG-033／VG-034有当前Chrome实测，VG-036补充Chrome138 Blob及嵌套Blob定向验收；VG-035的HTTP包装反例支持继续暂停。任何新候选的改动须评估已有证据是否仍适用。

本地打包与只读核验（下列命令用于未被Chrome写入`_metadata`的干净dist；已在Chrome中加载的目录请保留浏览器缓存，按[VG-037记录](../../.trellis/tasks/10-23-vg-037-release-candidate-alignment/implement.md)使用独立交付快照。归档名须使用本次获准候选名，且目标ZIP必须不存在，避免更新旧归档留下旧条目）：

```bash
mkdir -p release
(cd dist && zip -r ../release/vanishgeo-v2.1.1-candidate-vg037.zip .)
node scripts/audit-release.mjs --zip release/vanishgeo-v2.1.1-candidate-vg037.zip --output <脱敏JSON路径>
```

审查器核对版本、Chrome 138 下限、现行精确权限集合、默认启用的静态隔离规则及其维护源字节、独立字体入口、入口/资源图、共享 chunk 可达性、远程执行/运行期编译/map/敏感模式和 ZIP 文件/字节一致性。它不能识别所有任意秘密或动态计算 URL，需要与维护源审查共同解释。报告摘要采用相对路径 localeCompare 排序的 [path, SHA-256] JSON 再 SHA-256，不能与使用路径加文件字节的 Chrome runner 摘要直接比较。归档供本地人工检查，未发布；审查器目前是手动步骤，未接入 CI / release workflow。

`tests/release-gates.test.ts` 核对 workflow 顺序/权限/失败旁路，在临时 npm 项目注入失败证明后续构建未到达，并用临时 Git 仓库验证首发、跨 tag、无关分支、第二父提交的已发布 tag、同提交轻量/附注 tag 及浅克隆。合成 tags 只创建在临时 fixture 仓库，finally 删除；不操作当前仓库 tags。这些是本地/静态证据，未实际运行 GitHub Actions、Release API 或真实 Chrome。

## 仓库元信息的历史建议

以下为整理前文档中的建议快照。仓库已按用户后续授权更名为 VanishGeo，并更新了简介与 Topics；此处不作为当前远端配置的副本。

Description：`Chromium MV3 扩展：按站点协调网页语言、时区与位置，同步语言请求头，选择性过滤字体暴露并控制 WebRTC 策略，并提供扩展侧诊断。`

Topics：`vanishgeo`、`chromium-extension`、`manifest-v3`、`privacy`、`geolocation`、`timezone`、`webrtc`、`typescript`。

只建议在当前仓库 Settings/About 中由维护者设置，不调用远端管理 API，不沿用原作品地址创建或关联仓库。原作品归属仅保留于 [NOTICE](../../NOTICE)。历史敏感值清理是另一项需人工批准的操作，见 [CONTRIBUTING](../../CONTRIBUTING.md)。
