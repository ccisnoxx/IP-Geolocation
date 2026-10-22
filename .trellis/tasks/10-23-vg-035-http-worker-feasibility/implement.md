# VG-035 整理与验证记录

状态 done。2026-10-23 用户明确验收本次整理通过，授权将文档和实验资料提交到本地，先不推送；HTTP(S) Worker 和 SharedWorker 继续保持暂停。

## 本次交付

- [实验结论与暂停决定](../../../docs/stabilization/http-module-worker-feasibility.md)汇总当前 Chrome 的 9 组原生／包装对照，明确全局相对路径、入口 CSP 执行与报告语义不等价。
- [证据目录](../../../experiments/http-module-worker-feasibility/)保存原始 JSON、汇总截图、只读核对脚本及历史夹具。JSON 和截图从本轮临时证据复制；夹具仅移除个人绝对路径、改用独立临时输出目录，未更改测试逻辑。核对脚本去除历史文件写回与 HTML 生成，只读取存档并核对原有断言清单。
- 原始 JSON SHA-256：`5ee4143ffc0e397d71424728ab77872aa88d826641c4540c71d4d1ffa6470877`，与临时原始文件逐字节一致。
- 明确 page-connect-none 实际允许结果回传端点、responseCSP 为模板字段、Report-Only 记录限制、早期 iframe 批次未完成，以及 HTTPS／Service Worker／DNR／完整网络和生命周期矩阵未验证。
- task-manifest 记录生产暂停决定；README、AGENTS、验收矩阵只增加当前结论入口。VG-033／VG-034 的 done 及已验收 Blob 覆盖不变。

## 验证和证据复用

- `python3 experiments/http-module-worker-feasibility/verify-evidence.py`：66 项历史结果断言通过，结论 NOT_EQUIVALENT。没有启动 Chrome，不是新一轮真实浏览器验收。
- 归档夹具 TypeScript 语法检查通过；路径适配没有重新执行 Chrome。
- 文档相对链接、个人路径检查、原始证据字节一致性、任务依赖及 YAML 解析、最终差异与空白检查通过。
- 归档前基线提交为 `2a04924`。生产源码、维护构建代码、tests、scripts、package/lock、tsconfig、Vite、manifest、public 和 rules 输入相对此提交未变化；VG-034 证据中的六个文件 SHA-256 全部匹配。
- 因输入未变，复用 [VG-034 原验证记录](../10-23-vg-034-nested-blob-worker/implement.md)中的 `npm run check`：源码及测试 typecheck、294/294 测试、build。没有为本次资料归档重跑或冒称新增这组证据。
- 本轮没有再次启用实验服务、打开浏览器或修改扩展配置、权限及生产派发。之前实验临时服务和标签页已关闭。

## 人工验收与本地提交授权

2026-10-23 用户明确确认本次整理验收通过，要求 VG-035 标记为 done，并授权文档与实验资料本地提交，先不推送。manifest 与 task.json 同步为 done；本次收尾只更新验收与授权记录，原始实验数据、截图、夹具和核对逻辑保持不变，复用上述输入未变化的验证证据。

HTTP(S) Dedicated Worker 与 SharedWorker 继续暂停；未来恢复必须另行授权并解决文档列出的门槛。归档任务 done 不代表 Worker 生产恢复、未覆盖项目验收或发布授权。不推送、不发布。
