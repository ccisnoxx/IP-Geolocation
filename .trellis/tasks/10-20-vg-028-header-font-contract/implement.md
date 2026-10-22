# VG-028 实施与验证记录

> 当前状态：用户于 2026-10-20 明确确认人工验收通过，manifest 为 done，Trellis 为 completed；以下 review 为本地交付时状态，原始验证和限制保留。

## 交付状态与授权

2026-10-20，本地实现与验证完成，结束状态 **review**；人工验收 pending，不得改为 done。用户本轮明确确认新编号并保留已验收的语言／时区 userScripts。本任务承接两份原输入文档的 schema/请求头/字体目标，原 VG-023 done 及 VG-022 in_progress 完整保留；不实施 VG-024～VG-027。

实施分支 codex/vg-028-header-font-contract，起点 de85aea。开始前仅有用户删除 docs/vanishgeo-codex-task-prompts.md 和新增两份任务输入文档，未 reset、stash、覆盖、删除或混入修改。基线 npm test 185/185 通过；无 VG-022 未提交代码，本次在独立分支实现，无另建 worktree。未 commit/push/merge/tag/发布。

## 实现与数据合同

- 配置唯一权威仍为 config-model/resolver/storage。SiteSpoofConfig 升至 v3；全局语言、预设、Profile、规则覆盖及完整 payload 去 acceptLanguage；导出不含 acceptLanguage/canvas。
- FontExposureConfig = enabled/mode/blockedFamilies，默认关闭；vendor-software 使用唯一16项厂商／软件内置名单，普通中文系统字体不入默认名单。custom trim、去空、按与字体runtime一致的键去重，保留首次显示值。
- v2 canvas 关闭→新默认关闭；启用旧宽默认集合→启用vendor新名单；启用自定义→custom原值规范化。显式v3缺少fontExposure时只取新默认，不再消费canvas。有效v3读取不重写；v2迁移失败保留原配置与旧键，成功后才清理旧键。
- 禁用规则、顺序、覆盖、方案、verified档案与绑定、WebRTC、时区、地理位置/历史、intlMode保留。保存保留后台已有出口档案；导入仍降级verified并清空绑定。非法schema、配置对象、字体模式/名单或Profile在进入存储事务前拒绝，不能由失败输入触发旧键迁移。
- 移除dnr正式生成模块及容量预检；legacy-dnr-cleanup只读取、删除1100..2099并回读核验，范围外保留，不构造/添加规则。成功后写legacyDnrCleanupV3Complete；标记不替代每次实际复核。
- 同步组件legacyDnrCleanup只代表历史规则不存在。services原有串行队列不变，API/回读/marker失败进入可见failed，保存后的副作用失败不回滚desired state；再次对账可恢复。DNR权限暂留清理，VG-024才删除；没有新增权限、host scope、依赖或版本变更。manifest只同步描述。
- 字体维护源改名font-exposure，仅接管目标measureText与FontFaceSet.check，删除无行为价值getContext包装。native Proxy、descriptor/receiver/异常合同有定向检查；关闭/空名单零hook，普通字体透传，绘制、像素、图片导出、WebGL/GPU/UA/UA-CH/硬件等不接管。
- 生产graph仍仅语言／时区，MAIN/document_start、HTTP(S)顶层/普通iframe、最长域名优先、逐文档快照、fail closed、串行撤销/更新/新增及worker/update恢复保持。位置、字体和Worker生产继续暂停；无ISOLATED配置broker、页面桥、documentId派发回退、热更新或自动reload。
- Options/Popup有内置只读与custom编辑模式，明确已配置但当前未应用及兼容性影响。原生header只观测，不再与网页语言比较PASS/FAIL；字体报告分别给出目标/非目标及未覆盖路径的UNKNOWN。文档、权限、隐私、长期规范和稳定化矩阵已同步，历史研究/JSON结论未覆写。

## 实际验证

本机 Node v24.16.0。以下是实际执行结果，不代表Node20/CI或完整人工浏览器验收。

