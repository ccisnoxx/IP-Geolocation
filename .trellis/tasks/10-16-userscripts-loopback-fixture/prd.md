# userScripts document_start：修复隔离 Chrome 启动并运行真实 fixture

## Goal

TBD.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# userScripts document_start 隔离 fixture

2026-10-16 用户授权：解决实验 Chrome 启动阻塞，保留 Chrome 自身 sandbox 和仅 loopback 的内核网络约束，不修改生产代码，不绕过 Allow User Scripts。运行真实 fixture，保存 GO/NO_GO 或真实阻断 JSON，本地交付停在 review，等待用户人工验收。

## 范围

- 只维护 experiments/userscripts-document-start 和本任务记录。
- 既有 macOS Seatbelt 后端及 BLOCKED 证据保留。
- 新建本任务独占、可清理的 Linux VM，验证网络命名空间后端；依赖准备可联网，Chrome 只在隔离后启动。
- 不修改生产 manifest/src/build/测试，不恢复 runtime，不发布、不提交、不 push。

## 验收

- 仅 loopback 接口、非 loopback IPv4/IPv6 明确拒绝、派生进程继承和真实 Chrome 自身 sandbox 分别有证据。
- Allow User Scripts 通过正常用户界面开启，不使用 flags、偏好文件、CDP 私有设置 API 放行。
- 原固定 API/A–F 场景和 earliest/load/postLoad 判定不弱化。
- JSON 由 acceptance.mjs 统一计算，未知和失败不能写成 GO。
- 生产文件基线、暂停闸门不变；资源清理有确认。

## 初始证据

README、sandbox-startup-investigation.md 和 sandbox-evidence.json：macOS27 + Chrome155 sandbox 初始化拒绝；全部机制场景 UNKNOWN。再次相同策略成功不证明 Chrome 不同策略可应用。本轮不重试同一后端。
