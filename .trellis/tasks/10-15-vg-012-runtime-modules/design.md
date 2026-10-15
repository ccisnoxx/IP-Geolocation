# 实施设计

权威方案沿用 `docs/stabilization/runtime-modularization-rfc.md` 第4/6/7节。安全暂停注释高于旧派发示例；生产后台保持无 runtime 依赖。

- runtime.ts 为 virtual module facade；维护源位于 runtime-modules，类型集中 types.ts。
- registry 持有每文档唯一 state，anchor 显式传入；surface 使用同一 registry，调度顺序和首次/重复差异原样保留。
- worker graph 先静态生成 workerBootstrap，worker 独立 registry/native snapshots，递归 worker 使用生成函数自身；然后将其嵌入页面 graph。
- 生成阶段以 Vite/Rollup 展平并用静态 banner/footer 包裹；生成函数外只允许纯 ESM export。检查外部引用、动态 chunk、import/eval/Function 构造与稳定文件名，不采用运行时编译或兜底。
- 插件返回组合 source map 并登记所有 page/worker watch 依赖；生产构建即使安全暂停也执行生成守卫，但不将 runtime 添加到 dist 或后台。
- 无文件/配置/schema迁移；所有 payload 来自既有权威边界。测试 runner 的直接注入仅在临时扩展/localhost，不构成生产恢复路径。
- 原/新可观察行为比较使用相同合成 payload；随机、timestamp等采用固定源或稳定性断言。真实 Chrome 中单列当前文档隔离测试与生产零派发；stale documentId 缺陷不由模块化修复。