| 命令/范围 | 结果 |
|---|---|
| git diff --check | 通过；收尾再次检查，移除了本任务新增的EOF空行 |
| npm run typecheck | 通过 |
| npm run typecheck:tests | 通过 |
| npm test | 最终207/207通过；基线185/185 |
| npm run build | 通过；manifest描述收尾后再次构建成功 |
| npm run test:e2e:chrome -- --dry-run | 通过，仅入口/清单检查，不是浏览器验收 |
| config.test.ts | 修复v3混合输入后20/20通过 |
| extension-wiring.test.ts | 最后manifest/权限文档状态下20/20通过 |
| node --check scripts/chrome-legacy-dnr-upgrade.mjs | 通过 |
| node --check scripts/chrome-language-timezone-smoke.mjs | 通过 |
| node --check experiments/userscripts-document-start/production-smoke.mjs | 通过；只同步现行schema/原生header预期，未运行完整Linux smoke |

实现期间定向网络/诊断/状态检查首轮77项有4项失败，均为本任务的VM新依赖/断言及观测fixture同步遗漏，修复后相关88/88通过；随后新增非法字体写前拒绝、合法v2导入及marker重复对账测试纳入最终207项。不存在未分类的本地测试失败。

## 真实 Chrome 升级定向证据

正式文件：[chrome-upgrade-evidence.json](./chrome-upgrade-evidence.json)。实际Chrome/155.0.8059.80，结果PASS，7项布尔检查全部true，资源清理PASS。命令（临时路径脱敏）：

```sh
node scripts/chrome-legacy-dnr-upgrade.mjs --upgrade-from <de85aea临时构建的dist> --output .trellis/tasks/10-20-vg-028-header-font-contract/chrome-upgrade-evidence.json
```

旧构建来自git archive de85aea的临时源码副本，使用现有node_modules构建；未改仓库历史或安装依赖。浏览器临时profile加载旧构建，旧1100规则先实际改变localhost header，并有2100范围外对照；同一profile/同一路径加载候选（版本不变）后确认1100..2099清空、2100保留、v3自定义名单正确、两次修改语言仍原生header。停止worker前重新加入2099并保留marker，真实stop/start后再次清除，验证不是marker缓存。

探针早期有自动化失败：最初等待worker target身份变化超时；随后discovery→attach期间旧target消失/旧上下文未就绪。已在更新前释放旧调试会话、启用Runtime并仅针对实测-32602 No target with given id found进行有界只读重试，变更后通过。没有为harness改变生产源或放宽验证。最终正式JSON仅含布尔/计数级摘要、版本与固定范围，不含原始header、IP、documentId、配置或个人路径。

此探针没有正常开启Allow User Scripts，不重验语言／时区earliest-inline，不进行字体生产恢复、真实action Popup人工交互、全浏览器/系统重启或跨浏览器矩阵。Chrome启动未传禁用sandbox参数，但未另测sandbox内部状态；fixture只请求loopback，未监控Chrome自身全部后台网络。旧完整Linux语言/时区runner本轮未运行，不能以本轮header PASS替代其历史17项或人工验收。

## 独立只读复核

第一次审查确认v3混合输入仍消费canvas的P2合同问题，主代理在唯一normalizer修复并增加最小回归。第二次fresh critical_reviewer核对修复、v2迁移、v3幂等、verified/非法输入边界、DNR范围/回读/marker及生产graph，未确认剩余阻断。曾提出的旧session升级欠账疑虑在核对storage.session于extension reload/update清空后撤回；未加入无正常生产前提的兼容层。

审计Bundle：20261020T072902Z-vg-028-header-font-contract-ee076d02，SUBAGENT_EXECUTION_DIGEST已生成，audit-finalize/audit-verify通过。

## 隐私、限制与人工验收

没有新增外部请求、敏感payload或页面配置通道；现有主动provider/诊断/STUN数据流不变。升级探针的header只在内存比较，echo只回显Accept-Language，正式证据无完整请求头。DNR迁移marker只含布尔值，不成为配置事实来源。

字体measureText在目标文本参数转换期间暂时设置fallback，此既有维护源行为可被转换回调观察，其对font的重入写入会被恢复逻辑撤销；本任务未将其宣称为已解决或完整原生等价。生产字体仍暂停，VG-025恢复前须单独验证该边界以及真实字体、DOM local()/像素/Worker等未覆盖路径。未目标和未接管表面的Node/VM/构建证据不扩大为真实Chrome字体验收。

