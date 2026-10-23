# 当前本地候选资料（VG-037，人工验收通过）

> 2026-10-24：最终门禁见 [VG-041](vg041/README.md)，决策 **NO_GO**，报告已获人工验收、任务 done、仅授权本地提交；功能候选仍为已验收 VG-040 精确提交，没有替换 ZIP 或发布。

> 2026-10-24：最新已验收VG-040本地候选及342项检查见 [VG-040](vg040/README.md)。下文仍为VG-037已验收历史候选；其commit和ZIP不代表当前源码。

日期：2026-10-23；状态 **人工验收通过**。版本保持 **2.1.1**。本轮对齐发布说明和证据索引，重建并核验候选 ZIP；已获相关改动本地提交授权；不push、tag、发布或部署。

## 当前身份

| 对象 | 对应关系 |
|---|---|
| 源码基线 | `1a3962d62dce39e9f23199d27ce1b7920eaf4ddd`，包含已验收 VG-033～VG-036；本轮生产源码／权限／版本未改 |
| 已验收主提交 | `ec79bfe8c2ffeda8fb51383e477bf071d2beb5d5`，包含资料、发布说明／dry-run提示、回归测试及产物审查器修正；后续仅证据补录不自动替代该候选 |
| 发布预览 | [notes-preview.md](notes-preview.md)，历史截至已验收主提交，正文使用该提交中的生成器；29条提交已包含VG-037主提交 |
| 构建与ZIP | [artifact-evidence.json](artifact-evidence.json)，50文件、5个共享chunk；完整库存和ZIP SHA-256见报告 |
| 本地交付包 | 仓库忽略目录 `release/vanishgeo-v2.1.1-candidate-vg037.zip`，全新创建，逐文件与最终交付快照一致，未发布 |
| 浏览器身份 | Chrome runner指纹 `14ba8f5f2c49567a3aa44a9c8ae121b6f3674c070b929160bc06aa1607eee653`，与VG-036实测构建完全一致 |
| 资料状态 | VG-033～VG-036分别已验收；本轮VG-037资料／生成器／审查修正已获用户验收，不构成正式RC批准 |

[机器可读对应记录](candidate.json)绑定源码基线、已验收主提交、关键文件、发布预览、产物审查及浏览器原始证据摘要。`candidateCommit`已记录为`ec79bfe8c2ffeda8fb51383e477bf071d2beb5d5`；保存本次证据刷新记录的后续提交不自动替代该候选。

当前ZIP SHA-256：`557d57ed07b80a0d0003e888db8a8cf746a460abfe8253aaa16a4ddd5b5dca74`。库存摘要：`a9cc02b0f7d74fa9f78880419a59603b6e1a5ff26fed582c5a406dba329b66c4`。库存采用按相对路径localeCompare排序的[path,文件SHA-256] JSON再散列，与Chrome runner的路径＋原始字节算法不同，不能直接比较两个摘要。

## VG-033～VG-036如何进入当前合同

