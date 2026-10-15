# 目录结构

> VG-011 安全暂停：后台已删除对页面伪装 runtime 的 import/executeScript 路径，所有 initializeRuntimeForSender 在可信 sender 校验后、配置读取与派发前拒绝。对账只撤销 vanishgeo-runtime-init；有启用 allowlist 时 contentScripts 报 runtime-injection-paused / partial，注销失败仍 failed；DNR/WebRTC 独立报告。保存、重试、后台唤醒都不能恢复。下文原直接 MAIN 注入描述是恢复前的架构合同，当前不执行；恢复须取得可靠最终文档绑定并另获授权，不能用 URL、时间戳、nonce 或事后 ID 检查代替。已执行 hook/BFCache 文档需关闭并重建。证据见 [调查](../../../docs/stabilization/document-id-investigation.md)。

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
│   │   ├── services.ts            # 配置事务、检测确认、脚本/DNR/WebRTC、标签页刷新
│   │   ├── message-router.ts      # 消息分派与扩展管理页来源校验
│   │   ├── context-menu.ts
│   │   ├── diagnostic-runs.ts     # 一次性内存 run、所有者/TTL/授权与导航状态
│   │   ├── diagnostic-probe.ts    # 自包含实际值采集，无预期参数
│   │   ├── dnr.ts
│   │   └── webrtc.ts
│   ├── content/content.ts        # ISOLATED 初始化通知，不承载页面配置桥
│   ├── injected/runtime.ts       # 静态生成自包含函数的稳定 facade（生产仍暂停）
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
| `src/content/content.ts` | `content/content.js` | 动态注册的 ISOLATED content script |
| `src/popup/popup.ts` | `popup/popup.js` | `popup/popup.html` |
| `src/options/options.ts` | `options/options.js` | `options/options.html` |
| `src/leak-test/leak-test.ts` | `leak-test/leak-test.js` | `leak-test/leak-test.html` |
| `src/diagnostic/report.ts` | `diagnostic/report.js` | `diagnostic/report.html`（仅扩展 origin） |

- HTML、manifest、`public/icons/*`、fixtures、LICENSE、NOTICE 通过静态复制进入 dist；页面 CSS 由对应入口导入并输出到页面子目录。
- 当前构建会输出 `dist/assets/*.js` 共享 chunks。哈希文件名由 Rollup 决定，不能假定共享模块全部内联；打包必须包含整个 dist 所需文件。
- `src/injected/runtime.ts` 通过 virtual:vanishgeo-runtime 导出构建期自包含函数，维护源在 runtime-modules；安全暂停期间后台不导入/打包它，构建插件仍执行生成守卫；它不是独立 Vite 入口，不存在应发布的 `dist/injected/runtime.js`。恢复前必须重新验证自包含函数及最终文档绑定。
- `@` 指向 src，TypeScript 和 Vite 都配置了别名；源码 ES module imports 由构建处理，不需要 `module.exports` 或浏览器全局导出。
- `npm run dev` 是 Vite build watch，开发时仍加载/重载 unpacked dist；`npm run preview` 不代表 Chrome 扩展运行环境。

## 模块与浏览器边界

- 入口负责初始化和监听，领域逻辑归其所有者；不根据根文件历史名强制新增 shell 或层级。
- background 专属 Chrome API 留在 `src/background/`，共享纯配置/派生逻辑留在 `src/shared/`；测试直接 import 同一维护源。
- ISOLATED content 只发送 `initializeRuntimeForSender`；后台从可信 MessageSender 解析文档 URL/origin，校验扩展身份和 documentId，再决定 MAIN-world 注入。网页不能提交可信 payload。
- top frame 和 iframe 都按各自 documentId 初始化，保留 `allFrames`、`matchOriginAsFallback` 动态注册边界；不得用父页面遍历 iframe 或页面消息代替授权检查。
- runtime 函数必须自包含，不能依赖注入后无法访问的模块闭包；页面 hook 和反射虚拟化集中在其 registry。
- Worker/SharedWorker wrapper 属于 runtime，module bootstrap 必须先于动态 import；service worker hook 不属于当前页面 worker 支持范围。
- 文件名沿用 kebab-case；新增模块按责任命名，不为一次任务建立平行配置/匹配器。

## 修改与验证

源码或 wiring 变化时检查对应维护源、引用和实际 dist 输出；不得直接修复生成目录。测试边界和真实浏览器验收要求见 [质量规范](./quality-guidelines.md)，稳定化证据见 [执行基线](../../../docs/stabilization/README.md)。

## VG-012 静态运行时模块

`build/self-contained-runtime.ts` 先生成 workerBootstrap，再把 worker 静态函数嵌入页面 graph，最终函数体包含所有运行依赖。生成函数外仅纯 export，拒绝外部绑定/import、动态 chunk、运行期编译、循环/缺失依赖和不稳定生成文件名。不要直接把普通模块函数交给 executeScript.func 或对带模块闭包的 worker 函数取 source。

registry.ts 是页面唯一 state/反射所有者；surfaces 显式消费同一 state，entry.ts 保留首次/重复语义与原顺序。worker/registry 拥有独立 realm 原生快照；worker self-reference 显式传入 nested-worker。没有模块级浏览器修改、配置/匹配或存储副本。

`build/runtime-plugin.ts` 返回组合 source map，登记 page/worker 的实际依赖，build watch 重建 virtual 内容。用于加载的内部模块 ID 有文件位置，但不写维护树生成文件；生产 sourcemap 配置保持不变，无网页 map URL/WAR。后台仍无 runtime 依赖，测试通过临时 bundle 覆盖未来再接入的 facade 序列化合同。恢复生产派发须另行授权并解决最终文档绑定，不由本次模块化隐式恢复。
