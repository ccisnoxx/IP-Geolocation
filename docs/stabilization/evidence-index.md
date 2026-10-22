# 稳定化验收证据索引

跨任务状态以 [task-manifest.yaml](task-manifest.yaml) 为准；全部 31 项为 done，均有用户人工验收。历史研究处置的 done 不表示实验成功。

本次恢复缺失任务目录中的 Git 已跟踪文件，不覆盖现存记录；字节摘要和来源见 [restored-evidence.json](restored-evidence.json)。恢复内容保持历史原文，历史候选、权限及暂停结论不能代替现行合同。

| 任务 | 人工验收记录 | 本次恢复来源 |
|---|---|---|
| VG-000 | [记录](../../.trellis/tasks/10-14-vg-000-stabilization-baseline/implement.md#人工验收) | 5e8fae1 |
| VG-001 | [记录](../../.trellis/tasks/10-14-vg-001-rule-list/implement.md#人工验收) | 5e8fae1 |
| VG-002 | [记录](../../.trellis/tasks/10-14-vg-002-diagnostic-observation/implement.md#人工验收) | 5e8fae1 |
| VG-003 | [记录](../../.trellis/tasks/10-14-vg-003-diagnostic-report/implement.md#人工验收) | 5e8fae1 |
| VG-004 | [记录](../../.trellis/tasks/10-14-vg-004-documentation-privacy/implement.md#人工验收) | 5e8fae1 |
| VG-005 | [记录](../../.trellis/tasks/10-14-vg-005-ci-release-gates/implement.md#人工验收) | 5e8fae1 |
| VG-006 | [记录](../../.trellis/tasks/10-14-vg-006-runtime-reconciliation/implement.md#人工验收) | 5e8fae1 |
| VG-007 | [记录](../../.trellis/tasks/10-14-vg-007-worker-identity/implement.md#人工验收) | 5e8fae1 |
| VG-008 | [记录](../../.trellis/tasks/10-15-vg-008-config-profile-ui/implement.md#人工验收) | 5e8fae1 |
| VG-009 | [记录](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md#人工验收) | 5e8fae1 |
| VG-010 | [记录](../../.trellis/tasks/10-15-vg-010-safe-onboarding/implement.md#人工验收) | 5e8fae1 |
| VG-011 | [记录](../../.trellis/tasks/10-15-vg-011-runtime-modularization/implement.md#人工验收) | 5e8fae1 |
| VG-012 | [记录](../../.trellis/tasks/10-15-vg-012-runtime-modules/implement.md#人工验收) | 5e8fae1 |
| VG-013 | [记录](../../.trellis/tasks/10-15-vg-013-intl-compatible/implement.md#人工验收) | 5e8fae1 |
| VG-014 | [记录](../../.trellis/tasks/10-15-vg-014-release-acceptance/implement.md#人工验收) | 5e8fae1 |
| VG-015 | [记录](../../.trellis/tasks/10-15-vg-015-document-binding-research/implement.md#人工验收) | 5e8fae1 |
| VG-017 | [记录](../../.trellis/tasks/10-15-vg-017-earliest-inline-research/implement.md#人工验收) | 5e8fae1 |
| VG-020 | [记录](../../.trellis/tasks/10-15-vg-020-alternative-injection-rfc/implement.md#人工验收) | 5e8fae1 |
| VG-021 | [记录](../../.trellis/tasks/10-15-vg-021-registration-sequence-probe/implement.md#人工验收) | 5e8fae1 |
| US-EXP | [记录](../../.trellis/tasks/10-16-userscripts-loopback-fixture/implement.md#2026-10-16-人工验收确认) | 5e8fae1 |
| VG-023 | [记录](../../.trellis/tasks/10-16-vg-023-userscripts-language-timezone/implement.md#2026-10-16-人工验收确认) | 5e8fae1 |
| VG-022 | [记录](../../.trellis/tasks/10-15-vg-022-private-handoff-probe/implement.md#2026-10-22-人工验收确认) | 原已存在 |
| VG-028 | [记录](../../.trellis/tasks/10-20-vg-028-header-font-contract/implement.md#2026-10-20-人工验收) | 5e8fae1 |
| VG-024 | [记录](../../.trellis/tasks/10-20-vg-024-remove-dnr-permissions/implement.md#2026-10-20-人工验收) | 5e8fae1 |
| VG-025 | [记录](../../.trellis/tasks/10-20-vg-025-font-filter/implement.md#2026-10-22-人工验收与收尾) | 5e8fae1 |
| VG-026 | [记录](../../.trellis/tasks/10-20-vg-026-exit-recommendation/implement.md#2026-10-22-人工验收确认) | 原已存在 |
| VG-027 | [记录](../../.trellis/tasks/10-20-vg-027-early-delivery/implement.md#2026-10-22-人工验收确认) | 原已存在 |
| VG-029 | [记录](../../.trellis/tasks/10-22-vg-029-geolocation-recovery/acceptance.md#2026-10-22-人工验收确认) | 原已存在 |
| VG-030 | [记录](../../.trellis/tasks/10-22-vg-030-font-recovery-reload/implement.md#2026-10-22-人工验收确认) | 5e8fae1 |
| VG-031 | [记录](../../.trellis/tasks/10-22-vg-031-language-list-sync/implement.md#2026-10-22-人工验收确认) | 原已存在 |
| VG-032 | [记录](../../.trellis/tasks/10-22-vg-032-header-sync/implement.md#2026-10-22-人工验收确认) | 原已存在 |

当前发布边界与剩余验证见 [发布校准记录](release-calibration.md)。VG-022 保留 P1 实测结论未建立、暂不继续实验；VG-027 按限定范围完成历史 NO_GO 与后续覆盖范围的文档处置，不把缺失的底层原生等价证据补成 PASS。

发布资料校准已于 2026-10-22 获用户人工验收，见 [人工验收记录](release-calibration.md#人工验收)。历史附件缺口保留，不扩大各任务原有验收范围。

当前构建的 [Chrome 138 最低版本真实验收补证](chrome138/README.md) 已于2026-10-22获用户[人工验收](chrome138/README.md#2026-10-22-人工验收确认)；范围包含正常 UI 安装／Options、HTTP 启用及关闭冷启动、真实 HTTPS 加载后生效与恢复。历史未测项应结合该补证解释，不能外推至其他平台或全部场景。
