# VG-037 当前候选发布资料对齐

日期2026-10-23，状态 **done，用户人工验收通过**。本轮获授权对齐发布资料／证据索引／发布说明并重建核验新ZIP，版本2.1.1保持；用户已授权本地提交，不push、tag、发布或部署。HTTP(S) Worker和SharedWorker继续暂停。

## 交付与候选身份

[当前候选资料](../../../docs/stabilization/release-candidate/README.md)与[candidate.json](../../../docs/stabilization/release-candidate/candidate.json)绑定生产基线`1a3962d62dce39e9f23199d27ce1b7920eaf4ddd`及本轮资料、生成器、审查器与测试。主提交为`ec79bfe8c2ffeda8fb51383e477bf071d2beb5d5`；最初验收预览历史截至基线HEAD，共28条，提交后补录预览已增至29条并包含本任务主提交。候选JSON记录真实主提交，后续证据补录不自动替代该候选。

补入VG-033页面Blob、VG-034限定嵌套Blob、VG-035 HTTP包装NO_GO及VG-036 Chrome138定向补验；验收前索引列35项已验收任务；本次签收后补入VG-037，共36项。同步RELEASE、INSTALL、Chrome人工清单与发布说明，明确CSP核验、外来Blob／未接管父级、每文档快照、可观察地址变化及未测范围。旧Chrome138核心证据不冒充当前全包验收。

原2026-10-22候选JSON、产物审查报告和发布预览逐字节保存到`docs/stabilization/release-candidate/history/2026-10-22/`。原历史附件7项缺口及原始人工验收不改写。

## 重新构建与ZIP

- `npm run check`：源码及测试类型、295/295测试、生产构建通过。包含更新的发布说明范围断言，以及审查器误报回归。前轮294项与本轮新增1项的区别如实保留。
- `npm run test:e2e:chrome -- --dry-run`通过，仅入口检查和清单，不是Chrome实测。
- `node scripts/check-release-version.mjs v2.1.1`通过；只是参数校验，未创建／查询远端tag。
- VG-036只读证据核对：66项生产断言、40组资格对照、7项reload检查通过；VG-035历史66项断言通过。未重跑浏览器实验。
- 最终构建Chrome runner指纹`14ba8f5f2c49567a3aa44a9c8ae121b6f3674c070b929160bc06aa1607eee653`与VG-036原始实测一致。
- 新建忽略目录中的`release/vanishgeo-v2.1.1-candidate-vg037.zip`，没有更新旧归档；SHA-256为`557d57ed07b80a0d0003e888db8a8cf746a460abfe8253aaa16a4ddd5b5dca74`。
- [产物审查报告](../../../docs/stabilization/release-candidate/artifact-evidence.json)：50文件、5共享chunk、所有ZIP文件字节与最终交付快照一致；版本、权限、隔离规则、资源图和现有静态检查通过。库存摘要`a9cc02b0f7d74fa9f78880419a59603b6e1a5ff26fed582c5a406dba329b66c4`与Chrome runner摘要算法不同，不直接比较。

### 两次审查失败及处理

1. 原审查器`/sourceMappingURL|sourceURL/`误命中生产Blob实现中的普通`sourceURL`变量。仅改为识别实际调试指令前缀及赋值，保留真正源码指令与`.map`拒绝；6/6定向审查测试通过，随后完整295项检查通过。无生产源码修改。
2. 最终重建后用户Chrome重载在dist写入`_metadata/generated_indexed_rulesets/_ruleset1`，直接审查时比ZIP多一个浏览器缓存文件。没有删除缓存或把不完整ZIP标为通过。复制最终dist的独立快照时仅排除顶层Chrome生成的`_metadata`，同步复制同字节的审查脚本和manifest/package/lock/rules合同在该快照root运行；50项全部与本轮新ZIP一致。

快照核验可按如下操作复现：将dist除顶层`_metadata`以外的全部内容复制到新临时目录的dist/；将本仓库`audit-release.mjs`复制到其scripts/，源manifest、package、lock、隔离规则保持相对位置；执行该快照的审查脚本，ZIP与输出JSON都使用显式绝对参数。审查器本身仍要求ZIP与选定root完整逐项匹配，没有新增忽略或放行分支。临时路径不写入仓库，用户原dist缓存保留。

## 用户追加反馈的现场警告

用户重新加载扩展后在扩展错误页看到黄色“Blob Worker源无法核验／本次语言时区未同步”警告。本轮只读确认上下文为`fuck-claude.vercel.app`，构造堆栈触发该分支，属于某次Worker未同步，不是扩展安装失败。未取得能区分CSP拒绝、URL已撤销或其他错误的异常细节，根因UNCONFIRMED；没有清除现场、重跑全站检测、绕过安全策略或改成静默成功。安装故障与已知安全退出语义区分开，但不能把这次现场具体原因归结为CSP。该情况写入候选限制，未宣称修复。

## 独立复核与最终检查

独立critical_reviewer只读复核产物审查器修正、回归和发布说明限定范围，未发现该增量的可行动阻断。复核者运行scoped diff检查与15种Node/V8指令形式的内存对照，未重新运行Chrome；主代理执行6/6定向与完整295项检查。该结论不等于真实站点警告已解决或候选获得发布批准。

已核对文档链接／验收锚点、YAML依赖／状态、版本、原始证据摘要和历史归档字节、ZIP库存、实际发布预览、变更范围及隐私。静态扫描和人工文本审阅不冒充全部Git历史秘密审计。

生产源码、manifest、依赖版本及workflow没有本轮差异；用户浏览器未被重新加载或改配置，只有只读查看现有警告与页面。本轮没有新浏览器验收，交付快照只用于本地产物核验。所有现有HTTP(S) Worker／SharedWorker暂停与其他未覆盖范围保持，本次人工验收后仅获本地提交授权，不推送或发布。

## 2026-10-23 人工验收与本地提交授权

用户明确确认：“这次发布资料对齐和候选 ZIP 核验验收通过，把 VG-037 标记为 done，补充人工验收记录，并将相关改动提交到本地，先不要推送、打 tag 或发布。版本保持 2.1.1，HTTP(S) Worker 和 SharedWorker 继续暂停，Blob 警告保留为未确认事项。”

据此将task-manifest及task.json同步done，补充候选、索引与发布资料签收。验收限本轮资料、生成器／审查修正及本地ZIP核验，保留35项前置任务原范围、所有未覆盖项、7份历史附件缺口和现场Blob警告UNCONFIRMED，不授予新的Worker恢复或正式发行批准。

本次收尾只更新状态、验收及候选身份记录。生成器、审查器及其测试、生产源码和ZIP未改变，复用已通过的295/295测试、类型检查、构建、dry-run、产物审查及独立复核；再次核对关键文件和ZIP摘要、版本、证据断言、链接与实际提交范围。提交后将真实主提交哈希及其发布预览补入候选记录，后续仅保存证据的提交不自动替代该候选，不将自引用哈希写成已存在。

## 提交后候选身份补录

主提交完成后重新生成并审阅预览，新增1条本轮主提交历史，正文不变。同步当前候选README、candidate.json、证据索引与发布校准中的当前身份，以及关键文件摘要。ZIP与产物报告、源码／权限／版本／workflow、生成器及其测试未变，复用已通过的检查。证据补录另存本地，不推送、打tag或发布；现场Blob警告继续UNCONFIRMED。
