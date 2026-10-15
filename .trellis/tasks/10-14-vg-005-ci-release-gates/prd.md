# VG-005：增加 CI 与发布测试门禁

2026-10-14 用户明确授权 R1；依赖 VG-004 已人工验收为 done。分支 stabilize/VG-005，基线 5701b55。旧 VG-005 注入生命周期初始计划按本次请求校准，A05 浏览器验收仍有缺口，不自动启动其他任务。

## 交付与验收

- push/PR CI 与 tag release 依次执行 npm ci、源码 typecheck、测试 typecheck、npm test、build；失败不能进入打包/上传/Release。
- 独立 tsconfig.test.json 严格检查 tests，修正暴露的夹具类型，不放宽生产类型或断言。
- 增加本地 npm run check 聚合四项检查，使用 && 传播失败；安装与 Chrome dry-run 单独执行。
- 发布完整 Git 历史生成真实跨 tag commit 清单；首次发布列出已有提交，浅克隆显式失败。
- Actions 默认 contents: read，仅 release job contents: write。Chrome dry-run 不代表人工验收。
- 本地验证结束为 review，completedAt=null；人工验收后才可 done。

## 范围

仅 workflow、测试类型/夹具、changelog 脚本/回归测试、必要文档与治理。无生产依赖/大版本升级，无 runtime/schema/storage/message/manifest/DNR/权限变更。不提交、push、merge、打 tag、发布、改远端设置或实施后续任务。
