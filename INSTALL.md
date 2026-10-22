# VanishGeo 安装与更新

> **VG-024（2026-10-20，人工验收通过，未发布）**：已移除两项 DNR 权限与过渡清理组件，请求头保持原生。VG-028 已获人工验收；语言／时区 userScripts、WebRTC 与其他页面能力的暂停边界不变。不提交、不发布。

> **VG-023 第一阶段（2026-10-16 已通过用户人工验收）**：页面语言与时区改用 Chrome `userScripts` 在 `MAIN` / `document_start` 提前执行。最低 Chrome 138，需在扩展详情页正常开启 **Allow User Scripts**。仅支持普通 HTTP(S) 顶层文档和 iframe；Geolocation / Permissions geolocation、Worker / SharedWorker 继续暂停；固定内置字体过滤已于 VG-025（2026-10-20）获用户授权恢复，按独立注册状态报告。配置按每文档快照生效：注册成功后新文档使用新值，旧文档及 BFCache 保留旧值，需完整 reload 或关闭重开。没有热更新或 documentId 注入回退。WebRTC 独立报告。旧路径调查保留在 [VG-011 记录](docs/stabilization/document-id-investigation.md)。

## 从源码加载

准备 Node.js 20+ 和 npm，在仓库根目录运行：

```bash
npm ci
npm run build
```

1. 在 Chrome 打开 `chrome://extensions/`，启用“开发者模式”。manifest 声明最低 Chrome 138。
2. 点击“加载已解压的扩展程序”，选择仓库里的 **dist 文件夹**，其根目录直接包含 `manifest.json`。
3. 在 VanishGeo 的“详情”页正常开启 **Allow User Scripts（允许用户脚本）**，再打开 Popup 或 Options，点击“重试同步”；可在工具栏固定图标。
4. 按 [CONFIG_GUIDE](CONFIG_GUIDE.md) 配置所需站点、信号与出口档案，查看WebRTC 的实际结果。确认页面语言/时区注册成功后，完整 reload 或关闭重开已有目标文档。其他页面能力仍暂停。

不要加载仓库根目录：TypeScript 维护源不是可直接运行的扩展入口。Edge 可在 `edge://extensions/` 加载同一 dist；兼容性和 privacy API 控制状态须在对应浏览器验证，不能由 Chrome 结果推断。

全新安装默认关闭总开关、没有预配置站点，WebRTC 使用 browser default，不调用出口定位 provider。安装事件会打开 Options 配置引导：主动检测并确认出口、选择站点、明确启用。可以跳过或直接关闭页面，保护保持关闭；需要时从 Popup 打开配置引导。也可以在完整设置中使用手工配置或禁用信号；auto 必须显式绑定 verified 档案。没有内置地区整套快捷预设。

## 从已有发行包加载

仅使用仓库维护者实际发布的 `vanishgeo-v<版本>.zip`。解压后选择直接包含 manifest.json 的目录；保留整个目录，包括 `assets/` 共享 chunks、六个入口、静态资源与 LICENSE/NOTICE。不要从文档推断某个版本已经发布。现有打包流程见 [RELEASE](RELEASE.md)。

## 更新与开发

修改源码后重新 `npm run build`，在扩展管理页点击 VanishGeo 的“重新加载”，再刷新目标网页。`npm run dev` 持续构建到 dist，但不会自动完成浏览器扩展重载。尽量保留同一加载路径，避免被浏览器识别为另一个扩展。

已有 v2 配置迁移至 v3，保留 masterEnabled、WebRTC、规则、环境方案和出口档案；升级/启动/后台唤醒不重新打开安装引导，也不应用安全新默认值。空规则或缺少旧初始化标记不视为首次安装。旧格式继续由原迁移边界转换。

配置导出可以备份本地设置，但文件可能包含公网 IP、坐标和历史记录，需妥善保存。导入会将出口档案降级为 unverified 并清空规则的出口绑定，必须重新检测确认再绑定；参见 [PRIVACY](PRIVACY.md)。

## 排查

- 加载失败：确认 dist 根部存在 manifest.json，检查扩展管理页的具体错误；重新构建，不编辑 dist 来修复。
- 页面语言/时区没有变化：先区分 API 不支持、权限缺失、Allow User Scripts 未开启或注册同步失败。注册成功后再完整 reload 或关闭重开；已有 BFCache 文档保留旧快照。about:blank/srcdoc/data/blob/特殊 sandbox 不支持。自定义字体名单、位置和 Worker 仍暂停；固定内置字体过滤按独立注册状态报告。
- Accept-Language 没有变化：当前版本保持 HTTP 请求头原生，不再与网页语言同步。当前版本已删除 DNR 权限及清理组件；旧 v2 跳级升级可能有磁盘残留，但不会启用，也不重新申请 DNR。
- WebRTC 状态不一致：在 Options 查看实际 policy 和控制权；其他扩展或浏览器策略可能控制该设置。
- 类型或构建失败：执行 `npm run typecheck`，依据具体错误修复；依赖安装使用锁文件和 `npm ci`。
- localhost 诊断：构建后执行 `npm run serve:leak-test`；端口冲突可用 `npm run serve:leak-test -- 8788`，报告页选择相同端口。用 Ctrl+C 停止服务。

## 卸载与清理

在扩展管理页找到 VanishGeo，点击“移除”。浏览器会清除该扩展的本地存储；下载的 JSON、截图、浏览器历史、外部站点记录和该站点 localStorage 不随扩展卸载删除。外部诊断页设备基线可用其清除按钮删除；更多数据生命周期见 [PRIVACY](PRIVACY.md)。


VG-025（2026-10-20）已获用户授权恢复固定内置名单字体过滤；仅启用的HTTP(S) allowlist生效，custom、位置和Worker继续暂停。注册成功只代表匹配新文档就绪，旧hook/BFCache须完整重建；恢复授权不等于人工验收通过。详见 [配置指南](CONFIG_GUIDE.md)。
