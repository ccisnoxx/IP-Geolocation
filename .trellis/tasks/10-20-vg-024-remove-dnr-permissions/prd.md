# VG-024：删除 DNR 权限与过渡清理组件

## 授权与依赖

2026-10-20 用户明确确认 VG-028 人工验收通过，并要求“更新状态，然后按计划开始 VG-024；不提交、不发布”。依据原实施计划第6节，原文重用的产品契约VG-023前置现对应VG-028，已done且真实Chrome升级清理7项PASS。原语言/时区VG-023 done、VG-022状态不变。

## 范围与验收

- manifest删除declarativeNetRequest及declarativeNetRequestWithHostAccess，只缩减权限；MV3/Chrome138/版本/host/userScripts其余权限不变。
- 删除legacy-dnr-cleanup模块、legacyDnrCleanup组件/类型/标记写入与专用unit测试；生产不再引用DNR API。已有marker可保留为惰性旧数据，不成为功能/升级门槛。
- 同步状态只保留语言/时区注册、WebRTC与已有文档刷新提示，UI不再显示清理组件；请求头仍原生。schema3、迁移/verified、规则、WebRTC语义、语言/时区userScripts快照及位置/字体/Worker生产暂停不变。
- 更新现行权限/隐私/安装/配置/发布/长期规范及稳定化记录，不篡改VG-028与更早的历史证据。
- 真实Chrome验证：已清理VG-028→候选；更旧v2跳过清理→候选。两者均同profile同路径、版本不变，核验权限减少、header原生、语言配置变化不重建旧规则、worker stop/wake无DNR依赖。v2跳级不宣称删除磁盘残留；当前版本不再请求DNR，未来重新引入必须独立设计清理迁移。
- 候选策略仅本地：不打包发布、不新增权限或重新授予DNR来读取残留，不恢复字体/位置/Worker。实现及本地验证后仅review，人工确认后才done。

## 验证

复用VG-028已验收且源码输入未变的207/207基线与7项真实Chrome证据。稳定候选执行git diff --check、npm run typecheck、npm run typecheck:tests、npm test、npm run build、npm run test:e2e:chrome -- --dry-run。权限和升级边界需fresh独立只读复核。真实Chrome与Node/VM/dry-run证据分列。
