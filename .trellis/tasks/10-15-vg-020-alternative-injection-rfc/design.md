# 设计入口

权威RFC为 docs/stabilization/alternative-injection-rfc.md。只在RFC中讨论潜在架构变更，不修改当前AGENTS/spec和生产实现，不将RFC假设提升为已接受合同。

已读VG-015/017报告和证据、manifest、runtime入口/registry与现有消息router；官方scripting、content scripts、messaging、DOM/HTML标准用于核验公开能力。相关历史已在当前上下文和任务资料，不额外检索会话历史。

本次无浏览器实验、无新依赖、无数据迁移。现有测试/构建输入不变时复用VG-014/015/017证据；检查文档链接、状态一致性及本任务实际增量。

RFC：[alternative-injection-rfc.md](../../../docs/stabilization/alternative-injection-rfc.md)。候选B的端点绑定和跨world私有交付仍未证明，不能把“移除重选址”写成已验证安全；原生Port、局部closure和随机nonce均不单独成为修复证明。
