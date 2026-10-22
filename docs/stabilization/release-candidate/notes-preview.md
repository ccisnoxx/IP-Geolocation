## 更新日志（自 v2.1.0）

- test(release): 记录 Chrome 138 人工验收与真实浏览器证据 (51d1283)
- chore(release): 校准发布审查并恢复验收证据 (d56ee9c)
- docs(VG-022): 记录研究处置验收并恢复任务资料 (7cd47f2)
- docs(VG-027): 记录限定范围验收并恢复定位证据 (b5855ee)
- test(VG-026): 补齐真实 Chrome 验证并记录人工验收 (161064d)
- docs(VG-031): 记录语言列表同步验收通过 (a63ed8c)
- feat(VG-032): 同步语言请求头并确认可靠关闭流程 (a43927f)
- 1 (da068f2)
- fix(VG-030): 修复字体故障恢复的重载提示 (5e8fae1)
- feat(VG-029): 恢复地理位置并精简面板状态 (838c301)
- feat(VG-025): 恢复固定名单字体过滤 (de23b79)
- refactor(VG-024): 移除 DNR 权限与过渡清理 (eb30223)
- refactor(VG-028): 建立 v3 字体模型并停止请求头改写 (20749b9)
- docs(fixture): 补录两组提交的人工验收 (de85aea)
- test(fixture): 验证语言时区自动恢复并等待 worker 就绪 (fc40299)
- test(fixture): 等待 sandbox 页 body 就绪 (77790ce)
- feat(runtime): 用 userScripts 恢复语言和时区文档快照 (bfefd03)
- test(userScripts): 保存 document_start 实验与人工验收 (a4a4055)
- fix(runtime): 修复 Navigator 原生合同与私有状态 (1518938)
- chore(deps): 更新构建依赖安全补丁 (31f6dee)
- 整理 2.1.1 版本、暂停说明与发布一致性检查 (d6f2873)
- feat: 同步 VanishGeo 稳定化代码与验证记录 (5f871fc)

以上条目为提交历史，包含已被后续变更替代的中间状态。当前版本通过 userScripts 提供语言／时区和合成定位，使用 declarativeNetRequestWithHostAccess 同步 Accept-Language，并提供固定名单字体过滤；具体启用条件和限制见下文。

## 安装方法

1. 使用 Chrome 138 或更高版本，下载此 Release 的 `vanishgeo-v<版本>.zip` 并解压。
2. 打开 `chrome://extensions/` 并启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择解压后直接包含 `manifest.json` 的目录。
4. 在 VanishGeo 的“详情”页正常开启 **Allow User Scripts（允许用户脚本）**，打开 Popup 或 Options，点击“重试同步”。
5. 全新安装默认关闭保护且没有预配置站点。在 Options 中配置所需站点和信号；推荐流程需主动检测并确认出口档案，再明确应用，查看推荐本身不会开启保护。
6. 等待保存／同步成功，分别确认语言／时区、定位和字体的注册状态；完整重载或关闭重开已有目标页面，使配置在新文档生效。

## 可靠关闭与已知限制

- 先关闭**插件总开关**并保存，等待同步成功，再完整重载或关闭重开已有目标页面，让页面语言与 Accept-Language 一起恢复原生；之后才按需关闭 Allow User Scripts。
- Chrome 的 Allow User Scripts 开关与请求头规则独立。直接关闭该开关仍可能让首请求携带旧语言头；不承诺跨 API 原子同步。
- 配置按每文档快照生效，旧文档与 BFCache 可能保留旧值；没有热更新或自动刷新。Worker / SharedWorker、自定义字体与非普通 HTTP(S) 文档不在当前支持范围内。
- 合成定位仍受安全上下文、origin 和 Permissions Policy 等条件限制，不等同原生传感器或所有权限语义；WebRTC 策略状态也不是所有网络路径的防泄漏证明。
- Chrome 138 的真实验收覆盖 138.0.7204.183 / macOS arm64 的已记录场景；不代表其他平台、全部补丁版本、HTTPS 最早脚本／自动恢复、全部升级和故障组合均已验证。首轮恢复异常与历史附件缺口仍保留。

功能、权限、隐私与人工浏览器验收边界见仓库 README、INSTALL、PERMISSIONS、PRIVACY、RELEASE 及 docs/stabilization/evidence-index.md；Chrome 138 的详细覆盖与异常记录见 docs/stabilization/chrome138/README.md。
