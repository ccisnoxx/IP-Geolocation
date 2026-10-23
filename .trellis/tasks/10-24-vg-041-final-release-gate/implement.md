# VG-041 执行与证据

日期：2026-10-24。用户授权最终候选检查、干净环境门禁和必要 Chrome 最小冒烟；禁止自行 push、merge、tag、Release 或部署。门禁执行阶段没有生产修改或提交；随后用户验收NO_GO报告并授权本地提交，见文末。

## 基线和执行环境

- 开始分支 `main`，工作树干净，HEAD `4906aeee5f5154dc759d30bdbaa30b7162b963a0`，tree `9be897416594649710659a96205bbc64b1a6fec0`；origin 为 `ccisnoxx/VanishGeo`。未 fetch 或验证远端实时状态。
- manifest 的 VG-040 为 done，依赖满足；VG-039 仍 review，未把它作为已完成依赖。原清单无 VG-041，已按本轮明确授权建立独立任务。
- 实际 `.trellis/workflow.md`、`.trellis/scripts/task.py` 不存在；按现有稳定化 task.json／prd／implement 模式记录，未重建或改造 Trellis 工具。
- 本地 `release/vg040-final-commit-rc.json` 有效。独立重算171输入逐文件摘要并检查目录覆盖完整，与精确提交一致；版本、树、旧 ZIP 和旧审查报告摘要相符。
- `git archive` 精确提交导出到本轮独立临时目录；无 node_modules／dist，Node24.16.0、npm11.13.0。没有使用工作区 node_modules 或被 Chrome 写过缓存的 dist。

## 实际命令

在候选临时副本顺序运行 `npm ci`、`npm run check`、`node scripts/check-release-version.mjs v2.1.1`、`node scripts/audit-release.mjs --zip <既有VG040 ZIP> --output <本轮报告>`、`npm run test:e2e:chrome -- --dry-run`；均退出0。check 包含两项类型检查、342/342单测及build。正式tag没有创建。

新构建50个文件与原 ZIP 全部字节相同，dist 库存 `d71bb9b826de9050a767b1e140eb3ba2e462219d147d69703b55ee1de6b4de44`，ZIP `7c43c302ad427fb835d06ec25b5edc4974908b603be31364b776281cd4aa819d`。审查在浏览器加载之前执行；浏览器关闭后再逐文件检查这50个文件仍相同，未将浏览器生成缓存打入候选，也未放宽审查断言。

另在真实 `v2.1.0` 源码临时副本执行 `npm ci` 和 `npm run build`，均退出0，供实际旧版升级样例使用。不是将候选改版本号冒充旧实现。原生 UI 同目录重载后仍为同一扩展 ID，版本2.1.1，未改候选 manifest。

`bash scripts/release-changelog.sh` 从当前精确 HEAD 生成63行本地预览，上一标签v2.1.0，包含4906aee；旧历史与暂停／可靠关闭限制仍保留。未触发CI或远端发布。完整记录见[发布决策](../../../docs/stabilization/release-candidate/vg041/README.md)、[机器证据](evidence.json)、[Chrome观测](chrome-observations.json)。原始日志和辅助工具保留在忽略目录 `release/vg041/`；个人临时路径不写入仓库。

## Chrome 实际覆盖及限制

使用本机已有 Chrome for Testing138.0.7204.183、macOS arm64、独立临时 profile，Chrome 自身 sandbox 保持；未传允许扩展安装或脚本绕行参数。正常 UI 开发者安装、Allow User Scripts、Options 首次配置和关闭；采集侧通过CDP只读配置／注册和页面结果，将两次主动provider请求在发出前改为合成响应。没有真实provider检测请求，不代表Chrome自身全部后台流量均受监控。

通过的本轮范围：安装安全默认、关闭脚本时明确UNAVAILABLE、新出口自动选中且未自动确认／启用、HTTP顶层与普通同源iframe的43字体过滤／6项名单外正对照、语言时区首inline及Accept-Language、总开关关闭注册清空及完整reload原生恢复。FontFace等宽字体别名是正对照，不外推所有字体排版或Canvas像素。

