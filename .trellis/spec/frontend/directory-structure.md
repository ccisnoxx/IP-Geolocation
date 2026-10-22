# 目录结构

> VG-023：Chrome 138+ / userScripts / 正常 Allow User Scripts。生产通过固定构建模板加 resolver 最小语言/时区 JSON 提前注册 MAIN / document_start，普通 HTTP(S) 顶层及 iframe 每文档快照。无 content 初始化或 documentId executeScript 回退，无热更新/自动 reload。Geolocation/Permissions geolocation、Worker/SharedWorker 仍暂停；VG-025固定内置名单字体过滤已于2026-10-20获用户恢复授权，仅启用HTTP(S) allowlist按独立状态派发；特殊文档 unsupported / UNKNOWN。任务及证据见 [VG-023](../../tasks/10-16-vg-023-userscripts-language-timezone/prd.md)。

## 当前架构

VanishGeo 是 Chromium Manifest V3 扩展。维护源使用 TypeScript 和 ES modules，由 Vite/Rollup 编译到 `dist/`；Chrome 加载的是 `dist/`，仓库根目录不提供可直接加载的运行时 JS 入口。界面使用原生 HTML/CSS/DOM，没有 SPA 框架。

结构以执行环境划分，配置事实和派生结果遵循单一所有者。不要沿用历史 `background.js`、`main_spoof.js`、`pages/`、`spoof/` 或浏览器 global/CommonJS 双导出布局。

## 维护源

```text
.
├── manifest.json                 # MV3 manifest，构建时原样复制
├── package.json / package-lock.json
├── tsconfig.json / vite.config.ts
├── src/
│   ├── background/
│   │   ├── service-worker.ts      # 模块 service worker 入口与事件注册
│   │   ├── services.ts            # 配置事务、检测确认、脚本/WebRTC、人工重载提示
│   │   ├── page-scripts.ts        # 安全JSON代码生成及串行userScripts对账
│   │   ├── message-router.ts      # 消息分派与扩展管理页来源校验
│   │   ├── context-menu.ts
│   │   ├── diagnostic-runs.ts     # 一次性内存 run、所有者/TTL/授权与导航状态
│   │   ├── diagnostic-probe.ts    # 自包含实际值采集，无预期参数
│   │   └── webrtc.ts
│   ├── content/content.ts        # 兼容构建空入口，不注册、不发送初始化消息
│   ├── injected/runtime.ts       # 静态生成完整隔离runtime与生产语言/时区源码的 facade
│   ├── injected/runtime-modules/ # registry/payload/调度、页面 surfaces 与独立 worker graph
│   ├── runtime-virtual.d.ts      # 两层 virtual module 的类型合同
│   ├── popup/                    # popup.ts / popup.html / popup.css
│   ├── options/                  # options.ts / options.html / options.css
│   ├── leak-test/                # 外部 observation 页面
│   ├── diagnostic/               # 扩展 origin 的 report.ts / report.html / report.css
│   └── shared/
│       ├── types.ts / defaults.ts
│       ├── config-model.ts       # 归一化、默认值、基础校验
│       ├── config-resolver.ts    # 匹配、有效配置解析和迁移转换
│       ├── storage.ts            # storage 读取、迁移写入和旧键清理
│       ├── diagnostic.ts / diagnostic-report.ts / ip-location.ts
│       └── profile.ts / ui-state.ts / locale-datetime.ts / last-location-display.ts
├── fixtures/                     # iframe、workers、geolocation 的本地浏览器场景
├── tests/*.test.ts               # Node test runner + tsx；包含 VM/mock/静态 wiring
├── build/                        # 两层静态生成器、单函数守卫和 Vite watch 插件
├── scripts/                      # localhost 诊断 server 和半自动 Chrome 验收入口
├── public/icons/                 # manifest/action 使用的构建图标来源
├── images/                       # 项目图片，不作为运行时入口
├── docs/stabilization/           # 唯一稳定化清单、验收矩阵和基线说明
└── dist/                         # 生成目录，忽略，不直接编辑
```

`ip-location.ts` 等模块中的历史常量/类型不意味着仍存在后台自动定位；是否调用以当前 `services.ts`、`service-worker.ts` 和测试为准。配置与 verified 出口档案合同见 [状态管理](./state-management.md)。

## 构建入口与输出

`vite.config.ts` 定义六个 TypeScript 入口；稳定入口名必须与 manifest、HTML 和动态注册引用一致：

