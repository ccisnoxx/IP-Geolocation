# 执行记录

2026-10-15，分支stabilize/VG-014，HEAD5701b55。任务前365个可见文件摘要保存在当前会话内存，保留前序脏树。VG-020已done；本任务通过task.py create建立，P0-F登记为VG-021。无生产代码/权限/版本变更，不启动恢复。

使用trellis-start、trellis-before-dev和structured-response；lean-mode用于限制片段数与实验范围，不构建通用codec/生成器。上下文已在本会话和RFC，无需检索无关历史。不派发子代理，不把自查称为独立复核。Chrome官方scripting/content-scripts文档确认数组顺序和document_start合同，但未承诺组装原子性或跨storage/注册事务；真实证据待补录。

## 实际命令、过程与结果

环境为Chrome155.0.8059.40、macOS arm64、Node24.16.0。完整设计/逐项结果及恢复门槛见docs/stabilization/registration-sequence-research.md，正式JSON为本目录chrome-evidence.json。

- node --check scripts/recovery-research/chrome-registration-sequence.mjs：exit0。
- node scripts/recovery-research/chrome-registration-sequence.mjs --output .trellis/tasks/10-15-vg-021-registration-sequence-probe/chrome-evidence.json：最终exit0，20场景，collection=COMPLETE、sequenceExpression=OBSERVED、productionDecision=NO_GO。

首轮重复文件被API保留但未完成4位（earliest0/4），单文件对照4/4；以位置专属小片段区分重复路径行为与表达机制，新增组装位观测后证实仅01。位置专属global/lexical、切换1001均4/4。随后补充父页预排微任务，并把第三阶段从load内临时观测改成load样本到达后真实CDP读取；最终正式证据来自该候选。前期采集exit0但不提供安全GO，中间JSON不作为独立正式证据保留。

共享状态攻击对照能翻转位，但原生注册路径的setter未抢先执行；lexical能访问/改写push时已完成4位，不能写作提交前成功篡改。微任务可先于位片段，列表不可称原子。禁用storage已保存而注销尚未执行的受控窗口直接保留旧A安装，注销后新文档无commit；存量getter继续存在。同期在途响应头前更新分别B/无commit，非匹配origin无commit；这不证明P2/BFCache。

## 交付判定

有限同步表达GO；安全恢复NO_GO，生产暂停保持。不是研究执行blocked，不把研究完成视为恢复批准。manifest/Trellis本地结束为review，human_acceptance=pending、completedAt=null；用户未验收本任务，不改done。不启动其他机制/恢复阶段。

生产schema/storage/resolver/消息、MAIN/ISOLATED合同、DNR/privacy、权限、host、WAR、版本和构建均未改变。新的storage字段syntheticEnabled只存在临时探针扩展，不是生产键。真实Chrome是独立最小扩展，非生产伪装验收。

## 收尾验证

运行新脚本静态检查及Chrome，复用生产输入未变的VG-014源码/测试类型、170/170、build/dry-run。未重跑npm ci/生产测试/构建/完整集成，也没有容量上限、其他Chrome/OS、完整worker和BFCache证据。git diff --check、task.py validate、状态/JSON/链接/新文件空白、源码及历史证据增量和dist/ZIP摘要在收尾核验。

临时Chrome/profile/extension/server由finally清理；正式JSON无原生实际语言、个人路径、IP/位置、凭据或文档身份。中间诊断JSON已删除，正式脚本和证据保留。无提交/推送/发布，无新生产依赖，无独立代理复核。

最终核验：本轮12文件增量（7新增、5已有文档/治理文件）；5个已有文件剥离本轮增量后摘要与任务前完全一致；365个基线文件中，其他360个文件均未改变。git diff --check、Trellis校验（可选context各0条）、记录/JSON/相对链接/新文件空白、runner与证据SHA-256均通过；47个dist文件及ZIP与VG-014证据逐字节一致，版本2.1.0、暂存区为空。系统ps输出首次按UTF-8严格解码失败，定位为进程列表的非UTF-8字节，改为直接按字节过滤本任务Chrome后通过；这只是收尾核验脚本问题，不是产品或Chrome实验失败。临时vg021目录/Chrome进程为0，server已关闭。状态review、人工pending；未提交或恢复。

## 人工验收

2026-10-15，用户明确确认：“VG-021 隔离验证验收通过，接受有限同步表达 GO、安全恢复 NO_GO 及已知限制。”并要求将manifest状态更新为done、同步Trellis验收记录，保持生产伪装暂停，不启动恢复实施，不改版本、不提交、推送或发布。

据此manifest由review更新为done，Trellis由review更新为completed，completedAt为2026-10-15、human_acceptance为passed。有限表达仍为GO_OBSERVED_4BIT，安全恢复decision/production_feasibility仍为NO_GO，page_tamper_resistance仍为NOT_ESTABLISHED；production_dispatch_restored=false、release_approved=false保持。研究交付完成不构成恢复或发布批准，不启动后续阶段。

前文review/pending及“用户未验收”属于本地研究交付时历史，以本节和manifest为当前状态。正式Chrome JSON、原始负向观测、未验证项和恢复门槛不改；用户本次未提供新浏览器版本、截图或逐项日志，不记作新的Chrome实验。

本次仅同步状态、人工验收和文档索引。生产代码、研究runner、证据JSON、权限、版本、dist和ZIP保持；复用此前输入未变的类型、170/170、build/dry-run及Chrome实验，不重跑测试或浏览器。此次核验git diff --check、Trellis校验、状态/链接一致性和文件增量、runner证据摘要及dist/ZIP；未归档、未提交、推送或发布。