旧版UI正常检测确认并保存合成出口和规则绑定后升级。已有schema2按候选既有合同迁移到schema3，整个持久化结果与当前normalizeConfig相等，核心字段、verified身份及绑定、0/0坐标、严格WebRTC保留，旧content scripts撤销；正常开启用户脚本并重试恢复两个注册。旧dynamic/session为空；非空旧DNR范围、商店CRX、v1、自定义方案全部组合、故障和降级未运行。

复用：VG-040父子兄弟域Popup关闭的已验收现场证据，源／产物字节一致，保留原浏览器和同源iframe范围；原独立代码复核只复用报告中限定结论。VG-036的历史Blob证据未改写为当前全包重新通过。Chrome155遗留、配置收尾独立哈希及Blob警告根因仍UNKNOWN／UNCONFIRMED。

## 采集问题与清理

最初采集器未申请交互stdin，输入已关闭；终止仅本轮采集器、fixture和测试浏览器后用PTY重启。随后启动读到旧DevToolsActivePort，连接被拒绝；清除本轮profile的旧端口文件并确认新进程后重启成功。这两次是环境准备错误，不计产品FAIL，也不计完成场景。

首次只读采样在脚本开关关闭时直接访问 `chrome.userScripts.getScripts`，API为undefined而报错；改用独立只读观察器显式记录UNAVAILABLE，未绕行权限或改产品。重新采集fresh并保留真实partial界面。启停之间只重读旧DOM的缓存样本没有作为实时API复测证据收入正式观测。

本轮临时浏览器及fixture已关闭，确认无本任务浏览器／服务进程残留后删除仅本轮的profile和源码／构建副本。采集器在完成关闭后遗留stdin句柄，已终止本轮node进程。原始日志、摘要及最终ZIP保留；没有改变用户现有Chrome、其他扩展、个人配置或旧历史证据。

## 决策与状态

**NO_GO**：Chrome155遗留验收未闭合，Blob现场警告根因及发行风险处置未完成。干净构建和最小Chrome138冒烟通过不能补写它们为PASS。风险、未运行矩阵和回滚限制见发布决策；尤其schema3降级schema2及完整配置恢复不保证无损，普通导入会降低出口可信状态并清绑定。

门禁执行完成时仅置review、人工验收pending；当时无commit、push、merge、tag、Release或部署。后续人工验收及本地提交授权见文末。最终diff检查与独立只读复核结果在机器证据中补记。

最终 `git diff --check` 通过，新任务／报告文件另作 no-index 空白检查，无诊断；JSON及本地证据链接校验通过。独立只读 `review_vg041` 已逐项核对171输入、ZIP50文件、7份日志摘要及原始Chrome快照，未发现阻断性问题。其完整范围和限制见[独立复核](review.md)；未重跑浏览器或测试。按建议显式补充旧版样例自定义方案集合为空的限制，未改变候选或判定。

## 人工验收与本地提交授权

2026-10-24 用户明确：“VG-041 的 NO_GO 报告我验收通过，请同步标记 done 并完成本地提交。保留 VG-039 未完成项和 Blob 警告未确认状态，不推送、不打 tag、不创建 Release 或部署。”

据此主清单置done，Trellis任务置completed，机器证据与发布资料同步为NO_GO报告已验收。验收对象是本任务的报告和执行结果，NO_GO决策不变，不代表产品已经满足正式发行条件。VG-039保持review，其未完成项和Blob警告UNCONFIRMED不变。仅本地提交本任务资料；不归档其他任务，不推送、合并、打tag、发布或部署。

功能候选仍绑定4906aeee5f5154dc759d30bdbaa30b7162b963a0；此次治理资料提交不自动替换候选。源码、权限、schema、测试、构建输入及ZIP均未改，复用本轮已有342项、类型、构建和Chrome证据；不重复运行测试或浏览器。提交前核对精确文件清单、JSON状态、保留边界及git diff --check。
