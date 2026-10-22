# VG-014：稳定化集成回归与发布候选验收

阶段 R4，依赖 VG-001～VG-013 全部 done。目标是整个稳定化波次集成审查、真实 Chrome 回归、安全/隐私与候选报告。只修复确认的 P0/P1 集成回归，不新增功能。

## 必须交付

- 逐项记录配置/disabled rules、diagnostic privacy/report、DNR、WebRTC、runtime sync、migration/onboarding、iframe/worker/SharedWorker、earliest-inline、strict/compatible。
- 完整本地门禁，真实 Chrome 核心隐私证据，环境/版本/命令/结果；区分静态、Node、隔离 runtime 与生产 dist。
- dist/ZIP manifest、权限、入口/chunk、远程代码/map、敏感数据和结构检查；只读 CI/release 审查。
- release-readiness 列出通过、未验证、阻断、回滚点和建议版本；不改实际版本、不发布。
- 保持 VG-011 安全暂停、单一配置/匹配/持久化所有者、verified 边界和原生设备透传。
- 本地完成 manifest/Trellis 为 review，人工确认前不得 done/completed。

## 停止条件

仅依赖未完成、不可消解合同冲突、未批准的破坏性迁移/历史重写/权限或外部授权、必须改变被禁止的安全隐私边界、无法区分的阻塞性基线失败可 blocked。无法取得某项 Chrome 证据时如实 UNKNOWN，不宣称 release-ready，继续可完成的审查与报告。
