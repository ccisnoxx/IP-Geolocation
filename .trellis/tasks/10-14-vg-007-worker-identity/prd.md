# VG-007：SharedWorker 身份与 Blob URL 生命周期

任务范围以 [manifest](../../../docs/stabilization/task-manifest.yaml) 为准。依赖 VG-005（done），保留已完成 VG-000 的治理约束。发布阶段 R2；本地交付为 review，人工验收前 completedAt 为 null。

## 目标与验收

- 同一文档内相同原始绝对 URL、type、name、credentials 和当前语言/时区补丁配置复用同一 Blob URL；不同 key 不错误共享。
- 两次连接同一 SharedWorker scope，计数器递增；不同 name 独立。
- Dedicated（含已有嵌套包装）构造成功或同步失败后释放临时 URL；Shared 缓存在 pagehide 清空。
- 保留同源 HTTP(S) 限制、原生 cross-origin fallback、classic/module bootstrap 顺序及构造器反射形态。
- 缓存只存现有隐藏 runtime state，不建立页面配置桥或页面可见 marker。
- Node 模拟、真实 Chrome worker fixture smoke 和类型/测试/build/dry-run 证据分别记录。

## 范围外

ServiceWorker、Worklet、新设备指纹面、跨文档缓存、普通脚本网络语义改造、持久化/schema/迁移/权限/host 扩大，以及后续稳定化任务。
