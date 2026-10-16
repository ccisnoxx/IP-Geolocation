# 前端开发规范

---

## Overview

只读取与当前变更直接相关的有效规范；待定制模板默认不读。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | TypeScript/Vite 维护源、六个入口、dist/chunk 输出与执行环境分层 | Active |
| [State Management](./state-management.md) | Schema v2、出口档案事务与 userScripts 语言/时区文档快照与人工重载契约 | Active |
| [Quality Guidelines](./quality-guidelines.md) | MV3 文档注入、runtime 闭包状态与原生 API 合同、构建 wiring、权限/隐私及分层验证证据 | Active |

---

修改注入、权限、请求头、worker/iframe 传播、runtime 文件或 manifest/HTML wiring 时读取 [Quality Guidelines](./quality-guidelines.md) 的相关章节。

待定制模板：`component-guidelines.md`、`hook-guidelines.md`、`type-safety.md`。除非任务要建立对应规范，否则不要读取。

稳定化任务状态与验收入口：[执行基线](../../../docs/stabilization/README.md)。依赖以 manifest 为准，历史任务记录不能替代当前验收。

项目规范默认使用中文。
