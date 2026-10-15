# VG-005 设计

## 门禁与失败边界

CI 在 push/pull_request 上运行只读 checks job；release 在 v*.*.* tag push 上运行 release job，并在该 job 明确授予 contents: write。两者使用相同的安装、源码类型、测试类型、单元测试、构建顺序；各步骤采用默认成功条件，无 continue-on-error 或 always 绕过。产物上传、ZIP 和 Release 都排在门禁后。npm run check 使用 && 聚合 typecheck、typecheck:tests、test、build，保持现有 build 自带源码检查。

## 类型与 changelog

tsconfig.test.json 继承现有严格配置，只更换 include 为 tests/**/*.ts；引用的 src 同时接受检查。不降低 strict，不用 ts-nocheck/新增 any 掩盖错误。夹具沿用 config-model 的归一化方法或补齐 null 字段；ScriptInjection 先判断 func 分支再读取 args。

release checkout fetch-depth: 0。独立 Bash changelog 脚本拒绝 shallow 仓库，在 HEAD 全部祖先里选择最近的 v 版本 tag，排除指向 HEAD 的所有轻量/附注版本 tag，避免未合并分支或当前 tag 被当作上一版；无上一 tag 时输出全部历史，错误传播而非通用文本兜底。输出写 RUNNER_TEMP 文件并通过 body_path 读取，commit 文本不插入 shell 或 GitHub output。

## 验证和回滚

在系统临时目录创建合成 Git 仓库验证首次/跨tag/其他分支/浅克隆；本地失败注入验证 check 的测试失败阻断 build，workflow wiring 静态检查验证同等门禁顺序及下游默认成功条件。最低命令完整执行，真实 Chrome 不运行，保留 dry-run 证据边界。发布门禁须 fresh critical_reviewer 独立只读复核。

只撤销本任务可归属增量，不 reset/clean，不改前序任务或浏览器数据。依赖未完成、不可消解合同冲突、需未批准高风险操作/授权、违反安全隐私边界或不可区分的阻塞基线才 blocked。GitHub Release API 的部分失败不承诺原子回滚；由维护者核对实际状态后决定恢复。
