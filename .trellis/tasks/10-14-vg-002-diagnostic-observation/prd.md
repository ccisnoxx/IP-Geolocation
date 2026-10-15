# VG-002：移除诊断 URL 中的敏感预期值

## 授权与依赖

2026-10-14 用户明确授权本任务，阶段 R1，分支 stabilize/VG-002。唯一清单中 VG-000=done，VG-002 从 planned 进入 in_progress；人工验收前只交付 review。仅实现 VG-002。

## 目标与验收

- 诊断 URL 不含 expected*、精确坐标、语言、时区、Accept-Language、WebRTC 或 locale 预期配置；不转移到其他 query、路径、cookie、外部存储或消息桥。
- 外部 leak-test 固定 observation mode，仅展示页面实际 language/timezone/geolocation/WebRTC ICE/header/realm/设备观测；无配置验收 PASS/FAIL。
- 删除 URL 比较代码、测试和误导说明；保留普通 HTTP(S) 页面与同源 header echo。
- 预期配置不出现在页面原始值、控制台或错误文本；无 window.postMessage 配置桥。
- 执行 diff/typecheck/npm test/build/Chrome dry-run，准确区分 Node/VM 与真实 Chrome。

## 范围外

扩展侧报告页和完整验证留给用户指定的 VG-003；现清单 VG-003 是 DNR 条目，启动前需校准，本次不修改其范围或实施。正常站点伪装、schema/storage/迁移/权限/host scope/MV3/DNR/verified 边界及依赖不变。不提交、推送或发布扩展。2026-10-14 用户追加授权仅部署托管诊断页及必要资源，并明确指定 hostdzire；该授权与执行证据见 implement.md“托管页面部署完成”。

## 基线

提交 5701b55；已有 VG-000/VG-001 未提交改动和两份图标资产，保留。相关基线测试 35/35 通过。PRIVACY.md 原不存在。
