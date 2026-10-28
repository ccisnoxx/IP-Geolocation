# release 分支开发工具适配

这些入口使用现行配置所有者和 runner，不以分支历史测试记录代替当前验证。命令只生成本地产物；不创建 tag、Release 或发布。

## 本地出包及两类审查

```sh
npm run release:prepare -- --kind regular --plan
npm run release:prepare -- --kind regular
npm run release:prepare -- --kind persona --all-presets --domains example.test --plan
npm run release:prepare -- --kind persona --preset germany-berlin,china-shanghai --domains example.test
npm run audit:persona -- --zip <本地ZIP> --preset germany-berlin --domains example.test --output <新JSON>
```

实际出包先执行完整 `npm run check`，没有跳过开关；输出到新建目录，不覆盖旧包。普通包继续使用 `audit-release.mjs`，包括现行权限、隔离规则、入口图及 ZIP 字节门禁。persona 审查要求显式预设和域名，先验证全部 ZIP 路径，再比较文件集合、manifest、维护源生成的静态代码及元数据。缺少预期配置不能通过。

当前 persona 类型是 `persona-language-timezone`：仅核对语言／时区静态快照与产物身份，不包含定位、字体、DNR或在线关闭恢复，不等同普通生产包。固定包移除普通后台／管理入口／API权限，运行时不建立实时桥；完整多信号persona不在该包范围，浏览器另行验证。persona 元数据包含预设位置，仅保存在本地包内，不输出原始坐标到控制台；构建与验证输出不应提交为个人配置记录。

## 检查矩阵及原生对照

```sh
npm run validate:matrix -- --only lint,types,test-types,unit,build --output <新JSON>
npm run validate:matrix -- --only intl,native-parity --browser <Chrome138以上路径> --browser <另一浏览器路径> --output <新JSON>
npm run audit:parity -- --output <新JSON>
```

矩阵复用现有专项脚本；`intl` 是临时最小扩展中的完整维护 runtime 定向测试，不代表生产注册。`native-parity` 使用正式 dist、临时 Profile 和 loopback fixture，记录 NATIVE / OBSERVABLE / UNKNOWN / UNSUPPORTED；OBSERVABLE 不是不可检测承诺。源 runner 的退出码和原始 JSON 结果必须同时有效；无浏览器或无有效证据记为未完成，并返回非零。

浏览器项需要 Node22+。矩阵证据保存在报告旁新建的专属目录中，不覆盖既有报告。只执行显式选择的 runner；不默认访问真实站点、定位 provider 或个人 Profile，不按进程名清理浏览器。

## 独立原生环境启动

```sh
npm run browser:env -- --preset germany-berlin --plan
npm run browser:env -- --preset germany-berlin --browser <Chrome138以上路径>
npm run browser:env -- --preset germany-berlin --profile <本工具专属目录> --url https://example.test/
```

启动器仅向子进程传入 `TZ`、`--lang`、`--accept-lang`，不注入 JS 或 CDP 覆盖，也不自动加载扩展或修改 Allow User Scripts。参数是否生效须由该浏览器实际观测，不能从成功启动推定页面、Worker 或 Service Worker 已通过。

默认使用本次临时 Profile；持久目录必须为空或有本工具的所有权标记，已有个人配置目录会被拒绝。只管理本次创建的进程组；组长退出后仍确认／回收同组后代，再删除本次临时目录。无法确认清理时失败并保留 Profile。持久 Profile 保留，检测到占用时要求先关闭浏览器。

## Lint 与覆盖率

```sh
npm run lint
npm run test:coverage
npm run test:coverage:core
```

Lint 使用 typescript-eslint 推荐规则，保留源码与测试类型检查；原生 runtime 代理所需的可调用／可构造对象及完整 arguments 保留项目既有写法。新增门禁同时进入本地 check、CI 与 Release，失败不可绕过到构建或发布。

c8 12 的开发环境要求 Node20.19+、22.12+或23以上；当前 Node24 已核对。`test:coverage:core` 先重新执行完整测试采集覆盖率，再对 services、配置模型／解析／存储、ui-state、config-audit、action-badge 共七个明确文件执行逐文件分支覆盖率85%门禁。其他文件也进入完整报告，但没有声称全仓达到85%。

生成后在 VM 中执行的函数及 jsdom 包装代码可能不能完整归因回维护 TS；其0%或低比例不能直接解释为没有行为验证，也不能把 Node/VM 覆盖率当作 Chrome 验收。报告位于忽略的 `coverage/`，包括文本、JSON摘要和LCOV；不提交原始运行路径或个人浏览器数据。
