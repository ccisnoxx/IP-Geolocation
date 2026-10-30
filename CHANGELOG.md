# 更新日志

只记对使用者有影响的变化。格式按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号跟 `manifest.json` 一致。

## 2.4.2

- 函数伪装：`Function.prototype.toString` 的替换物改成方法形状 —— 没有自有 `prototype`、
  `new` 会抛 TypeError、`Object.getOwnPropertyNames` 只剩 `['length','name']`，与原生内建函数同形
- `disguise()` 改为惰性安装：原生值已经等于目标值时不碰 `Function.prototype.toString`
- 注入层与 Worker blob 显式 `"use strict"`：sloppy 代码里的函数会多出自有 `arguments` / `caller`，
  那是页面一行就能看出来的残差
- 后台消息按来源分权：内容脚本只能调用三个只读 action，任意管理动作不再能从内容桥转发（P1 桥缺口仍开放，见 `REVIEW-P1-BRIDGE.md`）
- opaque frame 的文档身份与父链证据独立建模，补上 frames / opaque-frames / opaque-recovery 冒烟
- 新增 `test:coverage:security` 覆盖率门禁（消息来源策略、opaque frame 证据、补丁开关、函数伪装逐文件阈值）
- `native-parity` 增加函数对象自身的 own keys / own symbols / descriptors / IsConstructor 比对
- 发布流程：正文改成从 `default-domains.json` / `DEFAULT_PROFILES` / `release/*.json` 生成；
  真浏览器冒烟挡在创建 Release 之前；`--require` 跟着预设数量现算

## 2.4.1

- 加固后台消息权限：从「router 直接调用 service」改为显式来源策略
- 页面与 Worker 的配置更新生命周期对齐（含 set* 家族）
- 修复 Date / Intl 的若干真实语义差异
- 发布校验去掉恒真路径

## 2.4.0

- 域名树规则按浏览器 API 能力拆分，不再复用一张排除表
- 权限撤销走 Chrome API 能力模型
