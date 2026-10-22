# VG-003 设计

## 所有权与可信流

services 提供既有 getSiteConfig；诊断控制器独立管理内存 run，始终调用 config-resolver.getEffectiveProfile。prepare 绑定扩展报告页 tab/document 与目标 top documentId，先检查 HTTP(S)、allowlist、有效 payload 与已有 host 权限，再用 ISOLATED 获取文档身份。预期仅保存需要比较的语言、时区、位置与 WebRTC 请求策略，不保存出口 IP 或完整配置。

execute 只允许绑定报告文档消费一次。无预期参数的自包含函数定向 MAIN 收集实际 API、目标同源 /headers.json、既有 STUN ICE 与同源 worker fixtures。ISOLATED 提供同文档原生设备参考；它只是当前世界对比证据，不能冒充启用前的设备基线。子帧逐文档按浏览器返回 documentId 和 ISOLATED URL 重新解析配置；不可确定 origin fallback 时 UNKNOWN。临时同源 iframe 只含固定 observation URL，完成时移除。无 postMessage 配置桥、页面 storage 预期值或静态全站注入。

## 生命周期

TTL 为 2 分钟；后台重启失效。一个报告文档最多一个未完成 run，重建取消旧 run。执行中禁止重复消费。导航/关闭、取消/过期删敏感状态并记录短期无敏感终态原因；每个 await 后重新核对身份、TTL 与目标文档。失败使用固定错误类别，不向日志传网页异常。采集函数有独立资源超时，finally 清理 iframe、worker、ICE、watch、Audio/WebGL 资源。报告完成后后台删除 run；页面只在内存显示结果，TTL、离开或清除按钮清除结果。

## 比较

共享纯函数只由扩展报告页调用。禁用/缺失项 UNKNOWN；有确定不一致 FAIL；位置按配置随机半径以球面距离比较，精度独立比较。timezone 与 locale 按扩展原生 Intl 在固定时间生成预期。策略实际控制状态和 ICE 分行；无候选不证明防护 PASS，任何 IP 候选暴露 FAIL，未能观测 UNKNOWN。原生透传相同且可观察才 PASS。

## 回滚与范围

只反向本任务可识别补丁并重建 dist；不撤回 VG-002 隐私修复、不迁移数据。hosted fixtures 缺失/CSP 等返回 UNKNOWN，不自动部署或扩大权限。真实 Chrome 与 Node/mock/dry-run 证据分别记录。