| 任务 | 已验收范围 | 证据与限制 |
|---|---|---|
| VG-033 | 页面脚本安装后本realm自身创建的Dedicated Blob Worker，classic/module语言时区首读 | [人工验收](../../../.trellis/tasks/10-23-vg-033-blob-worker/implement.md#人工验收与本地提交)；当时嵌套尚未覆盖，不能改写历史原始记录 |
| VG-034 | 已同步Blob链中，各realm自身新建Blob子Worker递归继承同一最小快照 | [人工验收](../../../.trellis/tasks/10-23-vg-034-nested-blob-worker/implement.md#人工验收与提交授权)；四种父子组合到孙级、依赖首读、根终止及40组资格对照 |
| VG-035 | HTTP module包装可行性实验及暂停决定归档 | [结论与原始资料](../http-module-worker-feasibility.md)；入口CSP与全局相对地址不等价，done不表示恢复资格 |
| VG-036 | Chrome138.0.7204.183／macOS arm64／HTTP回环中的现有Blob范围定向补验 | [人工验收](../../../.trellis/tasks/10-23-vg-036-chrome138-blob-worker/implement.md#2026-10-23-人工验收与本地提交授权)；66项生产断言、40组资格、7项关闭/reload边界 |

HTTP(S) Dedicated Worker和SharedWorker继续暂停；外来／安装前Blob、未接管父级后代及TrustedScriptURL等沿用已有未覆盖边界。Blob CSP须允许入口、依赖和源核验。源无法核验会明确警告并保持原生，脚本被禁止则如实报错；页面快照、Worker location／import.meta.url变化和同步核验成本均保留。关闭后旧文档／旧Worker保留快照，须完整重建。

## 新构建与旧证据的关系

本轮 `npm run check` 通过源码／测试类型检查、**295/295测试**及构建；dry-run通过但只检查入口并输出人工清单。只读重算VG-036生产/CSP/reload证据、VG-035历史断言通过，没有再次运行Chrome实验。

重建完整产物的Chrome runner摘要与VG-036原始记录一致，故可按原范围复用该轮Blob证据。VG-033为最初页面Blob候选，部分入口被VG-034后续扩展；保留其原始哈希，不要求旧中间构建与当前全包相同。

2026-10-22的[Chrome138核心功能证据](../chrome138/README.md)包括正常UI安装、HTTP启用／关闭正常退出恢复及真实TLS加载后语言时区／合成定位。其旧全包摘要与当前Blob构建不同，不能把原verification.json作为当前全包14项验证。当前只是按原覆盖和本轮未变的核心维护源解释这些历史证据；未新增HTTPS Blob、HTTPS最早inline／自动恢复、其他平台或全部故障验收。

## ZIP审查及本轮遇到的问题

- 首轮审查把普通变量名 `sourceURL` 误当源码指令而失败。审查器现只匹配真实 `//#`、`//@`、`/*#`（及同类）源码指令，仍拒绝`.map`。新增回归验证合法标识符、真实指令及map文件；生产源码不变。
- Chrome现场重载会在dist写入 `_metadata/generated_indexed_rulesets`。最终复查因此发现当前dist比新ZIP多一个浏览器缓存文件；没有删除或改写用户Chrome的缓存。将最终构建复制到独立临时交付快照，仅排除顶层Chrome生成的`_metadata`，以同字节审查器及manifest/package/lock/rules合同核验50个交付文件，ZIP全部字节一致。
- 默认静态隔离、精确权限、最低版本、独立字体、入口／资源图、无孤立chunk／远程可执行导入／运行期编译／源码map及敏感模式扫描通过。静态扫描不代表任意秘密或动态URL均安全；审查器仍是手动步骤，没有改CI／release workflow。

实际交付包为本轮首次创建的新ZIP；最终重建后再次对照不可变快照核验通过，不使用zip更新旧归档。本轮独立临时交付快照仅用于稳定审查，个人临时路径不写入证据。

## 现场警告与发布前仍需确认的事项

用户在重新加载扩展后反馈“VanishGeo：Blob Worker 源无法核验，本次语言/时区未同步，保持原生加载”。本轮通过Chrome原生界面只读确认：扩展错误页显示黄色警告，上下文为 `fuck-claude.vercel.app`，堆栈位于Blob Worker构造；不是扩展安装失败。现有记录没有异常细节，无法区分CSP、URL已撤销或其他核验失败，**根因仍未确认，对应那次Worker明确未同步**。未清除记录、重跑站点全部检测、关闭安全策略或吞掉警告。

该观察不改写VG-036受控正负实验；也不能用受控PASS宣称该真实站点的所有Worker均已同步。发布前需根据目标使用场景确认其触发原因及可接受边界，当前仅提供资料和产物核验，不宣称所有现场问题已消失。

另保留7个历史附件缺口、旧Chrome138首轮恢复异常未归因、其他OS／全部补丁版本／升级／崩溃／多窗口／完整BFCache矩阵、字体完整矩阵及WebRTC网络矩阵等缺口。见[发布校准](../release-calibration.md)、[证据索引](../evidence-index.md)。任务done与ZIP审查PASS不自动授予发布批准。

## 历史候选保留

2026-10-22已验收候选为 `9c4af6220c6431721ccc881a45965ddc93a9ad6d`。原[候选JSON](history/2026-10-22/candidate.json)、[产物报告](history/2026-10-22/artifact-evidence.json)及[发布预览](history/2026-10-22/notes-preview.md)逐字节归档，不以当前新文件覆盖旧哈希含义。历史JSON中的仓库相对路径指其当时版本；查原文件用上述提交历史，不要求它们匹配现在的同路径文件。

未来如选择新的正式发行提交，须在对应授权后重新绑定提交、实际预览与远端构建。当前workflow收到合适tag并通过机器门禁后会直接发布，不等待人工浏览器审批；本轮仅获本地提交授权，不推送、不打tag、不发布、不部署。

## 2026-10-23 人工验收

用户已明确确认本次发布资料对齐和候选ZIP核验通过，授权VG-037标记done及相关改动本地提交，先不推送、打tag或发布。详见[签收记录](../../../.trellis/tasks/10-23-vg-037-release-candidate-alignment/implement.md#2026-10-23-人工验收与本地提交授权)。版本2.1.1、HTTP(S) Worker／SharedWorker暂停和现场Blob警告UNCONFIRMED保持。此次资料签收不等于警告已修复或正式发行获批。

## 提交后证据补录

已在获授权的主提交后重新生成发布预览，历史条目由28增至29，新增本轮VG-037提交。正文与已验收生成器一致，ZIP、完整构建和浏览器原始证据均未改变。此次仅补录真实候选哈希、发布预览及文档／摘要，不重新构建或运行浏览器，也不推送、打tag或发布。
