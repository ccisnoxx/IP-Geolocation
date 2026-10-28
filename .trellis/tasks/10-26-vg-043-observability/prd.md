# VG-043 扩展可观察面审计与兼容性预设

用户于2026-10-26授权在当前仓库实施。基线 HEAD 为 `9b5d9be6205c4098ec75dc7338be767e6dd87536`，开始时工作区干净。依赖 VG-040、VG-042 已在唯一任务清单中为 done。

交付：维护者可运行的原生／总开关关闭／语言／时区／定位／字体／WebRTC 差分工具；覆盖普通顶层、同源／跨源 iframe、HTTP／Blob Dedicated Worker 和 SharedWorker 的可见 API、反射、行为、请求头及固定字体签名。结果限 NATIVE、OBSERVABLE、UNKNOWN、UNSUPPORTED。新增规则级 native／consistency／full，在现有模型、匹配与串行对账下裁剪效果，保留高级配置。UI 明示 WebRTC 全局范围。

禁止版本或权限扩大、远程代码、eval/new Function、扩展列表伪造、网站风控／准入绕过、产品页面标记、extension URL 插入或新配置桥。HTTP(S) Worker／SharedWorker 的生产恢复不在范围。必须先在 Helium 做干净对照，保护个人配置；真实 Chrome 结果与 dry-run 分开。

本地实施验证后停在 review，不自动提交、推送或发布。
