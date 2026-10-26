# VG-042 本地修复记录

2026-10-26，基于当前 HEAD `8a575ed30dfaded6d8337e31ffd15a37735a065c`；未回退至审查参考提交。开始时工作区干净。依赖 VG-041 为 done；用户已于 2026-10-26 人工验收通过，本任务为 done，不改变历史发布候选的身份或批准范围。

## 复现与实现

修复前执行 `npx tsx --test tests/config.test.ts tests/profile-ui.test.ts`，40 项中 4 项新增回归失败：外部空／损坏输入被接受、损坏持久配置未拒绝，以及 Popup／Options 的原始 Chrome 枚举选项。修复后这些用例通过。

UI 与保存配置仅使用 default／compatible／strict，移除公网和私网选项，开关和选项同步；实际 Chrome 策略映射仍由 background/webrtc.ts 唯一负责。内部 normalizeWebRtc 不再接受旧 policy 或未知枚举；旧别名仅在历史迁移转换。

外部 v2／v3 输入先检查结构、类型、枚举及语义，失败结果不包含可用 config；内部 normalizeConfig 不作为验证器。按真实历史类型保留 v1 无出口字段、v2 无 intlMode、旧位置未知时区与零坐标及 VanishMe/旧键。损坏方案在归一化过滤之前拒绝，迁移结果也验证后才写入。

损坏存储通过 StoredConfigError 进入管理错误通道；同一队列撤销所属页面／定位／字体／语言头并释放 WebRTC，无法确认清理则报告失败，原配置及旧键不覆盖。明确有效导入或重置可恢复；恢复保留旧重载债并为普通 HTTP(S) 页面提示重建，不自动刷新。

## 验证

- `npm ci`：通过，无锁文件变更或新增生产依赖。
- `npm run check`：最终通过，源码与测试类型检查、361 项测试、生产构建全部完成。
- `npx tsx --test tests/config.test.ts tests/profile-ui.test.ts tests/background-services.test.ts tests/webrtc.test.ts tests/profile.test.ts tests/rule-list.test.ts tests/intl-mode.test.ts`：192/192 通过。
- `npm run test:e2e:chrome -- --dry-run`：通过，只是入口清单检查。
- `node scripts/chrome-onboarding-smoke.mjs --config-only --output <临时脱敏JSON>`：真实 Chrome 155.0.8059.86，通过。使用现有 headless/CDP runner、独立临时 profile 和扩展副本，通过原生扩展详情开关开启 Allow User Scripts。Popup 和 Options 各三种模式保存、实际策略读回、重新打开回显共六项；另验证总保护关闭、非法导入保留、配置 JSON round-trip、损坏存储错误显示/保留及导入/重置恢复。定位服务请求为零；结束清理本次临时 Chrome 与副本。构建摘要和范围见 chrome-evidence.json。
- 首轮 Chrome 因临时 profile 未开启 Allow User Scripts 而等待同步超时，不计通过；新增原生开关步骤后上述场景通过。最终 runner 包含重新打开后的同步确认。
- 独立只读复核：发现并修正真实历史 v1/v2 兼容、旧键语义、损坏方案过滤、旧位置 null 时区和恢复重载债；最终未发现未解除阻断，独立定向六项通过。
- `git diff --check`：通过；逐文件检查 diff。版本、manifest、权限、许可证、来源归属、锁文件保持；dist/node_modules 为忽略目录，无临时文件加入维护源。

## 未运行与限制

没有运行 action 气泡人工验收、Chrome 138／其他版本、ICE/网络泄漏、完整升级或冷启动矩阵。策略读回成功不等于无网络泄漏；旧文档/BFCache 必须由用户完整重建。旧版已经错误保存为 strict 的选择无法推断原意，本次不猜测改写。未推送、打 tag 或发布。


## 人工验收与本地提交授权

2026-10-26 用户明确确认：“本次修复验收通过，请将 VG-042 标记为 done，并把相关代码、测试和文档做一次本地提交。不要推送、打 tag 或发布，也不要再重复测试。”

已同步 task-manifest 的 done 与本任务 completed／acceptance passed 状态。本次仅整理验收记录并本地提交代码、测试、文档和既有脱敏证据；复用上述 361 项完整门禁、192 项定向测试与 Chrome 实测结果，不重新运行测试。既有浏览器覆盖限制保持。未执行归档、推送、打 tag 或发布。
