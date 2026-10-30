# 独立只读复核摘要

审查者：`/root/ablation_review`，角色 `critical_reviewer`。本文件由主代理根据该审查者的两次直接报告整理，不冒充原始会话导出。

审查对象是本轮前副本至候选的四文件 patch，不是包含原有 dirty 修改的 HEAD 总 diff。审查者重新生成差异并确认与候选 patch 一致，未修改文件、运行测试或启动浏览器。

- A：没有找到注册流程绕过 `applyConfig → applyConfigNow → applyRuntimeSideEffects` 的入口；注册、更新、注销均在 `applyChain` 内被等待。失败传播、后续恢复及成功后签名顺序保留。
- B：两个合并函数保留原实现主体和外部方法名；文档账本、可选 ID no-op、容量、session 失败处理、frozen 提前返回、域名错误及保存后重载的顺序没有变化。
- C：debug 没有其他读取者、序列化或 Worker 配置用途；在原求值位置改为局部常量，clear/禁用仍在此前返回。首轮复核时没有直接浏览器 debug 断言，主代理随后增加了本地普通管理路径的临时浏览器对照。
- D：`deliver` 对显式 clear 有既有例外，所以不能把拉取回调中的检查无条件称为重复。当前 `getEffectiveProfile` 生产合同不生成 clear payload，没有确认正常生产触发路径；主代理仍选择撤回，以保留该输入的原有处理。一次性 Node 反例随后证实了输入组合上的差异。

最终补充复核确认：`services.ts`、`runtime.ts`、`injection-idempotency.test.ts` 与已审查 A/B/C 对应部分逐字一致；`services.ts` 也与 B 后检查点一致；`content-bridge.ts` 已恢复至 before 副本的原始字节。最终子集未发现新增的复核问题。

审查范围限于本轮引入的风险和直接合同，不重新审计未改变的父链凭证协议，不构成消息桥攻击验收或发布批准。既有 MAIN 认证 P1 保持开放。
