# 参与 VanishGeo 开发

项目仓库为 [ccisnoxx/VanishGeo](https://github.com/ccisnoxx/VanishGeo)。维护源在 `src/`，TypeScript/Vite 输出到 `dist/`。开始前读取适用 AGENTS 与任务合同，保留用户及其他任务修改。稳定化范围、依赖、状态只读取 [manifest](docs/stabilization/task-manifest.yaml)，模板或历史记录不能授予后续任务实施权限。

## 环境与检查

使用 Node.js 20+、npm 与锁文件，在仓库根目录运行：

```bash
npm ci
npm run typecheck
npm run typecheck:tests
npm test
npm run build
git diff --check
```

`npm run check` 聚合源码类型、测试类型、单元测试和构建，任一步失败立即停止；完整 CI/发布门禁见 [RELEASE](RELEASE.md)。

本地开发 `npm run dev` 持续构建，Chrome 加载/重载 dist。检查选择按实际合同；Node/VM/mocks/静态 wiring 和 dry-run 不能写成真实 Chrome 验收。浏览器入口及诊断方法见 [浏览器验证指南](docs/development/browser-validation.md) 与 [CONFIG_GUIDE](CONFIG_GUIDE.md)。

配置归一化、匹配解析、持久化迁移分别以 config-model/config-resolver/storage 为唯一所有者；不得添加平行匹配器、网页配置桥、全站静态注入或放宽 verified/权限校验。运行时行为变化需要对应任务授权。

## 合成数据与问题报告

示例域名使用 example.com；公网 IPv4 示例使用 [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737) 的文档地址。localhost/回环只用于本地服务，私有地址测试仅用于协议分类，不替换成真实网络数据。坐标采用合成值，不从个人位置或 provider 响应复制。

请通过本项目的 [Issues](https://github.com/ccisnoxx/VanishGeo/issues) 提交问题。报告应包含版本、合成配置、重现步骤、实际/预期及证据层级。完整导出会包含公网 IP、坐标、历史、名称和规则；提交前脱敏 JSON、URL、请求头/cookie、截图、路径与日志，不提交凭据或日常浏览器 profile。数据生命周期见 [PRIVACY](PRIVACY.md)。

## 历史敏感值清理方案（待人工批准）

VG-004 只读扫描了本地所有 refs 的 62 个提交中 CONFIG_GUIDE、RELEASE、README 和 INSTALL。已确认 CONFIG_GUIDE 历史含非文档公网 IP，RELEASE 历史含个人绝对路径；另确认 HEAD 中旧 Trellis Chrome smoke 记录含个人路径，当前记录已脱敏。当前文件修订不移除历史。此范围不代表所有历史对象、远端缓存、fork、日志或备份都完成审计。

如维护者决定清理，需要**单独明确批准历史重写及远端更新**，可按以下方案准备并审阅，VG-004 不执行：

1. 在受控位置保存可恢复备份，确认需处理的 refs、文件、敏感值类别和替换规则；不把原值写进公共 issue、文档或新提交。
2. 在隔离副本只处理获批对象。使用历史过滤工具的具体方案需先核对工具版本、保留许可证与合法来源归属，并预览受影响的 commits/tags。
3. 核对替换后的对象、提交映射、分支/tag、构建和授权范围，再由维护者决定是否更新远端。不可擅自 force-push、删 tag 或重建 Release。
4. 如获准远端更新，协调协作者重新获取历史，并处理允许范围内的旧备份、fork 和托管缓存；历史重写不能保证所有外部副本消失。

远端 repository description/topics 的人工建议及实际发布触发见 [RELEASE](RELEASE.md)。文档清理、历史清理和发布分别执行，不互相推导授权。