| 维护源 | dist 路径 | 消费者 |
|---|---|---|
| `src/background/service-worker.ts` | `background/service-worker.js` | manifest 的 module service worker |
| `src/content/content.ts` | `content/content.js` | 保留的空构建入口，无动态注册 |
| `src/popup/popup.ts` | `popup/popup.js` | `popup/popup.html` |
| `src/options/options.ts` | `options/options.js` | `options/options.html` |
| `src/leak-test/leak-test.ts` | `leak-test/leak-test.js` | `leak-test/leak-test.html` |
| `src/diagnostic/report.ts` | `diagnostic/report.js` | `diagnostic/report.html`（仅扩展 origin） |

- HTML、manifest、`public/icons/*`、fixtures、LICENSE、NOTICE 通过静态复制进入 dist；页面 CSS 由对应入口导入并输出到页面子目录。
- 当前构建会输出 `dist/assets/*.js` 共享 chunks。哈希文件名由 Rollup 决定，不能假定共享模块全部内联；打包必须包含整个 dist 所需文件。
- `src/injected/runtime.ts` 导出隔离测试的完整函数与生产 `pageRuntimeSource` 字符串。后者由 `language-timezone-entry.ts` 静态生成，只安装 Navigator 语言和 Intl/Date，Temporal 明确禁用；不含位置、字体暴露过滤或 worker 安装 graph。后台将它与安全 JSON payload 组成 userScripts code。两者均有自包含构建守卫；无独立 runtime 入口或 WAR。
- `@` 指向 src，TypeScript 和 Vite 都配置了别名；源码 ES module imports 由构建处理，不需要 `module.exports` 或浏览器全局导出。
- `npm run dev` 是 Vite build watch，开发时仍加载/重载 unpacked dist；`npm run preview` 不代表 Chrome 扩展运行环境。

## 模块与浏览器边界

- 入口负责初始化和监听，领域逻辑归其所有者；不根据根文件历史名强制新增 shell 或层级。
- background 专属 Chrome API 留在 `src/background/`，共享纯配置/派生逻辑留在 `src/shared/`；测试直接 import 同一维护源。
- `services.ts` 配置队列唯一拥有副作用；`page-scripts.ts` 注册规则匹配由 resolver 派生，Chrome 直接执行新文档，不依赖 worker documentId、content 通知或网页配置。
- `allFrames` 仅覆盖各自 URL 匹配的普通 HTTP(S) 文档；不启用 origin fallback。运行时拒绝非 HTTP(S) 与 opaque origin，不遍历父子帧安装。
- runtime 函数必须自包含，不能依赖注入后无法访问的模块闭包；页面 hook 的闭包状态与原生快照集中在 registry；不替换全局反射 API。
- 完整 runtime 中 Worker/SharedWorker wrapper 仅隔离测试保留，生产语言/时区入口不安装；service worker hook 不支持。
- 文件名沿用 kebab-case；新增模块按责任命名，不为一次任务建立平行配置/匹配器。

## 修改与验证

源码或 wiring 变化时检查对应维护源、引用和实际 dist 输出；不得直接修复生成目录。测试边界和真实浏览器验收要求见 [质量规范](./quality-guidelines.md)，稳定化证据见 [执行基线](../../../docs/stabilization/README.md)。

## VG-012 静态运行时模块

`build/self-contained-runtime.ts` 先生成 workerBootstrap，再把 worker 静态函数嵌入页面 graph，最终函数体包含所有运行依赖。生成函数外仅纯 export，拒绝外部绑定/import、动态 chunk、运行期编译、循环/缺失依赖和不稳定生成文件名。不要直接把普通模块函数交给 executeScript.func 或对带模块闭包的 worker 函数取 source。

registry.ts 创建页面每次安装的私有 RuntimeState；surfaces 显式消费同一 state，entry.ts 返回调用方私有持有的 update 句柄并保留原安装顺序。无 window/self marker、descriptor 缓存或反射 API 替换；独立序列化调用不共享状态。页面 graph 编译为函数体内的 IIFE namespace，外层返回安装句柄；没有函数外运行依赖。worker/registry 拥有独立 realm 原生快照；worker self-reference 显式传入 nested-worker。没有模块级浏览器修改、配置/匹配或存储副本。

`build/runtime-plugin.ts` 返回组合 source map，登记 page/worker 的实际依赖，build watch 重建 virtual 内容。用于加载的内部模块 ID 有文件位置，但不写维护树生成文件；生产 sourcemap 配置保持不变，无网页 map URL/WAR。后台只消费语言/时区固定 source 字符串；完整 graph 保留隔离测试。两次打包脱离闭包与 source map/watch 仍由构建测试覆盖。


VG-025恢复授权已于2026-10-20由用户明确给出，仅固定内置名单、启用HTTP(S) allowlist；custom、位置和Worker继续暂停。正式dist验证入口为node --import tsx scripts/chrome-font-filter-smoke.mjs --production --output <脱敏JSON>，使用实际worker/router/注册资产与临时profile，不修改用户浏览器或开关；人工恢复授权与人工验收通过分开记录。
