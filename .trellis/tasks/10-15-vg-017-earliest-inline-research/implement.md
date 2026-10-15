# VG-017 执行记录

基线：stabilize/VG-014，HEAD5701b55，任务前337个可见文件已快照；保留前序脏工作树。依赖VG-014已人工验收done。研究不改变生产暂停、权限或版本，不启动VG-016/018/019。通过task.py create建立任务，后续命令与证据追加。

## 实际研究与命令

环境：Chrome155.0.8059.40，macOS arm64，Node24.16.0；临时profile、最小扩展、loopback。完整设计、来源、恢复门槛与未验证范围见 docs/stabilization/earliest-inline-research.md。

- node --check scripts/recovery-research/chrome-earliest-feasibility.mjs：exit0。
- node scripts/recovery-research/chrome-earliest-feasibility.mjs --output .trellis/tasks/10-15-vg-017-earliest-inline-research/chrome-evidence.json：exit0采集完成，fullTimingGuarantee=NOT_ESTABLISHED。原生0/4→0/4；异步暖后台、真实冷唤醒、受控延迟各earliest0/4→postLoad4/4；固定MAIN文件4/4→4/4。四文档各自首脚本读取，异步错误0；未把机制对照当生产动态配置方案。

## 可行性与边界

NO_GO：现行后台动态payload与异步通知合同不提供完整首脚本保证，直接MAIN固定值对照没有解决配置同步。 这是研究完成的结果，不是实施环境blocked；本地研究交付后manifest/Trellis为review，human_acceptance=pending，未恢复生产。

正式原生/安全闸门runner复用时JSON中的task=VG-011保留，新路径与命令标识属于本轮研究，不修改原任务JSON。VG-017的五模式为独立toy扩展，不加载生产runtime；源码采集为官方公开URL，不发送用户配置。原生lang仅在内存，正式证据只有布尔/分类，无真实IP、位置、文档ID或个人路径。

未测试其他Chrome/OS、修复binary、完整原生执行队列、诊断副作用错投、自然频率、全部CSP/iframe/Worker矩阵；没有首脚本完整runtime验收或人工验收。不把这些写成PASS。没有提交上游issue、修改远端或安装浏览器。

## 验证与收尾

生产源码/测试/依赖/构建输入未变，复用VG-014的源码类型、测试类型、170/170、build和dry-run证据；新维护脚本由实际运行及node --check验证。git diff --check、Trellis上下文/记录一致性、任务文件增量和dist/ZIP摘要在交付前核验。临时profile/server由finally清理，下载副本与任务前快照收尾清理；正式JSON和研究脚本/报告为交付物。未改版本、权限、生产代码，没有提交、推送、发布或启动恢复实施。

收尾核验：git diff --check与task.py validate均exit0（implement/check各3条）；本轮实际增量26文件，仅5个已有治理/索引文件和21个新增交付，生产输入、历史任务、dist/ZIP摘要核验保持。manifest与本任务由in_progress更新为review，completedAt=null、human_acceptance=pending；NO_GO不等于研究未完成。没有新独立代理复核，本轮结论来自主代理实验及维护源/官方资料审查。

最终清理已完成：本轮下载的8份官方源码副本、337文件任务前快照和系统临时工作目录已删除；匹配研究profile/Chrome进程及目录均为0。仅保留26文件的正式研究交付，暂存区为空。

## 人工验收

2026-10-15，用户明确确认：“VG-015、VG-017 研究验收通过，接受当前 NO_GO 结论及已知限制。”并要求将两项manifest状态更新为done、同步Trellis验收记录，保持生产伪装暂停，不启动恢复实施，不改版本、不提交、推送或发布。

据此，VG-017的manifest由review更新为done，Trellis由review更新为completed，completedAt为2026-10-15、human_acceptance为passed。该确认验收的是研究交付及NO_GO结论；可行性仍为NO_GO，不表示documentId错投或earliest-inline竞态已修复，不授予恢复或发布权限。此前review/pending为本地交付阶段历史，以本节和manifest为当前状态。

用户未提供本次浏览器版本、截图或逐项日志；人工确认与此前Chrome155自动化证据分别记录。正式证据JSON、原有FAIL/UNKNOWN、恢复门槛和未验证范围保持，不改写为通过。

本次仅更新状态、验收记录及文档摘要；生产代码、研究脚本、测试、依赖、权限、版本、dist和ZIP保持。复用此前输入未变的源码/测试类型、170/170、build、dry-run及研究实验，不重复执行。此次核验git diff --check、Trellis上下文、记录一致性与文件增量。未归档，不启动VG-016/018/019或其他恢复实施，未提交、推送或发布。
