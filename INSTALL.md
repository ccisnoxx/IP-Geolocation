# VanishGeo 安装与更新

## 从源码加载

准备 Node.js 20+ 和 npm，在仓库根目录运行：

```bash
npm ci
npm run build
```

1. 在 Chrome 打开 `chrome://extensions/`，启用“开发者模式”。manifest 声明最低 Chrome 119。
2. 点击“加载已解压的扩展程序”，选择仓库里的 **dist 文件夹**，其根目录直接包含 `manifest.json`。
3. 确认名称为 VanishGeo，打开 Popup 和完整配置页；可在工具栏固定图标。
4. 按 [CONFIG_GUIDE](CONFIG_GUIDE.md) 启用所需站点、选择信号与出口档案，然后刷新目标网页。

不要加载仓库根目录：TypeScript 维护源不是可直接运行的扩展入口。Edge 可在 `edge://extensions/` 加载同一 dist；兼容性和 privacy API 控制状态须在对应浏览器验证，不能由 Chrome 结果推断。

全新安装默认关闭总开关、没有预配置站点，WebRTC 使用 browser default，不调用出口定位 provider。安装事件会打开 Options 配置引导：主动检测并确认出口、选择站点、明确启用。可以跳过或直接关闭页面，保护保持关闭；需要时从 Popup 打开配置引导。也可以在完整设置中使用手工配置或禁用信号；auto 必须显式绑定 verified 档案。没有内置地区整套快捷预设。

## 从已有发行包加载

仅使用仓库维护者实际发布的 `vanishgeo-v<版本>.zip`。解压后选择直接包含 manifest.json 的目录；保留整个目录，包括 `assets/` 共享 chunks、六个入口、静态资源与 LICENSE/NOTICE。不要从文档推断某个版本已经发布。现有打包流程见 [RELEASE](RELEASE.md)。

## 更新与开发

修改源码后重新 `npm run build`，在扩展管理页点击 VanishGeo 的“重新加载”，再刷新目标网页。`npm run dev` 持续构建到 dist，但不会自动完成浏览器扩展重载。尽量保留同一加载路径，避免被浏览器识别为另一个扩展。

已有 v2 配置升级保留 masterEnabled、WebRTC、规则、环境方案和出口档案；升级/启动/后台唤醒不重新打开安装引导，也不应用安全新默认值。空规则或缺少旧初始化标记不视为首次安装。旧格式继续由原迁移边界转换。

配置导出可以备份本地设置，但文件可能包含公网 IP、坐标和历史记录，需妥善保存。导入会将出口档案降级为 unverified 并清空规则的出口绑定，必须重新检测确认再绑定；参见 [PRIVACY](PRIVACY.md)。

## 排查

- 加载失败：确认 dist 根部存在 manifest.json，检查扩展管理页的具体错误；重新构建，不编辑 dist 来修复。
- 页面没有效果：确认总开关、站点规则、信号和 verified 绑定；保存并刷新普通 HTTP(S) 页。浏览器内部页与扩展页不能作为站点注入验收。
- WebRTC 状态不一致：在 Options 查看实际 policy 和控制权；其他扩展或浏览器策略可能控制该设置。
- 类型或构建失败：执行 `npm run typecheck`，依据具体错误修复；依赖安装使用锁文件和 `npm ci`。
- localhost 诊断：构建后执行 `npm run serve:leak-test`；端口冲突可用 `npm run serve:leak-test -- 8788`，报告页选择相同端口。用 Ctrl+C 停止服务。

## 卸载与清理

在扩展管理页找到 VanishGeo，点击“移除”。浏览器会清除该扩展的本地存储；下载的 JSON、截图、浏览器历史、外部站点记录和该站点 localStorage 不随扩展卸载删除。外部诊断页设备基线可用其清除按钮删除；更多数据生命周期见 [PRIVACY](PRIVACY.md)。
