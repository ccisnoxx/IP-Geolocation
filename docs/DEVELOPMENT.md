# VanishGeo 开发指南

从源码构建、测试与本地验证。实现原理见 [ARCHITECTURE](ARCHITECTURE.md)，发版流程见 [RELEASE](../RELEASE.md)，
各浏览器检查脚本的细节见 [tools/README](../tools/README.md)。

## 环境

- Node.js 22+（`package.json` 的 `engines`；Node 20 缺少测试依赖的全局对象）
- Chrome / Helium 用于浏览器检查；Chrome 119 回归用 `npm run setup:chrome119` 下载 Chrome for Testing（macOS arm64）

```bash
npm install
npm run build        # 内含 typecheck；产物在 dist/，加载这个目录
npm run dev          # vite build --watch，改完回扩展页点刷新
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/background/` | Service Worker：配置应用、DNR、内容脚本 / 用户脚本注册、出口 IP、消息路由 |
| `src/content/` | ISOLATED 桥：与注入层握手、转发 payload |
| `src/injected/` | MAIN world 注入层（经典脚本，零 import） |
| `src/shared/` | 配置模型、规则解析、体检等纯函数（注入层不能引用） |
| `src/popup/` `src/options/` `src/leak-test/` | 弹窗、配置页、诊断页 |
| `scripts/` | 烘焙构建、出包、发版说明 |
| `tools/` | 浏览器审计与冒烟脚本（`tools/out/` 存临时产物，不进仓库） |
| `docs/reviews/` | 历次审阅与安全记录 |

## 本地检查

日常改动跑这一条就够，合并 PR 以它为准（GitHub CI 只手动触发）：

```bash
npm run verify       # lint → build（含 typecheck）→ 全部单测
```

其它常用命令：

```bash
npm test                         # 单测（tests/ 下全部；options / popup 用 jsdom 驱动真实事件）
npm run test:coverage:core       # 核心文件分支覆盖率门禁（每文件 ≥ 85%）
npm run test:coverage:security   # 安全模块分支覆盖率门禁
```

单测里有几项会读 `dist/` 的产物，`verify` 先构建就是为了避免读到别的分支留下的旧产物。

## 浏览器检查

改到注入层、桥、权限或首屏相关逻辑时，加跑对应的冒烟：

```bash
npm run smoke:frames        # frame 隔离（父域 / 子域 / about:blank / srcdoc）
npm run smoke:userscripts   # 用户脚本首屏模式（开关开 / 关、热更新、伪造认领）
npm run smoke:popup         # 弹窗真实点击 / 存储 / 后台消息
npm run smoke:cold-start    # 冷启动与 clear
npm run smoke:presets       # 内置 preset 逐个验证语言 / 时区 / 请求头
npm run smoke:ipapply       # 「从 IP 自动配置」
npm run audit               # 静态检查 + 三引擎（Chrome / Chrome 119 / Helium）全部检查，输出通过率表
npm run audit -- --engines=chrome --only=popup,frames   # 只跑指定引擎与分组
```

指定浏览器：`CHROME_PATH=<可执行文件>`；Chrome 119 这类老引擎另加 `VANISHGEO_LEGACY_EXTENSION=1`
（用启动参数装载扩展）。完整列表与每组检查的含义见 [tools/README](../tools/README.md)。

## 烘焙构建

把配置编进注入层，首屏即生效且不依赖「允许用户脚本」：

```bash
npm run release -- --preset=singapore      # 用内置 preset 出包（产物在 release/）
npm run release -- --all-presets
npm run build:persona -- --config=<配置页导出的烘焙配置.json> --out=dist-baked
```

出包的三道闸、`verify:release` 真开浏览器量首屏等细节见 [CONFIG_GUIDE 第十节](../CONFIG_GUIDE.md#十首屏窗口三种模式)。

## 协作约定

- 每个任务从最新 main 拉一个分支，不在别的功能分支上叠加
- 本地 `npm run verify` 通过（必要时加跑相关冒烟）后推送、开 PR、普通合并（保留 merge commit），合并后删除分支
- 用户可见的变化写进 `CHANGELOG.md` 的「未发布」段；发版按 [RELEASE](../RELEASE.md)
