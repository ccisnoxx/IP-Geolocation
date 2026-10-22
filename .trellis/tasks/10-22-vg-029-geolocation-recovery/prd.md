# VG-029 地理位置生产恢复

2026-10-22 用户明确授权按本会话方案完整恢复位置、修复问题并完成真实 Chrome 验证；保留语言/时区/字体，不 push、不发布。实现授权与人工验收分开，人工验收前仅 review。2026-10-22用户已明确确认验收通过，稳定化清单done，Trellis completed；签收见acceptance.md。

## 验收
- R1 仅启用 allowlist 规则接收最小位置 payload；manual 和绑定 verified 出口的 auto 有效，各信号解析独立。
- R2 getCurrentPosition/watchPosition/clearWatch 的参数、异步回调、取消、timeout/maximumAge/高精度、异常及返回对象有可执行合同。
- R3 spoofPermission=true 表示明确启用的合成位置授权，不请求真实定位；false 保留原生查询并仅原生 granted 时交付合成位置，prompt/denied 不触发真实传感器。API 查询异常保持失败；secure context / Permissions-Policy 仍约束。
- R4 仅原生存在 Geolocation 的普通非opaque HTTP(S)文档安装；MAIN/document_start/allFrames；无页面桥、动态页面配置、documentId回退、额外权限；特殊文档及Worker不恢复。
- R5 同文档固定位置/随机偏移，修改后人工reload；旧/BFCache快照不会热更新。隐藏/冻结不交付，clearWatch取消，pagehide退出与BFCache恢复无重复监听。
- R6 同一后台配置队列内注册对账、撤销确认、更新、新增、读回；位置独立状态和重载债，含iframe与更新窗口；后台初始化/update恢复、故障可见。
- R7 实际dist真实Chrome正负对照、首脚本、三方法、权限、iframe、A→B、撤销、实际BFCache、后台恢复；语言/时区/字体回归。
- R8 独立只读高风险复核、本地完整门禁；证据脱敏，真实Chrome未覆盖项如实列出；交付人工验收仅review。
