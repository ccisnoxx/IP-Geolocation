# VG-003：实现扩展侧诊断验证与报告

2026-10-14 用户授权 R1，依赖 VG-002（manifest done，人工验收记录一致）。当前分支 stabilize/VG-003，基线 5701b55；保留 VG-000～VG-002 所有未提交改动及既有图标资产。

## 验收

一次性 run 由后台持有预期值、ID、TTL 和状态，仅内存。扩展报告页比较 language、languages、Accept-Language、timezone、locale、geolocation、WebRTC policy/ICE、iframe/worker 和原生设备透传参考，显示 PASS/FAIL/UNKNOWN。目标页只产生实际观测，不接收预期参数或配置桥。导航、取消、过期、执行失败与权限限制可解释，结束后删除后台敏感状态。报告页无 web accessible resource。

保留 hosted/localhost 工作流；schema、local storage、迁移、DNR、权限、host scope、verified 档案事务及现有伪装面不变。不得外部部署、提交、推送或实施后续任务。本地交付为 review，done 需人工验收。

## 清单校准

旧 VG-003 是初始 DNR 生命周期条目；VG-002 PRD 已指出该冲突需在启动 VG-003 时校准。当前明确请求覆盖旧计划，更新同一条目而不创建第二份清单；A03 的完整 DNR 生命周期浏览器缺口仍保留，不以诊断报告代替。