人工仍需确认Options/Popup产品文案与模式、个人升级配置和WebRTC实际控制状态；任务只到review。未创建发布ZIP，忽略目录dist保留为可加载的本地候选；临时源码构建、Chrome profile/server及一次性日志在交付前清理。

## 回滚与后续范围

1. 回滚前导出并安全保存v3配置，注意导出含用户敏感字段。旧构建不理解新字段，不能承诺无损降级。
2. 仅撤销下列VG-028路径的实际diff，保留用户原文档删除/新增及其他任务工作；不得reset/stash/覆盖历史。
3. 加载旧构建可能重新生成Accept-Language规则，应独立核验并告知行为变化；重建旧hook/BFCache文档。保持语言／时区已验收边界，不恢复完整runtime。

后续仅列出：VG-024删除DNR权限；VG-025字体生产恢复与真实Chrome安全验收；VG-026推荐引擎。均未实施。

建议commit message（未执行）：`refactor: stop header mutation and define selective font exposure filtering`

## 修改文件清单

本任务源文件、文档及测试如下；另外新增本任务task.json/prd/design/implement及脱敏Chrome证据。用户原有的文档删除与两份新增任务输入不属于本任务改动。

- `.gitignore`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `AGENTS.md`
- `CONFIG_GUIDE.md`
- `INSTALL.md`
- `PERMISSIONS.md`
- `PRIVACY.md`
- `README.md`
- `RELEASE.md`
- `docs/stabilization/README.md`
- `docs/stabilization/acceptance-matrix.md`
- `docs/stabilization/task-manifest.yaml`
- `experiments/userscripts-document-start/production-smoke.mjs`
- `manifest.json`
- `scripts/chrome-acceptance.mjs`
- `scripts/chrome-language-timezone-smoke.mjs`
- `scripts/chrome-legacy-dnr-upgrade.mjs`
- `src/background/dnr.ts`
- `src/background/legacy-dnr-cleanup.ts`
- `src/background/services.ts`
- `src/diagnostic/report.html`
- `src/injected/runtime-modules/entry.ts`
- `src/injected/runtime-modules/registry.ts`
- `src/injected/runtime-modules/surfaces/canvas-fonts.ts`
- `src/injected/runtime-modules/surfaces/font-exposure.ts`
- `src/injected/runtime-modules/types.ts`
- `src/leak-test/leak-test.html`
- `src/leak-test/leak-test.ts`
- `src/options/options.css`
- `src/options/options.html`
- `src/options/options.ts`
- `src/popup/popup.css`
- `src/popup/popup.html`
- `src/popup/popup.ts`
- `src/shared/config-model.ts`
- `src/shared/config-resolver.ts`
- `src/shared/defaults.ts`
- `src/shared/diagnostic-report.ts`
- `src/shared/profile.ts`
- `src/shared/runtime-sync.ts`
- `src/shared/storage.ts`
- `src/shared/types.ts`
- `src/shared/ui-state.ts`
- `tests/anti-detection-runtime.test.ts`
- `tests/background-services.test.ts`
- `tests/config.test.ts`
- `tests/diagnostic-report.test.ts`
- `tests/dnr.test.ts`
- `tests/extension-wiring.test.ts`
- `tests/intl-mode.test.ts`
- `tests/legacy-dnr-cleanup.test.ts`
- `tests/navigator-contract.test.ts`
- `tests/onboarding-ui.test.ts`
- `tests/page-scripts.test.ts`
- `tests/profile-ui.test.ts`
- `tests/profile.test.ts`
- `tests/rule-list-ui.test.ts`
- `tests/rule-list.test.ts`
- `tests/runtime-build.test.ts`
- `tests/runtime-modules.test.ts`
- `tests/runtime-sync-ui.test.ts`
- `tests/ui-state.test.ts`


## 2026-10-20 人工验收

用户明确确认：“VG-028 人工验收通过，更新状态，然后按计划开始 VG-024；不提交、不发布。”manifest 更新为 done，Trellis 为 completed；该确认保留本任务原有证据层级与已知限制，不扩大为字体生产恢复或完整 earliest-inline 重验。下一任务 VG-024 已获实施授权；无提交、推送或发布授权。
